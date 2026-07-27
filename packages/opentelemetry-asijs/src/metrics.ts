/**
 * OTel Metrics Integration — OpenTelemetry Metrics SDK for AsiJS
 *
 * Provides counters, histograms, and gauges for HTTP request metrics
 * via the OTel Metrics SDK. Metrics are exported via PeriodicExportingMetricReader
 * to OTLP gRPC/HTTP, Console, or Prometheus endpoint.
 *
 * Built on top of @opentelemetry/sdk-metrics.
 *
 * @example
 * ```ts
 * import { otelPlugin, metricsManager } from "@asijs/opentelemetry";
 *
 * // Via plugin
 * app.plugin(otelPlugin({
 *   metrics: {
 *     exporters: ["otlp-http"],
 *     otlpHttpEndpoint: "http://otel-collector:4318/v1/metrics",
 *     exportIntervalMs: 15_000,
 *   },
 * }));
 *
 * // Or standalone
 * await metricsManager.configure({
 *   exporters: ["console"],
 * });
 *
 * // Use the counter
 * metricsManager.requestCounter.add(1, { http_method: "GET" });
 * ```
 */

import type { MetricsConfig } from "./types";
import { tracerManager } from "./tracer";

// ========================================================================
// Metrics Manager
// ========================================================================

class MetricsManager {
  private _initialized = false;
  private _shutdown = false;
  private _meterProvider: any = null;
  private _meter: any = null;
  private _readers: any[] = [];

  // Pre-created instruments (lazy)
  private _requestCounter: any = null;
  private _requestDuration: any = null;
  private _requestInFlight: any = null;
  private _requestSize: any = null;
  private _responseSize: any = null;

  get isInitialized(): boolean {
    return this._initialized;
  }

  /** Get the underlying OTel MeterProvider (if initialized) */
  getProvider(): any {
    return this._meterProvider;
  }

  /** Get the OTel Meter instance */
  getMeter(): any {
    return this._meter;
  }

  /**
   * Get or create a counter instrument.
   *
   * @example
   * ```ts
   * metricsManager.getCounter("app.my_counter", {
   *   description: "Counts something",
   * });
   * ```
   */
  getCounter(name: string, options?: { description?: string; unit?: string }): any {
    if (!this._meter) return null;
    return this._meter.createCounter(name, {
      description: options?.description ?? "",
      unit: options?.unit ?? "1",
    });
  }

  /**
   * Get or create a histogram instrument.
   */
  getHistogram(name: string, options?: { description?: string; unit?: string }): any {
    if (!this._meter) return null;
    return this._meter.createHistogram(name, {
      description: options?.description ?? "",
      unit: options?.unit ?? "ms",
    });
  }

  /**
   * Get or create an observable gauge instrument.
   */
  getObservableGauge(name: string, options?: { description?: string; unit?: string }): any {
    if (!this._meter) return null;
    return this._meter.createObservableGauge(name, {
      description: options?.description ?? "",
      unit: options?.unit ?? "1",
    });
  }

  /** Counter for total HTTP requests */
  get requestCounter(): any {
    if (!this._requestCounter && this._meter) {
      this._requestCounter = this._meter.createCounter("http.requests.total", {
        description: "Total number of HTTP requests",
        unit: "1",
      });
    }
    return this._requestCounter;
  }

  /** Histogram for request duration (ms) */
  get requestDuration(): any {
    if (!this._requestDuration && this._meter) {
      this._requestDuration = this._meter.createHistogram("http.request.duration", {
        description: "HTTP request duration in milliseconds",
        unit: "ms",
      });
    }
    return this._requestDuration;
  }

  /** UpDownCounter for in-flight requests */
  get requestInFlight(): any {
    if (!this._requestInFlight && this._meter) {
      this._requestInFlight = this._meter.createUpDownCounter("http.requests.in_flight", {
        description: "Number of in-flight HTTP requests",
        unit: "1",
      });
    }
    return this._requestInFlight;
  }

  /** Histogram for request body size */
  get requestSize(): any {
    if (!this._requestSize && this._meter) {
      this._requestSize = this._meter.createHistogram("http.request.body.size", {
        description: "HTTP request body size in bytes",
        unit: "By",
      });
    }
    return this._requestSize;
  }

  /** Histogram for response body size */
  get responseSize(): any {
    if (!this._responseSize && this._meter) {
      this._responseSize = this._meter.createHistogram("http.response.body.size", {
        description: "HTTP response body size in bytes",
        unit: "By",
      });
    }
    return this._responseSize;
  }

  /**
   * Configure and initialize the metrics SDK.
   */
  async configure(config: MetricsConfig = {}): Promise<void> {
    if (this._initialized) return;

    const {
      exporters = ["console"],
      exportIntervalMs = 15_000,
    } = config;

    // Lazy-load OTel Metrics SDK
    let metricsSDK: any;
    try {
      metricsSDK = await import("@opentelemetry/sdk-metrics");
    } catch {
      console.warn(
        "[@asijs/opentelemetry] @opentelemetry/sdk-metrics not found — metrics disabled",
      );
      return;
    }

    const readers: any[] = [];

    for (const exporterType of exporters) {
      const exporter = await this._createMetricExporter(exporterType, config);
      if (exporter) {
        const reader = new metricsSDK.PeriodicExportingMetricReader({
          exporter,
          exportIntervalMillis: exportIntervalMs,
        });
        readers.push(reader);
      }
    }

    // Create MeterProvider
    const meterProvider = new metricsSDK.MeterProvider({
      readers,
    });

    // Get the meter
    this._meter = meterProvider.getMeter(
      config.prefix ? `asijs.${config.prefix}` : "asijs",
      "1.0.0",
    );

    this._meterProvider = meterProvider;
    this._readers = readers;
    this._initialized = true;
  }

  /**
   * Record a complete HTTP request metric.
   *
   * @example
   * ```ts
   * metricsManager.recordRequest({
   *   method: "GET",
   *   path: "/users",
   *   status: 200,
   *   durationMs: 42.5,
   *   requestSize: 0,
   *   responseSize: 256,
   * });
   * ```
   */
  recordRequest(data: {
    method: string;
    path: string;
    status: number;
    durationMs: number;
    requestSize?: number;
    responseSize?: number;
  }): void {
    const attrs = {
      http_method: data.method,
      http_path: data.path,
      http_status: String(data.status),
      http_status_class: `${Math.floor(data.status / 100)}xx`,
    };

    this.requestCounter?.add(1, attrs);
    this.requestDuration?.record(data.durationMs, attrs);

    if (data.requestSize !== undefined) {
      this.requestSize?.record(data.requestSize, attrs);
    }

    if (data.responseSize !== undefined) {
      this.responseSize?.record(data.responseSize, attrs);
    }
  }

  /**
   * Increment in-flight counter.
   */
  incrementInFlight(attributes?: Record<string, unknown>): void {
    this.requestInFlight?.add(1, attributes ?? {});
  }

  /**
   * Decrement in-flight counter.
   */
  decrementInFlight(attributes?: Record<string, unknown>): void {
    this.requestInFlight?.add(-1, attributes ?? {});
  }

  /**
   * Gracefully shut down, flushing all pending metrics.
   */
  async shutdown(): Promise<void> {
    if (!this._initialized || this._shutdown) return;
    this._shutdown = true;

    if (this._meterProvider?.shutdown) {
      await this._meterProvider.shutdown();
    }

    this._meterProvider = null;
    this._meter = null;
    this._readers = [];
    this._initialized = false;
  }

  // ========================================================================
  // Private helpers
  // ========================================================================

  private async _createMetricExporter(
    type: string,
    config: MetricsConfig,
  ): Promise<any | null> {
    try {
      switch (type) {
        case "console": {
          const metricsSDK = await import("@opentelemetry/sdk-metrics");
          return new metricsSDK.ConsoleMetricExporter();
        }

        case "otlp-grpc": {
          const mod = await import("@opentelemetry/exporter-metrics-otlp-grpc");
          return new mod.OTLPMetricExporter({
            url: config.otlpGrpcEndpoint ?? "http://localhost:4317",
            headers: config.exporterHeaders,
            timeoutMillis: 10000,
          });
        }

        case "otlp-http": {
          const mod = await import("@opentelemetry/exporter-metrics-otlp-http");
          return new mod.OTLPMetricExporter({
            url: config.otlpHttpEndpoint ?? "http://localhost:4318/v1/metrics",
            headers: config.exporterHeaders,
            timeoutMillis: 10000,
          });
        }

        case "prometheus": {
          // Prometheus is served via AsiJS route — register as a middleware
          // that serves /metrics in Prometheus text format
          return new PrometheusBridgeExporter();
        }

        default:
          console.warn(
            `[@asijs/opentelemetry] Unknown metric exporter: ${type}`,
          );
          return null;
      }
    } catch (error) {
      console.warn(
        `[@asijs/opentelemetry] Failed to load metric exporter "${type}":`,
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }
}

/**
 * Bridge exporter that collects metrics and makes them available
 * for Prometheus scraping via the /metrics endpoint.
 * Uses in-memory aggregation compatible with Prometheus text format.
 */
class PrometheusBridgeExporter {
  private _data: Array<{
    name: string;
    type: string;
    description: string;
    points: Array<{
      value: number;
      attributes: Record<string, string>;
    }>;
  }> = [];

  export(batch: any[], cb: (result: any) => void): void {
    for (const record of batch) {
      if (!record?.descriptor) continue;

      const descriptor = record.descriptor;
      const name = descriptor.name;
      const type = descriptor.type ?? "unknown";
      const description = descriptor.description ?? "";

      const points: Array<{ value: number; attributes: Record<string, string> }> = [];

      if (record.dataPoints) {
        for (const dp of record.dataPoints) {
          const attrs: Record<string, string> = {};
          if (dp.attributes) {
            for (const [k, v] of Object.entries(dp.attributes)) {
              attrs[k] = String(v);
            }
          }
          points.push({ value: dp.value ?? 0, attributes: attrs });
        }
      }

      this._data.push({ name, type, description, points });
    }

    cb({ code: 0 });
  }

  shutdown(): Promise<void> {
    this._data = [];
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  /** Generate Prometheus text format from collected data */
  toPrometheusText(): string {
    const lines: string[] = [];

    for (const metric of this._data) {
      lines.push(`# HELP ${metric.name} ${metric.description}`);
      lines.push(`# TYPE ${metric.name} ${metric.type}`);

      for (const point of metric.points) {
        const labelStr = Object.keys(point.attributes).length > 0
          ? `{${Object.entries(point.attributes)
              .map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`)
              .join(",")}}`
          : "";
        lines.push(`${metric.name}${labelStr} ${point.value}`);
      }
    }

    lines.push("# EOF");
    return lines.join("\n") + "\n";
  }
}

/**
 * Singleton metrics manager instance.
 */
export const metricsManager = new MetricsManager();

/**
 * Initialize OpenTelemetry metrics with the given configuration.
 */
export async function initMetrics(config?: MetricsConfig): Promise<void> {
  await metricsManager.configure(config);
}
