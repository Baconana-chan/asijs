# asijs-next — Next.js adapter for AsiJS

Run your AsiJS application as [Next.js](https://nextjs.org) API routes — supports both App Router (`route.ts`) and Pages Router (`pages/api`).

## Installation

```bash
bun add asijs-next
```

> Requires `asijs` and `next` as peer dependencies.

## Usage

### App Router (`app/api/[[...asi]]/route.ts`)

```ts
import { Asi } from "asijs";
import { createNextHandler } from "asijs-next";

const app = new Asi();
app.get("/api/hello", () => ({ message: "Hello from AsiJS + Next.js!" }));
app.get("/api/users/:id", (ctx) => ({ id: ctx.params.id }));
app.post("/api/data", async (ctx) => {
  const body = await ctx.json();
  return { received: body };
});

export const { GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS } = createNextHandler(app);
```

### Pages Router (`pages/api/[[...asi]].ts`)

```ts
import { Asi } from "asijs";
import { createPagesHandler } from "asijs-next";

const app = new Asi();
app.get("/api/hello", () => ({ message: "Hello!" }));

export default createPagesHandler(app);
```

### Edge Runtime

```ts
import { createEdgeHandler } from "asijs-next";
// Works with Next.js Edge Runtime (runtime: 'edge')
export const runtime = "edge";
export const GET = createEdgeHandler(app, "GET");
```

## API

| Export | Description |
|--------|-------------|
| `createNextHandler(app, opts?)` | App Router — returns `{ GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS }` |
| `createPagesHandler(app, opts?)` | Pages Router — returns `(req, res) => void` |
| `createEdgeHandler(app, method, opts?)` | Edge Runtime — returns `(req) => Response` |
| `nextPlugin(app, path?, opts?)` | AsiJS plugin that registers Next.js-compatible middleware |

### Options

```ts
interface NextAdapterOptions {
  basePath?: string;  // Strip path prefix (default: "/api")
  verbose?: boolean;   // Enable request logging
  onError?: (error: Error) => Response;
}
```

## License

MIT
