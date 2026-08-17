# AsiJS Documentation

Complete API reference and guide for the AsiJS web framework.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Core Concepts](#core-concepts)
3. [Routing](#routing)
4. [Context](#context)
5. [Validation](#validation)
6. [Middleware](#middleware)
7. [Plugins](#plugins)
8. [Authentication](#authentication)
9. [OpenAPI](#openapi)
10. [WebSocket](#websocket)
11. [JSX Rendering](#jsx-rendering)
12. [Rate Limiting](#rate-limiting)
13. [Security](#security)
14. [Caching](#caching)
15. [Tracing](#tracing)
16. [Scheduler](#scheduler)
17. [Lifecycle](#lifecycle)
18. [MCP Server](#mcp-server)
19. [Server Actions](#server-actions)
20. [RPC 2.0 — Type-Safe Remote Calls](#rpc-20-type-safe-remote-calls)
21. [Workspace Development](#workspace-development)
22. [Development Mode](#development-mode)
23. [API Reference](#api-reference)

---

## Getting Started

### Quick Start with CLI

The fastest way to create a new AsiJS project:

```bash
# Create a new project
bunx asijs create my-app

# Or with a specific template
bunx asijs create my-api --template api
bun create asijs my-app -t fullstack
```

#### Available Templates

| Template | Description |
|----------|-------------|
| `minimal` | Minimal setup with basic routing (default) |
| `api` | REST API with validation, CORS, and OpenAPI |
| `fullstack` | API + JSX server-side rendering |
| `auth` | Authentication with JWT and protected routes |
| `realtime` | WebSocket chat application |
| `workspace` | Monorepo with multiple sub-apps and independent hot-reload |

```bash
# Examples
bunx asijs create my-api -t api
bunx asijs create my-blog -t fullstack
bunx asijs create my-chat -t realtime
```

### Manual Installation

```bash
bun add asijs
```

### Basic Application

```typescript
import { Asi } from "asijs";

const app = new Asi();

app.get("/", () => "Hello, World!");

app.listen(3000);
```

### Configuration Options

```typescript
const app = new Asi({
  // Enable development mode
  development: true,

  // Decode query parameters (decodeURIComponent)
  // Default: false for max performance
  decodeQuery: false,

  // Cache parsed query strings (QueryParseCache, LRU 512, O(1) eviction)
  // Repeated query strings are not re-parsed; the result is returned
  // as a shallow copy (ctx.query mutations don't poison the cache).
  // Default: true | false disables | number sets max
  queryCache: true,
});
```

---

## Core Concepts

### The Asi Class

`Asi` is the main class that represents your application.

```typescript
import { Asi } from "asijs";

const app = new Asi();
```

### Request-Response Cycle

1. Request received by Bun.serve()
2. Global middleware (before) executed
3. Route middleware executed
4. Handler executed
5. Response returned
6. Global middleware (after) executed

### Performance Notes

- In compiled mode, static routes without middleware/validation may precompute responses for faster GETs.
- Middleware without `next` can be flattened in compiled mode to reduce overhead.
- Query parsing skips `decodeURIComponent` by default; enable `decodeQuery` if you need decoded values.
- Parsed query strings are cached (LRU 512) — repeated `?page=2&limit=50`-style URLs skip re-parsing (+19% on query-heavy workloads). Malformed percent-encoding never throws.

---

## Routing

### HTTP Methods

```typescript
app.get("/path", handler);
app.post("/path", handler);
app.put("/path", handler);
app.patch("/path", handler);
app.delete("/path", handler);
app.head("/path", handler);
app.options("/path", handler);
app.all("/path", handler); // All methods
```

### Route Parameters

```typescript
app.get("/users/:id", (ctx) => {
  return { userId: ctx.params.id };
});

// Multiple parameters
app.get("/users/:userId/posts/:postId", (ctx) => {
  const { userId, postId } = ctx.params;
  return { userId, postId };
});
```

### Wildcards

```typescript
// Match all paths starting with /files/
app.get("/files/*", (ctx) => {
  const path = ctx.params["*"];
  return { path };
});
```

### Route Groups

```typescript
app.group("/api", (api) => {
  api.get("/users", listUsers);
  api.post("/users", createUser);
  
  api.group("/v2", (v2) => {
    v2.get("/users", listUsersV2);
  });
});
```

### Route Options

```typescript
app.get("/users", handler, {
  // Validation schemas
  params: Type.Object({ id: Type.String() }),
  query: Type.Object({ page: Type.Number() }),
  body: Type.Object({ name: Type.String() }),
  response: Type.Array(UserSchema),
  
  // OpenAPI metadata
  summary: "List users",
  description: "Returns all users",
  tags: ["users"],
  deprecated: false,
  operationId: "listUsers",
});
```

---

## Context

The `Context` object provides access to request data and response methods.

### Request Data

```typescript
app.get("/example", async (ctx) => {
  // URL and path
  ctx.url;           // Full URL
  ctx.path;          // Path only
  ctx.method;        // HTTP method
  
  // Parameters
  ctx.params;        // Route params { id: "123" }
  ctx.query;         // Query params { page: "1" } (no decode by default)
  
  // Headers
  ctx.headers;       // Headers object
  ctx.header("X-Custom"); // Get single header
  
  // Body
  const json = await ctx.body<T>();
  const text = await ctx.text();
  const form = await ctx.formData();
  const raw = await ctx.raw();  // ArrayBuffer
  
  // Request object
  ctx.request;       // Raw Request
});
```

### Response Methods

```typescript
app.get("/example", (ctx) => {
  // Status code
  return ctx.status(201).jsonResponse({ created: true });
  
  // JSON response
  return ctx.jsonResponse({ data: "value" });
  
  // Text response
  return ctx.text("Hello");
  
  // HTML response
  return ctx.html("<h1>Hello</h1>");
  
  // Redirect
  return ctx.redirect("/other");
  return ctx.redirect("/other", 301); // Permanent
  
  // Set headers
  ctx.setHeader("X-Custom", "value");
  
  // Set cookies
  ctx.setCookie("name", "value", {
    httpOnly: true,
    secure: true,
    maxAge: 3600,
    path: "/",
    sameSite: "strict",
  });
  
  // Get cookies
  const cookie = ctx.getCookie("name");
  
  // Delete cookies
  ctx.deleteCookie("name");
});
```

### Typed Context

```typescript
import { TypedContext } from "asijs";

type Env = {
  user: { id: number; name: string };
  requestId: string;
};

app.get("/profile", (ctx: TypedContext<Env>) => {
  return ctx.user;  // Typed!
});
```

---

## Validation

AsiJS uses TypeBox for validation.

### Basic Validation

```typescript
import { Type } from "asijs";

app.post("/users", async (ctx) => {
  const body = await ctx.body();
  return { user: body };
}, {
  body: Type.Object({
    name: Type.String({ minLength: 1, maxLength: 100 }),
    email: Type.String({ format: "email" }),
    age: Type.Optional(Type.Number({ minimum: 0 })),
  }),
});
```

### TypeBox Types

```typescript
Type.String()           // string
Type.Number()           // number
Type.Boolean()          // boolean
Type.Integer()          // integer
Type.Array(T)           // T[]
Type.Object({})         // object
Type.Optional(T)        // T | undefined
Type.Union([A, B])      // A | B
Type.Literal("value")   // exact value
Type.Enum(MyEnum)       // enum
Type.Null()             // null
Type.Any()              // any
Type.Unknown()          // unknown
```

### String Formats

```typescript
Type.String({ format: "email" })
Type.String({ format: "uri" })
Type.String({ format: "uuid" })
Type.String({ format: "date" })
Type.String({ format: "date-time" })
Type.String({ format: "ipv4" })
Type.String({ format: "ipv6" })
Type.String({ pattern: "^[a-z]+$" })
```

### Validation Functions

```typescript
import { validate, createValidator, ValidationException } from "asijs";

// One-time validation
const result = validate(schema, data);
if (!result.valid) {
  console.log(result.errors);
}

// Compiled validator (faster)
const validator = createValidator(schema);
const isValid = validator(data);

// Throw on invalid
try {
  validateAndCoerce(schema, data);
} catch (e) {
  if (e instanceof ValidationException) {
    console.log(e.errors);
  }
}
```

### Compiled Validation (2.2.5)

Validation uses **compiled validators** by default
(`TypeCompiler`), which generate flat JS code instead of interpreting
the schema — up to **400× faster** than the interpreted `Value.Check`.

`validateAndCoerce()` is two-stage:

1. **Fast path** — a compiled `Check` on raw data. If the data already
   matches the schema and the schema has no `default` values, `Convert` +
   `Default` are skipped entirely (the data is returned as-is, without
   copying).
2. **Slow path** — full coercion (`Convert` → `Default` → compiled
   `Check`) with semantics identical to the previous implementation —
   called only when the data doesn't match the schema or `default` values
   need to be materialized.

```typescript
import { validate, validateAndCoerce, schemaHasDefaults } from "asijs";

// Fast path: typed JSON bodies are validated without Convert+Default
const result = validateAndCoerce(schema, data);

// schemaHasDefaults — schema analysis for defaults (cached via WeakMap)
if (schemaHasDefaults(schema)) {
  // default materialization required
}
```

Compiled validators are cached in an **LRU cache** (enabled by default,
`lruSchemaCache: true`, max 10000; O(1) eviction):

```typescript
const app = new Asi({ lruSchemaCache: true });   // default
const app = new Asi({ lruSchemaCache: 5000 });   // custom max
const app = new Asi({ lruSchemaCache: false });  // simple Map
```

---

## Middleware

### Route Middleware

```typescript
const logMiddleware = async (ctx, next) => {
  console.log("Before:", ctx.method, ctx.path);
  const response = await next();
  console.log("After:", response.status);
  return response;
};

app.get("/", logMiddleware, handler);
```

### Multiple Middleware

```typescript
app.get("/", 
  authMiddleware, 
  logMiddleware, 
  rateLimitMiddleware, 
  handler
);
```

### Global Middleware

```typescript
// Before all requests
app.before(async (ctx) => {
  ctx.requestId = crypto.randomUUID();
});

// After all requests
app.after(async (ctx, response) => {
  response.headers.set("X-Request-ID", ctx.requestId);
  return response;
});
```

### Error Handling

```typescript
app.onError((error, ctx) => {
  console.error(error);
  return ctx.status(500).jsonResponse({
    error: "Internal Server Error",
  });
});

app.onNotFound((ctx) => {
  return ctx.status(404).jsonResponse({
    error: "Not Found",
    path: ctx.path,
  });
});

// Browser requests can also auto-render HTML 404/500 pages.
// AsiJS will look for files like:
//   src/pages/404.tsx
//   src/pages/not-found.tsx
//   src/pages/error.tsx
//   src/pages/500.tsx
//
// You can configure discovery with:
const web = new Asi({
  errorPages: {
    rootDir: process.cwd(),
  },
});
```

---

## Plugins

### Using Plugins

```typescript
import { Asi, cors, security, openapi } from "asijs";

const app = new Asi();

app.plugin(cors());
app.plugin(security());
app.plugin(openapi({ info: { title: "API", version: "1.0.0" } }));
```

### Creating Plugins

```typescript
import { createPlugin } from "asijs";

const myPlugin = createPlugin({
  name: "my-plugin",
  version: "1.0.0",
  
  setup(app, options) {
    // Add routes
    app.get("/plugin-route", () => "Hello from plugin");
    
    // Add middleware
    app.before((ctx) => {
      ctx.pluginData = "value";
    });
  },
});

app.plugin(myPlugin({ option: "value" }));
```

### Plugin with Decorators

```typescript
const authPlugin = createPlugin({
  name: "auth",
  
  decorators: {
    user: null,      // Will be set per request
    isAdmin: false,
  },
  
  setup(app) {
    app.before(async (ctx) => {
      ctx.user = await getUser(ctx);
      ctx.isAdmin = ctx.user?.role === "admin";
    });
  },
});
```

---

## Authentication

### JWT

```typescript
import { jwt, bearer } from "asijs";

const jwtHelper = jwt({
  secret: process.env.JWT_SECRET!,
  expiresIn: "7d",
});

// Sign token
const token = await jwtHelper.sign({ userId: 123 });

// Verify token
const payload = await jwtHelper.verify(token);

// Protected route
app.get("/profile", bearer({ jwt: jwtHelper }), (ctx) => {
  return { user: ctx.user };
});
```

### Password Hashing

```typescript
import { hashPassword, verifyPassword } from "asijs";

// Hash password (uses Bun.password with argon2id)
const hash = await hashPassword("mypassword");

// Verify password
const isValid = await verifyPassword("mypassword", hash);
```

### CSRF Protection

```typescript
import { csrf, generateCsrfToken } from "asijs";

app.before(csrf());

app.get("/form", (ctx) => {
  const token = generateCsrfToken();
  ctx.setCookie("csrf", token, { httpOnly: true });
  return ctx.html(`
    <form method="POST">
      <input type="hidden" name="_csrf" value="${token}">
      <button>Submit</button>
    </form>
  `);
});
```

---

## OpenAPI

### Configuration

```typescript
import { openapi } from "asijs";

app.plugin(openapi({
  info: {
    title: "My API",
    version: "1.0.0",
    description: "API description",
  },
  servers: [
    { url: "https://api.example.com" },
  ],
  tags: [
    { name: "users", description: "User operations" },
  ],
  security: [
    { bearerAuth: [] },
  ],
}));
```

### Route Documentation

```typescript
app.get("/users", listUsers, {
  summary: "List all users",
  description: "Returns a paginated list of users",
  tags: ["users"],
  operationId: "listUsers",
  
  query: Type.Object({
    page: Type.Optional(Type.Number({ default: 1 })),
    limit: Type.Optional(Type.Number({ default: 10 })),
  }),
  
  response: Type.Object({
    users: Type.Array(UserSchema),
    total: Type.Number(),
  }),
});
```

### Swagger UI

Swagger UI is automatically available at `/docs` when using the openapi plugin.

---

## WebSocket

### Basic WebSocket

```typescript
app.ws("/chat", {
  open(ws) {
    console.log("Connected:", ws.data);
  },
  
  message(ws, message) {
    // Echo back
    ws.send(`You said: ${message}`);
  },
  
  close(ws, code, reason) {
    console.log("Disconnected:", code, reason);
  },
});
```

### WebSocket with Data

```typescript
app.ws<{ userId: string }>("/chat", {
  upgrade(req) {
    // Return data to attach to WebSocket
    return { userId: req.headers.get("X-User-ID") };
  },
  
  message(ws, message) {
    console.log(`User ${ws.data.userId} says:`, message);
  },
});
```

### Broadcasting

```typescript
const clients = new Set<ServerWebSocket>();

app.ws("/notifications", {
  open(ws) {
    clients.add(ws);
  },
  
  close(ws) {
    clients.delete(ws);
  },
});

function broadcast(message: string) {
  for (const client of clients) {
    client.send(message);
  }
}
```

---

## JSX Rendering

### Basic JSX

```typescript
import { Asi, html } from "asijs";

app.get("/", (ctx) => {
  return ctx.html(
    <html>
      <head><title>Hello</title></head>
      <body>
        <h1>Welcome!</h1>
      </body>
    </html>
  );
});
```

### Components

```typescript
function Layout({ title, children }) {
  return (
    <html>
      <head><title>{title}</title></head>
      <body>{children}</body>
    </html>
  );
}

function UserCard({ user }) {
  return (
    <div class="card">
      <h2>{user.name}</h2>
      <p>{user.email}</p>
    </div>
  );
}

app.get("/users/:id", (ctx) => {
  const user = getUser(ctx.params.id);
  return ctx.html(
    <Layout title={user.name}>
      <UserCard user={user} />
    </Layout>
  );
});
```

### Streaming HTML

```typescript
import { stream, Suspense } from "asijs";

app.get("/", (ctx) => {
  return stream(
    <html>
      <body>
        <h1>Loading...</h1>
        <Suspense fallback={<div>Loading data...</div>}>
          <AsyncComponent />
        </Suspense>
      </body>
    </html>
  );
});
```

### Helpers

```typescript
import { when, each, raw } from "asijs";

// Conditional rendering
when(user.isAdmin, <AdminPanel />)

// List rendering
each(users, (user) => <UserCard user={user} />)

// Raw HTML (no escaping)
raw("<script>alert('hi')</script>")
```

---

## Rate Limiting

### Global Rate Limit

```typescript
import { rateLimit } from "asijs";

app.plugin(rateLimit({
  limit: 100,           // Max requests
  window: 60000,        // Per minute
  message: "Too many requests",
  headers: true,        // Add rate limit headers
}));
```

### Per-Route Rate Limit

```typescript
import { apiLimit, authLimit, strictLimit } from "asijs";

// 1000 requests per minute
app.get("/api/data", apiLimit(1000), handler);

// 5 requests per 15 minutes (for login)
app.post("/login", authLimit(), handler);

// 10 requests per minute
app.post("/expensive", strictLimit(), handler);
```

### Custom Store

```typescript
import { rateLimit, TokenBucketStore } from "asijs";

app.plugin(rateLimit({
  store: new TokenBucketStore({
    maxTokens: 100,
    refillRate: 10,  // per second
  }),
}));
```

### Per-Tenant Rate Limiting (Workspace)

In a workspace with multiple sub-apps, `workspaceRateLimit()` automatically isolates rate limits per tenant
(sub-app). It reads configuration from environment variables injected by the workspace controller:

```typescript
import { Asi, workspaceRateLimit } from "asijs";

const app = new Asi();

// Zero-config — reads ASIJS_APP_NAME, ASIJS_RATE_LIMIT_MAX, etc. from env
app.plugin(workspaceRateLimit());
```

Or configure explicitly:

```typescript
import { Asi, workspaceRateLimit, TenantStore } from "asijs";

app.plugin(workspaceRateLimit({
  tenantId: "my-api",       // Override tenant identifier
  max: 1000,                // Max requests per window
  windowMs: 60_000,         // Time window (1 minute)
  message: "Rate limit exceeded",
  store: new TenantStore("my-api"),  // Optional: custom store with tenant isolation
}));
```

The workspace controller auto-injects env vars when `rateLimit` config is set:

```typescript
import { asiDev } from "asijs";

await asiDev({
  rateLimit: {
    enabled: true,
    max: 500,
    windowMs: 60_000,
  },
});
```

Each sub-app then receives:
- `ASIJS_APP_NAME` — automatically set as the tenant ID
- `ASIJS_RATE_LIMIT_MAX` — per-tenant limit
- `ASIJS_RATE_LIMIT_WINDOW_MS` — time window
- `ASIJS_RATE_LIMIT_ENABLED` — `"1"` when enabled

### Tenant-Isolated Middleware

For per-route rate limiting with tenant isolation:

```typescript
import { tenantRateLimitMiddleware } from "asijs";

app.post("/auth/login", handler, {
  beforeHandle: tenantRateLimitMiddleware({
    tenantId: "auth-service",
    max: 10,                // 10 requests
    windowMs: 60_000,       // per minute
    keyGenerator: (ctx) => ctx.header("X-API-Key") ?? "unknown",
  }),
});
```

### TenantStore

`TenantStore` wraps any `RateLimitStore` and prefixes all keys with a tenant ID,
ensuring counters are fully isolated between tenants:

```typescript
import { TenantStore, MemoryStore } from "asijs";

const shared = new MemoryStore();
const storeA = new TenantStore("tenant-alpha", shared);
const storeB = new TenantStore("tenant-beta", shared);

await storeA.increment("client-ip", 60_000, 100);  // key: "tenant-alpha:client-ip"
await storeB.increment("client-ip", 60_000, 100);  // key: "tenant-beta:client-ip"
//              ^— fully isolated from storeA!
```

### Environment Variables

`defaultTenantOptions()` reads config from environment, making it easy to configure
rate limits per deployment without code changes:

| Variable | Default | Description |
|----------|---------|-------------|
| `ASIJS_APP_NAME` | `"default"` | Tenant identifier |
| `ASIJS_RATE_LIMIT_MAX` | `1000` | Max requests per window |
| `ASIJS_RATE_LIMIT_WINDOW_MS` | `60000` | Time window in ms |
| `ASIJS_RATE_LIMIT_ENABLED` | `"1"` | Set to `"0"` to disable |

---

## Security

### Security Headers

```typescript
import { security, strictSecurity, apiSecurity } from "asijs";

// Default security headers
app.plugin(security());

// Strict security (for web apps)
app.plugin(strictSecurity());

// API security (minimal)
app.plugin(apiSecurity());
```

### Custom Security Options

```typescript
app.plugin(security({
  // Content Security Policy
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:", "https:"],
  },
  
  // HTTP Strict Transport Security
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  
  // Other headers
  xFrameOptions: "DENY",
  xContentTypeOptions: true,
  referrerPolicy: "strict-origin-when-cross-origin",
}));
```

### Nonce for Inline Scripts

```typescript
import { nonceMiddleware, generateNonce } from "asijs";

app.get("/", nonceMiddleware(), (ctx) => {
  const nonce = ctx.nonce;
  return ctx.html(`
    <script nonce="${nonce}">
      console.log("Safe inline script");
    </script>
  `);
});
```

---

## Caching

### Response Caching

```typescript
import { cache, etag, noCache } from "asijs";

// Cache for 1 hour
app.get("/data", cache("1h"), handler);

// ETags for conditional requests
app.get("/resource", etag(), handler);

// No caching
app.get("/private", noCache(), handler);
```

### Cache Plugin

```typescript
import { cachePlugin, staticCache, apiCache } from "asijs";

// Global caching
app.plugin(cachePlugin({
  ttl: 60000,  // 1 minute default
  maxSize: 1000,
}));

// Presets
app.get("/static", staticCache(), handler);  // 1 day
app.get("/api", apiCache(), handler);         // 5 minutes
```

### Manual Cache Control

```typescript
import { buildCacheControl, parseTTL, generateETag } from "asijs";

app.get("/custom", (ctx) => {
  const data = getData();
  const etag = generateETag(JSON.stringify(data));
  
  ctx.setHeader("Cache-Control", buildCacheControl({
    maxAge: parseTTL("1h"),
    private: true,
    mustRevalidate: true,
  }));
  
  ctx.setHeader("ETag", etag);
  
  return data;
});
```

---

## Tracing

### Request Tracing

```typescript
import { trace } from "asijs";

app.plugin(trace({
  headers: true,        // Add trace headers
  timing: true,         // Add Server-Timing
  requestId: true,      // Generate request ID
}));
```

### Access Trace Info

```typescript
import { getCurrentTrace, addTraceEvent } from "asijs";

app.get("/", (ctx) => {
  const trace = getCurrentTrace(ctx);
  console.log("Request ID:", trace.requestId);
  
  addTraceEvent(ctx, "Processing started");
  
  // Do work...
  
  addTraceEvent(ctx, "Processing complete");
  
  return { data: "value" };
});
```

### Metrics Collection

```typescript
import { MetricsCollector } from "asijs";

const metrics = new MetricsCollector();

app.after((ctx, response) => {
  metrics.record({
    path: ctx.path,
    method: ctx.method,
    status: response.status,
    duration: ctx.duration,
  });
});

app.get("/metrics", () => metrics.getSummary());
```

---

## Scheduler

### Background Jobs

```typescript
import { Scheduler, cron, interval, schedules } from "asijs";

const scheduler = new Scheduler();

// Every minute
scheduler.addJob(cron("cleanup", schedules.everyMinute, async () => {
  await cleanupOldData();
}));

// Every 5 seconds
scheduler.addJob(interval("ping", 5000, () => {
  console.log("Ping!");
}));

// Custom cron expression
scheduler.addJob({
  name: "daily-report",
  schedule: "0 9 * * *",  // 9 AM daily
  handler: async () => {
    await generateReport();
  },
});

scheduler.start();
```

### Cron Expressions

```
*    *    *    *    *
│    │    │    │    │
│    │    │    │    └── Day of week (0-6, Sun-Sat)
│    │    │    └─────── Month (1-12)
│    │    └──────────── Day of month (1-31)
│    └───────────────── Hour (0-23)
└────────────────────── Minute (0-59)
```

### Presets

```typescript
import { schedules } from "asijs";

schedules.everyMinute    // "* * * * *"
schedules.every5Minutes  // "*/5 * * * *"
schedules.hourly         // "0 * * * *"
schedules.daily          // "0 0 * * *"
schedules.weekly         // "0 0 * * 0"
schedules.monthly        // "0 0 1 * *"
```

---

## Lifecycle

### Graceful Shutdown

```typescript
import { lifecycle } from "asijs";

app.plugin(lifecycle({
  timeout: 30000,  // 30 second timeout
  verbose: true,   // Log shutdown progress
  
  onShutdown: async () => {
    await database.close();
    await redis.quit();
  },
}));
```

### Health Checks

```typescript
import { healthCheck } from "asijs";

app.plugin(healthCheck({
  path: "/health",
  checks: {
    database: async () => {
      await db.ping();
      return { status: "ok" };
    },
    redis: async () => {
      await redis.ping();
      return { status: "ok" };
    },
  },
}));
```

---

## MCP Server

### Model Context Protocol

MCP allows AI assistants to interact with your application.

```typescript
import { mcp, createMCPServer } from "asijs";

// Add MCP plugin
app.plugin(mcp({
  name: "my-api",
  version: "1.0.0",
  
  tools: [
    {
      name: "list_users",
      description: "List all users",
      inputSchema: { type: "object", properties: {} },
      handler: async () => ({
        content: [{ type: "text", text: JSON.stringify(users) }]
      }),
    },
  ],
  
  resources: [
    {
      uri: "api://users",
      name: "Users",
      description: "Current user list",
      handler: async () => JSON.stringify(users),
    },
  ],
}));
```

### Running as MCP Server

```typescript
// Check if running in MCP mode
if (process.argv.includes("--mcp")) {
  const mcpServer = createMCPServer(app);
  await mcpServer.start();
} else {
  app.listen(3000);
}
```

### Claude Desktop Configuration

```json
{
  "mcpServers": {
    "my-api": {
      "command": "bun",
      "args": ["run", "server.ts", "--mcp"],
      "transport": "stdio"
    }
  }
}
```

---

## Server Actions

Server Actions provide a type-safe RPC-style API similar to Next.js Server Actions or Remix actions. Define functions on the server and call them from the client with full type inference.

### Creating Actions

```typescript
import { action, simpleAction, registerActions } from "asijs";
import { Type } from "@sinclair/typebox";

// Action with input validation
const createUser = action(
  Type.Object({
    name: Type.String({ minLength: 1 }),
    email: Type.String({ format: "email" }),
  }),
  async (input, ctx) => {
    const user = { id: Date.now(), ...input };
    return { user };
  }
);

// Simple action without input
const getUsers = simpleAction(async (ctx) => {
  return { users: await db.users.findAll() };
});
```

### Registering Actions

```typescript
const app = new Asi();

const actions = {
  createUser,
  getUsers,
  deleteUser: action(
    Type.Object({ id: Type.Number() }),
    async ({ id }) => {
      await db.users.delete(id);
      return { success: true };
    }
  ),
};

// Register all actions as POST endpoints
registerActions(app, actions, { prefix: "/api" });
// Creates: POST /api/createUser, POST /api/getUsers, POST /api/deleteUser

app.listen(3000);
```

### Action Middleware

```typescript
import { requireAuth, actionRateLimit, actionLogger } from "asijs";

// Protected action requiring authentication
const deleteUser = action(
  Type.Object({ id: Type.Number() }),
  async ({ id }, ctx) => {
    // ctx.user is available from middleware
    return { deleted: id };
  },
  {
    middleware: [
      requireAuth((ctx) => {
        const token = ctx.header("authorization");
        return token ? verifyToken(token) : null;
      }),
      actionRateLimit(10, 60000), // 10 calls per minute
      actionLogger(),
    ],
  }
);
```

### Custom Errors

```typescript
import { ActionError } from "asijs";

const withdrawFunds = action(
  Type.Object({ amount: Type.Number() }),
  async ({ amount }, ctx) => {
    const balance = await getBalance(ctx.user.id);
    
    if (amount > balance) {
      throw new ActionError(
        "Insufficient funds",
        "INSUFFICIENT_FUNDS",
        400,
        { balance, requested: amount }
      );
    }
    
    return { newBalance: balance - amount };
  }
);
```

### Batch Actions

Execute multiple actions in a single request:

```typescript
import { registerBatchActions } from "asijs";

registerActions(app, actions);
registerBatchActions(app, actions);
// Creates: POST /actions/__batch
```

Client usage:

```typescript
const response = await fetch("/actions/__batch", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify([
    { action: "getUsers", input: {} },
    { action: "createUser", input: { name: "John", email: "john@example.com" } },
  ]),
});

const { results } = await response.json();
// results[0].data.users
// results[1].data.user
```

### Form Actions

For HTML forms with redirects:

```typescript
import { formAction } from "asijs";

const submitContact = formAction(
  Type.Object({
    name: Type.String(),
    message: Type.String(),
  }),
  async (input) => {
    await saveMessage(input);
    return { redirect: "/thank-you" };
  }
);
```

### Typed Client

```typescript
import { createActionsClient, type ActionsClient } from "asijs";

// Create typed client
type MyActions = typeof actions;
const client = createActionsClient<MyActions>("http://localhost:3000/actions");

// Full type inference
const { user } = await client.createUser({ name: "John", email: "john@example.com" });
const { users } = await client.getUsers({});
```

### Plugin Integration

```typescript
import { actionsPlugin } from "asijs";

app.plugin(actionsPlugin(actions, {
  prefix: "/rpc",
  enableBatch: true,
}));
```

### Type Helpers

```typescript
import type { InferActionInput, InferActionOutput } from "asijs";

type CreateUserInput = InferActionInput<typeof createUser>;
// { name: string; email: string }

type CreateUserOutput = InferActionOutput<typeof createUser>;
// { user: { id: number; name: string; email: string } }
```

---

## RPC 2.0 — Type-Safe Remote Calls

RPC 2.0 provides a modern, type-safe RPC layer built on top of AsiJS. Define typed actions once on the server, then call them from both server-side code (direct, no HTTP) and client-side code (fetch-based, with full type inference).

The pattern is similar to tRPC or Next.js Server Actions, but requires no code generation — types flow automatically from server to client.

### Key Concepts

- **`serverAction(schema, handler)`** — Define a typed action with TypeBox validation
- **`rpc(app, actions, options?)`** — Register actions as POST endpoints and get a typed callable API
- **`createRPCClient<T>(baseUrl, options?)`** — Client-side proxy client with auto-complete ("auto treaty")
- **`RPCActionError`** — Structured error class with code + details

### Defining Actions

```typescript
import { serverAction } from "asijs";
import { Type } from "@sinclair/typebox";

// Action with validated input
const greet = serverAction(
  Type.Object({
    name: Type.String({ minLength: 1 }),
  }),
  async ({ name }, ctx) => {
    return { message: `Hello, ${name}!` };
  },
);

// Action with no input
const ping = serverAction(
  Type.Object({}),
  async () => ({ status: "ok", timestamp: Date.now() }),
);
```

### Register with App

```typescript
import { Asi, serverAction, rpc } from "asijs";
import { Type } from "@sinclair/typebox";

const app = new Asi();

// Define actions
const api = rpc(app, {
  greet,
  ping,
  createUser: serverAction(
    Type.Object({
      name: Type.String(),
      email: Type.String({ format: "email" }),
    }),
    async (input) => {
      const user = { id: Date.now(), ...input };
      return { user };
    },
  ),
});

// Export type for client use!
export type AppAPI = typeof api;
```

This registers POST endpoints:
- `POST /rpc/greet`
- `POST /rpc/ping`
- `POST /rpc/createUser`

### Server-Side Direct Calls

The returned `api` object can be used directly on the server without HTTP:

```typescript
const result = await api.greet({ name: "World" });
//    ^? { message: string }

const status = await api.ping();
//    ^? { status: string; timestamp: number }
```

Direct calls validate input and execute the handler with a minimal Context. They skip HTTP overhead entirely.

### Client-Side Usage (Auto Treaty)

On the client side, import the exported type and use `createRPCClient`:

```typescript
import { createRPCClient } from "asijs/client";
import type { AppAPI } from "./server";

const api = createRPCClient<AppAPI>("http://localhost:3000");

// Fully type-safe — full autocomplete in editors
const result = await api.greet({ name: "World" });
//    ^? { message: string }

const status = await api.ping();
//    ^? { status: string; timestamp: number }
```

No code generation, no build step — just export the type from the server and import it on the client.

### Custom Prefix

```typescript
const api = rpc(app, actions, { prefix: "/api/rpc" });
// Endpoints: POST /api/rpc/greet, POST /api/rpc/ping, ...

// Client must match:
const client = createRPCClient<AppAPI>("http://localhost:3000", {
  prefix: "/api/rpc",
});
```

### Error Handling

```typescript
import { RPCActionError } from "asijs";

// On the server, throw structured errors
const withdraw = serverAction(
  Type.Object({ amount: Type.Number() }),
  async ({ amount }, ctx) => {
    if (amount > balance) {
      throw new RPCActionError(
        "Insufficient funds",
        "INSUFFICIENT_FUNDS",
        { balance, requested: amount },
      );
    }
    return { newBalance: balance - amount };
  },
);

// On the client, errors are caught as RPCActionError
try {
  await client.withdraw({ amount: 999999 });
} catch (error) {
  if (error instanceof RPCActionError) {
    console.log(error.code);       // "INSUFFICIENT_FUNDS"
    console.log(error.details);    // { balance, requested }
    console.log(error.message);    // "Insufficient funds"
  }
}
```

### Custom Error Handler

```typescript
const api = rpc(app, actions, {
  onError(error, actionName) {
    console.error(`[${actionName}]`, error);
    return new Response(JSON.stringify({
      error: "Something went wrong",
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  },
});
```

### Custom Fetch Client

```typescript
const client = createRPCClient<AppAPI>("http://localhost:3000", {
  fetch: customFetch,        // For testing or custom adapters
  headers: { Authorization: `Bearer ${token}` },
});
```

### Type Inference Helpers

```typescript
import type { InferRPCInput, InferRPCOutput, InferRPCAPI } from "asijs";

// Extract input/output types from a single action
type GreetInput = InferRPCInput<typeof greet>;
// { name: string }

type GreetOutput = InferRPCOutput<typeof greet>;
// { message: string }

// Extract all types from an API
type AllTypes = InferRPCAPI<typeof api>;
// { greet: { input: { name: string }, output: { message: string } }, ... }
```

### How It Works

1. `serverAction()` creates a branded action object with phantom types for input and output
2. `rpc()` iterates actions, compiles TypeBox validators once, registers POST endpoints
3. The returned `RPCClient` maps each action to a direct-call function (skips HTTP on server)
4. `createRPCClient()` uses a JavaScript Proxy to intercept property access and build fetch calls
5. TypeScript infers input/output types through the phantom type markers on `RPCServerAction`

---

## Async Error Boundary

```typescript
import { Asi, errorBoundary, NotFoundError, SystemError, retry } from "asijs";

const app = new Asi();
app.plugin(errorBoundary());

// Business errors → structured 4xx:
app.get("/users/:id", async (ctx) => {
  const user = await db.find(ctx.params.id);
  if (!user) throw new NotFoundError("User not found");
  return user;
});

// Catch errors locally with a fallback:
app.get("/risky", async (ctx) => {
  return ctx.errorBoundary(() => riskyCall(), { fallback: { ok: false } });
});

// Retry idempotent operations:
const data = await retry(() => fetchExternal(), {
  attempts: 3,
  backoff: "exponential",
  delayMs: 50,
});
```

Classification: `business` (4xx) / `system` (5xx) / `fatal` (crash) / `validation`. Structured body: `{ error, code, category, details?, requestId? }`.

Reporting pipeline with hooks:

```typescript
app.plugin(errorBoundary({
  reporters: [
    (report) => sentry.captureException(report.error),
  ],
  minCategory: "system",
}));
```

Full guide: [docs/features/error-boundary.md](docs/features/error-boundary.md)

---

## Observability Suite

### OTel Logs Bridge

```typescript
import { Asi, otelLogs } from "asijs";

app.plugin(otelLogs({
  otlp: {
    endpoint: "http://localhost:4318/v1/logs",
    serviceName: "my-api",
  },
}));
```

Structured log entries are converted to OTLP LogRecords with OTel semantic conventions and buffered-flushed to the collector.

### Distributed Tracing (Redis)

```typescript
import { createRedisTraceBridge, generateTraceId, generateSpanId } from "asijs";

const bridge = await createRedisTraceBridge({ url: process.env.REDIS_URL! });
bridge.emit({ traceId: generateTraceId(), spanId: generateSpanId(), name: "GET /users" });
```

Span events propagate W3C trace context between instances via Redis pub/sub.

### Healthcheck Dashboard

```typescript
import { Asi, healthDashboard } from "asijs";

app.use(healthDashboard({
  checks: {
    database: async () => { await db.ping(); },
    redis: () => redis.ping(),
  },
}));
// GET /__health      — HTML dashboard (auto-refresh 5s, circuit breakers, process info)
// GET /__health.json — JSON snapshot (200/503)
```

### Grafana Dashboard Export

```typescript
import { createGrafanaDashboard } from "asijs";

app.get("/grafana.json", () => new Response(JSON.stringify(createGrafanaDashboard()), {
  headers: { "Content-Type": "application/json" },
}));
```

Full guide: [docs/features/observability.md](docs/features/observability.md)

---

## Workspace Development

In a Bun monorepo with multiple sub-apps, `bun --hot` normally restarts the entire process when any file changes. AsiJS Workspace Development solves this by spawning **each sub-app as its own Bun process** with `--hot`, so only the sub-app whose files changed gets reloaded.

### Quick Start

```bash
# Create a workspace project
bunx asijs create my-project -t workspace

# Start all sub-apps with independent hot-reload
cd my-project
bun run dev
# Or:
bunx asijs dev
```

### Programmatic Usage

```typescript
import { asiDev, scanWorkspace, startWorkspaceDev } from "asijs";

// Option 1: Convenience — scan + start
const controller = await asiDev();

// Option 2: Scan first, then start
const apps = scanWorkspace();
const controller = await startWorkspaceDev(apps, {
  basePort: 3000,
  verbose: true,
});

// Option 3: Manual configuration
const controller = await startWorkspaceDev([
  {
    name: "api",
    entryPoint: "./apps/api/src/index.ts",
    rootDir: "./apps/api",
  },
  {
    name: "web",
    entryPoint: "./apps/web/src/index.ts",
    rootDir: "./apps/web",
  },
], {
  basePort: 3000,
  verbose: true,
});

// Stop all processes
await controller.stop();
```

### Workspace Scanner

`scanWorkspace()` automatically detects AsiJS sub-apps:

1. Reads root `package.json` for `workspaces` field
2. Expands workspace globs to find packages
3. Checks each package for AsiJS entry files (`src/index.ts`, `src/index.tsx`, `src/app.ts`, `index.ts`)
4. Verifies the file imports from `"asijs"` (heuristic)
5. Falls back to scanning `apps/`, `packages/`, `sub-apps/` directories

```typescript
const apps = scanWorkspace({ cwd: process.cwd() });
// Returns: SubApp[] with name, entryPoint, rootDir, auto-assigned port
```

### Controller API

```typescript
const controller = await startWorkspaceDev(apps);

// Check status
controller.running;  // boolean

// Restart a specific sub-app
await controller.restartApp("api");

// Stop all
await controller.stop();

// Access app list
controller.apps;  // SubApp[]
// Each app has: name, entryPoint, rootDir, port, status, lastError
```

### Environment Variables

Each sub-app receives:

| Variable | Value |
|----------|-------|
| `PORT` | Auto-assigned port (3000, 3001, 3002, ...) |
| `ASIJS_DEV` | `"1"` |
| `ASIJS_WORKSPACE` | `"1"` |
| `ASIJS_APP_NAME` | Sub-app name (also used as tenant ID for rate limiting) |

When rate limiting is configured, each sub-app also receives:

| Variable | Value |
|----------|-------|
| `ASIJS_RATE_LIMIT_ENABLED` | `"1"` when enabled, `"0"` when disabled |
| `ASIJS_RATE_LIMIT_MAX` | Max requests per tenant window |
| `ASIJS_RATE_LIMIT_WINDOW_MS` | Time window in milliseconds |

Custom env vars can be passed via `env` option:

```typescript
const controller = await asiDev({
  env: {
    DATABASE_URL: "postgres://localhost:5432/mydb",
    REDIS_URL: "redis://localhost:6379",
  },
});
```

### Sub-App Status

Each sub-app has a status field for monitoring:

- `"stopped"` — Not running
- `"starting"` — Process being spawned
- `"running"` — Process is alive
- `"error"` — Crashed or failed to start (check `app.lastError`)

If a sub-app crashes (non-zero exit), the controller logs the error and marks it as `"error"`. Other sub-apps keep running.

### Managing Processes

```typescript
// Graceful stop all
process.on("SIGINT", async () => {
  await controller.stop();
  process.exit(0);
});

// Restart on demand
await controller.restartApp("web");
```

---

## Development Mode

### Dev Mode Plugin

```typescript
import { devMode } from "asijs";

app.plugin(devMode({
  pretty: true,      // Pretty-print JSON
  timing: true,      // Add timing headers
  logging: true,     // Log requests
}));
```

### Debug Helpers

```typescript
import { debugLog, logBody, delay, chaos } from "asijs";

// Log request details
app.get("/debug", debugLog(), handler);

// Log request body
app.post("/debug", logBody(), handler);

// Add artificial delay
app.get("/slow", delay(1000), handler);

// Random failures (for testing)
app.get("/chaos", chaos(0.5), handler);  // 50% failure rate
```

---

## CLI v2 — Smarter Developer Tools

### Analyze

```bash
bunx asijs analyze            # Static project analysis
bunx asijs analyze --info     # Include info-level findings
bunx asijs analyze --json     # Machine-readable output
bunx asijs analyze --cwd ./app
```

Finds:
- **Dead routes** — same `method + path` registered twice (first is dead code)
- **Path shadowing** — static route declared after a dynamic one of the same shape
- **Missing validation** — `POST/PUT/PATCH/DELETE` without a schema
- **Duplicate middleware** — `app.use(x)` registered multiple times
- **Bottlenecks** — redundant `async` (no `await`), `await` in non-async handlers, sync middleware containing `await`

```typescript
import { analyzeProject, analyzeSource } from "asijs";
const report = await analyzeProject(process.cwd());
```

### Doctor

```bash
bunx asijs doctor             # Project diagnostics
bunx asijs doctor --json
```

Checks: configuration (package.json, entry, config file), dependencies (asijs, typescript, dev script), TypeScript strict mode + module resolution, security (rate limiting, validation on mutations, security headers, hard-coded secrets, admin auth).

```typescript
import { runDoctor } from "asijs";
const report = await runDoctor(process.cwd());
```

### Upgrade

```bash
bunx asijs upgrade                # Check & update
bunx asijs upgrade --dry-run      # Show changes without writing
bunx asijs upgrade --codemod      # Also run breaking-changes codemod
bunx asijs upgrade --offline      # Skip registry lookup
```

```typescript
import { checkForUpdates, upgradeProject, compareVersions } from "asijs";
```

### Template

```bash
bunx asijs template api       # Install template into current dir (skips existing files)
```

### Dev Tools

```bash
bunx asijs dev --inspect      # Dev + DevTools hint (dashboard, OpenAPI, REPL, analyze, doctor)
```

---

## Static Files: In-Memory Cache (2.2.7)

```typescript
import { staticFiles } from "asijs";

// Preload matching files into memory at startup
app.use(staticFiles("./public", {
  preload: true,                    // glob "**/*.{html,css,js,svg}" by default
  // preload: ["**/*.html", "**/*.css"]  // explicit patterns (Bun.Glob)

  // Cache TTL in seconds — the file is re-read from disk after expiry
  cacheTtl: 60,

  cacheSmallFiles: true,            // cache files up to cacheMaxFileSize (128KB)
  cacheMaxFileSize: 128 * 1024,
  cacheMaxEntries: 512,
  cacheMaxBytes: 16 * 1024 * 1024,
}));
```

- **`preload`** — loads files into memory at startup (`Bun.Glob`); serving
  from memory with no fs calls at all (up to **5.4×** faster: 4.3k → 23.2k req/s).
- **`cacheTtl`** — TTL in seconds; catches file changes invisible to
  size/mtime (MemoryCache-compatible semantics).
- Without `preload`/`cacheTtl` the previous behavior holds: `cacheSmallFiles`
  validates size/mtime from disk on every request, changes are picked up instantly.

---

## Database Layer (2.3)

Zero-dependency database access: SQLite via `bun:sqlite` (built-in), PostgreSQL
via lazy `import("postgres")`.

```typescript
import { Asi, Database } from "asijs";

// Standalone
const db = new Database({ url: "file:./app.db" });
db.execute("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)");
const rows = db.query("SELECT * FROM users");

// Via Asi config — app.db lazy + auto-migration
const app = new Asi({
  database: {
    url: "file:./app.db",
    migrationsDir: "./migrations",
    autoMigrate: true,   // pending migrations on first app.db access
    autoSeed: true,      // seed.sql / seed.ts after migrations
  },
});
```

### Migrations

```bash
asi db migrate                 # apply pending
asi db migrate --status        # applied vs pending
asi db migrate --down          # rollback last
asi db migrate --create "add posts"  # scaffold migrations/001_add_posts.sql
asi db seed [file]             # .sql or .ts module
asi db studio                  # GUI: http://localhost:5500
```

Migration file convention: `001_create_users.sql` (up-only) or
`001_create_users.up.sql` + `001_create_users.down.sql` (reversible).
Progress is tracked in the `__migrations` table.

---

## API Reference

### Asi Class

```typescript
class Asi {
  constructor(config?: AsiConfig);
  
  // HTTP methods
  get(path, ...handlers): this;
  post(path, ...handlers): this;
  put(path, ...handlers): this;
  patch(path, ...handlers): this;
  delete(path, ...handlers): this;
  head(path, ...handlers): this;
  options(path, ...handlers): this;
  all(path, ...handlers): this;
  
  // WebSocket
  ws(path, handlers): this;
  
  // Grouping
  group(prefix, callback): this;
  
  // Middleware
  before(handler): this;
  after(handler): this;
  onError(handler): this;
  onNotFound(handler): this;
  
  // Plugins
  plugin(plugin): this;
  
  // Server
  listen(port?, callback?): Server;
  stop(): void;
  
  // Internals
  fetch(request): Response | Promise<Response>;
}
```

### RPC Functions

```typescript
// Create a type-safe server action
function serverAction<TInput extends TSchema, TOutput>(
  schema: TInput,
  handler: (input: Static<TInput>, ctx: Context) => Promise<TOutput>,
): RPCServerAction<Static<TInput>, TOutput>;

// Register actions and get typed API
function rpc<T extends RPCRegistry>(
  app: Asi,
  actions: T,
  options?: RPCOptions,
): RPCClient<T>;

// Create client-side RPC client (auto treaty)
function createRPCClient<T>(
  baseUrl: string,
  options?: RPCClientOptions,
): T;
```

### Workspace Functions

```typescript
// Scan workspace for AsiJS sub-apps
function scanWorkspace(options?: { cwd?: string }): SubApp[];

// Start workspace dev mode (convenience)
function asiDev(options?: WorkspaceDevOptions): Promise<WorkspaceDevController>;

// Start workspace dev mode (explicit)
function startWorkspaceDev(
  apps: SubApp[],
  options?: WorkspaceDevOptions,
): Promise<WorkspaceDevController>;
```

### Workspace V2 — Production Multi-App Server

```typescript
// Run multiple apps on a single Bun.serve with host/prefix routing
class Workspace {
  app(name: string, config: AsiConfig, setup: (app: Asi) => void): this;
  appWith(config: WorkspaceAppConfig): this;
  listen(port?: number, callback?: () => void): any;
  async stop(): Promise<void>; // graceful cascade: sub-apps → root
}

function createWorkspace(options?: WorkspaceOptions): Workspace;
```

Internal endpoints (enabled by default):
- `GET {dashboardPath}` (`/__asi/workspace`) — live dashboard (auto-refresh 2s)
- `GET {metricsPath}` (`/__asi/metrics`) — JSON metrics per app
- `GET {openapiPath}` (`/__asi/docs`) — Swagger UI

### Shared State Bus

```typescript
// In-memory pub/sub between sub-apps
class EventBus {
  on<T>(topic: string, handler: EventHandler<T>): () => void;
  once<T>(topic: string, handler: EventHandler<T>): () => void;
  off<T>(topic: string, handler: EventHandler<T>): void;
  emit<T>(topic: string, payload: T): void;
  emitAsync<T>(topic: string, payload: T): Promise<void>;
  stats(): EventBusStats;
}

// With Redis bridge (cross-instance)
function createRedisEventBus(options: RedisEventBusOptions): Promise<EventBus>;
```

Pass `{ bus }` to `Workspace` — every sub-app receives the bus via `app.getState("eventBus")`.

### Context Class

```typescript
class Context {
  // Request info
  request: Request;
  url: URL;
  path: string;
  method: string;
  params: Record<string, string>;
  query: Record<string, string>;
  headers: Headers;
  
  // Body parsing
  body<T>(): Promise<T>;
  text(): Promise<string>;
  formData(): Promise<FormData>;
  raw(): Promise<ArrayBuffer>;
  
  // Response methods
  status(code: number): this;
  jsonResponse(data: any): Response;
  text(text: string): Response;
  html(html: string | JSXElement): Response;
  redirect(url: string, status?: number): Response;
  
  // Headers
  header(name: string): string | null;
  setHeader(name: string, value: string): this;
  
  // Cookies
  getCookie(name: string): string | undefined;
  setCookie(name, value, options?): this;
  deleteCookie(name: string): this;
}
```

### Type Exports

```typescript
// Core
export { Asi, Context, Type };

// Types
export type {
  Handler,
  Middleware,
  RouteOptions,
  RouteSchema,
  AsiConfig,
  AsiPlugin,
};

// Plugins
export {
  cors,
  staticFiles,
  openapi,
  rateLimit,
  security,
  cache,
  trace,
  lifecycle,
  scheduler,
  devMode,
  mcp,
  workspaceRateLimit,
};

// Rate Limit Utilities
export {
  rateLimitMiddleware,
  tenantRateLimitMiddleware,
  MemoryStore,
  TokenBucketStore,
  TenantStore,
  standardLimit,
  strictLimit,
  apiLimit,
  authLimit,
};

// Auth
export {
  jwt,
  bearer,
  hashPassword,
  verifyPassword,
  csrf,
};

// Validation
export {
  validate,
  createValidator,
  ValidationException,
};

// JSX
export {
  jsx,
  jsxs,
  Fragment,
  html,
  stream,
  Suspense,
};

// RPC 2.0
export {
  serverAction,
  rpc,
  createRPCClient,
  RPCActionError,
};

// Workspace
export type {
  SubApp,
  SubAppConfig,
  SubAppProcess,
  WorkspaceDevOptions,
  WorkspaceRateLimitConfig,
  WorkspaceDevController,
};

export {
  scanWorkspace,
  startWorkspaceDev,
  asiDev,
};

// Tenant Rate Limiting
export {
  workspaceRateLimit,
  tenantRateLimitMiddleware,
  TenantStore,
  defaultTenantOptions,
};

export type {
  TenantRateLimitOptions,
};

// RPC Types
export type {
  RPCServerAction,
  RPCRegistry,
  RPCClient,
  RPCClientOptions,
  InferRPCOutput,
  InferRPCInput,
  InferRPCAPI,
};
```

---

## License

MIT License - see [LICENSE](LICENSE) file for details.
