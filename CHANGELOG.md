# Changelog

All notable changes to AsiJS will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
