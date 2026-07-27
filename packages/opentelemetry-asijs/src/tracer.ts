/**
 * Tracer Manager — OpenTelemetry Tracer Provider & Exporters
 *
 * Manages the lifecycle of the OTel TracerProvider, span processors,
 * exporters (OTLP gRPC/HTTP, Jaeger, Zipkin, Console), and W3C
 * TraceContext / Baggage propagation.
 *
 * All OTel SDK dependencies are lazy-loaded so the package can be
 * installed without necessarily having every exporter available.
 *
 * @example
 * ```ts
 * import { tracerManager } from "@asijs/opentelemetry";
 *
 * await tracerManager.configure({
 *   serviceName: "my-api",
 *   exporters: ["otlp-http", "console"],
 *   otlpHttpEndpoint: "http://otel-collector:4318/v1/traces",
 *   samplingRatio: 0.1,
 * });
 * ```
 */

import type {
  TracerConfig,
  SpanProcessorType,
  OTelAPI,
  OTelSDKModules,
} from "./types";

// ========================================================================
// Tracer Manager
// ========================================================================

class TracerManager {
  private _initialized = false;
  private _shutdown = false;
  private _otelApi: OTelAPI | null = null;
  private _sdkModules: OTelSDKModules | null = null;
  private _tracerProvider: any = null;
  private _config: TracerConfig = {};

  /**
   * Whether the tracer has been initialized.
   */
  get isInitialized(): boolean {
    return this._initialized;
  }

  /**
   * Whether the tracer has been shut down.
   */
  get isShutdown(): boolean {
    return this._shutdown;
  }

  /**
   * Get the current tracer config.
   */
  getConfig(): TracerConfig {
    return { ...this._config };
  }

  /**
   * Get the raw OTel TracerProvider instance.
   */
  getProvider(): any {
    return this._tracerProvider;
  }

  /**
   * Get a named tracer instance.
   * Uses the configured service name or a custom name.
   */
  getTracer(name?: string, version?: string): any {
    if (!this._otelApi) return null;
    return this._otelApi.trace.getTracer(
      name ?? this._config.serviceName ?? "asijs-app",
      version ?? this._config.serviceVersion ?? "1.0.0",
    );
  }

  /**
   * Get the OTel API object for manual use.
   */
  getOTelAPI(): OTelAPI | null {
    return this._otelApi;
  }

  /**
   * Configure and initialize the tracer.
   * Must be called before the AsiJS app starts handling requests.
   */
  async configure(config: TracerConfig = {}): Promise<void> {
    if (this._initialized) return;

    this._config = { ...config };

    // Set defaults
    const {
      serviceName = "asijs-app",
      serviceVersion = "1.0.0",
      serviceInstanceId = crypto.randomUUID(),
      exporters = ["console"],
      spanProcessor = "batch",
      samplingRatio = 1.0,
      propagateTraceContext = true,
      propagateBaggage = true,
    } = config;

    // Lazy-load OTel API
    const otelApi = await this._loadOTelAPI();
    if (!otelApi) {
      console.warn(
        "[@asijs/opentelemetry] @opentelemetry/api not found — tracing disabled",
      );
      return;
    }
    this._otelApi = otelApi;

    // Lazy-load SDK modules
    const sdk = await this._loadSDK();
    if (!sdk?.BasicTracerProvider) {
      console.warn(
        "[@asijs/opentelemetry] @opentelemetry/sdk-trace-base not found — tracing disabled",
      );
      return;
    }
    this._sdkModules = sdk;

    // Build span processors from exporters
    const processors = await this._buildProcessors(
      exporters,
      spanProcessor,
      config,
    );

    // Create tracer provider
    const provider = new sdk.BasicTracerProvider({
      spanProcessors: processors,
      sampler: samplingRatio < 1.0
        ? this._createSampler(samplingRatio)
        : undefined,
    });

    // Register as global
    const registerResult = provider.register();
    if (registerResult && typeof registerResult === "object") {
      // Some OTel versions return a disposable
      this._disposeRegistration = registerResult;
    }

    this._tracerProvider = provider;
    this._initialized = true;
  }

  private _disposeRegistration: any = null;

  /**
   * Create a new root span (for manual instrumentation).
   */
  startSpan(name: string, options?: Record<string, unknown>): any {
    if (!this._otelApi || !this._initialized) return null;
    const tracer = this.getTracer();
    if (!tracer) return null;

    return tracer.startSpan(name, options ?? {});
  }

  /**
   * Create a span with the given context as parent.
   */
  startSpanWithParent(
    name: string,
    parentContext: any,
    options?: Record<string, unknown>,
  ): any {
    if (!this._otelApi || !this._initialized) return null;
    const tracer = this.getTracer();
    if (!tracer) return null;

    return tracer.startSpan(name, options ?? {}, parentContext);
  }

  /**
   * Run a function within a new active span.
   * Automatically ends the span and records errors.
   */
  async withSpan<T>(
    name: string,
    fn: (span: any) => Promise<T> | T,
    options?: {
      attributes?: Record<string, unknown>;
      parentContext?: any;
    },
  ): Promise<T> {
    if (!this._otelApi || !this._initialized) {
      return fn(null as any);
    }

    const api = this._otelApi;
    const tracer = this.getTracer()!;

    const parentCtx = options?.parentContext ?? api.context.active();
    const span = tracer.startSpan(
      name,
      { attributes: options?.attributes ?? {} },
      parentCtx,
    );

    const ctx = api.trace.setSpan(parentCtx, span);

    try {
      return await api.context.with(ctx, () => fn(span));
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: api.SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Gracefully shut down the tracer provider, flushing all spans.
   */
  async shutdown(): Promise<void> {
    if (!this._initialized || this._shutdown) return;
    this._shutdown = true;

    if (this._disposeRegistration && typeof this._disposeRegistration.dispose === "function") {
      try { this._disposeRegistration.dispose(); } catch { /* ignore */ }
    }

    if (this._tracerProvider?.shutdown) {
      await this._tracerProvider.shutdown();
    }

    this._tracerProvider = null;
    this._initialized = false;
  }

  // ========================================================================
  // Private helpers
  // ========================================================================

  private async _loadOTelAPI(): Promise<OTelAPI | null> {
    try {
      const api = await import("@opentelemetry/api");
      return {
        trace: api.trace,
        context: api.context,
        propagation: api.propagation,
        SpanStatusCode: api.SpanStatusCode,
        Span: null as any, // type-only
        ROOT_CONTEXT: api.ROOT_CONTEXT,
      };
    } catch {
      return null;
    }
  }

  private async _loadSDK(): Promise<OTelSDKModules | null> {
    const modules: OTelSDKModules = {};

    try {
      const traceBase = await import("@opentelemetry/sdk-trace-base");
      modules.BasicTracerProvider = traceBase.BasicTracerProvider;
      modules.BatchSpanProcessor = traceBase.BatchSpanProcessor;
      modules.SimpleSpanProcessor = traceBase.SimpleSpanProcessor;
      // ConsoleSpanExporter is available in sdk-trace-base starting from certain versions
      if ((traceBase as any).ConsoleSpanExporter) {
        modules.ConsoleSpanExporter = (traceBase as any).ConsoleSpanExporter;
      } else {
        // Fallback: try loading from sdk-trace-web (not ideal but works)
        try {
          const traceWeb = await import("@opentelemetry/sdk-trace-base");
          modules.ConsoleSpanExporter = traceWeb.ConsoleSpanExporter;
        } catch {
          // Console exporter will be created manually
        }
      }
    } catch {
      return null;
    }

    return modules;
  }

  private _createSampler(ratio: number): any {
    // Return a minimal sampler implementation that respects the ratio
    // Compatible with OTel Sampler interface without requiring @opentelemetry/sdk-trace-base
    if (ratio >= 1.0) return undefined;

    return {
      shouldSample(context: any, traceId: string, spanName: string, spanKind: any, attributes: any, links: any[]) {
        const shouldSample = this._hashTraceId(traceId) < ratio;
        return {
          decision: shouldSample ? 1 : 0, // RECORD_AND_SAMPLE or DROP
          attributes: {},
          traceState: context?.getValue?.("traceState") || undefined,
        };
      },
      toString() {
        return `TraceIdRatioBased{${ratio}}`;
      },
      _hashTraceId(traceId: string) {
        let hash = 0;
        for (let i = 0; i < traceId.length; i++) {
          const char = traceId.charCodeAt(i);
          hash = ((hash << 5) - hash) + char;
          hash = hash & hash;
        }
        return (Math.abs(hash) % 10000) / 10000;
      },
    };
  }

  private async _buildProcessors(
    exporters: string[],
    processorType: SpanProcessorType,
    config: TracerConfig,
  ): Promise<any[]> {
    const sdk = this._sdkModules;
    if (!sdk) return [];

    const isBatch = processorType === "batch";
    const Processor = isBatch
      ? sdk.BatchSpanProcessor
      : sdk.SimpleSpanProcessor;

    if (!Processor) return [];

    const batchConfig = isBatch
      ? {
          maxExportBatchSize: config.batchConfig?.maxExportBatchSize ?? 512,
          scheduledDelayMillis: config.batchConfig?.scheduledDelayMillis ?? 5000,
          exportTimeoutMillis: config.batchConfig?.exportTimeoutMillis ?? 30000,
        }
      : undefined;

    const processors: any[] = [];

    for (const exporterType of exporters) {
      const exporter = await this._createExporter(exporterType as any, config);
      if (exporter) {
        processors.push(
          batchConfig
            ? new Processor(exporter, batchConfig)
            : new Processor(exporter),
        );
      }
    }

    return processors;
  }

  private async _createExporter(
    type: string,
    config: TracerConfig,
  ): Promise<any | null> {
    try {
      switch (type) {
        case "console": {
          if (this._sdkModules?.ConsoleSpanExporter) {
            return new this._sdkModules.ConsoleSpanExporter();
          }
          // Create a simple console exporter
          return {
            export(spans: any[], cb: (result: any) => void) {
              for (const span of spans) {
                console.log("[OTel Trace]", JSON.stringify(span, null, 2));
              }
              cb({ code: 0 });
            },
            shutdown() { return Promise.resolve(); },
          };
        }

        case "otlp-grpc": {
          const mod = await import("@opentelemetry/exporter-trace-otlp-grpc");
          const OTLPExporter = mod.OTLPTraceExporter;
          return new OTLPExporter({
            url: config.otlpGrpcEndpoint ?? "http://localhost:4317",
            headers: config.exporterHeaders,
            timeoutMillis: 10000,
          });
        }

        case "otlp-http": {
          const mod = await import("@opentelemetry/exporter-trace-otlp-http");
          const OTLPExporter = mod.OTLPTraceExporter;
          return new OTLPExporter({
            url: config.otlpHttpEndpoint ?? "http://localhost:4318/v1/traces",
            headers: config.exporterHeaders,
            timeoutMillis: 10000,
          });
        }

        case "jaeger": {
          const mod = await import("@opentelemetry/exporter-jaeger");
          const JaegerExporter = mod.JaegerExporter;
          return new JaegerExporter({
            endpoint: config.jaegerEndpoint ?? "http://localhost:14268/api/traces",
            tags: [],
          });
        }

        case "zipkin": {
          const mod = await import("@opentelemetry/exporter-zipkin");
          const ZipkinExporter = mod.ZipkinExporter;
          return new ZipkinExporter({
            url: config.zipkinEndpoint ?? "http://localhost:9411/api/v2/spans",
            headers: config.exporterHeaders,
          });
        }

        default:
          console.warn(
            `[@asijs/opentelemetry] Unknown trace exporter: ${type}`,
          );
          return null;
      }
    } catch (error) {
      console.warn(
        `[@asijs/opentelemetry] Failed to load exporter "${type}":`,
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }
}

/**
 * Singleton tracer manager instance.
 */
export const tracerManager = new TracerManager();

/**
 * Initialize OpenTelemetry tracing with the given configuration.
 * Shortcut for `tracerManager.configure(config)`.
 */
export async function initTracing(config?: TracerConfig): Promise<void> {
  await tracerManager.configure(config);
}

/**
 * Get the OTel-compatible traceparent and tracestate headers
 * from the current active context.
 */
export function getTraceHeaders(): Record<string, string> {
  const api = tracerManager.getOTelAPI();
  if (!api) return {};

  const ctx = api.context.active();
  const carrier: Record<string, string> = {};
  api.propagation.inject(ctx, carrier);

  return carrier;
}

/**
 * Extract trace context from incoming headers.
 * Returns an OTel Context object that can be used as a parent.
 */
export function extractTraceContext(
  headers: Record<string, string>,
): any {
  const api = tracerManager.getOTelAPI();
  if (!api) return null;

  const carrier: Record<string, string> = { ...headers };
  return api.propagation.extract(api.context.active(), carrier);
}
