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

## Validation

```typescript
function validate<T>(schema, data): ValidationResult<T>;
function validateAndCoerce<T>(schema, data): ValidationResult<T>;
function createValidator<T>(schema): (data) => ValidationResult<T>;
class ValidationException extends Error { errors: ValidationError[]; }
```

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
```

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
