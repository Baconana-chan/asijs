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
20. [Development Mode](#development-mode)
21. [API Reference](#api-reference)

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

app.notFound((ctx) => {
  return ctx.status(404).jsonResponse({
    error: "Not Found",
    path: ctx.path,
  });
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
  notFound(handler): this;
  
  // Plugins
  plugin(plugin): this;
  
  // Server
  listen(port?, callback?): Server;
  stop(): void;
  
  // Internals
  fetch(request): Response | Promise<Response>;
}
```

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
```

---

## License

MIT License - see [LICENSE](LICENSE) file for details.
