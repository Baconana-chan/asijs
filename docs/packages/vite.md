# asijs-vite — Vite 8 / Rolldown dev server for AsiJS

Run an **AsiJS backend** and a **Vite frontend** on a **single port**. AsiJS handles API routes, Vite handles the frontend (HMR, transforms) — no proxy juggling, no two terminals.

- Package: `asijs-vite`
- Status: **released**
- Source: `packages/asijs-vite/`

## Why

| Approach | Problem |
|---|---|
| Two servers + proxy | Two terminals, CORS, proxy config drift |
| `asi dev` only | Can't serve a Vite frontend with HMR |
| Vite-only | No AsiJS backend (validation, plugins, OpenAPI, WebSocket) |

`asijs-vite` merges both: one `vite dev` process serves the SPA and the API.

## Installation

```bash
bun add asijs-vite
```

> Requires `asijs` and `vite` (>= 5; Vite 8 / Rolldown supported) as peer dependencies.

## Quick Start

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { Asi } from "asijs";
import { createVitePlugin } from "asijs-vite";

const app = new Asi();
app.get("/api/hello", () => ({ message: "Hello from AsiJS!" }));
app.get("/api/time", () => ({ time: new Date().toISOString() }));

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

The `vite-app` template ships `vite.config.ts`, an `index.html`, a small
frontend entry, and `src/main.ts` with the AsiJS app (`/api/hello`,
`/api/time`).

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
| `apiPrefix` | `"/api"` | Path prefix(es) routed to AsiJS; everything else falls through to Vite. Use an array (`["/api", "/__dev"]`) to also expose AsiJS dev routes (dashboard, OpenAPI, playground). |
| `stripPrefix` | `false` | Strip the prefix before handing the request to AsiJS (`/api/users` → `/users`). |
| `hmrBridge` | `false` | Watch AsiJS source and send `full-reload` to Vite clients on backend changes. |
| `watchDirs` | `["src"]` | Directories watched by the HMR bridge. |
| `verbose` | `false` | Request / error logging. |
| `onError` | 500 JSON | Custom error handler. |

## How it works

`createVitePlugin` registers a Connect middleware at the **front** of Vite's
middleware stack. Requests whose pathname matches `apiPrefix` are converted
to a standard `Request` and passed to `app.handle()`; the `Response` is
written back to the Node-style `res`. Everything else flows through to Vite's
own middleware (HTML, modules, assets, HMR).

The request conversion is a plain `Request` (method, headers, buffered body,
query string preserved) — so every AsiJS feature works unchanged inside Vite:
validation, middleware, plugins, error pages, rate limiting.

### HMR bridge

With `hmrBridge: true`, the plugin starts an AsiJS `HotReloader` over your
source dir. When a backend handler or route changes, it pushes
`{ type: "full-reload" }` to Vite's WebSocket — the browser reloads without a
manual refresh. The bridge uses AsiJS's own `HotReloader` (injected via
`options.hotReloader` or imported from `asijs`); if neither is available it
logs a warning and becomes a no-op.

### SSR build

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

| Option | Default | Description |
|--------|---------|-------------|
| `entry` | — | Entry file (SSR server bundle, e.g. `src/ssr.tsx`). |
| `outDir` | `"dist-ssr"` | Output directory. |
| `outFile` | `"index.js"` | Output file name. |
| `external` | `["asijs", "vite"]` | Packages left as imports. |
| `forceBun` | `false` | Force `Bun.build` even when Rolldown is installed. |
| `minify` | `false` | Minify output. |

## Manual wiring (no plugin)

```ts
import { createVite } from "vite";
import { Asi } from "asijs";
import { createViteMiddleware } from "asijs-vite";

const app = new Asi();
app.get("/api/ping", () => ({ pong: true }));

const server = await createVite({ server: { middlewareMode: true } });
server.middlewares.use(createViteMiddleware(app));
await server.listen();
```

## Development

```bash
cd packages/asijs-vite
npm install        # pulls asijs from the repo root (file:../..)
npm run typecheck  # tsc --noEmit
npm test           # bun test (16 tests)
```

## Roadmap (TODO.md 3.5)

- [x] `asijs-vite` — AsiJS as dev server for Vite apps (single port, prefix routing)
- [x] **HMR bridge** — Vite HMR → AsiJS HMRServer (WebSocket)
- [x] **Rolldown integration** — AsiJS SSR bundle via Rolldown (faster than esbuild)
- [x] **Example**: `asi create vite-app` — AsiJS + Vite 8 template
