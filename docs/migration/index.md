# Migration Guide

Migrate your existing applications from Elysia, Hono, or Fastify to AsiJS.

## Automatic Migration (Codemod)

AsiJS includes a built-in codemod CLI for automatic migration:

```bash
# Preview changes (dry run)
bunx asijs migrate ./src --dry-run -v

# Migrate from Elysia
bunx asijs migrate ./src --from elysia

# Migrate from Hono
bunx asijs migrate ./src --from hono

# Migrate from Fastify
bunx asijs migrate ./app.ts --from fastify
```

The codemod handles 60+ patterns: imports, route definitions, plugins, middleware, and more.

## Manual Migration

### Elysia → AsiJS

| Elysia | AsiJS |
|--------|-------|
| `new Elysia()` | `new Asi()` |
| `.get()` / `.post()` | `app.get()` / `app.post()` |
| `.use(plugin)` | `app.plugin(plugin)` |
| `.derive(fn)` | `app.before(fn)` |
| `.guard()` | `app.group()` with middleware |
| `t.String` / `t.Number` | `Type.String` / `Type.Number` |
| `set.status` | `ctx.status(N)` |
| `@elysiajs/cors` | `import { cors } from "asijs"` |

### Hono → AsiJS

| Hono | AsiJS |
|------|-------|
| `new Hono()` | `new Asi()` |
| `c.text(str)` | `return str` |
| `c.json(obj)` | `return obj` |
| `c.html(str)` | `ctx.html(str)` |
| `c.req.param("name")` | `ctx.params.name` |
| `c.req.query("q")` | `ctx.query.q` |
| `c.status(N)` | `ctx.status(N)` |
| `hono/cors` → `cors` | `import { cors } from "asijs"` |
| `export default app` | `app.listen()` |

### Fastify → AsiJS

| Fastify | AsiJS |
|---------|-------|
| `fastify()` | `new Asi()` |
| `reply.code(N)` | `ctx.status(N)` |
| `reply.send(data)` | `return data` |
| `request.params` | `ctx.params` |
| `request.query` | `ctx.query` |
| `app.register(plugin)` | `app.plugin(plugin)` |
| `app.listen({ port })` | `app.listen(port)` |
| `request.log.info()` | `console.log()` |

> **Note:** The codemod is a best-effort regex-based transformation. Complex cases (nested routes, custom plugins) may require manual adjustments.
