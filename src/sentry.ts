/**
 * Sentry / Error Tracking Integration for AsiJS
 *
 * Captures errors and sends them to Sentry via the Sentry HTTP API.
 * Works without the Sentry SDK — uses fetch-based transport.
 *
 * Features:
 * - Capture uncaught exceptions (process.on('uncaughtException'))
 * - Capture unhandled promise rejections
 * - Capture request errors (via app.onError or error middleware)
 * - Request context: method, path, headers, query, body
 * - Custom beforeSend filter
 * - Configurable sample rate
 * - Breadcrumbs for request lifecycle
 *
 * @example
 * ```ts
 * import { Asi, sentry } from "asijs";
 *
 * const app = new Asi();
 *
 * // Basic — reads SENTRY_DSN from env
 * app.plugin(sentry());
 *
 * // Full configuration
 * app.plugin(sentry({
 *   dsn: "https://key@o123.ingest.sentry.io/123",
 *   environment: "production",
 *   release: "1.0.0",
 *   sampleRate: 0.5,
 *   beforeSend: (event) => {
 *     // Filter sensitive data
 *     delete event.request?.headers?.Authorization;
 *     return event;
 *   },
 * }));
 * ```
 */

import { createPlugin, type AsiPlugin } from "./plugin";
import type { Context } from "./context";
import type { Middleware } from "./types";

// ============================================================================
// Types
// ============================================================================

/** Options for the Sentry reporter (DSN, env, release, capture config). */
export interface SentryOptions {
  /**
   * Sentry DSN (Data Source Name).
   * If not provided, reads from SENTRY_DSN environment variable.
   * If neither is set, the plugin is disabled (no-op).
   */
  dsn?: string;

  /**
   * Environment name (default: NODE_ENV or "development")
   */
  environment?: string;

  /**
   * Release version (e.g., "my-app@1.0.0")
   */
  release?: string;

  /**
   * Error sample rate (0.0 to 1.0). 1.0 = all errors
   * @default 1.0
   */
  sampleRate?: number;

  /**
   * Capture uncaught exceptions
   * @default true
   */
  captureUncaught?: boolean;

  /**
   * Capture unhandled promise rejections
   * @default true
   */
  captureUnhandled?: boolean;

  /**
   * Filter/callback before sending event to Sentry.
   * Return modified event, or null to discard.
   */
  beforeSend?: (event: SentryEvent) => SentryEvent | null;

  /**
   * Additional tags to attach to every event
   */
  tags?: Record<string, string>;

  /**
   * Additional extra data to attach to every event
   */
  extra?: Record<string, unknown>;

  /**
   * Server name / hostname
   */
  serverName?: string;

  /**
   * Timeout for Sentry API requests (ms)
   * @default 5000
   */
  timeoutMs?: number;

  /**
   * Logger name
   * @default "asijs.sentry"
   */
  logger?: string;

  /**
   * Attach stack traces to events
   * @default true
   */
  attachStacktrace?: boolean;

  /**
   * Maximum number of breadcrumbs to keep
   * @default 100
   */
  maxBreadcrumbs?: number;
}

/** A Sentry event envelope (exception, message, breadcrumbs). */
export interface SentryEvent {
  event_id: string;
  timestamp: string;
  platform: string;
  level: string;
  logger?: string;
  culprit?: string;
  server_name?: string;
  release?: string;
  environment?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  message?: { formatted: string };
  exception?: {
    values: Array<{
      type: string;
      value: string;
      module?: string;
      stacktrace?: {
        frames: SentryStackFrame[];
      };
    }>;
  };
  request?: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    data?: unknown;
    query?: Record<string, string>;
  };
  breadcrumbs?: {
    values: Array<{
      type: string;
      category: string;
      message?: string;
      level?: string;
      timestamp?: number;
      data?: Record<string, unknown>;
    }>;
  };
  contexts?: Record<string, unknown>;
}

/** One stack frame in a Sentry event. */
export interface SentryStackFrame {
  filename?: string;
  function?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
  abs_path?: string;
  module?: string;
}

// ============================================================================
// ID Generation
// ============================================================================

/** Generate a 32-hex-char event ID */
function generateEventId(): string {
  var bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  var id = "";
  for (var i = 0; i < 16; i++) {
    id += bytes[i].toString(16).padStart(2, "0");
  }
  return id;
}

// ============================================================================
// DSN Parser
// ============================================================================

interface ParsedDSN {
  protocol: string;
  publicKey: string;
  secretKey?: string;
  host: string;
  port: string;
  path: string;
  projectId: string;
}

function parseDSN(dsn: string): ParsedDSN | null {
  try {
    // Format: https://publicKey@host/1
    // Format: https://publicKey:secretKey@host/path/1
    var url = new URL(dsn);
    var auth = (url.username || "") + (url.password ? ":" + url.password : "");

    // Extract project ID from path
    var pathParts = url.pathname.split("/").filter(Boolean);
    var projectId = pathParts.pop() || "";

    return {
      protocol: url.protocol,
      publicKey: url.username,
      secretKey: url.password || undefined,
      host: url.hostname,
      port: url.port,
      path: "/" + pathParts.join("/"),
      projectId: projectId,
    };
  } catch {
    return null;
  }
}

// ============================================================================
// Stack Trace Parsing
// ============================================================================

function parseStackFrames(stack: string): SentryStackFrame[] {
  var lines = stack.split("\n");
  var frames: SentryStackFrame[] = [];

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    // Match: at functionName (file:line:col)
    // Match: at file:line:col
    var match =
      line.match(/at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/) ||
      line.match(/at\s+(.+?):(\d+):(\d+)/);

    if (match) {
      var frame: SentryStackFrame = {
        function: match[1] || "<anonymous>",
        filename: match[2] || match[1] || "",
        lineno: parseInt(match[3] || match[2] || "0", 10) || 0,
        colno: parseInt(match[4] || match[3] || "0", 10) || 0,
        in_app: !/(node_modules|bun|internal)/.test(line),
      };
      frames.push(frame);
    }
  }

  return frames.reverse();
}

// ============================================================================
// Sentry Transport
// ============================================================================

function buildSentryUrl(dsn: string, apiPath: string): string | null {
  var parsed = parseDSN(dsn);
  if (!parsed) return null;

  var portStr = parsed.port ? ":" + parsed.port : "";
  var pathStr = parsed.path ? parsed.path + "/" : "/";
  return (
    parsed.protocol +
    "//" +
    parsed.host +
    portStr +
    pathStr +
    parsed.projectId +
    apiPath
  );
}

// ============================================================================
// Event Builder (module-level, shared by sentry() and createSentryClient())
// ============================================================================

function buildEventData(level: string, options?: {
  error?: Error;
  message?: string;
  environment?: string;
  release?: string;
  serverName?: string;
  loggerName?: string;
  globalTags?: Record<string, string>;
  globalExtra?: Record<string, unknown>;
  attachStacktrace?: boolean;
  breadcrumbs?: SentryEvent["breadcrumbs"];
}): SentryEvent {
  var env = options?.environment || process.env.NODE_ENV || "development";
  var release = options?.release || "";
  var serverName = options?.serverName || process.env.HOSTNAME || "unknown";
  var loggerName = options?.loggerName || "asijs.sentry";
  var tags = options?.globalTags || {};
  var extra = options?.globalExtra || {};
  var attach = options?.attachStacktrace ?? true;

  var event: SentryEvent = {
    event_id: generateEventId(),
    timestamp: new Date().toISOString(),
    platform: "node",
    level: level,
    logger: loggerName,
    server_name: serverName,
    contexts: {
      runtime: {
        name: typeof Bun !== "undefined" ? "Bun" : "Node.js",
        version: typeof Bun !== "undefined" ? Bun.version : process.version,
      },
    },
  };

  if (release) event.release = release;
  event.environment = env;
  event.tags = { ...tags };
  event.extra = { ...extra };

  // Breadcrumbs
  if (options?.breadcrumbs && options.breadcrumbs.values.length > 0) {
    event.breadcrumbs = options.breadcrumbs;
  }

  // Exception or message
  if (options?.error) {
    var error = options.error;
    event.exception = {
      values: [
        {
          type: error.name || "Error",
          value: error.message || String(error),
          module: error.name,
        },
      ],
    };
    if (attach && error.stack) {
      event.exception.values[0].stacktrace = {
        frames: parseStackFrames(error.stack),
      };
    }
  }

  if (options?.message) {
    event.message = { formatted: options.message };
  }

  return event;
}

async function sendToSentry(
  dsn: string,
  event: SentryEvent,
  timeoutMs: number,
): Promise<boolean> {
  var url = buildSentryUrl(dsn, "/envelope/");
  if (!url) return false;

  var parsed = parseDSN(dsn);
  if (!parsed) return false;

  // Sentry Envelope format: header on first line, then JSON items
  var envelopeHeader = JSON.stringify({
    event_id: event.event_id,
    dsn: dsn,
    sent_at: new Date().toISOString(),
  });

  var itemHeader = JSON.stringify({
    type: "event",
    content_type: "application/json",
  });

  var itemBody = JSON.stringify(event);

  var envelope = envelopeHeader + "\n" + itemHeader + "\n" + itemBody;

  try {
    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, timeoutMs);

    var response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
      },
      body: envelope,
      signal: controller.signal,
    });

    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

// ============================================================================
// Sentry Plugin
// ============================================================================

/**
 * Create the Sentry error tracking plugin.
 *
 * Captures errors from:
 * - `app.onError` handler (HTTP request errors)
 * - uncaughtException / unhandledRejection (process-level)
 * - Manual capture via `captureException()` and `captureMessage()`
 *
 * @example
 * ```ts
 * // Zero-config (reads SENTRY_DSN from env)
 * app.plugin(sentry());
 *
 * // Explicit config
 * app.plugin(sentry({
 *   dsn: "https://key@o123.ingest.sentry.io/123",
 *   environment: "production",
 *   sampleRate: 0.75,
 *   beforeSend: (event) => {
 *     if (event.level === "debug") return null;
 *     return event;
 *   },
 * }));
 *
 * // Manual capture
 * const sentry = getSentryClient();
 * sentry.captureException(new Error("Something went wrong"));
 * sentry.captureMessage("User action", "info");
 * ```
 */
export function sentry(options: SentryOptions = {}): AsiPlugin {
  var dsn = options.dsn || process.env.SENTRY_DSN || "";
  var environment =
    options.environment || process.env.NODE_ENV || "development";
  var release = options.release || process.env.SENTRY_RELEASE || "";
  var sampleRate = options.sampleRate ?? 1.0;
  var captureUncaught = options.captureUncaught ?? true;
  var captureUnhandled = options.captureUnhandled ?? true;
  var beforeSend = options.beforeSend;
  var globalTags = options.tags || {};
  var globalExtra = options.extra || {};
  var serverName =
    options.serverName || process.env.HOSTNAME || "unknown";
  var timeoutMs = options.timeoutMs ?? 5000;
  var loggerName = options.logger || "asijs.sentry";
  var attachStacktrace = options.attachStacktrace ?? true;
  var maxBreadcrumbs = options.maxBreadcrumbs ?? 100;

  var disabled = !dsn;

  // In-memory breadcrumb buffer
  var breadcrumbsValues: NonNullable<SentryEvent["breadcrumbs"]> = { values: [] };

  function addBreadcrumbLocal(crumb: {
    type?: string;
    category?: string;
    message?: string;
    level?: string;
    data?: Record<string, unknown>;
  }): void {
    if (breadcrumbsValues.values.length >= maxBreadcrumbs) {
      breadcrumbsValues.values.shift();
    }
    breadcrumbsValues.values.push({
      type: crumb.type || "default",
      category: crumb.category || "general",
      message: crumb.message,
      level: crumb.level || "info",
      timestamp: Date.now() / 1000,
      data: crumb.data,
    });
  }

  // ── Public API ──

  var client = {
    captureException: function(error: Error, extra?: Record<string, unknown>): string {
      if (disabled) return "";
      if (sampleRate < 1.0 && Math.random() > sampleRate) return "";

      var event = buildEventData("error", {
        error,
        environment,
        release,
        serverName,
        loggerName,
        globalTags,
        globalExtra,
        attachStacktrace,
        breadcrumbs: breadcrumbsValues,
      });
      breadcrumbsValues = { values: [] };

      if (extra) event.extra = { ...event.extra, ...extra };
      if (beforeSend) {
        var filtered = beforeSend(event);
        if (!filtered) return "";
        event = filtered;
      }
      sendToSentry(dsn, event, timeoutMs).catch(function() {});
      return event.event_id;
    },

    captureMessage: function(
      message: string,
      level?: string,
      extra?: Record<string, unknown>,
    ): string {
      if (disabled) return "";

      var event = buildEventData(level || "info", {
        message,
        environment,
        release,
        serverName,
        loggerName,
        globalTags,
        globalExtra,
        breadcrumbs: breadcrumbsValues,
      });
      breadcrumbsValues = { values: [] };

      if (extra) event.extra = { ...event.extra, ...extra };
      if (beforeSend) {
        var filtered = beforeSend(event);
        if (!filtered) return "";
        event = filtered;
      }
      sendToSentry(dsn, event, timeoutMs).catch(function() {});
      return event.event_id;
    },

    addBreadcrumb: addBreadcrumbLocal,

    get enabled(): boolean {
      return !disabled;
    },
  };

  // Store client reference for getSentryClient()
  (globalThis as any).__ASIJS_SENTRY_CLIENT = client;

  return createPlugin({
    name: "sentry",
    version: "1.0.0",

    // Error handling via middleware
    middleware: [
      function sentryMiddleware(ctx: Context, next: () => Promise<Response>): Promise<Response> {
        addBreadcrumbLocal({
          type: "request",
          category: "http",
          message: ctx.method + " " + ctx.path,
          level: "info",
          data: {
            method: ctx.method,
            path: ctx.path,
            query: ctx.url.searchParams.toString(),
          },
        });

        return next().catch(function(error: Error) {
          // Capture in Sentry
          client.captureException(error, {
            request_url: ctx.request.url,
            request_method: ctx.method,
            request_path: ctx.path,
          });
          throw error;
        });
      },
    ],

    setup: function(app: any) {
      // Register error handler via Asi instance
      // Note: app here is PluginHost; errors are caught by middleware instead
      if (typeof app.onError === "function") {
        app.onError(function(ctx: Context, error: unknown) {
          if (error instanceof Error) {
            client.captureException(error, {
              request_url: ctx.request.url,
              request_method: ctx.method,
              request_path: ctx.path,
            });
          }
        });
      }

      // Capture uncaught exceptions
      if (captureUncaught && !disabled) {
        process.on("uncaughtException", function(error: Error) {
          client.captureException(error, {
            source: "uncaughtException",
          });
          console.error("[Sentry] Uncaught exception captured:", error.message);
        });
      }

      // Capture unhandled promise rejections
      if (captureUnhandled && !disabled) {
        process.on("unhandledRejection", function(reason: unknown) {
          var error =
            reason instanceof Error
              ? reason
              : new Error(String(reason));
          client.captureException(error, {
            source: "unhandledRejection",
          });
        });
      }
    },
  });
}

/**
 * Get the Sentry client for manual error capture.
 *
 * @example
 * ```ts
 * const sentry = getSentryClient();
 * sentry.captureException(new Error("Manual capture"));
 * sentry.captureMessage("Deployment started", "info");
 * ```
 */
export function getSentryClient(): ReturnType<typeof createSentryClient> {
  // Return the plugin's client if available
  var existing = (globalThis as any).__ASIJS_SENTRY_CLIENT;
  if (existing) return existing;
  return createSentryClient();
}

/**
 * Create a standalone Sentry client (without the plugin).
 *
 * Useful when you want to use Sentry without the AsiJS plugin system.
 *
 * @example
 * ```ts
 * const sentry = createSentryClient({
 *   dsn: process.env.SENTRY_DSN,
 * });
 * sentry.captureException(error);
 * ```
 */
export function createSentryClient(options?: {
  dsn?: string;
  environment?: string;
  release?: string;
  timeoutMs?: number;
}): {
  captureException: (error: Error, extra?: Record<string, unknown>) => string;
  captureMessage: (message: string, level?: string, extra?: Record<string, unknown>) => string;
  enabled: boolean;
} {
  var dsn = options?.dsn || process.env.SENTRY_DSN || "";
  var disabled = !dsn;
  var env = options?.environment || process.env.NODE_ENV || "development";
  var release = options?.release || process.env.SENTRY_RELEASE || "";
  var timeout = options?.timeoutMs ?? 5000;
  var serverName = process.env.HOSTNAME || "unknown";

  return {
    captureException: function(error: Error, extra?: Record<string, unknown>) {
      if (disabled) return "";
      var event = buildEventData("error", {
        error,
        environment: env,
        release,
        serverName,
      });
      if (extra) event.extra = { ...event.extra, ...extra };
      sendToSentry(dsn, event, timeout).catch(function() {});
      return event.event_id;
    },
    captureMessage: function(message: string, level?: string, extra?: Record<string, unknown>) {
      if (disabled) return "";
      var event = buildEventData(level || "info", {
        message,
        environment: env,
        release,
        serverName,
      });
      if (extra) event.extra = { ...event.extra, ...extra };
      sendToSentry(dsn, event, timeout).catch(function() {});
      return event.event_id;
    },
    get enabled() { return !disabled; },
  };
}
