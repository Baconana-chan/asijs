# eslint-plugin-asijs — ESLint Rules for AsiJS

Lint AsiJS applications for route hygiene: missing handlers, duplicate registrations, and validation schemas — in your existing ESLint setup (flat config or legacy).

- Package: `eslint-plugin-asijs`
- Requires: `eslint` ^8 or ^9 (peer dependency)

## Installation

```bash
bun add -d eslint eslint-plugin-asijs
```

## Usage — flat config (ESLint 9)

```js
// eslint.config.js
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
  asijs.configs.recommended,
];
```

## Usage — legacy config (ESLint 8)

```js
// .eslintrc.json
{
  "plugins": ["asijs"],
  "extends": ["plugin:asijs/recommended"]
}
```

## Rules

| Rule | `recommended` | Description |
|---|---|---|
| `asijs/no-missing-handler` | `error` | Routes registered without a handler function |
| `asijs/no-duplicate-route` | `warn` | Duplicate `app.get/post/put/...` registrations on the same path |
| `asijs/validate-schema` | `warn` | Routes with `:param` / `*` segments missing a validation schema |
| `asijs/no-unused-route` | off | Excessive route registrations (heuristic — enable via `all`) |

### Examples

```typescript
// Bad — duplicate route + missing handler + no schema on a param route
app.get("/users", () => []);
app.get("/users", () => []);          // no-duplicate-route
app.post("/users/:id");               // no-missing-handler
app.get("/users/:id", () => user);    // validate-schema — no schema for :id

// Good
app.get("/users", () => users);
app.get("/users/:id",
  { schema: { params: { id: { type: "string" } } } },  // any schema object counts
  (ctx) => users.find((u) => u.id === ctx.params.id),
);
```

## Configs

| Config | Contents |
|---|---|
| `asijs.configs.recommended` | `no-missing-handler` (error), `no-duplicate-route` (warn), `validate-schema` (warn) |
| `asijs.configs.all` | every rule, including `no-unused-route` (warn) |

## Rule details

### no-missing-handler

Flags route registrations with no callback:

```typescript
app.get("/users");         // ✗ error
app.get("/users", () => []);  // ✓ ok
```

### no-duplicate-route

Detects the same method + path registered twice within the same file:

```typescript
app.get("/users", a);      // ✓
app.get("/users", b);      // ✗ warn — second registration shadows the first
```

Note: works per-file; cross-file duplicates (e.g. file-based routing) are intentionally not flagged.

### validate-schema

Routes with `:param` or `*` (wildcard) segments should carry a validation schema argument. The rule checks that a **schema argument exists** — it does not introspect the schema's shape:

```typescript
app.get("/users/:id", () => user);                     // ✗ warn — no schema
app.get("/users/:id", { schema: {} }, () => user);     // ✓ any schema object counts
```

### no-unused-route

Heuristic: flags routes that look dead (registered but never referenced elsewhere). High false-positive risk — opt-in only via `asijs.configs.all`.

## TypeScript & performance

- The rules parse source with ESLint's default parser (ESTree) — no TypeScript parser required for basic checks.
- For monorepos, run ESLint per package or configure `--no-warn-ignored` to skip workspaces without AsiJS code.
