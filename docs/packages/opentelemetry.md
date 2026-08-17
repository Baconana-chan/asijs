# asijs-opentelemetry — OpenTelemetry Integration

Automatic instrumentation for AsiJS: **traces, metrics and logs** through the OpenTelemetry SDK — one plugin, three pillars.

- Package: `asijs-opentelemetry`
- Requires: `asijs` and `@opentelemetry/api` (peer dependencies)
- SDK packages are **optional peers** — install only what you use, the rest degrades gracefully

## Installation

```bash
bun add asijs-opentelemetry @opentelemetry/api
```

For exporters, install what you actually ship with:

```bash
# OTLP (HTTP or gRPC) — recommended for production
bun add @opentelemetry/exporter-trace-otlp-http @opentelemetry/exporter-metrics-otlp-http @opentelemetry/exporter-logs-otlp-http

# or Jaeger / Zipkin
bun add @opentelemetry/exporter-jaeger @opentelemetry/exporter-zipkin
```

## All-in-one plugin (recommended)

```typescript
import { Asi } from "asijs";
import { otelPlugin } from "asijs-opentelemetry";

const app = new Asi();

app.plugin(otelPlugin({
  tracer: {
    serviceName: "my-api",
    exporters: ["otlp-http"],      // or "console" | "jaeger" | "zipkin"
  },
  metrics: {
    exporters: ["console"],
  },
  logs: {
    exporters: ["console"],
  },
  instrument: {
    spans: {
      request: true,               // one span per request
      handler: true,               // one span per handler
    },
    skipPaths: ["/health", "/metrics"],
  },
}));

app.get("/", () => "Hello, OTel!");
await app.listen(3000);
```

## Standalone tracing (without the plugin)

```typescript
import { initTracing, tracerManager, getTraceHeaders, extractTraceContext } from "asijs-opentelemetry";

await initTracing({
  serviceName: "my-service",
  exporters: ["otlp-http"],
});

await tracerManager.withSpan("my-span", async (span) => {
  span.setAttribute("key", "value");
  // ... your code
});
```

## Instrumenting outbound calls

```typescript
import { instrumentFetch, instrumentQuery } from "asijs-opentelemetry";

const res = await instrumentFetch("https://api.example.com/data", { method: "GET" });
const rows = await instrumentQuery(db, "SELECT * FROM users WHERE id = ?", [id]);
```

`instrumentQuery` also detects **N+1 query patterns** and attributes them to the caller span.

## Full API reference

| Export | Description |
|---|---|
| `otelPlugin(options)` | All-in-one AsiJS plugin: tracing + metrics + logs + auto-instrumentation |
| `initTracing(config)` | Initialize the tracer (service name, exporters, span processor) |
| `tracerManager` | Create spans, set attributes, inject/parse trace context |
| `getTraceHeaders()` | Current trace context as headers (downstream propagation) |
| `extractTraceContext(headers)` | Parse incoming `traceparent`/`tracestate` |
| `initMetrics(config)` | Initialize the metrics SDK (counter, histogram, gauge) |
| `metricsManager` | Record custom metrics |
| `initLogs(config)` | Initialize the logs SDK |
| `logsManager` / `log(level, msg)` / `SeverityNumber` | Emit structured OTel logs |
| `otelInstrumentationMiddleware` | Standalone middleware for request/handler spans |
| `instrumentHandler(fn)` | Wrap a handler in a span |
| `instrumentQuery(fn, ...args)` | Instrument a DB query (+ N+1 detection) |
| `instrumentFetch(url, init)` | Instrument a `fetch` call with a client span |

## Configuration

```typescript
interface OpenTelemetryOptions {
  tracer?: TracerConfig;        // serviceName, exporters, spanProcessor, attributes
  metrics?: MetricsConfig;      // exporters, meter name, push interval
  logs?: LogsConfig;            // exporters, logger name, level
  instrument?: InstrumentConfig; // spans (request/handler/query/fetch), skipPaths, attributes
}
```

### Tracing config

```typescript
interface TracerConfig {
  serviceName: string;
  exporters?: Array<"console" | "otlp-http" | "otlp-grpc" | "jaeger" | "zipkin">;
  spanProcessor?: SpanProcessor;         // custom — overrides default BatchSpanProcessor
  attributes?: Record<string, string>;   // global resource attributes
}
```

### Metrics config

```typescript
interface MetricsConfig {
  exporters?: Array<"console" | "otlp-http" | "otlp-grpc">;
  meterName?: string;                    // default: "asijs"
  pushIntervalMs?: number;               // default: 60_000
}
```

### Logs config

```typescript
interface LogsConfig {
  exporters?: Array<"console" | "otlp-http" | "otlp-grpc">;
  loggerName?: string;                   // default: "asijs"
  level?: "debug" | "info" | "warn" | "error";
}
```

### Instrumentation config

```typescript
interface InstrumentConfig {
  spans?: {
    request?: boolean;       // per-request span, default: true
    handler?: boolean;       // per-handler span, default: true
    query?: boolean;         // DB query spans (via instrumentQuery), default: true
    fetch?: boolean;         // outbound fetch spans, default: true
  };
  skipPaths?: string[];      // paths excluded from request spans
  attributes?: Record<string, string>;  // attached to every span
}
```

## What gets instrumented automatically

With `otelPlugin`, every request through AsiJS produces:

1. A **request span** (`asijs.request`) covering the full request lifecycle — method, path, status, duration.
2. A **handler span** (`asijs.handler`) around the matched route handler.
3. **Error events** when the handler throws (exception recorded on the span).
4. **Server metrics** — request count, duration histogram, error count, active requests.
5. **Structured logs** — each request emits a log entry correlated with the trace ID.

`skipPaths` keeps health checks and metrics endpoints out of the noise.

## Distributed context propagation

```typescript
// Server side — incoming request
const parent = extractTraceContext(req.headers);   // traceparent/tracestate

// Client side — outgoing request
await instrumentFetch("https://downstream/api", {
  headers: getTraceHeaders(),   // injects current trace context
});
```

This gives you end-to-end traces across AsiJS services without manual header wiring.

## Degradation behavior

If `@opentelemetry/api` is missing, the plugin logs a warning and continues — your app runs uninstrumented. If only some SDK packages are missing (e.g. no logs SDK), the other pillars still work. This makes the package safe to add without breaking deploys.
