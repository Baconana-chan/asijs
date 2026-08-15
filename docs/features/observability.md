# Observability Suite

Production observability for AsiJS: OTel logs bridge, distributed tracing via
Redis, a healthcheck dashboard, and a pre-built Grafana dashboard.

## Structured Logging v2 — OTel Logs Bridge

Ship structured logs to any OTLP collector (Grafana Loki, SigNoz, Honeycomb,
Jaeger) with OpenTelemetry semantic conventions.

```typescript
import { Asi, otelLogs } from "asijs";

const app = new Asi();

app.plugin(otelLogs({
  otlp: {
    endpoint: "http://localhost:4318/v1/logs", // OTLP/HTTP logs endpoint
    serviceName: "my-api",
    authHeader: "Bearer ...",                  // optional
  },
}));
```

Log records carry OTel semantic conventions: `service.name`,
`http.request.method`, `url.path`, `http.response.status_code`,
`http.request.duration.ms`, `http.request.id`, `client.address`,
`error.message`, `error.type`, `deployment.environment`, and custom fields as
`app.<key>`. Records are buffered (`bufferSize`, default 100) and flushed
periodically (`flushIntervalMs`, default 5s).

Programmatic use:

```typescript
import { createOTelLogger, entryToOTLPLogRecord, levelToSeverityNumber } from "asijs";

const { logger, exporter } = createOTelLogger({
  endpoint: "http://localhost:4318/v1/logs",
  serviceName: "worker",
});
logger.info("job started", { jobId: "abc" });
await exporter.flush(); // force flush
```

## Distributed Tracing — W3C TraceContext through Redis

Bridge span events between instances via Redis pub/sub so a request that hops
between instances keeps a single W3C trace ID.

```typescript
import { Asi, trace, createRedisTraceBridge, generateTraceId, generateSpanId } from "asijs";

const bridge = await createRedisTraceBridge({
  url: process.env.REDIS_URL!,
});

app.plugin(trace({
  onResponse: (info) => {
    bridge.emit({
      traceId: info.attributes.get("trace.id") ?? generateTraceId(),
      spanId: generateSpanId(),
      parentSpanId: info.attributes.get("trace.parent_span_id") as string | undefined,
      name: `${info.method} ${info.path}`,
      status: info.status,
      durationMs: info.duration,
    });
  },
}));

// On another instance — receive spans and continue the trace:
bridge.onSpan((span) => {
  // span.traceId links this instance's work to the originating request
});
```

## Healthcheck Dashboard

`/__health` — live HTML page showing the status of every component.

```typescript
import { Asi, healthDashboard } from "asijs";

app.use(healthDashboard({
  checks: {
    database: async () => { await db.ping(); },
    redis: () => redis.ping(),
    disk: () => ({ status: "healthy", meta: { free: "42GB" } }),
  },
}));
```

- `GET /__health` — HTML dashboard (auto-refresh 5s): overall status banner,
  custom checks with latency, circuit breaker states (OPEN / CLOSED /
  HALF_OPEN with success/failure counts), PID / uptime / RSS / heap.
- `GET /__health.json` — JSON snapshot for automation (200 healthy, 503 when
  unhealthy). Any OPEN circuit breaker marks the dashboard degraded.

```typescript
import { buildHealthSnapshot, renderHealthDashboardHTML } from "asijs";
const snapshot = await buildHealthSnapshot({ checks: { db: () => db.ping() } });
```

## Metrics Dashboard — Grafana Export

`GET /metrics` (via `metricsPlugin()`) already serves Prometheus text format.
Import a pre-built Grafana dashboard in one line:

```typescript
import { Asi, metricsPlugin, createGrafanaDashboard } from "asijs";

app.plugin(metricsPlugin({ path: "/metrics" }));

// Serve the dashboard JSON for Grafana import:
app.get("/grafana.json", () =>
  new Response(JSON.stringify(createGrafanaDashboard()), {
    headers: { "Content-Type": "application/json" },
  }),
);
```

The generated dashboard (7 panels) includes: requests total, requests per
second, average response time, requests by status code, latency histogram
(p50/p90/p99), top paths, and 5xx error rate. Import in Grafana:
**Dashboards → Import → paste JSON** (Prometheus datasource scraping `/metrics`).
