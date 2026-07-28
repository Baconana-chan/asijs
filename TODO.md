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
- [ ] **`flattenMiddleware: true` по дефолту** — MiddlewareChainFlattener уже реализован, но не включён. Compile-time flatten middleware chains в одну flat async функцию
- [ ] **Flat middleware detection** — middleware без `next()` (большинство) — sequential loop без chain overhead
- [ ] **Pre-compiled handler + middleware** — единая async функция без overhead на runtime loop
- [ ] **Ожидаемый эффект**: +80-100% для middleware-heavy сценариев (189k → 350k+)

#### 🔴 2.2.2 — Router Hot Path: Inline Static Routing

**Проблема**: GET / (самый частый эндпоинт) — каждый запрос проходит полный Trie lookup с `parsePath()`, аллокацией массива сегментов, Map lookups.

**Решение**:
- [ ] **`router: "radix"` по дефолту** — RadixTreeRouter уже реализован (sorted array + binary search вместо Map, меньше узлов)
- [ ] **Inline route bypass** — для статических путей (`GET /`, `GET /health`) — прямая проверка вместо Router.find()
- [ ] **Pre-parsed path cache** — LRU кэш для `parsePath()` (path → segments)
- [ ] **String interning** — интернировать имена параметров `params.id`, `params.userId` — reuse объектов вместо создания новых
- [ ] **Ожидаемый эффект**: +15-25% для GET / (402k → 460k+)

#### 🔴 2.2.3 — Context Pool: Zero-Allocation Request Cycle

**Проблема**: Каждый запрос создаёт новый Context с полным набором полей (path, params, query, headers, body). Даже если запрос не использует query/body — они всё равно инициализируются. GC pressure на 300k+ rps.

**Решение**:
- [ ] **Context Pool** — Recycler pattern: пул из 1000 pre-allocated Context объектов
  - acquire() → получает готовый Context из пула
  - release(ctx) → сброс (поля в undefined) → возврат в пул
  - Pool growth — если все Context'ы заняты, создать новый (+automatic shrink)
- [ ] **Lazy getters** — `query`, `body()`, `formData()` только через getters, не инициализировать в конструкторе
- [ ] **Убрать лишние console.log** из `_setQuery()` / `_setBody()` в compiled mode
- [ ] **Ожидаемый эффект**: +10-15% для всех сценариев, особенно plain JSON

#### 🟠 2.2.4 — Security Headers: Pre-built Response

**Проблема**: SecurityManager на каждый запрос: итерирует CSP конфиг, генерирует nonce, устанавливает 5+ заголовков через `setHeader()`. Бенчмарк: 419k bare → 182k с securityHeaders (−56%).

**Решение**:
- [ ] **Pre-compiled Response** — для статических security headers (без nonce) — создать pre-built Response с фиксированными заголовками
- [ ] **Nonce path detection** — `autoNonce` только для HTML-ответов (Content-Type: text/html), не для JSON API
- [ ] **Inline header response** — вместо `setHeader()` для каждого заголовка, создавать Response сразу с headers Map
- [ ] **Preset-specific optimization** — `apiSecurityCore()` — всегда pre-built (нет CSP nonce), `maxSecurity()` — conditional
- [ ] **Ожидаемый эффект**: +50-80% для securityHeaders (182k → 300k+)

#### 🔴 2.2.5 — Complex Validation: Compiled TypeBox

**Проблема**: Complex validation (4-level nested object): AlsJS 35k rps vs Elysia 103k rps (−66%). Единственное место с критическим отставанием.

**Решение**:
- [ ] **`lruSchemaCache` по дефолту** — LRU cache для compiled TypeBox validators уже реализован
- [ ] **Schema flattening** — глубокие вложенные схемы → flatten на этапе compile, runtime не рекурсит
- [ ] **Compile-time validator injection** — pre-compiled TypeCheck вставляется прямо в сгенерированную функцию, без денаризации cache
- [ ] **Validate-only path** — оптимизация: если нужна только валидация (без coercion), использовать `TypeCheck.Validate()` вместо `Decode()`
- [ ] **Ожидаемый эффект**: +50-80% для complex validation (35k → 60k+)

#### 🟡 2.2.6 — Router: Query Param Optimisation

**Проблема**: GET /search?q=... — query парсинг через `URLSearchParams` с decodeURIComponent (даже если decode отключён, URL объект создаётся).

**Решение**:
- [ ] **Custom query parser** — inline parser без URL объекта: `q=a&b=c` → `{q:'a',b:'c'}` за один проход
- [ ] **Lazy query parsing** — геттер `ctx.query` парсит только когда обращаются
- [ ] **Ожидаемый эффект**: +10-15% для query-heavy сценариев

#### 🟡 2.2.7 — Static Files: In-Memory Cache

**Проблема**: staticFiles plugin — каждый запрос читает файл с диска (даже если Bun кэширует). Для маленьких файлов overhead I/O выше, чем обработка.

**Решение**:
- [ ] **preload cache** — `staticFiles({ preload: true, preloadGlob: "public/**/*.{html,css,js,svg}" })` — загрузить в память при старте
- [ ] **MemoryCache интеграция** — reuse существующего MemoryCache для static files с TTL
- [ ] **Ожидаемый эффект**: +20-30% для static file serving

#### 📊 Прогноз после всех оптимизаций

| Сценарий | Сейчас | После | vs Elysia |
|----------|--------|-------|-----------|
| GET / (simple JSON) | 402k | **460k+** | 68% → **77%** |
| Middleware chain (5 mw) | 189k | **350k+** | 35% → **64%** |
| GET /user/:id | 272k | **330k+** | 60% → **72%** |
| Complex validation | 35k | **60k+** | 34% → **58%** |
| Security headers | 182k | **300k+** | bare 43% → **71%** |

### 2.3 — Database Layer

- [ ] **`asi db`** — CLI для управления БД:
  - `asi db migrate` — управление миграциями (не только drizzle/-prisma)
  - `asi db seed` — сидирование данных
  - `asi db studio` — встроенный GUI для БД (аналог Prisma Studio)
- [ ] **Auto-migration** — `autoMigrate: true` в `AsiConfig.database`

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
