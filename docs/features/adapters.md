# Framework Adapters

AsiJS provides adapters for popular meta-frameworks, allowing you to use AsiJS routing within Next.js, Astro, Remix, and SvelteKit projects.

## Available Adapters

| Adapter | Package | Framework | Integration Point |
|---------|---------|-----------|-------------------|
| Next.js | [`@asijs/next`](/api-reference#next) | Next.js 14+ / 15+ | App Router (`route.ts`), Pages Router (`pages/api`) |
| Astro | [`@asijs/astro`](/api-reference#astro) | Astro 4+ / 5+ | Server endpoints (`pages/`), Middleware (`onRequest`) |
| Remix | [`@asijs/remix`](/api-reference#remix) | Remix 2+ | Resource routes (loaders/actions) |
| SvelteKit | [`@asijs/sveltekit`](/api-reference#sveltekit) | SvelteKit 2+ | Server hooks (`hooks.server.ts`), API routes (`+server.ts`) |

## Installation

```bash
# Next.js
bun add @asijs/next

# Astro
bun add @asijs/astro

# Remix
bun add @asijs/remix

# SvelteKit
bun add @asijs/sveltekit
```

## Usage

### Next.js — App Router (`app/api/[[...asi]]/route.ts`)

```typescript
import { Asi } from "asijs";
import { createNextHandler } from "@asijs/next";

const app = new Asi();

app.get("/api/hello", () => ({ message: "Hello from AsiJS!" }));
app.post("/api/data", async (ctx) => {
  const body = await ctx.json();
  return { received: body };
});

export const { GET, POST, PUT, DELETE, PATCH } = createNextHandler(app, {
  basePath: "/api", // Optional: strip prefix
  verbose: true,    // Optional: enable logging
});
```

### Next.js — Pages Router (`pages/api/[[...asi]].ts`)

```typescript
import { Asi } from "asijs";
import { createPagesHandler } from "@asijs/next";

const app = new Asi();
app.get("/api/hello", () => "Hello!");

export default createPagesHandler(app);
```

### Astro — Server Endpoint (`src/pages/api/[...asi].ts`)

```typescript
import { Asi } from "asijs";
import { createAstroHandler } from "@asijs/astro";

const app = new Asi();
app.get("/api/hello", () => "Hello from AsiJS + Astro!");

export const all = createAstroHandler(app, { basePath: "/api" });
```

### Astro — Single Endpoint (`src/pages/api/hello.ts`)

```typescript
import { Asi } from "asijs";
import { createEndpoint } from "@asijs/astro";

const app = new Asi();
app.get("/api/hello", () => "Hello!");

export const GET = createEndpoint(app, "GET");
```

### Astro — Middleware (`src/middleware.ts`)

```typescript
import { Asi } from "asijs";
import { createAstroMiddleware } from "@asijs/astro";

const app = new Asi();
app.get("/api/*", (ctx) => ctx.json({ message: "Hello!" }));

export const onRequest = createAstroMiddleware(app, { basePath: "/api" });
```

### Remix — Resource Route (`app/routes/api.$.tsx`)

```typescript
import { Asi } from "asijs";
import { createRemixHandler } from "@asijs/remix";

const app = new Asi();
app.get("/api/hello", () => "Hello from AsiJS + Remix!");

export const { loader, action } = createRemixHandler(app, {
  basePath: "/api",
});
```

### Remix — Single Endpoint (`app/routes/api.hello.ts`)

```typescript
import { Asi } from "asijs";
import { createLoader, createAction } from "@asijs/remix";

const app = new Asi();
app.get("/api/hello", () => "Hello!");
app.post("/api/hello", async (ctx) => {
  const body = await ctx.json();
  return { success: true, ...body };
});

export const loader = createLoader(app);
export const action = createAction(app);
```

### SvelteKit — Server Hook (`src/hooks.server.ts`)

```typescript
import { Asi } from "asijs";
import { createSvelteKitHook } from "@asijs/sveltekit";

const app = new Asi();
app.get("/api/hello", () => "Hello from AsiJS + SvelteKit!");

export const handle = createSvelteKitHook(app, { basePath: "/api" });
```

### SvelteKit — API Route (`src/routes/api/[...asi]/+server.ts`)

```typescript
import { Asi } from "asijs";
import { createServerHandler } from "@asijs/sveltekit";

const app = new Asi();
app.get("/api/hello", () => ({ message: "Hello!" }));
app.post("/api/data", async (ctx) => {
  const body = await ctx.json();
  return { received: body };
});

export const GET = createServerHandler(app, "GET");
export const POST = createServerHandler(app, "POST");
```

## Shared Options

All adapters accept an optional options object:

```typescript
interface AdapterOptions {
  /** Base path to strip from incoming requests */
  basePath?: string;
  /** Enable verbose request/error logging */
  verbose?: boolean;
  /** Custom error handler for uncaught errors */
  onError?: (error: Error) => Response;
}
```

## Best Practices

1. **Create the AsiJS app once** — Define your `Asi` instance at module level (outside handler functions) to avoid re-creating the route table on every request.

2. **Use basePath** — Match your adapter's `basePath` to the framework's route prefix to ensure correct path stripping.

3. **Error handling** — Provide an `onError` callback for custom error responses. Without it, errors return a generic 500 JSON response.

4. **Performance** — AsiJS route compilation happens once at module load time. For optimal performance, ensure your routes are defined statically.

5. **CORS** — Use AsiJS's built-in `cors()` plugin for cross-origin support:

```typescript
import { Asi, cors } from "asijs";

const app = new Asi();
app.plugin(cors({
  origin: "https://your-app.com",
  methods: ["GET", "POST"],
}));
```

## Architecture

Each adapter works by converting the framework's request format into a standard `Request` object, passing it through AsiJS's `app.handle()`, and converting the `Response` back to the framework's format.

```
Framework Request  →  Adapter  →  AsiJS app.handle()  →  Adapter  →  Framework Response
```

This means **all AsiJS features work inside any framework**: validation, middleware, plugins, WebSocket (via separate routes), etc.
