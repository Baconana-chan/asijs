/**
 * Tests for Router Performance Optimizations (P3.8)
 *
 * Covers:
 * 1. SchemaCacheLRU — bounded LRU cache (eviction, order, clear)
 * 2. MiddlewareChainFlattener — compile-time chain flattening
 * 3. RadixTreeRouter — compressed radix tree (static, param, wildcard, mixed)
 * 4. Integration with Asi app (radix router mode, flattened middleware, LRU cache)
 */

import { describe, it, expect } from "bun:test";
import { Asi } from "../src/asi";
import {
  SchemaCacheLRU,
  MiddlewareChainFlattener,
  RadixTreeRouter,
  getDefaultSchemaCache,
  resetDefaultSchemaCache,
} from "../src/router-perf";
import { Type } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { Context } from "../src/context";

// ============================================================================
// 1. SchemaCacheLRU
// ============================================================================

describe("SchemaCacheLRU", () => {
  it("should store and retrieve entries", () => {
    const cache = new SchemaCacheLRU(10);
    const schema = Type.String();
    const compiled = TypeCompiler.Compile(schema);

    cache.set(schema, compiled);
    expect(cache.has(schema)).toBe(true);
    expect(cache.get(schema)).toBe(compiled);
    expect(cache.size).toBe(1);
  });

  it("should return undefined for missing entries", () => {
    const cache = new SchemaCacheLRU(10);
    const schema = Type.Number();
    expect(cache.get(schema)).toBeUndefined();
    expect(cache.has(schema)).toBe(false);
  });

  it("should evict least-recently-used entries when at capacity", () => {
    const cache = new SchemaCacheLRU(3);
    const s1 = Type.String();
    const s2 = Type.Number();
    const s3 = Type.Boolean();
    const s4 = Type.Object({ x: Type.Number() });

    const c1 = TypeCompiler.Compile(s1);
    const c2 = TypeCompiler.Compile(s2);
    const c3 = TypeCompiler.Compile(s3);
    const c4 = TypeCompiler.Compile(s4);

    cache.set(s1, c1);
    cache.set(s2, c2);
    cache.set(s3, c3);

    // Access s2 to make it recently used
    cache.get(s2);

    // Add s4 — should evict s1 (oldest unused)
    cache.set(s4, c4);

    expect(cache.has(s4)).toBe(true);
    expect(cache.has(s2)).toBe(true);
    expect(cache.has(s3)).toBe(true);
    // s1 should have been evicted
    expect(cache.has(s1)).toBe(false);
    expect(cache.size).toBe(3);
  });

  it("should reorder on get (mark as recently used)", () => {
    const cache = new SchemaCacheLRU(2);
    const s1 = Type.String();
    const s2 = Type.Number();
    const s3 = Type.Boolean();

    const c1 = TypeCompiler.Compile(s1);
    const c2 = TypeCompiler.Compile(s2);
    const c3 = TypeCompiler.Compile(s3);

    cache.set(s1, c1);
    cache.set(s2, c2);

    // Access s1 — now it's recently used
    cache.get(s1);

    // Add s3 — should evict s2 (oldest)
    cache.set(s3, c3);

    expect(cache.has(s1)).toBe(true);
    expect(cache.has(s3)).toBe(true);
    expect(cache.has(s2)).toBe(false);
  });

  it("should clear all entries", () => {
    const cache = new SchemaCacheLRU(10);
    const s1 = Type.String();
    const s2 = Type.Number();

    cache.set(s1, TypeCompiler.Compile(s1));
    cache.set(s2, TypeCompiler.Compile(s2));

    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.has(s1)).toBe(false);
    expect(cache.has(s2)).toBe(false);
  });

  it("should update existing entry without evicting", () => {
    const cache = new SchemaCacheLRU(2);
    const s1 = Type.String();
    const s2 = Type.Number();
    const c1 = TypeCompiler.Compile(s1);
    const c2 = TypeCompiler.Compile(s2);
    const c1b = TypeCompiler.Compile(s1);

    cache.set(s1, c1);
    cache.set(s2, c2);
    // Update s1 — should not evict
    cache.set(s1, c1b);

    expect(cache.size).toBe(2);
    expect(cache.get(s1)).toBe(c1b);
    expect(cache.get(s2)).toBe(c2);
  });

  it("should provide a default singleton", () => {
    resetDefaultSchemaCache();
    const cache1 = getDefaultSchemaCache(5);
    const cache2 = getDefaultSchemaCache(10);
    // Same instance
    expect(cache1).toBe(cache2);
    // Original max size (first call wins for singleton)
    expect(cache1.size).toBe(0);
  });
});

// ============================================================================
// 2. MiddlewareChainFlattener
// ============================================================================

describe("MiddlewareChainFlattener", () => {
  it("should flatten handler with no middleware", async () => {
    const flattener = new MiddlewareChainFlattener();
    const handler = async () => new Response("ok");
    const flat = flattener.flatten(handler, [], "no-mw");
    expect(flat.complexity).toBe(0);

    const ctx = new Context(new Request("http://localhost/test"));
    const res = await flat.execute(ctx);
    expect(await res.text()).toBe("ok");
  });

  it("should flatten handler with flat middlewares (no next)", async () => {
    const flattener = new MiddlewareChainFlattener();
    const log: string[] = [];

    const mw1 = async (ctx: Context) => {
      log.push("mw1");
    };
    const mw2 = async (ctx: Context) => {
      log.push("mw2");
    };
    const handler = async () => {
      log.push("handler");
      return new Response("done");
    };

    const flat = flattener.flatten(handler, [mw1, mw2], "test-chain");
    expect(flat.complexity).toBe(2);

    const ctx = new Context(new Request("http://localhost/test"));
    const res = await flat.execute(ctx);
    expect(await res.text()).toBe("done");
    expect(log).toEqual(["mw1", "mw2", "handler"]);
  });

  it("should flatten handler with next() middleware", async () => {
    const flattener = new MiddlewareChainFlattener();
    const log: string[] = [];

    const mw1 = async (ctx: Context, next: any) => {
      log.push("mw1-before");
      const res = await next();
      log.push("mw1-after");
      return res;
    };
    const handler = async () => {
      log.push("handler");
      return new Response("ok");
    };

    const flat = flattener.flatten(handler, [mw1], "next-chain");
    const ctx = new Context(new Request("http://localhost/test"));
    const res = await flat.execute(ctx);
    expect(await res.text()).toBe("ok");
    expect(log).toEqual(["mw1-before", "handler", "mw1-after"]);
  });

  it("should cache compiled chains by id", () => {
    const flattener = new MiddlewareChainFlattener();
    const handler = async () => new Response("ok");

    const f1 = flattener.flatten(handler, [], "same-id");
    const f2 = flattener.flatten(handler, [], "same-id");
    // Same cached result
    expect(f1).toBe(f2);
    expect(flattener.cacheSize).toBe(1);
  });

  it("should clear cache", () => {
    const flattener = new MiddlewareChainFlattener();
    const handler = async () => new Response("ok");

    flattener.flatten(handler, [], "clear-test");
    expect(flattener.cacheSize).toBe(1);

    flattener.clear();
    expect(flattener.cacheSize).toBe(0);
  });

  it("should handle middleware that returns a Response early", async () => {
    const flattener = new MiddlewareChainFlattener();
    const log: string[] = [];

    const authMw = async (ctx: Context) => {
      log.push("auth");
      return new Response("Unauthorized", { status: 401 });
    };
    const handler = async () => {
      log.push("handler");
      return new Response("never");
    };

    const flat = flattener.flatten(handler, [authMw], "early-return");
    const ctx = new Context(new Request("http://localhost/test"));
    const res = await flat.execute(ctx);
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Unauthorized");
    expect(log).toEqual(["auth"]);
    // handler not called
  });
});

// ============================================================================
// 3. RadixTreeRouter
// ============================================================================

describe("RadixTreeRouter", () => {
  it("should find a static route", () => {
    const router = new RadixTreeRouter();
    const handler = async () => new Response("hello");

    router.add("GET", "/hello", handler);
    const match = router.find("GET", "/hello");

    expect(match).not.toBeNull();
    expect(match!.handler).toBe(handler);
    expect(match!.path).toBe("/hello");
  });

  it("should return null for non-existent route", () => {
    const router = new RadixTreeRouter();
    router.add("GET", "/hello", async () => new Response(""));
    expect(router.find("GET", "/world")).toBeNull();
  });

  it("should match parameterised routes (:id)", () => {
    const router = new RadixTreeRouter();
    const handler = async () => new Response("user");

    router.add("GET", "/users/:id", handler);
    const match = router.find("GET", "/users/42");

    expect(match).not.toBeNull();
    expect(match!.handler).toBe(handler);
    expect(match!.params).toEqual({ id: "42" });
  });

  it("should match routes with multiple parameters", () => {
    const router = new RadixTreeRouter();

    router.add("GET", "/:org/:repo/issues/:id", async () => new Response("issue"));
    const match = router.find("GET", "/asi-js/asijs/issues/123");

    expect(match).not.toBeNull();
    expect(match!.params).toEqual({
      org: "asi-js",
      repo: "asijs",
      id: "123",
    });
  });

  it("should match wildcard routes", () => {
    const router = new RadixTreeRouter();
    const handler = async () => new Response("wild");

    router.add("GET", "/static/*", handler);
    const match = router.find("GET", "/static/js/app.js");

    expect(match).not.toBeNull();
    expect(match!.handler).toBe(handler);
  });

  it("should prefer static over param when both match", () => {
    const router = new RadixTreeRouter();
    const staticHandler = async () => new Response("static");
    const paramHandler = async () => new Response("param");

    router.add("GET", "/users/me", staticHandler);
    router.add("GET", "/users/:id", paramHandler);

    const match = router.find("GET", "/users/me");
    expect(match!.handler).toBe(staticHandler);
  });

  it("should match ALL method", () => {
    const router = new RadixTreeRouter();
    const handler = async () => new Response("any");

    router.add("ALL", "/any", handler);
    expect(router.find("GET", "/any")).not.toBeNull();
    expect(router.find("POST", "/any")).not.toBeNull();
    expect(router.find("PUT", "/any")).not.toBeNull();
  });

  it("should handle root path", () => {
    const router = new RadixTreeRouter();
    const handler = async () => new Response("root");

    router.add("GET", "/", handler);
    const match = router.find("GET", "/");

    expect(match).not.toBeNull();
    expect(match!.handler).toBe(handler);
  });

  it("should handle many static routes", () => {
    const router = new RadixTreeRouter();
    const handlers = new Map<string, any>();

    for (let i = 0; i < 100; i++) {
      const path = "/route/" + i;
      const handler = async () => new Response("r" + i);
      handlers.set(path, handler);
      router.add("GET", path, handler);
    }

    // Verify random routes
    expect(router.find("GET", "/route/42")!.handler).toBe(handlers.get("/route/42"));
    expect(router.find("GET", "/route/0")!.handler).toBe(handlers.get("/route/0"));
    expect(router.find("GET", "/route/99")!.handler).toBe(handlers.get("/route/99"));
    expect(router.find("GET", "/route/100")).toBeNull();
  });

  it("should report hasRoutes correctly", () => {
    const router = new RadixTreeRouter();
    expect(router.hasRoutes).toBe(false);

    router.add("GET", "/test", async () => new Response(""));
    expect(router.hasRoutes).toBe(true);
  });

  it("should handle mixed static + param routes", () => {
    const router = new RadixTreeRouter();
    const handlers: any[] = [];

    handlers[0] = async () => new Response("list");
    handlers[1] = async () => new Response("create");
    handlers[2] = async () => new Response("detail");

    router.add("GET", "/api/users", handlers[0]);
    router.add("POST", "/api/users", handlers[1]);
    router.add("GET", "/api/users/:id", handlers[2]);

    const m1 = router.find("GET", "/api/users");
    expect(m1!.handler).toBe(handlers[0]);

    const m2 = router.find("POST", "/api/users");
    expect(m2!.handler).toBe(handlers[1]);

    const m3 = router.find("GET", "/api/users/5");
    expect(m3!.handler).toBe(handlers[2]);
    expect(m3!.params).toEqual({ id: "5" });
  });
});

// ============================================================================
// 4. Integration with Asi app
// ============================================================================

describe("Asi app — radix router mode", () => {
  it("should work with router: radix config", async () => {
    const app = new Asi({ silent: true, router: "radix" } as any);
    app.get("/hello", () => "world");

    const res = await app.handle(new Request("http://localhost/hello"));
    expect(await res.text()).toBe("world");
  });

  it("should handle param routes with radix router", async () => {
    const app = new Asi({ silent: true, router: "radix" } as any);
    app.get("/users/:id", (ctx) => `User ${ctx.params.id}`);

    const res = await app.handle(new Request("http://localhost/users/42"));
    expect(await res.text()).toBe("User 42");
  });

  it("should handle multiple routes with radix router", async () => {
    const app = new Asi({ silent: true, router: "radix" } as any);
    app.get("/", () => "root");
    app.get("/about", () => "about");
    app.post("/data", () => "created");

    const r1 = await app.handle(new Request("http://localhost/"));
    expect(await r1.text()).toBe("root");

    const r2 = await app.handle(new Request("http://localhost/about"));
    expect(await r2.text()).toBe("about");

    const r3 = await app.handle(
      new Request("http://localhost/data", { method: "POST" }),
    );
    expect(await r3.text()).toBe("created");
  });

  it("should return 404 for unknown routes with radix", async () => {
    const app = new Asi({ silent: true, router: "radix" } as any);
    app.get("/hello", () => "world");

    const res = await app.handle(new Request("http://localhost/unknown"));
    expect(res.status).toBe(404);
  });
});

describe("Asi app — flattened middleware", () => {
  it("should work with flattenMiddleware: true", async () => {
    const app = new Asi({ silent: true, flattenMiddleware: true } as any);

    const log: string[] = [];
    app.use(async (ctx, next) => {
      log.push("mw-before");
      const res = await next!();
      log.push("mw-after");
      return res;
    });
    app.get("/", () => {
      log.push("handler");
      return "ok";
    });

    const res = await app.handle(new Request("http://localhost/"));
    expect(await res.text()).toBe("ok");
    expect(log).toEqual(["mw-before", "handler", "mw-after"]);
  });
});

describe("Asi app — LRU schema cache", () => {
  it("should work with lruSchemaCache: true", async () => {
    // Reset before test
    resetDefaultSchemaCache();

    const app = new Asi({ silent: true, lruSchemaCache: true } as any);
    app.get(
      "/validate",
      (ctx) => ({ valid: true }),
      {
        schema: {
          query: Type.Object({ q: Type.String() }),
        },
      },
    );

    const res = await app.handle(
      new Request("http://localhost/validate?q=test"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
  });
});

describe("Asi app — all optimisations combined", () => {
  it("should work with all 3 optimisations enabled", async () => {
    resetDefaultSchemaCache();

    const app = new Asi({
      silent: true,
      router: "radix",
      flattenMiddleware: true,
      lruSchemaCache: 500,
    } as any);

    app.get("/", () => "home");
    app.get("/users/:id", (ctx) => `user ${ctx.params.id}`);

    const r1 = await app.handle(new Request("http://localhost/"));
    expect(await r1.text()).toBe("home");

    const r2 = await app.handle(new Request("http://localhost/users/7"));
    expect(await r2.text()).toBe("user 7");

    const r3 = await app.handle(new Request("http://localhost/unknown"));
    expect(r3.status).toBe(404);
  });
});

describe("Asi app — error handling with radix router", () => {
  it("should handle validation errors with radix router", async () => {
    const app = new Asi({ silent: true, router: "radix" } as any);
    app.get(
      "/search",
      (ctx) => ({ results: [] }),
      {
        schema: {
          query: Type.Object({ q: Type.String({ minLength: 1 }) }),
        },
      },
    );

    // Missing query param
    const res = await app.handle(new Request("http://localhost/search"));
    expect(res.status).toBe(400);
  });

  it("should handle thrown errors", async () => {
    const app = new Asi({ silent: true, router: "radix" } as any);
    app.get("/error", () => {
      throw new Error("boom");
    });

    const res = await app.handle(new Request("http://localhost/error"));
    expect(res.status).toBe(500);
  });
});
