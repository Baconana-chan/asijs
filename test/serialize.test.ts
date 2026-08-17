import { describe, expect, test, beforeEach } from "bun:test";
import { Type } from "@sinclair/typebox";
import { Asi } from "../src";
import {
  compileSerializer,
  compileResponseSerializer,
  resolveResponseSchema,
  isResponseSchemaMap,
  wrapWithResponseSerializer,
  pickContentType,
  serializeForCache,
  deserializeFromCache,
  resetSerializerCache,
} from "../src";

const User = Type.Object({
  id: Type.Number(),
  name: Type.String(),
  active: Type.Boolean(),
});

// ============================================================================
// compileSerializer — correctness
// ============================================================================

describe("serialize — compileSerializer", () => {
  beforeEach(() => resetSerializerCache());

  test("flat object equals JSON.stringify", () => {
    const s = compileSerializer(User);
    const data = { id: 1, name: "Ada", active: true };
    expect(s(data)).toBe(JSON.stringify(data));
  });

  test("integer and number both serialize", () => {
    const s = compileSerializer(Type.Object({ i: Type.Integer(), f: Type.Number() }));
    expect(s({ i: 3, f: 3.5 })).toBe('{"i":3,"f":3.5}');
  });

  test("optional field omitted when undefined, included when present", () => {
    const s = compileSerializer(
      Type.Object({ id: Type.Number(), email: Type.Optional(Type.String()) }),
    );
    expect(s({ id: 1 })).toBe('{"id":1}');
    expect(s({ id: 1, email: "a@b.c" })).toBe('{"id":1,"email":"a@b.c"}');
  });

  test("nested object", () => {
    const s = compileSerializer(
      Type.Object({
        user: User,
        tags: Type.Array(Type.String()),
      }),
    );
    const data = { user: { id: 2, name: "B", active: false }, tags: ["x", "y"] };
    expect(s(data)).toBe(JSON.stringify(data));
  });

  test("array of objects", () => {
    const s = compileSerializer(Type.Array(User));
    const data = [
      { id: 1, name: "A", active: true },
      { id: 2, name: "B", active: false },
    ];
    expect(s(data)).toBe(JSON.stringify(data));
  });

  test("nested arrays", () => {
    const s = compileSerializer(Type.Array(Type.Array(Type.Integer())));
    const data = [[1, 2], [3], []];
    expect(s(data)).toBe(JSON.stringify(data));
  });

  test("escaping: quotes, backslash, unicode, control chars", () => {
    const s = compileSerializer(Type.Object({ name: Type.String() }));
    const samples = [
      { name: 'say "hi"' },
      { name: "back\\slash" },
      { name: "héllo → 世界" },
      { name: "line\nbreak\ttab" },
      { name: "emoji 🎉" },
      { name: "\u0000\u001f" },
    ];
    for (const d of samples) expect(s(d)).toBe(JSON.stringify(d));
  });

  test("null values serialize as null", () => {
    const s = compileSerializer(Type.Object({ id: Type.Number(), name: Type.String() }));
    const data = { id: 1, name: null };
    expect(s(data)).toBe(JSON.stringify(data));
  });

  test("literal enum-like unions compile", () => {
    const s = compileSerializer(
      Type.Object({ role: Type.Union([Type.Literal("admin"), Type.Literal("user")]) }),
    );
    expect(s({ role: "admin" })).toBe('{"role":"admin"}');
  });

  test("falls back to JSON.stringify for unions of objects", () => {
    const s = compileSerializer(
      Type.Union([User, Type.Object({ ok: Type.Boolean() })]),
    );
    const data = { ok: true };
    expect(s(data)).toBe(JSON.stringify(data));
  });

  test("empty object → {}", () => {
    const s = compileSerializer(Type.Object({}));
    expect(s({})).toBe("{}");
  });

  test("null root → null", () => {
    const s = compileSerializer(User);
    expect(s(null)).toBe("null");
  });

  test("cached — same schema returns same fn", () => {
    const a = compileSerializer(User);
    const b = compileSerializer(User);
    expect(a).toBe(b);
  });

  test("random data equality with JSON.stringify", () => {
    const s = compileSerializer(
      Type.Object({
        id: Type.Number(),
        name: Type.String(),
        tags: Type.Array(Type.String()),
        meta: Type.Object({ score: Type.Number(), ok: Type.Boolean() }),
        note: Type.Optional(Type.String()),
      }),
    );
    for (let i = 0; i < 50; i++) {
      const data = {
        id: i,
        name: `n${i} "q" \\ \n`,
        tags: Array.from({ length: i % 4 }, (_, j) => `t${j}:${i}`),
        meta: { score: i / 3, ok: i % 2 === 0 },
        ...(i % 3 === 0 ? { note: `note-${i}` } : {}),
      };
      expect(s(data)).toBe(JSON.stringify(data));
    }
  });
});

// ============================================================================
// Status-keyed response schemas
// ============================================================================

describe("serialize — status-keyed response schemas", () => {
  test("isResponseSchemaMap detects status maps", () => {
    expect(isResponseSchemaMap({ 200: User })).toBe(true);
    expect(isResponseSchemaMap({ "2xx": User, default: User })).toBe(true);
    expect(isResponseSchemaMap(User)).toBe(false);
    expect(isResponseSchemaMap({})).toBe(false);
  });

  test("resolveResponseSchema: exact > 2xx > default", () => {
    const map = { 200: User, "4xx": User, default: User } as const;
    expect(resolveResponseSchema(map, 200)).toBe(map[200]);
    expect(resolveResponseSchema(map, 404)).toBe(map["4xx"]);
    expect(resolveResponseSchema(map, 500)).toBe(map.default);
    expect(resolveResponseSchema(User, 200)).toBe(User);
    expect(resolveResponseSchema(undefined, 200)).toBeNull();
  });

  test("compileResponseSerializer single schema applies to any status", () => {
    const s = compileResponseSerializer(User);
    expect(s({ id: 1, name: "A", active: true }, 200)).toBe(
      JSON.stringify({ id: 1, name: "A", active: true }),
    );
    expect(s({ id: 1, name: "A", active: true }, 404)).not.toBeNull();
  });

  test("compileResponseSerializer status map", () => {
    const s = compileResponseSerializer({
      200: Type.Object({ id: Type.Number() }),
      "4xx": Type.Object({ error: Type.String() }),
    });
    expect(s({ id: 5 }, 200)).toBe('{"id":5}');
    expect(s({ error: "nope" }, 404)).toBe('{"error":"nope"}');
    // unmatched status → null (caller falls back to default JSON)
    expect(s({ anything: 1 }, 500)).toBeNull();
  });
});

// ============================================================================
// wrapWithResponseSerializer + content-type negotiation
// ============================================================================

describe("serialize — route wrapper", () => {
  const ctx = (over: Record<string, unknown> = {}) =>
    ({
      request: new Request("http://localhost/"),
      ...over,
    }) as never;

  test("object result → serialized JSON Response", async () => {
    const wrapped = wrapWithResponseSerializer(
      async () => ({ id: 1, name: "Ada" }),
      { response: User },
    );
    const res = await wrapped(ctx());
    expect(res).toBeInstanceOf(Response);
    expect(await res.text()).toBe('{"id":1,"name":"Ada","active":null}');
    expect(res.headers.get("Content-Type")).toContain("application/json");
  });

  test("Response / string / undefined / null pass through", async () => {
    const response = new Response("raw");
    const s = compileSerializer(User);
    const wrapped = wrapWithResponseSerializer(
      async (c: { which: string }) => {
        if (c.which === "res") return response;
        if (c.which === "str") return "text";
        if (c.which === "undef") return undefined;
        if (c.which === "null") return null;
        return {};
      },
      { response: User },
    );
    expect(await wrapped(ctx({ which: "res" }))).toBe(response);
    expect(await wrapped(ctx({ which: "str" }))).toBe("text");
    expect(await wrapped(ctx({ which: "undef" }))).toBeUndefined();
    expect(await wrapped(ctx({ which: "null" }))).toBeNull();
    void s;
  });

  test("honors ctx status", async () => {
    const wrapped = wrapWithResponseSerializer(
      async () => ({ id: 1, name: "A", active: true }),
      { response: User },
    );
    const res = await wrapped(ctx({ _status: 201 }));
    expect(res.status).toBe(201);
  });

  test("content-type negotiation via Accept header", async () => {
    const wrapped = wrapWithResponseSerializer(
      async () => ({ id: 1, name: "A", active: true }),
      {
        serializers: {
          "application/vnd.api+json": Type.Object({ id: Type.Number() }),
          "application/msgpack": (v: unknown) => `bin:${(v as { id: number }).id}`,
        },
      },
    );
    const jsonApi = await wrapped(
      ctx({ request: new Request("http://localhost/", { headers: { Accept: "application/vnd.api+json" } }) }),
    );
    expect(await jsonApi.text()).toBe('{"id":1}');
    const msgpack = await wrapped(
      ctx({ request: new Request("http://localhost/", { headers: { Accept: "application/msgpack" } }) }),
    );
    expect(await msgpack.text()).toBe("bin:1");
    // no Accept → falls through to default JSON path (returned object)
    const fallback = await wrapped(ctx());
    expect(fallback).toEqual({ id: 1, name: "A", active: true });
  });

  test("pickContentType matches in Accept order, handles wildcard", () => {
    expect(pickContentType("application/json", ["application/json", "text/x"])).toBe("application/json");
    expect(pickContentType("text/plain; q=0.8, application/vnd.api+json", ["application/json", "application/vnd.api+json"])).toBe("application/vnd.api+json");
    expect(pickContentType("*/*", ["application/json", "text/x"])).toBe("application/json");
    expect(pickContentType("image/png", ["application/json"])).toBeNull();
  });
});

// ============================================================================
// V8.serialize helpers
// ============================================================================

describe("serialize — cache helpers", () => {
  test("serializeForCache / deserializeFromCache round-trip", () => {
    const obj = { a: 1, b: [1, 2, 3], c: { deep: "value" } };
    const bytes = serializeForCache(obj);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(deserializeFromCache(bytes)).toEqual(obj);
  });
});

// ============================================================================
// Route integration (real AsiJS app)
// ============================================================================

describe("serialize — route integration", () => {
  const makeApp = (opts: { compiled?: boolean } = {}) => {
    const app = new Asi({ silent: true } as never);
    app.get(
      "/user",
      (ctx: { status: (n: number) => void }) => {
        if (opts.compiled === false) ctx.status(200);
        return { id: 1, name: "Ada", active: true };
      },
      { schema: { response: User } } as never,
    );
    app.get(
      "/created",
      (ctx: { status: (n: number) => void }) => {
        ctx.status(201);
        return { id: 2, name: "Grace", active: false };
      },
      { schema: { response: User } } as never,
    );
    if (opts.compiled) app.compile();
    return app;
  };

  test("non-compiled: response schema serializes body", async () => {
    const app = makeApp();
    const res = await app.handle(new Request("http://localhost/user"));
    expect(await res.text()).toBe('{"id":1,"name":"Ada","active":true}');
    expect(res.headers.get("Content-Type")).toContain("application/json");
  });

  test("compiled: response schema serializes body", async () => {
    const app = makeApp({ compiled: true });
    const res = await app.handle(new Request("http://localhost/user"));
    expect(await res.text()).toBe('{"id":1,"name":"Ada","active":true}');
  });

  test("compiled: status preserved through serializer", async () => {
    const app = makeApp({ compiled: true });
    const res = await app.handle(new Request("http://localhost/created"));
    expect(res.status).toBe(201);
    expect(await res.text()).toBe('{"id":2,"name":"Grace","active":false}');
  });

  test("status-keyed response schema picks serializer by status", async () => {
    const app = new Asi({ silent: true } as never);
    app.get(
      "/data",
      (ctx: { status: (n: number) => void }) => {
        ctx.status(404);
        return { error: "missing" };
      },
      {
        schema: {
          response: {
            200: Type.Object({ id: Type.Number() }),
            "4xx": Type.Object({ error: Type.String() }),
          },
        },
      } as never,
    );
    app.compile();
    const res = await app.handle(new Request("http://localhost/data"));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('{"error":"missing"}');
  });

  test("serializers content-type option via Accept", async () => {
    const app = new Asi({ silent: true } as never);
    app.get(
      "/api",
      () => ({ id: 7 }),
      {
        serializers: { "application/vnd.api+json": Type.Object({ id: Type.Number() }) },
      } as never,
    );
    app.compile();
    const res = await app.handle(
      new Request("http://localhost/api", { headers: { Accept: "application/vnd.api+json" } }),
    );
    expect(await res.text()).toBe('{"id":7}');
  });

  test("Set-Cookie preserved through serializer", async () => {
    const app = new Asi({ silent: true } as never);
    app.use(async (ctx: any, next: () => unknown) => {
      ctx.setCookie("sid", "abc");
      return next();
    });
    app.get(
      "/with-cookie",
      () => ({ id: 1, name: "A", active: true }),
      { schema: { response: User } } as never,
    );
    const res = await app.handle(new Request("http://localhost/with-cookie"));
    expect(res.headers.get("Set-Cookie")).toContain("sid=abc");
    expect(await res.text()).toBe('{"id":1,"name":"A","active":true}');
  });
});
