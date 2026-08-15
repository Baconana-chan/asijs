/**
 * Metrics Export — Prometheus & OpenTelemetry (OTLP) for AsiJS
 *
 * Exports metrics in standard formats consumable by Prometheus, Grafana,
 * and OpenTelemetry collectors (e.g. Grafana Tempo, SigNoz, Honeycomb).
 *
 * Two modes:
 *   - **Pull**: Serve `/metrics` endpoint in Prometheus text format
 *   - **Push**: Periodically send metrics to an OTLP collector via HTTP JSON
 *
 * @example
 * ```ts
 * import { Asi, trace, metricsPlugin } from "asijs";
 *
 * const app = new Asi();
 *
 * // Pull mode — serve /metrics for Prometheus scraping
 * app.plugin(trace());
 * app.plugin(metricsPlugin({ path: "/metrics" }));
 *
 * // Push mode — send to OTLP collector
 * app.plugin(metricsPlugin({
 *   otlp: { endpoint: "http://localhost:4318/v1/metrics" },
 *   pushIntervalMs: 15_000,
 * }));
 * ```
 */

import { createPlugin, type AsiPlugin } from "./plugin";
import type { Context } from "./context";
import type { Middleware } from "./types";

// ========================================================================
// Types
// ========================================================================

/** Histogram bucket configuration */
export interface HistogramBucket {
  /** Upper inclusive bound in seconds */
  le: number;
  /** Cumulative count */
  count: number;
}

/** Configure latency histogram buckets (in seconds) */
export type BucketConfig = number[];

/** Default Prometheus latency buckets (seconds) */
export const DEFAULT_BUCKETS: BucketConfig = [
  0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0,
];

/** OTLP exporter configuration */
export interface OTLPExporterOptions {
  /** OTLP HTTP endpoint (e.g. "http://localhost:4318/v1/metrics") */
  endpoint: string;
  /** Optional authentication header value */
  authHeader?: string;
  /** Custom headers sent with each export request */
  headers?: Record<string, string>;
  /** Service name for the OTLP resource */
  serviceName?: string;
  /** Service instance ID */
  serviceInstanceId?: string;
}

/** Metrics plugin configuration */
export interface MetricsPluginOptions {
  /**
   * Path for the Prometheus metrics endpoint.
   * Set to empty string or false to disable pull mode.
   * @default "/metrics"
   */
  path?: string | false;

  /**
   * OTLP exporter configuration — enables push mode.
   */
  otlp?: OTLPExporterOptions;

  /**
   * Push interval in milliseconds.
   * @default 15_000 (15 seconds)
   */
  pushIntervalMs?: number;

  /**
   * Latency histogram buckets (in seconds).
   * @default DEFAULT_BUCKETS
   */
  buckets?: BucketConfig;

  /**
   * Customize prefix for Prometheus metrics names.
   * @default "http"
   */
  prefix?: string;

  /**
   * Enable /metrics endpoint. Default true if path is set.
   */
  enableMetricsEndpoint?: boolean;

  /**
   * Skip recording metrics for certain paths.
   */
  skip?: (ctx: Context) => boolean;
}

/** Metrics data snapshot for export */
export interface MetricSnapshot {
  totalRequests: number;
  totalDurationMs: number;
  statusCodes: Record<string, number>;
  methods: Record<string, number>;
  paths: Record<string, { count: number; totalDurationMs: number }>;
  recentDurations: number[];
}

// ========================================================================
// Metrics Collector
// ========================================================================

/**
 * Collects request metrics with full dimension tracking.
 * Used internally by metricsPlugin and exported for standalone use.
 *
 * Note: distinct from trace.ts MetricsCollector (which requires TraceInfo).
 * This collector accepts simple data objects for easier standalone use.
 */
export class RequestMetricsCollector {
  private totalRequests = 0;
  private totalDurationMs = 0;
  private statusCodes: Map<number, number> = new Map();
  private methods: Map<string, number> = new Map();
  private paths: Map<string, { count: number; totalDurationMs: number }> = new Map();
  private recentDurations: number[] = [];
  private maxDurations = 10_000;

  /** Record a single request metric */
  record(data: {
    duration: number;
    status: number;
    method: string;
    path: string;
    routePattern?: string;
  }): void {
    this.totalRequests++;
    this.totalDurationMs += data.duration;
    this.recentDurations.push(data.duration);

    if (this.recentDurations.length > this.maxDurations) {
      this.recentDurations = this.recentDurations.slice(-this.maxDurations / 2);
    }

    // Status code
    this.statusCodes.set(
      data.status,
      (this.statusCodes.get(data.status) ?? 0) + 1,
    );

    // Method
    const method = data.method.toUpperCase();
    this.methods.set(method, (this.methods.get(method) ?? 0) + 1);

    // Path (use routePattern if available for better aggregation)
    const pathKey = data.routePattern ?? data.path;
    const existing = this.paths.get(pathKey) ?? {
      count: 0,
      totalDurationMs: 0,
    };
    existing.count++;
    existing.totalDurationMs += data.duration;
    this.paths.set(pathKey, existing);
  }

  /** Get a snapshot for export */
  snapshot(): MetricSnapshot {
    const paths: Record<string, { count: number; totalDurationMs: number }> = {};
    for (const [key, val] of this.paths) {
      paths[key] = { ...val };
    }

    return {
      totalRequests: this.totalRequests,
      totalDurationMs: this.totalDurationMs,
      statusCodes: Object.fromEntries(this.statusCodes),
      methods: Object.fromEntries(this.methods),
      paths,
      recentDurations: [...this.recentDurations],
    };
  }

  /** Total request count */
  get count(): number {
    return this.totalRequests;
  }

  /** Average response time in milliseconds */
  get averageResponseTime(): number {
    return this.totalRequests > 0
      ? this.totalDurationMs / this.totalRequests
      : 0;
  }

  /** Reset all collected metrics */
  reset(): void {
    this.totalRequests = 0;
    this.totalDurationMs = 0;
    this.statusCodes.clear();
    this.methods.clear();
    this.paths.clear();
    this.recentDurations = [];
  }
}

// ========================================================================
// Prometheus Text Format Exporter
// ========================================================================

/**
 * Exports metrics in Prometheus text-based exposition format.
 *
 * Produces properly formatted metrics with HELP/TYPE lines, labels,
 * counters, gauges, and histograms.
 */
export class PrometheusExporter {
  private buckets: BucketConfig;
  private prefix: string;
  private startTime = Date.now();

  constructor(options?: {
    buckets?: BucketConfig;
    prefix?: string;
  }) {
    this.buckets = options?.buckets ?? DEFAULT_BUCKETS;
    this.prefix = options?.prefix ?? "http";
  }

  /**
   * Generate Prometheus exposition format from a metric snapshot.
   */
  export(snapshot: MetricSnapshot): string {
    const lines: string[] = [];
    const p = this.prefix;

    // Helper: escape label values
    const esc = (v: string): string =>
      v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

    // Helper: format label pairs
    const labels = (pairs: Record<string, string | number>): string => {
      const parts = Object.entries(pairs).map(
        ([k, v]) => `${k}="${esc(String(v))}"`,
      );
      return parts.length > 0 ? `{${parts.join(",")}}` : "";
    };

    // ── Counter: total requests ──
    lines.push(`# HELP ${p}_requests_total Total HTTP requests`);
    lines.push(`# TYPE ${p}_requests_total counter`);
    lines.push(`# UNIT ${p}_requests_total requests`);
    lines.push(`${p}_requests_total${labels({})} ${snapshot.totalRequests}`);

    // ── Counter: per status code ──
    lines.push(`# HELP ${p}_requests_by_status HTTP requests by status code`);
    lines.push(`# TYPE ${p}_requests_by_status counter`);
    lines.push(`# UNIT ${p}_requests_by_status requests`);
    for (const [code, count] of Object.entries(snapshot.statusCodes)) {
      lines.push(
        `${p}_requests_by_status${labels({ status: code })} ${count}`,
      );
    }

    // ── Counter: per method ──
    lines.push(`# HELP ${p}_requests_by_method HTTP requests by HTTP method`);
    lines.push(`# TYPE ${p}_requests_by_method counter`);
    lines.push(`# UNIT ${p}_requests_by_method requests`);
    for (const [method, count] of Object.entries(snapshot.methods)) {
      lines.push(`${p}_requests_by_method${labels({ method })} ${count}`);
    }

    // ── Counter: per path ──
    lines.push(`# HELP ${p}_requests_by_path HTTP requests by route path`);
    lines.push(`# TYPE ${p}_requests_by_path counter`);
    lines.push(`# UNIT ${p}_requests_by_path requests`);
    for (const [path, stats] of Object.entries(snapshot.paths)) {
      lines.push(
        `${p}_requests_by_path${labels({ path })} ${stats.count}`,
      );
    }

    // ── Histogram: request duration ──
    const durationSec = snapshot.totalDurationMs / 1000;
    const totalCount = snapshot.totalRequests;

    lines.push(
      `# HELP ${p}_request_duration_seconds Request latency distribution`,
    );
    lines.push(`# TYPE ${p}_request_duration_seconds histogram`);
    lines.push(`# UNIT ${p}_request_duration_seconds seconds`);

    // Use snapshot's collected durations for histogram bucketing
    const histogramDurations = snapshot.recentDurations.length > 0
      ? snapshot.recentDurations
      : [durationSec * 1000 / Math.max(totalCount, 1)];

    const bucketCounts = this.computeBucketCounts(histogramDurations);

    for (const bucket of bucketCounts) {
      lines.push(
        `${p}_request_duration_seconds_bucket${labels({ le: String(bucket.le) })} ${bucket.count}`,
      );
    }
    lines.push(
      `${p}_request_duration_seconds_bucket${labels({ le: "+Inf" })} ${totalCount}`,
    );
    lines.push(`${p}_request_duration_seconds_sum ${durationSec}`);
    lines.push(`${p}_request_duration_seconds_count ${totalCount}`);

    // ── Gauge: requests per second ──
    const uptimeSec = (Date.now() - this.startTime) / 1000;
    const rps = uptimeSec > 0
      ? (snapshot.totalRequests / uptimeSec).toFixed(2)
      : "0";
    lines.push(`# HELP ${p}_requests_per_second HTTP requests per second`);
    lines.push(`# TYPE ${p}_requests_per_second gauge`);
    lines.push(`# UNIT ${p}_requests_per_second rps`);
    lines.push(`${p}_requests_per_second ${rps}`);

    // ── Gauge: average response time ──
    const avgMs = totalCount > 0
      ? (snapshot.totalDurationMs / totalCount).toFixed(2)
      : "0";
    lines.push(
      `# HELP ${p}_average_response_time_ms Average response time in ms`,
    );
    lines.push(`# TYPE ${p}_average_response_time_ms gauge`);
    lines.push(`# UNIT ${p}_average_response_time_ms milliseconds`);
    lines.push(`${p}_average_response_time_ms ${avgMs}`);

    // OpenMetrics requires EOF marker and specific content type
    lines.push("# EOF");

    return lines.join("\n") + "\n";
  }

  /**
   * Compute cumulative histogram buckets from duration values.
   */
  private computeBucketCounts(durationsMs: number[]): HistogramBucket[] {
    const sorted = [...durationsMs].sort((a, b) => a - b);

    return this.buckets.map((leSec) => {
      const leMs = leSec * 1000;
      let count = 0;
      for (const d of sorted) {
        if (d <= leMs) {
          ++count;
        } else {
          break;
        }
      }
      return { le: leSec, count };
    });
  }

  reset(startTime?: number): void {
    this.startTime = startTime ?? Date.now();
  }

  /**
   * Get uptime in seconds since creation or last reset.
   */
  get uptimeSeconds(): number {
    return (Date.now() - this.startTime) / 1000;
  }
}

// ========================================================================
// OTLP / HTTP JSON Exporter
// ========================================================================

/**
 * OpenTelemetry Protocol (OTLP) exporter that sends metrics to a collector
 * via HTTP JSON (Content-Type: application/json).
 *
 * Compatible with OTLP/HTTP collectors: Grafana, SigNoz, Honeycomb, etc.
 * Sends to: POST {endpoint}/v1/metrics
 */
export class OTLPMetricsExporter {
  readonly options: Required<OTLPExporterOptions>;

  constructor(options: OTLPExporterOptions) {
    this.options = {
      endpoint: options.endpoint.replace(/\/+$/, ""),
      authHeader: options.authHeader ?? "",
      headers: options.headers ?? {},
      serviceName: options.serviceName ?? "asijs-app",
      serviceInstanceId:
        options.serviceInstanceId ?? crypto.randomUUID(),
    };
  }

  /**
   * Export a metric snapshot to the OTLP collector.
   */
  async export(snapshot: MetricSnapshot): Promise<{
    success: boolean;
    status?: number;
    error?: string;
  }> {
    const payload = this.buildPayload(snapshot);

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
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        return {
          success: false,
          status: response.status,
          error: `OTLP export failed: ${response.status} ${await response.text().catch(() => "")}`,
        };
      }

      return { success: true, status: response.status };
    } catch (error) {
      return {
        success: false,
        error: `OTLP export error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Build OTLP/HTTP JSON payload from a metric snapshot.
   * Uses protobuf-to-JSON mapping conventions.
   */
  private buildPayload(snapshot: MetricSnapshot): Record<string, unknown> {
    const nowNs = Number(BigInt(Date.now()) * BigInt(1_000_000));
    const pastNs = nowNs - 60_000_000_000; // 60 seconds ago

    // Helper to create OTLP attribute key-value
    const attr = (key: string, value: string) => ({
      key,
      value: { stringValue: value },
    });

    // Build the metrics arrays
    const metrics: Record<string, unknown>[] = [];

    // Total requests counter
    metrics.push(this.counterMetric(
      "http.requests.total",
      "Total HTTP requests",
      snapshot.totalRequests,
      [],
      nowNs,
      pastNs,
    ));

    // Per-status counters
    for (const [status, count] of Object.entries(snapshot.statusCodes)) {
      if (count > 0) {
        metrics.push(this.counterMetric(
          "http.requests.by_status",
          "HTTP requests by status code",
          count,
          [attr("http.status_code", status)],
          nowNs,
          pastNs,
        ));
      }
    }

    // Per-method counters
    for (const [method, count] of Object.entries(snapshot.methods)) {
      if (count > 0) {
        metrics.push(this.counterMetric(
          "http.requests.by_method",
          "HTTP requests by method",
          count,
          [attr("http.method", method)],
          nowNs,
          pastNs,
        ));
      }
    }

    // Duration histogram
    metrics.push({
      name: "http.request.duration",
      description: "Request latency distribution",
      unit: "s",
      histogram: {
        dataPoints: [
          {
            startTimeUnixNano: String(pastNs),
            timeUnixNano: String(nowNs),
            count: snapshot.totalRequests,
            sum: snapshot.totalDurationMs / 1000,
            bucketCounts: [snapshot.totalRequests],
            explicitBounds: [],
          },
        ],
        aggregationTemporality: 1, // CUMULATIVE
      },
    });

    return {
      resourceMetrics: [
        {
          resource: {
            attributes: [
              attr("service.name", this.options.serviceName),
              attr("service.instance.id", this.options.serviceInstanceId),
              attr("telemetry.sdk.name", "asijs"),
              attr("telemetry.sdk.language", "typescript"),
            ],
          },
          scopeMetrics: [
            {
              scope: { name: "asijs.metrics", version: "1.0.0" },
              metrics,
            },
          ],
        },
      ],
    };
  }

  private counterMetric(
    name: string,
    description: string,
    value: number,
    attributes: Array<{ key: string; value: { stringValue: string } }>,
    nowNs: number,
    pastNs: number,
  ): Record<string, unknown> {
    return {
      name,
      description,
      unit: "1",
      sum: {
        dataPoints: [
          {
            attributes,
            startTimeUnixNano: String(pastNs),
            timeUnixNano: String(nowNs),
            asDouble: value,
          },
        ],
        aggregationTemporality: 1, // CUMULATIVE
        isMonotonic: true,
      },
    };
  }
}

// ========================================================================
// Metrics Middleware
// ========================================================================

/**
 * Middleware that records request metrics — duration, status, method, path.
 * Designed to be used alongside the trace plugin.
 */
export function metricsMiddleware(collector: RequestMetricsCollector, options?: {
  skip?: (ctx: Context) => boolean;
}): Middleware {
  return async (ctx, next) => {
    if (options?.skip?.(ctx)) {
      return next();
    }

    const startTime = performance.now();

    try {
      const response = await next();
      const duration = performance.now() - startTime;
      const status = response instanceof Response ? response.status : 200;

      collector.record({
        duration,
        status,
        method: ctx.method,
        path: ctx.path,
        // Note: route pattern aggregation requires a companion decorator.
        // Currently uses raw path; route patterns like /users/:id are not captured.
        routePattern: ctx.path,
      });

      return response;
    } catch (error) {
      const duration = performance.now() - startTime;
      collector.record({
        duration,
        status: 500,
        method: ctx.method,
        path: ctx.path,
        // Note: route pattern aggregation requires a companion decorator.
        // Currently uses raw path; route patterns like /users/:id are not captured.
        routePattern: ctx.path,
      });
      throw error;
    }
  };
}

// ========================================================================
// Metrics Plugin
// ========================================================================

/**
 * Create a metrics plugin that serves a `/metrics` endpoint (Prometheus pull)
 * and/or periodically pushes metrics to an OTLP collector (push).
 *
 * @example
 * ```ts
 * // Pull mode
 * app.plugin(metricsPlugin());
 * // GET /metrics → Prometheus text format
 *
 * // Push mode
 * app.plugin(metricsPlugin({
 *   otlp: { endpoint: "http://otel-collector:4318/v1/metrics" },
 *   pushIntervalMs: 15_000,
 * }));
 *
 * // Both
 * app.plugin(metricsPlugin({
 *   path: "/metrics",
 *   otlp: { endpoint: "http://localhost:4318/v1/metrics" },
 * }));
 * ```
 */
export function metricsPlugin(
  options: MetricsPluginOptions = {},
): AsiPlugin {
  const {
    path = "/metrics",
    pushIntervalMs = 15_000,
    buckets = DEFAULT_BUCKETS,
    prefix = "http",
    enableMetricsEndpoint = true,
    skip,
  } = options;

  const collector = new RequestMetricsCollector();
  const prometheusExporter = new PrometheusExporter({ buckets, prefix });

  return createPlugin({
    name: "metrics",
    version: "1.0.0",

    // Record metrics via middleware
    middleware: [metricsMiddleware(collector, { skip })],

    setup(app) {
      // ── Pull mode: serve /metrics endpoint ──
      if (path && enableMetricsEndpoint) {
        app.get(path, () => {
          const snapshot = collector.snapshot();
          const body = prometheusExporter.export(snapshot);
          return new Response(body, {
            headers: {
              "Content-Type": "application/openmetrics-text; version=1.0.0; charset=utf-8",
              "Cache-Control": "no-cache, no-store, must-revalidate",
            },
          });
        });
      }

      // ── Push mode: OTLP exporter ──
      if (options.otlp) {
        const otlpExporter = new OTLPMetricsExporter(options.otlp);

        const pushTimer = setInterval(async () => {
          try {
            const snapshot = collector.snapshot();
            if (snapshot.totalRequests === 0) return;

            const result = await otlpExporter.export(snapshot);
            if (!result.success) {
              console.warn(
                `[metrics] OTLP push failed: ${result.error}`,
              );
            }
          } catch (error) {
            console.error("[metrics] OTLP push error:", error);
          }
        }, pushIntervalMs);

        // Don't keep process alive for push timer
        if (typeof pushTimer === "object" && "unref" in pushTimer) {
          (pushTimer as any).unref();
        }

        // Store timer for cleanup
        (app as any).__metricsTimer = pushTimer;
      }
    },
  });
}

// ========================================================================
// Grafana Dashboard Export
// ========================================================================

/** Options for the pre-built Grafana dashboard */
export interface GrafanaDashboardOptions {
  /** Dashboard title (default: "AsiJS Metrics") */
  title?: string;
  /** Prometheus datasource UID (default: "prometheus") */
  datasource?: string;
  /** Metrics prefix used by metricsPlugin (default: "http") */
  prefix?: string;
  /** Refresh interval (default: "30s") */
  refresh?: string;
}

/** A single Grafana panel */
interface GrafanaPanel {
  id: number;
  type: string;
  title: string;
  gridPos: { x: number; y: number; w: number; h: number };
  datasource: { type: string; uid: string };
  targets: Array<{ expr: string; legendFormat?: string; refId: string }>;
  fieldConfig?: Record<string, unknown>;
  options?: Record<string, unknown>;
}

/**
 * Generate a pre-built Grafana dashboard JSON for AsiJS metrics.
 *
 * Import via Grafana: Dashboards → Import → paste JSON.
 * Expects a Prometheus datasource scraping `GET /metrics`.
 *
 * @example
 * ```ts
 * const dashboard = createGrafanaDashboard({ prefix: "http" });
 * app.get("/grafana.json", () => new Response(JSON.stringify(dashboard), {
 *   headers: { "Content-Type": "application/json" },
 * }));
 * ```
 */
export function createGrafanaDashboard(options: GrafanaDashboardOptions = {}): Record<string, unknown> {
  const title = options.title ?? "AsiJS Metrics";
  const datasource = options.datasource ?? "prometheus";
  const prefix = options.prefix ?? "http";
  const refresh = options.refresh ?? "30s";

  const ds = { type: "prometheus", uid: datasource };
  let nextId = 1;
  const panel = (p: Omit<GrafanaPanel, "id" | "datasource">): GrafanaPanel => {
    const full: GrafanaPanel = { id: nextId++, datasource: ds, ...p } as GrafanaPanel;
    return full;
  };

  const panels: GrafanaPanel[] = [
    panel({
      type: "stat",
      title: "Requests total",
      gridPos: { x: 0, y: 0, w: 6, h: 6 },
      targets: [{ expr: `${prefix}_requests_total`, refId: "A" }],
      fieldConfig: {
        defaults: { unit: "short" },
      },
    }),
    panel({
      type: "stat",
      title: "Requests per second",
      gridPos: { x: 6, y: 0, w: 6, h: 6 },
      targets: [{ expr: `${prefix}_requests_per_second`, refId: "A" }],
      fieldConfig: {
        defaults: { unit: "reqps" },
      },
    }),
    panel({
      type: "stat",
      title: "Avg response time",
      gridPos: { x: 12, y: 0, w: 6, h: 6 },
      targets: [{ expr: `${prefix}_average_response_time_ms`, refId: "A" }],
      fieldConfig: {
        defaults: { unit: "ms" },
      },
    }),
    panel({
      type: "timeseries",
      title: "Requests by status code",
      gridPos: { x: 0, y: 6, w: 12, h: 8 },
      targets: [
        {
          expr: `sum by (status) (rate(${prefix}_requests_by_status[5m]))`,
          legendFormat: "{{status}}",
          refId: "A",
        },
      ],
      options: { legend: { displayMode: "list" } },
    }),
    panel({
      type: "timeseries",
      title: "Request duration (p50/p90/p99)",
      gridPos: { x: 12, y: 6, w: 12, h: 8 },
      targets: [
        {
          expr: `histogram_quantile(0.5, sum by (le) (rate(${prefix}_request_duration_seconds_bucket[5m])))`,
          legendFormat: "p50",
          refId: "A",
        },
        {
          expr: `histogram_quantile(0.9, sum by (le) (rate(${prefix}_request_duration_seconds_bucket[5m])))`,
          legendFormat: "p90",
          refId: "B",
        },
        {
          expr: `histogram_quantile(0.99, sum by (le) (rate(${prefix}_request_duration_seconds_bucket[5m])))`,
          legendFormat: "p99",
          refId: "C",
        },
      ],
      fieldConfig: {
        defaults: { unit: "s" },
      },
    }),
    panel({
      type: "timeseries",
      title: "Requests by path",
      gridPos: { x: 0, y: 14, w: 12, h: 8 },
      targets: [
        {
          expr: `topk(10, sum by (path) (rate(${prefix}_requests_by_path[5m])))`,
          legendFormat: "{{path}}",
          refId: "A",
        },
      ],
    }),
    panel({
      type: "stat",
      title: "Error rate (5xx)",
      gridPos: { x: 12, y: 14, w: 12, h: 8 },
      targets: [
        {
          expr: `sum(rate(${prefix}_requests_by_status{status=~"5.."}[5m])) / sum(rate(${prefix}_requests_total[5m]))`,
          refId: "A",
        },
      ],
      fieldConfig: {
        defaults: { unit: "percentunit", min: 0, max: 1 },
      },
    }),
  ];

  return {
    annotations: {
      list: [
        {
          builtIn: 1,
          datasource: { type: "grafana", uid: "-- Grafana --" },
          enable: true,
          hide: true,
          iconColor: "rgba(0, 211, 255, 1)",
          name: "Annotations & Alerts",
          type: "dashboard",
        },
      ],
    },
    editable: true,
    fiscalYearStartMonth: 0,
    graphTooltip: 1,
    id: null,
    links: [],
    panels,
    refresh,
    schemaVersion: 39,
    tags: ["asijs", "metrics"],
    templating: { list: [] },
    time: { from: "now-6h", to: "now" },
    timepicker: {},
    timezone: "browser",
    title,
    uid: "asijs-metrics",
    version: 1,
    weekStart: "",
  };
}


