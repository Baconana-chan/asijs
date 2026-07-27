/**
 * @asijs/opentelemetry — OpenTelemetry SDK Integration for AsiJS
 *
 * Automatic instrumentation, traces, metrics, and logs via the
 * OpenTelemetry JavaScript SDK. All OTel dependencies are optional
 * peer dependencies — the package works gracefully without them.
 *
 * # Quick Start
 *
 * ```ts
 * import { Asi } from "asijs";
 * import { otelPlugin } from "@asijs/opentelemetry";
 *
 * const app = new Asi();
 *
 * app.plugin(otelPlugin({
 *   tracer: {
 *     serviceName: "my-api",
 *     exporters: ["console"],   // or "otlp-http", "jaeger", "zipkin"
 *   },
 *   metrics: {
 *     exporters: ["console"],
 *   },
 *   logs: {
 *     exporters: ["console"],
 *   },
 *   instrument: {
 *     spans: {
 *       request: true,
 *       handler: true,
 *     },
 *     skipPaths: ["/health", "/metrics"],
 *   },
 * }));
 * ```
 *
 * # Standalone (without the plugin)
 *
 * ```ts
 * import { initTracing, initMetrics, tracerManager } from "@asijs/opentelemetry";
 *
 * await initTracing({
 *   serviceName: "my-service",
 *   exporters: ["otlp-http"],
 * });
 *
 * // Create custom spans
 * await tracerManager.withSpan("my-span", async (span) => {
 *   span.setAttribute("key", "value");
 *   // ... your code
 * });
 * ```
 */

// ========================================================================
// Tracer — Span creation, context propagation, exporters
// ========================================================================

export {
  tracerManager,
  initTracing,
  getTraceHeaders,
  extractTraceContext,
} from "./tracer";

// ========================================================================
// Instrumentation — Auto-instrumentation middleware
// ========================================================================

export {
  otelInstrumentationMiddleware,
  instrumentHandler,
  instrumentQuery,
  instrumentFetch,
} from "./instrument";

// ========================================================================
// Metrics — OTel Metrics SDK (counter, histogram, gauge)
// ========================================================================

export {
  metricsManager,
  initMetrics,
} from "./metrics";

// ========================================================================
// Logs — OTel Logs SDK
// ========================================================================

export {
  logsManager,
  initLogs,
  log,
  SeverityNumber,
} from "./logs";

// ========================================================================
// Plugin — All-in-one `app.plugin(otelPlugin(...))`
// ========================================================================

export { otelPlugin } from "./plugin";

// ========================================================================
// Types
// ========================================================================

export type {
  OpenTelemetryOptions,
  TracerConfig,
  TraceExporterType,
  SpanProcessorType,
  InstrumentConfig,
  InstrumentationSpans,
  InstrumentationAttributes,
  MetricsConfig,
  MetricsExporterType,
  LogsConfig,
  LogsExporterType,
  InstrumentationHooks,
} from "./types";
