/**
 * OpenTelemetry Plugin for AsiJS — all-in-one `app.plugin(otelPlugin(...))`
 *
 * Combines tracing, metrics, logs, and auto-instrumentation into a single
 * AsiJS plugin. This is the primary entry point for most users.
 *
 * @example
 * ```ts
 * import { Asi } from "asijs";
 * import { otelPlugin } from "asijs-opentelemetry";
 *
 * const app = new Asi();
 *
 * app.plugin(otelPlugin({
 *   tracer: {
 *     serviceName: "my-api",
 *     exporters: ["otlp-http"],
 *   },
 *   metrics: {
 *     exporters: ["otlp-http"],
 *   },
 *   instrument: {
 *     skipPaths: ["/health"],
 *   },
 * }));
 *
 * app.get("/", () => "Hello, OTel!");
 * await app.listen(3000);
 * ```
 */

import type { AsiPlugin, PluginHost } from "asijs";
import type { OpenTelemetryOptions } from "./types";
import { tracerManager, initTracing } from "./tracer";
import { otelInstrumentationMiddleware } from "./instrument";
import { metricsManager, initMetrics } from "./metrics";
import { logsManager, initLogs } from "./logs";

// ========================================================================
// All-in-one OpenTelemetry Plugin
// ========================================================================

/**
 * Create an AsiJS plugin that configures OpenTelemetry tracing,
 * metrics, logs, and auto-instrumentation.
 *
 * All three pillars (traces, metrics, logs) are initialized lazily
 * during the plugin setup phase, so the app can be configured
 * between construction and first request.
 *
 * @param options - Configuration for all OTel components
 * @returns An AsiJS plugin instance
 */
export function otelPlugin(options: OpenTelemetryOptions = {}): AsiPlugin {
  return {
    name: "asijs-opentelemetry",
    config: {
      name: "asijs-opentelemetry",
      dependencies: [],

      async setup(app: PluginHost) {
        const { tracer, metrics, logs, instrument } = options;

        // ── 1. Initialize Tracing ──
        if (tracer !== undefined) {
          await initTracing({
            serviceName: "asijs-app",
            ...tracer,
          });
        }

        // ── 2. Initialize Metrics ──
        if (metrics !== undefined) {
          await initMetrics({
            exporters: ["console"],
            ...(typeof metrics === "boolean" ? {} : metrics),
          });
        }

        // ── 3. Initialize Logs ──
        if (logs !== undefined) {
          await initLogs({
            exporters: ["console"],
            ...(typeof logs === "boolean" ? {} : logs),
          });
        }

        // ── 4. Register Instrumentation Middleware ──
        if (instrument !== undefined) {
          const mw = otelInstrumentationMiddleware({
            spans: instrument?.spans,
            attributes: instrument?.attributes,
            skipPaths: instrument?.skipPaths,
            skip: instrument?.skip,
          });
          app.use(mw);

          // Register metrics-collection middleware if metrics enabled
          if (metrics !== undefined && typeof metrics !== "boolean") {
            const metricsMw = createMetricsMiddleware();
            app.use(metricsMw);
          }

          // Register logs-collection middleware if logs enabled
          if (logs !== undefined && typeof logs !== "boolean") {
            const logsRequestMw = logsManager.createRequestLoggerMiddleware();
            app.use(logsRequestMw);
          }
        }
      },
    },

    async apply(app: PluginHost, state: Map<string, unknown>, decorators: Map<string, unknown>) {
      // Register decorators
      decorators.set("tracer", tracerManager);
      decorators.set("traceHeaders", getTraceHeadersFn);

      // Run setup
      if (this.config.setup) {
        await this.config.setup(app);
      }
    },
  };
}

/**
 * Get current W3C traceparent headers as a record.
 */
function getTraceHeadersFn(): Record<string, string> {
  const api = tracerManager.getOTelAPI();
  if (!api) return {};
  const ctx = api.context.active();
  const carrier: Record<string, string> = {};
  api.propagation.inject(ctx, carrier);
  return carrier;
}

/**
 * Create middleware that records HTTP request metrics.
 */
function createMetricsMiddleware() {
  return async (ctx: any, next: () => Promise<Response>) => {
    const startTime = performance.now();

    // Increment in-flight
    metricsManager.incrementInFlight();

    try {
      const response = await next();
      const duration = performance.now() - startTime;

      metricsManager.recordRequest({
        method: ctx.method,
        path: ctx.path,
        status: response.status,
        durationMs: duration,
        responseSize: parseInt(response.headers.get("content-length") ?? "0", 10) || undefined,
      });

      return response;
    } catch (error) {
      const duration = performance.now() - startTime;
      metricsManager.recordRequest({
        method: ctx.method,
        path: ctx.path,
        status: 500,
        durationMs: duration,
      });
      throw error;
    } finally {
      metricsManager.decrementInFlight();
    }
  };
}
