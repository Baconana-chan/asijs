# asijs-react — React Server Components for AsiJS

A complete **React 19 RSC pipeline** on AsiJS: server components render on
the server, client components hydrate in the browser, and navigation happens
over the streaming **Flight protocol** — no separate Next.js required.

- Package: `asijs-react`
- Status: **released**
- Source: `packages/asijs-react/`

## Why

React Server Components let you render components once on the server, stream
them to the client, and keep interactivity via client components — without
shipping the whole server tree as JS. AsiJS is the Bun-first runtime; this
package is the RSC layer on top:

- **Streaming SSR** — the initial HTML streams from `react-dom/server`
- **Flight protocol** — client-side navigation fetches `text/x-component`
  payloads instead of re-rendering HTML
- **Server/client boundaries** — `"use client"` convention + module map
- **One runtime** — AsiJS routes, plugins, validation and middleware all keep
  working; RSC is just another handler

## Installation

```bash
bun add asijs-react react react-dom react-server-dom-webpack
```

> Requires React 19+ (`react`, `react-dom`, `react-server-dom-webpack`) and
> `asijs`. All are **optional peers**: the package imports nothing at load
> time and answers with a descriptive install hint when react is missing.

## Quick Start

```ts
import { Asi } from "asijs";
import { createRscPlugin } from "asijs-react";

const app = new Asi();
app.plugin(createRscPlugin({ root: <App/>, title: "My App" }));
app.listen(3000);
```

The plugin registers three routes on one app:

| Route | Purpose |
|-------|---------|
| `/` | HTML document — **streaming SSR** of the server component tree + bootstrap script |
| `/__rsc` | **Flight payload** (`text/x-component`) for client-side navigation |
| `/__rsc/client.js` | Client bootstrap module (fetches the Flight payload, hydrates) |

The bootstrap sends an `RSC: 1` header, so `GET /` with that header answers
with Flight instead of HTML — standard RSC negotiation, used for client-side
transitions. (Disable with `rscHeader: false`.)

## How it works

`createRscPlugin` registers the three routes; each forwards `ctx.request` to
the shared RSC handler and returns its `Response` (AsiJS supports returning
`Response` objects from handlers natively, so status/headers/streaming bodies
pass through untouched).

The HTML shell:

```html
<!doctype html><html><head>
  <meta charset="utf-8"/>
  <title>My App</title>
</head><body><div id="__asijs_rsc_root">
  <!-- streaming SSR output -->
</div>
<script type="module" src="/__rsc/client.js" crossorigin></script>
<script>window.__ASIJS_RSC__={"url":"/__rsc","htmlPath":"/"}</script>
</body></html>
```

The client bootstrap imports `react-server-dom-webpack/client.browser`
(`createFromFetch`) and `react-dom/client` (`hydrateRoot`), fetches the Flight
payload with the `RSC: 1` header, decodes it and hydrates the SSR'd root.

### Streaming

Both `react-dom/server` (`renderToReadableStream`) and the Flight renderer
yield web `ReadableStream`s — the shell chains a prefix (`<head>`… root div),
the SSR stream, and a suffix (scripts, config) into one push-based stream.
The push model is deliberate: the async-`pull` variant deadlocks with Bun's
`Response.text()`/`arrayBuffer()` when the inner read is awaited.

## Server / client boundaries

Components that use hooks/state must be marked **client** components with the
`"use client"` directive.

### Bundler-free: `moduleRef`

```tsx
// src/server/App.tsx — server component
import { moduleRef } from "asijs-react";

const Counter = moduleRef("/client/Counter.tsx", "default");

export default function App() {
  return (
    <main>
      <h1>Hello from the server</h1>
      <Counter />
    </main>
  );
}
```

`moduleRef` registers a real client reference via
`react-server-dom-webpack/server.node` when installed; otherwise it returns a
plain tagged object so server-only renders don't crash.

### Bundler pipeline: module map

```ts
import { buildClientManifest, isClientModule, scanExports } from "asijs-react";

const source = await Bun.file("src/client/Counter.tsx").text();
const manifest = buildClientManifest([
  { id: "/client/Counter.tsx", path: "src/client/Counter.tsx", source },
  // ...
]);
// → { "/client/Counter.tsx": { default: { id, chunks: [], name: "default", async: true }, ... } }
```

Only modules whose source starts with `"use client"` are included; every
detected export gets a reference record (plus `default`).

## API

| Export | Description |
|--------|-------------|
| `createRscPlugin(opts)` | AsiJS plugin mounting `/`, `/__rsc`, `/__rsc/client.js` |
| `createRSCHandler(opts)` | Plain `(request) => Response` handler (custom wiring / `app.get`) |
| `createDefaultRenderer(runtime?)` | Renderer over lazy react bindings (Flight + HTML) |
| `moduleRef(id, name?)` | Client reference proxy for a `"use client"` module |
| `buildClientManifest(entries)` | Flight module map from `"use client"` sources |
| `isClientModule(source)` | `"use client"` directive detection |
| `scanExports(source)` | Export-name scanner for manifest building |
| `buildClientBundle(opts)` | Production client bundle via `Bun.build` (react client inlined) |
| `buildServerBundle(opts)` | SSR server bundle via `Bun.build` |
| `loadRuntime()` | Lazy react bindings (throws descriptive error when missing) |
| `CLIENT_BOOTSTRAP_SOURCE` | The embedded bootstrap script (served at `clientPath`) |

### Options (`RscOptions`)

| Option | Default | Description |
|--------|---------|-------------|
| `root` | — | Server component element or `() => element` render function |
| `client` | `{}` | Flight module map |
| `htmlPath` | `"/"` | HTML shell route |
| `rscPath` | `"/__rsc"` | Flight payload route |
| `clientPath` | `"/__rsc/client.js"` | Client bootstrap route |
| `rscHeader` | `true` | Honor `RSC: 1` on `htmlPath` |
| `clientSource` | embedded | Custom bootstrap source |
| `scripts` / `styles` | `[]` | Extra scripts / stylesheets in the shell |
| `head` | `""` | Extra raw `<meta>`/tags for the shell head |
| `title` | `"AsiJS + React"` | Document title |
| `headers` | `{}` | Extra response headers for the HTML shell |
| `onError` | 500 JSON | Custom error handler |
| `verbose` | `false` | Request logging |

## Production build

```ts
import { buildClientBundle, buildServerBundle } from "asijs-react";

await buildClientBundle({ outDir: "dist", outFile: "client.js" }); // → dist/client.js
await buildServerBundle({ entry: "src/server.tsx", outDir: "dist" }); // → dist/server.js
```

`buildClientBundle` bundles the bootstrap with `react-dom/client` and
`react-server-dom-webpack/client.browser` into one file — serve it statically
and point `clientPath` at it. `buildServerBundle` bundles the SSR server
entry for deployment (react packages left external).

## Manual wiring (no plugin)

```ts
import { Asi } from "asijs";
import { createRSCHandler } from "asijs-react";

const handler = createRSCHandler({ root: <App/>, title: "My App" });

const app = new Asi();
app.get("/", (ctx) => handler(ctx.request));
app.get("/__rsc", (ctx) => handler(ctx.request));
app.get("/__rsc/client.js", (ctx) => handler(ctx.request));
app.listen(3000);
```

## Development

```bash
cd packages/asijs-react
npm install
npm run typecheck  # tsc --noEmit
npm test           # bun test (24 tests)
npm run build      # bun build → dist/
```

The test suite runs **without react installed**: routing, streaming, header
negotiation, module-map building and degradation paths are exercised with an
injected renderer; the missing-react paths assert the descriptive error.

## Roadmap (TODO.md 3.7)

- [x] RSC rendering pipeline on AsiJS — `createRSCHandler` (HTML shell + Flight + client bootstrap)
- [x] Server/client component boundaries — `"use client"` + `moduleRef` + `buildClientManifest`
- [x] Streaming SSR + hydration — push-based stream chain, `hydrateRoot` bootstrap
- [x] `createRSCHandler()` — adapter for React 19 RSC (plain handler + AsiJS plugin)

**Known limitations**: client-side navigation with real `"use client"`
transitions needs a bundler that wires `react-server-dom-webpack` (Vite 8 /
Rolldown — see `asijs-vite`); this package provides the server pipeline, the
module map and the production client bundle, but not a full app-router.
