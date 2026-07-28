# asijs-sveltekit — SvelteKit adapter for AsiJS

Run your AsiJS application as [SvelteKit](https://kit.svelte.dev) server hooks and API endpoints.

## Installation

```bash
bun add asijs-sveltekit
```

> Requires `asijs` and `@sveltejs/kit` as peer dependencies.

## Usage

### Server Hook (`src/hooks.server.ts`)

Intercept all requests and route matching paths through AsiJS:

```ts
import { Asi } from "asijs";
import { createSvelteKitHook } from "asijs-sveltekit";

const app = new Asi();
app.get("/api/hello", () => ({ message: "Hello from AsiJS + SvelteKit!" }));
app.get("/api/users/:id", (ctx) => ({ id: ctx.params.id }));
app.post("/api/data", async (ctx) => {
  const body = await ctx.json();
  return { received: body };
});

export const handle = createSvelteKitHook(app, { basePath: "/api" });
```

### API Endpoint (`src/routes/api/[...asi]/+server.ts`)

```ts
import { Asi } from "asijs";
import { createUniversalHandler } from "asijs-sveltekit";

const app = new Asi();
app.get("/api/hello", () => "Hello!");

export const GET = createUniversalHandler(app);
export const POST = createUniversalHandler(app);
```

### Method-specific endpoint

```ts
import { createServerHandler } from "asijs-sveltekit";

export const GET = createServerHandler(app, "GET");  // Only GET — 405 for others
export const POST = createServerHandler(app, "POST");
```

## API

| Export | Description |
|--------|-------------|
| `createSvelteKitHook(app, opts?)` | `handle` hook — AsiJS handles API routes, rest passes through |
| `createServerHandler(app, method, opts?)` | Method-specific handler (returns 405 for others) |
| `createUniversalHandler(app, opts?)` | Handles all HTTP methods on the same endpoint |
| `sveltekitPlugin(app, opts?)` | AsiJS plugin for SvelteKit |

### Options

```ts
interface SvelteKitAdapterOptions {
  basePath?: string;   // Path prefix filter (default: "/api")
  verbose?: boolean;    // Enable request logging
  onError?: (error: Error) => Response;
}
```

## How it works

The `handle` hook intercepts every request. If the URL starts with `basePath` (default `/api`), it routes through AsiJS. If AsiJS returns a route, the response is returned directly. If AsiJS returns 404 (unknown route), the request falls through to SvelteKit's normal resolver — so your existing SvelteKit routes are unaffected.

## License

MIT
