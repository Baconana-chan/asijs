# Migration Guide: Elysia / Hono → AsiJS

This guide helps you migrate existing applications from Elysia or Hono to AsiJS.

## Table of Contents

- [Why Migrate to AsiJS?](#why-migrate-to-asijs)
- [Quick Comparison](#quick-comparison)
- [Migrating from Elysia](#migrating-from-elysia)
- [Migrating from Hono](#migrating-from-hono)
- [Feature Mapping](#feature-mapping)
- [Step-by-Step Migration](#step-by-step-migration)

---

## Why Migrate to AsiJS?

| Feature | AsiJS | Elysia | Hono |
|---------|-------|--------|------|
| Bun-first | ✅ Native | ✅ Native | ⚠️ Multi-runtime |
| TypeBox validation | ✅ Built-in | ✅ Built-in | ❌ Requires addon |
| MCP for AI/LLM | ✅ Built-in | ❌ No | ❌ No |
| OpenAPI/Swagger | ✅ Built-in | ✅ Plugin | ⚠️ Plugin |
| Compiled routes | ✅ Built-in | ✅ Yes | ❌ No |
| Security headers | ✅ Built-in | ⚠️ Plugin | ⚠️ Plugin |
| Scheduler/Cron | ✅ Built-in | ❌ No | ❌ No |
| Response caching | ✅ Built-in | ❌ No | ⚠️ Plugin |
| Lifecycle management | ✅ Built-in | ❌ No | ❌ No |
| Bundle size | 🟢 Small | 🟡 Medium | 🟢 Small |

---

## Quick Comparison

### Basic App

<table>
<tr><th>Elysia</th><th>AsiJS</th></tr>
<tr>
<td>

```typescript
import { Elysia } from "elysia";

const app = new Elysia()
  .get("/", () => "Hello")
  .listen(3000);
```

</td>
<td>

```typescript
import { Asi } from "asijs";

const app = new Asi();
app.get("/", () => "Hello");
app.listen(3000);
```

</td>
</tr>
</table>

<table>
<tr><th>Hono</th><th>AsiJS</th></tr>
<tr>
<td>

```typescript
import { Hono } from "hono";

const app = new Hono();
app.get("/", (c) => c.text("Hello"));

export default app;
```

</td>
<td>

```typescript
import { Asi } from "asijs";

const app = new Asi();
app.get("/", () => "Hello");
app.listen(3000);
```

</td>
</tr>
</table>

---

## Migrating from Elysia

### App Initialization

```typescript
// Elysia
import { Elysia } from "elysia";
const app = new Elysia({ prefix: "/api" });

// AsiJS
import { Asi } from "asijs";
const app = new Asi({ basePath: "/api" });
```

### Route Definition

```typescript
// Elysia (chained)
app.get("/users", () => users)
   .post("/users", ({ body }) => createUser(body))
   .get("/users/:id", ({ params }) => getUser(params.id));

// AsiJS (method calls)
app.get("/users", () => users);
app.post("/users", async (ctx) => createUser(await ctx.body()));
app.get("/users/:id", (ctx) => getUser(ctx.params.id));
```

### Context Access

| Elysia | AsiJS |
|--------|-------|
| `({ body })` | `await ctx.body()` |
| `({ params })` | `ctx.params` |
| `({ query })` | `ctx.query` |
| `({ headers })` | `ctx.headers` |
| `({ cookie })` | `ctx.getCookie()` |
| `({ set })` | `ctx.status()`, `ctx.setHeader()` |

```typescript
// Elysia
app.get("/user", ({ query, set, cookie }) => {
  set.status = 201;
  set.headers["X-Custom"] = "value";
  cookie.session.set({ value: "abc" });
  return { id: query.id };
});

// AsiJS
app.get("/user", (ctx) => {
  ctx.setCookie("session", "abc");
  ctx.setHeader("X-Custom", "value");
  return ctx.status(201).jsonResponse({ id: ctx.query.id });
});
```

### Validation (TypeBox)

```typescript
// Elysia
import { t } from "elysia";

app.post("/users", ({ body }) => body, {
  body: t.Object({
    name: t.String(),
    email: t.String({ format: "email" }),
  }),
});

// AsiJS
import { Type } from "asijs";

app.post("/users", async (ctx) => await ctx.body(), {
  body: Type.Object({
    name: Type.String(),
    email: Type.String({ format: "email" }),
  }),
});
```

### Plugins

```typescript
// Elysia
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";

app.use(cors())
   .use(swagger());

// AsiJS
import { cors, openapi } from "asijs";

app.plugin(cors());
app.plugin(openapi({ info: { title: "API", version: "1.0.0" } }));
```

### Groups

```typescript
// Elysia
app.group("/api", (api) => api
  .get("/users", getUsers)
  .post("/users", createUser)
);

// AsiJS
app.group("/api", (api) => {
  api.get("/users", getUsers);
  api.post("/users", createUser);
});
```

### Guards / Middleware

```typescript
// Elysia
app.derive(({ headers }) => ({
  user: verifyToken(headers.authorization)
}));

app.guard({ beforeHandle: [authGuard] }, (app) =>
  app.get("/protected", ({ user }) => user)
);

// AsiJS
const authMiddleware = async (ctx, next) => {
  ctx.user = await verifyToken(ctx.headers.get("authorization"));
  return next();
};

app.get("/protected", authMiddleware, (ctx) => ctx.user);
```

### WebSocket

```typescript
// Elysia
app.ws("/chat", {
  message(ws, message) {
    ws.send(message);
  },
});

// AsiJS
app.ws("/chat", {
  message(ws, message) {
    ws.send(message);
  },
});
```

### JWT

```typescript
// Elysia
import { jwt } from "@elysiajs/jwt";

app.use(jwt({ secret: "secret" }))
   .get("/sign", ({ jwt }) => jwt.sign({ id: 1 }));

// AsiJS
import { jwt } from "asijs";

const jwtHelper = jwt({ secret: "secret" });
app.get("/sign", () => jwtHelper.sign({ id: 1 }));
```

---

## Migrating from Hono

### App Initialization

```typescript
// Hono
import { Hono } from "hono";
const app = new Hono();

// AsiJS
import { Asi } from "asijs";
const app = new Asi();
```

### Route Definition

```typescript
// Hono
app.get("/", (c) => c.text("Hello"));
app.get("/json", (c) => c.json({ message: "Hello" }));
app.get("/html", (c) => c.html("<h1>Hello</h1>"));

// AsiJS
app.get("/", () => "Hello");
app.get("/json", () => ({ message: "Hello" }));
app.get("/html", (ctx) => ctx.html("<h1>Hello</h1>"));
```

### Context Methods

| Hono | AsiJS |
|------|-------|
| `c.text("Hello")` | `"Hello"` or `ctx.text("Hello")` |
| `c.json({ data })` | `{ data }` or `ctx.jsonResponse({ data })` |
| `c.html("<h1>Hi</h1>")` | `ctx.html("<h1>Hi</h1>")` |
| `c.redirect("/path")` | `ctx.redirect("/path")` |
| `c.req.param("id")` | `ctx.params.id` |
| `c.req.query("q")` | `ctx.query.q` |
| `c.req.header("X-Key")` | `ctx.header("X-Key")` |
| `await c.req.json()` | `await ctx.body()` |
| `c.status(201)` | `ctx.status(201)` |
| `c.header("X-Key", "val")` | `ctx.setHeader("X-Key", "val")` |

```typescript
// Hono
app.post("/users", async (c) => {
  const body = await c.req.json();
  const id = c.req.param("id");
  c.status(201);
  c.header("X-Custom", "value");
  return c.json({ id, ...body });
});

// AsiJS
app.post("/users", async (ctx) => {
  const body = await ctx.body();
  ctx.setHeader("X-Custom", "value");
  return ctx.status(201).jsonResponse({ id: ctx.params.id, ...body });
});
```

### Middleware

```typescript
// Hono
import { logger } from "hono/logger";
import { cors } from "hono/cors";

app.use("*", logger());
app.use("*", cors());

// AsiJS
import { cors, devMode } from "asijs";

app.plugin(devMode({ logging: true }));
app.plugin(cors());
```

### Route Groups

```typescript
// Hono
const api = new Hono();
api.get("/users", getUsers);
app.route("/api", api);

// AsiJS
app.group("/api", (api) => {
  api.get("/users", getUsers);
});
```

### Validation (Zod → TypeBox)

```typescript
// Hono + Zod
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

app.post("/users", 
  zValidator("json", z.object({
    name: z.string(),
    email: z.string().email(),
  })),
  (c) => c.json({ success: true })
);

// AsiJS + TypeBox
import { Type } from "asijs";

app.post("/users", async (ctx) => ({ success: true }), {
  body: Type.Object({
    name: Type.String(),
    email: Type.String({ format: "email" }),
  }),
});
```

### JWT

```typescript
// Hono
import { jwt } from "hono/jwt";

app.use("/auth/*", jwt({ secret: "secret" }));
app.get("/auth/me", (c) => {
  const payload = c.get("jwtPayload");
  return c.json(payload);
});

// AsiJS
import { jwt, bearer } from "asijs";

const jwtHelper = jwt({ secret: "secret" });
app.get("/auth/me", bearer({ jwt: jwtHelper }), (ctx) => {
  return ctx.user;
});
```

---

## Feature Mapping

### Elysia → AsiJS

| Elysia | AsiJS | Notes |
|--------|-------|-------|
| `new Elysia()` | `new Asi()` | |
| `.get()/.post()/...` | `.get()/.post()/...` | Not chained |
| `{ body }` | `await ctx.body()` | Lazy parsing |
| `{ params }` | `ctx.params` | |
| `{ query }` | `ctx.query` | |
| `{ set }` | `ctx.status()`, `ctx.setHeader()` | |
| `.derive()` | `.before()` | |
| `.guard()` | Middleware function | |
| `.use(plugin)` | `.plugin(plugin)` | |
| `.group()` | `.group()` | Callback style |
| `t.Object()` | `Type.Object()` | Same TypeBox |
| `@elysiajs/cors` | `cors()` | Built-in |
| `@elysiajs/swagger` | `openapi()` | Built-in |
| `@elysiajs/jwt` | `jwt()`, `bearer()` | Built-in |
| `@elysiajs/static` | `staticFiles()` | Built-in |

### Hono → AsiJS

| Hono | AsiJS | Notes |
|------|-------|-------|
| `new Hono()` | `new Asi()` | |
| `c.text()` | `return "string"` | Auto-detect |
| `c.json()` | `return { object }` | Auto-detect |
| `c.html()` | `ctx.html()` | |
| `c.redirect()` | `ctx.redirect()` | |
| `c.req.param()` | `ctx.params` | Object access |
| `c.req.query()` | `ctx.query` | Object access |
| `c.req.json()` | `ctx.body()` | |
| `c.status()` | `ctx.status()` | Chainable |
| `c.header()` | `ctx.setHeader()` | |
| `app.use()` | `app.plugin()` or middleware | |
| `app.route()` | `app.group()` | |
| `hono/cors` | `cors()` | Built-in |
| `hono/jwt` | `jwt()`, `bearer()` | Built-in |
| `@hono/zod-validator` | TypeBox schemas | Different lib |

---

## Step-by-Step Migration

### 1. Install AsiJS

```bash
# Remove old framework
bun remove elysia  # or hono

# Install AsiJS
bun add asijs
```

### 2. Update Imports

```typescript
// Before (Elysia)
import { Elysia, t } from "elysia";

// Before (Hono)
import { Hono } from "hono";
import { z } from "zod";

// After
import { Asi, Type } from "asijs";
```

### 3. Update App Creation

```typescript
// Before
const app = new Elysia();
// or
const app = new Hono();

// After
const app = new Asi();
```

### 4. Update Route Handlers

```typescript
// Before (Elysia)
app.get("/users/:id", ({ params, query }) => {
  return { id: params.id, filter: query.filter };
});

// Before (Hono)
app.get("/users/:id", (c) => {
  return c.json({ 
    id: c.req.param("id"), 
    filter: c.req.query("filter") 
  });
});

// After
app.get("/users/:id", (ctx) => ({
  id: ctx.params.id,
  filter: ctx.query.filter,
}));
```

### 5. Update Validation

```typescript
// Before (Elysia)
app.post("/users", ({ body }) => body, {
  body: t.Object({ name: t.String() }),
});

// Before (Hono + Zod)
app.post("/users",
  zValidator("json", z.object({ name: z.string() })),
  (c) => c.json(c.req.valid("json"))
);

// After
app.post("/users", async (ctx) => await ctx.body(), {
  body: Type.Object({ name: Type.String() }),
});
```

### 6. Update Plugins

```typescript
// Before (Elysia)
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
app.use(cors()).use(swagger());

// Before (Hono)
import { cors } from "hono/cors";
app.use("*", cors());

// After
import { cors, openapi } from "asijs";
app.plugin(cors());
app.plugin(openapi({ info: { title: "API", version: "1.0.0" } }));
```

### 7. Update Server Start

```typescript
// Before (Elysia)
app.listen(3000);

// Before (Hono)
export default app;
// or
Bun.serve({ port: 3000, fetch: app.fetch });

// After
app.listen(3000);
// or
app.listen(); // Uses PORT env or 3000
```

### 8. Run Tests

```bash
bun test
```

---

## Need Help?

- 📚 [Documentation](./DOCUMENTATION.md)
- 💬 [GitHub Issues](https://github.com/user/asijs/issues)
- 📖 [Examples](./examples/)
