# toon-asijs

TOON (**T**oken-**O**riented **O**bject **N**otation) adapter for AsiJS.

TOON is a compact, token-efficient encoding of the JSON data model designed for
LLM/AI clients — indentation instead of braces, tabular forms for uniform
arrays, ~30–60% fewer tokens than JSON in typical cases, lossless for
JSON-serializable values. This package wires the official
[`@toon-format/toon`](https://www.npmjs.com/package/@toon-format/toon) SDK into
the AsiJS [formats layer](https://asijs.dev/api-reference#data-formats), so the
framework understands TOON **natively**: request bodies parse by
`Content-Type`, responses (including errors and 404s) serialize to TOON, and
`Accept` negotiation works out of the box.

```bash
bun add toon-asijs
```

## Usage

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

// Accept negotiation just works:
//   Accept: application/toon      → TOON response
//   Accept: application/json      → JSON response (even with TOON default)
//   Content-Type: application/toon → request body decoded from TOON
```

## API

### `createToonFormat(options?)` → `DataFormat`

Creates a TOON format object (structural match for AsiJS `DataFormat`).
**Pure** — only needs `@toon-format/toon`, so it works without AsiJS in plain
fetch servers or CLI tools.

```ts
import { createToonFormat } from "toon-asijs";
import { registerFormat } from "asijs";

registerFormat(createToonFormat()); // manual registration
```

| Option | Type | Default | Description |
|---|---|---|---|
| `indentSize` | `number` | `2` | Spaces per indentation level |
| `delimiter` | `"," \| "\t" \| "\|"` | `","` | Separator for array values / tabular rows |
| `strict` | `boolean` | `true` | Strict decoding (array counts, indentation, duplicate keys) |

### `getToonFormat(options?)` → `DataFormat`

Cached TOON format singleton — repeated calls return the same instance.

### `registerToonFormat(options?)` → `DataFormat`

Creates the format and registers it with AsiJS (`registerFormat`), enabling
`setFormat("toon")`, `Content-Type: application/toon` parsing and `Accept`
negotiation. Idempotent.

## MIME types

| Field | Value |
|---|---|
| Canonical content type | `application/toon` |
| Aliases | `text/toon`, `application/x-toon` |
| Extension | `.toon` |

## Why TOON?

For LLM-facing endpoints (MCP tools, agent APIs, chat backends), token count
is a real cost. TOON keeps the JSON data model — `decode()` returns plain JS
objects/arrays/primitives, so TypeBox validation and AsiJS serializers work
**unchanged** — while cutting tokens via:

- indentation instead of `{ }` and `,`
- tabular headers for uniform arrays: `items[2]{sku,qty}:` + rows
- unquoted keys and numbers where unambiguous

## License

MIT
