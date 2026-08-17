# graphql-asijs — GraphQL Plugin v2 for AsiJS

Code-first **GraphQL** for AsiJS: TypeBox schemas → SDL, HTTP + WebSocket
(graphql-ws protocol) transports, **Apollo Federation** subgraphs,
**DataLoader** batching and **query complexity** analysis.

- Package: `graphql-asijs`
- Status: **released**
- Source: `packages/graphql-asijs/`

> `graphql` is an **optional peer** (loaded lazily). The schema builder,
> transports, DataLoader and federation helpers work without it; only
> execution needs the `graphql` package installed.

## Installation

```bash
bun add graphql-asijs graphql
```

## Quick Start

```ts
import { Asi } from "asijs";
import { Type } from "@sinclair/typebox";
import { graphql, defineSchema } from "graphql-asijs";

const schema = defineSchema({
  types: { User: Type.Object({ id: Type.String(), name: Type.String() }) },
  queries: {
    users: { type: ["User"], resolve: () => db.users() },
    user: { type: "User", args: { id: Type.String() }, resolve: (_, a) => db.user(a.id) },
  },
  mutations: {
    createUser: { type: "User", args: { name: Type.String() }, resolve: (_, a) => db.create(a) },
  },
  subscriptions: {
    userCreated: { type: "User", subscribe: () => events },
  },
});

const app = new Asi();
app.plugin(graphql({ schema }));
app.listen(3000);
```

Routes mounted by the plugin:

| Route | Purpose |
|-------|---------|
| `/graphql` | HTTP endpoint — POST JSON, GET query params, batched arrays |
| `/graphql/ws` | WebSocket endpoint — graphql-ws protocol (subscriptions) |
| `/graphql/playground` | Built-in GraphiQL-like playground |

## Code-first schema

`defineSchema` maps **TypeBox** schemas to GraphQL SDL (structural
inspection — no `graphql` import needed):

| TypeBox | GraphQL |
|---------|---------|
| `Type.String()` | `String` |
| `Type.Integer()` | `Int` |
| `Type.Number()` | `Float` |
| `Type.Boolean()` | `Boolean` |
| `Type.Array(T)` | `[T]` |
| `Type.Object({...})` (named in `types`) | `type Name { ... }` |
| `Type.Object({...})` (inline) | auto-generated `__AnonN` type |
| field in `required` array | `Type!` (non-null) |
| `Type.Optional(T)` (field) | nullable |
| `Type.Literal(v)` | primitive scalar (`Int` for integer literals) |
| `Type.Union([named types])` | `union` |
| `enums` config | `enum` |
| `scalars` config | custom `scalar` |

The result is `{ sdl, resolvers }` — a plain SDL string plus a standard
resolver map (`Query`, `Mutation`, `Subscription: { field: { subscribe } }`),
compatible with graphql-js tooling.

Field types accept a named-type string (`"User"`), a TypeBox schema, or array
forms `["User"]` / `{ arrayOf: "User" }`.

## HTTP transport

`createGraphQLHandler` (used by the plugin) is a plain
`(request) => Response` handler:

- **POST** — JSON `{ query, variables, operationName }`,
  `application/graphql` raw query, or **batched arrays**
- **GET** — `?query=...&variables=...&operationName=...` (disable with
  `allowGet: false`)
- Execution errors answer `200` with `{ errors }` (spec), transport errors
  answer `400`/`405`
- Subscriptions over HTTP are rejected with a hint to use WebSocket

## Subscriptions (WebSocket)

The transport implements the **graphql-ws** protocol (`connection_init` /
`connection_ack`, `subscribe` / `next` / `error` / `complete`, `ping` /
`pong`, keep-alive). Any protocol-compatible client works:

```ts
import { createClient } from "graphql-ws";

const client = createClient({ url: "ws://localhost:3000/graphql/ws" });
const sub = client.subscribe(
  { query: "subscription { userCreated { id name } }" },
  { next: (v) => console.log(v.data), error: console.error, complete: () => {} },
);
```

`complete` from the client cancels the subscription source
(`iterator.return()`), so pubsub iterators clean up.

## Federation

`federationSubgraph` wraps your SDL with Apollo Federation v2 boilerplate
(`extend schema @link(...)`, `_service`, `_entities`, `_FieldSet`, `_Any`,
`_Entity` union) and produces the gateway-facing resolvers. Entity types are
discovered from `@key` directives; reference resolvers map representations to
real entities:

```ts
import { federationSubgraph } from "graphql-asijs";

const fed = federationSubgraph({
  name: "users",
  sdl: schema.sdl,
  resolvers: schema.resolvers,
  references: {
    User: (representation) => db.userById(representation.id),
  },
});
```

Or directly in the plugin: `graphql({ schema, federation: { name: "users" } })`.

## Performance

**Query complexity** — depth-weighted scoring: a field at depth `d` costs
`scoreField(name) * (1 + d)`, so deep queries cost more than flat ones with
the same field count. Limits are enforced via graphql validation rules:

```ts
app.plugin(graphql({
  schema,
  complexity: { maxComplexity: 100, maxDepth: 8, scoreField: (name) => name === "expensive" ? 10 : 1 },
}));
```

**DataLoader** — a zero-dependency batching/caching loader (drop-in for the
common `dataloader` case):

```ts
import { DataLoader } from "graphql-asijs";

const loader = new DataLoader(async (ids: string[]) => db.usersByIds(ids));
const user = await loader.load(id);   // batched in a microtask, cached
const many = await loader.loadMany(ids);
loader.prime(id, user).clear(id).clearAll();
```

## Playground

`/graphql/playground` serves a zero-dependency GraphiQL-like page: query
textarea, variables JSON input, Run (Ctrl/Cmd+Enter), status badge with
latency, and a formatted response pane.

## Custom wiring (no plugin)

```ts
import { Asi } from "asijs";
import { createGraphQLHandler, defineSchema } from "graphql-asijs";

const handler = createGraphQLHandler({ executor: myExecutor });
const app = new Asi();
app.all("/graphql", (ctx) => handler(ctx.request));
app.listen(3000);
```

## Plugin API

`graphql(options)`:

| Option | Default | Description |
|--------|---------|-------------|
| `schema` | — | Code-first schema (`defineSchema`) |
| `resolvers` | — | Extra resolvers (override) |
| `path` | `"/graphql"` | HTTP endpoint |
| `wsPath` | `"/graphql/ws"` | WebSocket endpoint |
| `playgroundPath` | `"/graphql/playground"` | Playground route |
| `playground` | `true` | Disable the playground |
| `executor` | lazy graphql | Custom executor |
| `context` | — | Per-request context builder |
| `complexity` | — | Complexity/depth limits |
| `federation` | — | Federation subgraph options |
| `http` / `ws` | — | Transport options |
| `name` | `"graphql"` | Plugin name |

## Development

```bash
cd packages/graphql-asijs
npm install
npm run typecheck  # tsc --noEmit
npm test           # bun test (42 tests)
npm run build      # bun build → dist/
```

The test suite runs **without the `graphql` package**: SDL generation,
transports (with an injected executor), graphql-ws protocol, complexity
analysis, DataLoader and federation helpers are fully covered with injected
fakes; the default executor's missing-graphql path throws a descriptive
install hint.

## Core change

`PluginHost` in the AsiJS core now exposes `ws(path, handlers, options)` so
plugins can register WebSocket routes (previously only HTTP verbs were
available through the plugin adapter).

## Roadmap (TODO.md 3.8)

- [x] **Code-first** — TypeBox → GraphQL schema (`defineSchema`, `typeboxToSDL`)
- [x] **Subscription support** — graphql-ws WebSocket transport (`createGraphQLWSTransport`)
- [x] **Federation support** — Apollo Federation subgraphs (`federationSubgraph`)
- [x] **Performance** — DataLoader + query complexity analysis

**Known limitations**: gateway-side federation (Apollo Gateway / router
composition) is not bundled — `graphql-asijs` produces a standards-compliant
subgraph SDL + resolvers for use with any Apollo-compatible gateway.
