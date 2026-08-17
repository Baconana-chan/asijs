# eslint-plugin-asijs — ESLint rules for AsiJS

Lint your AsiJS applications: route hygiene, missing handlers, duplicate registrations and validation schemas — all in your existing ESLint setup.

## Installation

```bash
bun add -d eslint eslint-plugin-asijs
```

> Requires `eslint` (^8 or ^9) as a peer dependency.

## Usage

Add the plugin to your ESLint config:

```js
// eslint.config.js (flat config)
import asijs from "eslint-plugin-asijs";

export default [
  {
    plugins: { asijs },
    rules: {
      "asijs/no-missing-handler": "error",
      "asijs/no-duplicate-route": "warn",
      "asijs/validate-schema": "warn",
    },
  },
];
```

Or use the built-in preset:

```js
import asijs from "eslint-plugin-asijs";

export default [
  asijs.configs.recommended, // no-missing-handler (error), no-duplicate-route (warn), validate-schema (warn)
];
```

## Rules

| Rule | Severity in `recommended` | Description |
|------|---------------------------|-------------|
| `asijs/no-missing-handler` | `error` | Routes registered without a handler function |
| `asijs/no-duplicate-route` | `warn` | Duplicate `app.get/post/put/...` registrations on the same path |
| `asijs/validate-schema` | `warn` | Routes with `:params` / `*` segments missing a validation schema |
| `asijs/no-unused-route` | off | Warns about excessive route registrations (heuristic — enable in `all`) |

### Example

```ts
// Bad — duplicate route + missing handler + no schema on a param route
app.get("/users", () => []);
app.get("/users", () => []);            // no-duplicate-route
app.post("/users/:id");                 // no-missing-handler
app.get("/users/:id", () => user);      // validate-schema (no schema for :id)

// Good
app.get("/users", () => users);
app.get("/users/:id",
  { schema: { params: { id: { type: "string" } } } }, // any schema object counts
  (ctx) => users.find((u) => u.id === ctx.params.id),
);
```

> `validate-schema` checks that a schema argument **exists** for routes with `:params` / `*` — it does not introspect the schema itself.

## Configs

- `asijs.configs.recommended` — `no-missing-handler` (error), `no-duplicate-route` (warn), `validate-schema` (warn)
- `asijs.configs.all` — every rule enabled, including `no-unused-route` (warn)

## Development

```bash
bun install
bun test        # RuleTester suite covering all 4 rules
bun run build   # tsc → dist/
```
