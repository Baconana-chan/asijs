# asijs-remix — Remix Adapter

Run AsiJS loaders and actions inside Remix resource routes. The adapter covers catch-all routes (`api.$`), single routes, and a session-aware variant that wires Remix's cookie session into AsiJS handlers.

- Package: `asijs-remix`
- Requires: `asijs` (peer dependency)
- Supports: Remix 2+ / React Router 7

## Installation

```bash
bun add asijs-remix
```

## 1. Catch-all resource route

```typescript
// app/routes/api.$.tsx
import { Asi } from "asijs";
import { createRemixHandler } from "asijs-remix";

const app = new Asi();
app.get("/api/hello", () => "Hello from AsiJS + Remix!");

export const { loader, action } = createRemixHandler(app, {
  basePath: "/api",
});
```

`createRemixHandler` returns both a `loader` (for GET/HEAD) and an `action` (for POST/PUT/PATCH/DELETE). Routes registered with the `/api` prefix match the resource route's URL.

## 2. Single endpoint — loader only

```typescript
// app/routes/api.hello.ts
import { Asi } from "asijs";
import { createLoader, createAction } from "asijs-remix";

const app = new Asi();
app.get("/api/hello", () => "Hello!");
app.post("/api/hello", async (ctx) => {
  const body = await ctx.json();
  return { success: true, ...body };
});

export const loader = createLoader(app);
export const action = createAction(app);
```

Use `createLoader` / `createAction` when the file owns a single route and you want the exports to be explicit.

## 3. Session-aware handler

Remix loads and commits cookie sessions per-request. `createSessionHandler` bridges that into AsiJS:

```typescript
import { Asi } from "asijs";
import { createSessionHandler } from "asijs-remix";
import { createCookieSessionStorage } from "@remix-run/node";

const { getSession, commitSession, destroySession } =
  createCookieSessionStorage({ cookie: { name: "__session" } });

const app = new Asi();

// ctx.session is available inside handlers
app.get("/api/me", (ctx) => ({ user: ctx.session?.user ?? null }));
app.post("/api/login", async (ctx) => {
  ctx.session = { user: await ctx.json() };
  return { ok: true };
});

export const { loader, action } = createSessionHandler(app, {
  sessionKey: "session",              // key on the Remix session
  getSession: (request) => getSession(request.headers.get("Cookie")),
  commitSession: (session) => commitSession(session),
  destroySession: (request) => destroySession(request.headers.get("Cookie")),
});
```

How it works: the loader loads the Remix session and exposes it as `ctx.session`; after an action, the session is committed and written back as a `Set-Cookie` header on the response.

## Options

```typescript
interface RemixAdapterOptions {
  /** Base path prefix to strip from incoming requests */
  basePath?: string;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Custom error handler */
  onError?: (error: Error) => Response;
}
```

## Headers & cookies

Remix handlers can return headers through AsiJS helpers:

```typescript
app.get("/api/cache-me", (ctx) => {
  ctx.setHeader("Cache-Control", "public, max-age=60");
  return { data: "cached" };
});
```

Remix's `json()` helper isn't required — returning a plain object or a `Response` from the AsiJS handler works, and the adapter converts it to Remix's expected format.

## TypeScript notes

- `createRemixHandler` returns `{ loader: LoaderFunction; action: ActionFunction }` — assignable directly to Remix's `export const loader` / `export const action`.
- Remix's `args.context` (from `getLoadContext`) is passed through to `ctx` — data set in the Remix context loader is visible in AsiJS handlers as `ctx.locals`.
