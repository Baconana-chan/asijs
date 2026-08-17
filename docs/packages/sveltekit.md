# asijs-sveltekit — SvelteKit Adapter

Use AsiJS routing inside SvelteKit. Two integration points: a `handle` hook that intercepts API requests (everything else falls through to SvelteKit), and per-method `+server.ts` handlers.

- Package: `asijs-sveltekit`
- Requires: `asijs` (peer dependency)
- Supports: SvelteKit 2+

## Installation

```bash
bun add asijs-sveltekit
```

## 1. Server hook (`handle`)

```typescript
// src/hooks.server.ts
import { Asi } from "asijs";
import { createSvelteKitHook } from "asijs-sveltekit";

const app = new Asi();
app.get("/api/hello", () => "Hello from AsiJS + SvelteKit!");

export const handle = createSvelteKitHook(app, { basePath: "/api" });
```

The hook intercepts requests whose path starts with the `basePath` and routes them through AsiJS. **Everything else is passed through to SvelteKit's `resolve()`** — pages, endpoints, static assets keep working normally.

## 2. Per-method server route

```typescript
// src/routes/api/[...asi]/+server.ts
import { Asi } from "asijs";
import { createServerHandler } from "asijs-sveltekit";

const app = new Asi();
app.get("/api/hello", () => ({ message: "Hello!" }));
app.post("/api/data", async (ctx) => {
  const body = await ctx.json();
  return { received: body };
});

export const GET = createServerHandler(app, "GET");
export const POST = createServerHandler(app, "POST");
```

`createServerHandler(app, method)` returns a handler for exactly one verb and responds **405 Method Not Allowed** when the incoming method doesn't match.

## 3. Universal handler

```typescript
// src/routes/api/[...asi]/+server.ts
import { Asi } from "asijs";
import { createUniversalHandler } from "asijs-sveltekit";

const app = new Asi();

export const GET = createUniversalHandler(app);
export const POST = createUniversalHandler(app);
export const PUT = createUniversalHandler(app);
```

`createUniversalHandler` handles all HTTP methods with a single function — use it when the file shouldn't enforce per-method 405s (the AsiJS router itself returns 405/404 semantics).

## Options

```typescript
interface SvelteKitAdapterOptions {
  /** Base path prefix for API routes */
  basePath?: string;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Custom error handler */
  onError?: (error: Error) => Response;
}
```

## SvelteKit context integration

| SvelteKit feature | AsiJS equivalent |
|---|---|
| `event.locals` | `ctx.locals` — shared data object, same reference |
| `event.cookies` | `ctx.cookie(...)` / `ctx.cookies` |
| `event.platform` | `ctx.platform` |
| `event.clientAddress` | passed through for `trustProxy` / logging |
| `event.url` | `ctx.url` (original URL preserved) |

Because the adapter passes `event.locals` by reference, data written by AsiJS middleware is visible to later SvelteKit code (and vice versa) within the same request.

## Streaming & SSE

SvelteKit `handle` hooks may return a `Response` — AsiJS's `ctx.stream()`, `ctx.sse()`, and `ctx.eventStream()` work unchanged:

```typescript
app.get("/api/events", (ctx) =>
  ctx.sse((send) => {
    const t = setInterval(() => send({ data: JSON.stringify({ at: Date.now() }) }), 1000);
    return () => clearInterval(t);
  }),
);
```

## Performance notes

1. Module-scope `Asi` instance — the route table builds once, not per request.
2. `basePath` matching is a string prefix check — keep it exact (`/api` not `/api/`) to avoid double-slash paths.
3. For heavy APIs, register the catch-all `+server.ts` with `createUniversalHandler` and let AsiJS do the routing — one file, all verbs, no per-file boilerplate.
