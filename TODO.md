# TODO.md — AsiJS Roadmap

> **Текущая версия**: v1.2.0 · **Runtime**: Bun + Node.js + Edge · **Статус**: Production-ready
>
> Документ разбит на **4 приоритетных уровня** от P0 (критично для 1.3.0) до P3 (можно отложить).
> Факты: **700 тестов**, `tsc --noEmit` чисто, **0 падающих**, CI/CD auto-publish.
> Архив завершённого — в конце.

---

## Актуальное состояние (July 2026 · v1.2.0)

| Аспект | Состояние | Подробности |
|--------|-----------|-------------|
| Ядро / роутинг | ✅ Стабильно | Trie + Radix router, middleware flattening, hooks, context |
| Валидация | ✅ Стабильно | TypeBox, coercion, LRU schema cache, детальные ошибки |
| Плагин-система | ✅ Стабильно | createPlugin, guards, decorators, sharedState |
| Auth / JWT / CSRF | ✅ Тесты есть | JWT, bearer, hashPassword, CSRF, CSRF double-submit |
| OpenAPI / Swagger | ✅ Тесты есть | OpenAPI 3.0 + 3.1, Swagger UI, автогенерация |
| Rate Limiting | ✅ Тесты есть | MemoryStore, TokenBucket, TenantStore, Redis, IP/Key/User presets |
| Cache | ✅ Тесты есть | ETag, MemoryCache, presets |
| Security | ✅ Тесты есть | CSP, HSTS, COEP, nonce, CORS advanced |
| Trace / Metrics | ✅ Тесты есть | W3C traceparent, Server-Timing, Prometheus/OTLP, Sentry |
| Scheduler | ✅ Тесты есть | Cron, interval, retry, Redis queue |
| JSX / Streaming | ✅ Тесты есть | renderToString/ToStream, Suspense, JSON streaming, NDJSON |
| MCP / AI helpers | ✅ Стабильно | Публичные методы Asi, без @ts-ignore |
| RPC 2.0 | ✅ Тесты есть | serverAction, rpc(), createRPCClient |
| Workspace / Multi-app | ✅ Тесты есть | Workspace class, единый Bun.serve(), dev dashboard, OpenAPI |
| Codemods | ✅ Тесты есть | Elysia/Hono/Fastify → AsiJS, 75 тестов |
| File-based routing | ✅ Тесты есть | scanRoutes, registerFileRoutes, 21 тест |
| Standalone dev mode | ✅ Тесты есть | 17 тестов |
| Error Pages (JSX) | ✅ 41 тест | Error-page discovery, XSS-safe, pretty dev mode |
| Sessions middleware | ✅ Тесты есть | MemoryStore, CookieStore, signed cookies, TTL |
| Content negotiation | ✅ Тесты есть | parseAccept, bestMatch, ctx.negotiate(), 406 fallback |
| Response compression | ✅ Тесты есть | gzip (Bun + Node.js), Vary, threshold, content filter |
| SSE | ✅ Тесты есть | Server-Sent Events, auto-reconnect |
| Healthcheck | ✅ Готово | /health, /ready, /live с кастомными checks |
| Dev error page | ✅ Готово | Stack trace, source context, syntax highlight, copy error |
| WebSocket graceful shutdown | ✅ Готово | drain 1001, terminate fallback, lifecycle |
| Node.js Adapter | ✅ 21 тест | EADDRINUSE retry, WebSocket через ws пакет |
| CLI | ✅ Работает | create, dev, migrate, inspect, generate |
| TypeScript types | ✅ Чисто | `tsc --noEmit` — 0 ошибок |
| CI/CD | ✅ Auto-publish | 2 workflows: main (npm+JSR+ESLint на `v*`), eco (VS Code + ESLint на `eco-*`), dry-run, tag→version validation |
| Тесты | ✅ **700/700** проходят | Все тесты зелёные, 0 падающих |
| Документация | 🔶 Хорошая | VitePress, 23 страницы, поиск, gh-pages |
| Platform adapters | ✅ Node.js + Edge | Deno, CF Workers, Vercel, Lambda@Edge, Netlify |
| Ecosystem | ✅ 7 модулей | Codegen, Auth.js, Upload, Auto API, VS Code ext, ESLint plugin, CLI generate |
| Web Infrastructure | ✅ 6 модулей | Webhooks, Range, Trust Proxy, Subdomain, SPA fallback, HTTP/2 hints |
| Type Safety | ✅ 3 модуля | Response validation, typed i18n, OpenAPI 3.1 |
| Docker | ✅ Готово | Dockerfile + docker-compose (app + postgres + redis) |
| Benchmark dashboard | 🔶 Локально | Нет CI-публикации на gh-pages |

---

## P0 🔴 — Критический долг (сделать до следующего релиза)

*То, что мешает проекту быть стабильным и production-ready.*

### 0.1 — Починить 2 падающих теста ✅
- [x] **`Phase 6 > Auto Port > PORT from environment`**: мутировал `process.env.PORT` без `try/finally`, порт `4200` конфликтовал с параллельными тестами. Фикс: уникальный порт `42137` + `try/finally` + `originalPort !== undefined`. ([`test/phase6.test.ts`])
- [x] **`findStandaloneEntry() > returns null when no entry found`**: `writeFileSync(join(dir, "src/utils.ts"))` падал с ENOENT, потому что поддиректория `src/` не была создана. Фикс: добавить `mkdirSync(join(dir, "src"), { recursive: true })` перед записью. ([`test/standalone-dev.test.ts`])

### 0.2 — Устранить @ts-ignore в mcp.ts ✅
MCP-сервер обращается к private-полям Asi через `@ts-ignore`. Это хрупко и сломается при рефакторинге.
- [x] Добавлены публичные методы в `Asi`: `getRoutes()`, `getPlugins()`, `getMiddlewareInfo()`, `getAppConfig()`
- [x] Экспортированы типы: `RouteInfo`, `MiddlewareInfo`, `AppConfigInfo`
- [x] MCP-хелперы переписаны без `@ts-ignore` (4 места)
- [x] MCP тесты проходят: 3/3

### 0.3 — Написать тесты для error-pages.ts ✅
- `error-pages.ts` — полноценный модуль (340+ строк)
- [x] 41 тест, покрывающий все 5 экспортированных функций
- [x] `shouldRenderHtmlErrorPage()`: Accept, Sec-Fetch, метод (11 тестов)
- [x] `getErrorPageSearchRoot()`: умолчание и кастомный rootDir (2 теста)
- [x] `discoverErrorPagePath()`: disabled, autoDiscover=false, нет файла (4 теста)
- [x] `renderDefaultErrorPage()`: 404/500, suggestions, XSS, dev/prod (11 тестов)
- [x] `renderDiscoveredErrorPage()`: все пути возврата null (3 теста)
- [x] Интеграция с Asi: HTML vs JSON 404/500, suggestions (10 тестов)
- [x] 🔥 Найден и исправлен XSS в стеке ошибок (stack не экранировался)

### 0.4 — Code TODOs / FIXMEs ✅
- [x] `src/compiler.ts:397` — `// TODO: full match logic` → реализовано сравнение всех сегментов: статика (===), параметры (:id → params[id]), wildcard (* → segments.slice)
- [x] `src/codemod.ts:409` — `// TODO: move $2 routes here` → улучшен комментарий с указанием имени под-приложения и префикса

---

## P1 🟠 — Рост для adoption (1–2 месяца)

*Фичи, которые откроют AsiJS для 90% новой аудитории.*

### 1.1 — Docs сайт (приоритет #1 для adoption) ✅
- [x] VitePress установлен и настроен (v1.6.4)
- [x] 23 страницы документации, конвертированные из `DOCUMENTATION.md`
- [x] Полноценная навигация: sidebar, nav, поиск, edit link
- [x] GitHub Actions workflow для деплоя на GitHub Pages
- [x] `base: '/asijs/'` для под-пути репозитория
- [x] Сборка проходит: `vitepress build docs` ✅
- [x] Скрипты: `docs:dev`, `docs:build`, `docs:preview`

### 1.2 — Node.js Adapter (приоритет #2) ✅
Node.js = 90% существующих проектов. Реализован pluggable ServerAdapter с WebSocket через ws пакет.

- [x] `src/runtime/types.ts` — интерфейс ServerAdapter (createServer, ServerInfo, ServerHandle, autoPort config)
- [x] `src/runtime/node/server.ts` — Node.js HTTP сервер на http.createServer() с lazy dynamic imports
- [x] Внутренний EADDRINUSE retry: async ретрай по портам через tryListen(), порт читается динамически через server.address()
- [x] `src/runtime/node/index.ts` — точка входа `asijs/node` с экспортами: nodeAdapter, ensureHttp, isHttpReady
- [x] `src/asi.ts` — опция `serverAdapter` в AsiConfig, sync-совместимый `_createServer()` с fallback на Bun.serve()
- [x] `package.json` — exports для `asijs/node` с путями на dist
- [x] 21 тест для Node.js адаптера (module loading, createServer, EADDRINUSE, Asi.listen() integration)
- [x] WebSocket на Node.js через ws пакет (beforeUpgrade, echo, multiple routes)

### 1.3 — Sessions middleware ✅
Фундаментальная фича для веб-приложений. Memory / cookie stores.

- [x] `app.use(sessions({ secret, store, ttl }))` — middleware, гибкие опции
- [x] `ctx.session` — объект сессии в каждом запросе (через Object.defineProperty)
- [x] SessionStore интерфейс — get/set/delete/touch, pluggable
- [x] SessionMemoryStore — in-memory с TTL, auto-cleanup, unref
- [x] CookieStore — stateless, signed cookies (HMAC-SHA256), encode/emptyCookie
- [x] Session класс — get/set/delete/clear/regenerate/destroy/save/toJSON
- [x] Автоматическая загрузка сессии на request, сохранение на response
- [x] Cookie: httpOnly, SameSite=Lax, Max-Age, path
- [x] Type-safe: `session.get<User>("key")` через generic
- [x] Экспорты: sessions, Session, SessionMemoryStore, CookieStore, SessionStore, SessionOptions

### 1.4 — Request logger ✅
Цветной логгер для dev-режима: method, path, status, duration.

- [x] `app.use(requestLogger({ format, exclude, filter, logHandler }))` — гибкая конфигурация
- [x] 4 формата: `"dev"` (цветной), `"json"` (structured), `"short"`, `"tiny"`
- [x] ANSI цвета: методы (GET=green, POST=blue, DELETE=red), статусы (2xx=green, 4xx=yellow bg, 5xx=red bg)
- [x] JSON для production: `{"method":"GET","path":"/","status":200,"duration":1.23}`
- [x] Exclude paths: `/health`, `/ready`, `/live`, `/metrics` (по умолчанию)
- [x] Кастомный `filter` и `logHandler`
- [x] X-Request-ID / X-Trace-ID из заголовков
- [x] Автоуровень: `console.error` для 5xx, `console.warn` для 4xx, `console.log` для 2xx/3xx
- [x] showQuery — опциональный вывод query string

---

## P2 🟡 — Важно, но не блокирует релиз (2–4 месяца)

*Улучшения для production-сценариев и DX.*

### 2.1 — SSE (Server-Sent Events) ✅
- [x] `app.sse("/events", handler)` с автоконнектом, id, retry
- [x] Клиентский хелпер: `createSSEClient(url)`

### 2.2 — CORS advanced ✅
- [x] Динамический origin (по базе данных / allowlist)
- [x] Async origin resolver + wildcard matching (`*.example.com`)
- [x] Origin cache для производительности
- [x] Поддержка credentials, expose-headers, max-age
- [x] Private Network Access (CORS-RFC1918)
- [x] Vary: Origin для кэширующих прокси

### 2.3 — Healthcheck endpoints preset ✅
- [x] `/health`, `/ready`, `/live` с кастомными проверками (БД, Redis, upstream)
- [x] `healthCheck({ checks: { db: () => db.ping() } })` — middleware с named checks

### 2.4 — Pretty error page в dev mode ✅
- [x] Stack trace + source code context (читает исходники, показывает 5 строк до/после ошибки)
- [x] Синтаксис-подсветка TypeScript (keywords, strings, numbers, comments)
- [x] User frames auto-expand, collapsible stack frames
- [x] Боковая панель: query params, request headers, body preview, route suggestions, env info
- [x] Кнопка "Copy error" (clipboard API)
- [x] Отдельная 404 страница с suggestions
- [x] Правильный приоритет: custom handler → discovered pages → dev pretty → default

### 2.5 — Response compression (brotli/gzip) ✅
- [x] `app.use(compression({ threshold: 1024 }))` — gzip через Bun native + Node.js zlib fallback
- [x] Content-Encoding: gzip по Accept-Encoding (br, deflate, */*)
- [x] Configurable threshold (min body size), level (1-9), exclude/include content types
- [x] Compressible type filtering (text/*, application/json, font/*, image/svg+xml)
- [x] Vary: Accept-Encoding для корректного кэширования (append к существующему Vary)
- [x] ETag removal на сжатых ответах

### 2.6 — Content negotiation ✅
- [x] `parseAccept(header)` — парсинг Accept с quality values, wildcards, сортировка
- [x] `bestMatch(header, supported, defaultType)` — выбор лучшего формата
- [x] `ctx.negotiate({ json: data, html: template })` — автоматический выбор ответа
- [x] `negotiateResponse(ctx, handlers, options)` — standalone функция
- [x] Поддержка асинхронных handler-ов: `json: () => fetchData()`
- [x] Поддержка JSON / HTML / XML / text / кастомных MIME типов
- [x] 406 Not Acceptable при отсутствии подходящего формата

### 2.7 — Rate limit by IP/API Key/User presets ✅
- [x] `rateLimitPresets.byIp` — IP-based (X-Forwarded-For, X-Real-IP, fallback)
- [x] `rateLimitPresets.byApiKey(headerName?)` — по заголовку (X-API-Key по умолчанию)
- [x] `rateLimitPresets.byUserId` — из сессии (session.get("userId")), fallback IP
- [x] `rateLimitPresets.byHeader(headerName, prefix?)` — generic header key generator
- [x] `rateLimitPresets.combine(...generators)` — комбинация нескольких keyGenerator
- [x] `rateLimit({ keyGenerator: rateLimitPresets.byIp })` — интеграция с существующими API

### 2.8 — Graceful shutdown для WebSocket ✅
- [x] Drain активных WebSocket-соединений перед остановкой
- [x] Отправка close frame с кодом 1001 (going away)
- [x] `drainWebSockets()` — async метод с polling + terminate fallback
- [x] `wsDrainTimeout` в LifecycleOptions (по умолчанию 10s)
- [x] Интеграция с LifecycleManager (drain → stop → handlers)

### 2.9 — Dockerfile + docker-compose пример ✅
- [x] Мультистейдж билд: bun install → build → production
- [x] docker-compose.yml: app + postgres + redis + adminer
- [x] Healthcheck в Dockerfile (/health endpoint)
- [x] Не-root пользователь (security best practice)
- [x] `.dockerignore` — исключены dev/test/docs артефакты
- [x] `.env.example` — шаблон для конфигурации
- [x] `docker/Dockerfile.app` — копируемый шаблон для AsiJS приложений
- [x] `docker/src/index.ts` — пример AsiJS приложения с /health, /ready, CRUD API
- [x] `docker/db/init/01-init.sql` — автоинициализация Postgres

### 2.10 — CLI: `asi inspect` ✅
- [x] `asi inspect` — summary: routes + plugins + middleware + port + entry file
- [x] `asi inspect --routes` / `-r` — таблица routes с цветными методами (GET=green, POST=blue, DELETE=red)
- [x] `asi inspect --routes --verbose` / `-v` — handler name, line number, validation status
- [x] `asi inspect --plugins` / `-p` — список плагинов с определением типа (cors, rateLimit, lifecycle...)
- [x] `asi inspect --size` / `-s` — анализ размера бандла через `bun build --minify`
- [x] Regex-based сканирование исходников (не требует запуска приложения)
- [x] Поддержка entry discovery (findStandaloneEntry, src/index.ts, src/index.tsx, src/app.ts, index.ts)

---

## P0 🔴 — Критично для v1.3.0

*Блокеры качества и стабильности. Без них релиз не выходит.*

### 0.1 — Тест-качество: дорыть покрытие

Некоторые модули 1.2.0 имеют минимальное или нулевое тестовое покрытие:

- [ ] `src/authjs.ts` — Auth.js adapter (0 тестов асинхронной логики: signIn, signOut, session refresh, JWT encode/decode)
- [ ] `src/upload.ts` — Upload provider (0 тестов стораджей: local FS, S3 fetch, MIME validation, size limits, naming strategies)
- [ ] `src/auto-api.ts` — Auto API (0 тестов SQL генерации: buildSelectSQL filters, pagination, сортировка, schema introspection)
- [ ] `src/redis.ts` — Redis store (0 реальных тестов: rate limit sorted sets, queue FIFO, delayed jobs, retry, dead letter)
- [ ] `src/structured-logger.ts`, `src/sentry.ts` — 0 тестов Sentry envelopes, transport, breadcrumbs
- [ ] `packages/vscode-asijs/` — 0 тестов extension (webview, hover provider)
- [ ] `packages/eslint-plugin-asijs/` — 0 тестов правил (no-unused-route, validate-schema и т.д.)

### 0.2 — Баги и регрессии

- [ ] Проверить и исправить потенциальные баги в новых модулях (ручное тестирование сценариев)
- [ ] Проверить совместимость Node.js адаптера с Bun (обратная совместимость)
- [ ] Проверить, что все `asijs/*` subpath exports работают (`asijs/node`, `asijs/client`, `asijs/spa`)

### 0.3 — CI: Benchmark dashboard на gh-pages

- [ ] `benchmarks.yml` уже собирает данные, но не деплоит dashboard на GitHub Pages
- [ ] Добавить шаг deploy к существующему workflow
- [ ] Опубликовать `/benchmarks` страницу на GitHub Pages

---

## P1 🟠 — Рост для adoption (для v1.3.0)

*Фичи, которые откроют AsiJS для новой аудитории и сценариев.*

### 1.1 — Hot Reload 2.0 (без рестарта процесса)

Текущий `bun --hot` перезапускает весь процесс. Нужен file-watcher, который:

- [ ] Следит за `src/` через `fs.watch` с дебаунсом (200ms)
- [ ] При изменении handler/middleware — перезагружает только их (без пересоздания Asi-инстанса)
- [ ] При изменении конфига/роутов — полный reload
- [ ] HMR для JSX-компонентов в dev mode (обновление в браузере без перезагрузки страницы)
- [ ] WebSocket push для browser HMR (аналогично Vite)

### 1.2 — API Versioning middleware

- [ ] `app.use(apiVersion({ default: "1.0", header: "Accept-Version" }))`
- [ ] URL-based: `GET /v2/users` → маршрутизация на v2 handler
- [ ] Header-based: `Accept-Version: 2.0` → маршрутизация внутри того же роута
- [ ] Fallback strategy: latest / stable / specific default
- [ ] Deprecation warnings в headers (`Sunset`, `Deprecation`)
- [ ] OpenAPI integration: multiple versions → multiple specs

### 1.3 — SSG / Static Export

- [ ] `asi build --ssg` — build-time HTML pre-rendering
- [ ] Определение статических страниц (без динамических данных)
- [ ] `getStaticPaths()` — аналог Next.js для динамических маршрутов
- [ ] Инкрементальный re-build (только изменённые страницы)
- [ ] Экспорт в `dist/` с готовыми .html файлами (SPA без сервера)
- [ ] CLI шаблон `-t static`

### 1.4 — WebSocket Broadcast / Pub-Sub

- [ ] `ws.broadcast(event, data)` — отправить всем клиентам в комнате
- [ ] `ws.join(room)` / `ws.leave(room)` — комнаты/каналы
- [ ] Redis pub-sub bridge: разослать сообщение между несколькими инстансами
- [ ] Presence tracking: кто онлайн, в каких комнатах
- [ ] Typed events: `ws.on<MyEvent>("message", handler)`

---

## P2 🟡 — Production hardening (можно в 1.3.x patch)

*Улучшения для production-сценариев и эксплуатации.*

### 2.1 — Plugin Dependency & Ordering System

- [ ] `app.plugin(authPlugin).dependsOn(["sessions", "cors"])` — гарантия порядка
- [ ] Граф зависимостей с проверкой циклических ссылок
- [ ] Lazy plugin init (не вызывать setup, пока не будут готовы все зависимости)
- [ ] Plugin hooks: `onBeforeInit`, `onAfterInit`, `onBeforeRoute`
- [ ] `app.pluginInfo()` — визуализация графа (CLI inspect)

### 2.2 — Integration & E2E Tests

- [ ] Docker-based test containers: PostgreSQL, Redis, MinIO (S3)
- [ ] `test/integration/` — реальные запросы к БД через auto-api
- [ ] `test/e2e/` — полный цикл: auth → upload → CRUD → WebSocket
- [ ] Redis queue E2E: push → process → complete с проверкой результата
- [ ] Node.js adapter E2E: запрос через `http.request`, WebSocket через `ws`

### 2.3 — Circuit Breaker & Resilience

- [ ] `circuitBreaker(options)` — middleware для внешних API вызовов
- [ ] Три состояния: CLOSED (норма) → OPEN (ошибки > threshold) → HALF_OPEN (пробный запрос)
- [ ] Timeout per request, error threshold за окно, recovery timeout
- [ ] `ctx.circuitBreaker("stripe-api", () => fetch(...))` — встроенный API
- [ ] Healthcheck integration: `/ready` возвращает статус circuit breaker
- [ ] Metrics: состояние, счётчики success/failure/reject/recovery

### 2.4 — Request Deduplication & Cache Stampede Protection

- [ ] `deduplicate(options)` — middleware: одинаковые параллельные запросы → один бэкенд
- [ ] Key-based dedup: по URL, query, body, кастомный key generator
- [ ] TTL ожидания: второй запрос ждёт первый (max 5s, затем fallback)
- [ ] Cache stampede protection: probabilistic early expiration (XFetch algorithm)
- [ ] Интеграция с MemoryCache / Redis

### 2.5 — Serverless Cold Start Optimisation

- [ ] Minimal bundle: `asi build --target cloudflare` — только нужные модули
- [ ] Lazy import всех плагинов (не загружать, пока не вызван setup)
- [ ] Warm start эмуляция: предзагрузка кэша схем, middleware chain
- [ ] Документация: best practices для Lambda@Edge / Cloudflare Workers

---

## P3 🔵 — На потом (backlog / эксперименты)

*Хорошие идеи, но не критично для 1.3.0. Можно брать при наличии времени.*

### 3.1 — Migration from Express / Koa

- [ ] `asi integrate express-app ./app.js` — обёртка Express middleware в AsiJS plugin
- [ ] Адаптер `@asijs/express` — запуск Express внутри AsiJS (для поэтапной миграции)
- [ ] Кодмод для Express → AsiJS (аналогично Elysia/Hono)
- [ ] Кодмод для Koa → AsiJS

### 3.2 — OpenTelemetry SDK Integration

- [ ] `@asijs/opentelemetry` — автоматическая инструментация:
  - Spans: request lifecycle, handler execution, DB queries, external HTTP calls
  - Context propagation: W3C TraceContext, baggage
  - Exporter: OTLP gRPC/HTTP, Jaeger, Zipkin
- [ ] Метрики через OTel Metrics SDK (в дополнение к Prometheus)
- [ ] Логи через OTel Logs SDK (в дополнение к JSON логгеру)

### 3.3 — API Documentation Portal

- [ ] Вместо Swagger UI — полноценный портал документации
- [ ] Экспорт в Markdown/HTML для CI/CD
- [ ] Code samples для разных языков (curl, Python, JS, Go)
- [ ] Try-it-out с реальными запросами к running серверу
- [ ] Changelog / version diff для API

### 3.4 — Load Testing Suite

- [ ] `bench/load/` — k6 сценарии: auth flow, CRUD, WebSocket, file upload
- [ ] `bench/load/k6-options.js` — настройки: виртуальные пользователи, duration, thresholds
- [ ] `npm run bench:load` — запуск через `docker run k6` (без установки k6)
- [ ] CI: прогон load тестов перед каждым релизом
- [ ] Отчёт: p50/p95/p99 latency, RPS, error rate в GitHub Summary

### 3.5 — Plugin Registry & Community

- [ ] `asi plugin search [query]` — поиск плагинов в registry
- [ ] `asi plugin install <name>` — установка из npm + добавление в package.json
- [ ] `asi plugin create` — scaffold нового плагина с шаблоном
- [ ] `awesome-asijs` — curated список плагинов и интеграций в README
- [ ] Шаблон для contribution: CONTRIBUTING.md + PLUGIN_DEV_GUIDE.md

### 3.6 — VS Code Extension: Debugger & Template Explorer

- [ ] Debug adapter: запуск AsiJS приложения под отладчиком
- [ ] Breakpoints в handler'ах через source maps
- [ ] Template explorer: выбор шаблона проекта + preview файлов
- [ ] "Create AsiJS Project" — GUI wizard для `asi create`
- [ ] Inline error highlighting в .ts файлах (ESLint интеграция)

### 3.7 — Interactive REPL / Playground

- [ ] `asi repl` — интерактивная консоль AsiJS:
  - Создание роутов на лету: `app.get("/", () => "Hello")`
  - Тестирование запросов: `await app.fetch(new Request(...))`
  - Просмотр состояния: `app.getRoutes()`, `app.getPlugins()`
- [ ] Web playground (как Swagger Editor) — браузерная IDE с AsiJS
- [ ] Поддержка TypeScript в REPL через `tsx` или `bun --eval`

### 3.8 — Framework Adapters

- [ ] `@asijs/next` — запуск AsiJS как API route в Next.js
- [ ] `@asijs/astro` — AsiJS как Astro server endpoint
- [ ] `@asijs/remix` — AsiJS как Remix loaders/actions
- [ ] `@asijs/sveltekit` — AsiJS как SvelteKit server hooks
- [ ] Документация: интеграция с популярными мета-фреймворками

---

## Архив — Завершённые фазы (v0 → v1.1.1)

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
- [x] Static code analysis / code generation (TypeCompiler, StaticRouter, compileHandler)

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
- [x] CLI (create, dev, migrate)
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
- [x] README + benchmark badges + MIGRATION.md
