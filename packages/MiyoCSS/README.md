# miyocss — SSR-first CSS + SVG framework

CSS utilities that are collected **at render time**, not by scanning files. Plus SVG as a first-class citizen. Runs on Bun + Node.js and is **framework-agnostic**: AsiJS, Hono, Elysia, Fastify, plain Node — anywhere SSR exists.

> Status: **concept / scaffold** (v0.1.0-pre). Roadmap — [`TODO.md`](./TODO.md).

## Why not Tailwind

| | Tailwind | MiyoCSS |
|---|---|---|
| CSS build | static file scan | **during `renderToString`** |
| Dynamic classes (`clsx(cond && "md:flex")`) | false negatives | ✅ only what actually rendered |
| Separate build step | yes (CLI/plugin) | **no** — on demand, optional cache to file |
| JS on the client | 0 (after build) | **0 always** |
| SVG | no | **first-class** (icons, gradients, filters, charts) |

## Installation

```bash
bun add miyocss
```

## CLI

```bash
miyocss info            # resolve config + token stats + validity check
miyocss info --json     # machine-readable output
miyocss info --config path --cwd dir
miyocss build dist              # scan HTML, write one hashed miyocss.<hash>.css
miyocss build dist --rewrite    # …and swap inline <style> tags for a <link>
miyocss build dist --out assets --name app --json
```

`info` is a quick smoke over the config: finds `miyocss.config.{ts,js,mjs,cjs,json}`, validates it with the same TypeBox schemas (invalid → errors with a path, exit 1, fallback to defaults) and prints token stats plus an approximate utility surface (on defaults — **2354 classes**).

## Usage (AsiJS adapter)

```tsx
import { Asi } from "asijs";
import { asiPlugin, html, StyleSheet } from "miyocss/asi";

const app = new Asi();
app.plugin(asiPlugin({ config })); // or: app.plugin(miyocss({ config }))

app.get("/", () =>
  html(
    <html>
      <head>
        <title>Home</title>
        <StyleSheet />
      </head>
      <body>
        <div className="flex items-center gap-4 p-6 md:p-8">
          <span className="text-lg font-bold text-blue-600">Hello</span>
        </div>
      </body>
    </html>,
  ),
);
```

`html()` renders the page, collects the utility classes actually used (tree-walk before render), generates the exact CSS and injects a `<style>` into `<head>` — or at the `<StyleSheet />` placeholder if you place one. No separate build step, zero false positives; `stream()` is the streaming variant.

The plugin also decorates the context: `ctx.miyocss` (resolved config) and `ctx.styles(classes?)` (a `<style>` tag for exact classes, or the full static catalog when called without arguments).

## Design tokens

`defineConfig()` validates the config through TypeBox (errors with a path — at startup, not in CSS runtime):

```ts
import { defineConfig } from "miyocss";

const config = defineConfig({
  theme: {
    colors: { brand: "#6d28d9" }, // replaces the palette entirely
  },
  extend: {
    theme: {
      spacing: { 18: "72px" }, // adds a step, defaults preserved
      colors: { brand: { 500: "#6d28d9", 600: "#5b21b6" } },
    },
  },
  options: { darkMode: "class", prefix: "mi-" },
});
```

Tailwind-style semantics: `theme.*` replaces a group, `extend.theme.*` deep-merges on top (including on top of your `theme`). Nested palettes flatten into `blue-500`, and a nested `DEFAULT` collapses to the parent name: `{ primary: { DEFAULT: "#6d28d9" } }` → class `primary`.

Defaults are baked in: 4px-base spacing (0–96), 18 colors × 10 shades, typography, radius, shadows, `sm–2xl` breakpoints. See the resolved config: `resolveDefaultConfig()` / `resolveConfig(config)`.

## Purge-to-file (1.2 — CDN / file-server cache)

Inline `<style>` per page is exact but doesn't cache well. Purge every used
class into **one content-hashed CSS file** — immutable on a CDN:

```ts
import { PurgeCache, purgeToFile, purgeDirectory } from "miyocss";

// accumulate across many renders
const cache = new PurgeCache(config);
// …for each page:
cache.add(collectClasses(pageTree));
// one immutable file, pruned of stale siblings
const { href } = purgeToFile(cache, { dir: "dist" }); // miyocss.a1b2c3d4e5.css
```

For static / SSG output — scan the HTML directory, share one stylesheet, and
replace inline `<style data-miyocss>` tags with a single `<link>`:

```ts
import { purgeSsg } from "miyocss/asi"; // after asi build --ssg
const { href, classes, files } = purgeSsg({ dir: "dist", config: myConfig });
```

Or from the CLI (works with any framework's HTML output):

```sh
miyocss build dist --rewrite   # → dist/miyocss.<hash>.css, inline styles → <link>
```

The content hash **is** the invalidation: the filename changes exactly when the
CSS changes, so CDNs can cache `miyocss.<hash>.css` forever.

## Utility generation

```ts
import { generateCSS, resolveConfig } from "miyocss";

const resolved = resolveConfig(); // or resolveConfig(defineConfig({ ... }))

const css = generateCSS(
  ["p-4", "bg-red-500/50", "w-1/3", "grid-cols-[200px_1fr]", "-mt-2"],
  resolved,
);
```

`generateCSS` dedupes and sorts by class name, skips unknown classes (`{ unknown: "throw" }` — throws). Classes with special characters are escaped (`w-1/3` → `w-1\/3`).

Coverage (0.3): layout, flex/grid, spacing with negatives, typography, colors with slash-opacity, borders/effects, sizing with fractions, grid-template, arbitrary values (`w-[17px]`, `bg-[#f00]`, `text-[13px]` — color vs size determined by the value).

Variants (0.4): pseudo-classes (`hover:`, `focus:`, `active:`, `focus-visible:`, `disabled:`, `placeholder:` …), breakpoints (`sm:`–`2xl:` + custom), `dark:` (`media` or `class` strategy from `options.darkMode`). Composition — `hover:md:bg-red-500` renders as `@media (min-width: 768px) { .hover\:md\:bg-red-500:hover { … } }`. `generateCSS` sorts by cascade: base → pseudo → dark → breakpoints ascending, so `md:p-4` always overrides `p-4`.

Engine extensions (1.1): `group-*` / `peer-*` variants (`group-hover:`, `peer-checked:`, …), `before:` / `after:` pseudo-elements (with `content-*` utilities), dynamic values from tokens inside arbitrary values (`w-[calc(100%_-_token(spacing.4))]`), shortcuts (`center`, `inline-center`).

### Custom utilities (`defineUtility`)

```ts
import { defineConfig, defineUtility } from "miyocss";

const config = defineConfig({
  utilities: [
    defineUtility({
      name: "brand",
      // exact class → declarations
      static: { "brand-card": { background: "#6d28d9", borderRadius: "8px" } },
      // regex matchers, first hit wins
      match: [
        {
          pattern: /^brand-padding-(.+)$/,
          apply: (m, cfg) =>
            cfg.theme.spacing[m[1]] ? { padding: String(cfg.theme.spacing[m[1]]) } : null,
        },
      ],
    }),
  ],
});

const css = generateCSS(["brand-card", "hover:brand-padding-4"], resolveConfig(config));
```

Custom utilities resolve **before** built-ins (a user `flex` overrides the built-in one — documented contract), work with all variants, and are included in `staticUtilityNames()` / `generateFullCSS()` (`collect: false`).

## SSR build (0.5 — the key feature)

```tsx
import { render, stream, resolveDefaultConfig } from "miyocss";

const config = resolveDefaultConfig();

const tree = (
  <html>
    <head><title>Demo</title></head>
    <body>
      <div className="flex items-center gap-4 p-6 hover:bg-blue-500 md:p-8">
        Hello
      </div>
    </body>
  </html>
);

const html = await render(tree, config);   // string with <style> in head
const res = stream(tree, config);          // stream with <style> in head
```

What happens:

1. **tree-walk before render** — `collectClasses()` walks the JSX tree (including synchronous components), collecting `className`/`class` from every element
2. **CSS is generated exactly from what was collected** — `generateCSS()` dedupes and sorts by cascade (base → pseudo → dark → breakpoints)
3. **`<style>` is injected into `<head>`** — for the string via post-injection before `</head>`; for the stream by buffering only up to `</head>` (the head is small, everything after streams without buffering)
4. **Zero false positives** — a conditional class (`cond && "hidden"`) lands in the CSS only if it actually rendered; `collect: false` emits the full static catalog from the config (`generateFullCSS`)

The default renderer is a lazy `import("asijs")`; for Hono/Fastify/plain Node pass your own `{ renderToString, renderToStream }` as the fourth argument (or via `SsrRenderer`).

**Known limitation:** classes inside **async components** are invisible to the tree-walk (the body is unknown until render) — the `collectClass()` escape hatch is planned for P2. Synchronous components are expanded correctly.

## Package structure

| Subpath | Contents | Status |
|---|---|---|
| `miyocss` | Core: tokens, utility generator, variants, SSR build | 🔴 scaffold |
| `miyocss/asi` | AsiJS adapter (plugin, style auto-inject) | 🔴 stub |
| `miyocss/svg` | SVG: primitives, icons, gradients, filters, charts | 🔴 stub |

## Development

```bash
cd packages/MiyoCSS
npm install        # pulls asijs from the repo root (file:../..)
npm run typecheck  # tsc --noEmit
npm test           # bun test
npm run build      # tsc → dist/
```

## Roadmap

- **P0 (v0.1)** — engine: tokens with TypeBox validation, ~150 utilities, `hover/md/dark` variants, SSR build, AsiJS adapter
- **P1 (v0.5)** — custom utilities, purge-to-file, SVG core (icons, charts), Hono/Elysia/Fastify/plain Node adapters
- **P2 (v1.0)** — dark theme, RTL, prefixes, plugin system, VS Code extension, benchmarks, docs portal

Full list — in [`TODO.md`](./TODO.md).

## License

MIT
