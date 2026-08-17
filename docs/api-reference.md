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

## Response Serialization

```typescript
function compileSerializer(schema: TSchema): (value: unknown) => string;
function compileResponseSerializer(response: ResponseSchema):
  (value: unknown, status: number) => string | null;
function wrapWithResponseSerializer(handler, options): Handler;
function resetSerializerCache(): void;

function serializeForCache(value: unknown): Uint8Array;   // V8.serialize
function deserializeFromCache(bytes: Uint8Array): unknown;

type ResponseSchema = TSchema | Record<string | number, TSchema>;
interface ResponseSerializeOptions {
  response?: ResponseSchema;                 // { 200, "2xx", default }
  serializers?: Record<string, TSchema | Serializer>; // per content-type
}
```

Pre-compiles a TypeBox / JSON Schema into a fast hand-rolled serialization
function (like fast-json-stringify): field access is inlined, skipping
`JSON.stringify`'s generic walk. Anything the codegen can't prove safe falls
back to `JSON.stringify`.

**Route integration** — declare a response schema and AsiJS serializes objects
through the compiled path (both compiled and non-compiled routes):

```typescript
app.get("/users/:id", (ctx) => fetchUser(ctx.params.id), {
  schema: {
    response: Type.Object({           // single schema for all statuses
      id: Type.String(),
      name: Type.String(),
    }),
  },
});

app.post("/users", (ctx) => { /* ... */ return ctx.status(201).jsonResponse(user); }, {
  schema: {
    response: {                        // status-keyed: 200 / 2xx / default
      "2xx": Type.Object({ id: Type.String() }),
      "4xx": Type.Object({ error: Type.String() }),
    },
  },
});

// Per-content-type serializers — picked via the Accept header
app.get("/api", handler, {
  serializers: {
    "application/vnd.api+json": Type.Object({ data: Type.Array(Type.Any()) }),
  },
});
```

- Status-keyed maps match exact codes, then `Nxx` patterns, then `default`.
- Object results are pre-serialized into a `Response`; `ctx.status(...)` and
  `ctx.setCookie(...)` are preserved (toResponseFast skips re-serialization).
- Non-object results (strings, `Response`, streams) pass through untouched.
- `serializeForCache`/`deserializeFromCache` are **binary** V8.serialize
  helpers for internal caches — not for HTTP JSON.

## Data Formats (JSON / YAML / custom)

```typescript
interface DataFormat {
  name: string;
  contentTypes: string[];   // e.g. ["application/yaml", "text/yaml"]
  extensions: string[];     // e.g. [".yaml", ".yml"]
  contentType: string;      // default MIME for responses
  parse(text: string): unknown;
  serialize(value: unknown): string;
}

function registerFormat(fmt: DataFormat): void;
function getFormat(nameOrContentType: string): DataFormat | undefined;
function listFormats(): DataFormat[];
function registerYamlFormat(): DataFormat;
function resetFormats(): void; // tests

// Asi API
app.setFormat("yaml" | DataFormat): this;
app.getFormat(): DataFormat;

// Context API
await ctx.parseBody<T>(format?: string): Promise<T>;
```

JSON is registered natively (zero deps). YAML is a lazy adapter over the
`yaml` package (`bun add yaml`) — loaded on first use, no import cost until
you use it. Register custom formats for TOML, INI, or anything else.

```typescript
import { Asi, registerYamlFormat } from "asijs";

registerYamlFormat();                        // enable YAML (also in negotiation)
const app = new Asi({ format: "yaml" });     // default format = YAML

app.post("/config", async (ctx) => {
  const body = await ctx.parseBody();        // parses by Content-Type header
  return body;                               // serialized to YAML by default
});
```

- **Default format**: object responses, errors (500/400) and 404 bodies are
  serialized in `setFormat()`'s format unless the `Accept` header asks for a
  registered alternative. Strings/`Response`/`Blob`/null pass through
  untouched.
- **Accept negotiation**: with more than one format registered,
  `Accept: application/yaml` returns YAML even when the default is JSON
  (`bestMatch` from content negotiation).
- **Request parsing**: `ctx.parseBody()` reads the `Content-Type` header;
  pass a format name to force one. Unknown/absent Content-Type → JSON.
- Compiled routes (`app.compile()`) and static-response precompute honor the
  default format too.

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

## Plugins (createPlugin)

```typescript
// Plugin factory
function createPlugin(config: AsiPluginConfig): AsiPlugin;

interface AsiPluginConfig<TDecorate, TState> {
  name: string;
  setup?: (app: PluginHost) => void | Promise<void>;
  decorate?: TDecorate;                // becomes ctx.<key> on every request
  state?: TState;                      // shared state, exposed as ctx.state.<key>
  dependencies?: string[];             // plugin names that must be registered first
  onStart?: (app) => void | Promise<void>;
  onStop?: (app) => void | Promise<void>;
}

// Registration
app.plugin(plugin);                    // register a plugin
app.use(plugin);                       // alias

// Plugin registry
function createPluginRegistry(): PluginRegistry;
function getPluginRegistry(): PluginRegistry;
function resetPluginRegistry(): void;
```

## OpenAPI

```typescript
// Plugin
function openapi(options: OpenAPIOptions): AsiPlugin;

interface OpenAPIOptions {
  path?: string;                       // default: "/openapi" (JSON spec)
  uiPath?: string;                     // default: "/docs" (Swagger UI)
  title?: string;
  version?: string;
  description?: string;
  servers?: string[];
  securitySchemes?: Record<string, unknown>;
}

// Routes get documented automatically from validation schemas,
// route options (tags, summary, deprecated, hidden) and JSDoc.

// Utils
function collectRoutes(app): OpenAPIRoute[];
function generateSpec(app, options?): OpenAPISpec;
function specToJSON(spec): string;

// SDK / client generation
function generateTypeScriptClient(spec, options?): string;

// Docs exports (see also api-docs module)
function exportToMarkdown(spec): string;
function exportToHTML(spec, options?): string;
function generatePortalHTML(spec, options?): string;
```

## MCP (Model Context Protocol)

```typescript
// Plugin — exposes AsiJS routes as MCP tools
function mcp(options: MCPServerOptions): AsiPlugin;

interface MCPServerOptions {
  path?: string;                       // SSE endpoint, default: "/mcp"
  name?: string;                       // server name
  version?: string;
  tools?: McpTool[];                   // extra tools beyond auto-discovered routes
  auth?: (ctx) => boolean | Promise<boolean>;
}

// Low-level server
function createMCPServer(options: MCPServerOptions): MCPServer;
```

## Circuit Breaker

```typescript
// Middleware — adds ctx.circuitBreaker(name, fn)
function circuitBreaker(options: CircuitBreakerOptions): Middleware;

// Presets
function apiCircuitBreaker(name, overrides?): Middleware;
function dbCircuitBreaker(name, overrides?): Middleware;
function criticalCircuitBreaker(name, overrides?): Middleware;

interface CircuitBreakerOptions {
  name: string;
  threshold?: number;                  // failures to trip, default: 5
  windowMs?: number;                   // sliding window, default: 60000
  recoveryTimeout?: number;            // time in OPEN before HALF_OPEN, default: 30000
  timeout?: number;                    // per-call timeout ms
  fallback?: <T>(name: string) => T | Promise<T>;
  shouldTrip?: (error: Error) => boolean;
  onStateChange?: (state, metrics) => void;
}

// Usage in handler
ctx.circuitBreaker("payments-api", async () => { /* ... */ });

// Global registry
function getCircuitBreakerRegistry(): CircuitBreakerRegistry;
function resetCircuitBreakerRegistry(): void;
class CircuitBreakerRegistry;
class CircuitBreakerError extends Error;   // { breakerName, circuitState }
```

## Serverless

```typescript
// Singleton optimizer
const serverless = new ServerlessOptimizer();

class ServerlessOptimizer {
  bundleConfig(target, entry, overrides?): ServerlessBundleConfig;
  buildCommand(targetOrConfig, entry?): string;
  warmUp(app): void;                    // precompile routes outside request path
}

type ServerlessTarget = "cloudflare" | "lambda-edge" | "deno-deploy" | "vercel-edge" | "netlify-edge" | "bun";

// Lazy dynamic import helper
function lazyImport<T>(factory: () => Promise<T>): { get(): Promise<T>; loaded(): boolean };
```

## Session

```typescript
// Plugin — adds ctx.session to every request
function sessions(options: SessionOptions): AsiPlugin;

interface SessionOptions {
  secret: string;                      // cookie signing (required for CookieStore)
  name?: string;                       // cookie name, default: "session"
  ttl?: number;                        // seconds, default: 86400
  store?: SessionStore;                // custom store, default: memory
  cookie?: CookieOptions;
  generateId?: () => string;
  onCreated?: (session) => void;
}

interface SessionStore {
  get(sid: string): Promise<Record<string, unknown> | null>;
  set(sid: string, data: Record<string, unknown>, ttl: number): Promise<void>;
  delete(sid: string): Promise<void>;
}

// Usage in handler
ctx.session.userId = 42;
await ctx.session.save();
ctx.session.destroy();
```

## Upload

```typescript
// Plugin — multipart parsing + storage
function upload(options: UploadOptions): AsiPlugin;

interface UploadOptions {
  storage: "local" | "s3" | "r2";
  dir?: string;                        // local base directory
  maxSize?: number;                    // bytes
  allowedMimeTypes?: string[];
  filename?: (file) => string;         // custom filename generator
  onUpload?: (file, ctx) => void | Promise<void>;
}

// Usage in handler
const file = await ctx.file();         // single file
const files = await ctx.files();       // multiple files

// Storage adapters
const uploadStorage = {
  local: localStorage,
  s3: s3Storage,
  r2: r2Storage,
};
```

## Migrate Express

```typescript
// Wrap Express middleware and handlers for use in AsiJS
const expressPlugin = {
  wrap(handler): Middleware;            // (req, res, next) => AsiJS middleware
  chain(...middleware): Middleware;     // run Express middleware before handler
  handler(handler): Handler;            // (req, res) => AsiJS handler
  errorHandler(handler): ErrorHandler; // (err, req, res, next) => AsiJS onError
};

// Types
interface ExpressReq;                    // minimal Express req shape
interface ExpressRes;                    // minimal Express res shape
```

## Node Adapter (asijs/node)

```typescript
// Import from "asijs/node"
function nodeAdapter(options?): ServerAdapter;

interface NodeAdapterOptions {
  tls?: {
    key: string | Buffer;
    cert: string | Buffer;
    ca?: string | Buffer;
  };
  maxBodySize?: number;
}

interface ServerAdapter {
  name: "node";
  serve(app): Promise<Server>;
  // ...
}

// Utils (preload HTTP/WS modules, non-blocking)
function ensureHttp(): void;
function isHttpReady(): boolean;
```

## Event Bus

```typescript
// In-memory pub/sub event bus
class EventBus {
  constructor(options?: EventBusOptions);

  name: string;
  on<T>(topic: string, handler: EventHandler<T>): () => void;   // returns unsubscribe
  once<T>(topic: string, handler: EventHandler<T>): () => void;
  off<T>(topic: string, handler: EventHandler<T>): void;
  emit<T>(topic: string, payload: T): void;
  clear(): void;
  stats(): EventBusStats;                 // { topics, handlers, emitted }
  has(topic: string): boolean;
}

interface EventBusOptions {
  name?: string;
  maxHandlersPerTopic?: number;            // default: 1000 (guards handler leaks)
}

// Redis bridge — distribute events across processes
class RedisEventBusBridge {
  constructor(options: RedisEventBusOptions, ioredis);
  isConnected(): boolean;
  onRemote(topic, handler): void;
}

// Usage
const bus = new EventBus();
const off = bus.on("user.created", (user) => { /* ... */ });
bus.emit("user.created", { id: 42 });
off();                                    // unsubscribe
```

## Structured Logger

```typescript
// JSON-lines logger with request lifecycle integration
function createStructuredLogger(options?: StructuredLoggerOptions): StructuredLogger;
function structuredLogger(options?: StructuredLoggerOptions): AsiPlugin;  // adds ctx.log

// Ready-made instances
const apiLogger: StructuredLogger;
const webLogger: StructuredLogger;
const workerLogger: StructuredLogger;

interface StructuredLoggerOptions {
  service?: string;                        // default: "asijs-app"
  environment?: string;
  version?: string;
  exclude?: string[];                      // paths to skip, default: ["/health", "/ready", "/live", "/metrics"]
  filter?: (info: StructuredLogEntry) => boolean;
}

type LogLevel = "debug" | "info" | "warn" | "error";

// Usage
ctx.log.info("user.created", { userId: 42 });
ctx.log.error("payment.failed", { amount: 10, provider: "stripe" });
```

## Type Safety

```typescript
// Runtime response validation — catches schema drift in production
function createResponseValidator(options?: ResponseValidationOptions);
function getResponseValidator();
function resetResponseValidator(): void;

interface ResponseValidationOptions {
  enabled?: boolean;
  validate?: (schema, data, path) => void;  // custom checker
}

// Typed i18n — translation keys inferred from your dictionary
function createTypedTranslator<T extends Record<string, unknown>>(dictionary: T);

type TranslationKeys<T, Prefix = "">;      // dot-path key union

// OpenAPI 3.1 document types (for custom spec builders)
interface OpenAPI31Document;
interface OpenAPI31Operation;
interface OpenAPI31Parameter;
interface OpenAPI31RequestBody;
```

## Web Infrastructure

```typescript
// Webhook signature verification (Stripe, GitHub, Svix + custom)
function webhooks(options: WebhookOptions): Middleware;
const webhookProviders: Record<string, WebhookProvider>;   // stripe, github, svix, …

interface WebhookOptions {
  secret: string | Record<string, string>;  // provider → secret mapping
  provider?: WebhookProvider;
  path?: string;                            // default: "/webhook/:provider"
  allowedEvents?: string[];                 // e.g. ["checkout.session.completed"]
  handler?: (event, payload, ctx) => Response | Promise<Response>;
}

// HTTP Range requests (video/audio streaming, resumable downloads)
function rangeRequests(options?: RangeRequestOptions): Middleware;

// Trust X-Forwarded-For / X-Forwarded-Proto
function trustProxy(options?: TrustProxyOptions): Middleware;

// Route by Host header (multi-tenant domains)
function domainRouting(routes: DomainRoute[]): Middleware;
function domainRoute(hostname, app): DomainRoute;
```

## Workspace v2 (createWorkspace)

```typescript
// Multi-app production workspace: sub-apps, shared bus, dashboard, OpenAPI
function createWorkspace(options?: WorkspaceOptions): Workspace;
class Workspace {
  app(name: string, config: AsiConfig, setup: (app: Asi) => void): this;
  appWith(config: WorkspaceAppConfig): this;   // full config: prefix, hostname, proxy…
  listen(port?: number, callback?): Promise<unknown>;
  getCollector(name: string): WorkspaceMetricsCollector | undefined;
  getApps(): RegisteredApp[];
  getBus(): EventBus | undefined;
  getBusStats(): EventBusStats | null;
}

interface WorkspaceOptions {
  port?: number;
  hostname?: string;
  dashboard?: boolean;                       // dashboard UI
  dashboardPath?: string;
  openapi?: boolean;                         // aggregated OpenAPI
  openapiPath?: string;
  metrics?: boolean;                         // default: true
  metricsPath?: string;                      // default: "/__asi/metrics"
  bus?: EventBus;                            // shared state bus
  shutdownTimeoutMs?: number;                // default: 10_000
  onError?: (error, request) => Response | Promise<Response>;
  verbose?: boolean;
}
```

## SPA Client (asijs/spa-client)

```typescript
// Client-side hydration for server-rendered islands
function hydrate(
  mountFn: (props: Record<string, unknown>, root: HTMLElement) => void,
  defaultProps?: Record<string, unknown>,
): void;

function hydrateIslands(): void;             // hydrate all [data-island] roots
function connectHMR(port: number): WebSocket; // dev hot-reload client
function getPageProps<T = Record<string, unknown>>(): T | null;
```

## Redis Trace Bridge

```typescript
// Distributed tracing — W3C TraceContext propagation through Redis
class RedisTraceBridge {
  constructor(options: RedisTraceBridgeOptions, ioredis);
  isConnected(): boolean;
  onSpan(handler: SpanEventHandler): void;
  propagateTraceContext(ctx: TraceContext | null): TraceContext;
}

function newTraceId(): string;               // 32 hex chars
function newSpanId(): string;                // 16 hex chars
```
