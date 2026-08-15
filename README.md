# AsiJS

<div align="center">
  <h3>⚡ Bun-first Web Framework — Fast, Type-safe, Production-ready</h3>
  <p>A high-performance web framework for Bun, Node.js, and Edge runtimes</p>

  [![CI](https://github.com/user/asijs/actions/workflows/ci.yml/badge.svg)](https://github.com/user/asijs/actions/workflows/ci.yml)
  [![npm version](https://badge.fury.io/js/asijs.svg)](https://badge.fury.io/js/asijs)
  [![JSR](https://jsr.io/badges/@baconana/asijs)](https://jsr.io/@baconana/asijs)
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
  [![Tests](https://img.shields.io/badge/tests-1373%20passing-brightgreen)](https://github.com/user/asijs/actions/workflows/ci.yml)
</div>

---

## ✨ Features

### Core
- 🚀 **Blazing Fast** — Trie + Radix tree router, route compilation, static router, schema cache LRU
- 🎯 **Type-safe** — Full TypeScript with TypeBox validation, phantom types, type inference
- 🔌 **Pluggable** — Rich plugin ecosystem with dependency ordering, lazy init, lifecycle hooks
- 📦 **Zero Config** — Sensible defaults, works out of the box
- 🖥️ **Multi-runtime** — Bun, Node.js (HTTP/HTTPS+WebSocket), Edge (Cloudflare, Deno, Vercel, Lambda@Edge)

### Developer Experience
- 🔥 **Hot Reload 2.0** — `fs.watch` with 200ms debounce, module-level hot swap, HMR browser push via WebSocket
- 💬 **Interactive REPL** — `asi repl`: create routes on the fly, test requests, inspect state
- 🌐 **Web Playground** — Browser-based IDE: code editor, output panel, request bar, 5 built-in examples
- 🛠️ **CLI v2** — `asi create/dev/inspect/build/plugin/repl/generate/integrate/analyze/doctor/upgrade/template`
- 📊 **Benchmark Dashboard** — Chart.js dashboard with trend lines, CI pipeline

### Resilience & Performance
- ⚡ **Circuit Breaker** — CLOSED/OPEN/HALF_OPEN with sliding window, timeout, fallback, healthcheck integration
- 🔁 **Request Deduplication** — Inflight manager, XFetch cache stampede protection, MemoryCache/Redis
- ❄️ **Serverless Optimisation** — Warm start emulation, lazy imports, bundle config for 6 platforms
- 🗺️ **Radix Tree Router** — Up to 2× faster for 1M+ routes
- 💾 **Schema Cache LRU** — Bounded memory for TypeBox compiled validators

### API & Documentation
- 📄 **OpenAPI / Swagger** — Auto-generated OpenAPI 3.0/3.1, Swagger UI, security schemes
- 📖 **API Docs Portal** — Full documentation portal: sidebar search, code samples (curl/Python/JS/Go), try-it-out proxy, dark/light theme
- 🔄 **API Versioning** — URL/Header/Combined strategies, fallback, deprecation headers (`Sunset`, `Deprecation`)
- 📝 **API Changelog** — Snapshot/diff between API versions, Markdown/HTML export for CI/CD

### WebSocket
- 🔌 **WebSocket** — First-class `app.ws()` with typed data, lifecycle hooks
- 📡 **Pub-Sub** — Rooms (`ws.join()`, `ws.leave()`), broadcast, presence tracking, typed events
- 🔄 **Redis Bridge** — Cross-instance pub-sub via Redis for horizontal scaling
- 💤 **Graceful Shutdown** — Drain active connections with 1001 close frames

### Security
- 🛡️ **Built-in Security Module** — `AsiConfig.security` with zero-config sensible defaults:
  - `autoEscape` — Automatic XSS prevention in HTML responses
  - `maxBodySize` — Request body size limiting (configurable per unit)
  - `autoNonce` — CSP nonce generation for inline scripts
  - `strictContentType` — Content-Type enforcement with error/sanitize/off modes
  - **OWASP Headers** — CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
- 🔐 **Security Presets** — `maxSecurity`, `apiSecurity`, `devSecurity`
- 🔑 **JWT** — Sign/verify/decode, bearer auth middleware, CSRF protection
- 🔒 **Rate Limiting** — Sliding window + token bucket, IP/API Key/User presets, per-tenant isolation

### Static Site Generation
- 📄 **SSG** — `asi build --ssg`: scan GET routes, render HTML, pretty URLs (`/about/index.html`) or flat format
- 📦 **JSON Export** — `--export-api` for static API data
- ⚡ **Edge-ready** — SPA + Hybrid rendering with islands architecture

### Observability
- 📊 **Metrics** — Prometheus + OTLP exporters, request metrics collector, histograms
- 🕵️ **Tracing** — W3C Trace Context, Server-Timing headers, request IDs, span events
- 📋 **Structured Logging** — JSON log middleware for ELK/Datadog/Splunk, multi-level (debug/info/warn/error)
- 🐛 **Sentry** — Fetch-based error tracking (no SDK required), breadcrumbs, envelopes
- 🔬 **OpenTelemetry** — Full OTel instrumentation: spans, metrics, logs. W3C TraceContext propagation. Exporters: Console, OTLP, Jaeger, Zipkin

### Ecosystem
- 🤖 **MCP Ready** — Model Context Protocol server for AI/LLM integration (7 built-in tools, 4 resources)
- 📦 **Plugin Registry** — `asi plugin search/install/create/list`. 40+ curated plugins in 8 categories
- 🧩 **@asijs/next** — Next.js App Router, Pages Router, Edge Runtime adapter
- 🧩 **@asijs/astro** — Astro server endpoints, method-specific endpoints, middleware
- 🧩 **@asijs/remix** — Remix resource routes, loaders, actions
- 🧩 **@asijs/sveltekit** — SvelteKit handle hook, server handler, universal handler
- 🧩 **@asijs/opentelemetry** — OpenTelemetry automatic instrumentation
- 📋 **ESLint Plugin** — `eslint-plugin-asijs` with 4 rules: no-duplicate-route, no-missing-handler, validate-schema, no-unused-route
- 🎨 **VS Code Extension** — Snippets, route explorer, hover provider, debug config, template explorer, create wizard

### Migration
- 🔄 **Express → AsiJS** — `expressPlugin.wrap(mw)`, codemod with 22 rules, CLI: `asi integrate ./app.js`
- 🔄 **Koa → AsiJS** — `koaPlugin.wrap(mw)`, codemod with 22 rules
- 🔄 **Elysia/Hono/Fastify → AsiJS** — `asi migrate` with automatic transformation

## 📦 Installation

**Bun:**
```bash
bun add asijs
```

**npm:**
```bash
npm install asijs
```

**JSR:**
```bash
bunx jsr add @baconana/asijs
```

### Node.js Adapter

For Node.js HTTP(S) + WebSocket support:
```bash
bun add asijs  # same package, use asijs/node
```

```typescript
import { Asi } from "asijs";
import { nodeAdapter } from "asijs/node";

const app = new Asi({ serverAdapter: nodeAdapter() });
app.listen(3000);
```

## 🚀 Quick Start

```typescript
import { Asi } from "asijs";

const app = new Asi();

// Simple route
app.get("/", () => "Hello, AsiJS! 👋");

// With validation
app.post("/users", async (ctx) => {
  const body = await ctx.body();
  return { id: 1, ...body };
}, {
  body: Type.Object({
    name: Type.String({ minLength: 1 }),
    email: Type.String({ format: "email" }),
  }),
});

// Start server
app.listen(3000);
```

## 🛠️ CLI

```bash
# Create a new project
bunx asijs create my-app

# Development server (with hot reload)
bunx asijs dev

# Inspect routes/plugins/size
bunx asijs inspect --routes --verbose
bunx asijs inspect --plugins
bunx asijs inspect --size

# Build for production
bunx asijs build                  # SPA/SSR build
bunx asijs build --ssg            # Static site generation
bunx asijs build --target cloudflare  # Serverless build

# Interactive REPL
bunx asijs repl

# Plugin management
bunx asijs plugin search auth
bunx asijs plugin install @asijs/auth
bunx asijs plugin create my-plugin
bunx asijs plugin list

# Migrate from other frameworks
bunx asijs integrate ./app.js

# Generate scaffold
bunx asijs generate route users
bunx asijs generate plugin auth

# CLI v2 — Smarter Developer Tools
bunx asijs analyze              # Static analysis: dead routes, validation, bottlenecks
bunx asijs analyze --info --json
bunx asijs doctor               # Project diagnostics: config, deps, strict, security
bunx asijs upgrade --dry-run    # Check for AsiJS updates
bunx asijs upgrade --codemod    # Update + breaking-changes codemod
bunx asijs template api         # Install template into current dir
bunx asijs dev --inspect        # Dev + DevTools hint (dashboard, REPL, analyze)
```

### Templates

| Template | Description |
|----------|-------------|
| `minimal` | Basic setup with routing |
| `api` | REST API with validation, CORS, OpenAPI |
| `fullstack` | API + JSX rendering |
| `auth` | JWT authentication + protected routes |
| `realtime` | WebSocket chat |
| `workspace` | Monorepo with multiple sub-apps |

## 📚 Examples

### REST API with Validation

```typescript
import { Asi, Type } from "asijs";

const app = new Asi();
const users: { id: number; name: string; email: string }[] = [];

app.get("/users", () => users);

app.get("/users/:id", (ctx) => {
  const user = users.find(u => u.id === +ctx.params.id);
  if (!user) return ctx.status(404).jsonResponse({ error: "Not found" });
  return user;
}, {
  params: Type.Object({ id: Type.String() }),
});

app.post("/users", async (ctx) => {
  const body = await ctx.body<{ name: string; email: string }>();
  const user = { id: users.length + 1, ...body };
  users.push(user);
  return ctx.status(201).jsonResponse(user);
}, {
  body: Type.Object({
    name: Type.String({ minLength: 1 }),
    email: Type.String({ format: "email" }),
  }),
});

app.listen(3000);
```

### Circuit Breaker

```typescript
import { Asi, circuitBreaker, apiCircuitBreaker } from "asijs";

const app = new Asi();

// Global: protect against external API failures
app.plugin(circuitBreaker({
  threshold: 5,           // 5 failures → OPEN
  window: 30000,          // 30 second sliding window
  recoveryTimeout: 10000, // 10s recovery
  fallback: () => ({ cached: true, data: [] }),
}));

// Per-route with presets
app.get("/api/external", apiCircuitBreaker(), async (ctx) => {
  const data = await ctx.circuitBreaker!("stripe-api", () =>
    fetch("https://api.stripe.com/v1/charges")
  );
  return data;
});

app.listen(3000);
```

### WebSocket Pub-Sub

```typescript
import { Asi, createRoomManager } from "asijs";

const app = new Asi();
const rooms = createRoomManager({ maxRoomsPerConnection: 10 });

// Create a chat room
app.ws("/chat", {
  open(ws) {
    ws.data = { joinedAt: Date.now() };
  },
  message(ws, message) {
    const msg = typeof message === "string" ? message : JSON.stringify(message);
    rooms.broadcast(msg, { rooms: ["lobby"] });
  },
  close(ws) {
    rooms.cleanup(ws);
  },
}, { roomManager: rooms });

app.listen(3000);
```

### SSG — Static Site Generation

```typescript
import { Asi, buildSSG, staticPath } from "asijs";

const app = new Asi();

app.get("/", () => "<h1>Home</h1>");
app.get("/about", () => "<h1>About</h1>");

// Dynamic routes: define static paths
const paths = [
  staticPath("/blog/:slug", { slug: "hello-world" }),
  staticPath("/blog/:slug", { slug: "second-post" }),
];

// CLI: bunx asijs build --ssg
// Or programmatically:
const result = await buildSSG(app, {
  staticPaths: paths,
  outDir: "./dist",
  pretty: true,  // /about → about/index.html
});
// result: { total: 4, success: 4, failed: 0, duration: 12 }
```

### API Versioning

```typescript
import { Asi, apiVersion, versionPath } from "asijs";

const app = new Asi();

app.plugin(apiVersion({
  defaultVersion: "2.0",
  supportedVersions: ["1.0", "2.0"],
  strategy: "url",       // URL-based: /v1/users, /v2/users
  fallback: "latest",    // Unsupported version → latest
  deprecation: true,     // Add Sunset/Deprecation headers
}));

// v1 users endpoint
app.get(versionPath("/users", "1.0"), () =>
  users.map(u => ({ id: u.id, name: u.name }))
);

// v2 users endpoint (richer response)
app.get(versionPath("/users", "2.0"), () => users);

app.listen(3000);
```

### Built-in Security

```typescript
import { Asi } from "asijs";

// Zero-config: OWASP headers, XSS escape, body limits, CSP nonce
const app = new Asi({
  security: {
    autoEscape: true,
    maxBodySize: "1mb",
    strictContentType: "sanitize",
    headers: {
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
      },
      hsts: { maxAge: 31536000, includeSubDomains: true },
      xFrameOptions: "DENY",
    },
  },
});

// Presets
import { maxSecurity, apiSecurityCore, devSecurity } from "asijs";

app.get("/admin", maxSecurity(), () => "Secure admin page");

app.listen(3000);
```

### Serverless / Edge

```typescript
import { Asi, ServerlessOptimizer } from "asijs";

const app = new Asi();

// Warm start emulation
await ServerlessOptimizer.warmUp(app);

// Routes...
app.get("/api/hello", () => ({ message: "Hello from edge!" }));

// Build for target
// CLI: bunx asijs build --target cloudflare
// CLI: bunx asijs build --target lambda-edge
// CLI: bunx asijs build --target vercel-edge
```

### Framework Adapter — Next.js

```typescript
// app/api/[[...asi]]/route.ts
import { createNextHandler } from "@asijs/next";
import { Asi } from "asijs";

const app = new Asi();
app.get("/api/hello", () => ({ message: "Hello from AsiJS in Next.js!" }));

export const { GET, POST, PUT, DELETE } = createNextHandler(app);
```

## 🔌 Plugins

### Built-in Plugins

| Plugin | Description | Since |
|--------|-------------|-------|
| `cors()` | Cross-Origin Resource Sharing (advanced: dynamic origin, wildcard, PNA) | v1.0 |
| `staticFiles()` | Static file serving with ETag, cache, range requests | v1.0 |
| `openapi()` | OpenAPI/Swagger documentation | v1.0 |
| `rateLimit()` | Rate limiting with sliding window + token bucket | v1.0 |
| `security()` | Security headers (CSP, HSTS, XFO, etc.) | v1.0 |
| `cache()` | Response caching with ETags | v1.0 |
| `trace()` | Request tracing & metrics | v1.0 |
| `lifecycle()` | Graceful shutdown with drain | v1.0 |
| `devMode()` | Development tools (chaos, delay, debug) | v1.0 |
| `mcp()` | Model Context Protocol for AI/LLM | v1.0 |
| `sessions()` | Session middleware (Memory, Cookie, Redis stores) | v1.2 |
| `requestLogger()` | Coloured request logging (4 formats) | v1.2 |
| `compression()` | gzip/brotli response compression | v1.2 |
| `negotiateResponse()` | Content negotiation (JSON/HTML/XML) | v1.2 |
| `healthCheck()` | `/health`, `/ready`, `/live` endpoints | v1.2 |
| `sse()` | Server-Sent Events | v1.2 |
| `graphql()` | GraphQL (Yoga/Helix adapter) | v1.2 |
| `sentry()` | Sentry error tracking | v1.2 |
| `structuredLogger()` | JSON structured logging | v1.2 |
| `circuitBreaker()` | Circuit breaker with 3 states, presets | v1.3 |
| `deduplicate()` | Request dedup + cache stampede protection | v1.3 |
| `playgroundPlugin()` | Browser-based IDE with code editor | v1.3 |
| `apiDocsPlugin()` | Full API documentation portal | v1.3 |
| `apiVersion()` | API versioning (URL/Header/Combined) | v1.3 |
| `authjs()` | Auth.js integration (GitHub, Google, Credentials) | v1.3 |
| `upload()` | File upload (Local, S3, R2) | v1.3 |
| `autoAPI()` | PostgREST-like auto CRUD from database | v1.3 |
| `expressPlugin()` / `koaPlugin()` | Express/Koa middleware wrapper | v1.3 |
| `otelPlugin()` | OpenTelemetry instrumentation | v1.3 |
| `webhooks()` | Stripe/GitHub/Svix signature verification | v1.2 |
| `trustProxy()` | Real IP extraction from X-Forwarded-For | v1.2 |
| `domainRouting()` | Subdomain-based routing | v1.2 |
| `serverPush()` | Link preload headers | v1.2 |

### Plugin Ordering & Dependencies

```typescript
import { createPlugin } from "asijs";

// Plugins can declare dependencies
const authPlugin = createPlugin({
  name: "auth",
  dependencies: ["sessions", "cors"],
  setup(app) {
    app.before(async (ctx) => {
      ctx.user = await authenticate(ctx);
    });
  },
});

app.plugin(authPlugin());  // Auto-ordered: sessions → cors → auth
app.pluginInfo();           // Visualize dependency graph
```

## 📦 Ecosystem Packages

| Package | Description | Tests |
|---------|-------------|-------|
| `@asijs/next` | Next.js App Router / Pages Router / Edge adapter | 10 ✅ |
| `@asijs/astro` | Astro server endpoints + middleware | 7 ✅ |
| `@asijs/remix` | Remix resource routes + loader/action | 8 ✅ |
| `@asijs/sveltekit` | SvelteKit handle hook + server/universal handlers | 8 ✅ |
| `@asijs/opentelemetry` | Full OTel: spans, metrics, logs. 5 exporters | 22 ✅ |
| `eslint-plugin-asijs` | 4 ESLint rules for AsiJS projects | ✅ |

### VS Code Extension — `asijs-code`

- 15 code snippets (GET/POST, WebSocket, CORS, JWT, OpenAPI, etc.)
- Route Explorer webview with colour-coded method badges
- Hover provider showing method + path on `app.get()/post()`
- Debug Configuration Provider (Launch, Attach, Workspace)
- Template Explorer (9 templates, 4 categories, search, preview)
- Create Project Wizard (4-step GUI)
- Inline Diagnostics (6 checks: missing dep, missing app, async/await, TODO/FIXME)

## 🛡️ Security (Built-in)

AsiJS includes a **zero-config security module** as part of `AsiConfig`:

```typescript
const app = new Asi({
  security: {
    autoEscape: true,              // Auto-escape HTML in responses (XSS)
    maxBodySize: "1mb",            // Limit request body size
    autoNonce: true,               // Auto-generate CSP nonces
    strictContentType: "sanitize", // Sanitize Content-Type headers
    headers: {
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
      },
      hsts: { maxAge: 31536000, includeSubDomains: true },
      xFrameOptions: "DENY",
      xContentTypeOptions: "nosniff",
      referrerPolicy: "strict-origin-when-cross-origin",
    },
  },
});
```

**Presets:**
- `maxSecurity()` — Maximum security for web apps (strict CSP, strict HSTS)
- `apiSecurityCore()` — Minimal overhead for API-only services
- `devSecurity()` — Relaxed for development (inline scripts allowed)

Includes **OWASP-recommended headers** by default: CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy.

## 📊 Benchmarks

AsiJS is built for performance. Full benchmark dashboard available at `/benchmarks/`.

### Production Benchmarks (v1.4.1)

| Scenario | Requests/sec | vs Elysia | vs Hono |
|----------|-------------|-----------|---------|
| GET / (compiled) | ~92,000 | ~82% | ~108% |
| POST /users + validation | ~44,000 | ~100% | ~120% |
| Complex validation (nested) | ~107,000 | ~103% | — |
| JSX rendering (100-row table) | ~54,900 | — | ~280% |
| Blog API GET /posts | ~152,000 | ~100% | ~122% |
| Blog API POST /posts (auth+val) | ~161,000 | ~118% | — |
| Middleware chain (5 mw) | ~189,000 | ~46% | ~165% |

Run benchmarks yourself:
```bash
bun run bench:production
```

### Benchmark Dashboard

AsiJS includes an automated benchmark dashboard:
- `bun run bench:collect` — run all benchmarks
- `bun run bench:dashboard` — generate Chart.js HTML dashboard
- Integrated into vitepress docs at `/benchmarks/`
- CI pipeline auto-generates on every push to main

## 📁 Project Structure

```
asijs/
├── src/
│   ├── asi.ts                  # Core framework
│   ├── router.ts               # Trie router
│   ├── router-perf.ts          # Radix tree + middleware flattener
│   ├── context.ts              # Request context
│   ├── validation.ts           # TypeBox validation
│   ├── compiler.ts             # Route compiler
│   ├── security-core.ts        # Built-in security module
│   ├── circuit-breaker.ts      # Circuit breaker resilience
│   ├── deduplicate.ts          # Request dedup + cache stampede
│   ├── ws-pubsub.ts            # WebSocket pub/sub rooms
│   ├── ws-redis.ts             # Redis pub-sub bridge
│   ├── api-version.ts          # API versioning
│   ├── ssg.ts                  # Static site generation
│   ├── serverless.ts           # Serverless optimisation
│   ├── api-docs.ts             # API documentation portal
│   ├── hot-reload.ts           # Hot reload 2.0
│   ├── hmr.ts                  # HMR browser push
│   ├── repl.ts                 # Interactive REPL
│   ├── playground.ts           # Web playground
│   ├── plugin-deps.ts          # Plugin dependency manager
│   ├── plugin-registry.ts      # Plugin registry
│   ├── migrate-express.ts      # Express migration
│   ├── migrate-koa.ts          # Koa migration
│   ├── authjs.ts               # Auth.js integration
│   ├── upload.ts               # File upload provider
│   ├── auto-api.ts             # PostgREST-like auto API
│   ├── codegen.ts              # OpenAPI client codegen
│   └── plugins/
│       ├── cors.ts             # CORS plugin
│       └── static.ts           # Static files plugin
├── packages/
│   ├── vscode-asijs/           # VS Code extension
│   ├── eslint-plugin-asijs/    # ESLint rules
│   ├── next-asijs/             # Next.js adapter
│   ├── astro-asijs/            # Astro adapter
│   ├── remix-asijs/            # Remix adapter
│   ├── sveltekit-asijs/        # SvelteKit adapter
│   └── opentelemetry-asijs/    # OpenTelemetry integration
├── examples/                   # Example apps
├── test/                       # 1373 tests
│   ├── integration/            # Docker-based integration tests
│   ├── e2e/                    # End-to-end tests
│   └── k6/                     # k6 load testing scripts
├── bench/                      # Benchmarks + dashboard
└── docs/                       # VitePress documentation site
```

## 🧪 Testing

```bash
# Run all tests (1373 tests)
bun test

# With coverage
bun test --coverage

# Integration tests (requires Docker)
bun test test/integration/

# E2E tests
bun test test/e2e/

# Load testing with k6
bun run test:k6

# TypeScript check
bun run typecheck
```

### Test Quality

- **1373 tests** — all passing, 0 failures
- **Integration tests** — Docker-based PostgreSQL, Redis, MinIO
- **E2E tests** — Full cycle: auth → upload → CRUD → WebSocket
- **Load tests** — k6 scenarios: auth flow, CRUD, WebSocket, file upload
- **0 TypeScript errors** (`tsc --noEmit`)
- **Pre-release security audit** — All v1.3 modules reviewed: 3 CRITICAL fixes, 2 HIGH fixes, 3 MEDIUM fixes

## 🤖 MCP — AI/LLM Integration

AsiJS supports the **Model Context Protocol** for AI assistant integration:

```typescript
import { Asi, mcp, createMCPServer } from "asijs";

const app = new Asi();

// Add routes...
app.get("/users", () => users);

// Add MCP plugin for AI assistants
app.plugin(mcp({
  name: "my-api",
  version: "1.0.0",
  tools: [
    {
      name: "list_users",
      description: "List all users",
      inputSchema: { type: "object", properties: {} },
      handler: async () => ({
        content: [{ type: "text", text: JSON.stringify(users) }]
      }),
    },
  ],
}));

// Run as MCP server for Claude Desktop, Cursor, etc.
const mcpServer = createMCPServer(app);
await mcpServer.start();
```

## 📘 Documentation

Full documentation available at the [VitePress docs site](https://baconana-chan.github.io/asijs/):

- [Getting Started](docs/getting-started.md)
- [Routing](docs/routing.md)
- [Validation](docs/validation.md)
- [Context](docs/context.md)
- [Plugins](docs/plugins.md)
- [Auth](docs/features/auth.md)
- [OpenAPI](docs/features/openapi.md)
- [WebSocket](docs/features/websocket.md)
- [Rate Limiting](docs/features/rate-limiting.md)
- [Caching](docs/features/caching.md)
- [Security](docs/features/security.md)
- [SSG](docs/features/ssg.md)
- [MCP](docs/features/mcp.md)
- [MCP v2 — AI-Native Protocol](docs/features/mcp-v2.md)
- [Async Error Boundary](docs/features/error-boundary.md)
- [Observability](docs/features/observability.md)
- [API Versioning](docs/features/api-versioning.md)
- [Circuit Breaker](docs/features/circuit-breaker.md)
- [Framework Adapters](docs/features/adapters.md)
- [Benchmarks](docs/benchmarks/)
- [Migration Guide](docs/migration/)

## 🤝 Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing`)
5. Open a Pull Request

## 📝 License

MIT License — see [LICENSE](LICENSE) file for details.

## 🙏 Credits

- Built with [Bun](https://bun.sh)
- Validation by [TypeBox](https://github.com/sinclairzx81/typebox)
- Inspired by [Elysia](https://elysiajs.com) and [Hono](https://hono.dev)

---

<div align="center">
  <sub>Made with ❤️ for the Bun ecosystem</sub>
</div>
