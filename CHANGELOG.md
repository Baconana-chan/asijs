# Changelog

All notable changes to AsiJS will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.0] - Unreleased

- Lalala

## [1.5.0] - 2026-08-17

### 🚀 New Features

**🦀 Native / Polyglot Modules (`src/native/`)** — write functions in other languages and call them from handlers without WASM:
- **FFI languages** (via `bun:ffi`, zero manual glue): C, C++, Go, Rust, Zig, Nim, Haskell — `asi native scaffold <lang>` generates stubs + manifest + typed wrappers; `src/native/generate-*.ts` for each language, `ctx.native` runtime, watch mode (`asi native watch`)
- **Sidecar languages** (via `Bun.spawn` + JSON-RPC): Python, Ruby, PHP
- **Lua** — embedded interpreter via `dlopen(liblua)` (option A from the TODO: no compilation, no IPC)
- End-to-end examples: `proj-{c,cpp,go,zig}` (real `cc`/`go build`/`zig build` builds), language table in `TODO_native.md`, toolchain installation guides
- Tests: `test/native*.test.ts` (native, native-dev, native-langs, native-sidecar) — dlopen round-trips and spawn tests for real languages

**🔄 Data Formats layer (`src/formats.ts`)** — "default format" as a single setting:
- `DataFormat` interface + registry (`registerFormat` / `getFormat` / `listFormats`): JSON native (zero-dep), YAML lazy adapter via `yaml` (`createRequire`, no import cost), custom formats (TOML/INI/…) register in 3 lines
- `ctx.parseBody(format?)` — parses the body by `Content-Type` (JSON/YAML/custom), explicit format via argument; lazy + cached (one parse per request); the non-existent `ctx.body()` promised by the docs was replaced with the real method (the `ctx.body` property is the validated body — a naming conflict)
- `asi.setFormat()` + `format` option in `AsiConfig` — object responses, errors (500/400) and 404 bodies serialize in the default format; compiled routes (`app.compile()`) and static precompute respect the format
- **Accept-negotiation** — via the existing `bestMatch()`: `Accept: application/yaml` answers YAML even with a JSON default; the fast path stays zero-cost with a single JSON format
- **Format-aware route validation** — body validation reads the body via `ctx.parseBody()` instead of `ctx.json()` (wrapHandler + all three compiled paths in `compiler.ts`): TOON/YAML bodies validate against TypeBox schemas unchanged

**⚙️ JSON Schema Response Serialization (`src/serialize.ts`, 3.2)** — response compilation like fast-json-stringify:
- `compileSerializer(schema)` — pre-compiles TypeBox/JSON Schema → fast serializer (codegen): all-required objects concatenated directly, optional ones use a parts-array, non-codegenable schemas fall back to `JSON.stringify`; identity cache + `resetSerializerCache()`
- `schema.response` — status-keyed serialization (`{200, "2xx", default}`) + per-content-type `serializers` with Accept negotiation; status and Set-Cookie preserved
- `serializeForCache`/`deserializeFromCache` — V8.serialize binary helpers for internal caches
- E2E benchmark: schema route **×1.4** faster than plain JSON through the real framework (specialized compiled path instead of generic `Response.json`)

**📦 New packages:**
- **`graphql-asijs`** (3.8) — GraphQL Plugin v2: code-first TypeBox → SDL (`defineSchema`), HTTP + WebSocket transports (full graphql-ws protocol), Apollo Federation subgraphs, `DataLoader` + query complexity. 42 tests + a real ws-e2e (client → ack → 3×next → complete)
- **`asijs-react`** (3.7) — React Server Components for AsiJS: Flight, streaming SSR + hydration (24 tests)
- **`asijs-vite`** (3.5) — AsiJS inside a Vite dev server: single port, HMR bridge, Rolldown SSR build (16 tests)
- **`toon-asijs`** — TOON (Token-Oriented Object Notation, token-optimized LLM format) as a native DataFormat on top of the official `@toon-format/toon` SDK: `registerToonFormat()` → `setFormat("toon")`, `Content-Type: application/toon` parsing, Accept-negotiation, errors/404 in TOON (~30–60% fewer tokens than JSON). 21 unit tests + 13 integration tests
- **`MiyoCSS`** — SSR-first CSS + SVG framework: design tokens (TypeBox + `defineConfig` with extend), utility generator on `resolveConfig()` (layout/flex/grid/spacing/typography/colors/borders/sizing + arbitrary values with validation), `hover:/focus:/md:/dark:` variants with composition, SSR build (`miyocss.render()`), `miyocss info` CLI. 129 tests

### 🐛 Bug Fixes

- **PluginHost: `ws()` for plugins** — plugins could not register WebSocket routes (only HTTP verbs were available). Added `ws` to the `PluginHost` interface + implementation in `_createPluginHost()` (required to mount `/graphql/ws` from the graphql plugin)
- **Docs promised a non-existent `ctx.body()`** — the method did not exist on Context (the `ctx.body` property is the validated body). Replaced with the real `ctx.parseBody()` in README/docs/context.md/docs/routing.md
- **Root benchmark scripts `bun --cwd bench run …`** — printed usage instead of running; fixed to `cd bench && bun run …` (bench, bench:production, bench:serialize, bench:fullstack)

### 📊 Benchmarking

- **SSR category: Node-first frameworks** — `bench/ssr.ts` + `bench/frameworks/{sveltekit,astro,nuxt}`: production servers on ports (C=32 concurrent fetch), 100-row table. AsiJS (JSX + string) vs Hono vs **Astro** (@astrojs/node standalone) vs **SvelteKit** (@sveltejs/adapter-node) vs **Nuxt** (nitro `bun` preset). Build with `bun run bench:ssr:build`, CI opt-in via the `run_ssr_frameworks` input; collect picks up the group (graceful skip without builds)
- **Serialization bench** — `bench/serialize.ts` (bun run bench:serialize): honest result — on Bun, raw codegen ≈ 60–90% of native `JSON.stringify`, but the end-to-end schema route is ×1.4 faster than plain JSON
- **Competitors updated to current versions** — so AsiJS never races year-old code: hono 4.13.2, elysia 1.4.29 (+ @elysiajs/* plugins), astro 7.2.2, nuxt 4.5.2, sveltekit 2.70.2 + vite 7
- **Bench fixes surfaced by the update**: `elysia-rate-limit@5.1.0` is incompatible with elysia 1.4.x (removed internal `plugin.beforeHandle`) → inline limiter on the public `onBeforeHandle`; TypeBox 0.34 removed built-in formats → `format: "email"` removed from complex-validation schemas (AsiJS and Elysia identical)

### 📚 Docs & DX

- **Full package docs** — `docs/packages/*` (14 pages: next, astro, remix, sveltekit, mcp, opentelemetry, eslint, vscode, vite, react, graphql, toon, miyocss + overview) + vitepress nav/sidebar
- **`docs/cli.md`** — complete CLI reference; **`docs/features/native.md`** — native modules guide
- **Code-level JSDoc across the whole core** — every public module (Asi, Context, configs, plugins, utilities) got JSDoc with descriptions and examples
- **README brought up to reality** — features (formats/TOON/serialize/native), package table (6 new), project structure, test count (2036), benchmarks

## [1.4.1] - 2026-08-15

### 🚀 Upload: Streaming Saves

- **`upload({ streaming: true })`** — files are saved through the new `saveStream` (memory O(chunk) instead of O(file)): `file.stream()` is written chunk-by-chunk to disk via Bun FileSink (fallback — Node `createWriteStream`). For file-sharing apps this removes a second full in-memory copy of each uploaded file. Implemented for local (FileSink/Node-pipe) and S3/R2 (streaming PUT with `Content-Length` and `duplex: "half"` under Node). If the storage doesn't implement `saveStream`, the middleware seamlessly falls back to the buffered path.
- **Size limit is checked twice**: fast-reject by the declared `file.size` from multipart headers BEFORE reading the stream + mid-stream abort by the actual bytes written (the partial file is deleted — a rejected upload leaves no garbage on disk).
- **Local storage: async writes** — `writeFileSync` (blocked the event loop for the whole disk IO, ~220ms per 50MB) replaced with `writeFile` (fs/promises). The buffered path no longer blocks either.
- **Benchmark `3c. File Upload + Save to Disk (256KB)`** — CI upload benchmarks only measured multipart parsing; added a full file-sharing scenario (parse + persist). Locally: streaming 538 req/s vs buffered 421 req/s (**+28%**), and streaming also saves memory.
- **Fully-Loaded GET split into honest pairs** — the old benchmark compared AsiJS full-stack (CORS+security+ETag+cache+rateLimit, 5 layers) against Elysia bare `cors+rateLimit` (2 layers) — "11.2%" looked like a loss even though the work done is incomparable. Now two groups: `1a` — **identical middleware set** on both (AsiJS 49.4k vs Elysia 35.0k = **141%**), `1b` — full-stack 5 layers vs Hono 4 layers (6.3k vs 3.4k = **1.8×**).
- **README: Hono is the primary competitor, Elysia a reference** — AsiJS and Hono are monoliths (everything in the core), Elysia is a microkernel (everything in external `@elysiajs/*` plugins); comparing full stacks of these architectures is apples-to-oranges (a monolithic kernel is bigger than a microkernel by construction). Tables reordered: the `vs Hono` column is apples-to-apples (AsiJS wins 13 of 18 categories), `vs Elysia` is marked `(ref)`. Known Gaps rewritten against Hono with the concrete mechanisms behind each gap (404 body, structured 500, query-miss, static pipeline).
- **README for every package** — `eslint-plugin-asijs`, `asijs-opentelemetry` and `vscode-asijs` had no README (a downside for npm pages and the Marketplace). Added: installation, usage examples, API/command/settings tables, presets and development. Now all 8 packages in `packages/` have a README.md.

### 🐛 Bug Fixes

- **Packaging: dist paths** — `bun build` with multiple entry points placed JS in `dist/src/*.js` (a `src/` prefix), while `main`/`module`/`bin`/`exports` pointed at `dist/*.js` — npm warned "No bin file found at dist/cli.js", and `main`/CLI were broken in the published package. Added `--entry-naming '[name].js'`; output now matches the declared paths (`dist/index.js`, `dist/cli.js`, ...). Validated via `npm pack --dry-run`: 0 warnings. **Important: asijs@1.4.0 was published with this bug — 1.4.1 must be republished.**
- **Silent mode is now actually silent** — `console.error("[Asi Error]")` and error logs in `handleError()`/`notFound()`/plugin hooks were not gated behind `silent: true`, so tests with intentional throws printed large `[Asi Error]` blocks. All error logs are now wrapped in `if (!silent)` (the "disable all logging" contract).
- **ioredis: `error` listener on the client** — an unavailable Redis printed `[ioredis] Unhandled error event` (in production an unhandled 'error' on an EventEmitter can crash the process). Added a no-op listener: connection/operation errors still surface via rejected promises.
- **scanWorkspace: deterministic ports** — ports were assigned BEFORE sorting by name, and `readdirSync` order depends on the filesystem (hash order on Linux) → on Ubuntu CI ports could "swap places" and fail the test. Ports are now assigned AFTER sorting (`3000, 3001, ...` alphabetically).
- **buildSSG: `durationMs` cannot be 0** — `Math.round(...)` on a fast machine (CI) gave 0 for builds under 0.5ms → `expect(durationMs).toBeGreaterThan(0)` failed. Now `Math.max(1, ...)`.
- **Context pool: hot-path regression eliminated** — A/B v1.3.0 vs v1.4.0 on the same machine showed the default context pool slowed a simple `GET /` by **83%** (control frameworks in the microbenchmark: Elysia/Raw Bun/Hono flat ±5%, AsiJS -33%). Causes and fixes in `src/context.ts`: (1) `_reset()` ran **twice** (acquire + release) with a full field scan and 4 allocations — acquire now does a lightweight `_rebind()` (release already left the context clean); (2) the `for..in` scan + `Set.has` to remove middleware properties was replaced with a cheap key count, doing the full scan only when properties were actually added. Result: pool overhead **+83% → ~7%**, pooled `GET /` is now faster than v1.3.0.
- **Middleware chain flattener: not applied to middleware-less routes** — `flattenMiddleware` on a route without middleware did a per-request cache lookup (Map.get + id string) just for a copy of `executeHandler(len === 0)`, costing ~14%. The flattener is now used only when `middlewares.length > 0`; middleware-less routes go through their own `executeHandler` fast path.
- **Radix router: fresh params on static routes** — noted that radix allocates a fresh `params` object on every static match (observed instability/dip on small route tables vs trie) — a candidate for a separate optimization (a shared frozen empty object for static routes).

### 📊 Benchmarking

- **P0 Hot-Path Benchmarks (`bench/p0.ts`)** — new scenarios for the 2.2 work, wired into the CI collector:
  - **Concurrency** (C=10/100/1000 in-flight) — AsiJS vs Elysia vs Hono; shows where the context pool actually pays off. In the local run at C=1000 AsiJS ≈ Elysia (191k vs 190k req/s).
  - **Route Table Scaling** — radix vs trie at N=10/100/1000/10000 routes (last-route lookup — worst case). Confirms: radix is unstable on small tables (fresh-params allocation), ≈ trie at scale — needs the optimization above.
  - **Static: preload vs disk** — memory vs disk: locally **4.9–5.3×** (2.2.7).
  - **Array Validation (100 items) + Validation Error Path** — compiled validation: AsiJS > Elysia on valid arrays and on the error path (invalid payload returns 400 for AsiJS, 422 for Elysia — expected status is respected, no false "errors").
- **Collector parser fix (locale)** — `toLocaleString()` in a Russian Windows locale uses a space as the thousands separator (`16 354`), and the regex `\d[\d,]*` only allowed commas → local collector runs parsed almost zero rows (CI/en-US worked fine). The regex now accepts space/NBSP, and all benchmark output is forced to `toLocaleString("en-US")`. Result: locally **102/102** results parse (was 7).
- **P1 API-Case Benchmarks (`bench/p1.ts`)** — second batch, wired into the CI collector (7 groups):
  - **Query Cache (2.2.6)** — repeated query strings (hit) vs unique (miss) vs `queryCache: false`. The global cache singleton is accounted for: hit/miss run on the cached app, `queryCache: false` is created afterwards (otherwise `disableDefaultQueryCache()` would kill the cache for the hit measurement too). Locally: hit ≈ disabled (64.9k vs 64.5k) > miss (52k) — the cache gives ~25% on repeated queries, hit overhead is minimal (shallow copy on hit).
  - **404 Fast Path** — missing-route lookup: AsiJS vs Elysia vs Hono (expected status 404, no false errors).
  - **Error Path** — handler throws → 500: AsiJS (`silent: true`, no logging), Elysia/Hono with explicit `onError` (500 without stderr noise).
  - **Large JSON Bodies (10KB/100KB, validated)** — compiled validation on large bodies: AsiJS ahead of Elysia at 10KB (7.1k vs 5.8k) and at 100KB (752 vs 609 req/s).
- **P2 Feature Benchmarks (`bench/p2.ts` + `bench/p2-alloc.ts`)** — scenarios for features that had no benchmarks at all (8 groups, wired into the CI collector):
  - **WebSocket Pub/Sub** — broadcast through `RoomManager` with 1/10/100 clients (mock ws: `readyState` + `send`, no real server).
  - **Cache Layer** — `MemoryCache` set/get (2.3M ops/s get vs 940k set), ETag middleware 200 vs 304 fast path, response-cache HIT vs MISS (64k vs 17k ops/s).
  - **Database Layer (2.3)** — sqlite in-memory CRUD: insert/select/update/delete + a 3-statement transaction (5.8k ops/s vs 56k delete).
  - **Allocations** — RSS growth per request, measured in an **isolated subprocess** (`bench/p2-alloc.ts`): Bun does not return OS pages, so sequential in-process measurements would understate the second scenario. Locally: bare GET 2.6–2.8 KB/req, GET + 2 middleware 3.9–4.1 KB/req.
  - Collector parser extended: accepts `ops/s` and `bytes/req` in addition to `req/s` (value folded into `rps`).
- **Dashboard: historical trends across all categories** — previously `RPS Over Time` took the absolute RPS only from the first group containing a framework name (usually `GET / (simple JSON)`) — incomparable across categories (GET /: 800k, upload: 7k) and broken when the group set changed between runs. Now:
  - **`Avg Score vs Best — all categories (%)`** — normalized score: for each snapshot and top-5 framework, the mean of `(rps / groupBest × 100)` across **all** groups where the framework appears. Lower-is-better groups (allocations, bytes/req) are inverted (`groupBest / rps`), so 100% always means "best in category". The tooltip shows the number of groups counted.
  - **`RPS by Category`** — a second chart with a dropdown: raw RPS per group across history (default `GET / (simple JSON)`).
  - Implementation detail: `bun run <script>` inside another bun process hangs (nested spawn) — the subprocess is invoked as `bun p2-alloc.ts` directly; `MemoryCache` holds a cleanup `setInterval`, so `main()` exits via an explicit `process.exit(0)` (otherwise the process hangs after printing and the collector times out).

## [1.4.0] - 2026-08-15

### 🚀 New Features

#### Async Error Boundary — Structured Error Handling
- **`ctx.errorBoundary<T>(fn)`** — catches errors in the handler: `fallback` / `onError(classified)` / `rethrow`. Returns a structured response when an error escapes a route.
- **Error classification** — `classifyError()`: business (4xx) vs system (5xx) vs fatal (crash) vs validation. Errors: `HttpError`, `BusinessError`, `NotFoundError`, `UnauthorizedError`, `ForbiddenError`, `ConflictError`, `SystemError`, `FatalError`. Structured body: `{ error, code, category, details, requestId }`.
- **Error reporting pipeline** — `errorBoundary()` plugin: reporter hooks (Sentry/logger/metrics), `minCategory` filter, `requestId` correlation, global `onError` handler. Helpers: `runErrorReporters`, `tryCatch`.
- **Retry policies** — `retry(fn, { attempts, backoff: fixed|linear|exponential, jitter, shouldRetry, onRetry })` + `computeBackoff()`. Default `shouldRetry`: 5xx and network errors. 26 tests.

#### Observability Suite
- **Structured logging v2 — OTel Logs Bridge** — `otelLogs()` plugin + `OTLPLogsExporter`: StructuredLogEntry → OTLP LogRecord (OTel semantic conventions: service.name, http.request.method, url.path, http.response.status_code, error.type...), batching (bufferSize) + periodic flush, export to any OTLP/HTTP collector (Grafana Loki, SigNoz, Honeycomb). Helpers: `entryToOTLPLogRecord`, `levelToSeverityNumber/Text`, `createOTelLogger`. 4 tests.
- **Distributed tracing — W3C TraceContext via Redis** — `RedisTraceBridge` + `createRedisTraceBridge()`: span events (traceId/spanId/parentSpanId) are published to a Redis pub/sub channel, other instances pick them up and continue the trace. `newTraceId()`/`newSpanId()` are W3C-compatible. 3 tests.
- **Healthcheck dashboard** — `healthDashboard()` middleware: `GET /__health` — live HTML page (status of all components: custom checks, circuit breakers OPEN/CLOSED/HALF_OPEN, PID/uptime/RSS/heap, auto-refresh 5s) + `GET /__health.json` — JSON snapshot (200/503 by status). 5 tests.
- **Metrics dashboard** — `createGrafanaDashboard()` generates a pre-built Grafana dashboard JSON (7 panels: requests total/rps/avg, requests by status, latency p50/p90/p99, top paths, error rate) for import. 3 tests.

#### Workspace Mode
- **Workspace dashboard v2** — real live monitoring of multiple apps on one `Bun.serve()`:
  - Per-app metrics: request rate (req/s), error rate, avg duration, total requests, WebSocket connections
  - Per-route: count, errors, error %, avg duration
  - Circuit breaker status (OPEN/CLOSED/HALF_OPEN) from the global registry
  - Process-level CPU/memory (PID, uptime, RSS, heap)
  - `GET /__asi/workspace` — dashboard with auto-refresh 2s (inline polling script)
  - `GET /__asi/metrics` — JSON endpoint for metrics
  - `metrics: false` option disables collection and the endpoint
- **Shared state bus** — `EventBus` (emit/on/off/once, emitAsync, stats) + `createRedisEventBus()` for cross-instance communication via Redis. Passed to Workspace via `{ bus }`, each sub-app receives it through `app.getState("eventBus")`
- **Graceful shutdown cascade** — `Workspace.stop()` in the right order: drain WebSocket sub-apps → lifecycle shutdown of each sub-app → stop the root `Bun.serve()` last
- **14 tests** (dashboard v2, metrics, event-bus, shutdown cascade)

#### CLI v2 — Smarter Developer Tools
- **`asi analyze`** — static project analysis: dead routes (duplicate method+path), path shadowing (static after dynamic), missing validation on mutating routes, duplicate middleware, bottleneck detection (redundant async, await without async, sync middleware with await). Flags: `--info`, `--json`, `--cwd`. 8 tests.
- **`asi doctor`** — project diagnostics: configuration (package.json, entry, config file), dependencies (asijs, typescript, dev script), TypeScript strict mode + module resolution, security best practices (rate limiting, mutation validation, security headers, hard-coded secrets, admin auth). Flags: `--json`, `--cwd`. 3 tests.
- **`asi upgrade`** — checks the latest version via the npm registry, semver comparison, updates the specifier in package.json, optional codemod for breaking changes (`--codemod`). Flags: `--dry-run`, `--offline`. 6 tests.
- **`asi template <name>`** — installs a template directly into the current directory (no VS Code), skipping existing files.
- **`asi dev --inspect`** — DevTools hint: dashboard `/__dev`, OpenAPI `/__docs`, REPL/inspect/analyze/doctor commands.

#### Performance Optimisations
- **Middleware Loop: Inline Execution (2.2.1)** — `createInlineFlatChain()`: flat middleware chains (no `next()`) are now compiled into a single inline async function via runtime codegen (`new Function`) — middleware calls written directly, no runtime for-loop or closure hops. Falls back to a sequential loop when codegen is unavailable (CSP). Applied both in `MiddlewareChainFlattener` (Strategy 1) and `compileHandler()` in compiler.ts.
- **`flattenMiddleware: true` by default** — MiddlewareChainFlattener is on by default (`@default true`), disabled explicitly with `flattenMiddleware: false`. Compiled chains delegate result conversion to `app.toResponse` (Set-Cookie, auto-escape work in the flattened path).
- **Identity-based cache invalidation** — the compiled-chain cache now compares `handler` + the middleware array by reference: re-registering a route with the same `method:path` but a different handler no longer returns a stale result (the collision hash is also safe).
- **Router Hot Path: Inline Static Routing (2.2.2)**:
  - **`router: "radix"` by default** — RadixTreeRouter (compressed trie, sorted array + binary search) became the default backend; `"trie"` remains an option. Path-based middleware (`use("/api", mw)`) now applies correctly in the radix path too.
  - **Inline static bypass** — fully static paths (`/`, `/health`) register in a separate `Map<path, Map<method, route>>` and are found by direct lookup without parsePath and segment walking (in both routers: radix and trie).
  - **Pre-parsed path cache** — `PathSegmentsCache` (LRU, 512 by default): `parsePath()` results cached by path string, shared singleton `getDefaultPathCache()`/`resetDefaultPathCache()`. Repeated hot paths don't allocate segments per request.
  - **String interning** — `internString()`: parameter names (`:id`, `:userId`) are interned — all routes with the same name share one string object.
  - **12 tests** (path cache, interning, static bypass, radix by default, path middleware + radix, cookies/auto-escape via flattened chain)
- **Context Pool: Zero-Allocation Request Cycle (2.2.3)**:
  - **`ContextPool`** — Recycler pattern: a pool of 1000 pre-allocated `Context` objects, `acquire()`/`release()` with full field reset + middleware-property cleanup (no leaks across requests), pool growth when exhausted, automatic shrink to target size after an idle interval. `@default true`, disabled with `contextPool: false`, tuned via `contextPool: { size, max, shrinkIntervalMs }`.
  - **Integration in `handle()`** — lazy acquire from the pool + guaranteed `release` in `finally` (all branches: success, 404, errors). Response conversion (Set-Cookie, auto-escape) works through the pooled path.
  - **Lazy getters** — `query`, `body()`/`json()`/`formData()`/`arrayBuffer()`, `cookies`, `url` are lazy (not initialized in the constructor) — confirmed and covered by tests; no `console.log` in `_setQuery()`/`_setBody()`.
  - **16 tests** (pool: acquire/release/reset/growth/shrink/stats, per-request isolation, concurrent safety, error path, 404, cookies)
- **Security Headers: Pre-built Response (2.2.4)**:
  - **Pre-built static headers** — `buildSecurityHeaders()` compiles the config into a flat array of pairs once; `securityHeaders()` applies them to each response in a tight loop (no config iteration and no header-string rebuilding per request)
  - **Nonce path detection** — `autoNonce` now only for HTML-capable requests (Accept contains text/html/*/* or is empty): JSON APIs don't spend crypto and don't mutate CSP; the nonce is injected into CSP only when the response is actually `text/html`
  - **HSTS without URL allocation** — protocol check via `request.url.startsWith("https://")` instead of creating a `URL` object per request
  - **No no-op hops** — the skip-path wrapper is not added for an empty `skipPaths`; no-op xssScan middleware is not added without custom patterns (chain shortened from 6 to 3–4 middleware)
  - **Benchmark result**: overhead of `security: true` 71% → **55%** (33.8k → 53.6k rps), `apiSecurityCore` 68.6% → **54%**
  - **14 new tests** (buildSecurityHeaders, header application, HSTS http/https, nonce path detection, CSP-inject only for HTML, middleware chain)
- **Complex Validation: Compiled TypeBox (2.2.5)**:
  - **Two-stage compiled validation** — `validateAndCoerce()`: 1) fast path — compiled `TypeCompiler.Check` on raw data (when data already matches the schema and there are no defaults, Convert+Default are skipped entirely); 2) slow path — full coercion (Convert → Default → compiled Check) with semantics identical to the old implementation. `validate()` is fully on the compiled checker.
  - **Schema analysis** — `schemaHasDefaults()` (WeakMap cache, cycle-safe): decides whether the fast path is safe; `Value.Default` still runs when defaults exist.
  - **`lruSchemaCache: true` by default** — the LRU cache of compiled validators is on by default (`@default true`, max 10000, configurable as a number), `false` returns a plain Map.
  - **O(1) LRU eviction** — `SchemaCacheLRU` rewritten from array + `indexOf`/`splice` (O(n) per get) to a Map with reordering via `delete`+`set` — get/evict are now O(1) even with thousands of schemas.
  - **Benchmark result** (full request path through `app.handle()`, realistic user schema): valid bodies 30k → **51k req/s (+69%)**, coercion path without regression (~28k); pure microbenchmark compiled Check vs interpreted Value.Check — **433×**.
  - **9 new tests** (fast path identity/mutation-free, coercion, defaults, errors, schemaHasDefaults nested/union/cycle, validate(), lruSchemaCache default-on / false)
- **Query Param Optimisation (2.2.6)**:
  - **QueryParseCache** — bounded LRU cache of parsed query strings (default 512, O(1) eviction via Map delete+set): repeated query strings (pagination `?page=2&limit=50`, filters) are not re-parsed. Returns a **shallow copy** — `ctx.query` mutations in one request don't poison the cache for others.
  - **Safe decode** — `safeDecode()`: malformed percent-encoding (`%E0%A4%A`) no longer throws URIError but returns the raw string (URLSearchParams behavior). Previously `decodeURIComponent` in the query parser threw on malformed URLs.
  - **`queryCache` by default** — on (`@default true`, `false` disables, a number sets max). The inline single-pass parser without a URL object already existed (2.5× faster than URLSearchParams) — confirmed by benchmark.
  - **Benchmark result** (query-heavy request path, 10 repeated query strings): **64k → 76.2k req/s (+19%)**, plan target +10–15%.
  - **12 new tests** (cache hit/miss/evict/clear, shallow-copy isolation from mutations, decode, malformed %, keys without values, queryCache: false/number, pooled contexts, cached==uncached)
- **Static Files: In-Memory Cache (2.2.7)**:
  - **`preload`** — `staticFiles(root, { preload: true })` loads matching files (glob `**&#47;*.{html,css,js,svg}` by default; a string/array is explicit patterns) into memory at startup via `Bun.Glob`; files larger than `cacheMaxFileSize` are skipped; `allowedExtensions` is respected. Works independently of `cacheSmallFiles`.
  - **`cacheTtl`** — cache TTL in seconds (MemoryCache-compatible semantics): after expiry the file is re-read from disk; catches changes invisible to size/mtime.
  - **Memory-first fast path** — found by profiling: `Bun.file().exists()` costs ~150µs per request and was the main bottleneck (the cache was checked AFTER fs operations). Now with `preload`/`cacheTtl` a request is served from memory with **no fs calls at all** (zero stat/read). Without those options the previous semantics are kept: `cacheSmallFiles` validates size/mtime from disk.
  - **Shared caching path** — `cacheFile()` (buffer read, bun-ETag, byte accounting, eviction) is used by both preload and requests; lazy TTL cleanup.
  - **Benchmark result**: middleware 4.8k → **26.4k req/s (5.5×)**; full request path 4.3k → **23.2k req/s (5.4×)** (plan target +20–30%)
  - **8 new tests** (preload default-glob/explicit patterns/size cap/allowedExtensions, behavior without options, path traversal, TTL with same-size+same-mtime change, mtime invalidation without TTL)

### 2.3 — Database Layer
- **`Database` class** (`src/db/database.ts`) — zero-dep database access: SQLite via `bun:sqlite` (built-in, WAL), PostgreSQL via lazy `import("postgres")` with a clear install error. `query`/`queryAsync`/`execute`/`executeAsync`/`first`/`exec`/`transaction`/`transactionAsync`/`listTables`/`tableInfo`/`close`.
- **`Migrator`** (`src/db/migrator.ts`) — file-based migrations: `NNN_name.sql` (up-only) and `NNN_name.up.sql` + `NNN_name.down.sql` (reversible). `__migrations` table, `up()` idempotent, `down()` (with .down.sql or untrack), `status()`, `create()` — scaffolds the next number. Two-pass reading correctly associates .down.sql with .up.sql (readdir order).
- **`runSeed` / `findSeedFile`** (`src/db/seed.ts`) — seeding: `.sql` files (multi-statement exec) and `.ts`/`.js` modules (default export `(db) => void`).
- **Db Studio** (`src/db/studio.ts`) — embedded GUI (like Prisma Studio): table list, row browser with pagination, SQL query runner, dark-themed HTML page. `studioHandler(db)` to mount in an Asi app, `serveDbStudio(db, { port })` — standalone server.
- **`AsiConfig.database` + autoMigrate** — `app.db` lazy getter: the connection is created on first access; `autoMigrate: true` runs pending migrations (once, on first access), `autoSeed` runs the seed file. `DatabaseConfig` — combined type (existing ORM config from `src/database.ts` + new fields migrationsDir/autoMigrate/seedFile/autoSeed).
- **`asi db` CLI** — `db migrate` (apply / `--create "name"` / `--down` / `--status`), `db seed [file]`, `db studio [--port 5500]`. Config: `--url` / `--migrations-dir` flags → `asi.config.(ts|js)` `database` section → `DATABASE_URL` env → defaults (`file:./app.db`, `./migrations`).
- **21 tests** (Database: CRUD/transaction/close/file-url/postgres-error; Migrator: up/status/down/create/idempotency; Seed: sql/ts/not-found; Asi: app.db lazy + autoMigrate, listen(); Studio: HTML/API tables/table/query/error/server)

#### AI & MCP
- **MCP v2 — AI-Native Protocol** (`asijs-mcp`) — a new dedicated package:
  - **Pluggable transports**: `stdio` (primary, for Claude Desktop / Cursor / Zed / Continue.dev), `http` (JSON-RPC over POST), `sse` (streaming: endpoint discovery + notifications)
  - **Protocol v2025-06-18**: prompts (analyze-route, generate-crud, debug-request, security-audit, architecture-review, optimize-routes), sampling (LLM-to-LLM), roots, progress, cursor pagination, streaming content types (image/audio/blob/resource), logging, completion
  - **Deep AsiJS runtime integration**: routes, circuit breakers (OPEN/CLOSED/HALF_OPEN + reset), WebSocket rooms/presence, hot reload, SSG paths, serverless cold-start stats, plugin dependency graph, rate limiter metrics
  - **Dynamic documentation** — `docsDir` scans `.md` files into `docs://<slug>` resources (instead of hard-coded ASIJS_DOCS)
  - **Auth** — Bearer token + token-bucket rate limiting via AsiJS middleware on the HTTP/SSE transports
  - **Custom workflows** — declarative workflows (http/code/delay/log/result steps) + built-ins (`asijs/http-request`, `asijs/chain-requests`, `asijs/app-snapshot`)
  - **67 tests** (stdio, protocol, pagination, resources, prompts, workflows, asi-bridge)

## [1.3.0] - 2026-07-27

### 🚀 New Features

#### Developer Experience
- **Hot Reload 2.0** — `HotReloader` with `fs.watch`, 200ms debounce, module-level hot swap (handler/middleware → hot reload, routes/config → full reload). `HMRServer` with WebSocket browser push, typed events, exponential backoff reconnect. 23 tests.
- **Interactive REPL** — `asi repl`. Create routes on the fly, test requests (`GET /path`, `POST /path {"key":"val"}`), inspect state (`.routes`, `.plugins`, `.state`, `.history`). Sandbox with import-line stripping and parameter shadowing. 32 tests.
- **Web Playground** — `playgroundPlugin()` — a full IDE in the browser. Code editor, Output/Routes panel, request bar, 5 examples (Hello World, REST API, JSX SSR, WebSocket Echo, Auth JWT). Rate-limited execution (10 req/min).
- **CLI v2** — `asi repl`, `asi build --ssg`, `asi build --target <platform>`, `asi plugin search/install/create/list`, `asi integrate <file>`

#### AI & MCP
- **MCP Server** stays stable (HTTP transport, 7 built-in tools, 4 resources). MCP v2 with stdio transport planned for v1.4.0.

#### Static Site Generation
- **SSG / Static Export** — `buildSSG(app, options)` scans GET routes, renders via `app.handle()`, saves HTML to dist. Pretty URLs (`/about` → `about/index.html`) + Flat format. JSON export with `--export-api`. CLI: `asi build --ssg`. 11 tests.

#### WebSocket
- **WebSocket Pub-Sub** — `RoomManager` with rooms (`ws.join()`, `ws.leave()`, `ws.rooms()`), broadcast with exclude, presence tracking, typed events. `RedisPubSubBridge` for cross-instance communication. 25 tests.

#### API Versioning
- **API Versioning middleware** — URL/Header/Combined strategies, fallback (latest/stable/default/error), deprecation headers (`Sunset`, `Deprecation`, `Deprecation-Migration`), `versionPath()` helper. 23 tests.

#### Resilience & Performance
- **Circuit Breaker** — `circuitBreaker()` middleware with CLOSED/OPEN/HALF_OPEN, sliding window, timeout, fallback, healthcheck integration. `ctx.circuitBreaker!("name", () => fetch(...))`. Presets: apiCircuitBreaker, dbCircuitBreaker, criticalCircuitBreaker. 45 tests.
- **Request Dedup & Cache Stampede Protection** — `deduplicate()` middleware, `InflightManager`, XFetch Algorithm (`P(refresh) = beta * (age / ttl)`), `xfetchWrap()`, MemoryCache/Redis integration. Presets: simple/cached/expensiveQuery. 29 tests.
- **Serverless Cold Start Optimisation** — `ServerlessOptimizer.warmUp()`, lazyImport, bundleConfig for 6 platforms (Cloudflare, Lambda@Edge, Deno Deploy, Vercel Edge, Netlify Edge, Bun). CLI: `asi build --target cloudflare`. 37 tests.

#### Security
- **Built-in Security Module** — `AsiConfig.security` with autoEscape (XSS), maxBodySize, autoNonce (CSP nonce), strictContentType, OWASP headers. Zero-config sensible defaults. Presets: maxSecurity, apiSecurity, devSecurity. 37 tests.

#### Framework Adapters
- **`@asijs/next`** — 10 tests. App Router (`createNextHandler` → GET/POST/..., basePath, 404, params), Pages Router (`createPagesHandler`), Edge Runtime (`createEdgeHandler`)
- **`@asijs/astro`** — 7 tests. Astro server endpoints (`createAstroHandler`), method-specific (`createEndpoint`), Astro middleware
- **`@asijs/remix`** — 8 tests. Remix resource routes (`createRemixHandler` → loader + action), `createLoader`, `createAction`
- **`@asijs/sveltekit`** — 8 tests. SvelteKit handle hook (`createSvelteKitHook`), `createServerHandler`, `createUniversalHandler`

### 🧩 Ecosystem

#### Plugin System
- **Plugin Dependency Manager** — dependency graph, DFS cycle detection (CyclicDependencyError), Kahn's topological sort, lazy init, hooks (onBeforeInit/onAfterInit/onBeforeRoute), `getGraphInfo()`, `toDot()`. 390 lines.
- **Plugin Registry** — `asi plugin search/install/create/list/remove/awesome`. AWESOME_PLUGINS (40+ curated plugins, 8 categories). New plugin scaffold. CONTRIBUTING.md + PLUGIN_DEV_GUIDE.md. 18 tests.

#### Migration
- **Express/Koa Migration** — `expressPlugin.wrap(mw)`, `koaPlugin.wrap(mw)`, `expressPlugin.handler()`, `koaPlugin.handler()`, EXPRESS_CODEMOD_RULES (22 rules), KOA_CODEMOD_RULES (22 rules). CLI: `asi integrate ./app.js`. 30 tests.

#### OpenTelemetry
- **`@asijs/opentelemetry`** — full OTel instrumentation. `TracerManager` (spans, W3C TraceContext, 5 exporters: Console/OTLP/Jaeger/Zipkin), `MetricsManager`, `LogsManager`, `otelPlugin()`. 22 tests.

#### VS Code Extension v0.2.0
- **Debug Configuration Provider** — 4 configs (Launch, Launch verbose, Attach, Launch Workspace). Source maps, entry file auto-detection.
- **Template Explorer** — 9 templates in 4 categories. Search, file preview, Create Project.
- **Create AsiJS Project Wizard** — 4-step GUI wizard.
- **Inline Diagnostics** — 6 checks (missing asijs dep, missing app instance, async/await, TODO/FIXME). Code Actions.
- 38 tests.

#### API Documentation Portal
- **`apiDocsPlugin()`** — a full documentation portal. Searchable sidebar, code samples (4 languages: curl/Python/JS/Go), try-it-out proxy with SSRF protection, light/dark theme.
- **`ApiChangelog`** — snapshot/diff/toChangelogMarkdown between API versions.
- **`exportToMarkdown()` / `exportToHTML()`** — CI/CD export.
- 25 tests.

#### Load Testing Suite
- 4 k6 scenarios: auth-flow, CRUD, WebSocket, file-upload.
- Docker orchestration (`docker run k6`).
- `extractMetricsFromOutput()` — p50/p90/p95/p99 parsing.
- 28 tests.

### 📦 New Packages
- `packages/opentelemetry-asijs/` — OpenTelemetry integration
- `packages/next-asijs/` — Next.js adapter
- `packages/astro-asijs/` — Astro adapter
- `packages/remix-asijs/` — Remix adapter
- `packages/sveltekit-asijs/` — SvelteKit adapter

### 🧪 Testing & Quality

- **Integration & E2E Tests** — Docker-based (PostgreSQL 5433, Redis 6380, MinIO 9001/9002). `test/integration/auto-api.test.ts` (19 tests), `test/e2e/full-cycle.test.ts` (17 tests: auth→register→login→JWT→CRUD→upload→WS), `test/e2e/redis-queue.test.ts` (7 tests), `test/e2e/node-adapter.test.ts` (8 tests). 52 tests total.
- **Total: 1373 tests** (up from 700)
- **TypeScript: 0 type errors** (`tsc --noEmit`)
- **Pre-release Security Audit** — Reviewed all v1.3.0 modules. Found and fixed: 3 CRITICAL (sandbox escape, type errors), 2 HIGH (race condition, XSS), 3 MEDIUM (silent catches, rate limiting), 1 LOW. Two accepted trade-offs documented.

### 🔧 Improvements

- **CLI**: `asi build --ssg`, `asi build --target`, `asi plugin`, `asi integrate`, `asi repl`
- **Framework Adapters**: 4 new `@asijs/*` packages with 33 total tests
- **Documentation**: VitePress docs updated with all v1.3.0 features
- **Security**: Built-in `AsiConfig.security` with zero-config defaults
- **Performance**: SSG, circuit breaker, dedup, serverless optimisation

### 🔬 Benchmark

- **Benchmark Dashboard** — HTML dashboard with Chart.js, bar charts and trend lines. Integrated into the vitepress docs. GitHub Actions CI pipeline.
- **Fullstack Benchmark Suite** — AsiJS vs Elysia+plugins vs Hono+plugins

---

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
- **Derive Pattern (TODO 4.6)** — per-request memoized context (`ctx.derive`) + compile-time inlining
- **Next.js / Remix in SSR benchmarks** — requires a Node toolchain (`next build` / `remix build`) in the Bun-only CI
- **k6 load testing for the SSR category** — stable absolute numbers instead of the fetch benchmark
- **`asi fmt`** — deterministic formatter (dprint/Biome wrapper)
- **TOON in the core MCP layer** — `Accept: application/toon` for LLM endpoints
