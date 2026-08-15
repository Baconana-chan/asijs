# Changelog

All notable changes to AsiJS will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.1] - 2026-08-15

### 🚀 Upload: Streaming Saves

- **`upload({ streaming: true })`** — файлы сохраняются через новый `saveStream` (память O(chunk) вместо O(file)): `file.stream()` пишется чанками напрямую на диск через Bun FileSink (fallback — Node `createWriteStream`). Для файлообменников это убирает вторую полную копию файла в JS-памяти на каждый загружаемый файл. Реализовано для local (FileSink/Node-pipe) и S3/R2 (streaming PUT с `Content-Length` и `duplex: "half"` под Node). Если storage не реализует `saveStream` — middleware бесшовно падает на буферизованный путь.
- **Размер-лимит проверяется дважды**: fast-reject по объявленному `file.size` из multipart-заголовков ДО чтения потока + mid-stream аборт по факту записанных байт (partial file удаляется — rejected upload не оставляет мусора на диске).
- **Local storage: async-запись** — `writeFileSync` (блокировал event loop на весь диск-IO, ~220ms на 50MB) заменён на `writeFile` (fs/promises). Буферизованный путь тоже не блокирует больше.
- **Benchmark `3c. File Upload + Save to Disk (256KB)`** — CI-бенчмарки upload меряли только multipart-парсинг; добавлен сценарий полного файлообменника (parse + persist). Локально: streaming 538 req/s vs buffered 421 req/s (**+28%**), при этом streaming сохраняет память.
- **Fully-Loaded GET разбит на честные пары** — старый бенчмарк сравнивал AsiJS full-stack (CORS+security+ETag+cache+rateLimit, 5 слоёв) против Elysia bare `cors+rateLimit` (2 слоя) — «11.2%» выглядело как поражение, хотя объём работы несравним. Теперь две группы: `1a` — **одинаковый набор middleware** на обоих (AsiJS 49.4k vs Elysia 35.0k = **141%**), `1b` — full-stack 5 слоёв vs Hono 4 слоя (6.3k vs 3.4k = **1.8×**).
- **README: Hono — основной конкурент, Elysia — reference** — AsiJS и Hono монолиты (всё в ядре), Elysia — микроядро (всё во внешних плагинах `@elysiajs/*`); сравнивать полные стеки этих архитектур некорректно (монолитное ядро «больше» микроядра по построению). Таблицы переставлены: колонка `vs Hono` — apples-to-apples (13 из 18 категорий AsiJS выигрывает), `vs Elysia` помечена `(ref)`. Known Gaps переписаны под Hono с конкретными механизмами отставания (404 body, structured 500, query-miss, static pipeline).

### 🐛 Bug Fixes

- **Packaging: dist paths** — `bun build` с несколькими entry points клал JS в `dist/src/*.js` (префикс `src/`), а `main`/`module`/`bin`/`exports` указывали на `dist/*.js` — npm ворнил «No bin file found at dist/cli.js», и у опубликованного пакета не работали main и CLI. Добавлен `--entry-naming '[name].js'`, вывод теперь совпадает с объявленными путями (`dist/index.js`, `dist/cli.js`, ...). Валидация через `npm pack --dry-run`: 0 warnings. **Важно: asijs@1.4.0 уже опубликован с этим багом — требуется перепубликация 1.4.1.**
- **Silent mode теперь действительно молчит** — `console.error("[Asi Error]")` и логи ошибок в `handleError()`/`notFound()`/плагинных хуках не гейтились за `silent: true`, из-за чего тесты с намеренными throw печатали большие `[Asi Error]`-блоки. Все error-логи обёрнуты в `if (!silent)` (контракт «отключить все логи»).
- **ioredis: слушатель `error` на клиенте** — при недоступном Redis печаталось `[ioredis] Unhandled error event` (в проде unhandled 'error' на EventEmitter может уронить процесс). Добавлен no-op слушатель: ошибки подключения/операций по-прежнему всплывают через rejected promises.
- **scanWorkspace: детерминированные порты** — порты назначались **до** сортировки по имени, а порядок `readdirSync` зависит от ФС (на Linux — hash-порядок) → в CI на Ubuntu порты могли «поменяться местами» и упасть тест. Теперь порты назначаются **после** сортировки (`3000, 3001, ...` по алфавиту).
- **buildSSG: `durationMs` не может быть 0** — `Math.round(...)` на быстрой машине (CI) давал 0 для сборки < 0.5ms → падал `expect(durationMs).toBeGreaterThan(0)`. Теперь `Math.max(1, ...)`.
- **Context pool: устранена регрессия hot path** — A/B v1.3.0 vs v1.4.0 на одной машине показал, что дефолтный пул контекстов замедлял простой `GET /` на **83%** (микробенчмарк с контрольными фреймворками: Elysia/Raw Bun/Hono флэт ±5%, AsiJS -33%). Причины и фиксы в `src/context.ts`: (1) `_reset()` вызывался **дважды** (acquire + release) с полным сканом полей и 4 аллокациями — acquire теперь делает лёгкий `_rebind()` (release уже оставил контекст чистым); (2) скан `for..in` + `Set.has` для удаления middleware-свойств заменён на дешёвый подсчёт ключей с полным сканом только когда свойства реально добавлены. Итог: оверхед пула **+83% → ~7%**, `GET /` с пулом теперь быстрее v1.3.0.
- **Middleware chain flattener: не применяется к роутам без middleware** — `flattenMiddleware` на роуте без middleware делал per-request кэш-лукап (Map.get + строка id) ради копии `executeHandler(len === 0)`, что стоило ~14%. Теперь флаттер используется только при `middlewares.length > 0`, без-middleware роуты идут через собственный fast-path `executeHandler`.
- **Радикс-роутер: fresh params на статических роутах** — отмечено, что radix аллоцирует свежий `params` объект на каждый статический матч (наблюдаемая нестабильность/проседание на малых таблицах роутов vs trie) — кандидат на отдельную оптимизацию (общий замороженный пустой объект для статических роутов).

### 📊 Benchmarking

- **P0 Hot-Path Benchmarks (`bench/p0.ts`)** — новые сценарии под 2.2-работу, подключены в CI-коллектор:
  - **Concurrency** (C=10/100/1000 in-flight) — AsiJS vs Elysia vs Hono; показывает, где context pool реально окупается. На локальном прогоне при C=1000 AsiJS ≈ Elysia (191k vs 190k req/s).
  - **Route Table Scaling** — radix vs trie при N=10/100/1000/10000 роутов (lookup последнего роута — worst case). Подтверждает: radix на малых таблицах нестабилен (fresh-params аллокация), на масштабе ≈ trie — нужна оптимизация из пункта выше.
  - **Static: preload vs disk** — память vs диск: локально **4.9–5.3×** (2.2.7).
  - **Array Validation (100 items) + Validation Error Path** — compiled-валидация: AsiJS > Elysia на валидном массиве и на error-path (invalid payload возвращает 400 у AsiJS, 422 у Elysia — expected-status учитывается, без ложных «errors»).
- **Фикс парсера коллектора (locale)** — `toLocaleString()` в русской локали Windows даёт пробел как разделитель тысяч (`16 354`), а regex `\d[\d,]*` допускал только запятые → локальные прогоны коллектора парсили почти ноль строк (на CI/en-US всё работало). Теперь regex принимает пробел/NBSP, а вывод всех бенчмарков форсируется `toLocaleString("en-US")`. Итог: локально парсится **102/102** результатов (было 7).
- **P1 API-Case Benchmarks (`bench/p1.ts`)** — вторые сценарии, подключены в CI-коллектор (7 групп):
  - **Query Cache (2.2.6)** — повторяющиеся query-строки (hit) vs уникальные (miss) vs `queryCache: false`. Учтён глобальный синглтон кэша: hit/miss гоняются на кэшированном приложении, `queryCache: false` создаётся после (иначе `disableDefaultQueryCache()` убил бы кэш и для hit-замера). Локально: hit ≈ disabled (64.9k vs 64.5k) > miss (52k) — кэш даёт ~25% на повторяющихся query, overhead на hit минимален (shallow copy при hit).
  - **404 Fast Path** — missing-route lookup: AsiJS vs Elysia vs Hono (ожидаемый статус 404, без ложных ошибок).
  - **Error Path** — handler бросает ошибку → 500: AsiJS (`silent: true`, не логирует), Elysia/Hono с явным `onError` (500 без шума в stderr).
  - **Large JSON Bodies (10KB/100KB, validated)** — compiled-валидация массивов на больших телах: AsiJS впереди Elysia на 10KB (7.1k vs 5.8k) и на 100KB (752 vs 609 req/s).
- **P2 Feature Benchmarks (`bench/p2.ts` + `bench/p2-alloc.ts`)** — сценарии для фич, у которых не было бенчмарков вообще (8 групп, подключены в CI-коллектор):
  - **WebSocket Pub/Sub** — broadcast через `RoomManager` на 1/10/100 клиентов (mock ws: `readyState` + `send`, без реального сервера).
  - **Cache Layer** — `MemoryCache` set/get (2.3M ops/s get vs 940k set), ETag-миддлварь 200 vs 304 fast-path, response-cache HIT vs MISS (64k vs 17k ops/s).
  - **Database Layer (2.3)** — sqlite in-memory CRUD: insert/select/update/delete + транзакция из 3 стейтментов (5.8k ops/s vs 56k delete).
  - **Allocations** — RSS growth per request, измеряется в **изолированном subprocess** (`bench/p2-alloc.ts`): Bun не возвращает страницы ОС, поэтому последовательные in-process замеры занижали бы второй сценарий. Локально: bare GET 2.6–2.8 KB/req, GET + 2 middleware 3.9–4.1 KB/req.
  - Парсер коллектора расширен: принимает `ops/s` и `bytes/req` помимо `req/s` (значение складывается в `rps`).
- **Dashboard: исторические тренды со всех категорий** — раньше `RPS Over Time` брал абсолютный RPS только из первой группы, где находилось имя фреймворка (обычно `GET / (simple JSON)`) — несопоставимо между категориями (GET /: 800k, upload: 7k) и ломалось при изменении набора групп между прогонами. Теперь:
  - **`Avg Score vs Best — all categories (%)`** — нормализованный score: для каждого снапшота и топ-5 фреймворков среднее `(rps / groupBest × 100)` по **всем** группам, где фреймворк присутствует. Lower-is-better группы (аллокации, bytes/req) инвертируются (`groupBest / rps`), так что 100% всегда = «лучший в категории». Тултип показывает число учтённых групп.
  - **`RPS by Category`** — второй чарт с выпадающим селектором: просмотр сырого RPS по любой группе за всю историю (по умолчанию `GET / (simple JSON)`).
  - Нюанс реализации: `bun run <script>` внутри другого bun-процесса зависает (вложенный spawn) — subprocess вызывается как `bun p2-alloc.ts` напрямую; `MemoryCache` держит cleanup `setInterval`, поэтому `main()` завершается явным `process.exit(0)` (иначе процесс висит после печати и коллектор падает с таймаутом).

## [1.4.0] - 2026-08-15

### 🚀 New Features

#### Async Error Boundary — Structured Error Handling
- **`ctx.errorBoundary<T>(fn)`** — ловит ошибки в handler'е: `fallback` / `onError(classified)` / `rethrow`. Возвращает structured response при выходе ошибки из роута.
- **Error classification** — `classifyError()`: business (4xx) vs system (5xx) vs fatal (crash) vs validation. Ошибки: `HttpError`, `BusinessError`, `NotFoundError`, `UnauthorizedError`, `ForbiddenError`, `ConflictError`, `SystemError`, `FatalError`. Structured body: `{ error, code, category, details, requestId }`.
- **Error reporting pipeline** — `errorBoundary()` plugin: reporters hooks (Sentry/логгер/метрики), `minCategory` фильтр, `requestId` correlation, глобальный `onError` handler. Хелперы: `runErrorReporters`, `tryCatch`.
- **Retry policies** — `retry(fn, { attempts, backoff: fixed|linear|exponential, jitter, shouldRetry, onRetry })` + `computeBackoff()`. Дефолтный `shouldRetry`: 5xx и сетевые ошибки. 26 тестов.

#### Observability Suite
- **Structured logging v2 — OTel Logs Bridge** — `otelLogs()` plugin + `OTLPLogsExporter`: StructuredLogEntry → OTLP LogRecord (OTel semantic conventions: service.name, http.request.method, url.path, http.response.status_code, error.type...), батчинг (bufferSize) + периодический flush, экспорт в любой OTLP/HTTP collector (Grafana Loki, SigNoz, Honeycomb). Хелперы: `entryToOTLPLogRecord`, `levelToSeverityNumber/Text`, `createOTelLogger`. 4 теста.
- **Distributed tracing — W3C TraceContext через Redis** — `RedisTraceBridge` + `createRedisTraceBridge()`: span-события (traceId/spanId/parentSpanId) публикуются в Redis pub/sub канал, другие инстансы подхватывают и продолжают трассу. `newTraceId()`/`newSpanId()` W3C-совместимые. 3 теста.
- **Healthcheck dashboard** — `healthDashboard()` middleware: `GET /__health` — live HTML страница (статус всех компонентов: кастомные проверки, circuit breakers OPEN/CLOSED/HALF_OPEN, PID/uptime/RSS/heap, auto-refresh 5s) + `GET /__health.json` — JSON snapshot (200/503 по статусу). 5 тестов.
- **Metrics dashboard** — `createGrafanaDashboard()` генерирует pre-built Grafana dashboard JSON (7 панелей: requests total/rps/avg, requests by status, latency p50/p90/p99, top paths, error rate) для импорта. 3 теста.

#### Workspace Mode
- **Workspace dashboard v2** — реальный live-мониторинг multi-app на одном `Bun.serve()`:
  - Per-app метрики: request rate (req/s), error rate, avg duration, total requests, WebSocket connections
  - Per-route: count, errors, error %, avg duration
  - Circuit breaker status (OPEN/CLOSED/HALF_OPEN) из глобального registry
  - Process-level CPU/memory (PID, uptime, RSS, heap)
  - `GET /__asi/workspace` — dashboard с auto-refresh 2s (inline polling script)
  - `GET /__asi/metrics` — JSON endpoint для метрик
  - Опция `metrics: false` отключает сбор и endpoint
- **Shared state bus** — `EventBus` (emit/on/off/once, emitAsync, stats) + `createRedisEventBus()` для кросс-инстанс коммуникации через Redis. Передаётся в Workspace опцией `{ bus }`, каждый sub-app получает его через `app.getState("eventBus")`
- **Graceful shutdown cascade** — `Workspace.stop()` в правильном порядке: drain WebSocket sub-app'ов → lifecycle shutdown каждого sub-app → остановка корневого `Bun.serve()` последним
- **14 тестов** (dashboard v2, metrics, event-bus, shutdown cascade)

#### CLI v2 — Smarter Developer Tools
- **`asi analyze`** — статический анализ проекта: dead routes (дубли method+path), path shadowing (статический после динамического), отсутствующая валидация на мутирующих роутах, дублирующийся middleware, bottleneck detection (redundant async, await без async, sync middleware с await). Флаги: `--info`, `--json`, `--cwd`. 8 тестов.
- **`asi doctor`** — диагностика проекта: конфигурация (package.json, entry, config file), зависимости (asijs, typescript, dev script), TypeScript strict mode + module resolution, security best practices (rate limiting, валидация мутаций, security headers, hard-coded secrets, admin auth). Флаги: `--json`, `--cwd`. 3 теста.
- **`asi upgrade`** — проверка последней версии через npm registry, сравнение semver, обновление specifier в package.json, опциональный codemod для breaking changes (`--codemod`). Флаги: `--dry-run`, `--offline`. 6 тестов.
- **`asi template <name>`** — установка шаблона напрямую в текущую директорию (без VS Code), пропуская существующие файлы.
- **`asi dev --inspect`** — DevTools hint: dashboard `/__dev`, OpenAPI `/__docs`, команды REPL/inspect/analyze/doctor.

#### Performance Optimisations
- **Middleware Loop: Inline Execution (2.2.1)** — `createInlineFlatChain()`: flat middleware chains (без `next()`) теперь компилируются в единую inline async функцию через runtime codegen (`new Function`) — вызовы middleware записаны напрямую, без runtime for-loop и closure-переходов. Fallback на sequential loop при недоступности codegen (CSP). Применяется и в `MiddlewareChainFlattener` (Strategy 1), и в `compileHandler()` compiler.ts.
- **`flattenMiddleware: true` по дефолту** — MiddlewareChainFlattener включён по умолчанию (`@default true`), отключается явным `flattenMiddleware: false`. Скомпилированные цепочки делегируют конвертацию результата в `app.toResponse` (Set-Cookie, auto-escape работают в flattened-пути).
- **Cache invalidation по identity** — кэш скомпилированных цепочек теперь сверяет `handler` + массив middleware по ссылке: повторная регистрация роута с тем же `method:path`, но другим handler'ом, больше не возвращает устаревший результат (collision hash тоже безопасен).
- **Router Hot Path: Inline Static Routing (2.2.2)**:
  - **`router: "radix"` по дефолту** — RadixTreeRouter (compressed trie, sorted array + binary search) стал default-бэкендом; `"trie"` остаётся опцией. Path-based middleware (`use("/api", mw)`) теперь корректно применяется и в radix-пути.
  - **Inline static bypass** — fully-static пути (`/`, `/health`) регистрируются в отдельной `Map<path, Map<method, route>>` и ищутся прямым lookup без parsePath и segment walk (в обоих роутерах: radix и trie).
  - **Pre-parsed path cache** — `PathSegmentsCache` (LRU, 512 по умолчанию): `parsePath()` результат кэшируется по строке пути, общий синглтон `getDefaultPathCache()`/`resetDefaultPathCache()`. Повторяющиеся hot paths не аллоцируют сегменты каждый запрос.
  - **String interning** — `internString()`: имена параметров (`:id`, `:userId`) интернируются — все роуты с одинаковым именем используют один string object.
  - **12 тестов** (path cache, interning, static bypass, radix по дефолту, path middleware + radix, cookies/auto-escape через flattened chain)
- **Context Pool: Zero-Allocation Request Cycle (2.2.3)**:
  - **`ContextPool`** — Recycler pattern: пул из 1000 pre-allocated `Context` объектов, `acquire()`/`release()` с полным сбросом полей + удалением middleware-свойств (нет утечек между запросами), pool growth при исчерпании, автоматический shrink до target size после idle-интервала. `@default true`, отключается `contextPool: false`, настройка через `contextPool: { size, max, shrinkIntervalMs }`.
  - **Интеграция в `handle()`** — lazy acquire из пула + гарантированный `release` в `finally` (все ветки: успех, 404, ошибки). Response-конвертация (Set-Cookie, auto-escape) работает через pooled-путь.
  - **Lazy getters** — `query`, `body()`/`json()`/`formData()`/`arrayBuffer()`, `cookies`, `url` уже ленивые (не инициализируются в конструкторе) — подтверждено и покрыто тестами; `console.log` в `_setQuery()`/`_setBody()` отсутствует.
  - **16 тестов** (pool: acquire/release/reset/growth/shrink/stats, изоляция между запросами, concurrent-безопасность, error path, 404, cookies)
- **Security Headers: Pre-built Response (2.2.4)**:
  - **Pre-built static headers** — `buildSecurityHeaders()` компилирует конфиг в плоский массив пар один раз; `securityHeaders()` применяет их к каждому ответу одним tight-loop (без итерации конфига и пересборки строк заголовков на каждый запрос)
  - **Nonce path detection** — `autoNonce` теперь только для HTML-capable запросов (Accept содержит text/html/*/* или пуст): JSON API не тратит crypto + не мутирует CSP; nonce вставляется в CSP только когда ответ реально `text/html`
  - **HSTS без URL-аллокации** — проверка протокола через `request.url.startsWith("https://")` вместо создания `URL` объекта на каждый запрос
  - **Без no-op hops** — skip-path wrapper не добавляется при пустом `skipPaths`; no-op xssScan middleware не добавляется без кастомных паттернов (сокращает цепочку с 6 до 3-4 middleware)
  - **Результат бенчмарка**: overhead `security: true` 71% → **55%** (33.8k → 53.6k rps), `apiSecurityCore` 68.6% → **54%**
  - **14 новых тестов** (buildSecurityHeaders, применение заголовков, HSTS http/https, nonce path detection, CSP-inject только HTML, цепочка middleware)
- **Complex Validation: Compiled TypeBox (2.2.5)**:
  - **Two-stage compiled validation** — `validateAndCoerce()`: 1) fast path — скомпилированный `TypeCompiler.Check` на сырых данных (когда данные уже соответствуют схеме и defaults нет, Convert+Default полностью пропускаются); 2) slow path — полная коерция (Convert → Default → compiled Check) с идентичной семантикой старой реализации. `validate()` полностью на скомпилированном чекере.
  - **Schema analysis** — `schemaHasDefaults()` (кэш через WeakMap, cycle-safe): определяет, безопасен ли fast path; при наличии defaults `Value.Default` всё равно выполняется.
  - **`lruSchemaCache: true` по дефолту** — LRU-кэш скомпилированных валидаторов включён по умолчанию (`@default true`, max 10000, настраивается числом), `false` возвращает простой Map.
  - **O(1) LRU eviction** — `SchemaCacheLRU` переписан с массива + `indexOf`/`splice` (O(n) на каждый get) на Map с переупорядочиванием через `delete`+`set` — get/evict теперь O(1) даже при тысячах схем.
  - **Результат бенчмарка** (полный request path через `app.handle()`, реалистичная user-схема): валидные body 30k → **51k req/s (+69%)**, coercion-путь без регрессии (~28k); чистый микробенчмарк compiled Check vs interpreted Value.Check — **433×**.
  - **9 новых тестов** (fast path identity/mutation-free, коерция, defaults, ошибки, schemaHasDefaults nested/union/cycle, validate(), lruSchemaCache default-on / false)
- **Query Param Optimisation (2.2.6)**:
  - **QueryParseCache** — bounded LRU кэш разобранных query-строк (default 512, O(1) eviction через Map delete+set): повторяющиеся query-строки (pagination `?page=2&limit=50`, фильтры) не парсятся заново. Возвращается **shallow copy** — мутации `ctx.query` в одном запросе не портят кэш для остальных.
  - **Safe decode** — `safeDecode()`: malformed percent-encoding (`%E0%A4%A`) больше не бросает URIError, а возвращает сырую строку (поведение URLSearchParams). Раньше `decodeURIComponent` в query-парсере бросал исключение на кривой URL.
  - **`queryCache` по дефолту** — включён (`@default true`, `false` отключает, число задаёт max). Inline single-pass парсер без URL объекта уже был (2.5× быстрее URLSearchParams) — подтверждено бенчмарком.
  - **Результат бенчмарка** (query-heavy request path, 10 повторяющихся query-строк): **64k → 76.2k req/s (+19%)**, цель плана +10-15%.
  - **12 новых тестов** (cache hit/miss/evict/clear, shallow-copy изоляция от мутаций, decode, malformed %, ключи без значений, queryCache: false/число, pooled contexts, cached==uncached)
- **Static Files: In-Memory Cache (2.2.7)**:
  - **`preload`** — `staticFiles(root, { preload: true })` загружает matching файлы (glob `**&#47;*.{html,css,js,svg}` по умолчанию; строка/массив — явные паттерны) в память при старте через `Bun.Glob`; файлы больше `cacheMaxFileSize` пропускаются; `allowedExtensions` уважается. Работает независимо от `cacheSmallFiles`.
  - **`cacheTtl`** — TTL кэша в секундах (MemoryCache-совместимая семантика): после истечения файл перечитывается с диска; ловит изменения, невидимые size/mtime.
  - **Memory-first fast path** — найдено профилированием: `Bun.file().exists()` стоит ~150µs на запрос и был главным bottleneck (кэш проверялся ПОСЛЕ fs-операций). Теперь при `preload`/`cacheTtl` запрос отдаётся из памяти вообще **без fs-вызовов** (нулевой stat/read). Без этих опций сохранена прежняя семантика: `cacheSmallFiles` валидирует size/mtime с диска.
  - **Общий путь кэширования** — `cacheFile()` (чтение буфера, bun-ETag, byte-accounting, eviction) используется и preload'ом, и запросами; lazy TTL cleanup.
  - **Результат бенчмарка**: middleware 4.8k → **26.4k req/s (5.5×)**; полный request path 4.3k → **23.2k req/s (5.4×)** (цель плана +20-30%)
  - **8 новых тестов** (preload default-glob/явные паттерны/size cap/allowedExtensions, поведение без опций, path traversal, TTL с same-size+same-mtime изменением, mtime-инвалидация без TTL)

### 2.3 — Database Layer
- **`Database` класс** (`src/db/database.ts`) — zero-dep доступ к БД: SQLite через `bun:sqlite` (built-in, WAL), PostgreSQL через lazy `import("postgres")` с понятной ошибкой установки. `query`/`queryAsync`/`execute`/`executeAsync`/`first`/`exec`/`transaction`/`transactionAsync`/`listTables`/`tableInfo`/`close`.
- **`Migrator`** (`src/db/migrator.ts`) — file-based миграции: `NNN_name.sql` (up-only) и `NNN_name.up.sql` + `NNN_name.down.sql` (reversible). Таблица `__migrations`, `up()` идемпотентный, `down()` (с .down.sql или untrack), `status()`, `create()` — скаффолдинг следующего номера. Двухпроходное чтение корректно ассоциирует .down.sql с .up.sql (readdir порядок).
- **`runSeed` / `findSeedFile`** (`src/db/seed.ts`) — сидирование: `.sql` файлы (multi-statement exec) и `.ts`/`.js` модули (default export `(db) => void`).
- **Db Studio** (`src/db/studio.ts`) — embedded GUI (аналог Prisma Studio): список таблиц, просмотр строк с пагинацией, SQL query runner, HTML-страница в тёмной теме. `studioHandler(db)` для монтирования в Asi-app, `serveDbStudio(db, { port })` — standalone сервер.
- **`AsiConfig.database` + autoMigrate** — `app.db` lazy-геттер: подключение создаётся при первом обращении; `autoMigrate: true` прогоняет pending-миграции (один раз, при первом доступе), `autoSeed` запускает seed-файл. `DatabaseConfig` — комбинированный тип (существующий ORM-конфиг из `src/database.ts` + новые поля migrationsDir/autoMigrate/seedFile/autoSeed).
- **`asi db` CLI** — `db migrate` (apply / `--create "name"` / `--down` / `--status`), `db seed [file]`, `db studio [--port 5500]`. Конфиг: `--url` / `--migrations-dir` флаги → `asi.config.(ts|js)` `database` секция → `DATABASE_URL` env → defaults (`file:./app.db`, `./migrations`).
- **21 тест** (Database: CRUD/transaction/close/file-url/postgres-ошибка; Migrator: up/status/down/create/идемпотентность; Seed: sql/ts/not-found; Asi: app.db lazy + autoMigrate, listen(); Studio: HTML/API tables/table/query/error/server)

#### AI & MCP
- **MCP v2 — AI-Native Protocol** (`asijs-mcp`) — новый выделенный пакет:
  - **Pluggable transports**: `stdio` (основной, для Claude Desktop / Cursor / Zed / Continue.dev), `http` (JSON-RPC over POST), `sse` (streaming: endpoint discovery + notifications)
  - **Protocol v2025-06-18**: prompts (analyze-route, generate-crud, debug-request, security-audit, architecture-review, optimize-routes), sampling (LLM-to-LLM), roots, progress, cursor pagination, streaming content types (image/audio/blob/resource), logging, completion
  - **Deep AsiJS runtime integration**: routes, circuit breakers (OPEN/CLOSED/HALF_OPEN + reset), WebSocket rooms/presence, hot reload, SSG paths, serverless cold-start stats, plugin dependency graph, rate limiter metrics
  - **Dynamic documentation** — `docsDir` сканирует `.md` файлы в `docs://<slug>` ресурсы (вместо hard-coded ASIJS_DOCS)
  - **Auth** — Bearer token + token-bucket rate limiting через AsiJS middleware на HTTP/SSE транспорте
  - **Custom workflows** — декларативные воркфлоу (http/code/delay/log/result steps) + встроенные (`asijs/http-request`, `asijs/chain-requests`, `asijs/app-snapshot`)
  - **67 тестов** (stdio, protocol, pagination, resources, prompts, workflows, asi-bridge)

## [1.3.0] - 2026-07-27

### 🚀 New Features

#### Developer Experience
- **Hot Reload 2.0** — `HotReloader` with `fs.watch`, 200ms debounce, module-level hot swap (handler/middleware → hot reload, routes/config → full reload). `HMRServer` with WebSocket browser push, typed events, exponential backoff reconnect. 23 теста.
- **Interactive REPL** — `asi repl`. Создание роутов на лету, тестирование запросов (`GET /path`, `POST /path {"key":"val"}`), просмотр состояния (`.routes`, `.plugins`, `.state`, `.history`). Sandbox с import-line stripping и parameter shadowing. 32 теста.
- **Web Playground** — `playgroundPlugin()` — полноценная IDE в браузере. Редактор кода, панель Output/Routes, request bar, 5 примеров (Hello World, REST API, JSX SSR, WebSocket Echo, Auth JWT). Rate-limited execution (10 req/min).
- **CLI v2** — `asi repl`, `asi build --ssg`, `asi build --target <platform>`, `asi plugin search/install/create/list`, `asi integrate <file>`

#### AI & MCP
- **MCP Server** остаётся стабильным (HTTP transport, 7 built-in tools, 4 resources). MCP v2 с stdio транспортом запланирован на v1.4.0.

#### Static Site Generation
- **SSG / Static Export** — `buildSSG(app, options)` сканирует GET-маршруты, рендерит через `app.handle()`, сохраняет HTML в dist. Pretty URLs (`/about` → `about/index.html`) + Flat format. JSON export с `--export-api`. CLI: `asi build --ssg`. 11 тестов.

#### WebSocket
- **WebSocket Pub-Sub** — `RoomManager` с комнатами (`ws.join()`, `ws.leave()`, `ws.rooms()`), broadcast с exclude, presence tracking, typed events. `RedisPubSubBridge` для кросс-инстансной коммуникации. 25 тестов.

#### API Versioning
- **API Versioning middleware** — URL/Header/Combined strategies, fallback (latest/stable/default/error), deprecation headers (`Sunset`, `Deprecation`, `Deprecation-Migration`), `versionPath()` helper. 23 теста.

#### Resilience & Performance
- **Circuit Breaker** — `circuitBreaker()` middleware с CLOSED/OPEN/HALF_OPEN, sliding window, timeout, fallback, healthcheck integration. `ctx.circuitBreaker!("name", () => fetch(...))`. Пресеты: apiCircuitBreaker, dbCircuitBreaker, criticalCircuitBreaker. 45 тестов.
- **Request Dedup & Cache Stampede Protection** — `deduplicate()` middleware, `InflightManager`, XFetch Algorithm (`P(refresh) = beta * (age / ttl)`), `xfetchWrap()`, MemoryCache/Redis интеграция. Пресеты: simple/cached/expensiveQuery. 29 тестов.
- **Serverless Cold Start Optimisation** — `ServerlessOptimizer.warmUp()`, lazyImport, bundleConfig для 6 платформ (Cloudflare, Lambda@Edge, Deno Deploy, Vercel Edge, Netlify Edge, Bun). CLI: `asi build --target cloudflare`. 37 тестов.

#### Security
- **Built-in Security Module** — `AsiConfig.security` с autoEscape (XSS), maxBodySize, autoNonce (CSP nonce), strictContentType, OWASP headers. Zero-config sensible defaults. Пресеты: maxSecurity, apiSecurity, devSecurity. 37 тестов.

#### Framework Adapters
- **`@asijs/next`** — 10 тестов. App Router (`createNextHandler` → GET/POST/..., basePath, 404, params), Pages Router (`createPagesHandler`), Edge Runtime (`createEdgeHandler`)
- **`@asijs/astro`** — 7 тестов. Astro server endpoints (`createAstroHandler`), method-specific (`createEndpoint`), Astro middleware
- **`@asijs/remix`** — 8 тестов. Remix resource routes (`createRemixHandler` → loader + action), `createLoader`, `createAction`
- **`@asijs/sveltekit`** — 8 тестов. SvelteKit handle hook (`createSvelteKitHook`), `createServerHandler`, `createUniversalHandler`

### 🧩 Ecosystem

#### Plugin System
- **Plugin Dependency Manager** — граф зависимостей, DFS cycle detection (CyclicDependencyError), Kahn's topological sort, lazy init, hooks (onBeforeInit/onAfterInit/onBeforeRoute), `getGraphInfo()`, `toDot()`. 390 строк.
- **Plugin Registry** — `asi plugin search/install/create/list/remove/awesome`. AWESOME_PLUGINS (40+ curated плагинов, 8 категорий). Scaffold нового плагина. CONTRIBUTING.md + PLUGIN_DEV_GUIDE.md. 18 тестов.

#### Migration
- **Express/Koa Migration** — `expressPlugin.wrap(mw)`, `koaPlugin.wrap(mw)`, `expressPlugin.handler()`, `koaPlugin.handler()`, EXPRESS_CODEMOD_RULES (22 правила), KOA_CODEMOD_RULES (22 правила). CLI: `asi integrate ./app.js`. 30 тестов.

#### OpenTelemetry
- **`@asijs/opentelemetry`** — full OTel instrumentation. `TracerManager` (spans, W3C TraceContext, 5 exporters: Console/OTLP/Jaeger/Zipkin), `MetricsManager`, `LogsManager`, `otelPlugin()`. 22 теста.

#### VS Code Extension v0.2.0
- **Debug Configuration Provider** — 4 конфига (Launch, Launch verbose, Attach, Launch Workspace). Source maps, auto-detection entry file.
- **Template Explorer** — 9 шаблонов в 4 категориях. Поиск, preview файлов, Create Project.
- **Create AsiJS Project Wizard** — 4-шаговый GUI wizard.
- **Inline Diagnostics** — 6 проверок (missing asijs dep, missing app instance, async/await, TODO/FIXME). Code Actions.
- 38 тестов.

#### API Documentation Portal
- **`apiDocsPlugin()`** — полноценный портал документации. Sidebar с поиском, code samples (4 языка: curl/Python/JS/Go), try-it-out proxy с SSRF защитой, светлая/тёмная тема.
- **`ApiChangelog`** — snapshot/diff/toChangelogMarkdown между версиями API.
- **`exportToMarkdown()` / `exportToHTML()`** — CI/CD экспорт.
- 25 тестов.

#### Load Testing Suite
- 4 k6 сценария: auth-flow, CRUD, WebSocket, file-upload.
- Docker orchestration (`docker run k6`).
- `extractMetricsFromOutput()` — parsing p50/p90/p95/p99.
- 28 тестов.

### 📦 New Packages
- `packages/opentelemetry-asijs/` — OpenTelemetry integration
- `packages/next-asijs/` — Next.js adapter
- `packages/astro-asijs/` — Astro adapter
- `packages/remix-asijs/` — Remix adapter
- `packages/sveltekit-asijs/` — SvelteKit adapter

### 🧪 Testing & Quality

- **Integration & E2E Tests** — Docker-based (PostgreSQL 5433, Redis 6380, MinIO 9001/9002). `test/integration/auto-api.test.ts` (19 тестов), `test/e2e/full-cycle.test.ts` (17 тестов: auth→register→login→JWT→CRUD→upload→WS), `test/e2e/redis-queue.test.ts` (7 тестов), `test/e2e/node-adapter.test.ts` (8 тестов). 52 теста total.
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

- **Benchmark Dashboard** — HTML dashboard с Chart.js, bar charts и trend lines. Интегрирован в vitepress docs. GitHub Actions CI pipeline.
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
- GraphQL plugin/adapter
- Edge/serverless export (Cloudflare, Vercel)
- Workspace / Multi-app support
- SPA + Hydration mode
- i18n plugin
