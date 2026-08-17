import { describe, it, expect, beforeEach } from "bun:test";
import { Asi, Type } from "../src/index";
import {
  registerFormat,
  getFormat,
  listFormats,
  resetFormats,
  formatForContentType,
  jsonFormat,
  createYamlFormat,
  registerYamlFormat,
  pickResponseFormat,
  type DataFormat,
} from "../src/formats";

// A tiny custom format for tests (deterministic, no deps)
const kvFormat: DataFormat = {
  name: "kv",
  contentTypes: ["application/x-kv"],
  extensions: [".kv"],
  contentType: "application/x-kv",
  parse: (text) => {
    const out: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const idx = line.indexOf("=");
      if (idx > 0) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    return out;
  },
  serialize: (value) =>
    Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join("\n"),
};

beforeEach(() => {
  resetFormats();
});

describe("formats registry", () => {
  it("registers JSON natively", () => {
    expect(getFormat("json")).toBeDefined();
    expect(getFormat("application/json")).toBeDefined();
    expect(listFormats().some((f) => f.name === "json")).toBe(true);
  });

  it("registers a custom format by name and content types", () => {
    registerFormat(kvFormat);
    expect(getFormat("kv")).toBe(kvFormat);
    expect(getFormat("application/x-kv")).toBe(kvFormat);
  });

  it("formatForContentType parses params and case", () => {
    expect(formatForContentType("application/json; charset=utf-8")).toBe(jsonFormat);
    expect(formatForContentType("Application/JSON")).toBe(jsonFormat);
    expect(formatForContentType("text/html")).toBeUndefined();
  });

  it("createYamlFormat parses and serializes YAML", () => {
    const fmt = createYamlFormat();
    expect(fmt.parse("a: 1\nb:\n  - x\n  - y")).toEqual({ a: 1, b: ["x", "y"] });
    const out = fmt.serialize({ hello: "world" });
    expect(out).toContain("hello: world");
  });

  it("registerYamlFormat is idempotent", () => {
    const a = registerYamlFormat();
    const b = registerYamlFormat();
    expect(a.name).toBe("yaml");
    expect(listFormats().filter((f) => f.name === "yaml")).toHaveLength(1);
    expect(b).toBe(a);
  });
});

describe("pickResponseFormat (negotiation)", () => {
  const ctx = (accept?: string) =>
    ({ request: { headers: { get: () => accept ?? null } } }) as any;

  it("returns null (JSON fast path) with only JSON registered", () => {
    expect(pickResponseFormat(ctx(), null)).toBeNull();
    expect(pickResponseFormat(ctx("application/yaml"), null)).toBeNull();
  });

  it("uses the default format when set", () => {
    const yaml = registerYamlFormat();
    const picked = pickResponseFormat(ctx(), yaml);
    expect(picked?.name).toBe("yaml");
  });

  it("negotiates Accept to a registered alternative", () => {
    const yaml = registerYamlFormat();
    const picked = pickResponseFormat(ctx("application/yaml"), null);
    expect(picked).toBe(yaml);
  });

  it("falls back to JSON when Accept is */* and default is JSON", () => {
    registerYamlFormat();
    expect(pickResponseFormat(ctx("*/*"), null)).toBeNull();
  });
});

describe("ctx.parseBody() — Content-Type parsing", () => {
  it("parses JSON by default", async () => {
    const app = new Asi({ silent: true });
    app.post("/t", async (ctx) => {
      const body = await ctx.parseBody<{ a: number }>();
      return { got: body };
    });
    const res = await app.handle(
      new Request("http://x/t", {
        method: "POST",
        body: JSON.stringify({ a: 1 }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(await res.json()).toEqual({ got: { a: 1 } });
  });

  it("parses YAML from Content-Type", async () => {
    registerYamlFormat();
    const app = new Asi({ silent: true });
    app.post("/t", async (ctx) => {
      const body = await ctx.parseBody<{ name: string }>();
      return { got: body };
    });
    const res = await app.handle(
      new Request("http://x/t", {
        method: "POST",
        body: "name: test\ncount: 3",
        headers: { "content-type": "application/yaml" },
      }),
    );
    expect(await res.json()).toEqual({ got: { name: "test", count: 3 } });
  });

  it("parses custom registered formats", async () => {
    registerFormat(kvFormat);
    const app = new Asi({ silent: true });
    app.post("/t", async (ctx) => {
      const body = await ctx.parseBody<{ a: string }>();
      return { got: body };
    });
    const res = await app.handle(
      new Request("http://x/t", {
        method: "POST",
        body: "a=1\nb=2",
        headers: { "content-type": "application/x-kv" },
      }),
    );
    expect(await res.json()).toEqual({ got: { a: "1", b: "2" } });
  });

  it("forces a format via the format argument", async () => {
    registerYamlFormat();
    const app = new Asi({ silent: true });
    app.post("/t", async (ctx) => {
      const body = await ctx.parseBody("yaml");
      return { got: body };
    });
    const res = await app.handle(
      new Request("http://x/t", {
        method: "POST",
        body: "x: 42",
        headers: { "content-type": "text/plain" },
      }),
    );
    expect(await res.json()).toEqual({ got: { x: 42 } });
  });

  it("returns the same parsed body on repeated calls", async () => {
    const app = new Asi({ silent: true });
    app.post("/t", async (ctx) => {
      const b1 = await ctx.parseBody<{ a: number }>();
      const b2 = await ctx.parseBody<{ a: number }>();
      return { same: b1 === b2 };
    });
    const res = await app.handle(
      new Request("http://x/t", {
        method: "POST",
        body: JSON.stringify({ a: 1 }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(await res.json()).toEqual({ same: true });
  });
});

describe("Asi.setFormat() / format option", () => {
  it("serializes object responses in YAML by default", async () => {
    registerYamlFormat();
    const app = new Asi({ silent: true, format: "yaml" });
    app.get("/", () => ({ hello: "world" }));
    const res = await app.handle(new Request("http://x/"));
    expect(res.headers.get("content-type")).toContain("application/yaml");
    expect(await res.text()).toContain("hello: world");
  });

  it("setFormat() switches format after construction", async () => {
    registerYamlFormat();
    const app = new Asi({ silent: true });
    app.get("/", () => ({ x: 1 }));
    expect((await app.handle(new Request("http://x/"))).headers.get("content-type")).toContain("application/json");
    app.setFormat("yaml");
    expect((await app.handle(new Request("http://x/"))).headers.get("content-type")).toContain("application/yaml");
  });

  it("Accept header negotiates to JSON when default is YAML", async () => {
    registerYamlFormat();
    const app = new Asi({ silent: true, format: "yaml" });
    app.get("/", () => ({ x: 1 }));
    const res = await app.handle(
      new Request("http://x/", { headers: { accept: "application/json" } }),
    );
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("Accept header negotiates to YAML even when default is JSON", async () => {
    registerYamlFormat();
    const app = new Asi({ silent: true });
    app.get("/", () => ({ x: 1 }));
    const res = await app.handle(
      new Request("http://x/", { headers: { accept: "application/yaml" } }),
    );
    expect(res.headers.get("content-type")).toContain("application/yaml");
  });

  it("errors are serialized in the default format", async () => {
    registerYamlFormat();
    const app = new Asi({ silent: true, format: "yaml" });
    app.get("/boom", () => {
      throw new Error("boom");
    });
    const res = await app.handle(new Request("http://x/boom"));
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/yaml");
    expect(await res.text()).toContain("error: boom");
  });

  it("validation errors are serialized in the default format", async () => {
    registerYamlFormat();
    const app = new Asi({ silent: true, format: "yaml" });
    app.post(
      "/v",
      (ctx) => ({ ok: true }),
      { schema: { body: Type.Object({ name: Type.String() }) } },
    );
    const res = await app.handle(
      new Request("http://x/v", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/yaml");
    expect(await res.text()).toContain("error: Validation Error");
  });

  it("404 bodies are serialized in the default format", async () => {
    registerYamlFormat();
    const app = new Asi({ silent: true, format: "yaml" });
    const res = await app.handle(new Request("http://x/nope"));
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/yaml");
    expect(await res.text()).toContain("error: Not Found");
  });

  it("custom formats serialize responses", async () => {
    registerFormat(kvFormat);
    const app = new Asi({ silent: true, format: kvFormat });
    app.get("/", () => ({ a: 1, b: 2 }));
    const res = await app.handle(new Request("http://x/"));
    expect(res.headers.get("content-type")).toContain("application/x-kv");
    expect(await res.text()).toBe("a=1\nb=2");
  });

  it("setFormat throws on unknown format", () => {
    const app = new Asi({ silent: true });
    expect(() => app.setFormat("nope")).toThrow(/Unknown format/);
  });

  it("works with compiled routes (app.compile)", async () => {
    registerYamlFormat();
    const app = new Asi({ silent: true, format: "yaml" });
    app.get("/static", () => ({ s: 1 }));
    app.get("/dyn/:id", (ctx) => ({ id: ctx.params.id }));
    app.compile();
    const r1 = await app.handle(new Request("http://x/static"));
    expect(r1.headers.get("content-type")).toContain("application/yaml");
    const r2 = await app.handle(new Request("http://x/dyn/42"));
    expect(r2.headers.get("content-type")).toContain("application/yaml");
    const text = await r2.text();
    expect(text).toContain("id:");
    expect(text).toContain("42");
  });
});

describe("strings / non-objects bypass the format layer", () => {
  it("keeps text/plain for strings", async () => {
    registerYamlFormat();
    const app = new Asi({ silent: true, format: "yaml" });
    app.get("/s", () => "plain");
    const res = await app.handle(new Request("http://x/s"));
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toBe("plain");
  });

  it("keeps 204 for null and 204/304 for undefined", async () => {
    registerYamlFormat();
    const app = new Asi({ silent: true, format: "yaml" });
    app.get("/n", () => null);
    app.get("/u", () => undefined);
    const r1 = await app.handle(new Request("http://x/n"));
    expect(r1.status).toBe(204);
    const r2 = await app.handle(new Request("http://x/u"));
    expect(r2.status).toBe(204);
  });

  it("passes through explicit Response objects untouched", async () => {
    registerYamlFormat();
    const app = new Asi({ silent: true, format: "yaml" });
    app.get("/r", () => Response.json({ custom: true }));
    const res = await app.handle(new Request("http://x/r"));
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ custom: true });
  });
});
