import { describe, it, expect } from "bun:test";
import {
  Asi,
  createPlugin,
  pluginFn,
  decorators,
  sharedState,
  guard,
} from "../src";

describe("Plugin System", () => {
  describe("createPlugin", () => {
    it("should register a plugin with setup function", async () => {
      const app = new Asi();

      const myPlugin = createPlugin({
        name: "test-plugin",
        setup(host) {
          host.get("/from-plugin", () => ({ source: "plugin" }));
        },
      });

      await app.plugin(myPlugin);

      const req = new Request("http://localhost/from-plugin");
      const res = await app.handle(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.source).toBe("plugin");
    });

    it("should register plugin state", async () => {
      const app = new Asi();

      const statePlugin = createPlugin({
        name: "state-plugin",
        state: {
          counter: 0,
          users: new Map<string, string>(),
        },
      });

      await app.plugin(statePlugin);

      expect(app.state("counter")).toBe(0);
      expect(app.state<Map<string, string>>("users")).toBeInstanceOf(Map);
    });

    it("should register plugin decorators", async () => {
      const app = new Asi();

      const decoratorPlugin = createPlugin({
        name: "decorator-plugin",
        decorate: {
          randomId: () => "test-id-123",
          now: () => new Date("2025-01-01"),
        },
      });

      await app.plugin(decoratorPlugin);

      const randomId = app.decorator<() => string>("randomId");
      expect(randomId?.()).toBe("test-id-123");
    });

    it("should register beforeHandle hooks", async () => {
      const app = new Asi();
      let hookCalled = false;

      const hookPlugin = createPlugin({
        name: "hook-plugin",
        beforeHandle: (ctx) => {
          hookCalled = true;
        },
      });

      await app.plugin(hookPlugin);

      app.get("/test", () => "ok");

      await app.handle(new Request("http://localhost/test"));

      expect(hookCalled).toBe(true);
    });

    it("should register afterHandle hooks", async () => {
      const app = new Asi();
      let hookCalled = false;

      const hookPlugin = createPlugin({
        name: "after-hook-plugin",
        afterHandle: (ctx, response) => {
          hookCalled = true;
          return response;
        },
      });

      await app.plugin(hookPlugin);

      app.get("/test", () => "ok");

      await app.handle(new Request("http://localhost/test"));

      expect(hookCalled).toBe(true);
    });

    it("should register middleware", async () => {
      const app = new Asi();
      let middlewareCalled = false;

      const mwPlugin = createPlugin({
        name: "mw-plugin",
        middleware: async (ctx, next) => {
          middlewareCalled = true;
          return await next();
        },
      });

      await app.plugin(mwPlugin);

      app.get("/test", () => "ok");

      await app.handle(new Request("http://localhost/test"));

      expect(middlewareCalled).toBe(true);
    });

    it("should prevent duplicate plugin registration", async () => {
      const app = new Asi();

      const myPlugin = createPlugin({
        name: "unique-plugin",
        state: { value: 1 },
      });

      await app.plugin(myPlugin);
      await app.plugin(myPlugin); // Second call should be ignored

      expect(app.hasPlugin("unique-plugin")).toBe(true);
    });

    it("should check plugin dependencies", async () => {
      const app = new Asi();

      const dependentPlugin = createPlugin({
        name: "dependent-plugin",
        dependencies: ["base-plugin"],
        setup(host) {
          host.get("/dependent", () => "ok");
        },
      });

      // Should throw because base-plugin is not registered
      await expect(app.plugin(dependentPlugin)).rejects.toThrow(
        "requires plugin",
      );
    });

    it("should work with dependencies when satisfied", async () => {
      const app = new Asi();

      const basePlugin = createPlugin({
        name: "base-plugin",
        state: { baseValue: "hello" },
      });

      const dependentPlugin = createPlugin({
        name: "dependent-plugin",
        dependencies: ["base-plugin"],
        setup(host) {
          const baseValue = host.getState("baseValue");
          host.get("/combined", () => ({ baseValue }));
        },
      });

      await app.plugin(basePlugin);
      await app.plugin(dependentPlugin);

      const res = await app.handle(new Request("http://localhost/combined"));
      const body = await res.json();

      expect(body.baseValue).toBe("hello");
    });
  });

  describe("Helper functions", () => {
    it("pluginFn should create a simple plugin", async () => {
      const app = new Asi();

      const simplePlugin = pluginFn("simple", (host) => {
        host.get("/simple", () => "simple route");
      });

      await app.plugin(simplePlugin);

      const res = await app.handle(new Request("http://localhost/simple"));
      const text = await res.text();

      expect(text).toBe("simple route");
    });

    it("decorators should create a decorator plugin", async () => {
      const app = new Asi();

      const helperPlugin = decorators("helpers", {
        uppercase: (s: string) => s.toUpperCase(),
        add: (a: number, b: number) => a + b,
      });

      await app.plugin(helperPlugin);

      const uppercase = app.decorator<(s: string) => string>("uppercase");
      const add = app.decorator<(a: number, b: number) => number>("add");

      expect(uppercase?.("hello")).toBe("HELLO");
      expect(add?.(2, 3)).toBe(5);
    });

    it("sharedState should create a state plugin", async () => {
      const app = new Asi();

      const cachePlugin = sharedState("cache", {
        cache: new Map<string, unknown>(),
        hits: 0,
      });

      await app.plugin(cachePlugin);

      expect(app.state<Map<string, unknown>>("cache")).toBeInstanceOf(Map);
      expect(app.state("hits")).toBe(0);
    });

    it("guard should create a beforeHandle plugin", async () => {
      const app = new Asi();

      const authGuard = guard("auth", (ctx) => {
        if (!ctx.header("Authorization")) {
          return new Response("Unauthorized", { status: 401 });
        }
      });

      await app.plugin(authGuard);

      app.get("/protected", () => "secret data");

      // Without auth header
      const res1 = await app.handle(new Request("http://localhost/protected"));
      expect(res1.status).toBe(401);

      // With auth header
      const res2 = await app.handle(
        new Request("http://localhost/protected", {
          headers: { Authorization: "Bearer token" },
        }),
      );
      expect(res2.status).toBe(200);
    });
  });

  describe("App state and decorators", () => {
    it("should set and get state directly on app", () => {
      const app = new Asi();

      app.setState("counter", 0);
      app.setState("items", ["a", "b", "c"]);

      expect(app.state("counter")).toBe(0);
      expect(app.state<string[]>("items")).toEqual(["a", "b", "c"]);
    });

    it("should set and get decorators directly on app", () => {
      const app = new Asi();

      app.decorate("double", (n: number) => n * 2);
      app.decorate("greeting", "Hello!");

      const double = app.decorator<(n: number) => number>("double");
      expect(double?.(5)).toBe(10);
      expect(app.decorator("greeting")).toBe("Hello!");
    });

    it("should check if plugin is registered", async () => {
      const app = new Asi();

      expect(app.hasPlugin("my-plugin")).toBe(false);

      await app.plugin(createPlugin({ name: "my-plugin" }));

      expect(app.hasPlugin("my-plugin")).toBe(true);
    });
  });

  describe("Multiple plugins", () => {
    it("should work with multiple plugins", async () => {
      const app = new Asi();

      const loggingPlugin = createPlugin({
        name: "logging",
        state: { logs: [] as string[] },
        beforeHandle: (ctx) => {
          const logs = app.state<string[]>("logs");
          logs?.push(`${ctx.method} ${ctx.path}`);
        },
      });

      const routesPlugin = createPlugin({
        name: "routes",
        setup(host) {
          host.get("/a", () => "a");
          host.get("/b", () => "b");
        },
      });

      await app.plugin(loggingPlugin);
      await app.plugin(routesPlugin);

      await app.handle(new Request("http://localhost/a"));
      await app.handle(new Request("http://localhost/b"));

      const logs = app.state<string[]>("logs");
      expect(logs).toEqual(["GET /a", "GET /b"]);
    });
  });
});
