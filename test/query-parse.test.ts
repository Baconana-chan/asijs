import { describe, it, expect, afterEach } from "bun:test";
import {
  Asi,
  QueryParseCache,
  resetDefaultQueryCache,
  disableDefaultQueryCache,
  getDefaultQueryCache,
} from "../src";

afterEach(() => {
  resetDefaultQueryCache();
});

describe("QueryParseCache (2.2.6)", () => {
  it("caches parsed query strings keyed by string", () => {
    const cache = new QueryParseCache(16);
    cache.set("r\u0000q=1", { q: "1" });
    expect(cache.get("r\u0000q=1")).toEqual({ q: "1" });
    expect(cache.get("r\u0000q=2")).toBeUndefined();
    expect(cache.size).toBe(1);
  });

  it("evicts least-recently-used entries at capacity", () => {
    const cache = new QueryParseCache(2);
    cache.set("a", { v: "1" });
    cache.set("b", { v: "2" });
    cache.get("a"); // a becomes most-recent
    cache.set("c", { v: "3" }); // evicts b
    expect(cache.has("a")).toBe(true);
    expect(cache.has("c")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.size).toBe(2);
  });

  it("clear removes all entries", () => {
    const cache = new QueryParseCache(8);
    cache.set("a", { v: "1" });
    cache.set("b", { v: "2" });
    cache.clear();
    expect(cache.size).toBe(0);
  });
});

describe("Context query parsing (2.2.6)", () => {
  it("repeated query strings are served from cache (shallow copy each time)", async () => {
    const app = new Asi({ silent: true });
    app.get("/search", (ctx) => ({ q: ctx.query.q, page: ctx.query.page }));
    app.compile();

    const url = "http://localhost/search?q=hello&page=2";
    const r1 = await app.handle(new Request(url));
    const b1 = await r1.json();
    expect(b1).toEqual({ q: "hello", page: "2" });

    // Mutation of ctx.query in one request must not poison the cache
    app.get("/mutate", (ctx) => {
      ctx.query.q = "HACKED";
      return { q: ctx.query.q };
    });
    const rm = await app.handle(new Request("http://localhost/mutate?q=hello&page=2"));
    expect(await rm.json()).toEqual({ q: "HACKED" });

    // Subsequent request gets the clean cached value
    const r2 = await app.handle(new Request(url));
    const b2 = await r2.json();
    expect(b2).toEqual({ q: "hello", page: "2" });

    // Cache actually populated
    expect(getDefaultQueryCache()!.size).toBeGreaterThan(0);
  });

  it("decodeQuery: true decodes percent-encoded values", async () => {
    const app = new Asi({ silent: true, decodeQuery: true });
    app.get("/d", (ctx) => ({ q: ctx.query.q }));
    app.compile();
    const res = await app.handle(
      new Request("http://localhost/d?q=hello%20world%2C%20bob"),
    );
    expect(await res.json()).toEqual({ q: "hello world, bob" });
  });

  it("malformed percent-encoding does not throw (safeDecode)", async () => {
    const app = new Asi({ silent: true, decodeQuery: true });
    app.get("/m", (ctx) => ({ q: ctx.query.q, k: ctx.query.k }));
    app.compile();
    const res = await app.handle(
      new Request("http://localhost/m?q=%E0%A4%A&k=ok%2"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // Falls back to the raw string instead of throwing URIError
    expect(typeof body.q).toBe("string");
    expect(body.k).toBe("ok%2");
  });

  it("keys without values become empty strings", async () => {
    const app = new Asi({ silent: true });
    app.get("/k", (ctx) => ctx.query);
    app.compile();
    const res = await app.handle(new Request("http://localhost/k?a&b=1"));
    expect(await res.json()).toEqual({ a: "", b: "1" });
  });

  it("queryCache: false disables the shared cache", async () => {
    resetDefaultQueryCache();
    const app = new Asi({ silent: true, queryCache: false } as any);
    app.get("/c", (ctx) => ({ q: ctx.query.q }));
    app.compile();
    const res = await app.handle(new Request("http://localhost/c?q=test"));
    expect(await res.json()).toEqual({ q: "test" });
    // Cache disabled — module-level cache stays null
    expect(getDefaultQueryCache()).toBeNull();
  });

  it("queryCache as number sets the max size", () => {
    const app = new Asi({ silent: true, queryCache: 4 } as any);
    const cache = getDefaultQueryCache();
    expect(cache!.size).toBe(0);
    expect(cache!["max"]).toBe(4);
    // silence unused warning
    void app;
  });

  it("cached and uncached parses are identical", async () => {
    const url = "http://localhost/x?a=1&b=2&c=3&d=4";
    const app1 = new Asi({ silent: true });
    app1.get("/x", (ctx) => ctx.query);
    app1.compile();
    const r1 = await app1.handle(new Request(url));
    const first = await r1.json();

    // Second app instance with cache disabled — same result
    resetDefaultQueryCache();
    const app2 = new Asi({ silent: true, queryCache: false } as any);
    app2.get("/x", (ctx) => ctx.query);
    app2.compile();
    const r2 = await app2.handle(new Request(url));
    const second = await r2.json();

    expect(first).toEqual(second);
    expect(first).toEqual({ a: "1", b: "2", c: "3", d: "4" });
  });

  it("pooled contexts still use the cache across requests", async () => {
    const app = new Asi({ silent: true });
    app.get("/p", (ctx) => ({ v: ctx.query.v }));
    app.compile();
    for (let i = 0; i < 5; i++) {
      const res = await app.handle(new Request(`http://localhost/p?v=${i}`));
      expect(await res.json()).toEqual({ v: String(i) });
    }
  });
});

describe("disableDefaultQueryCache / resetDefaultQueryCache", () => {
  it("disable then reset restores caching", async () => {
    disableDefaultQueryCache();
    expect(getDefaultQueryCache()).toBeNull();

    resetDefaultQueryCache();
    expect(getDefaultQueryCache()).not.toBeNull();

    const app = new Asi({ silent: true });
    app.get("/", (ctx) => ({ q: ctx.query.q }));
    app.compile();
    const res = await app.handle(new Request("http://localhost/?q=x"));
    expect(await res.json()).toEqual({ q: "x" });
  });
});
