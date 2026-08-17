# asijs-react — React Server Components for AsiJS

A complete React 19 **RSC pipeline** on AsiJS: server components render on the
server, client components hydrate in the browser, and navigation happens over
the streaming **Flight protocol** — no separate Next.js required.

```bash
bun add asijs-react react react-dom react-server-dom-webpack
```

> Requires React 19+ (`react`, `react-dom`, `react-server-dom-webpack`) and
> `asijs`. All are **optional peers**: the package imports nothing at load
> time and gives a descriptive install hint when react is missing.

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
transitions.

## Server / client boundaries

Components that use hooks/state must be marked **client** components with the
`"use client"` directive. In a bundler-free setup, reference them with
`moduleRef`:

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

With a bundler pipeline, derive the Flight module map from source:

```ts
import { buildClientManifest, isClientModule } from "asijs-react";

const manifest = buildClientManifest([
  { id: "/client/Counter.tsx", path: "src/client/Counter.tsx", source },
  // ...
]);
// → { "/client/Counter.tsx": { default: { id, chunks: [], name: "default", async: true }, ... } }
```

## API

| Export | Description |
|--------|-------------|
| `createRscPlugin(opts)` | AsiJS plugin mounting `/`, `/__rsc`, `/__rsc/client.js` |
| `createRSCHandler(opts)` | Plain `(request) => Response` handler (custom wiring / `app.get`) |
| `moduleRef(id, name?)` | Client reference proxy for a `"use client"` module |
| `buildClientManifest(entries)` | Flight module map from `"use client"` sources |
| `isClientModule(source)` | `"use client"` directive detection |
| `scanExports(source)` | Export-name scanner for manifest building |
| `buildClientBundle(opts)` | Production client bundle via `Bun.build` (react client inlined) |
| `buildServerBundle(opts)` | SSR server bundle via `Bun.build` |
| `loadRuntime()` | Lazy react bindings (throws descriptive error when missing) |

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
| `title` | `"AsiJS + React"` | Document title |
| `onError` | 500 JSON | Custom error handler |

## Production build

```ts
import { buildClientBundle, buildServerBundle } from "asijs-react";

await buildClientBundle({ outDir: "dist", outFile: "client.js" }); // → dist/client.js
await buildServerBundle({ entry: "src/server.tsx", outDir: "dist" }); // → dist/server.js
```

`buildClientBundle` bundles the bootstrap with `react-dom/client` and
`react-server-dom-webpack/client.browser` into one file; serve it statically
and point `clientPath` at it.

## Development

```bash
cd packages/asijs-react
npm install
npm run typecheck  # tsc --noEmit
npm test           # bun test (24 tests)
npm run build      # bun build → dist/
```

## License

MIT
