# Routing

## HTTP Methods

AsiJS supports all standard HTTP methods:

```typescript
app.get("/users", handler);
app.post("/users", handler);
app.put("/users/:id", handler);
app.patch("/users/:id", handler);
app.delete("/users/:id", handler);
app.head("/users", handler);
app.options("/users", handler);
app.all("/catchall", handler);  // Any method
```

## Route Parameters

Named parameters with `:param` syntax:

```typescript
app.get("/users/:id", (ctx) => {
  return { userId: ctx.params.id };
});

app.get("/posts/:year/:month/:slug", (ctx) => {
  return {
    year: ctx.params.year,
    month: ctx.params.month,
    slug: ctx.params.slug,
  };
});
```

## Wildcards

```typescript
app.get("/files/*", (ctx) => {
  // ctx.params['*'] captures the rest
  return { path: ctx.params["*"] };
});
```

## Route Groups

Group routes with a shared prefix:

```typescript
app.group("/api", (api) => {
  api.get("/users", () => [{ id: 1 }]);
  api.get("/users/:id", (ctx) => ({ id: ctx.params.id }));
  api.post("/users", (ctx) => {
    const body = await ctx.json();
    return { created: true, ...body };
  });

  // Nested groups
  api.group("/v2", (v2) => {
    v2.get("/users", () => [{ id: 1, version: 2 }]);
  });
});

// Registers:
// GET    /api/users
// GET    /api/users/:id
// POST   /api/users
// GET    /api/v2/users
```

## Route Options

Add validation schemas, before/after hooks to individual routes:

```typescript
app.post(
  "/users",
  handler,
  {
    schema: {
      body: Type.Object({ name: Type.String() }),
      query: Type.Object({ page: Type.Optional(Type.Number()) }),
      params: Type.Object({}),
    },
    beforeHandle: [authMiddleware, rateLimitMiddleware],
    afterHandle: cache({ ttl: "5m" }),
  },
);
```

## File-Based Routing

Drop route files into `src/routes/` for automatic registration:

```
src/routes/
  users.ts           → export function get/post/put/delete
  users/[id].ts      → GET /users/:id
  users/[id].get.ts  → GET /users/:id  (method suffix)
  users/index.ts     → GET /users  (index = dir root)
  (auth)/login.ts    → /login  (groups ignored)
  _helpers.ts        → skipped  (underscore = private)
```

```typescript
// src/routes/users.ts
export function get(ctx) {
  return [{ id: 1, name: "Alice" }];
}

export function post(ctx) {
  const body = await ctx.parseBody();
  return { created: true, ...body };
}

// src/routes/users/[id].ts
export function get(ctx) {
  return { id: ctx.params.id, name: "User" };
}
```

Enable file-based routing:

```typescript
const app = new Asi();
await app.fromFileRoutes();
// or: await app.fromFileRoutes({ dir: "app/routes", verbose: true });
app.listen(3000);
```

## WebSocket Routes

```typescript
app.ws("/chat", {
  open(ws) { console.log("Connected"); },
  message(ws, msg) { ws.send(`Echo: ${msg}`); },
  close(ws) { console.log("Disconnected"); },
});

// With typed data
app.ws<{ userId: string }>("/user", {
  open(ws) { console.log(`User ${ws.data.userId} connected`); },
  message(ws, msg) { ws.send(`Received: ${msg}`); },
});
```

## Lifecycle Hooks

```typescript
// Global hooks
app.onBeforeHandle(async (ctx) => {
  console.log(`→ ${ctx.method} ${ctx.path}`);
});

app.onAfterHandle(async (ctx, response) => {
  console.log(`← ${ctx.method} ${ctx.path} → ${response.status}`);
  return response;
});
```

## Route Compilation

Call `app.compile()` to pre-compile all routes for maximum performance:

```typescript
const app = new Asi();
app.get("/", () => "Hello");
app.get("/users", () => [{ id: 1 }]);
app.compile();  // Optional — called automatically on listen()
app.listen(3000);
```

Compilation:
- Pre-compiles TypeBox validators
- Creates optimized handlers without runtime checks
- Builds a static router for parameterless paths
- Identifies static responses for zero-alloc fast path
