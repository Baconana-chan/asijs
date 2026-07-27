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

- [ ] **`packages/mcp-asijs/`** — выделенный пакет для MCP
- [ ] **Pluggable transport**:
  - `stdio` transport (основной) — Claude Desktop, Cursor, Zed, Continue.dev
  - `http` transport (существующий, как опция)
  - `sse` transport (streaming)
  - Transport interface для кастомных транспортов
- [ ] **Protocol v2025-05**:
  - Prompts — шаблонизированные промпты для AI (analyze route, generate CRUD, debug request)
  - Sampling — LLM-to-LLM вызовы (агентные цепочки)
  - Roots — клиент говорит серверу «вот корень проекта»
  - Progress — долгие операции с прогресс-барами
  - Pagination — `tools/list` с cursor для 1000+ роутов
  - Streaming results — `image`, `audio`, `blob` content types
- [ ] **Deep AsiJS v1.3 integration**:
  - Circuit Breaker состояния (healthcheck, OPEN/CLOSED/HALF_OPEN)
  - WebSocket Pub-Sub комнаты (presence, активные соединения)
  - Hot Reload статус (какие файлы меняются)
  - SSG страницы (статические пути)
  - Serverless cold start статистика
  - Plugin dependency graph
  - Rate limiter метрики (текущий RPS, лимиты)
- [ ] **Dynamic documentation** — парсинг vitepress `.md` файлов вместо hard-coded `ASIJS_DOCS`
- [ ] **Auth** — встроенная поддержка Bearer token + rate limiting через AsiJS middleware
- [ ] **Custom workflow definitions** — AI может создавать кастомные воркфлоу (webhooks → action → response)
- [ ] **Тесты**: 25+ тестов (stdio, protocol, pagination, asi-bridge)

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

- [ ] **Workspace dashboard v2** — реальный мониторинг для multi-app:
  - CPU/Memory per app instance
  - Request rate per app (live chart)
  - Error rate per route (live chart)
  - WebSocket connections per app
  - Circuit breaker status per app
- [ ] **Hot reload per app** — не только root, но и sub-apps
- [ ] **Shared state bus** — EventBus между sub-apps (через Redis)
- [ ] **Graceful shutdown cascade** — правильный порядок: sub-apps → root

### 1.3 — CLI v2: Smarter Developer Tools

- [ ] **`asi dev --inspect`** — открывает REPL + DevTools в одном терминале (split pane)
- [ ] **`asi analyze`** — статический анализ проекта:
  - Неиспользуемые роуты
  - Дублирующиеся middleware
  - Отсутствующая валидация
  - Bottleneck detection (синхронные handler'ы в async цепочке)
- [ ] **`asi upgrade`** — автоматическое обновление AsiJS + codemod для breaking changes
- [ ] **`asi doctor`** — диагностика проекта:
  - Проверка конфигурации
  - Проверка зависимостей
  - Проверка TypeScript strict mode
  - Проверка security best practices
- [ ] **`asi template <name>`** — установка шаблона напрямую (без VS Code)

### 1.4 — Async Error Boundary: Structured Error Handling

- [ ] **`ctx.errorBoundary<T>(fn)`** — ловит ошибки в handler'е и возвращает structured response
- [ ] **Error classification** — бизнес-ошибки (400) vs системные (500) vs фатальные (crash)
- [ ] **Error reporting pipeline** — plugin hooks для Sentry, логирования, метрик
- [ ] **Retry policies** — автоматический retry для идемпотентных операций

---

## P2 🟡 — Production Hardening

*Улучшения для production-сценариев и эксплуатации.*

### 2.1 — Observability Suite

- [ ] **Structured logging v2** — OpenTelemetry Logs Bridge, semantic conventions
- [ ] **Distributed tracing** — W3C TraceContext propagation через Redis pub-sub (между инстансами)
- [ ] **Healthcheck dashboard** — `/__health` HTML страница со статусом всех компонентов (БД, Redis, circuit breakers)
- [ ] **Metrics dashboard** — Prometheus metrics + pre-built Grafana dashboard (JSON export)

### 2.2 — Performance Optimisations

- [ ] **Router v2** — benchmark-driven оптимизация:
  - Радикальное сокращение аллокаций в hot path
  - Pre-computed middleware chains при старте
  - Route-level compiled matchers (zero-allocation matching)
- [ ] **Response streaming** — полная поддержка `ReadableStream` в middleware chain
- [ ] **Connection pooling** — HTTP keep-alive тюнинг, maxConnections

### 2.3 — Database Layer

- [ ] **`asi db`** — CLI для управления БД:
  - `asi db migrate` — управление миграциями (не только drizzle/-prisma)
  - `asi db seed` — сидирование данных
  - `asi db studio` — встроенный GUI для БД (аналог Prisma Studio)
- [ ] **Auto-migration** — `autoMigrate: true` в `AsiConfig.database`

---

## P3 🔵 — Backlog / Experiments (v1.5+)

*Крупные фичи для будущих релизов.*

### 3.1 — GraphQL Plugin v2

- [ ] **Code-first** — TypeBox → GraphQL schema (декларативно, без codegen)
- [ ] **Subscription support** — через WebSocket
- [ ] **Federation support** — Apollo Federation совместимость
- [ ] **Performance** — DataLoader, query complexity analysis, persisted queries

### 3.2 — @asijs/react: React Server Components

- [ ] RSC rendering pipeline на AsiJS
- [ ] Server/client component границы
- [ ] Streaming SSR + hydration
- [ ] Аналог Next.js App Router на AsiJS

### 3.3 — @asijs/nest: NestJS-style Decorators

- [ ] `@Controller()`, `@Get()`, `@Post()`, `@Param()`, `@Body()`, `@Query()`
- [ ] `@Injectable()`, `@Module()` — DI на AsiJS
- [ ] AOT compilation декораторов в plain handlers (performance)

### 3.4 — MCP v3: AI Agent Ecosystem

- [ ] **Agent Runtime** — запуск AI агентов прямо на AsiJS
- [ ] **Tool Marketplace** — `asi mcp install <tool>` из registry
- [ ] **Agentic Workflows** — визуальный редактор (web) для цепочек AI → API → DB
- [ ] **Embeddings API** — встроенный векторный поиск по API документации

### 3.5 — @asijs/electron: Desktop Framework

- [ ] AsiJS как бэкенд для Electron приложений
- [ ] IPC bridge: renderer → AsiJS handler
- [ ] Auto-updater интеграция
- [ ] Native OS меню, уведомления, трей

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
