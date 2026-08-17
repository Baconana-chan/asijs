# miyocss — SSR-first CSS + SVG framework

CSS utilities that are compiled **during rendering**, not by scanning files — plus SVG as a first-class citizen. Framework-agnostic: AsiJS, Hono, Elysia, Fastify, plain Node — anywhere with SSR.

- Package: `miyocss`
- Status: **concept / skeleton** (v0.1.0-pre)
- Roadmap: [`packages/MiyoCSS/TODO.md`](https://github.com/Baconana-chan/asijs/blob/main/packages/MiyoCSS/TODO.md)

> The name is intentionally neutral — this is not "AsiCSS". It's a standalone engine that any SSR framework can adopt.

## Why not Tailwind

| | Tailwind | MiyoCSS |
|---|---|---|
| CSS compilation | static file scan | **during `renderToString`** |
| Dynamic classes (`clsx(cond && "md:flex")`) | false negatives | ✅ actually rendered |
| Separate build step | yes (CLI/plugin) | **no** — on demand, optionally cached to file |
| JS on the client | 0 (after build) | **0 always** |
| SVG | no | **first-class** (icons, gradients, filters, charts) |

## Installation

```bash
bun add miyocss
```

## Package layout

| Subpath | Contents | Status |
|---|---|---|
| `miyocss` | Core: tokens, utility generator, variants, SSR collection | 🔴 skeleton (0.1–0.4 done) |
| `miyocss/asi` | AsiJS adapter (plugin, auto style injection) | 🔴 stub |
| `miyocss/svg` | SVG: primitives, icons, gradients, filters, charts | 🔴 stub |

## API — core

### Design tokens

```typescript
import { defineConfig, resolveConfig, resolveDefaultConfig, flattenColors, deepMerge } from "miyocss";

const config = defineConfig({
  theme: {
    colors: { brand: "#6d28d9" },          // REPLACES the whole color palette
  },
  extend: {
    theme: {
      spacing: { 18: "72px" },             // ADDS a step, defaults preserved
      colors: { brand: { 500: "#6d28d9", 600: "#5b21b6" } },
    },
  },
  options: { darkMode: "class", prefix: "mi-" },
});

const resolved = resolveConfig(config);     // validated + normalized
const defaults = resolveDefaultConfig();    // defaults only
```

Semantics follow Tailwind: `theme.*` replaces a group wholesale; `extend.theme.*` deep-merges on top (including on top of your own `theme`). Nested palettes flatten to `blue-500`; a nested `DEFAULT` flattens to the parent name: `{ primary: { DEFAULT: "#6d28d9" } }` → class `primary`.

Validation is TypeBox-based with path errors at startup — not at CSS runtime:

```
miyocss: invalid config — /theme/colors/blue: Expected union value
```

Defaults shipped: 4px-based spacing (0–96), 18 colors × 10 shades, typography, radius, shadows, breakpoints `sm–2xl`.

### Utility generation

```typescript
import { generateUtility, generateCSS, renderRule, escapeSelector, staticUtilityNames } from "miyocss";

// Single class
const result = generateUtility("p-4", resolved);
// → { className: "p-4", declarations: [{ property: "padding", value: "16px" }] }

// Batch — dedupes + sorts by class name
const css = generateCSS(["p-4", "bg-red-500/50", "w-1/3", "grid-cols-[200px_1fr]", "-mt-2"], resolved);

// Strict mode
const css = generateCSS(["p-4", "nope"], resolved, { unknown: "throw" }); // throws on "nope"
```

### Variants

```typescript
import { generateRule, parseVariants, PSEUDO_VARIANTS } from "miyocss";

// Single entry point — plain class or variant-prefixed
const rule = generateRule("hover:md:bg-red-500", resolved);

// Parse prefix stack
const parsed = parseVariants("hover:md:p-4");
// → { base: "p-4", variants: ["hover", "md"] }
```

Supported:

- **Pseudo-classes (24)**: `hover:`, `focus:`, `focus-visible:`, `focus-within:`, `active:`, `visited:`, `disabled:`, `checked:`, `required:`, `read-only:`, `placeholder:` (`::placeholder`), `first/last/odd/even`, `first/last-of-type`, `empty:`, `target:`, `valid/invalid/optional/in-range/out-of-range` — pure CSS selectors, zero JS
- **Breakpoints**: any `theme.breakpoints` key (`sm–2xl` + custom via `extend`) → `@media (min-width: …)`
- **`dark:`** from `options.darkMode`: `media` → `@media (prefers-color-scheme: dark)`, `class` → `.dark .dark\:bg-…` (descendant selector, like Tailwind)
- **Composition** of any number: `hover:md:bg-red-500` → `@media (min-width: 768px) { .hover\:md\:bg-red-500:hover { … } }`; multiple media variants join with `and`

`generateCSS` sorts by cascade: base → pseudo → dark(media) → breakpoints ascending. So `md:p-4` always overrides `p-4`, and on conflict `md:bg-white` beats `dark:bg-black` (for the reverse, write `md:dark:bg-black` explicitly).

### Utility coverage (0.3)

| Group | Examples |
|---|---|
| Layout | display (13), position, overflow (incl. x/y/clip), z-index from tokens, box-sizing, visibility, float, `sr-only` |
| Flex/Grid | direction/wrap/item, all align/justify families, gap from spacing, `grid-cols/rows-1..12`, `col/row-span` (+full) |
| Spacing | p/m all sides, **negatives** (`-m-4`, `-mx-2`), inset/top/right/bottom/left (+negatives, auto) |
| Typography | font-family vs font-weight (disambiguated), size, leading, tracking, align, whitespace, truncate, italic, transform |
| Colors | text/bg/border from flattened tokens + **slash-opacity** (`bg-red-500/50` → `color-mix(in srgb, #ef4444 50%, transparent)`) — works with any color format |
| Borders/Effects | width (sides, x/y), style, radius (DEFAULT, sides, corners), shadow, opacity |
| Sizing | w/h from spacing + full/screen/svh/dvh/min/max/fit/auto, **fractions** (`w-1/3` → `33.3333%`), min/max |
| Arbitrary values | `w-[17px]`, `bg-[#f00]`, `text-[13px]` (color vs size decided by value), `grid-cols-[200px_1fr]`, `_` → space; rejects `;{}!<>` |

## CLI

```bash
miyocss info            # resolve config + token stats + validity check
miyocss info --json     # machine-readable output
miyocss info --config path --cwd dir
```

`info` is a quick smoke over the config: finds `miyocss.config.{ts,js,mjs,cjs,json}`, validates with the same TypeBox schemas (invalid → path errors, exit 1, fallback to defaults) and prints token statistics plus an estimated utility surface (on defaults: **2354 classes**).

Example output:

```
miyocss — config info

  config        miyocss.config.ts ✓
  colors        185 (18 groups × 10 shades + specials)
  spacing       35 steps (4px base)
  breakpoints   sm, md, lg, xl, 2xl
  static utils  126
  utility surface  2354 classes
```

## AsiJS adapter (stub)

`miyocss/asi` ships `asiPlugin()` — typed via AsiJS's `AsiPlugin` so the future API won't break, but it currently throws with a version reference (P0.6). Expected API:

```ts
import { Asi } from "asijs";
import { asiPlugin } from "miyocss/asi";

const app = new Asi();
app.use(asiPlugin({ collect: "auto" }));

app.get("/", () => (
  <div className="flex items-center gap-4 p-6 md:p-8">
    <span className="text-lg font-bold text-blue-600">Hello</span>
  </div>
));
```

The architectural decision (recorded in the roadmap): collection happens via a **wrapper helper** (`miyocss.render()` / `miyocss.stream()`) that walks the JSX tree synchronously *before* rendering — no hooks, no monkey-patching in AsiJS core. The `<style>` is injected into the `<head>` of the tree before streaming starts, so there's no TTFB penalty.

## Development

```bash
cd packages/MiyoCSS
npm install        # pulls asijs from the repo root (file:../..)
npm run typecheck  # tsc --noEmit
npm test           # bun test (105 tests)
npm run build      # tsc → dist/
```

## Roadmap

- **P0 (v0.1)** — engine: TypeBox-validated tokens, ~150 utilities, `hover/md/dark` variants, SSR collection, AsiJS adapter
- **P1 (v0.5)** — custom utilities, purge-to-file, SVG core (icons, charts), Hono/Elysia/Fastify/plain-Node adapters
- **P2 (v1.0)** — dark theme, RTL, prefixes, plugin system, VS Code extension, benchmarks, docs portal
