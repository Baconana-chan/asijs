/**
 * OTel Logs Integration — OpenTelemetry Logs SDK for AsiJS
 *
 * Bridges the AsiJS structured logger with OTel Logs SDK.
 * Log entries emitted via the structured logger are also sent
 * to the OTel log pipeline (console, OTLP gRPC/HTTP).
 *
 * @example
 * ```ts
 * import { otelPlugin, logsManager } from "@asijs/opentelemetry";
 *
 * // Via plugin
 * app.plugin(otelPlugin({
 *   logs: {
 *     exporters: ["otlp-http"],
 *     minimumSeverity: "INFO",
 *   },
 * }));
 *
 * // Standalone
 * await logsManager.configure({
 *   exporters: ["console"],
 * });
 *
 * // Emit a log
 * logsManager.emit("Request processed", {
 *   severityNumber: 9, // INFO
 *   attributes: { method: "GET", path: "/users" },
 * });
 * ```
 */

import type { LogsConfig } from "./types";
import { tracerManager } from "./tracer";

// ========================================================================
// Severity mapping
// ========================================================================

/** OTel SeverityNumber constants */
export const SeverityNumber = {
  UNSPECIFIED: 0,
  TRACE: 1,
  TRACE2: 2,
  TRACE3: 3,
  TRACE4: 4,
  DEBUG: 5,
  DEBUG2: 6,
  DEBUG3: 7,
  DEBUG4: 8,
  INFO: 9,
  INFO2: 10,
  INFO3: 11,
  INFO4: 12,
  WARN: 13,
  WARN2: 14,
  WARN3: 15,
  WARN4: 16,
  ERROR: 17,
  ERROR2: 18,
  ERROR3: 19,
  ERROR4: 20,
  FATAL: 21,
} as const;

/** Map log level strings to OTel severity numbers */
const LEVEL_TO_SEVERITY: Record<string, number> = {
  trace: SeverityNumber.TRACE,
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  warning: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
  fatal: SeverityNumber.FATAL,
};

/** Map OTel severity numbers to string levels */
const SEVERITY_TO_LEVEL: Record<number, string> = {
  [SeverityNumber.TRACE]: "TRACE",
  [SeverityNumber.DEBUG]: "DEBUG",
  [SeverityNumber.INFO]: "INFO",
  [SeverityNumber.WARN]: "WARN",
  [SeverityNumber.ERROR]: "ERROR",
  [SeverityNumber.FATAL]: "FATAL",
};

/** Get the minimum severity number from a string level */
function getMinSeverity(level: string): number {
  return LEVEL_TO_SEVERITY[level.toLowerCase()] ?? SeverityNumber.INFO;
}

// ========================================================================
// Logs Manager
// ========================================================================

class LogsManager {
  private _initialized = false;
  private _shutdown = false;
  private _loggerProvider: any = null;
  private _logger: any = null;
  private _processors: any[] = [];
  private _minSeverity: number = SeverityNumber.INFO;

  get isInitialized(): boolean {
    return this._initialized;
  }

  /** Get the OTel LoggerProvider instance */
  getProvider(): any {
    return this._loggerProvider;
  }

  /** Get the OTel Logger instance */
  getLogger(): any {
    return this._logger;
  }

  /**
   * Configure and initialize the logs SDK.
   */
  async configure(config: LogsConfig = {}): Promise<void> {
    if (this._initialized) return;

    const {
      exporters = ["console"],
      minimumSeverity = "INFO",
    } = config;

    this._minSeverity = getMinSeverity(minimumSeverity);

    // Lazy-load OTel Logs SDK
    let logsSDK: any;
    let apiLogs: any;
    try {
      logsSDK = await import("@opentelemetry/sdk-logs");
      apiLogs = await import("@opentelemetry/api-logs");
    } catch {
      console.warn(
        "[@asijs/opentelemetry] @opentelemetry/sdk-logs or @opentelemetry/api-logs not found — logs disabled",
      );
      return;
    }

    const processors: any[] = [];

    for (const exporterType of exporters) {
      const exporter = await this._createLogExporter(exporterType, config);
      if (exporter) {
        const processor = new logsSDK.BatchLogRecordProcessor({
          exporter,
          scheduledDelayMillis: 1000,
        });
        processors.push(processor);
      }
    }

    // Create LoggerProvider
    const loggerProvider = new logsSDK.LoggerProvider({
      processors,
    });

    // Register as global logger provider
    apiLogs.logs.setGlobalLoggerProvider(loggerProvider);

    // Get logger for this service
    this._logger = loggerProvider.getLogger(
      "asijs",
      "1.0.0",
    );

    this._loggerProvider = loggerProvider;
    this._processors = processors;
    this._initialized = true;
  }

  /**
   * Emit a log record.
   *
   * @param body - The log message body
   * @param options - Additional log options
   *
   * @example
   * ```ts
   * logsManager.emit("User created", {
   *   severityNumber: 9, // INFO
   *   attributes: { userId: "123" },
   * });
   * ```
   */
  emit(
    body: string,
    options?: {
      severityNumber?: number;
      severityText?: string;
      attributes?: Record<string, unknown>;
      traceId?: string;
      spanId?: string;
    },
  ): void {
    if (!this._logger) return;

    const severityNumber = options?.severityNumber ?? SeverityNumber.INFO;

    // Filter by minimum severity
    if (severityNumber < this._minSeverity) return;

    const severityText =
      options?.severityText ??
      SEVERITY_TO_LEVEL[severityNumber] ??
      "INFO";

    // Get trace context from current OTel context if not provided
    let traceId = options?.traceId;
    let spanId = options?.spanId;

    if (!traceId || !spanId) {
      const api = tracerManager.getOTelAPI();
      if (api) {
        const currentSpan = api.trace.getSpan(api.context.active());
        if (currentSpan) {
          const spanContext = currentSpan.spanContext();
          traceId = traceId ?? spanContext.traceId;
          spanId = spanId ?? spanContext.spanId;
        }
      }
    }

    const logRecord: any = {
      body,
      severityNumber,
      severityText,
      attributes: options?.attributes ?? {},
    };

    if (traceId) logRecord.traceId = traceId;
    if (spanId) logRecord.spanId = spanId;

    this._logger.emit(logRecord);

    // Also emit to console if configured as a fallback
    if (severityNumber >= SeverityNumber.WARN) {
      // Let higher severity entries through to console even if not the primary exporter
    }
  }

  /**
   * Log at INFO level.
   */
  info(message: string, attributes?: Record<string, unknown>): void {
    this.emit(message, { severityNumber: SeverityNumber.INFO, attributes });
  }

  /**
   * Log at WARN level.
   */
  warn(message: string, attributes?: Record<string, unknown>): void {
    this.emit(message, { severityNumber: SeverityNumber.WARN, attributes });
  }

  /**
   * Log at ERROR level.
   */
  error(message: string, attributes?: Record<string, unknown>): void {
    this.emit(message, { severityNumber: SeverityNumber.ERROR, attributes });
  }

  /**
   * Log at DEBUG level.
   */
  debug(message: string, attributes?: Record<string, unknown>): void {
    this.emit(message, { severityNumber: SeverityNumber.DEBUG, attributes });
  }

  /**
   * Log at TRACE level.
   */
  trace(message: string, attributes?: Record<string, unknown>): void {
    this.emit(message, { severityNumber: SeverityNumber.TRACE, attributes });
  }

  /**
   * Create a structured logger middleware that emits log records
   * for each request via OTel Logs SDK.
   */
  createRequestLoggerMiddleware(): (ctx: any, next: () => Promise<Response>) => Promise<Response> {
    return async (ctx: any, next: () => Promise<Response>) => {
      const startTime = performance.now();

      try {
        const response = await next();
        const duration = performance.now() - startTime;

        this.emit("HTTP Request", {
          severityNumber: response.status >= 500
            ? SeverityNumber.ERROR
            : response.status >= 400
              ? SeverityNumber.WARN
              : SeverityNumber.INFO,
          attributes: {
            "http.method": ctx.method,
            "http.path": ctx.path,
            "http.status": response.status,
            "http.duration_ms": Math.round(duration * 100) / 100,
            "http.host": ctx.request.headers.get("host") ?? "",
          },
        });

        return response;
      } catch (error) {
        const duration = performance.now() - startTime;

        this.emit("HTTP Request Error", {
          severityNumber: SeverityNumber.ERROR,
          attributes: {
            "http.method": ctx.method,
            "http.path": ctx.path,
            "http.duration_ms": Math.round(duration * 100) / 100,
            "error": error instanceof Error ? error.message : String(error),
          },
        });

        throw error;
      }
    };
  }

  /**
   * Gracefully shut down, flushing all pending log records.
   */
  async shutdown(): Promise<void> {
    if (!this._initialized || this._shutdown) return;
    this._shutdown = true;

    if (this._loggerProvider?.shutdown) {
      await this._loggerProvider.shutdown();
    }

    this._loggerProvider = null;
    this._logger = null;
    this._processors = [];
    this._initialized = false;
  }

  // ========================================================================
  // Private helpers
  // ========================================================================

  private async _createLogExporter(
    type: string,
    config: LogsConfig,
  ): Promise<any | null> {
    try {
      switch (type) {
        case "console": {
          let logsSDK: any;
          try {
            logsSDK = await import("@opentelemetry/sdk-logs");
          } catch {
            return null;
          }
          return new logsSDK.ConsoleLogRecordExporter();
        }

        case "otlp-grpc": {
          const mod = await import("@opentelemetry/exporter-logs-otlp-grpc")
            .catch(() => null);
          if (!mod) {
            console.warn(
              "[@asijs/opentelemetry] @opentelemetry/exporter-logs-otlp-grpc not available",
            );
            return null;
          }
          return new mod.OTLPLogExporter({
            url: config.otlpGrpcEndpoint ?? "http://localhost:4317",
            headers: config.exporterHeaders,
          });
        }

        case "otlp-http": {
          const mod = await import("@opentelemetry/exporter-logs-otlp-http")
            .catch(() => null);
          if (!mod) {
            console.warn(
              "[@asijs/opentelemetry] @opentelemetry/exporter-logs-otlp-http not available",
            );
            return null;
          }
          return new mod.OTLPLogExporter({
            url: config.otlpHttpEndpoint ?? "http://localhost:4318/v1/logs",
            headers: config.exporterHeaders,
          });
        }

        default:
          console.warn(
            `[@asijs/opentelemetry] Unknown log exporter: ${type}`,
          );
          return null;
      }
    } catch (error) {
      console.warn(
        `[@asijs/opentelemetry] Failed to load log exporter "${type}":`,
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }
}

/**
 * Singleton logs manager instance.
 */
export const logsManager = new LogsManager();

/**
 * Initialize OpenTelemetry logs with the given configuration.
 */
export async function initLogs(config?: LogsConfig): Promise<void> {
  await logsManager.configure(config);
}

/**
 * Emit a log record via the OTel Logs SDK.
 * Shortcut for `logsManager.emit(...)`.
 */
export function log(
  body: string,
  options?: {
    severityNumber?: number;
    severityText?: string;
    attributes?: Record<string, unknown>;
  },
): void {
  logsManager.emit(body, options);
}
