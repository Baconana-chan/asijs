# @asijs/astro — Astro adapter for AsiJS

Run your AsiJS application as [Astro](https://astro.build) server endpoints and API routes.

## Installation

```bash
bun add @asijs/astro
```

> Requires `asijs` and `astro` as peer dependencies.

## Usage

### Server Endpoint (`src/pages/api/[...asi].ts`)

```ts
import type { APIRoute } from "astro";
import { Asi } from "asijs";
import { createAstroHandler } from "@asijs/astro";

const app = new Asi();
app.get("/api/hello", () => ({ message: "Hello from AsiJS + Astro!" }));
app.post("/api/data", async (ctx) => {
  const body = await ctx.json();
  return { received: body };
});

export const GET: APIRoute = createAstroHandler(app);
export const POST: APIRoute = createAstroHandler(app);
```

### Method-specific endpoint

```ts
import { createEndpoint } from "@asijs/astro";

// Only handle GET requests — returns 405 for other methods
export const GET = createEndpoint(app, "GET");
```

### Middleware (`src/middleware.ts`)

```ts
import { createAstroMiddleware } from "@asijs/astro";
import { Asi } from "asijs";

const app = new Asi();
app.get("/api/hello", () => "Hello!");

export const onRequest = createAstroMiddleware(app);
```

## API

| Export | Description |
|--------|-------------|
| `createAstroHandler(app, opts?)` | Astro endpoint handler — handles all methods |
| `createEndpoint(app, method, opts?)` | Method-specific handler (returns 405 for others) |
| `createAstroMiddleware(app, opts?)` | Astro middleware integration |
| `astroPlugin(app, opts?)` | AsiJS plugin for Astro |

### Options

```ts
interface AstroAdapterOptions {
  basePath?: string;   // Strip path prefix (default: "/api")
  verbose?: boolean;    // Enable request logging
  onError?: (error: Error) => Response;
}
```

## License

MIT
