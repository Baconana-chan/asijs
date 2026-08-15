# API Reference

## Asi Class

```typescript
class Asi {
  constructor(config?: AsiConfig);

  // Route registration
  get(path, handler, options?): this;
  post(path, handler, options?): this;
  put(path, handler, options?): this;
  delete(path, handler, options?): this;
  patch(path, handler, options?): this;
  head(path, handler, options?): this;
  options(path, handler, options?): this;
  all(path, handler, options?): this;
  route(method, path, handler, options?): this;

  // Grouping
  group(prefix, callback): this;
  fromFileRoutes(options?): Promise<this>;

  // Middleware & Hooks
  use(middleware): this;
  use(path, middleware): this;
  onBeforeHandle(handler): this;
  onAfterHandle(handler): this;
  onError(handler): this;
  onNotFound(handler): this;

  // WebSocket
  ws(path, handlers, options?): this;

  // Plugins
  plugin(plugin): Promise<this>;
  hasPlugin(name): boolean;
  state(key): T | undefined;
  setState(key, value): this;
  decorator(key): T | undefined;
  decorate(key, value): this;

  // Compilation & Server
  compile(): this;
  handle(request): Promise<Response>;
  listen(port?, callback?): Server;
  stop(): void;

  // Public inspection API
  getRoutes(): RouteInfo[];
  getPlugins(): string[];
  getMiddlewareInfo(): MiddlewareInfo;
  getAppConfig(): AppConfigInfo;
}

interface RouteInfo {
  method: RouteMethod;
  path: string;
  hasValidation: boolean;
  hasMiddleware: boolean;
}

interface MiddlewareInfo {
  global: number;
  pathBased: number;
}

interface AppConfigInfo {
  port: number;
  hostname: string;
  development: boolean;
}
```

## Context

```typescript
class Context {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  headers: Headers;
  request: Request;
  app: Asi;

  body<T>(): Promise<T>;
  json<T>(): Promise<T>;
  formData(): Promise<FormData>;
  header(name): string | null;
  cookie(name): string | null;

  status(code): this;
  setHeader(name, value): this;
  jsonResponse(data, status?): Response;
  html(html, status?): Response;
  redirect(url, status?): Response;
  setCookie(name, value, options?): void;
}
```

## Query parsing

```typescript
class QueryParseCache { // bounded LRU, O(1) eviction via Map delete+set
  constructor(max?: number);      // default 512
  get(key): Record<string,string> | undefined;
  set(key, value): void;
  has(key): boolean;
  clear(): void;
  size: number;
}

// Shared cache state (enabled by default via Asi `queryCache: true`)
function getDefaultQueryCache(max?): QueryParseCache | null;
function disableDefaultQueryCache(): void;
function resetDefaultQueryCache(): void;
```

Query strings are parsed by an inline single-pass parser (no URL object, no
URLSearchParams). Results are cached per query string and returned as shallow
copies, so mutating `ctx.query` never poisons the cache. Malformed
percent-encoding falls back to the raw string instead of throwing.

## Validation

```typescript
function validate<T>(schema, data): ValidationResult<T>;
function validateAndCoerce<T>(schema, data): ValidationResult<T>;
function schemaHasDefaults(schema): boolean; // cached schema analysis (WeakMap)
function createValidator<T>(schema): (data) => ValidationResult<T>;
class ValidationException extends Error { errors: ValidationError[]; }
```

Validation uses compiled TypeBox validators (TypeCompiler) by default —
`validateAndCoerce()` runs a compiled `Check` fast path (skips Convert/Default
when data already conforms and the schema has no defaults) and falls back to
full coercion only when needed. Compiled validators are cached in an LRU cache
(`lruSchemaCache: true` by default, max 10000, O(1) eviction).

## Database Layer

```typescript
class Database { // bun:sqlite default, postgres via lazy import
  constructor(config?: DatabaseConfig);
  query<T>(sql, params?): T[];
  queryAsync<T>(sql, params?): Promise<T[]>;
  execute(sql, params?): number;
  executeAsync(sql, params?): Promise<unknown>;
  first<T>(sql, params?): T | undefined;
  exec(sql): void;
  transaction<T>(fn: () => T): T;
  transactionAsync<T>(fn): Promise<T>;
  listTables(): string[];
  tableInfo(table): { name, type, notnull, pk }[];
  close(): void;
  type: "sqlite" | "postgres";
  url: string;
  raw: any;
}

interface DatabaseConfig {
  url?: string;              // file:./app.db | postgres://...
  type?: "sqlite" | "postgres" | "mysql" | "mssql";
  migrationsDir?: string;    // default ./migrations
  autoMigrate?: boolean;     // run pending on first app.db
  seedFile?: string;
  autoSeed?: boolean;
}

class Migrator {
  constructor(db, { dir }?);
  up(): { applied: string[]; skipped: number };
  down(): { name, rolledBack } | null;
  status(): { name, applied, appliedAt? }[];
  create(name): string;      // scaffold NNN_name.sql
}

function migrate(db, dir?): { applied, skipped };
function runSeed(db, file): Promise<SeedResult>;
function findSeedFile(cwd?): string | null;
function serveDbStudio(db, { port?, silent? }?): server;
function studioHandler(db): (req) => Promise<Response>;
```

`AsiConfig.database` wires it into the app — `app.db` (lazy) + `autoMigrate`.

## Rate Limit

```typescript
function rateLimit(options): AsiPlugin;
function rateLimitMiddleware(options): BeforeHandler;
class MemoryStore implements RateLimitStore;
class TokenBucketStore implements RateLimitStore;
class TenantStore implements RateLimitStore;
```

## Security

```typescript
function security(options?): AsiPlugin;
function securityHeaders(options?): Middleware;
function generateNonce(): string;
function nonceMiddleware(): Middleware;
```

## Cache

```typescript
function etag(options?): Middleware;
function cache(options?): AfterHandler;
function cachePlugin(options?): AsiPlugin;
class MemoryCache<T>;

// Static files (plugins/static)
function staticFiles(root, options?): Middleware;
interface StaticOptions {
  prefix?: string;                 // URL prefix, default ""
  index?: string;                  // directory index file, default "index.html"
  maxAge?: number;                 // Cache-Control max-age, default 0
  etag?: boolean;                  // default true
  etagStrategy?: "mtime" | "bun";  // default "mtime"
  listing?: boolean;               // directory listing, default false
  allowedExtensions?: string[];    // extension filter
  cacheSmallFiles?: boolean;       // cache files <= cacheMaxFileSize
  cacheMaxFileSize?: number;       // default 128KB
  cacheMaxEntries?: number;        // default 512
  cacheMaxBytes?: number;          // default 16MB
  preload?: boolean | string | string[]; // memory-first serving (Bun.Glob)
  cacheTtl?: number;               // TTL seconds (MemoryCache semantics)
}
```

With `preload` or `cacheTtl`, cached files are served from memory with zero
fs calls (up to 5.4x faster on the request path).

## Trace

```typescript
function trace(options?): AsiPlugin;
function traceMiddleware(options?): Middleware;
class MetricsCollector;
class Timing;
```

## Scheduler

```typescript
function scheduler(options?): AsiPlugin;
class Scheduler;
function parseCron(expr): ParsedCron;
function matchesCron(date, cron): boolean;
function getNextRun(cron, from?): Date;
```

## RPC 2.0

```typescript
function serverAction<TInput, TOutput>(schema, handler): RPCServerAction;
function rpc<T>(app, actions, options?): RPCClient<T>;
function createRPCClient<T>(baseUrl, options?): T;
class RPCActionError extends Error;
```

## Workspace

```typescript
function scanWorkspace(options?): SubApp[];
function startWorkspaceDev(apps, options?): Promise<WorkspaceDevController>;
function asiDev(options?): Promise<WorkspaceDevController>;
class WorkspaceDevController;

// Workspace V2 — production multi-app server
class Workspace {
  app(name, config, setup): this;
  appWith(config): this;
  listen(port?, callback?): any;
  async stop(): Promise<void>;
}
function createWorkspace(options?): Workspace;

// Shared state bus
class EventBus {
  on<T>(topic, handler): () => void;
  once<T>(topic, handler): () => void;
  off<T>(topic, handler): void;
  emit<T>(topic, payload): void;
  emitAsync<T>(topic, payload): Promise<void>;
  stats(): EventBusStats;
}
function createRedisEventBus(options): Promise<EventBus>;
```

## Analyze

```typescript
async function analyzeProject(options?): Promise<AnalysisReport>;
function analyzeSource(source, options?): AnalysisReport;
function findSourceFiles(cwd, extensions?): string[];
function parseRoutesFromSource(source, file): ParsedRoute[];
```

## Doctor

```typescript
async function runDoctor(options?): Promise<DoctorReport>;
```

## Upgrade

```typescript
async function checkForUpdates(cwd, options?): Promise<UpdateCheck>;
async function upgradeProject(options?): Promise<UpgradeResult>;
async function fetchLatestVersion(packageName?, registry?): Promise<string | null>;
function compareVersions(a, b): number;
function parseVersion(v): { major, minor, patch };
function versionFromRange(specifier): string | null;
```

## Async Error Boundary

```typescript
class HttpError extends Error { status; code?; details?; retryable?; }
class BusinessError extends HttpError;
class NotFoundError extends BusinessError;
class UnauthorizedError extends BusinessError;
class ForbiddenError extends BusinessError;
class ConflictError extends BusinessError;
class SystemError extends HttpError;
class FatalError extends Error { crash; code?; }

function classifyError(error): ClassifiedError;
function toErrorResponse(ctx, error): Response;
function errorBoundary(options?): AsiPlugin;
function retry<T>(fn, options?): Promise<T>;
function computeBackoff(attempt, options): number;
function defaultShouldRetry(error): boolean;
function tryCatch<T>(fn): { ok: true, value } | { ok: false, error };

// ctx (with errorBoundary() plugin):
// ctx.errorBoundary<T>(fn, { fallback? | onError? | rethrow? }): Promise<T>
```

## Observability

```typescript
// OTel Logs Bridge
class OTLPLogsExporter { record(entry); flush(); start(); stop(); }
function entryToOTLPLogRecord(entry, serviceName?, instanceId?): OTLPLogRecord;
function otelLogs(options): AsiPlugin;
function createOTelLogger(options): { logger, exporter };
function levelToSeverityNumber(level): number;

// Distributed tracing (Redis)
class RedisTraceBridge { connect(); disconnect(); emit(span); onSpan(handler); }
function createRedisTraceBridge(options): Promise<RedisTraceBridge>;
function newTraceId(): string;   // 32 hex
function newSpanId(): string;    // 16 hex

// Healthcheck dashboard
function healthDashboard(options): Middleware;
function buildHealthSnapshot(options): Promise<HealthDashboardSnapshot>;
function renderHealthDashboardHTML(snapshot, refreshSeconds): string;

// Grafana export
function createGrafanaDashboard(options?): Record<string, unknown>;
```

## Misc

```typescript
// Testing
function mockContext(options?): Context;
function testClient(app): TestClient;
function assertStatus, assertOk, assertHeader, assertJson, ...;

// JSX
function jsx(type, props, ...children): JSXElement;
function renderToString(element): Promise<string>;
function renderToStream(element): ReadableStream;

// Lifecycle
function lifecycle(options?): AsiPlugin;
function healthCheck(options?): AsiPlugin;
class LifecycleManager;
```
