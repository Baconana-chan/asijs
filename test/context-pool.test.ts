/**
 * Tests for ContextPool — zero-allocation request cycle (2.2.3)
 *
 * Covers:
 * 1. ContextPool — acquire/release, reset, growth, shrink, stats
 * 2. Pooled context isolation — no cross-request state leakage
 * 3. Asi integration — default on, disable via config, concurrent requests
 */

import { describe, it, expect } from "bun:test";
import { Asi } from "../src/asi";
import { Context, ContextPool } from "../src/context";

// ============================================================================
// 1. ContextPool
// ============================================================================

describe("ContextPool", () => {
  it("should pre-allocate the configured size", () => {
    const pool = new ContextPool({ size: 10 });
    expect(pool.sizeNow).toBe(10);
    expect(pool.stats.created).toBe(10);
  });

  it("should return a reset context on acquire", () => {
    const pool = new ContextPool({ size: 5 });
    const ctx = pool.acquire(new Request("http://localhost/foo"), false);
    expect(ctx).toBeInstanceOf(Context);
    expect(ctx.path).toBe("/foo");
    expect(ctx.method).toBe("GET");
    expect(pool.sizeNow).toBe(4);
    pool.release(ctx);
    expect(pool.sizeNow).toBe(5);
  });

  it("should grow the pool when exhausted (no throw)", () => {
    const pool = new ContextPool({ size: 2 });
    const c1 = pool.acquire(new Request("http://localhost/1"), false);
    const c2 = pool.acquire(new Request("http://localhost/2"), false);
    const c3 = pool.acquire(new Request("http://localhost/3"), false);
    expect(pool.sizeNow).toBe(0);
    expect(c3.path).toBe("/3");
    expect(pool.stats.created).toBeGreaterThanOrEqual(3);
    pool.release(c1);
    pool.release(c2);
    pool.release(c3);
    expect(pool.sizeNow).toBe(3);
  });

  it("should not exceed the max retained pool size", () => {
    const pool = new ContextPool({ size: 2, max: 3 });
    const contexts = [
      pool.acquire(new Request("http://localhost/1"), false),
      pool.acquire(new Request("http://localhost/2"), false),
      pool.acquire(new Request("http://localhost/3"), false),
      pool.acquire(new Request("http://localhost/4"), false),
    ];
    for (const ctx of contexts) pool.release(ctx);
    expect(pool.sizeNow).toBeLessThanOrEqual(3);
  });

  it("should reset middleware-added properties on release", () => {
    const pool = new ContextPool({ size: 2 });
    const ctx = pool.acquire(new Request("http://localhost/a"), false);
    (ctx as any).user = { id: 1 };
    (ctx as any).apiVersion = "v1";
    pool.release(ctx);

    // Next acquire — user/apiVersion must be gone
    const ctx2 = pool.acquire(new Request("http://localhost/b"), false);
    expect((ctx2 as any).user).toBeUndefined();
    expect((ctx2 as any).apiVersion).toBeUndefined();
    expect(ctx2.path).toBe("/b");
  });

  it("should not leak set cookies or headers across requests", () => {
    const pool = new ContextPool({ size: 2 });
    const ctx = pool.acquire(new Request("http://localhost/a"), false);
    ctx.setCookie("session", "xyz", { httpOnly: true });
    ctx.setHeader("X-Custom", "yes");
    pool.release(ctx);

    const ctx2 = pool.acquire(new Request("http://localhost/b"), false);
    expect((ctx2 as any)._setCookies.length).toBe(0);
    expect((ctx2 as any)._headers.get("X-Custom")).toBeNull();
    expect(ctx2.status(204).responseStatus).toBe(204);
  });

  it("should clear lazily-parsed query/body/cookies state", async () => {
    const pool = new ContextPool({ size: 2 });
    const ctx = pool.acquire(
      new Request("http://localhost/a?q=1&r=2", {
        method: "POST",
        body: JSON.stringify({ hello: "world" }),
        headers: { "Content-Type": "application/json", Cookie: "a=1" },
      }),
      false,
    );
    expect(ctx.query).toEqual({ q: "1", r: "2" });
    expect(await ctx.json()).toEqual({ hello: "world" });
    expect(ctx.cookies).toEqual({ a: "1" });
    pool.release(ctx);

    const ctx2 = pool.acquire(new Request("http://localhost/b"), false);
    expect(ctx2.query).toEqual({});
    expect((ctx2 as any)._body).toBeUndefined();
    expect(ctx2.cookies).toEqual({});
  });

  it("should track lifecycle stats", () => {
    const pool = new ContextPool({ size: 1 });
    const ctx = pool.acquire(new Request("http://localhost/"), false);
    expect(pool.stats.acquired).toBe(1);
    pool.release(ctx);
    expect(pool.stats.released).toBe(1);
  });

  it("should shrink back to size after an idle interval", async () => {
    const pool = new ContextPool({ size: 2, max: 10, shrinkIntervalMs: 5 });
    const contexts = [
      pool.acquire(new Request("http://localhost/1"), false),
      pool.acquire(new Request("http://localhost/2"), false),
      pool.acquire(new Request("http://localhost/3"), false),
      pool.acquire(new Request("http://localhost/4"), false),
    ];
    for (const ctx of contexts) pool.release(ctx);
    expect(pool.sizeNow).toBeGreaterThan(2);
    await new Promise((r) => setTimeout(r, 30));
    expect(pool.sizeNow).toBe(2);
  });
});

// ============================================================================
// 2. Asi integration
// ============================================================================

describe("Asi — context pool integration", () => {
  it("should enable the context pool by default", () => {
    const app = new Asi({ silent: true } as any);
    expect((app as any).contextPool).not.toBeNull();

    const disabled = new Asi({ silent: true, contextPool: false } as any);
    expect((disabled as any).contextPool).toBeNull();
  });

  it("should handle sequential requests without cross-request leakage", async () => {
    const app = new Asi({ silent: true } as any);
    app.use((ctx) => {
      (ctx as any).requestTag = ctx.path;
    });
    app.get("/a", (ctx) => ({
      tag: (ctx as any).requestTag,
      path: ctx.path,
    }));
    app.get("/b", (ctx) => ({
      tag: (ctx as any).requestTag,
      path: ctx.path,
    }));

    const r1 = await app.handle(new Request("http://localhost/a"));
    const b1 = await r1.json();
    expect(b1.path).toBe("/a");
    expect(b1.tag).toBe("/a");

    const r2 = await app.handle(new Request("http://localhost/b"));
    const b2 = await r2.json();
    expect(b2.path).toBe("/b");
    expect(b2.tag).toBe("/b");
  });

  it("should handle concurrent requests safely (distinct contexts)", async () => {
    const app = new Asi({ silent: true, contextPool: { size: 2 } } as any);
    app.get("/slow/:id", async (ctx) => {
      await new Promise((r) => setTimeout(r, 5));
      return { id: ctx.params.id };
    });

    const results = await Promise.all([
      app.handle(new Request("http://localhost/slow/1")),
      app.handle(new Request("http://localhost/slow/2")),
      app.handle(new Request("http://localhost/slow/3")),
      app.handle(new Request("http://localhost/slow/4")),
    ]);

    const bodies = await Promise.all(results.map((r) => r.json()));
    expect(bodies.map((b) => b.id).sort()).toEqual(["1", "2", "3", "4"]);
  });

  it("should return pooled contexts to the pool after requests", async () => {
    const app = new Asi({ silent: true, contextPool: { size: 4 } } as any);
    const pool = (app as any).contextPool as ContextPool;
    app.get("/", () => ({ ok: true }));

    for (let i = 0; i < 10; i++) {
      await app.handle(new Request("http://localhost/"));
    }

    // All 4 pre-allocated contexts were released back
    expect(pool.sizeNow).toBe(4);
    expect(pool.stats.released).toBe(10);
  });

  it("should work with the error path (pooled ctx released after handleError)", async () => {
    const app = new Asi({ silent: true, contextPool: { size: 2 } } as any);
    app.get("/boom", () => {
      throw new Error("kaboom");
    });
    app.get("/ok", () => "fine");

    const r1 = await app.handle(new Request("http://localhost/boom"));
    expect(r1.status).toBe(500);

    const r2 = await app.handle(new Request("http://localhost/ok"));
    expect(await r2.text()).toBe("fine");
  });

  it("should work with the 404 error page path", async () => {
    const app = new Asi({ development: true, silent: true } as any);
    app.get("/exists", () => "home");

    const res = await app.handle(
      new Request("http://localhost/missing", {
        headers: { "sec-fetch-dest": "document" },
      }),
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("/missing");
  });

  it("should apply Set-Cookie through the pooled request cycle", async () => {
    const app = new Asi({ silent: true, contextPool: { size: 2 } } as any);
    app.get("/login", (ctx) => {
      ctx.setCookie("session", "abc123", { httpOnly: true });
      return { ok: true };
    });

    const res = await app.handle(new Request("http://localhost/login"));
    const setCookie = res.headers.get("Set-Cookie");
    expect(setCookie).toContain("session=abc123");
    expect(setCookie).toContain("HttpOnly");
  });
});
