# Context & Middleware

## Context (ctx)

Every route handler receives a `Context` object:

```typescript
app.get("/hello/:name", (ctx) => {
  // Request data
  ctx.method;      // "GET"
  ctx.path;        // "/hello/world"
  ctx.params;      // { name: "world" }
  ctx.query;       // { page: "1" } (parsed from URL)
  ctx.headers;     // Headers object
  ctx.body();      // Parse JSON body (async)

  // Response helpers
  ctx.status(201);                      // Set status code
  ctx.jsonResponse({ ok: true });       // JSON response
  ctx.html("<h1>Hello</h1>");           // HTML response
  ctx.redirect("/other");               // Redirect (302)
  ctx.redirect("/other", 301);          // Permanent redirect
  ctx.setHeader("X-Custom", "value");   // Set response header

  // Cookies
  ctx.cookie("session");                // Get cookie
  ctx.setCookie("session", "abc123");   // Set cookie

  return { message: "ok" };             // Auto → JSON response
});
```

### Automatic Response Conversion

AsiJS converts return values to responses automatically:

| Return Type | Status | Content-Type |
|-------------|--------|-------------|
| `object` / `Array` | 200 | `application/json` |
| `string` | 200 | `text/plain` |
| `undefined` / `null` | 204 | — |
| `Response` | as-is | as-is |
| `Blob` | 200 | from Blob |
| `number` / `boolean` | 200 | `text/plain` |

## Middleware

Middleware functions run before route handlers. They can modify the request, check auth, log, or short-circuit the response.

### Route Middleware

```typescript
// Simple middleware without next()
const logger: Middleware = async (ctx) => {
  console.log(`${ctx.method} ${ctx.path}`);
};

app.use(logger);

// Middleware with next() for chain control
const timing: Middleware = async (ctx, next) => {
  const start = Date.now();
  const response = await next();
  const duration = Date.now() - start;
  response.headers.set("X-Duration", String(duration));
  return response;
};

app.use(timing);
```

### Multiple Middleware

```typescript
app.use(middleware1);
app.use(middleware2);
app.use(middleware3);

// Middleware chain: m1 → m2 → m3 → handler → m3 → m2 → m1 (with next())
```

### Global Middleware

```typescript
app.use(async (ctx, next) => {
  console.log("Before all requests");
  const response = await next();
  console.log("After all requests");
  return response;
});
```

### Path-Specific Middleware

```typescript
// Middleware only for /api routes
app.use("/api", async (ctx, next) => {
  const token = ctx.header("Authorization");
  if (!token) {
    return ctx.status(401).jsonResponse({ error: "Unauthorized" });
  }
  return next();
});
```

### Route-Level Hooks

```typescript
app.get(
  "/admin",
  handler,
  {
    beforeHandle: [authMiddleware, rateLimit],
    afterHandle: [cache({ ttl: "5m" })],
  },
);
```
