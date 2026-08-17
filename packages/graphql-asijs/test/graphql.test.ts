import { describe, expect, test } from "bun:test";
import { Type } from "@sinclair/typebox";
import {
  defineSchema,
  typeboxToSDL,
  fieldTypeToSDL,
  applyResolvers,
  createGraphQLHandler,
  createGraphQLWSTransport,
  calculateComplexity,
  createComplexityRule,
  DataLoader,
  federationSubgraph,
  extractEntityKeys,
  resolveEntities,
  renderPlaygroundHTML,
  graphql,
} from "../src/index";
import type { GraphQLExecutor, GraphQLExecutionResult } from "../src/index";

// ============================================================================
// Code-first schema (TypeBox → SDL)
// ============================================================================

describe("graphql-asijs — code-first schema", () => {
  test("typeboxToSDL maps scalars", () => {
    expect(typeboxToSDL(Type.String())).toBe("String");
    expect(typeboxToSDL(Type.Number())).toBe("Float");
    expect(typeboxToSDL(Type.Integer())).toBe("Int");
    expect(typeboxToSDL(Type.Boolean())).toBe("Boolean");
  });

  test("typeboxToSDL maps arrays and literals", () => {
    expect(typeboxToSDL(Type.Array(Type.String()))).toBe("[String]");
    expect(typeboxToSDL(Type.Literal("x"))).toBe("String");
    expect(typeboxToSDL(Type.Literal(1))).toBe("Int");
  });

  test("typeboxToSDL rejects null and inline enums", () => {
    expect(() => typeboxToSDL(Type.Null())).toThrow(/no GraphQL equivalent/);
    expect(() => typeboxToSDL(Type.Enum({ A: "a", B: "b" }))).toThrow(/define it in `enums`/);
  });

  test("defineSchema emits named types with nullability from required", () => {
    const { sdl } = defineSchema({
      types: {
        User: Type.Object({
          id: Type.String(),
          name: Type.String(),
          email: Type.Optional(Type.String()),
        }),
      },
      queries: {
        user: { type: "User", args: { id: Type.String() }, resolve: () => null },
        users: { type: ["User"], resolve: () => [] },
      },
    });
    expect(sdl).toContain("type User {\n  id: String!\n  name: String!\n  email: String\n}");
    expect(sdl).toContain("type Query {\n  user(id: String): User\n  users: [User]\n}");
  });

  test("defineSchema builds resolver maps incl. subscriptions", () => {
    const resolve = () => 1;
    const subscribe = () => ({} as AsyncIterable<unknown>);
    const { resolvers } = defineSchema({
      queries: { ping: { type: Type.String(), resolve } },
      mutations: { set: { type: Type.Boolean(), resolve } },
      subscriptions: { tick: { type: Type.String(), subscribe } },
    });
    expect(resolvers.Query.ping).toBe(resolve);
    expect(resolvers.Mutation.set).toBe(resolve);
    expect(resolvers.Subscription.tick).toMatchObject({ subscribe });
  });

  test("inline anonymous object types are emitted", () => {
    const { sdl } = defineSchema({
      queries: {
        me: { type: Type.Object({ id: Type.String() }), resolve: () => null },
      },
    });
    expect(sdl).toMatch(/type __Anon0 \{\n  id: String!\n\}/);
    expect(sdl).toContain("me: __Anon0");
  });

  test("enums and custom scalars are emitted", () => {
    const { sdl } = defineSchema({
      enums: { Role: { ADMIN: "admin", USER: "user" } },
      scalars: { DateTime: "scalar DateTime" },
      queries: {
        role: { type: "Role", resolve: () => null },
        now: { type: "DateTime", resolve: () => null },
      },
    });
    expect(sdl).toContain("enum Role {\nadmin\nuser\n}");
    expect(sdl).toContain("scalar DateTime");
    expect(sdl).toContain("role: Role");
    expect(sdl).toContain("now: DateTime");
  });

  test("unknown type reference throws", () => {
    expect(() =>
      defineSchema({ queries: { x: { type: "Nope" } } }),
    ).toThrow(/unknown type reference "Nope"/);
  });

  test("applyResolvers attaches resolvers to a schema-like object", () => {
    const fields: Record<string, { resolve?: unknown; subscribe?: unknown }> = {};
    const schema = {
      getTypeMap: () => ({ Query: { getFields: () => ({ hello: fields } as never) } }),
    };
    const resolver = () => "hi";
    applyResolvers(schema as never, { Query: { hello: resolver } });
    expect(fields.resolve).toBe(resolver);
  });

  test("fieldTypeToSDL supports arrayOf form", () => {
    expect(fieldTypeToSDL({ arrayOf: Type.String() })).toBe("[String]");
    expect(fieldTypeToSDL([Type.Integer()])).toBe("[Int]");
    // string refs resolve against the registry
    const { sdl } = defineSchema({
      types: { User: Type.Object({ id: Type.String() }) },
      queries: {
        users: { type: ["User"], resolve: () => [] },
        one: { type: { arrayOf: "User" }, resolve: () => null },
      },
    });
    expect(sdl).toContain("users: [User]");
    expect(sdl).toContain("one: [User]");
  });
});

// ============================================================================
// HTTP transport
// ============================================================================

describe("graphql-asijs — HTTP transport", () => {
  const executor: GraphQLExecutor = async (params) => ({
    data: { echo: params.query + ":" + JSON.stringify(params.variables ?? {}) },
  });

  test("POST JSON executes and returns JSON", async () => {
    const handler = createGraphQLHandler({ executor });
    const res = await handler(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "{ echo }", variables: { a: 1 } }),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    const body = await res.json();
    expect(body.data.echo).toContain("{ echo }");
  });

  test("GET with query params", async () => {
    const handler = createGraphQLHandler({ executor });
    const res = await handler(
      new Request("http://localhost/graphql?query=%7B%20echo%20%7D&variables=%7B%22a%22%3A1%7D"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.echo).toContain("a");
  });

  test("batched POST returns array", async () => {
    const handler = createGraphQLHandler({ executor });
    const res = await handler(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ query: "{ a }" }, { query: "{ b }" }]),
      }),
    );
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
  });

  test("application/graphql content type", async () => {
    const handler = createGraphQLHandler({ executor });
    const res = await handler(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/graphql" },
        body: "{ echo }",
      }),
    );
    expect(res.status).toBe(200);
  });

  test("invalid JSON body → 400 with errors", async () => {
    const handler = createGraphQLHandler({ executor });
    const res = await handler(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errors[0].message).toContain("invalid JSON");
  });

  test("execution errors answer 200 with { errors }", async () => {
    const failing: GraphQLExecutor = async () => {
      throw new Error("boom");
    };
    const handler = createGraphQLHandler({ executor: failing });
    const res = await handler(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "{ x }" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.errors[0].message).toBe("boom");
  });

  test("GET disabled → 405", async () => {
    const handler = createGraphQLHandler({ executor, allowGet: false });
    const res = await handler(new Request("http://localhost/graphql?query=%7B%20echo%20%7D"));
    expect(res.status).toBe(405);
  });

  test("subscription over HTTP is rejected", async () => {
    async function* sub() {
      yield { data: { tick: 1 } } as GraphQLExecutionResult;
    }
    const subExecutor: GraphQLExecutor = () => sub();
    const handler = createGraphQLHandler({ executor: subExecutor });
    const res = await handler(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "subscription { tick }" }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errors[0].message).toContain("WebSocket");
  });
});

// ============================================================================
// WebSocket transport (graphql-ws protocol)
// ============================================================================

describe("graphql-asijs — WebSocket transport", () => {
  function makeWs() {
    const sent: string[] = [];
    const ws = {
      send: (p: string) => sent.push(p),
      data: {},
    };
    return { ws, sent, sentJson: () => sent.map((s) => JSON.parse(s)) };
  }

  test("connection_init → connection_ack", () => {
    const t = createGraphQLWSTransport({ executor: async () => ({ data: {} }), keepAlive: 0 });
    const { ws, sentJson } = makeWs();
    t.open?.(ws);
    expect(sentJson()[0]).toMatchObject({ type: "connection_ack" });
  });

  test("query subscribe → next + complete", async () => {
    const executor: GraphQLExecutor = async () => ({ data: { hello: "world" } });
    const t = createGraphQLWSTransport({ executor, keepAlive: 0 });
    const { ws, sentJson } = makeWs();
    t.open?.(ws);
    await t.message?.(ws, JSON.stringify({ id: "1", type: "subscribe", payload: { query: "{ hello }" } }));
    const msgs = sentJson();
    expect(msgs[1]).toMatchObject({ id: "1", type: "next", payload: { data: { hello: "world" } } });
    expect(msgs[2]).toMatchObject({ id: "1", type: "complete" });
  });

  test("subscription streams next events and completes", async () => {
    async function* gen() {
      yield { data: { tick: 1 } };
      yield { data: { tick: 2 } };
    }
    const executor: GraphQLExecutor = () => gen();
    const t = createGraphQLWSTransport({ executor, keepAlive: 0 });
    const { ws, sentJson } = makeWs();
    t.open?.(ws);
    await t.message?.(ws, JSON.stringify({ id: "s1", type: "subscribe", payload: { query: "subscription { tick }" } }));
    // wait a tick for the async iterator to flush
    await new Promise((r) => setTimeout(r, 10));
    const msgs = sentJson();
    expect(msgs[1]).toMatchObject({ id: "s1", type: "next", payload: { data: { tick: 1 } } });
    expect(msgs[2]).toMatchObject({ id: "s1", type: "next", payload: { data: { tick: 2 } } });
    expect(msgs[3]).toMatchObject({ id: "s1", type: "complete" });
  });

  test("complete cancels a subscription", async () => {
    let cancelled = false;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    async function* gen() {
      try {
        yield { data: { tick: 1 } };
        await gate; // hold the stream open until the test releases it
      } finally {
        cancelled = true;
      }
    }
    const executor: GraphQLExecutor = () => gen();
    const t = createGraphQLWSTransport({ executor, keepAlive: 0 });
    const { ws, sentJson } = makeWs();
    t.open?.(ws);
    await t.message?.(ws, JSON.stringify({ id: "s1", type: "subscribe", payload: { query: "subscription { tick }" } }));
    await new Promise((r) => setTimeout(r, 5));
    // client requests cancellation → iterator.return() is invoked
    await t.message?.(ws, JSON.stringify({ id: "s1", type: "complete" }));
    release();
    await new Promise((r) => setTimeout(r, 5));
    expect(cancelled).toBe(true);
    // no complete message after cancellation
    const completes = sentJson().filter((m) => m.type === "complete");
    expect(completes).toHaveLength(0);
  });

  test("ping → pong", () => {
    const t = createGraphQLWSTransport({ executor: async () => ({ data: {} }), keepAlive: 0 });
    const { ws, sentJson } = makeWs();
    t.open?.(ws);
    t.message?.(ws, JSON.stringify({ type: "ping" }));
    expect(sentJson().some((m) => m.type === "pong")).toBe(true);
  });

  test("missing query in subscribe → error", async () => {
    const t = createGraphQLWSTransport({ executor: async () => ({ data: {} }), keepAlive: 0 });
    const { ws, sentJson } = makeWs();
    t.open?.(ws);
    await t.message?.(ws, JSON.stringify({ id: "1", type: "subscribe", payload: {} }));
    const err = sentJson().find((m) => m.id === "1" && m.type === "error");
    expect(err).toBeDefined();
  });
});

// ============================================================================
// Complexity
// ============================================================================

describe("graphql-asijs — query complexity", () => {
  const op = (selections: unknown[]): { kind: string; selectionSet: { selections: unknown[] } } => ({
    kind: "OperationDefinition",
    selectionSet: { selections },
  });
  const field = (name: string, sub?: unknown[]): { kind: string; name: { value: string }; selectionSet?: { selections: unknown[] } } => ({
    kind: "Field",
    name: { value: name },
    ...(sub ? { selectionSet: { selections: sub } } : {}),
  });

  test("computes flat complexity", () => {
    const r = calculateComplexity(op([field("a"), field("b"), field("c")]) as never);
    expect(r.complexity).toBe(3);
    expect(r.depth).toBe(1);
  });

  test("nested fields cost more than flat ones", () => {
    const deep = calculateComplexity(op([field("a", [field("b", [field("c")])])]) as never);
    const flat = calculateComplexity(op([field("a"), field("b"), field("c")]) as never);
    // depth-weighted: a@0=1 + b@1=2 + c@2=3 → 6 vs flat 1+1+1 → 3
    expect(deep.depth).toBe(3);
    expect(deep.complexity).toBe(6);
    expect(flat.complexity).toBe(3);
    expect(deep.complexity).toBeGreaterThan(flat.complexity);
  });

  test("violations for maxComplexity and maxDepth", () => {
    const r = calculateComplexity(
      op([field("a", [field("b")]), field("c"), field("d")]) as never,
      { maxComplexity: 3, maxDepth: 1 },
    );
    expect(r.violations.length).toBe(2);
  });

  test("custom scoreField", () => {
    const r = calculateComplexity(op([field("expensive"), field("cheap")]) as never, {
      scoreField: (name) => (name === "expensive" ? 10 : 1),
    });
    expect(r.complexity).toBe(11);
  });

  test("createComplexityRule reports via context", () => {
    const errors: string[] = [];
    const rule = createComplexityRule({ maxDepth: 1 });
    const visitor = rule({ reportError: (e) => errors.push((e as Error).message) });
    visitor.OperationDefinition?.(op([field("a", [field("b")])]) as never);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("maximum depth");
  });
});

// ============================================================================
// DataLoader
// ============================================================================

describe("graphql-asijs — DataLoader", () => {
  test("batches loads within a microtask", async () => {
    const calls: number[][] = [];
    const loader = new DataLoader<number, string>(async (keys) => {
      calls.push([...keys]);
      return keys.map((k) => `v${k}`);
    });
    const [a, b, c] = await Promise.all([loader.load(1), loader.load(2), loader.load(3)]);
    expect(a).toBe("v1");
    expect(b).toBe("v2");
    expect(c).toBe("v3");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([1, 2, 3]);
  });

  test("caches results per key", async () => {
    let batchCalls = 0;
    const loader = new DataLoader<number, string>(async (keys) => {
      batchCalls++;
      return keys.map((k) => `v${k}`);
    });
    await loader.load(1);
    await loader.load(1);
    await loader.load(2);
    expect(batchCalls).toBe(2); // key 1 cached; key 2 new batch
  });

  test("loadMany resolves per-key with Error", async () => {
    const loader = new DataLoader<number, string>(async (keys) =>
      keys.map((k) => (k === 2 ? new Error("missing " + k) : `v${k}`)),
    );
    const results = await loader.loadMany([1, 2, 3]);
    expect(results[0]).toBe("v1");
    expect(results[1]).toBeInstanceOf(Error);
    expect(results[2]).toBe("v3");
  });

  test("prime and clear", async () => {
    const loader = new DataLoader<number, string>(async (keys) => keys.map((k) => `v${k}`));
    loader.prime(1, "primed");
    expect(await loader.load(1)).toBe("primed");
    loader.clear(1);
    expect(await loader.load(1)).toBe("v1");
  });

  test("batch fn length mismatch rejects", async () => {
    const loader = new DataLoader<number, string>(async () => []);
    await expect(loader.load(1)).rejects.toThrow(/must return an array of 1 items/);
  });
});

// ============================================================================
// Federation
// ============================================================================

describe("graphql-asijs — federation", () => {
  const baseSdl = `
type Product @key(fields: "id") {
  id: String!
  name: String!
}
type Query {
  products: [Product]
}
`;

  test("extractEntityKeys finds @key types", () => {
    expect(extractEntityKeys(baseSdl)).toEqual(["Product"]);
  });

  test("federationSubgraph adds _service and _entities", () => {
    const fed = federationSubgraph({ sdl: baseSdl, name: "products" });
    expect(fed.entities).toEqual(["Product"]);
    expect(fed.sdl).toContain("extend schema @link");
    expect(fed.sdl).toContain("type _Service {\n  sdl: String!\n}");
    expect(fed.sdl).toContain("extend type Query {\n  _service: _Service!\n}");
    expect(fed.sdl).toContain("union _Entity = Product");
    const query = fed.resolvers.Query as Record<string, unknown>;
    expect(query._service).toBeDefined();
    expect(query._entities).toBeDefined();
  });

  test("_service returns the original SDL", () => {
    const fed = federationSubgraph({ sdl: baseSdl });
    const svc = (fed.resolvers.Query as Record<string, unknown>)._service as () => { sdl: string };
    expect(svc().sdl).toContain("type Product");
  });

  test("_entities resolves via reference resolvers", () => {
    const fed = federationSubgraph({
      sdl: baseSdl,
      references: {
        Product: (rep) => ({ ...rep, fetched: true }),
      },
    });
    const entities = (fed.resolvers.Query as Record<string, unknown>)._entities as (
      _p: unknown,
      a: { representations: Array<Record<string, unknown>> },
    ) => unknown[];
    const out = entities(null, {
      representations: [
        { __typename: "Product", id: "1" },
        { __typename: "Product", id: "2" },
      ],
    });
    expect(out).toEqual([
      { __typename: "Product", id: "1", fetched: true },
      { __typename: "Product", id: "2", fetched: true },
    ]);
  });

  test("resolveEntities passes through without references", () => {
    expect(resolveEntities([{ __typename: "X", id: "1" }])).toEqual([
      { __typename: "X", id: "1" },
    ]);
  });
});

// ============================================================================
// Playground + plugin
// ============================================================================

describe("graphql-asijs — playground & plugin", () => {
  test("playground HTML contains endpoint and run logic", () => {
    const html = renderPlaygroundHTML({ endpoint: "/gql", title: "My GQL" });
    expect(html).toContain("<title>My GQL</title>");
    expect(html).toContain('const endpoint = "/gql";');
    expect(html).toContain("fetch(endpoint");
    expect(html).toContain('id="query"');
    expect(html).toContain('id="response"');
  });

  test("graphql() plugin registers routes and ws", async () => {
    const routes = new Map<string, unknown>();
    const wsRoutes = new Map<string, unknown>();
    const app = {
      all: (p: string, h: unknown) => routes.set(p, h),
      get: (p: string, h: unknown) => routes.set(p, h),
      ws: (p: string, h: unknown) => wsRoutes.set(p, h),
    };
    const plugin = graphql({
      schema: defineSchema({
        queries: { ping: { type: Type.String(), resolve: () => "pong" } },
      }),
      executor: async () => ({ data: { ping: "pong" } }),
    });
    expect(plugin.name).toBe("graphql");
    plugin.apply(app as never);

    expect(routes.has("/graphql")).toBe(true);
    expect(routes.has("/graphql/playground")).toBe(true);
    expect(wsRoutes.has("/graphql/ws")).toBe(true);

    const handler = routes.get("/graphql") as (ctx: { request: Request }) => unknown;
    const res = await handler({ request: new Request("http://localhost/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "{ ping }" }),
    }) });
    expect(res).toBeInstanceOf(Response);
    const body = await (res as Response).json();
    expect(body.data.ping).toBe("pong");
  });

  test("federation option wraps the schema", () => {
    const plugin = graphql({
      schema: defineSchema({
        types: { Product: Type.Object({ id: Type.String() }) },
        queries: { product: { type: "Product", resolve: () => null } },
      }),
      federation: { name: "products" },
      executor: async () => ({ data: {} }),
    });
    const wsRoutes = new Map();
    const routes = new Map();
    plugin.apply({ all: (p, h) => routes.set(p, h), get: () => {}, ws: (p, h) => wsRoutes.set(p, h) } as never);
    expect(routes.has("/graphql")).toBe(true);
  });
});
