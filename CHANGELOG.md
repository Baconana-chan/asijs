# Changelog

All notable changes to AsiJS will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-07-15

### ⚠️ Breaking Changes

- **`app.notFound()` renamed to `app.onNotFound()`** — Aligns with the naming convention of `onError`, `onBeforeHandle`, `onAfterHandle`. The old name is removed. Use the codemod (`asi migrate`) or search/replace `app.notFound` → `app.onNotFound`.

### 🚀 Major New Features

#### Core Framework Enhancements
- **Router Performance (P3.8)** — New `RadixTreeRouter` with compressed radix tree and binary-search static children; `MiddlewareChainFlattener` for compile-time chain optimization; `SchemaCacheLRU` for bounded TypeBox validator caching. Config: `router: "trie" | "radix"`, `flattenMiddleware`, `lruSchemaCache`
- **Response Validation (P3.11)** — `createResponseValidator()` validates handler output against response TypeBox schemas in dev mode (warn/error/silent modes)
- **OpenAPI 3.1 / JSON Schema 2020-12 (P3.11)** — `upgradeToOpenAPI31()` converts 3.0.x docs to 3.1.0; `createOpenAPI31Generator()` reuse existing `OpenAPIGenerator`
- **Graceful Shutdown (P2.8)** — `drainWebSockets()` with 1001 close frames, lifecycle integration
- **Content Negotiation (P2.6)** — `parseAccept()`, `bestMatch()`, `ctx.negotiate()` for JSON/HTML/XML/auto selection
- **Response Compression (P2.5)** — gzip/brotli via Bun native + Node.js zlib fallback, configurable threshold/content-types
- **Rate Limit Presets (P2.7)** — `rateLimitPresets.byIp`, `.byApiKey()`, `.byUserId()`, `.byHeader()`, `.combine()`

#### CLI & DX
- **`asi inspect` (P2.10)** — Route/plugin/middleware/size analysis with color-coded tables
- **`asi generate` (P3.9)** — Scaffold routes, server actions, plugins, and sub-apps
- **Pretty Error Page (P2.4)** — Stack trace with source context, syntax highlighting, collapsible frames, env info panel, "Copy error" button
- **`asi build`** — Production SPA/SSR build pipeline

#### Node.js Adapter (P1.2)
- Pluggable `ServerAdapter` interface with full Node.js HTTP(S) support
- EADDRINUSE retry with automatic port scanning
- WebSocket via `ws` package (beforeUpgrade, echo, multiple routes)
- Entry point: `asijs/node`

#### Sessions (P1.3)
- `sessions()` middleware with MemoryStore, CookieStore
- Signed cookies (HMAC-SHA256), TTL-based auto-cleanup
- Type-safe `session.get<User>("key")`

#### SSE (P2.1)
- `app.sse("/events", handler)` with auto-reconnect, id, retry
- Client helper: `createSSEClient(url)`

#### Platform Adapters (P3.3)
- `denoServe()` — native `Deno.serve` with auto-detect
- Cloudflare Workers: `withWaitUntil()`, `withEdgeCache()`
- Lambda@Edge, Vercel Edge, Netlify Edge
- `createStaticHandler()` — edge-safe static serving

#### SPA + Hybrid Rendering (P3.4)
- `spa: true` in AsiConfig with `SPAOptions` (clientEntry, hmr, islands)
- Client-side hydration (`hydrate()`, `hydrateIslands()`, `connectHMR()`)
- Islands architecture (`createIsland()`, `island()` compile-time markers)
- `asi build` — production pipeline

#### Web Infrastructure (P3.10)
- **Webhooks** — signature verification for Stripe, GitHub, Svix with `crypto.subtle`
- **Range Requests** — 206 Partial Content, 416 handling, content-type whitelist
- **Trust Proxy** — real IP extraction from X-Forwarded-For / X-Real-IP
- **Subdomain Routing** — `domainRouting()` / `domainRoute()` per-hostname routing
- **index.html Auto-Serve** — SPA fallback, non-blocking for API routes
- **Server Push Hints** — Link preload headers

#### Type Safety (P3.11)
- **Type-safe i18n** — `createTypedTranslator<T>()`, `TranslationKeys<T>` for autocomplete
- **Response validation** — `createResponseValidator()` for dev mode

### 🧩 Ecosystem (P3.9)

#### VS Code Extension (`packages/vscode-asijs/`)
- 15 code snippets (GET/POST, WebSocket, CORS, JWT, OpenAPI, Server Actions, etc.)
- Route Explorer webview panel with color-coded method badges, goto-line
- Hover provider for `app.get()/post()` showing method + path

#### ESLint Plugin (`packages/eslint-plugin-asijs/`)
- `no-duplicate-route` — detects duplicate registrations with first-definition line
- `no-missing-handler` — ensures routes have handler functions
- `validate-schema` — ensures URL params have validation schemas
- `no-unused-route` — warns about unused routes
- Configs: `recommended` + `all`

#### OpenAPI Client Codegen (`src/codegen.ts`)
- `generateClient(spec, options)` — generates TypeScript fetch client from OpenAPI schema
- Path/query/body params, response types, bearer auth, JSDoc

#### Auth.js Adapter (`src/authjs.ts`)
- `authjs()` plugin — session middleware + signin/signout/session/providers/csrf routes
- Built-in providers: GitHub, Google, Credentials
- Custom JWT with `crypto.subtle` (HMAC-SHA256)
- `requireAuth` / `requireRole()` middleware helpers

#### Upload Provider (`src/upload.ts`)
- Local, S3-compatible, Cloudflare R2 storage
- Multipart file upload middleware, MIME validation, size limits

#### PostgREST-like Auto API (`src/auto-api.ts`)
- Auto-generates CRUD endpoints from database tables
- PostgREST-style filters (`field=gt.10`, `like.*pattern*`, `is.null`)
- Pagination, sorting, schema introspection

### 📦 New Modules

#### Redis Integration
- `RedisRateLimitStore` — distributed sliding window rate limiting
- `RedisQueue` — background job queue with FIFO, delayed jobs, dead letter queue

#### JSON Streaming
- `createJsonStream()` / `streamJsonResponse()` — streaming JSON arrays
- `createNDJsonStream()` / `streamNDJsonResponse()` — NDJSON streaming

#### Structured Logging / Sentry
- `structuredLogger()` — JSON log middleware for ELK/Datadog/Splunk
- `sentry()` — fetch-based Sentry error tracking (no SDK required)
- Prometheus `/metrics` in OpenMetrics format

#### GraphQL Plugin
- `graphql()` plugin with Yoga/GraphQL Helix adapter

#### DI / Module Decorators
- `DIContainer`, `@Module()`, `@Injectable()` decorators
- Singleton/transient/request scoped providers

#### Workspace v2
- `Workspace` class with unified `Bun.serve()` for multi-app production deployment
- Dev dashboard at `/__asi/workspace`
- Unified OpenAPI at `/__asi/docs`

#### Benchmarks Dashboard
- `bench/collect.ts` + `bench/generate-dashboard.ts`
- Chart.js dashboard with bar charts and trend lines
- GitHub Actions CI pipeline with gh-pages deploy

### 🔧 Improvements

#### CLI
- **`asi inspect`** — route table, plugin list, bundle size analysis
- **`asi build`** — production SPA/SSR build
- **`asi generate`** — route/action/plugin/app scaffolding
- Templates: `cloudflare`, `deno`, `spa` workspace variants

#### Documentation
- Full VitePress docs site (23 pages, search, gh-pages deploy)
- Updated MIGRATION.md with codemod guide
- Updated DOCUMENTATION.md with all new features

#### Plugin System
- New plugins: `sessions`, `requestLogger`, `compression`, `negotiate`, `devMode(chaos)`, `healthCheck`, `sse`, `graphql`, `sentry`, `structuredLogger`
- Plugin dependencies and duplicate prevention

### 🐛 Bug Fixes

- Fixed: `PORT` env var mutation in tests (added try/finally)
- Fixed: ENOENT in `findStandaloneEntry()` test (missing mkdirSync)
- Fixed: XSS in error page stack trace
- Fixed: EADDRINUSE handling in Node.js adapter
- Fixed: Radix tree miss now correctly returns 404
- Fixed: `group()` routes not syncing with radix router
- Fixed: CORS wildcard matching for single '*' origin
- Fixed: Double clone in `upgradeToOpenAPI31`
- Fixed: TypeScript export issues (requireAuth alias, schema exports)

### 📊 Test Improvements

- **700 total tests** (up from 568) — all passing, 0 type errors
- New test files: error-pages (41), type-safety (22), web-infra (24), ecosystem (19), node-adapter (21), router-perf (33), json-stream (34), session, logger, compression, negotiate, health, sse, dev-error-page, cors-advanced, docker, cli-inspect, benchmarks, workspace-v2, spa, sentry, structured-logger, redis, graphql, di, platform-adapters
- Full coverage for all P0-P3 features

### 🔬 Performance

- **Radix Tree Router** — up to 2× faster for 1M+ routes (compressed nodes, binary search)
- **Middleware Chain Flattener** — compile-time flattening eliminates per-request loop overhead
- **LRU Schema Cache** — prevents unbounded growth with 10k+ schemas
- **Schema Cache LRU** — bounded memory for TypeBox compiled validators

---

## [1.1.1] - 2026-02-06

### Optimized
- i18n: faster locale detection (path/query/cookie/header) using cached Accept-Language parsing
- i18n: cached Intl formatter keys to reduce repeated JSON stringify
- Edge adapters: reduced URL parsing in handlers and basePath stripping
- Edge static handler: avoid extra buffer allocations for cached assets
- ConnectionPool: faster wait-queue handling and correct max size check

### Benchmarks (post-optimizations)
- GET / (compiled): ~77–85% of Elysia
- GET /user/:id (compiled): ~69–73% of Elysia
- GET /search (compiled): ~66–76% of Elysia
- POST /users (compiled): ~81–84% of Elysia
- POST /users + validation (compiled): ~97–100% of Elysia

## [1.1.0] - 2026-02-05

### Added

#### Internationalization (i18n)
- **I18n Class** — Full internationalization with translations, interpolation, and pluralization
- **Locale Detection** — Automatic detection from Accept-Language header, cookies, query params, URL path
- **Formatting** — Date, time, number, currency, and list formatting via Intl API
- **Pluralization** — Intl.PluralRules support for all languages (including complex rules like Russian)
- **RTL Detection** — Automatic right-to-left language detection
- **Fallback Locales** — Configurable fallback chain for missing translations
- **i18n Plugin** — `i18n()` plugin for app integration with context helpers

#### Edge/Serverless Adapters
- **toFetchHandler()** — Universal adapter for any Fetch API environment
- **cloudflare()** — Cloudflare Workers adapter with env/ctx access
- **vercelEdge()** — Vercel Edge Functions adapter with GET/POST/etc exports
- **deno()** — Deno Deploy adapter
- **lambdaEdge()** — AWS Lambda@Edge adapter with CloudFront event handling
- **netlifyEdge()** — Netlify Edge Functions adapter
- **createStaticHandler()** — Edge-compatible static asset serving
- **combineHandlers()** — Combine multiple handlers with routing
- **withCORS()** — CORS wrapper for edge handlers

#### Test Utilities
- **mockContext()** — Create mock Context for unit testing handlers
- **mockFormDataContext()** — Mock context with FormData
- **testClient()** — HTTP client for integration testing
- **buildRequest()** — Build mock Request objects
- **buildFormData()** — Build FormData from objects
- **mockFile()** — Create mock File objects
- **Assertions** — `assertStatus`, `assertOk`, `assertHeader`, `assertContentType`, `assertJson`, `assertContains`, `assertRedirect`
- **setupTest()** — Quick test setup helper
- **withApp()** — Wrapper for app lifecycle in tests
- **snapshotResponse()** — Response snapshot for comparison testing
- **measureHandler()** — Performance measurement for handlers
- **benchmarkRoute()** — Full route benchmarking

#### Database Helpers
- **drizzlePlugin()** — Drizzle ORM integration plugin
- **prismaPlugin()** — Prisma integration plugin
- **kyselyPlugin()** — Kysely integration plugin
- **databasePlugin()** — Generic database plugin
- **ConnectionPool** — Connection pooling with min/max, idle timeout, health checks
- **sql template tag** — Parameterized query builder
- **buildWhere()** — WHERE clause builder from objects
- **buildInsert()** — INSERT statement builder
- **buildUpdate()** — UPDATE statement builder
- **createRepository()** — Generic CRUD repository factory
- **withTransaction()** — Transaction wrapper for Drizzle
- **prismaTransaction()** — Transaction wrapper for Prisma
- **kyselyTransaction()** — Transaction wrapper for Kysely
- **runMigrations()** — Migration runner
- **rollbackMigration()** — Migration rollback

### Changed
- Updated exports in `src/index.ts` to include all new modules
- Updated `jsr.json` with new entry points for i18n, edge, testing, database

## [1.0.1] - 2026-02-04

### Fixed
- Minor documentation fixes
- Package metadata updates

## [1.0.0] - 2026-02-04

### 🎉 Initial Release

First stable release of AsiJS — a Bun-first web framework focused on performance, type-safety, and developer experience.

### Added

#### Core Framework
- **Routing** — Trie-based router with static path optimization
- **HTTP Methods** — `get`, `post`, `put`, `patch`, `delete`, `all`, `options`, `head`
- **Route Parameters** — `:param` dynamic segments and `*` wildcards
- **Route Groups** — `app.group()` for organizing routes with shared prefix/middleware
- **Context Object** — Rich `ctx` with helpers for headers, cookies, body parsing, responses

#### Validation (TypeBox)
- **Body Validation** — `body: Type.Object({...})` with automatic parsing
- **Query Validation** — `query: Type.Object({...})` with coercion
- **Params Validation** — `params: Type.Object({...})` with type coercion
- **FormData Validation** — `FormDataSchema()` for form fields
- **File Validation** — `FileSchema()` with size/MIME type checks

#### Middleware & Hooks
- **Global Middleware** — `app.use()` for all routes
- **Path Middleware** — `app.use('/api', middleware)` for specific paths
- **Route Middleware** — Inline middleware per route
- **Lifecycle Hooks** — `onBeforeHandle`, `onAfterHandle`
- **Error Handling** — `onError`, `on404` custom handlers

#### Plugin System
- **createPlugin()** — Full-featured plugin creation
- **pluginFn()** — Simple function plugins
- **decorators()** — Add properties to context
- **sharedState()** — Shared state across requests
- **guard()** — Route protection plugins
- Plugin dependencies and duplicate prevention

#### Authentication & Security
- **JWT** — `jwt()` helper with sign/verify/decode
- **Bearer Auth** — `bearer()` middleware for protected routes
- **Password Hashing** — `hashPassword()`, `verifyPassword()` (Argon2 via Bun)
- **Token Generation** — `generateToken()` for secure random tokens
- **CSRF Protection** — `csrf()` middleware
- **Security Headers** — `securityHeaders()` middleware (CSP, HSTS, etc.)
- **Security Presets** — `strictSecurity`, `relaxedSecurity`, `apiSecurity`

#### Rate Limiting
- **MemoryStore** — Sliding window algorithm
- **TokenBucketStore** — Token bucket algorithm
- **rateLimitMiddleware()** — Per-route limiting
- **rateLimit()** — Global rate limit plugin
- **Presets** — `standardLimit`, `strictLimit`, `apiLimit`, `authLimit`

#### OpenAPI / Swagger
- **OpenAPIGenerator** — Auto-generate OpenAPI 3.0 spec
- **openapi()** — Plugin with Swagger UI at `/docs`
- **TypeBox → JSON Schema** — Automatic conversion
- **Security Schemes** — Bearer, API Key, OAuth2

#### JSX Rendering
- **jsx()** / **jsxs()** — JSX factory functions
- **Fragment** — `<>...</>` support
- **renderToString()** — Sync rendering
- **renderToStream()** — Streaming HTML
- **html()** / **stream()** — Response helpers
- **escapeHtml()** — XSS prevention
- **htmlTemplate\`\`** — Tagged template literals
- **when()** / **each()** — Conditional/list helpers
- **jsx-runtime** — React JSX transform compatible

#### WebSocket
- **app.ws()** — WebSocket route handler
- **Lifecycle Hooks** — `open`, `message`, `close`, `error`
- **Per-socket Data** — Custom data per connection

#### Caching
- **MemoryCache** — In-memory cache with TTL
- **etag()** — Automatic ETag generation + 304
- **cache()** — Cache-Control header middleware
- **parseTTL()** — Human-readable TTL ("1h", "30m")
- **Presets** — `staticCache`, `apiCache`, `cdnCache`

#### Tracing & Observability
- **trace()** — Request tracing plugin
- **Request ID** — Auto-generated unique IDs
- **W3C Trace Context** — `traceparent` header support
- **Server-Timing** — Performance timing headers
- **MetricsCollector** — Prometheus-style metrics
- **Timing** — Utility for measuring operations

#### Scheduler / Cron
- **Scheduler** — Background task scheduler
- **parseCron()** — Standard 5-field cron expressions
- **Shortcuts** — `@daily`, `@hourly`, `@weekly`, `@monthly`
- **interval()** / **cron()** — Job creation helpers
- **Presets** — `schedules.everyMinute`, `schedules.daily`, etc.

#### Lifecycle Management
- **LifecycleManager** — Graceful shutdown handling
- **lifecycle()** — Plugin for auto-integration
- **healthCheck()** — `/health`, `/ready`, `/live` endpoints
- **Signal Handling** — SIGTERM, SIGINT support

#### Server Actions
- **action()** — Type-safe server actions with validation
- **simpleAction()** — Actions without input validation
- **registerActions()** — Register actions as POST endpoints
- **registerBatchActions()** — Batch multiple actions
- **formAction()** — HTML form actions with redirects
- **ActionError** — Custom errors with codes/status
- **Middleware** — `requireAuth()`, `actionRateLimit()`, `actionLogger()`
- **createActionsClient()** — Typed client for calling actions

#### MCP (Model Context Protocol)
- **MCPServer** — JSON-RPC 2.0 protocol implementation
- **mcp()** — Plugin for MCP integration
- **createMCPServer()** — Stdio server for AI assistants
- **Built-in Tools** — `list_routes`, `get_route_details`, `analyze_route`
- **Built-in Resources** — Routes, config, OpenAPI spec, docs

#### Typed Client
- **createClient()** — Simple HTTP client
- **treaty()** — Proxy-based type-safe client
- **batchRequest()** — Parallel requests
- **withRetry()** — Exponential backoff retry

#### Development Mode
- **devMode()** — Dev dashboard plugin
- **/__dev** — Routes and requests inspector
- **debugLog()** — Request logging middleware
- **delay()** — Artificial delay for testing
- **chaos()** — Random failure injection

#### CLI
- **bunx asijs create** — Project scaffolding
- **Templates** — minimal, api, fullstack, auth, realtime
- **Interactive Mode** — Template selection prompt

#### Plugins (Built-in)
- **cors()** — CORS handling with full configuration
- **staticFiles()** — Static file serving

#### Performance Optimizations
- **Route Compilation** — `app.compile()` for production
- **Static Router** — O(1) lookup for static paths
- **TypeCompiler** — Pre-compiled TypeBox validators
- **Lazy Body Parsing** — Parse only when accessed
- **Minimal Allocations** — Optimized hot path

#### Developer Experience
- **Auto Port** — Find next available port if busy
- **PORT=0** — Random port assignment
- **Detailed Errors** — Validation errors with path/expected/received
- **Route Suggestions** — Similar routes on 404
- **Startup Diagnostics** — Clear server info on start

### Performance

Benchmarks on Windows 10, 8 CPU cores, 24GB RAM:

| Framework | GET / | POST /users (validation) |
|-----------|-------|--------------------------|
| Raw Bun | ~125k req/s | — |
| **AsiJS (compiled)** | ~92k req/s | ~44k req/s |
| Elysia | ~112k req/s | ~43.5k req/s |
| Hono | ~85k req/s | ~38k req/s |

### Documentation
- **README.md** — Quick start, examples, benchmarks
- **DOCUMENTATION.md** — Complete API reference
- **MIGRATION.md** — Migration guide from Elysia/Hono
- **Examples** — 8 full examples in `/examples`

---

## [Unreleased]

### Planned
- GraphQL plugin/adapter
- Edge/serverless export (Cloudflare, Vercel)
- Workspace / Multi-app support
- SPA + Hydration mode
- i18n plugin
