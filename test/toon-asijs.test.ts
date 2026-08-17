/**
 * Integration tests: toon-asijs package ↔ AsiJS formats layer.
 *
 * Verifies the full user-facing path:
 *   registerToonFormat()/registerFormat(createToonFormat())
 *   → setFormat("toon") / new Asi({ format: "toon" })
 *   → TOON request parsing (ctx.parseBody by Content-Type)
 *   → TOON response serialization + Accept-negotiation
 *   → errors & 404 bodies in TOON
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { Asi, Type, registerFormat, listFormats, resetFormats } from "../src/index";
import { createToonFormat, TOON_CONTENT_TYPE } from "../packages/toon-asijs/src/index";

beforeEach(() => {
  resetFormats(); // registry back to JSON-only
});

/** Build a request helper against a fresh Asi app. */
function request(app: Asi, path: string, init?: RequestInit): Promise<Response> {
  return app.handle(new Request(`http://localhost${path}`, init));
}

describe("toon-asijs ↔ AsiJS integration", () => {
  it("registers the TOON format into the core registry", () => {
    registerFormat(createToonFormat());
    expect(listFormats().some((f) => f.name === "toon")).toBe(true);
    expect(listFormats().some((f) => f.contentTypes.includes("application/toon"))).toBe(true);
  });

  it("serializes responses to TOON with format: \"toon\" option", async () => {
    registerFormat(createToonFormat());
    const app = new Asi({ format: "toon", silent: true } as never);
    app.get("/", () => ({ hello: "world", n: 42 }));

    const res = await request(app, "/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain(TOON_CONTENT_TYPE);
    const body = await res.text();
    expect(body).toContain("hello:");
    expect(body).toContain("world");
    expect(body).not.toContain("{");
  });

  it("serializes responses to TOON via setFormat(\"toon\") after registration", async () => {
    registerFormat(createToonFormat());
    const app = new Asi({ silent: true } as never);
    app.setFormat("toon");
    app.get("/", () => ({ items: [{ id: 1 }, { id: 2 }] }));

    const res = await request(app, "/");
    const body = await res.text();
    expect(body).toContain("items[2]{id}:");
    expect(res.headers.get("content-type")).toContain(TOON_CONTENT_TYPE);
  });

  it("accepts a DataFormat object directly in setFormat()", async () => {
    const app = new Asi({ silent: true } as never);
    app.setFormat(createToonFormat());
    app.get("/", () => ({ ok: true }));

    const res = await request(app, "/");
    expect((await res.text()).trim()).toContain("ok: true");
    expect(res.headers.get("content-type")).toContain(TOON_CONTENT_TYPE);
  });

  it("parses TOON request bodies by Content-Type", async () => {
    registerFormat(createToonFormat());
    const app = new Asi({ silent: true } as never);
    app.post("/echo", async (ctx) => {
      const body = await ctx.parseBody<{ name: string; age: number }>();
      return { received: body.name, age: body.age };
    });

    const toonBody = "name: Ada\nage: 36\n";
    const res = await request(app, "/echo", {
      method: "POST",
      headers: { "Content-Type": TOON_CONTENT_TYPE },
      body: toonBody,
    });
    expect(res.status).toBe(200);
    const parsed = (await res.json()) as { received: string; age: number };
    expect(parsed.received).toBe("Ada");
    expect(parsed.age).toBe(36);
  });

  it("parses TOON bodies with an explicit format argument", async () => {
    registerFormat(createToonFormat());
    const app = new Asi({ silent: true } as never);
    app.post("/forced", async (ctx) => {
      const body = await ctx.parseBody<{ x: number }>("toon");
      return body;
    });

    const res = await request(app, "/forced", {
      method: "POST",
      headers: { "Content-Type": "text/plain" }, // Content-Type ignored — explicit format wins
      body: "x: 7\n",
    });
    expect(await res.json()).toEqual({ x: 7 });
  });

  it("parses tabular TOON arrays from request bodies", async () => {
    registerFormat(createToonFormat());
    const app = new Asi({ silent: true } as never);
    app.post("/rows", async (ctx) => {
      const body = await ctx.parseBody<{ items: Array<{ sku: string; qty: number }> }>();
      return { count: body.items.length, first: body.items[0] };
    });

    const res = await request(app, "/rows", {
      method: "POST",
      headers: { "Content-Type": TOON_CONTENT_TYPE },
      body: "items[2]{sku,qty}:\n  A1,2\n  B2,1\n",
    });
    const parsed = (await res.json()) as { count: number; first: { sku: string; qty: number } };
    expect(parsed.count).toBe(2);
    expect(parsed.first).toEqual({ sku: "A1", qty: 2 });
  });

  it("honors Accept: application/json when TOON is the default", async () => {
    registerFormat(createToonFormat());
    const app = new Asi({ format: "toon", silent: true } as never);
    app.get("/", () => ({ a: 1 }));

    const res = await request(app, "/", { headers: { Accept: "application/json" } });
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ a: 1 });
  });

  it("negotiates TOON via Accept when JSON is the default", async () => {
    registerFormat(createToonFormat());
    const app = new Asi({ silent: true } as never); // default = JSON
    app.get("/", () => ({ a: 1 }));

    const res = await request(app, "/", { headers: { Accept: "application/toon" } });
    expect(res.headers.get("content-type")).toContain(TOON_CONTENT_TYPE);
    expect((await res.text()).trim()).toBe("a: 1");
  });

  it("serializes 500 error bodies in TOON", async () => {
    registerFormat(createToonFormat());
    const app = new Asi({ format: "toon", silent: true } as never);
    app.get("/boom", () => {
      throw new Error("kaboom");
    });

    const res = await request(app, "/boom");
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain(TOON_CONTENT_TYPE);
    const body = await res.text();
    // Error object is serialized as TOON key-value lines (stack is a quoted TOON string).
    expect(body).toContain("error: kaboom");
    expect(body).toContain("stack:");
    expect(body).not.toContain('{"');
  });

  it("serializes 404 bodies in TOON", async () => {
    registerFormat(createToonFormat());
    const app = new Asi({ format: "toon", silent: true } as never);

    const res = await request(app, "/missing");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain(TOON_CONTENT_TYPE);
    const body = await res.text();
    expect(body).toContain("error: Not Found");
  });

  it("works end-to-end: TOON in → TOON out through validation", async () => {
    registerFormat(createToonFormat());
    const app = new Asi({ format: "toon", silent: true } as never);
    app.post(
      "/users",
      async (ctx) => {
        const body = ctx.body as { name: string; age: number };
        return { created: { name: body.name, age: body.age } };
      },
      {
        schema: {
          body: Type.Object({ name: Type.String(), age: Type.Number() }),
        },
      },
    );

    const res = await request(app, "/users", {
      method: "POST",
      headers: { "Content-Type": TOON_CONTENT_TYPE },
      body: "name: Ada\nage: 36\n",
    });
    expect(res.status).toBe(200);
    const out = await res.text();
    expect(out).toContain("created:");
    expect(out).toContain("name: Ada");
    expect(out).toContain("age: 36");
  });

  it("works through the compiled route path (app.compile()) too", async () => {
    registerFormat(createToonFormat());
    const app = new Asi({ format: "toon", development: false, silent: true } as never);
    app.post(
      "/users",
      async (ctx) => {
        const body = ctx.body as { name: string; age: number };
        return { created: { name: body.name, age: body.age } };
      },
      {
        schema: {
          body: Type.Object({ name: Type.String(), age: Type.Number() }),
        },
      },
    );
    app.get("/meta", () => ({ ok: true }));
    app.compile();

    // TOON body parsed + validated + response serialized to TOON (compiled path)
    const res = await request(app, "/users", {
      method: "POST",
      headers: { "Content-Type": TOON_CONTENT_TYPE },
      body: "name: Ada\nage: 36\n",
    });
    expect(res.status).toBe(200);
    const out = await res.text();
    expect(out).toContain("created:");
    expect(out).toContain("name: Ada");
    expect(out).toContain("age: 36");

    // Simple route also respects the default format after compile
    const meta = await request(app, "/meta");
    expect(meta.headers.get("content-type")).toContain(TOON_CONTENT_TYPE);
    expect((await meta.text()).trim()).toBe("ok: true");
  });
});
