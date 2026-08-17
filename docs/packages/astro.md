# asijs-astro — Astro Adapter

Run AsiJS endpoints and middleware inside Astro. Three integration points cover every shape of Astro route: catch-all API endpoints, single-method endpoints, and `onRequest` middleware.

- Package: `asijs-astro`
- Requires: `asijs` (peer dependency)
- Supports: Astro 4+ / 5+

## Installation

```bash
bun add asijs-astro
```

## 1. Catch-all API endpoint

```typescript
// src/pages/api/[...asi].ts
import { Asi } from "asijs";
import { createAstroHandler } from "asijs-astro";

const app = new Asi();
app.get("/api/hello", () => "Hello from AsiJS + Astro!");

export const all = createAstroHandler(app);
```

`export const all` matches **every HTTP method** and forwards it through AsiJS. Register routes with the `/api` prefix (or use `basePath` to strip it).

## 2. Single-method endpoint

```typescript
// src/pages/api/hello.ts
import { Asi } from "asijs";
import { createEndpoint } from "asijs-astro";

const app = new Asi();
app.get("/api/hello", () => "Hello!");

export const GET = createEndpoint(app, "GET");
```

`createEndpoint(app, method)` returns an Astro endpoint that returns **405 Method Not Allowed** (with the correct `Allow` header) when the request method doesn't match. Useful for exposing exactly one verb per file.

## 3. Middleware (`onRequest`)

```typescript
// src/middleware.ts
import { Asi } from "asijs";
import { createAstroMiddleware } from "asijs-astro";

const app = new Asi();
app.get("/api/*", (ctx) => ctx.json({ message: "Hello!" }));

export const onRequest = createAstroMiddleware(app, { basePath: "/api" });
```

The middleware intercepts matching requests before Astro's page rendering — everything that doesn't match falls through to Astro normally.

## Options

All three accept the same options object:

```typescript
interface AstroAdapterOptions {
  /** Base path prefix to strip from incoming requests */
  basePath?: string;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Custom error handler */
  onError?: (error: Error) => Response;
}
```

## Astro context integration

The adapter converts Astro's `APIContext` into a standard `Request` and maps the response back. This means:

| Astro feature | AsiJS equivalent |
|---|---|
| `context.cookies.get/set/delete` | `ctx.cookie(...)`, `ctx.cookies` |
| `context.redirect(path)` | `ctx.redirect(path)` |
| `context.params` | `ctx.params` (route params from AsiJS routes) |
| `context.clientAddress` | `ctx.request` IP via `trustProxy` middleware |
| `context.locals` | passed through to `ctx` as `locals` |

Astro's `locals` object is available on the AsiJS context as `ctx.locals`, so you can share data between Astro middleware and AsiJS handlers:

```typescript
app.get("/api/user", (ctx) => {
  // ctx.locals was set by an earlier Astro middleware
  return { user: ctx.locals.user };
});
```

## Streaming & responses

Astro endpoints may return a `Response` — AsiJS's `ctx.stream()`, `ctx.sse()`, and `ctx.html()` all produce standard `Response`s that the adapter passes through untouched.

## Performance notes

1. Define the `Asi` instance at module scope — route table is built once at import time.
2. Use `basePath` to match the file's location (`src/pages/api/[...asi].ts` → `basePath: "/api"`) so routes can be written without the prefix.
3. For static paths, `app.compile()` builds a direct-map router for the fastest dispatch.
