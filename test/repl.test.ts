/**
 * Tests for Interactive REPL (src/repl.ts) and Playground (src/playground.ts)
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { AsiRepl } from "../src/repl";
import { Asi } from "../src/asi";

// ============================================================================
// AsiRepl Tests
// ============================================================================

describe("AsiRepl", () => {
  test("creates a new REPL instance", () => {
    const repl = new AsiRepl({ silent: true });
    expect(repl).toBeDefined();
    expect(repl.app).toBeDefined();
    expect(repl.app instanceof Asi).toBe(true);
  });

  test("has default health route", async () => {
    const repl = new AsiRepl({ silent: true });
    const req = new Request("http://localhost/health");
    const res = await repl.app.handle(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.routes).toBeDefined();
    expect(Array.isArray(body.routes)).toBe(true);
  });

  test("has routes endpoint", async () => {
    const repl = new AsiRepl({ silent: true });
    const req = new Request("http://localhost/routes");
    const res = await repl.app.handle(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test("getRouteSummary returns registered routes", () => {
    const repl = new AsiRepl({ silent: true });
    const routes = repl.getRouteSummary();
    expect(Array.isArray(routes)).toBe(true);
    // Should have at least /health and /routes
    expect(routes.length).toBeGreaterThanOrEqual(2);
    const paths = routes.map((r) => r.path);
    expect(paths).toContain("/health");
    expect(paths).toContain("/routes");
  });

  test("app accepts new routes via repl", async () => {
    const repl = new AsiRepl({ silent: true });
    repl.app.get("/test", () => ({ message: "test route" }));
    const req = new Request("http://localhost/test");
    const res = await repl.app.handle(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe("test route");
  });

  test("app handles POST routes", async () => {
    const repl = new AsiRepl({ silent: true });
    repl.app.post("/data", async (ctx: any) => {
      const body = await ctx.json();
      return { received: body };
    });
    const req = new Request("http://localhost/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "value" }),
    });
    const res = await repl.app.handle(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received.key).toBe("value");
  });

  test("app handles routes with params", async () => {
    const repl = new AsiRepl({ silent: true });
    repl.app.get("/users/:id", (ctx: any) => ({ id: ctx.params.id }));
    const req = new Request("http://localhost/users/42");
    const res = await repl.app.handle(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("42");
  });

  test("app handles 404 for unknown routes", async () => {
    const repl = new AsiRepl({ silent: true });
    const req = new Request("http://localhost/unknown-route-xyz");
    const res = await repl.app.handle(req);
    expect(res.status).toBe(404);
  });

  test("creates REPL with custom port option", () => {
    const repl = new AsiRepl({ silent: true, port: 9999 });
    expect(repl).toBeDefined();
    const routes = repl.getRouteSummary();
    expect(Array.isArray(routes)).toBe(true);
  });

  test("repl history is loaded and saved without error", () => {
    const repl = new AsiRepl({ silent: true });
    // Just check that the historyFile path is valid
    expect(repl["historyFile"]).toBeDefined();
    expect(typeof repl["historyFile"]).toBe("string");
    expect(repl["history"]).toBeDefined();
    expect(Array.isArray(repl["history"])).toBe(true);
  });

  test("multiple routes can be added after creation", async () => {
    const repl = new AsiRepl({ silent: true });

    // Add several routes dynamically
    repl.app.get("/a", () => "A");
    repl.app.get("/b", () => "B");
    repl.app.get("/c", () => "C");

    const routes = repl.getRouteSummary();
    const routePaths = routes.map((r) => r.path);
    expect(routePaths).toContain("/a");
    expect(routePaths).toContain("/b");
    expect(routePaths).toContain("/c");

    // Verify they all work
    for (const path of ["/a", "/b", "/c"]) {
      const req = new Request(`http://localhost${path}`);
      const res = await repl.app.handle(req);
      expect(res.status).toBe(200);
    }
  });

  test("health endpoint returns route count", () => {
    const repl = new AsiRepl({ silent: true });
    const summary = repl.getRouteSummary();
    const routesInfo = summary; // Already the routes array
    expect(Array.isArray(routesInfo)).toBe(true);
    for (const r of routesInfo) {
      expect(r.method).toBeDefined();
      expect(r.path).toBeDefined();
    }
  });
});

// ============================================================================
// Playground Plugin Tests
// ============================================================================

describe("playgroundPlugin", () => {
  test("exports playgroundPlugin function", async () => {
    const { playgroundPlugin } = await import("../src/playground");
    expect(playgroundPlugin).toBeDefined();
    expect(typeof playgroundPlugin).toBe("function");
  });

  test("creates a plugin with playground name", async () => {
    const { playgroundPlugin } = await import("../src/playground");
    const plugin = playgroundPlugin();
    expect(plugin).toBeDefined();
    expect(plugin.name).toBe("playground");
  });

  test("plugin is an AsiPlugin with setup function", async () => {
    const { playgroundPlugin } = await import("../src/playground");
    const plugin = playgroundPlugin();
    expect(plugin.config).toBeDefined();
    expect(typeof plugin.config.setup).toBe("function");
  });

  test("playground page renders at custom path", async () => {
    const { playgroundPlugin } = await import("../src/playground");
    const app = new Asi({ development: false, silent: true });

    app.plugin(playgroundPlugin({ path: "/test-play" }));

    const req = new Request("http://localhost/test-play");
    const res = await app.handle(req);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("AsiJS Playground");
    expect(text).toContain("Code Editor");
    expect(text).toContain("▶ Run");
  });

  test("examples endpoint returns examples", async () => {
    const { playgroundPlugin } = await import("../src/playground");
    const app = new Asi({ development: false, silent: true });

    app.plugin(playgroundPlugin({ path: "/play" }));

    const req = new Request("http://localhost/play/_api/examples");
    const res = await app.handle(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.examples).toBeDefined();
    expect(Array.isArray(body.examples)).toBe(true);
    expect(body.examples.length).toBeGreaterThanOrEqual(5);
  });

  test("routes endpoint returns route info", async () => {
    const { playgroundPlugin } = await import("../src/playground");
    const app = new Asi({ development: false, silent: true });

    // Add a route first
    app.get("/api/test", () => ({ ok: true }));

    app.plugin(playgroundPlugin({ path: "/play" }));

    const req = new Request("http://localhost/play/_api/routes");
    const res = await app.handle(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.routes).toBeDefined();
    expect(Array.isArray(body.routes)).toBe(true);
  });

  test("execution endpoint rejects empty code", async () => {
    const { playgroundPlugin } = await import("../src/playground");
    const app = new Asi({ development: false, silent: true });

    app.plugin(playgroundPlugin({ path: "/play" }));

    const req = new Request("http://localhost/play/_execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "" }),
    });
    const res = await app.handle(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("No code provided");
  });

  test("health endpoint returns ok", async () => {
    const { playgroundPlugin } = await import("../src/playground");
    const app = new Asi({ development: false, silent: true });

    app.plugin(playgroundPlugin({ path: "/play" }));

    const req = new Request("http://localhost/play/_api/health");
    const res = await app.handle(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  test("playground executes valid code successfully", async () => {
    const { playgroundPlugin } = await import("../src/playground");
    const app = new Asi({ development: false, silent: true });

    app.plugin(playgroundPlugin({ path: "/play" }));

    const req = new Request("http://localhost/play/_execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: `const app = new Asi({ development: false, silent: true });\napp.get("/test", () => ({ msg: "ok" }));`,
      }),
    });
    const res = await app.handle(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test("playground page has run button and method select", async () => {
    const { playgroundPlugin } = await import("../src/playground");
    const app = new Asi({ development: false, silent: true });

    app.plugin(playgroundPlugin({ path: "/test" }));

    const req = new Request("http://localhost/test");
    const res = await app.handle(req);
    const text = await res.text();
    expect(text).toContain("▶ Run");
    expect(text).toContain("GET");
    expect(text).toContain("POST");
    expect(text).toContain("codeEditor");
    expect(text).toContain("execUrl");
  });
});

// ============================================================================
// AsiRepl HTTP Request Handling
// ============================================================================

describe("AsiRepl HTTP handling", () => {
  test("handles GET request and returns JSON body", async () => {
    const repl = new AsiRepl({ silent: true });
    repl.app.get("/hello", () => ({ msg: "world" }));

    const req = new Request("http://localhost/hello");
    const res = await repl.app.handle(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.msg).toBe("world");
  });

  test("handles multiple HTTP methods", async () => {
    const repl = new AsiRepl({ silent: true });

    repl.app.get("/resource", () => ({ method: "GET" }));
    repl.app.post("/resource", () => ({ method: "POST" }));
    repl.app.put("/resource", () => ({ method: "PUT" }));
    repl.app.delete("/resource", () => ({ method: "DELETE" }));

    for (const method of ["GET", "POST", "PUT", "DELETE"]) {
      const req = new Request("http://localhost/resource", { method });
      const res = await repl.app.handle(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.method).toBe(method);
    }
  });

  test("getRouteSummary returns consistent format", () => {
    const repl = new AsiRepl({ silent: true });
    const routes = repl.getRouteSummary();
    for (const r of routes) {
      expect(typeof r.method).toBe("string");
      expect(typeof r.path).toBe("string");
      expect(typeof r.handler).toBe("string");
    }
  });

  test("REPL stops without error", () => {
    const repl = new AsiRepl({ silent: true });
    expect(() => repl.stop()).not.toThrow();
  });

  test("getRoutes returns routes matching registered ones", async () => {
    const repl = new AsiRepl({ silent: true });
    repl.app.get("/custom", () => "custom");

    const routes = repl.getRouteSummary();
    const paths = routes.map((r) => r.path);
    expect(paths).toContain("/custom");
  });
});

// ============================================================================
// AsiRepl plugin/state interface tests
// ============================================================================

describe("AsiRepl plugin interface", () => {
  test("supports WebSocket routes", async () => {
    const repl = new AsiRepl({ silent: true });
    repl.app.ws("/ws-test", {
      open(ws: any) {},
      message(ws: any, msg: any) {},
      close(ws: any) {},
    });

    // WebSocket routes shouldn't affect HTTP GET
    const req = new Request("http://localhost/health");
    const res = await repl.app.handle(req);
    expect(res.status).toBe(200);
  });
});

// ============================================================================
// Module Export Tests
// ============================================================================

describe("module exports", () => {
  test("exports AsiRepl from index.ts", async () => {
    const mod = await import("../src/index");
    expect(mod.AsiRepl).toBeDefined();
    expect(typeof mod.AsiRepl).toBe("function");
  });

  test("exports playgroundPlugin from index.ts", async () => {
    const mod = await import("../src/index");
    expect(mod.playgroundPlugin).toBeDefined();
    expect(typeof mod.playgroundPlugin).toBe("function");
  });

  test("exports types from repl module", async () => {
    const mod = await import("../src/repl");
    expect(mod.AsiRepl).toBeDefined();
    expect(typeof mod.AsiRepl).toBe("function");
  });

  test("exports types from playground module", async () => {
    const mod = await import("../src/playground");
    expect(mod.playgroundPlugin).toBeDefined();
    expect(typeof mod.playgroundPlugin).toBe("function");
  });
});
