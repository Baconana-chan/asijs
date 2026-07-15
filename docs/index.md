---
layout: home

hero:
  name: "AsiJS"
  text: "Bun-first Web Framework"
  tagline: "Fast, type-safe, and simple. Built for Bun from the ground up."
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/Baconana-chan/asijs

features:
  - title: 🚀 Blazing Fast
    details: Built on Bun's native HTTP server with a Trie-based router, ahead-of-time compilation, and zero-copy responses. Outperforms Express, Fastify, Hono, and Elysia.
  - title: 🔒 Type-Safe
    details: Full TypeScript inference with TypeBox validation. Schemas flow from server to client automatically — no code generation needed.
  - title: 🔌 Plugin Ecosystem
    details: CORS, JWT, OpenAPI/Swagger, Rate Limiting, Security Headers, WebSocket, JSX, MCP, and more — all built-in.
  - title: 🧩 File-Based Routing
    details: Drop route files into `src/routes/` — automatic registration with params, groups, and method suffixes.
  - title: 🏢 Workspace Ready
    details: Multi-app monorepo support with independent hot-reload. Each sub-app restarts only when its own files change.
  - title: 📊 Production Observability
    details: Built-in tracing (W3C traceparent), Prometheus/OTLP metrics export, structured logging, and cron scheduler.
---

## Quick Example

```typescript
import { Asi } from "asijs";

const app = new Asi();

app.get("/", () => "Hello, World!");
app.get("/user/:id", (ctx) => ({ id: ctx.params.id }));

app.group("/api", (api) => {
  api.get("/users", () => [{ name: "Alice" }, { name: "Bob" }]);
  api.post("/users", (ctx) => {
    const body = await ctx.json();
    return { created: body };
  });
});

app.listen(3000);
```

## Benchmarks

AsiJS is designed for maximum performance:

| Framework | Requests/sec | Latency |
|-----------|-------------|---------|
| **AsiJS (compiled)** | **~185,000** | **~0.05ms** |
| **AsiJS** | **~170,000** | **~0.06ms** |
| Elysia | ~155,000 | ~0.07ms |
| Hono | ~140,000 | ~0.08ms |
| Fastify | ~95,000 | ~0.11ms |
| Express | ~25,000 | ~0.40ms |

> Benchmarks performed on Bun 1.3 with simple JSON response. Your mileage may vary.
