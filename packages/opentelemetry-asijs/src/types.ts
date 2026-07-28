/**
 * Type definitions for asijs-opentelemetry
 *
 * These types wrap and extend OpenTelemetry SDK types for use in AsiJS.
 * Actual OTel SDK types are re-exported when the optional peer deps are installed.
 * Here we define the configuration interfaces that drive the package.
 */

import type { Context } from "asijs";

// ========================================================================
// Tracer configuration
// ========================================================================

/** Which trace exporter backend to use */
export type TraceExporterType =
  | "otlp-grpc"
  | "otlp-http"
  | "jaeger"
  | "zipkin"
  | "console";

/** Span processor type */
export type SpanProcessorType = "batch" | "simple";

/** Tracer configuration */
export interface TracerConfig {
  /** Service name (default: "asijs-app") */
  serviceName?: string;
  /** Service version (default: "1.0.0") */
  serviceVersion?: string;
  /** Service instance ID (default: auto-generated) */
  serviceInstanceId?: string;
  /** Trace exporter(s) to use (default: ["console"]) */
  exporters?: TraceExporterType[];
  /** OTLP gRPC endpoint (default: "http://localhost:4317") */
  otlpGrpcEndpoint?: string;
  /** OTLP HTTP endpoint (default: "http://localhost:4318/v1/traces") */
  otlpHttpEndpoint?: string;
  /** Jaeger endpoint (default: "http://localhost:14268/api/traces") */
  jaegerEndpoint?: string;
  /** Zipkin endpoint (default: "http://localhost:9411/api/v2/spans") */
  zipkinEndpoint?: string;
  /** Custom headers for OTLP exporters */
  exporterHeaders?: Record<string, string>;
  /** Span processor type (default: "batch") */
  spanProcessor?: SpanProcessorType;
  /** Batch processor config */
  batchConfig?: {
    maxExportBatchSize?: number;
    scheduledDelayMillis?: number;
    exportTimeoutMillis?: number;
  };
  /** Sampling ratio (0.0 to 1.0, default: 1.0) */
  samplingRatio?: number;
  /** Whether to enable W3C TraceContext propagation (default: true) */
  propagateTraceContext?: boolean;
  /** Whether to enable baggage propagation (default: true) */
  propagateBaggage?: boolean;
}

// ========================================================================
// Instrumentation configuration
// ========================================================================

/** Which spans to create automatically */
export interface InstrumentationSpans {
  /** Create a span for every HTTP request (default: true) */
  request?: boolean;
  /** Create a span for each handler execution (default: true) */
  handler?: boolean;
  /** Create spans for DB queries (default: false — opt-in) */
  database?: boolean;
  /** Create spans for external HTTP client calls (default: false — opt-in) */
  httpClient?: boolean;
  /** Create spans for middleware execution (default: false — opt-in) */
  middleware?: boolean;
}

/** Additional attributes to attach to every span */
export interface InstrumentationAttributes {
  /** Map of static key→value attributes */
  static?: Record<string, string>;
  /**
   * Dynamic attribute extractor — called on every request.
   * Return a record of attributes to add to the request span.
   */
  dynamic?: (ctx: Context) => Record<string, string>;
}

/** Instrumentation configuration */
export interface InstrumentConfig {
  /** Which spans to create (default: request + handler) */
  spans?: InstrumentationSpans;
  /** Additional attributes */
  attributes?: InstrumentationAttributes;
  /** Paths to skip instrumentation for */
  skipPaths?: string[];
  /** Custom skip function */
  skip?: (ctx: Context) => boolean;
}

// ========================================================================
// Metrics configuration
// ========================================================================

/** Which metric exporter backend to use */
export type MetricsExporterType =
  | "otlp-grpc"
  | "otlp-http"
  | "console"
  | "prometheus";

/** Metrics configuration */
export interface MetricsConfig {
  /** Metric exporter(s) (default: ["console"]) */
  exporters?: MetricsExporterType[];
  /** OTLP gRPC endpoint (default: "http://localhost:4317") */
  otlpGrpcEndpoint?: string;
  /** OTLP HTTP endpoint (default: "http://localhost:4318/v1/metrics") */
  otlpHttpEndpoint?: string;
  /** Prometheus endpoint path (default: "/metrics") */
  prometheusPath?: string;
  /** Custom headers for OTLP exporters */
  exporterHeaders?: Record<string, string>;
  /** Export interval in milliseconds (default: 15_000) */
  exportIntervalMs?: number;
  /** Custom metric prefix (default: "http") */
  prefix?: string;
}

// ========================================================================
// Logs configuration
// ========================================================================

/** Which log exporter backend to use */
export type LogsExporterType =
  | "otlp-grpc"
  | "otlp-http"
  | "console";

/** Logs configuration */
export interface LogsConfig {
  /** Log exporter(s) (default: ["console"]) */
  exporters?: LogsExporterType[];
  /** OTLP gRPC endpoint (default: "http://localhost:4317") */
  otlpGrpcEndpoint?: string;
  /** OTLP HTTP endpoint (default: "http://localhost:4318/v1/logs") */
  otlpHttpEndpoint?: string;
  /** Custom headers for OTLP exporters */
  exporterHeaders?: Record<string, string>;
  /** Minimum severity to export (default: "INFO") */
  minimumSeverity?: "DEBUG" | "INFO" | "WARN" | "ERROR";
}

// ========================================================================
// Top-level options
// ========================================================================

/** Complete options for the OpenTelemetry plugin */
export interface OpenTelemetryOptions {
  /** Tracer configuration */
  tracer?: TracerConfig;
  /** Instrumentation configuration */
  instrument?: InstrumentConfig;
  /** Metrics configuration (default: enabled with console exporter) */
  metrics?: MetricsConfig | false;
  /** Logs configuration (default: enabled with console exporter) */
  logs?: LogsConfig | false;
}

// ========================================================================
// Hook callbacks
// ========================================================================

/** Hook functions called by the instrumentation middleware */
export interface InstrumentationHooks {
  /** Called when a request span starts */
  onRequestSpanStart?: (span: unknown, ctx: Context) => void;
  /** Called when a request span ends */
  onRequestSpanEnd?: (span: unknown, ctx: Context, duration: number) => void;
  /** Called on error */
  onError?: (span: unknown, ctx: Context, error: unknown) => void;
}

// ========================================================================
// Re-exports from OTel API (lazy-loaded)
// ========================================================================

/** Lazy-loaded OTel API module shape */
export interface OTelAPI {
  trace: typeof import("@opentelemetry/api").trace;
  context: typeof import("@opentelemetry/api").context;
  propagation: typeof import("@opentelemetry/api").propagation;
  SpanStatusCode: typeof import("@opentelemetry/api").SpanStatusCode;
  Span: import("@opentelemetry/api").Span;
  ROOT_CONTEXT: typeof import("@opentelemetry/api").ROOT_CONTEXT;
}

/** Lazy-loaded OTel SDK modules */
export interface OTelSDKModules {
  BasicTracerProvider?: typeof import("@opentelemetry/sdk-trace-base").BasicTracerProvider;
  BatchSpanProcessor?: typeof import("@opentelemetry/sdk-trace-base").BatchSpanProcessor;
  SimpleSpanProcessor?: typeof import("@opentelemetry/sdk-trace-base").SimpleSpanProcessor;
  ConsoleSpanExporter?: typeof import("@opentelemetry/sdk-trace-base").ConsoleSpanExporter;
  MeterProvider?: typeof import("@opentelemetry/sdk-metrics").MeterProvider;
  PeriodicExportingMetricReader?: typeof import("@opentelemetry/sdk-metrics").PeriodicExportingMetricReader;
  ConsoleMetricExporter?: typeof import("@opentelemetry/sdk-metrics").ConsoleMetricExporter;
  LoggerProvider?: typeof import("@opentelemetry/sdk-logs").LoggerProvider;
  SimpleLogRecordProcessor?: typeof import("@opentelemetry/sdk-logs").SimpleLogRecordProcessor;
  BatchLogRecordProcessor?: typeof import("@opentelemetry/sdk-logs").BatchLogRecordProcessor;
  ConsoleLogRecordExporter?: typeof import("@opentelemetry/sdk-logs").ConsoleLogRecordExporter;
}
