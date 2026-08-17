# graphql-asijs — GraphQL Plugin v2 for AsiJS

Code-first **GraphQL** for AsiJS: TypeBox schemas → SDL, HTTP + WebSocket
(graphql-ws protocol) transports, **Apollo Federation** subgraphs,
**DataLoader** batching and **query complexity** analysis.

```bash
bun add graphql-asijs graphql
```

> `graphql` is an optional peer (loaded lazily) — the schema builder, module
> map, transports and DataLoader all work without it; only execution needs
> the `graphql` package.

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
| `/graphql` | HTTP endpoint (POST JSON / GET query params / batched) |
| `/graphql/ws` | WebSocket endpoint (graphql-ws protocol: subscriptions) |
| `/graphql/playground` | Built-in GraphiQL-like playground |

## Code-first schema

`defineSchema` maps **TypeBox** schemas to GraphQL SDL:

| TypeBox | GraphQL |
|---------|---------|
| `Type.String()` | `String` |
| `Type.Integer()` | `Int` |
| `Type.Number()` | `Float` |
| `Type.Boolean()` | `Boolean` |
| `Type.Array(T)` | `[T]` |
| `Type.Object({...})` (named) | `type Name { ... }` (non-null when in `required`) |
| `Type.Object({...})` (inline) | auto-generated `__AnonN` type |
| `Type.Optional(T)` (field) | nullable (absent from `required`) |
| `Type.Literal(v)` | primitive scalar |
| `Type.Union([named types])` | `union` |
| `enums` config | `enum` |
| `scalars` config | custom `scalar` |

The result is `{ sdl, resolvers }` — a plain SDL string + resolver map, so
you can also feed it to any graphql-js tooling.

## Subscriptions (WebSocket)

The transport implements the **graphql-ws** protocol: `connection_init` /
`connection_ack`, `subscribe` / `next` / `error` / `complete`, `ping` /
`pong` and keep-alive. Any GraphQL client that speaks the protocol works —
including `graphql-ws` and Apollo Client.

```ts
import { createClient } from "graphql-ws";

const client = createClient({ url: "ws://localhost:3000/graphql/ws" });
const sub = client.subscribe(
  { query: "subscription { userCreated { id name } }" },
  { next: (v) => console.log(v.data), error: console.error, complete: () => {} },
);
```

## Federation

`federationSubgraph` wraps your SDL with the Apollo Federation v2
boilerplate (`_service`, `_entities`, `@key` directives) and produces the
gateway-facing resolvers:

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

Or enable it directly in the plugin:

```ts
app.plugin(graphql({ schema, federation: { name: "users" } }));
```

## Performance

**Query complexity** — depth-weighted scoring with configurable limits,
enforced via graphql validation rules:

```ts
app.plugin(graphql({
  schema,
  complexity: { maxComplexity: 100, maxDepth: 8 },
}));
```

**DataLoader** — a zero-dependency batching/caching loader, drop-in for the
common `dataloader` use case:

```ts
import { DataLoader } from "graphql-asijs";

const loader = new DataLoader(async (ids: string[]) => db.usersByIds(ids));
const user = await loader.load(id); // batched + cached per request
```

## API

| Export | Description |
|--------|-------------|
| `graphql(opts)` | AsiJS plugin (HTTP + WS + playground) |
| `defineSchema(config)` | Code-first schema → `{ sdl, resolvers }` |
| `typeboxToSDL(t)` / `fieldTypeToSDL(t)` / `emitObjectType(n, t)` | TypeBox → SDL mappings |
| `applyResolvers(schema, resolvers)` | Attach resolvers to a graphql-js schema |
| `createDefaultExecutor(schema, resolvers?)` | Lazy graphql executor |
| `createGraphQLHandler(opts)` | Plain HTTP handler (custom wiring) |
| `createGraphQLWSTransport(opts)` | graphql-ws transport handlers |
| `calculateComplexity(ast, config)` / `createComplexityRule(config)` | Complexity analysis |
| `DataLoader` | Batching + caching loader |
| `federationSubgraph(opts)` / `extractEntityKeys(sdl)` / `resolveEntities(reps, refs)` | Federation helpers |
| `renderPlaygroundHTML(opts)` | Playground page |

## Development

```bash
cd packages/graphql-asijs
npm install
npm run typecheck  # tsc --noEmit
npm test           # bun test (42 tests)
npm run build      # bun build → dist/
```

## License

MIT
