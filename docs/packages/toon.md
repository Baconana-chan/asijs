# toon-asijs — TOON Data Format for AsiJS

TOON (**T**oken-**O**riented **O**bject **N**otation) adapter for the AsiJS
[formats layer](/api-reference#data-formats). TOON is a compact, token-efficient
encoding of the JSON data model designed for **LLM/AI clients**: indentation
instead of braces, tabular forms for uniform arrays — ~30–60% fewer tokens than
JSON in typical cases, while staying **lossless** for JSON-serializable values.

- Package: `toon-asijs`
- Status: **released**
- Source: `packages/toon-asijs/`
- Backend: official [`@toon-format/toon`](https://www.npmjs.com/package/@toon-format/toon) SDK

Registering the format makes AsiJS understand TOON **natively**: request bodies
parse by `Content-Type`, responses (including errors and 404s) serialize to
TOON, and `Accept` negotiation works automatically.

## Installation

```bash
bun add toon-asijs
```

## Quick Start

```ts
import { Asi } from "asijs";
import { registerToonFormat } from "toon-asijs";

registerToonFormat(); // enable TOON: negotiation + parsing + setFormat("toon")

const app = new Asi({ format: "toon" }); // default response format = TOON
// or: app.setFormat("toon");

app.post("/config", async (ctx) => {
  const body = await ctx.parseBody(); // Content-Type: application/toon → parsed
  return body;                        // serialized to TOON
});

app.listen(3000);
```

What becomes possible after `registerToonFormat()`:

| Capability | Behavior |
|---|---|
| `new Asi({ format: "toon" })` | Object results serialized to TOON |
| `app.setFormat("toon")` | Same, set at runtime |
| `Accept: application/toon` | TOON response even with JSON default |
| `Accept: application/json` | JSON response even with TOON default |
| `Content-Type: application/toon` | `ctx.parseBody()` decodes TOON |
| errors (400/500) & 404 | Bodies serialized in TOON |
| route body validation | Validates TOON bodies (JSON/TOON/YAML by Content-Type) |

## What TOON looks like

```yaml
# { items: [{ sku: "A1", qty: 2 }, { sku: "B2", qty: 1 }] }
items[2]{sku,qty}:
  A1,2
  B2,1
```

The tabular header declares length + fields; rows are delimiter-separated —
far cheaper than `[{...},{...}]`. `decode()` returns **plain JS objects**, so
TypeBox validation, response serializers and the whole AsiJS stack work
unchanged.

## API

### `createToonFormat(options?)` → `DataFormat`

Creates a TOON format object (structural match for AsiJS `DataFormat`). **Pure**
— only needs `@toon-format/toon`, so it works without AsiJS in plain fetch
servers or CLI tools:

```ts
import { createToonFormat } from "toon-asijs";
import { registerFormat } from "asijs";

registerFormat(createToonFormat({ delimiter: "\t", strict: true }));
```

| Option | Type | Default | Description |
|---|---|---|---|
| `indentSize` | `number` | `2` | Spaces per indentation level |
| `delimiter` | `"," \| "\t" \| "\|"` | `","` | Separator for array values / tabular rows |
| `strict` | `boolean` | `true` | Strict decoding — array counts, indentation, duplicate keys |

### `getToonFormat(options?)` → `DataFormat`

Cached TOON format singleton — repeated calls return the same instance.

### `registerToonFormat(options?)` → `DataFormat`

Creates the format and registers it with AsiJS, enabling everything in the
table above. Idempotent. Loads AsiJS lazily, so `createToonFormat` stays usable
without it.

## MIME types

| Field | Value |
|---|---|
| Canonical content type | `application/toon` |
| Aliases | `text/toon`, `application/x-toon` |
| Extension | `.toon` |

## Development

```bash
cd packages/toon-asijs
bun install
bun run typecheck   # tsc --noEmit
bun test            # bun test (21 unit tests)
bun run build       # bun build → dist/
```

The integration test (`test/toon-asijs.test.ts` in the repo root) exercises the
full path against the real core: registration → `setFormat` → `parseBody` →
negotiation → error/404 bodies → compiled routes (`app.compile()`).

## Roadmap (TODO.md 3.2b)

- [x] TOON `DataFormat` adapter over `@toon-format/toon` (`createToonFormat`)
- [x] `registerToonFormat()` — one-call enablement (negotiation + parsing + `setFormat("toon")`)
- [x] Format-aware **route body validation** (`ctx.json()` → `ctx.parseBody()` in wrapHandler + compiled paths)
- [x] Integration tests: round-trips, options, negotiation, errors, compiled routes
