# Tracing & Observability

## Request Tracing

```typescript
import { trace } from "asijs";

app.plugin(trace({
  logRequests: true,
  includeHeaders: ["User-Agent", "X-Request-ID"],
}));

// Adds headers to responses:
// X-Request-ID: req_uuid
// X-Response-Time: 12ms
// Server-Timing: db;dur=5, cache;dur=2
```

## Manual Tracing

```typescript
import { getCurrentTrace, addTraceEvent, setTraceAttribute } from "asijs";

app.use(async (ctx, next) => {
  const trace = getCurrentTrace(ctx.header("X-Request-ID"));
  addTraceEvent("middleware-start", { path: ctx.path });
  const res = await next();
  addTraceEvent("middleware-end", { status: res.status });
  return res;
});
```

## Metrics

```typescript
import { MetricsCollector, Timing } from "asijs";

// Track timing programmatically
const timing = new Timing();
timing.start("db");
await db.query("...");
timing.end("db");
const header = timing.toServerTimingHeader(); // "db;dur=42"

// Collect metrics
const collector = new MetricsCollector();
collector.record({
  requestId: "req-1",
  method: "GET",
  path: "/users",
  duration: 50,
  status: 200,
});
```

## Prometheus & OTLP Export

```typescript
import { metricsPlugin, PrometheusExporter, OTLPMetricsExporter } from "asijs";

// Prometheus
app.plugin(metricsPlugin({
  exporter: new PrometheusExporter({ endpoint: "/metrics" }),
}));

// OpenTelemetry
app.plugin(metricsPlugin({
  exporter: new OTLPMetricsExporter({
    endpoint: "http://localhost:4318",
  }),
}));
```
