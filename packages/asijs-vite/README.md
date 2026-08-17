# asijs-vite — Vite 8 / Rolldown dev server for AsiJS

Run an **AsiJS backend** and a **Vite frontend** on a single port. AsiJS handles API routes, Vite handles the frontend (HMR, transforms) — no proxy juggling, no two terminals.

## Installation

```bash
bun add asijs-vite
```

> Requires `asijs` and `vite` (>= 5; 8 / Rolldown supported) as peer dependencies.

## Quick Start

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { Asi } from "asijs";
import { createVitePlugin } from "asijs-vite";

const app = new Asi();
app.get("/api/hello", () => ({ message: "Hello from AsiJS!" }));

export default defineConfig({
  plugins: [createVitePlugin(app, { apiPrefix: "/api", hmrBridge: true })],
});
```

```bash
bun run dev   # Vite serves the frontend on 5173, /api/* goes to AsiJS
```

Or scaffold a full starter:

```bash
bunx asijs create my-app -t vite-app
```

## API

| Export | Description |
|--------|-------------|
| `createVitePlugin(app, opts?)` | Vite plugin: wires the AsiJS middleware into `configureServer` / `configurePreviewServer`. |
| `createViteHandler(app, opts?)` | Plain `(request) => Response` handler (Vite middleware mode / custom wiring). |
| `createViteMiddleware(app, opts?)` | Connect-style middleware for `server.middlewares.use(...)` when wiring manually. |
| `attachHmrBridge(server, app, opts?)` | Forward AsiJS hot-reload events to Vite's WebSocket (`full-reload`). |
| `ssrBuild(opts)` | SSR bundle via **Rolldown** (Vite 8's bundler) when installed, falling back to `Bun.build`. |

### Options (`AsijsViteOptions`)

| Option | Default | Description |
|--------|---------|-------------|
| `apiPrefix` | `"/api"` | Path prefix(es) routed to AsiJS; everything else falls through to Vite. |
| `stripPrefix` | `false` | Strip the prefix before handing the request to AsiJS. |
| `hmrBridge` | `false` | Watch AsiJS source and send `full-reload` to Vite clients on backend changes. |
| `watchDirs` | `["src"]` | Directories watched by the HMR bridge. |
| `verbose` | `false` | Request / error logging. |
| `onError` | 500 JSON | Custom error handler. |

### `ssrBuild`

```ts
import { ssrBuild } from "asijs-vite";

const res = await ssrBuild({
  entry: "src/ssr.tsx",
  outDir: "dist-ssr",
  outFile: "index.js",
});
if (res.ok) console.log("SSR bundle at", res.outputPath, "via", res.engine);
```

Uses **Rolldown** (the bundler behind Vite 8) when it is installed, and falls
back to `Bun.build` otherwise — `res.engine` reports which one ran.

## How it works

`createVitePlugin` registers a Connect middleware at the **front** of Vite's
middleware stack. Requests whose pathname matches `apiPrefix` are converted
to a standard `Request` and passed to `app.handle()`; the `Response` is
written back to the Node-style `res`. Everything else flows through to Vite's
own middleware (HTML, modules, assets, HMR).

With `hmrBridge: true`, the plugin starts an AsiJS `HotReloader` over your
source dir and pushes `{ type: "full-reload" }` to Vite's WebSocket when
backend handlers/routes change — the browser reloads without a manual refresh.

## License

MIT
