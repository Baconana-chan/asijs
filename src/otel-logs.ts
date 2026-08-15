/**
 * Structured Logging v2 — OpenTelemetry Logs Bridge
 *
 * Converts AsiJS `StructuredLogEntry` records into OpenTelemetry LogRecord
 * JSON (OTLP/HTTP) with semantic conventions, and ships them to an OTLP
 * collector (Grafana Loki, SigNoz, Honeycomb, Jaeger, etc.).
 *
 * @example
 * ```ts
 * import { Asi, structuredLogger } from "asijs";
 *
 * app.plugin(structuredLogger({
 *   otlp: {
 *     endpoint: "http://localhost:4318/v1/logs",
 *     serviceName: "my-api",
 *   },
 * }));
 * ```
 */

import type { StructuredLogEntry, LogLevel } from "./structured-logger";
import type { AsiPlugin } from "./plugin";
import { createPlugin } from "./plugin";
import { createStructuredLogger } from "./structured-logger";

// ============================================================================
// Types
// ============================================================================

/** OTLP logs exporter options */
export interface OTLPLogsOptions {
  /** OTLP HTTP endpoint (e.g. "http://localhost:4318/v1/logs") */
  endpoint: string;
  /** Optional Authorization header value */
  authHeader?: string;
  /** Custom headers sent with each export */
  headers?: Record<string, string>;
  /** Service name for the OTLP resource (default: "asijs-app") */
  serviceName?: string;
  /** Service instance ID */
  serviceInstanceId?: string;
  /** Buffer max entries before flushing (default: 100) */
  bufferSize?: number;
  /** Flush interval in ms (default: 5_000) */
  flushIntervalMs?: number;
}

/** Result of an OTLP log export */
export interface OTLPLogsExportResult {
  success: boolean;
  status?: number;
  error?: string;
  exported: number;
}

/** A log record with OTLP attributes — the payload unit */
export interface OTLPLogRecord {
  timeUnixNano: string;
  observedTimeUnixNano: string;
  severityNumber: number;
  severityText: string;
  body: { stringValue: string };
  attributes: Array<{
    key: string;
    value: { stringValue: string };
  }>;
}

// ============================================================================
// Severity mapping (OTel semantic conventions)
// ============================================================================

/** Map AsiJS log levels to OTel severity numbers */
export function levelToSeverityNumber(level: LogLevel): number {
  switch (level) {
    case "debug":
      return 5; // DEBUG
    case "info":
      return 9; // INFO
    case "warn":
      return 13; // WARN
    case "error":
      return 17; // ERROR
    default:
      return 9;
  }
}

/** Map AsiJS log levels to OTel severity text */
export function levelToSeverityText(level: LogLevel): string {
  return level.toUpperCase();
}

// ============================================================================
// Record conversion (semantic conventions)
// ============================================================================

/** Convert a StructuredLogEntry to an OTLP LogRecord */
export function entryToOTLPLogRecord(
  entry: StructuredLogEntry,
  serviceName = "asijs-app",
  serviceInstanceId?: string,
): OTLPLogRecord {
  const nowNs = Number(BigInt(Date.now()) * BigInt(1_000_000));

  const attr = (key: string, value: unknown): Array<{ key: string; value: { stringValue: string } }> =>
    value === undefined || value === null
      ? []
      : [{ key, value: { stringValue: typeof value === "object" ? JSON.stringify(value) : String(value) } }];

  const attributes = [
    // OTel semantic conventions — resource
    ...attr("service.name", serviceName),
    ...attr("service.instance.id", serviceInstanceId),
    ...attr("service.version", entry.version),
    // OTel semantic conventions — HTTP
    ...attr("http.request.method", entry.method),
    ...attr("url.path", entry.path),
    ...attr("http.response.status_code", entry.status),
    ...attr("http.request.duration.ms", entry.durationMs),
    ...attr("client.address", entry.ip),
    ...attr("user_agent.original", entry.userAgent),
    // Request correlation
    ...attr("http.request.id", entry.requestId),
    ...attr("net.host.name", entry.hostname),
    ...attr("process.pid", entry.pid),
    ...attr("deployment.environment", entry.environment),
    // Error attributes
    ...attr("error.message", entry.error),
    ...attr("error.type", entry.errorType),
    ...attr("exception.stacktrace", entry.stackTrace),
    // Event name
    ...attr("event.name", entry.event),
  ];

  // Merge any custom fields not covered by conventions
  const KNOWN = new Set([
    "timestamp", "level", "service", "environment", "event",
    "method", "path", "status", "durationMs", "requestId", "ip",
    "userAgent", "contentLength", "referer", "error", "errorType",
    "stackTrace", "version", "hostname", "pid",
  ]);
  for (const [key, value] of Object.entries(entry)) {
    if (!KNOWN.has(key)) {
      attributes.push(...attr(`app.${key}`, value));
    }
  }

  return {
    timeUnixNano: String(nowNs),
    observedTimeUnixNano: String(nowNs),
    severityNumber: levelToSeverityNumber(entry.level),
    severityText: levelToSeverityText(entry.level),
    body: { stringValue: entry.event },
    attributes,
  };
}

// ============================================================================
// OTLP Logs Exporter
// ============================================================================

/**
 * Exporter that buffers StructuredLogEntry records and pushes them to an
 * OTLP/HTTP logs collector (POST {endpoint}).
 */
export class OTLPLogsExporter {
  readonly options: Required<OTLPLogsOptions>;
  private buffer: OTLPLogRecord[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;

  constructor(options: OTLPLogsOptions) {
    this.options = {
      endpoint: options.endpoint.replace(/\/+$/, ""),
      authHeader: options.authHeader ?? "",
      headers: options.headers ?? {},
      serviceName: options.serviceName ?? "asijs-app",
      serviceInstanceId: options.serviceInstanceId ?? crypto.randomUUID(),
      bufferSize: options.bufferSize ?? 100,
      flushIntervalMs: options.flushIntervalMs ?? 5_000,
    };
  }

  /** Record an entry into the buffer (flushes when full) */
  record(entry: StructuredLogEntry): void {
    this.buffer.push(entryToOTLPLogRecord(entry, this.options.serviceName, this.options.serviceInstanceId));
    if (this.buffer.length >= this.options.bufferSize) {
      void this.flush();
    }
  }

  /** Number of buffered records */
  get buffered(): number {
    return this.buffer.length;
  }

  /** Start the periodic flush timer */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.flush();
    }, this.options.flushIntervalMs);
    if (typeof this.timer === "object" && "unref" in this.timer) {
      (this.timer as unknown as { unref(): void }).unref();
    }
  }

  /** Stop the flush timer */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Flush buffered records to the collector */
  async flush(): Promise<OTLPLogsExportResult> {
    if (this.flushing) return { success: true, exported: 0 };
    if (this.buffer.length === 0) return { success: true, exported: 0 };

    this.flushing = true;
    const records = this.buffer;
    this.buffer = [];

    try {
      const response = await fetch(this.options.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.options.authHeader
            ? { Authorization: this.options.authHeader }
            : {}),
          ...this.options.headers,
        },
        body: JSON.stringify({
          resourceLogs: [
            {
              resource: {
                attributes: [
                  { key: "service.name", value: { stringValue: this.options.serviceName } },
                  { key: "service.instance.id", value: { stringValue: this.options.serviceInstanceId } },
                ],
              },
              scopeLogs: [
                {
                  scope: { name: "asijs" },
                  logRecords: records,
                },
              ],
            },
          ],
        }),
      });

      if (!response.ok) {
        return {
          success: false,
          status: response.status,
          error: `OTLP logs export failed: ${response.status} ${await response.text().catch(() => "")}`,
          exported: records.length,
        };
      }
      return { success: true, status: response.status, exported: records.length };
    } catch (error) {
      return {
        success: false,
        error: `OTLP logs export error: ${error instanceof Error ? error.message : String(error)}`,
        exported: records.length,
      };
    } finally {
      this.flushing = false;
    }
  }
}

// ============================================================================
// Plugin
// ============================================================================

/** Options for the structuredLogger OTel bridge plugin */
export interface OTelLogsPluginOptions {
  /** OTLP logs endpoint configuration */
  otlp: OTLPLogsOptions;
  /** Structured logger base options (service, environment, exclude, ...) */
  logger?: Parameters<typeof createStructuredLogger>[0];
}

/**
 * Structured logging v2 — structured logger with an OTel Logs Bridge.
 *
 * Wires the structured logger's `logHandler` to an {@link OTLPLogsExporter},
 * so every log entry is also shipped to an OTLP collector with semantic
 * conventions.
 *
 * @example
 * ```ts
 * app.plugin(otelLogs({
 *   otlp: { endpoint: "http://localhost:4318/v1/logs", serviceName: "api" },
 * }));
 * ```
 */
export function otelLogs(options: OTelLogsPluginOptions): AsiPlugin {
  const exporter = new OTLPLogsExporter(options.otlp);
  exporter.start();

  const logger = createStructuredLogger({
    service: options.logger?.service ?? options.otlp.serviceName ?? "asijs-app",
    ...options.logger,
    logHandler: (entry) => {
      // Always forward to the bridge
      exporter.record(entry);
      // Keep console output unless explicitly silenced
      if (options.logger?.logHandler) {
        options.logger.logHandler(entry);
      } else if (entry.level === "error") {
        console.error(JSON.stringify(entry));
      } else {
        console.log(JSON.stringify(entry));
      }
    },
  });

  return createPlugin({
    name: "otelLogs",
    version: "1.0.0",
    setup(app) {
      app.setState("logger", logger);
      app.setState("otelLogsExporter", exporter);
    },
    decorate: {
      log: (ctx: unknown) => logger,
    },
  });
}

/** Convenience — create a logger + OTLP exporter pair without a plugin */
export function createOTelLogger(options: OTLPLogsOptions) {
  const exporter = new OTLPLogsExporter(options);
  exporter.start();
  const logger = createStructuredLogger({
    service: options.serviceName,
    logHandler: (entry) => exporter.record(entry),
  });
  return { logger, exporter };
}
