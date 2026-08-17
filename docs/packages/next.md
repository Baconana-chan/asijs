# asijs-next — Next.js Adapter

Use AsiJS routing inside Next.js. The adapter supports both the **App Router** (`route.ts`) and the **Pages Router** (`pages/api`), so you can keep writing `app.get(...)` / `app.post(...)` while Next.js handles the framework around it.

- Package: `asijs-next`
- Requires: `asijs` (peer dependency)
- Supports: Next.js 14+ / 15+, App Router & Pages Router

## Installation

```bash
bun add asijs-next
```

## Quick start — App Router

Create a catch-all route that forwards every method through AsiJS:

```typescript
// app/api/[[...asi]]/route.ts
import { Asi } from "asijs";
import { createNextHandler } from "asijs-next";

const app = new Asi();

app.get("/api/hello", () => ({ message: "Hello from AsiJS!" }));
app.post("/api/data", async (ctx) => {
  const body = await ctx.json();
  return { received: body };
});

export const { GET, POST, PUT, DELETE, PATCH } = createNextHandler(app);
```

### App Router — how it works

| Concept | Detail |
|---|---|
| File location | `app/api/[[...asi]]/route.ts` (optional catch-all) |
| Export shape | Named exports `GET`/`POST`/`PUT`/`DELETE`/`PATCH`/`HEAD`/`OPTIONS` |
| Request type | Next's `Request` — `nextUrl`, `cookies`, `geo`, `ip` are preserved |
| Path matching | AsiJS routes match against the **full pathname** (`/api/hello`), so register routes with the `/api` prefix |

`createNextHandler` returns all seven method handlers at once — destructure the ones your app uses:

```typescript
export const { GET, POST } = createNextHandler(app);   // only GET + POST exported
```

## Quick start — Pages Router

```typescript
// pages/api/[[...asi]].ts
import { Asi } from "asijs";
import { createPagesHandler } from "asijs-next";

const app = new Asi();
app.get("/api/hello", () => "Hello!");

export default createPagesHandler(app);
```

The Pages Router handler converts Next's `req`/`res` pair into a standard `Request`/`Response` internally, so AsiJS features (cookies, redirects, status codes) keep working with Next's API.

## Options

Both handlers accept an optional options object:

```typescript
interface NextAdapterOptions {
  /** Base path prefix to strip from incoming requests */
  basePath?: string;
  /** Enable verbose request/error logging */
  verbose?: boolean;
  /** Custom error handler — return a Response instead of the default 500 */
  onError?: (error: Error) => Response;
}
```

### basePath

Strips a prefix before AsiJS matches the route. This is useful when the catch-all file lives at a path that already encodes part of the route:

```typescript
// File at app/api/[[...asi]]/route.ts — routes defined WITHOUT the /api prefix
const app = new Asi();
app.get("/hello", () => "Hello");

export const { GET } = createNextHandler(app, { basePath: "/api" });
```

### onError

```typescript
const app = new Asi();

export const { GET } = createNextHandler(app, {
  onError: (error) =>
    Response.json(
      { error: "Something went wrong", detail: error.message },
      { status: 500 },
    ),
});
```

## Session & cookies

Next's request carries a `cookies` map and the response can set cookies through AsiJS's `ctx.cookie()` — the adapter passes both through:

```typescript
app.get("/api/login", (ctx) => {
  ctx.cookie("token", "abc123", { httpOnly: true, maxAge: 3600 });
  return { ok: true };
});
```

## Performance notes

1. **Define routes once at module scope.** The `Asi` instance and its route table are built at import time; creating a new `Asi()` inside a handler rebuilds the router on every request.
2. **Compile before exporting** (optional): `app.compile()` pre-compiles static routes for the fastest path.
3. **Revalidation-friendly.** Because each request is a fresh `Request`, standard Next.js caching headers (`Cache-Control`) set via `ctx.setHeader()` are respected by Next's CDN layer.

## TypeScript

`createNextHandler` returns a typed object — the exported handlers match Next's `RouteContext`-compatible signature. In Next 15, route handlers expect `(request: NextRequest, context)`; the adapter's returned functions accept a `Request`-compatible value and are assignable in both App Router and Pages Router setups.

If your `tsconfig` complains about the `route.ts` signature, ensure `asijs` and `asijs-next` resolve to the same TypeScript `Request` (i.e. `"types": ["bun-types"]` or the DOM lib is consistent across the project).
