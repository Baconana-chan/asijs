/**
 * Request Logger Middleware for AsiJS
 *
 * Colorful request logging for development, JSON logging for production.
 * Integrates with trace module for X-Request-ID.
 *
 * @example
 * ```ts
 * import { Asi, requestLogger } from "asijs";
 *
 * const app = new Asi();
 *
 * // Dev mode (colored, concise)
 * app.use(requestLogger());
 *
 * // Production (JSON output)
 * app.use(requestLogger({ format: "json" }));
 *
 * // Exclude health checks
 * app.use(requestLogger({
 *   exclude: ["/health", "/ready", "/metrics"],
 * }));
 *
 * // Custom log handler (e.g., send to external service)
 * app.use(requestLogger({
 *   logHandler: (info) => {
 *     myLoggingService.log(info);
 *   },
 * }));
 * ```
 */

import type { Context } from "./context";
import type { Middleware } from "./types";

// ===== Types =====

export interface RequestLogInfo {
  /** HTTP method */
  method: string;
  /** Request path */
  path: string;
  /** Response status code */
  status: number;
  /** Request duration in milliseconds */
  duration: number;
  /** Request ID (from X-Request-ID header or generated) */
  requestId?: string;
  /** Client IP */
  ip?: string;
  /** User agent */
  userAgent?: string;
  /** Content length of response */
  contentLength?: string;
  /** Query parameters */
  query?: string;
  /** Response content type */
  contentType?: string;
}

export type LogFormat = "dev" | "json" | "short" | "tiny";

export interface RequestLoggerOptions {
  /**
   * Log format
   * - "dev": colored, human-readable (default)
   * - "json": JSON line for production
   * - "short": concise single line, no colors
   * - "tiny": minimal output: method path status duration
   * @default "dev"
   */
  format?: LogFormat;

  /**
   * Paths to exclude from logging
   * @default ["/health", "/ready", "/live", "/metrics"]
   */
  exclude?: string[];

  /**
   * Custom filter function — return true to log, false to skip
   */
  filter?: (info: RequestLogInfo) => boolean;

  /**
   * Custom log handler (default: console.log / console.error)
   */
  logHandler?: (info: RequestLogInfo, line: string) => void;

  /**
   * Include query string in log output
   * @default false
   */
  showQuery?: boolean;

  /**
   * Color output (only applies to "dev" format)
   * @default true
   */
  color?: boolean;
}

// ===== ANSI Colors =====

const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",

  // Foreground
  fg: {
    black: "\x1b[30m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
    gray: "\x1b[90m",
  },

  // Background
  bg: {
    red: "\x1b[41m",
    green: "\x1b[42m",
    yellow: "\x1b[43m",
    blue: "\x1b[44m",
    magenta: "\x1b[45m",
    cyan: "\x1b[46m",
  },
};

/** Get color for HTTP method */
function methodColor(
  method: string,
  useColor: boolean,
): { open: string; close: string } {
  if (!useColor) return { open: "", close: "" };

  const map: Record<string, string> = {
    GET: colors.fg.green,
    POST: colors.fg.blue,
    PUT: colors.fg.yellow,
    PATCH: colors.fg.magenta,
    DELETE: colors.fg.red,
    OPTIONS: colors.fg.cyan,
    HEAD: colors.fg.white,
  };

  return { open: map[method] ?? colors.fg.white, close: colors.reset };
}

/** Get color for status code */
function statusColor(
  status: number,
  useColor: boolean,
): { open: string; close: string; bg?: string } {
  if (!useColor) return { open: "", close: "" };

  const category = Math.floor(status / 100);

  switch (category) {
    case 2:
      return { open: colors.fg.green, close: colors.reset };
    case 3:
      return { open: colors.fg.cyan, close: colors.reset };
    case 4:
      return {
        open: colors.fg.black,
        close: colors.reset,
        bg: colors.bg.yellow,
      };
    case 5:
      return {
        open: colors.fg.white,
        close: colors.reset,
        bg: colors.bg.red,
      };
    default:
      return { open: colors.fg.white, close: colors.reset };
  }
}

// ===== Formatters =====

function formatDev(info: RequestLogInfo, useColor: boolean): string {
  const mc = methodColor(info.method, useColor);
  const sc = statusColor(info.status, useColor);

  const method = `${mc.open}${info.method.padEnd(7)}${mc.close}`;
  const status = sc.bg
    ? `${sc.bg}${sc.open} ${info.status} ${sc.close}`
    : `${sc.open}${info.status}${sc.close}`;
  const duration = `${colors.dim}${info.duration.toFixed(2)}ms${colors.reset}`;
  const rid = info.requestId
    ? ` ${colors.dim}[${info.requestId}]${colors.reset}`
    : "";
  const query = info.query ? `?${info.query}` : "";

  return `${method} ${info.path}${query} ${status} ${duration}${rid}`;
}

function formatJson(info: RequestLogInfo): string {
  return JSON.stringify({
    method: info.method,
    path: info.path,
    status: info.status,
    duration: info.duration,
    ...(info.requestId && { requestId: info.requestId }),
    ...(info.ip && { ip: info.ip }),
    ...(info.userAgent && { userAgent: info.userAgent }),
    ...(info.contentLength && { contentLength: info.contentLength }),
    ...(info.contentType && { contentType: info.contentType }),
    timestamp: new Date().toISOString(),
  });
}

function formatShort(info: RequestLogInfo): string {
  return `${info.method} ${info.path} ${info.status} ${info.duration.toFixed(2)}ms`;
}

function formatTiny(info: RequestLogInfo): string {
  return `${info.method} ${info.path} ${info.status} ${info.duration.toFixed(0)}ms`;
}

// ===== Request Logger Middleware =====

/**
 * Create request logger middleware.
 *
 * Logs HTTP requests with method, path, status, duration.
 * Supports colored dev output and structured JSON for production.
 *
 * @example
 * ```ts
 * // Dev mode (default, colored)
 * app.use(requestLogger());
 *
 * // Production (JSON)
 * app.use(requestLogger({ format: "json" }));
 *
 * // Exclude health endpoints
 * app.use(requestLogger({
 *   exclude: ["/health", "/metrics"],
 * }));
 * ```
 */
export function requestLogger(
  options: RequestLoggerOptions = {},
): Middleware {
  const {
    format = "dev",
    exclude = ["/health", "/ready", "/live", "/metrics"],
    filter,
    logHandler,
    showQuery = false,
    color: useColor = true,
  } = options;

  // Pre-compile formatter
  const formatFn: (info: RequestLogInfo) => string =
    format === "json"
      ? formatJson
      : format === "short"
        ? formatShort
        : format === "tiny"
          ? formatTiny
          : (info: RequestLogInfo) => formatDev(info, useColor);

  // Default log handler: info for <500, warn for 4xx, error for 5xx
  const defaultHandler = (info: RequestLogInfo, line: string) => {
    if (info.status >= 500) {
      console.error(line);
    } else if (info.status >= 400) {
      console.warn(line);
    } else {
      console.log(line);
    }
  };

  const handler = logHandler ?? defaultHandler;

  return async (ctx: Context, next: () => Promise<Response>): Promise<Response> => {
    const startTime = performance.now();

    // Capture request ID if present
    const requestId =
      ctx.header("X-Request-ID") ?? ctx.header("X-Trace-ID") ?? undefined;

    try {
      const response = await next();

      const duration = performance.now() - startTime;
      const status = response instanceof Response ? response.status : 200;

      const info: RequestLogInfo = {
        method: ctx.method,
        path: ctx.path,
        status,
        duration,
        requestId,
        ip:
          ctx.header("X-Forwarded-For") ??
          ctx.header("X-Real-IP") ??
          undefined,
        userAgent: ctx.header("User-Agent") ?? undefined,
        contentLength:
          response instanceof Response
            ? response.headers.get("Content-Length") ?? undefined
            : undefined,
        contentType:
          response instanceof Response
            ? response.headers.get("Content-Type") ?? undefined
            : undefined,
        ...(showQuery && { query: ctx.url.searchParams.toString() }),
      };

      // Skip excluded paths
      if (exclude.includes(ctx.path)) {
        return response;
      }

      // Custom filter
      if (filter && !filter(info)) {
        return response;
      }

      const line = formatFn(info);
      handler(info, line);

      return response;
    } catch (error) {
      const duration = performance.now() - startTime;

      const info: RequestLogInfo = {
        method: ctx.method,
        path: ctx.path,
        status: 500,
        duration,
        requestId,
        ip:
          ctx.header("X-Forwarded-For") ??
          ctx.header("X-Real-IP") ??
          undefined,
      };

      // Skip excluded paths (even on error)
      if (!exclude.includes(ctx.path)) {
        if (!filter || filter(info)) {
          const line = formatFn(info);
          handler(info, line);
        }
      }

      throw error;
    }
  };
}
