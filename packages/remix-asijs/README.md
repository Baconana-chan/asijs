# asijs-remix — Remix adapter for AsiJS

Run your AsiJS application as [Remix](https://remix.run) loaders, actions, and resource routes.

## Installation

```bash
bun add asijs-remix
```

> Requires `asijs` and `@remix-run/node` as peer dependencies.

## Usage

### Resource Route (`app/routes/api.$.tsx`)

```ts
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { Asi } from "asijs";
import { createRemixHandler } from "asijs-remix";

const app = new Asi();
app.get("/api/hello", () => ({ message: "Hello from AsiJS + Remix!" }));
app.get("/api/users/:id", (ctx) => ({ id: ctx.params.id }));
app.post("/api/data", async (ctx) => {
  const body = await ctx.json();
  return { received: body };
});

export const { loader, action } = createRemixHandler(app);
```

### Separate loader/action

```ts
import { createLoader, createAction } from "asijs-remix";

// Only handles GET — other methods return 405
export const loader = createLoader(app);
export const action = createAction(app);
```

### Resource route with base path

```ts
export const { loader, action } = createRemixHandler(app, {
  basePath: "/api",
});
```

## API

| Export | Description |
|--------|-------------|
| `createRemixHandler(app, opts?)` | Returns `{ loader, action }` for resource routes |
| `createLoader(app, opts?)` | Loader-only handler (GET) |
| `createAction(app, opts?)` | Action-only handler (POST/PUT/DELETE) |
| `remixPlugin(path?, opts?)` | AsiJS plugin for Remix |

### Options

```ts
interface RemixAdapterOptions {
  basePath?: string;   // Strip path prefix (default: "/api")
  verbose?: boolean;    // Enable request logging
  onError?: (error: Error) => Response;
}
```

## License

MIT
