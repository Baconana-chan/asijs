# TODO.md — AsiJS Roadmap

> **Текущая версия**: v1.3.0-pre · **Runtime**: Bun + Node.js + Edge · **Статус**: Pre-release audit completed
>
> Документ разбит на **4 приоритетных уровня** от P0 (критично сейчас) до P3 (backlog).
> Факты: **1373 тестов**, `tsc --noEmit` чисто, **0 падающих**, CI/CD auto-publish.

---

## Актуальное состояние (July 2026 · v1.3.0-pre)

| Аспект | Состояние | Подробности |
|--------|-----------|-------------|
| Ядро / роутинг | ✅ Стабильно | Trie + Radix router, middleware flattening, hooks, context |
| Валидация | ✅ Стабильно | TypeBox, coercion, LRU schema cache, детальные ошибки |
| Плагин-система | ✅ Стабильно | createPlugin, guards, decorators, sharedState, plugin-deps |
| Auth / JWT / CSRF | ✅ Тесты есть | JWT, bearer, hashPassword, CSRF, CSRF double-submit |
| OpenAPI / Swagger | ✅ Тесты есть | OpenAPI 3.0 + 3.1, Swagger UI, автогенерация |
| Rate Limiting | ✅ Тесты есть | MemoryStore, TokenBucket, TenantStore, Redis, IP/Key/User presets |
| Cache | ✅ Тесты есть | ETag, MemoryCache, presets |
| Security | ✅ Тесты есть | CSP, HSTS, COEP, nonce, CORS advanced, security-core middleware |
| Trace / Metrics | ✅ Тесты есть | W3C traceparent, Server-Timing, Prometheus/OTLP, Sentry |
| Scheduler | ✅ Тесты есть | Cron, interval, retry, Redis queue |
| JSX / Streaming | ✅ Тесты есть | renderToString/ToStream, Suspense, JSON streaming, NDJSON |
| MCP / AI helpers | ✅ Стабильно | HTTP transport, 7 tools, 4 resources, JSON-RPC, кастомные tools |
| RPC 2.0 | ✅ Тесты есть | serverAction, rpc(), createRPCClient |
| Workspace / Multi-app | ✅ Тесты есть | Workspace class, единый Bun.serve(), dev dashboard, OpenAPI |
| Codemods | ✅ Тесты есть | Elysia/Hono/Fastify → AsiJS, 75 тестов |
| File-based routing | ✅ Тесты есть | scanRoutes, registerFileRoutes |
| Standalone dev mode | ✅ Тесты есть | 17 тестов |
| Error Pages (JSX) | ✅ 41 тест | Error-page discovery, XSS-safe, pretty dev mode |
| Sessions middleware | ✅ Тесты есть | MemoryStore, CookieStore, signed cookies, TTL |
| Content negotiation | ✅ Тесты есть | parseAccept, bestMatch, ctx.negotiate(), 406 fallback |
| Response compression | ✅ Тесты есть | gzip (Bun + Node.js), Vary, threshold, content filter |
| SSE | ✅ Тесты есть | Server-Sent Events, auto-reconnect |
| Healthcheck | ✅ Готово | /health, /ready, /live с кастомными checks |
| WebSocket graceful shutdown | ✅ Готово | drain 1001, terminate fallback, lifecycle |
| Node.js Adapter | ✅ 21 тест | EADDRINUSE retry, WebSocket через ws пакет |
| CLI | ✅ Работает | create, dev, migrate, inspect, generate, build --ssg, build --target |
| Hot Reload 2.0 | ✅ 23 теста | HotReloader (fs.watch, debounce, module invalidation), HMRServer (WS browser push) |
| API Versioning | ✅ 23 теста | URL/header strategy, fallback, deprecation headers, versionPath helper |
| SSG / Static Export | ✅ 11 тестов | buildSSG(), staticPath, pretty/flat, JSON export, CLI --ssg |
| WebSocket Pub-Sub | ✅ 25 тестов | RoomManager, broadcast, rooms, presence, typed events, Redis bridge |
| Integration & E2E Tests | ✅ 52 теста | Docker (PG/Redis/MinIO), full-cycle (auth→upload→CRUD→WS), Redis queue, Node adapter |
| Circuit Breaker | ✅ 45 тестов | CLOSED/OPEN/HALF_OPEN, timeout, sliding window, fallback, healthcheck, registry |
| Request Dedup & XFetch | ✅ 29 тестов | Inflight dedup, maxWaitMs, XFetch algorithm, MemoryCache/Redis integration |
| Serverless Optimisation | ✅ 37 тестов | warmUp, CLI --target 6 платформ, bundleConfig, lazyImport, cold start logger, best practices |
| Plugin Dependency System | ✅ 390 строк | PluginDependencyManager, цикл детекшн, топологическая сортировка, lazy init |
| Built-in Security | ✅ 37 тестов | SecurityManager, autoEscape, maxBodySize, autoNonce, strictContentType, OWASP headers, presets |
| Express/Koa Migration | ✅ 30 тестов | Runtime адаптеры (wrap/chain/handler) + codemod (44 правила) |
| OpenTelemetry SDK | ✅ 22 теста | @asijs/opentelemetry — spans, metrics, logs, exporters (OTLP/Jaeger/Zipkin) |
| API Docs Portal | ✅ 25 тестов | Интерактивный портал, code samples (4 языка), try-it-out, changelog/diff |
| Load Testing Suite | ✅ 28 тестов | k6 сценарии (auth/CRUD/WS/upload), Docker orchestration, percentile parsing |
| Plugin Registry & Community | ✅ 18 тестов | `asi plugin` CLI, Scaffold, Awesome-asijs (40+ плагинов), CI/CD docs |
| VS Code Extension (3.6) | ✅ 38 тестов | Debug config, Template Explorer (9 шаблонов), Create Wizard, Inline Diagnostics, Activity Bar |
| REPL & Playground (3.7) | ✅ 32 теста | `asi repl` (9 команд, sandbox), Web Playground (5 примеров, rate-limited execution) |
| Framework Adapters (3.8) | ✅ 33 теста | @asijs/next, @asijs/astro, @asijs/remix, @asijs/sveltekit + docs |
| TypeScript types | ✅ Чисто | `tsc --noEmit` — 0 ошибок |
| CI/CD | ✅ Auto-publish | 2 workflows: main (npm+JSR+ESLint на `v*`), eco (VS Code + ESLint на `eco-*`) |
| Тесты | ✅ **1373/1373** проходят | Все тесты зелёные, 0 падающих |
| Документация | 🔶 Хорошая | VitePress, 23 страницы, поиск, gh-pages |
| Benchmark dashboard | 🔶 Локально | Dashboard генерируется, но нет CI-публикации на gh-pages |

---

## P0 🔴 — Критично для v1.3.0 (выполнено)

*Завершённые блокеры качества и стабильности.*

### 0.1 — Тест-качество ✅
- [x] `test/authjs.test.ts` — 28 тестов
- [x] `test/upload.test.ts` — 20 тестов
- [x] `test/auto-api.test.ts` — 24 теста
- [x] `test/redis.test.ts` — 22 теста
- [x] `test/structured-logger.test.ts` — 22 теста
- [x] `test/sentry.test.ts` — 22 теста
- [x] `packages/vscode-asijs/test/extension.test.ts` — 38 тестов
- [x] `packages/eslint-plugin-asijs/test/index.test.ts` — 9.6KB тестов правил ESLint

### 0.2 — Pre-release Security Audit ✅
- [x] Проверка sandbox escape в REPL/Playground → защита через parameter shadowing
- [x] Проверка type errors → 4 ошибки исправлены (plugin-deps.ts)
- [x] Проверка race condition в circuit breaker → accepted (single-threaded JS)
- [x] Проверка silent catch{} → добавлен logging
- [x] Проверка rate limiting → playground _execute лимитирован (10/min)
- [x] Проверка XSS в API Docs → escapeHtml везде, proxy защищён
- [x] Итого: 3 CRITICAL, 2 HIGH, 3 MEDIUM, 1 LOW — все исправлены

---

## P1 🟠 — v1.4.0: Developer Experience & Platform Growth

*Фичи для роста экосистемы и упрощения разработки.*

### 1.1 — MCP v2: AI-Native Protocol

**Текущий MCP**: HTTP transport, 7 tools, hard-coded docs, нет интеграции с AsiJS runtime state. Работает, но устарел.

**MCP v2 — что нужно сделать:**

- [x] **`packages/mcp-asijs/`** — выделенный пакет для MCP (`asijs-mcp`)
- [x] **Pluggable transport**:
  - `stdio` transport (основной) — Claude Desktop, Cursor, Zed, Continue.dev
  - `http` transport (JSON-RPC over POST)
  - `sse` transport (streaming: endpoint discovery + notifications)
- [x] **Protocol v2025-06-18**:
  - Prompts — шаблонизированные промпты для AI (analyze route, generate CRUD, debug request)
  - Sampling — LLM-to-LLM вызовы (агентные цепочки)
  - Roots — клиент говорит серверу «вот корень проекта»
  - Progress — долгие операции с прогресс-барами
  - Pagination — `tools/list` с cursor для 1000+ роутов
  - Streaming results — `image`, `audio`, `blob` content types
- [x] **Deep AsiJS v1.3 integration**:
  - Circuit Breaker состояния (healthcheck, OPEN/CLOSED/HALF_OPEN)
  - WebSocket Pub-Sub комнаты (presence, активные соединения)
  - Hot Reload статус (какие файлы меняются)
  - SSG страницы (статические пути)
  - Serverless cold start статистика
  - Plugin dependency graph
  - Rate limiter метрики (текущий RPS, лимиты)
- [x] **Dynamic documentation** — сканирование `.md` файлов в `docs://<slug>` ресурсы (вместо hard-coded `ASIJS_DOCS`)
- [x] **Auth** — встроенная поддержка Bearer token + rate limiting через AsiJS middleware
- [x] **Custom workflow definitions** — AI может создавать кастомные воркфлоу (webhooks → action → response)
- [x] **Тесты**: 67 тестов (stdio, protocol, pagination, asi-bridge)

**Пример использования:**
```json
// Claude Desktop config
{
  "mcpServers": {
    "asijs-app": {
      "command": "bun",
      "args": ["-e", "import { mcp } from 'asijs'; mcp().start()"],
      "transport": "stdio"
    }
  }
}
```

### 1.2 — Workspace Mode: Multi-App Production Dashboard

- [x] **Workspace dashboard v2** — реальный мониторинг для multi-app:
  - CPU/Memory per app instance (process-level: PID, uptime, RSS, heap, CPU)
  - Request rate per app (live, sliding window 60s)
  - Error rate per route (live)
  - WebSocket connections per app
  - Circuit breaker status per app (OPEN/CLOSED/HALF_OPEN)
  - `GET /__asi/workspace` — dashboard с auto-refresh 2s; `GET /__asi/metrics` — JSON
- [x] **Hot reload per app** — уже реализовано в dev-режиме (`workspace.ts`: каждый sub-app своим процессом с `--hot`)
- [x] **Shared state bus** — `EventBus` между sub-apps (in-memory + `createRedisEventBus()` через Redis)
- [x] **Graceful shutdown cascade** — правильный порядок: sub-apps → root (`Workspace.stop()`: drain WS → lifecycle → root server)
- [x] **14 тестов** (dashboard v2, metrics, event-bus, shutdown cascade)

### 1.3 — CLI v2: Smarter Developer Tools

- [x] **`asi dev --inspect`** — DevTools hint: dashboard `/__dev`, OpenAPI `/__docs`, команды REPL/inspect/analyze/doctor
- [x] **`asi analyze`** — статический анализ проекта:
  - Dead routes (дубли method+path — первая регистрация мёртвый код)
  - Path shadowing (статический роут после динамического)
  - Дублирующиеся middleware
  - Отсутствующая валидация на мутирующих роутах
  - Bottleneck detection (redundant async, await в non-async, sync middleware с await)
  - Флаги: `--info`, `--json`, `--cwd`. 8 тестов
- [x] **`asi upgrade`** — автоматическое обновление AsiJS (npm registry + semver) + codemod для breaking changes (`--codemod`), флаги `--dry-run`/`--offline`. 6 тестов
- [x] **`asi doctor`** — диагностика проекта:
  - Проверка конфигурации (package.json, entry, config file)
  - Проверка зависимостей (asijs, typescript, dev script)
  - Проверка TypeScript strict mode + module resolution
  - Проверка security best practices (rate limit, валидация, headers, secrets, admin auth)
  - Флаги: `--json`, `--cwd`. 3 теста
- [x] **`asi template <name>`** — установка шаблона напрямую (без VS Code), пропуская существующие файлы

### 1.4 — Async Error Boundary: Structured Error Handling

- [x] **`ctx.errorBoundary<T>(fn)`** — ловит ошибки в handler'е: `fallback` / `onError(classified)` / `rethrow`, structured response
- [x] **Error classification** — `classifyError()`: бизнес-ошибки (4xx) vs системные (5xx) vs фатальные (crash) vs validation. Классы: `HttpError`, `BusinessError`, `NotFoundError`, `UnauthorizedError`, `ForbiddenError`, `ConflictError`, `SystemError`, `FatalError`
- [x] **Error reporting pipeline** — `errorBoundary()` plugin: reporters hooks (Sentry/логгер/метрики), `minCategory`, `requestId`, глобальный onError. Хелперы: `runErrorReporters`, `tryCatch`
- [x] **Retry policies** — `retry()` с backoff (fixed/linear/exponential + jitter), `computeBackoff()`, `defaultShouldRetry`. 26 тестов

---

## P2 🟡 — Production Hardening

*Улучшения для production-сценариев и эксплуатации.*

### 2.1 — Observability Suite

- [x] **Structured logging v2** — OTel Logs Bridge (`otelLogs()` + `OTLPLogsExporter`): semantic conventions, батчинг + flush, OTLP/HTTP export
- [x] **Distributed tracing** — W3C TraceContext propagation через Redis pub-sub (`RedisTraceBridge`: span-события traceId/spanId/parentSpanId между инстансами)
- [x] **Healthcheck dashboard** — `/__health` HTML страница со статусом всех компонентов (кастомные проверки, circuit breakers, process info, auto-refresh)
- [x] **Metrics dashboard** — Prometheus metrics (уже было) + pre-built Grafana dashboard JSON export (`createGrafanaDashboard`, 7 панелей)
- [x] **15 тестов** (OTel logs, health dashboard, Grafana, Redis trace bridge)

### 2.2 — Performance Optimisations (benchmark-driven, v1.3.0 data)

**Текущие бенчмарки** (v1.3.0, AsiJS vs Elysia vs Hono):

| # | Сценарий | AsiJS | vs Elysia | Разрыв | Статус |
|---|----------|-------|-----------|--------|--------|
| 1 | GET / (simple JSON) | 402k rps | 595k | **−33%** | 🔴 |
| 2 | Middleware chain (5 mw) | 189k rps | 545k | **−65%** | 🔴 |
| 3 | GET /user/:id (path params) | 272k rps | 457k | **−47%** | 🟠 |
| 4 | Complex validation (nested) | 35k rps | 103k | **−66%** | 🔴 |
| 5 | All middleware (fully-loaded) | 13k rps | 107k | **−88%** | ⚠️ |
| 6 | Security headers overhead | 182k rps | — | −56% от bare | 🟠 |
| 7 | GET /search (query params) | 312k rps | 456k | **−32%** | 🟠 |
| 8 | Static file serving (small) | 86k rps | — | −39% от Hono | 🟡 |

**Цель v1.4.0**: сократить разрыв с Elysia до **<20%** на всех сценариях.

---

#### 🔴 2.2.1 — Middleware Loop: Inline Execution вместо for-loop

**Проблема**: Middleware исполняется через runtime `for`-loop с check'ами. Каждый middleware — отдельный async вызов с GC overhead.

**Решение**:
- [x] **`flattenMiddleware: true` по дефолту** — MiddlewareChainFlattener включён по умолчанию (`@default true`), отключается явным `flattenMiddleware: false`
- [x] **Flat middleware detection** — middleware без `next()` (большинство) — inline execution без chain overhead
- [x] **Pre-compiled handler + middleware** — `createInlineFlatChain()`: единая inline async функция через runtime codegen (`new Function`) — вызовы middleware записаны напрямую, без runtime loop. Fallback: sequential loop при недоступности codegen. Применяется в MiddlewareChainFlattener (Strategy 1) и compileHandler()
- [x] **Cache invalidation по identity** — повторная регистрация роута (тот же method:path, другой handler) больше не возвращает устаревший compiled chain
- [ ] **Ожидаемый эффект**: +80-100% для middleware-heavy сценариев (189k → 350k+) — бенчмарки после всех оптимизаций 2.2.x

#### 🔴 2.2.2 — Router Hot Path: Inline Static Routing

**Проблема**: GET / (самый частый эндпоинт) — каждый запрос проходит полный Trie lookup с `parsePath()`, аллокацией массива сегментов, Map lookups.

**Решение**:
- [x] **`router: "radix"` по дефолту** — RadixTreeRouter стал default-бэкендом (`@default "radix"`), `"trie"` — опция. Path-based middleware (`use("/api", mw)`) корректно применяется и в radix-пути
- [x] **Inline route bypass** — fully-static пути в отдельной `Map<path, method → route>`: прямой lookup без parsePath и segment walk (radix + trie)
- [x] **Pre-parsed path cache** — `PathSegmentsCache` (LRU, 512): path → segments, синглтон `getDefaultPathCache()`
- [x] **String interning** — `internString()` для имён параметров: одинаковые имена (`:id`) — один string object во всех роутах
- [x] **12 тестов** (path cache, interning, static bypass, radix по дефолту, path middleware + radix, cookies/auto-escape в flattened chain)
- [ ] **Ожидаемый эффект**: +15-25% для GET / (402k → 460k+) — бенчмарки после всех оптимизаций 2.2.x

#### 🔴 2.2.3 — Context Pool: Zero-Allocation Request Cycle

**Проблема**: Каждый запрос создаёт новый Context с полным набором полей (path, params, query, headers, body). Даже если запрос не использует query/body — они всё равно инициализируются. GC pressure на 300k+ rps.

**Решение**:
- [x] **Context Pool** — Recycler pattern: пул из 1000 pre-allocated Context объектов (`ContextPool`, `@default true`)
  - acquire() → получает готовый Context из пула (lazy, только когда нужен)
  - release(ctx) → полный сброс полей + удаление middleware-свойств (нет утечек между запросами) → возврат в пул
  - Pool growth — если все Context'ы заняты, создать новый; automatic shrink до size после idle-интервала (lazy timer, unref)
- [x] **Lazy getters** — `query`, `body()`/`json()`/`formData()`/`arrayBuffer()`, `cookies`, `url` уже ленивые (не инициализируются в конструкторе) — подтверждено тестами
- [x] **console.log в `_setQuery()`/`_setBody()`** — отсутствует (проверено, чистить нечего)
- [x] **16 тестов** (pool: acquire/release/reset/growth/shrink/stats, изоляция между запросами, concurrent, error path, 404, cookies)
- [ ] **Ожидаемый эффект**: +10-15% для всех сценариев, особенно plain JSON — бенчмарки после всех оптимизаций 2.2.x

#### 🟠 2.2.4 — Security Headers: Pre-built Response

**Проблема**: SecurityManager на каждый запрос: итерирует CSP конфиг, генерирует nonce, устанавливает 5+ заголовков через `setHeader()`. Бенчмарк: 419k bare → 182k с securityHeaders (−56%).

**Решение**:
- [x] **Pre-compiled Response** — `buildSecurityHeaders()` компилирует конфиг в плоский массив пар один раз; `securityHeaders()` применяет tight-loop без пересборки
- [x] **Nonce path detection** — `autoNonce` только для HTML-capable запросов (Accept text/html/*/*/пусто); nonce в CSP только когда ответ реально text/html
- [x] **Inline header application** — pre-built pairs + tight loop вместо итерации конфига; HSTS через `request.url.startsWith` без URL-аллокации
- [x] **Без no-op hops** — skip-path wrapper не добавляется при пустом skipPaths; no-op xssScan не добавляется без кастомных паттернов
- [x] **14 тестов** + результат: overhead security:true 71% → 55%, apiSecurityCore 68.6% → 54%
- [x] **Preset-specific optimization** — `apiSecurityCore()` pre-built (уже без nonce по конфигу), `maxSecurity()` conditional — де-факто покрыто nonce path detection
- [ ] **Ожидаемый эффект**: +59% rps для security:true (33.8k → 53.6k), overhead −16 п.п.

#### 🔴 2.2.5 — Complex Validation: Compiled TypeBox

**Проблема**: Complex validation (4-level nested object): AlsJS 35k rps vs Elysia 103k rps (−66%). Единственное место с критическим отставанием.

**Решение**:
- [x] **`lruSchemaCache` по дефолту** — LRU cache для compiled TypeBox validators теперь включён по умолчанию (`@default true`); `SchemaCacheLRU` переписан на O(1) eviction через Map delete+set (было O(n) indexOf/splice)
- [ ] **Schema flattening** — глубокие вложенные схемы → flatten на этапе compile, runtime не рекурсит (TypeCompiler уже генерирует плоский код — оставлено как опциональный deep-dive)
- [x] **Compile-time validator injection** — pre-compiled TypeCheck кэшируется и вставляется в compiled handler'ы (compileHandler); radix-путь использует тот же кэш через `compileSchema()`
- [x] **Validate-only path** — `validate()` полностью на скомпилированном чекере; `validateAndCoerce()` двухстадийный: compiled `Check` fast path (без Convert+Default), slow path с полной коерцией при несоответствии
- [x] **Ожидаемый эффект**: request-path бенчмарк: валидные body 30k → **51k req/s (+69%)**, coercion-путь без регрессии; микробенчмарк compiled vs interpreted — **433×**

#### 🟡 2.2.6 — Router: Query Param Optimisation

**Проблема**: GET /search?q=... — query парсинг через `URLSearchParams` с decodeURIComponent (даже если decode отключён, URL объект создаётся).

**Решение**:
- [x] **Custom query parser** — inline parser без URL объекта: `q=a&b=c` → `{q:'a',b:'c'}` за один проход (уже был — подтверждено, 2.5× быстрее URLSearchParams)
- [x] **Lazy query parsing** — геттер `ctx.query` парсит только когда обращаются (уже было — подтверждено)
- [x] **QueryParseCache** — bounded LRU (512, O(1) eviction) разобранных query-строк + **shallow copy** на возврат (мутации не портят кэш); `queryCache` по дефолту, `false`/число настраивают
- [x] **Safe decode** — malformed `%` больше не бросает URIError (поведение URLSearchParams)
- [x] **Ожидаемый эффект**: request-path бенчмарк query-heavy: 64k → **76.2k req/s (+19%)**

#### 🟡 2.2.7 — Static Files: In-Memory Cache

**Проблема**: staticFiles plugin — каждый запрос читает файл с диска (даже если Bun кэширует). Для маленьких файлов overhead I/O выше, чем обработка.

**Решение**:
- [x] **preload cache** — `staticFiles({ preload: true, preloadGlob: "**&#47;*.{html,css,js,svg}" })` (glob через Bun.Glob, строка/массив паттернов, size cap) — загрузка в память при старте, работает без `cacheSmallFiles`
- [x] **MemoryCache интеграция** — `cacheTtl` (секунды): TTL-семантика MemoryCache для static files; ловит изменения, невидимые size/mtime
- [x] **Memory-first fast path** — при `preload`/`cacheTtl` отдача из памяти без fs-вызовов (`file.exists()` — ~150µs/запрос — был главным bottleneck); общий путь `cacheFile()` для preload и запросов, lazy TTL cleanup
- [x] **Ожидаемый эффект**: middleware 4.8k → **26.4k req/s (5.5×)**; полный request path 4.3k → **23.2k req/s (5.4×)**

#### 📊 Прогноз после всех оптимизаций

| Сценарий | Сейчас | После | vs Elysia |
|----------|--------|-------|-----------|
| GET / (simple JSON) | 402k | **460k+** | 68% → **77%** |
| Middleware chain (5 mw) | 189k | **350k+** | 35% → **64%** |
| GET /user/:id | 272k | **330k+** | 60% → **72%** |
| Complex validation | 35k | **60k+** | 34% → **58%** |
| Security headers | 182k | **300k+** | bare 43% → **71%** |

### 2.3 — Database Layer

- [x] **`asi db`** — CLI для управления БД:
  - `asi db migrate` — миграции (file-based: `NNN_name.sql` / `.up.sql`+`.down.sql`; apply / `--create` / `--down` / `--status`)
  - `asi db seed [file]` — сидирование (.sql multi-statement или .ts модуль)
  - `asi db studio` — встроенный GUI для БД (аналог Prisma Studio: таблицы, строки, query runner)
- [x] **Auto-migration** — `autoMigrate: true` в `AsiConfig.database` (lazy при первом `app.db`); плюс `autoSeed`, `app.db`, `Database` класс (bun:sqlite zero-dep / postgres lazy import)

---

## P3 🔵 — v1.5.0: Competitive Strategy

*Стратегия: закрыть gaps с конкурентами + удвоить на уникальных фичах.*

### Конкурентный анализ (mid-2026)

| Позиция | Что AsiJS отстаёт | Лидер | Unique AsiJS features |
|---------|-------------------|-------|----------------------|
| **Bundle size** | Нет tiny entry (<30KB) | Hono (14KB) | SSG, Circuit Breaker, MCP, API Docs Portal |
| **Response serialization** | Response.json() без pre-compile | Fastify (JSON Schema 2-3x) | Plugin Registry, Framework Adapters |
| **Middleware overhead** | +65% overhead на 5 mw | Elysia (derive pattern) | Built-in Security, Benchmark Dashboard |
| **Edge/WinterCG** | Нет pure-Web-API entry | Hono (6+ runtimes) | Express/Koa Migration, Hot Reload 2.0 |
| **Dev server** | Нет Vite/Rolldown bridge | H3/Nitro | SSG, API Docs Portal, REPL/Playground |

**3 ключевые стратегии v1.5.0:**
1. **Закрыть gaps** (tiny bundle, JSON Schema serializer, derive middleware, WinterCG compliance)
2. **Удвоить на уникальных** (MCP v2 + Agent Runtime, Edge-native SSG)
3. **Интегрироваться** (Vite 8, Rolldown, популярные инструменты)

---

### 3.1 — `asijs/tiny`: Minimal Bundle Entry

**Зачем**: Hono доминирует на edge с bundle 14KB. AsiJS `dist/index.js` весит значительно больше из-за всех встроенных модулей.

- [ ] **`asijs/tiny`** — entry point только с:
  - Роутинг (Trie-only, без Radix tree)
  - Basic Context (без query/body парсинга до обращения)
  - Response helpers (json/text/html/redirect)
  - Middleware chain (flat-only, без next())
  - **Без**: OpenAPI, SSG, Circuit Breaker, Sentry, Scheduler, Metrics, RPC, Plugin system, Security headers
- [ ] **Lazy import всех тяжёлых модулей** — уже есть serverless оптимизация, расширить на все модули
- [ ] **Tree-shakeable exports** — `package.json` exports map с granular entry points
- [ ] **Benchmark**: сверить bundle size vs Hono/tiny (цель: < 30KB)
- [ ] **Документация**: когда использовать `asijs` vs `asijs/tiny`

**Impact**: 🔥 High · **Effort**: 🟡 Medium · **Уникальность**: ❌ Hono has it

### 3.2 — JSON Schema Response Serialization

**Зачем**: Fastify получает 2-3x ускорение на сериализации через pre-compiled JSON Schema. AsiJS использует `Response.json()` — каждая сериализация проходит через JSON.stringify + V8 hidden class allocation.

- [ ] **`compileSerializer(schema)`** — pre-compile TypeBox/JSON Schema → fast serialization function:
  ```typescript
  const serialize = compileSerializer(Type.Object({
    id: Type.Number(),
    name: Type.String(),
  }));
  // serialize → inline: `{"id":${obj.id},"name":"${obj.name}"}`
  ```
- [ ] **Integration with `app.compile()`** — создавать сериализаторы для `response` схем в compiled mode
- [ ] **Content-Type negotiation** — выбирать сериализатор под content-type (JSON, JSON:API, msgpack)
- [ ] **Benchmark**: сверить vs Fastify serialization (цель: < 10% разрыв)
- [ ] **Use `V8.serialize`** — для complex объектов где JSON Schema compiler не даёт выигрыша

**Impact**: 🔥 High · **Effort**: 🟡 Medium · **Уникальность**: ❌ Fastify has it

### 3.3 — Derive Middleware Pattern (Elysia-style)

**Зачем**: Elysia's `derive` — не middleware в обычном смысле, а flat Map объектов. Это позволяет Elysia получать **545k rps** на 5 middleware (AsiJS: 189k).

- [ ] **`ctx.derive(key, factory)`** — вычисляет значение один раз, кэширует на весь request:
  ```typescript
  app.derive("user", async (ctx) => authenticate(ctx));
  app.derive("db", () => new Database());
  // В handler'е:
  // ctx.derived.user — уже посчитано, без overhead
  ```
- [ ] **Compile-time derive** — `app.compile()` определяет derive-зависимости и генерирует flat chain:
  - derive A → derive B (зависит от A) → handler (использует A и B)
  - Результат: одна flat async функция без intermediate объектов
- [ ] **Backwards compatibility** — derive middleware работает как обычный middleware для не-compiled режима
- [ ] **Performance benchmark**: цель 350k+ rps на 5 middleware (сейчас 189k)

**Impact**: 🔥 High · **Effort**: 🟡 Medium · **Уникальность**: ❌ Elysia has it

### 3.4 — Edge-Native Bundle (WinterCG+)

**Зачем**: Hono доминирует на edge благодаря полному WinterCG compliance (Request/Response-only). AsiJS уже поддерживает 6 edge платформ, но не имеет pure-Web-API entry point.

- [ ] **`asijs/edge`** — entry point без Bun-зависимостей:
  - Только Web API: Request, Response, Fetch, URL, Headers
  - No `Bun.file()`, `Bun.write()`, `Bun.serve()`
  - No `process.env` (edge-readiness)
  - No `crypto.subtle` (где недоступно)
- [ ] **Platform-specific fallbacks**:
  - Cloudflare Workers: `crypto.subtle` → Web Crypto API
  - Lambda@Edge: `Bun.file()` → fs.readFileSync fallback
  - Deno: Deno.readFile() для статики
- [ ] **`asi build --target wintercg`** — сборка без Bun-зависимостей
- [ ] **Test suite**: прогон всех тестов на 3+ edge рантаймах (CI matrix)

**Impact**: 🔥 High · **Effort**: 🟡 Medium · **Уникальность**: ❌ Hono has it

### 3.5 — @asijs/vite: Vite 8 / Rolldown Dev Server

**Зачем**: H3/Nitro интегрируется с Vite как dev server. AsiJS имеет свой `asi dev` с hot reload, но не может быть dev server для Vite-проектов.

- [ ] **`@asijs/vite`** — AsiJS как dev server для Vite приложений:
  - AsiJS handles API routes (как backend)
  - Vite handles HMR/frontend (как frontend)
  - Единый порт через Vite proxy → AsiJS
- [ ] **HMR bridge** — Vite HMR → AsiJS HMRServer (WebSocket)
- [ ] **Rolldown integration** — AsiJS SSR bundle через Rolldown (faster than esbuild)
- [ ] **Пример**: `asi create vite-app` — шаблон AsiJS + Vite 8

**Impact**: 🔥 High · **Effort**: 🔴 High · **Уникальность**: ✅ Unique (Vite + AsiJS combo)

### 3.6 — MCP v2 + Agent Runtime

**Зачем**: MCP — уникальная территория AsiJS. Ни один конкурент не имеет встроенной MCP-интеграции. Это opening в AI ecosystem.

- [ ] **MCP v2** — перенесено из v1.4 (готово к реализации, ждёт v1.4.1)
  - `packages/mcp-asijs/` — выделенный пакет
  - stdio transport (Claude Desktop, Cursor, Zed)
  - Protocol v2025-05: Prompts, Sampling, Roots, Progress
- [ ] **Agent Runtime** — выполнение AI агентов на AsiJS:
  - `ctx.agent({ goal: "проанализируй роуты", tools: [...] })`
  - LLM-agnostic: Anthropic, OpenAI, Ollama (local)
  - Agent → Tool → AsiJS handler → Response cycle
- [ ] **Workflow engine** — визуальный редактор цепочек AI → API → DB
- [ ] **Tool Marketplace** — `asi agent install <tool>`

**Impact**: 🔥 High · **Effort**: 🔴 High · **Уникальность**: ✅ **Unique** 🔑

### 3.7 — `@asijs/react`: React Server Components

- [ ] RSC rendering pipeline на AsiJS
- [ ] Server/client component границы
- [ ] Streaming SSR + hydration
- [ ] `createRSCHandler()` — адаптер для React 19 RSC

**Impact**: 🟡 Medium · **Effort**: 🔴 High · **Уникальность**: ❌ Next.js has it

### 3.8 — GraphQL Plugin v2

- [ ] **Code-first** — TypeBox → GraphQL schema
- [ ] **Subscription support** — через WebSocket
- [ ] **Federation support** — Apollo Federation
- [ ] **Performance** — DataLoader, query complexity analysis

**Impact**: 🟡 Medium · **Effort**: 🟡 Medium · **Уникальность**: ⚠️ Yoga/Hesli exist

---

## P4 🟣 — Experiments & Ecosystem (v1.6+)

### 4.1 — @asijs/nest: NestJS-style Decorators

- [ ] `@Controller()`, `@Get()`, `@Post()`, `@Param()`, `@Body()`, `@Query()`
- [ ] `@Injectable()`, `@Module()` — DI на AsiJS
- [ ] AOT compilation декораторов в plain handlers (performance)

### 4.2 — Desktop Framework: asijs-tauri + asijs-electron

#### 4.2.1 — asijs-tauri: Desktop via Tauri

- [ ] **Пакет `asijs-tauri`** — `createTauriBackend(app, options)`:
  - Запуск AsiJS сервера как Tauri sidecar
  - Tauri command bridge: `tauri::command` → HTTP → AsiJS handler
  - Graceful shutdown при закрытии окна
- [ ] **Пример**: `examples/tauri-app/` — `bun create asijs tauri-app`
- [ ] **Документация** в `docs/features/adapters.md`
- [ ] **Hot Reload в dev-mode** — `bun --hot` перезапускает sidecar
- [ ] **Tauri v2 + v1 совместимость**

#### 4.2.2 — asijs-electron: Desktop via Electron

- [ ] AsiJS как бэкенд для Electron приложений
- [ ] IPC bridge: renderer → AsiJS handler
- [ ] Auto-updater интеграция
- [ ] Native OS меню, уведомления, трей

### 4.3 — Plugin Ecosystem v2

- [ ] **Plugin GitHub Action** — автоматический тест плагинов на совместимость с AsiJS
- [ ] **Plugin Score** — рейтинг плагинов (тесты, docs, maintenance)
- [ ] **`asi plugin publish`** — публикация плагина в registry

### 4.4 — Performance Regression CI

- [ ] **Nightly benchmarks** — каждую ночь прогон benchmark suite, авто-коммит результатов
- [ ] **Regression detection** — alert если RPS упал >5%
- [ ] **Branch comparison** — benchmark diff между PR и main

---

## P5 🟣 — v1.7+: Platform Era (после текущего roadmap)

*Синтез идей из эксперимента «TODO.md × 5 ИИ» (ChatGPT / Grok / DeepSeek / GLM / Qwen).
Отобрано по трём критериям: консенсус ≥3/5 ИИ, fit с уникальной позицией AsiJS
(MCP/AI-native + performance + DX), реализуемость на уже существующей
инфраструктуре (Redis, WS pub-sub, Circuit Breaker, Observability, Database Layer).*

### 5.1 — AI-Native Runtime 2.0 (P0 · консенсус 5/5 · главный differentiator)

- [ ] **autoMCP** — REST/RPC роуты автоматически становятся MCP tools: `app.get('/users')` → `get_users` tool со схемой из TypeBox/OpenAPI (`autoMCP: true`)
- [ ] **`asi generate ai`** — AI-кодогенерация: промпт → план → роут + миграция + валидация + тесты + OpenAPI → diff → approval
- [ ] **`ai-context.json`** — экспорт проекта (роуты/схемы/плагины/БД) для LLM-инструментов
- [ ] **MCP observability** — дашборд вызовов AI-тулов (параметры/результаты/топ инструментов)
- [ ] **Agent orchestration** — память (Redis), tool-calling с circuit breakers, human-in-the-loop

### 5.2 — Built-in Test Runner: `asi test` (P0 · консенсус 4/5)

- [ ] Fluent API: `app.test().post('/users').json({...})` + матчеры `toHaveStatus(201)`
- [ ] `asi test --watch / --coverage / --changed` (git-based), parallel isolation
- [ ] Mock DB/Redis, fake timers, WebSocket/SSE/MCP тестирование, test fixtures
- [ ] **Schema-driven fuzzing** (`asi fuzz --routes`) — авто-генерация невалидных payload'ов из TypeBox для Error Boundary и валидаторов

### 5.3 — Job & Event Runtime (P0 · консенсус 4/5)

- [ ] **Background Jobs 2.0** — `app.job('send-email', fn)` + `enqueue()`: retries, exponential backoff, priority, delayed, dedup, idempotency, DLQ, concurrency, graceful shutdown
- [ ] **Typed Event Bus** — `defineEvents()` (TypeBox-схемы) + транспорты: memory/Redis/Postgres; durable events
- [ ] **Durable workflows + Saga** — `.step()` / `.compensate()`, persistence, recovery, timeout
- [ ] **Transactional Outbox** — DB-commit → outbox → dispatcher (Redis/Kafka/webhook) — решает «commit упал, publish потерялся»
- [ ] CLI: `asi jobs inspect / retry <id> / drain`
- [ ] Dashboard для jobs/queues (ложится на Admin Console 5.5)

### 5.4 — Multi-Tenant Runtime (P1 · консенсус 4/5 · B2B/SaaS ниша)

- [ ] `ctx.tenant` + `app.tenant({ resolve })` middleware (x-tenant-id)
- [ ] Per-tenant: rate limits, cache, DB, feature flags, metrics, logs, tracing
- [ ] `asi tenant` CLI (create/migrate/soft-delete/export)

### 5.5 — Admin Console `/__asi` (P1 · консенсус 4/5)

- [ ] Объединить существующие дашборды (workspace / health / metrics / db studio / playground) в единую консоль
- [ ] Разделы: overview, routes, requests, errors, logs, metrics, traces, jobs, queues, WS rooms, cache, circuit breakers, plugins, database, events, feature flags, config, API docs, MCP

### 5.6 — Contract-First Layer (P1 · сильнейший fit — TypeBox уже в центре)

- [ ] `api({...})` из TypeBox → REST + RPC + MCP + OpenAPI + SDK + mock + docs из одного определения
- [ ] `exposeMCP()` — контракт автоматически становится MCP tools (REST endpoint = AI tool)
- [ ] **Schema Registry** — `registry.register("User", schema)` + versioning + `asi schema diff User@2 User@3`
- [ ] **API breaking-change analyzer** — `asi api diff old.json new.json` + CI check

### 5.7 — Feature Flags & Config Management (P1 · консенсус 3/5 · production primitive)

- [ ] `ctx.feature('new-checkout')` — rollout %, user/tenant targeting, kill switch, audit log, dashboard
- [ ] `defineConfig()` — env-валидация через TypeBox, environment overlays, startup validation
- [ ] Secrets abstraction — `ctx.secrets.get()` (local/Env + Vault/AWS SM adapters), redaction в логах

### 5.8 — Resilience & Debugging (P1 · консенсус 3/5)

- [ ] **Chaos engineering** — `app.chaos({ latency, errorRate, disconnectRate })` per-dependency + `asi test --chaos`
- [ ] **Idempotency keys** — `ctx.idempotency.run(key, fn)` (Redis, TTL, request hash, response replay)
- [ ] **Request replay** — `asi replay <trace-id>`: воспроизведение запроса из трейса (time-travel debugging)
- [ ] **Deadline propagation** — `ctx.deadline / remainingTime / signal` + `X-Request-Deadline` downstream

### 5.9 — Platform Ops (P2)

- [ ] **`asi deploy` / `asi infra`** — генерация Dockerfile / docker-compose / Terraform / Helm по архитектуре (роуты, Redis, БД, WebSocket, Cron)
- [ ] **WASM plugin runtime** — sandbox + permissions (`filesystem:read`, `network`, `database`, `secrets`)
- [ ] **Vector/RAG core** — pgvector/Qdrant адаптеры + semantic cache для LLM-ответов

### 5.10 — Cargo-Style Toolchain: `asi fix / clippy / fmt / test` (P0 · своя идея, развитие `asi fix`)

*Идея: повторно использовать архитектуру, которая делает тулинг Rust «имбовым» —
не набор отдельных команд, а единый контракт диагностик + тонкие слои поверх него.*

**Ядро — Diagnostic Contract (как rustc → cargo fix/clippy):**

- [ ] **`TextFix` в контракте** — расширить `AnalysisIssue` (src/analyze.ts): `fix?: { start, end, replacement, safe }` (char-offsets, ESLint-стиль, без AST). Сейчас `suggestion` — текстовая строка, машинно применить нельзя
- [ ] **Fixer Engine** — универсальный апплаер: сортировка фиксов по позиции, применение in-memory, dry-run с diff, запись + отчёт «применено N / пропущено M», `--check` для CI; `safe: false` → нужен флаг (`--allow-risky`)
- [ ] **Единая модель проекта** — общий Project Model (конфиг + роуты + файлы + контекст), на котором живут все инструменты (аналог Cargo.toml/target graph)

**Команды поверх контракта:**

- [ ] **`asi fix`** — применить все safe-фиксы из analyze: `--dry-run` (diff), `--check` (CI fail если есть исправимое), `--allow-risky`. Провайдеры фиксов подключаются одной строкой
- [ ] **`asi clippy`** (rename/развитие `analyze`) — правила-линты с кодами (`asi/no-missing-validation` и т.д.) + саппрессия `// asi-ignore: rule` (аналог `#[allow]`) + `--fix`
- [ ] **`asi fmt`** — обёртка над dprint/Biome с `asi.fmt` конфигом (аналог rustfmt.toml), детерминированный формат
- [ ] **`asi test`** — см. 5.2 (тест-раннер — часть того же пайплайна)
- [ ] **Композиция** — один привычный цикл как у Rust: `asi clippy --fix && asi fmt && asi test`; `asi fix` умеет чинить то, что нашёл `clippy`, и наоборот

**Провайдеры диагностик (всё подключается к одному fixer'у):**

- [ ] `asi analyze` — статические lints (dead routes, missing validation, bottlenecks) — уже есть, осталось дать ranges
- [ ] `asi doctor` — конфиг/безопасность/зависимости
- [ ] `codemod.ts` — framework-миграции (Express→AsiJS) — уже делает настоящие трансформации
- [ ] **Edition-миграции** — `asi upgrade` + codemod как `cargo fix --edition` (v1.x → v2.x кодовые миграции)
- [ ] **AI-фиксы** — AI-генератор (5.1) как ещё один провайдер диагностик: `asi fix` применяет предложения AI с человеческим approval

**Фазы:** 1) TextFix + fixer + `asi fix` на существующих проверках → 2) `asi clippy` + `asi fmt` → 3) `asi test` замыкает цикл.

**Сознательно отложено (требует отдельной стратегии / тяжёлое / нишевое):** WebTransport & HTTP3, eBPF-observability, K8s Operator, Terraform/CDK provider, native ORM (`@asijs/orm`), gRPC, CRDT / local-first sync, WebAuthn/Passkeys, mobile kits (React Native/Expo), LLM Gateway, billing hub, WebRTC signaling, MQTT.

---

## Архив — Завершённые фазы (v0 → v1.3.0)

### Фаза 0 — Proof of Concept ✅
- [x] Самый простой сервер на чистом Bun.serve()
- [x] Поддержка path → handler (статические строки)
- [x] Возврат строки / Response / JSON
- [x] Поддержка GET / POST / PUT / DELETE / PATCH
- [x] Простой роутер (Trie-based router)

### Фаза 1 — Базовый роутинг ✅
- [x] Параметры :id / *wildcard
- [x] app.get() / .post() / .all() / .use(path, middleware)
- [x] Context объект (c / ctx)
- [x] Автоматическое преобразование return → Response
- [x] Глобальные / локальные middleware
- [x] Async handlers
- [x] Обработка ошибок (throw → 500, custom Error handlers)
- [x] Группировка роутов (app.group('/api', ...))
- [x] Route-level hooks (beforeHandle, afterHandle)

### Фаза 2 — Type Safety & Validation ✅
- [x] Валидация query / params / body с TypeBox
- [x] Type inference для ctx в handler'ах
- [x] Coercion (string "123" → number 123)
- [x] Default values
- [x] Детальные ошибки валидации (400 + details)
- [x] Eden-подобный клиент (treaty())

### Фаза 3 — Производительность ✅
- [x] Trie-based router
- [x] Минимизация аллокаций в hot path
- [x] Lazy parsing body
- [x] Поддержка Bun.serve() опций: reusePort, lowMemoryMode, TLS
- [x] Бенчмарки против raw Bun, Elysia, Hono
- [x] Static code analysis / code generation

### Фаза 4 — Must-have фичи ✅
- [x] CORS plugin
- [x] Static files serving
- [x] WebSocket support
- [x] FormData / multipart parsing
- [x] Plugin system (createPlugin, decorators, sharedState, guard)

### Фаза 5 — Killer features ✅
- [x] OpenAPI / Swagger автогенерация
- [x] Rate limiting (MemoryStore, TokenBucketStore, presets)
- [x] JWT / auth helpers (jwt, bearer, hashPassword, csrf)
- [x] Typed fetch client (treaty, batchRequest, withRetry)
- [x] JSX / HTML streaming (renderToString, Suspense, when/each)

### Фаза 6 — Экосистема ✅
- [x] CLI (create, dev, migrate, inspect, generate, build --ssg, build --target)
- [x] Примеры (basic-api, auth-jwt, mcp-server, websocket-chat и др.)
- [x] GitHub Actions (test, typecheck, build, publish)
- [x] Публикация на npm + JSR
- [x] Graceful shutdown / lifecycle
- [x] Tracing / Metrics / Prometheus / OTLP export
- [x] Security headers (CSP, HSTS, COEP, nonce)
- [x] Scheduler / Cron
- [x] Response caching (ETag, MemoryCache, presets)
- [x] Dev mode (/__dev dashboard, chaos, delay)
- [x] Server Actions / RPC 2.0
- [x] MCP / AI helpers
- [x] Workspace / multi-app hot-reload
- [x] Database integrations (Drizzle, Prisma, Kysely)
- [x] i18n plugin
- [x] GraphQL plugin
- [x] DI / @Module() decorators
- [x] Edge adapters (Cloudflare, Vercel, Deno, Lambda@Edge, Netlify)
- [x] Test utilities (mockContext, testClient, assert helpers)
- [x] Codemods (Elysia/Hono/Fastify → AsiJS, 75 тестов)
- [x] Per-tenant rate limiting (TenantStore, workspaceRateLimit)

### v1.3.0 — New Modules ✅
- [x] SSG / Static Export (buildSSG, CLI --ssg, 11 тестов)
- [x] WebSocket Broadcast / Pub-Sub (RoomManager, Redis bridge, 25 тестов)
- [x] Hot Reload 2.0 (HotReloader + HMRServer + browser HMR, 23 теста)
- [x] API Versioning middleware (URL/header, fallback, deprecation, 23 теста)
- [x] Integration & E2E Tests (docker-compose, full-cycle, Redis queue, Node adapter, 52 теста)
- [x] Circuit Breaker & Resilience (45 тестов: states, timeout, fallback, healthcheck, registry)
- [x] Request Dedup & Cache Stampede (29 тестов: InflightManager, XFetch, presets)
- [x] Serverless Cold Start Optimisation (37 тестов: warmUp, CLI --target, bundleConfig, lazyImport)
- [x] Plugin Dependency & Ordering System (PluginBuilder, CyclicDependencyError, pluginInfo, 390 строк)
- [x] Built-in Security Module (SecurityManager, autoEscape, maxBodySize, autoNonce, strictContentType, 37 тестов)
- [x] Express/Koa Migration (runtime адаптеры + codemod, 30 тестов)
- [x] OpenTelemetry SDK (@asijs/opentelemetry, 22 теста)
- [x] API Documentation Portal (портал + markdown/HTML экспорт + changelog, 25 тестов)
- [x] Load Testing Suite (k6 сценарии + orchestrator, 28 тестов)
- [x] Plugin Registry & Community (CLI + scaffold + awesome-asijs, 18 тестов)
- [x] VS Code Extension v0.2.0 (debugger + template explorer + diagnostics, 38 тестов)
- [x] REPL & Playground (asi repl + web playground, 32 теста)
- [x] Framework Adapters (@asijs/next, @asijs/astro, @asijs/remix, @asijs/sveltekit, 33 теста)
- [x] Pre-release Security Audit (3 CRITICAL, 2 HIGH, 3 MEDIUM, 1 LOW — все исправлены)
- [x] README + benchmark badges + MIGRATION.md
