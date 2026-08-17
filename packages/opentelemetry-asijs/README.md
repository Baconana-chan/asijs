# asijs-opentelemetry — OpenTelemetry integration for AsiJS

Automatic instrumentation for AsiJS: **traces, metrics and logs** through the OpenTelemetry SDK — one plugin, three pillars.

All OTel SDK packages are **optional peer dependencies** — the package works (and degrades gracefully) without the ones you don't need.

## Installation

```bash
bun add asijs-opentelemetry @opentelemetry/api
```

> Requires `asijs` and `@opentelemetry/api` as peer dependencies. Exporters and SDK packages
> (`@opentelemetry/sdk-trace-base`, `sdk-metrics`, `sdk-logs`, `exporter-*-otlp-*`, `exporter-jaeger`, `exporter-zipkin`) are optional — install only the ones you use.

## Usage

### All-in-one plugin (recommended)

```ts
import { Asi } from "asijs";
import { otelPlugin } from "asijs-opentelemetry";

const app = new Asi();

app.plugin(otelPlugin({
  tracer: {
    serviceName: "my-api",
    exporters: ["otlp-http"], // or "console" | "jaeger" | "zipkin"
  },
  metrics: {
    exporters: ["console"],
  },
  logs: {
    exporters: ["console"],
  },
  instrument: {
    spans: {
      request: true, // per-request span
      handler: true, // per-handler span
    },
    skipPaths: ["/health", "/metrics"],
  },
}));

app.get("/", () => "Hello, OTel!");
await app.listen(3000);
```

### Standalone tracing (without the plugin)

```ts
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

### Instrumenting outbound calls

```ts
import { instrumentFetch, instrumentQuery } from "asijs-opentelemetry";

const res = await instrumentFetch("https://api.example.com/data", { method: "GET" });
const rows = await instrumentQuery(db, "SELECT * FROM users WHERE id = ?", [id]);
```

## API

| Export | Description |
|--------|-------------|
| `otelPlugin(options)` | All-in-one AsiJS plugin: tracing + metrics + logs + auto-instrumentation |
| `initTracing(config)` | Initialize the tracer (service name, exporters, span processor) |
| `tracerManager` | Create spans, set attributes, inject/parse trace context |
| `getTraceHeaders()` | Current trace context as headers (for downstream propagation) |
| `extractTraceContext(headers)` | Parse incoming `traceparent`/`tracestate` headers |
| `initMetrics(config)` | Initialize the metrics SDK (counter, histogram, gauge) |
| `metricsManager` | Record custom metrics |
| `initLogs(config)` | Initialize the logs SDK |
| `logsManager` / `log(level, msg)` / `SeverityNumber` | Emit structured OTel logs |
| `otelInstrumentationMiddleware` | Standalone middleware for request/handler spans |
| `instrumentHandler(fn)` | Wrap a handler with a span |
| `instrumentQuery(fn, ...args)` | Instrument a DB query |
| `instrumentFetch(url, init)` | Instrument a `fetch` call with client span |

## Configuration

The `otelPlugin` options mirror the standalone managers:

```ts
interface OpenTelemetryOptions {
  tracer?: TracerConfig;      // serviceName, exporters, spanProcessor, attributes
  metrics?: MetricsConfig;    // exporters, meter name, push interval
  logs?: LogsConfig;          // exporters, logger name, level
  instrument?: InstrumentConfig; // spans (request/handler/query/fetch), skipPaths, attributes
}
```

## Development

```bash
bun install
bun test        # unit tests per pillar (tracer, metrics, logs, instrument)
bun run build   # tsc → dist/
```
