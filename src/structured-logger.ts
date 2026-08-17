/**
 * Structured JSON Logger for AsiJS
 *
 * Produces JSON-formatted log lines compatible with:
 * - ELK Stack (Elasticsearch, Logstash, Kibana)
 * - Datadog (structured JSON ingestion)
 * - Splunk (JSON event format)
 * - Any JSON log shipper (Fluentd, Vector, etc.)
 *
 * Extends the existing requestLogger with structured fields,
 * log levels, service context, and custom metadata.
 *
 * @example
 * ```ts
 * import { Asi, structuredLogger } from "asijs";
 *
 * const app = new Asi();
 *
 * // Default structured logging
 * app.use(structuredLogger());
 *
 * // With custom service info and custom fields
 * app.use(structuredLogger({
 *   service: "my-api",
 *   environment: "production",
 *   version: "1.0.0",
 *   extraFields: {
 *     team: "backend",
 *     region: "us-east-1",
 *   },
 * }));
 *
 * // Use standalone logger
 * const log = createStructuredLogger({ service: "my-app" });
 * log.info("User created", { userId: 123 });
 * log.error("Database error", { err: error });
 * ```
 */

import type { Context } from "./context";
import type { Middleware } from "./types";

// ============================================================================
// Types
// ============================================================================

/** Log severity levels. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Options for the structured logger (level, transport, fields). */
export interface StructuredLoggerOptions {
  /**
   * Service name (appears in all log entries)
   * @default "asijs-app"
   */
  service?: string;

  /**
   * Environment name
   * @default process.env.NODE_ENV || "development"
   */
  environment?: string;

  /**
   * Service version
   * @default ""
   */
  version?: string;

  /**
   * Paths to exclude from request logging
   * @default ["/health", "/ready", "/live", "/metrics"]
   */
  exclude?: string[];

  /**
   * Custom filter function — return false to skip logging this request
   */
  filter?: (info: StructuredLogEntry) => boolean;

  /**
   * Custom log handler (default: writes to stdout/stderr)
   */
  logHandler?: (entry: StructuredLogEntry) => void;

  /**
   * Additional static fields to include in every log entry
   */
  extraFields?: Record<string, unknown>;

  /**
   * Pretty-print JSON in development (default: false = single line)
   */
  pretty?: boolean;

  /**
   * Include request body in log entries (only captured if available)
   * @default false
   */
  includeBody?: boolean;

  /**
   * Include response body size
   * @default true
   */
  includeSize?: boolean;
}

/** One structured log entry (timestamp, level, message, fields). */
export interface StructuredLogEntry {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Log level */
  level: LogLevel;
  /** Service name */
  service: string;
  /** Environment */
  environment: string;
  /** Event type */
  event: string;

  // Request fields
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  requestId?: string;
  ip?: string;
  userAgent?: string;
  contentLength?: number;
  referer?: string;

  // Error fields
  error?: string;
  errorType?: string;
  stackTrace?: string;

  // Context
  version?: string;
  hostname?: string;
  pid?: number;

  // Custom fields
  [key: string]: unknown;
}

// ============================================================================
// Structured Logger Factory
// ============================================================================

let hostnameValue: string | undefined;

function getHostname(): string {
  if (!hostnameValue) {
    try {
      hostnameValue = process.env.HOSTNAME || "";
    } catch {
      hostnameValue = "";
    }
  }
  return hostnameValue;
}

/**
 * Create a standalone structured logger.
 *
 * Can be used independently of the middleware for logging
 * application events with the same structured format.
 *
 * @example
 * ```ts
 * const log = createStructuredLogger({ service: "my-app" });
 * log.info("Server started", { port: 3000 });
 * log.error("Connection failed", { err: error, host: "db:5432" });
 * ```
 */
export function createStructuredLogger(
  options: StructuredLoggerOptions = {},
): {
  debug: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
  child: (extraFields: Record<string, unknown>) => ReturnType<typeof createStructuredLogger>;
} {
  var service = options.service || "asijs-app";
  var environment =
    options.environment || process.env.NODE_ENV || "development";
  var version = options.version || "";
  var extra = options.extraFields || {};
  var pretty = options.pretty ?? false;

  function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    var entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level: level,
      service: service,
      environment: environment,
      event: message,
      hostname: getHostname(),
      pid: process.pid,
      ...extra,
      ...meta,
    };

    if (version) entry.version = version;

    var line = pretty
      ? JSON.stringify(entry, null, 2)
      : JSON.stringify(entry);

    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else if (level === "debug") {
      console.debug(line);
    } else {
      console.log(line);
    }
  }

  return {
    debug: function(msg: string, meta?: Record<string, unknown>) { log("debug", msg, meta); },
    info: function(msg: string, meta?: Record<string, unknown>) { log("info", msg, meta); },
    warn: function(msg: string, meta?: Record<string, unknown>) { log("warn", msg, meta); },
    error: function(msg: string, meta?: Record<string, unknown>) { log("error", msg, meta); },
    child: function(childExtra: Record<string, unknown>) {
      return createStructuredLogger({
        ...options,
        extraFields: { ...extra, ...childExtra },
      });
    },
  };
}

// ============================================================================
// Request Logger Middleware (Structured)
// ============================================================================

/**
 * Create a structured JSON request logger middleware.
 *
 * Produces JSON log entries for every request, compatible with
 * ELK, Datadog, Splunk, and other JSON log shippers.
 *
 * @example
 * ```ts
 * // Basic — uses defaults (service="asijs-app", env from NODE_ENV)
 * app.use(structuredLogger());
 *
 * // Full configuration
 * app.use(structuredLogger({
 *   service: "payment-api",
 *   environment: "production",
 *   version: "2.1.0",
 *   exclude: ["/health", "/metrics"],
 *   extraFields: { region: "eu-west-1", team: "payments" },
 * }));
 * ```
 */
export function structuredLogger(
  options: StructuredLoggerOptions = {},
): Middleware {
  var service = options.service || "asijs-app";
  var environment =
    options.environment || process.env.NODE_ENV || "development";
  var exclude = options.exclude || ["/health", "/ready", "/live", "/metrics"];
  var filter = options.filter;
  var extra = options.extraFields || {};
  var includeSize = options.includeSize ?? true;
  var pretty = options.pretty ?? false;

  var defaultHandler = function(entry: StructuredLogEntry) {
    var line = pretty ? JSON.stringify(entry, null, 2) : JSON.stringify(entry);
    var level = entry.level;

    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
  };

  var handler = options.logHandler || defaultHandler;

  return async function(ctx: Context, next: () => Promise<Response>): Promise<Response> {
    var startTime = performance.now();
    var requestId =
      ctx.header("X-Request-ID") || ctx.header("X-Trace-ID") || "";

    try {
      var response = await next();
      var duration = performance.now() - startTime;
      var status = response instanceof Response ? response.status : 200;

      if (exclude.includes(ctx.path)) return response;

      var entry: StructuredLogEntry = {
        timestamp: new Date().toISOString(),
        level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
        service: service,
        environment: environment,
        event: "http.request",
        method: ctx.method,
        path: ctx.path,
        status: status,
        durationMs: duration,
      };

      if (requestId) entry.requestId = requestId;
      if (includeSize && response instanceof Response) {
        var cl = response.headers.get("Content-Length");
        if (cl) entry.contentLength = parseInt(cl, 10);
      }
      var ip = ctx.header("X-Forwarded-For") || ctx.header("X-Real-IP") || "";
      if (ip) entry.ip = ip;
      var ua = ctx.header("User-Agent") || "";
      if (ua) entry.userAgent = ua;
      var ref = ctx.header("Referer") || "";
      if (ref) entry.referer = ref;
      var hostname = getHostname();
      if (hostname) entry.hostname = hostname;
      entry.pid = process.pid;

      // Merge extra fields
      for (var ek in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, ek)) {
          entry[ek] = extra[ek];
        }
      }

      if (!filter || filter(entry)) {
        handler(entry);
      }

      return response;
    } catch (error) {
      var duration = performance.now() - startTime;

      if (exclude.includes(ctx.path)) throw error;

      var errorEntry: StructuredLogEntry = {
        timestamp: new Date().toISOString(),
        level: "error",
        service: service,
        environment: environment,
        event: "http.request.error",
        method: ctx.method,
        path: ctx.path,
        status: 500,
        durationMs: duration,
      };

      if (requestId) errorEntry.requestId = requestId;
      if (error instanceof Error) {
        errorEntry.error = error.message;
        errorEntry.errorType = error.name;
        errorEntry.stackTrace = error.stack;
      }
      var ip2 = ctx.header("X-Forwarded-For") || ctx.header("X-Real-IP") || "";
      if (ip2) errorEntry.ip = ip2;

      // Merge extra fields
      for (var ek2 in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, ek2)) {
          errorEntry[ek2] = extra[ek2];
        }
      }

      if (!filter || filter(errorEntry)) {
        handler(errorEntry);
      }

      throw error;
    }
  };
}

// ============================================================================
// Convenience Exports
// ============================================================================

/**
 * Pre-configured structured logger with service name "api".
 */
export const apiLogger = createStructuredLogger({ service: "api" });

/**
 * Pre-configured structured logger with service name "web".
 */
export const webLogger = createStructuredLogger({ service: "web" });

/**
 * Pre-configured structured logger with service name "worker".
 */
export const workerLogger = createStructuredLogger({ service: "worker" });
