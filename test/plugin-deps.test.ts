/**
 * Tests for Plugin Dependency & Ordering System
 *
 * Covers:
 * - PluginDependencyManager: graph construction, cycle detection, topological sort
 * - PluginBuilder: chaining API (dependsOn, withHooks, lazy)
 * - Integration with Asi class
 * - Error cases (cyclic deps, missing deps)
 */

import { describe, test, expect } from "bun:test";
import { Asi } from "../src/asi";
import { createPlugin, PluginBuilder, type PluginHooks } from "../src/plugin";
import {
  PluginDependencyManager,
  CyclicDependencyError,
  MissingDependencyError,
  type PluginNode,
  type PluginGraphInfo,
} from "../src/plugin-deps";

// ============================================================================
// PluginDependencyManager
// ============================================================================

describe("PluginDependencyManager", () => {
  test("creates empty manager", () => {
    const mgr = new PluginDependencyManager();
    expect(mgr.getGraphInfo()).toBeDefined();
    expect(mgr.getGraphInfo().nodes).toHaveLength(0);
  });

  test("adds a single plugin", () => {
    const mgr = new PluginDependencyManager();
    mgr.addPlugin("cors", []);
    expect(mgr.hasPlugin("cors")).toBe(true);
    expect(mgr.getPlugin("cors")?.name).toBe("cors");
  });

  test("adds plugins with dependencies", () => {
    const mgr = new PluginDependencyManager();
    mgr.addPlugin("sessions", []);
    mgr.addPlugin("auth", ["sessions"]);
    mgr.addPlugin("cors", []);
    expect(mgr.hasPlugin("sessions")).toBe(true);
    expect(mgr.hasPlugin("auth")).toBe(true);
    expect(mgr.hasPlugin("cors")).toBe(true);
  });

  test("resolveOrder returns correct topological order", () => {
    const mgr = new PluginDependencyManager();
    mgr.addPlugin("sessions", []);
    mgr.addPlugin("cors", []);
    mgr.addPlugin("auth", ["sessions", "cors"]);
    mgr.addPlugin("api", ["auth"]);

    const order = mgr.resolveOrder();
    // "sessions" and "cors" have no deps, so they come first
    // "auth" depends on sessions+cors
    // "api" depends on auth
    expect(order.indexOf("sessions")).toBeLessThan(order.indexOf("auth"));
    expect(order.indexOf("cors")).toBeLessThan(order.indexOf("auth"));
    expect(order.indexOf("auth")).toBeLessThan(order.indexOf("api"));
  });

  test("detects cyclic dependencies", () => {
    const mgr = new PluginDependencyManager();
    mgr.addPlugin("a", ["b"]);
    mgr.addPlugin("b", ["c"]);
    mgr.addPlugin("c", ["a"]);

    const cycle = mgr.detectCycle();
    expect(cycle).not.toBeNull();
    expect(cycle!.length).toBeGreaterThan(1);
  });

  test("throws CyclicDependencyError on resolveOrder with cycle", () => {
    const mgr = new PluginDependencyManager();
    mgr.addPlugin("a", ["b"]);
    mgr.addPlugin("b", ["a"]);

    expect(() => mgr.resolveOrder()).toThrow(CyclicDependencyError);
  });

  test("throws MissingDependencyError for unregistered deps", () => {
    const mgr = new PluginDependencyManager();
    mgr.addPlugin("auth", ["sessions"]);

    expect(() => mgr.resolveOrder()).toThrow(MissingDependencyError);
  });

  test("areDependenciesReady returns correct status", () => {
    const mgr = new PluginDependencyManager();
    mgr.addPlugin("sessions", []);
    mgr.addPlugin("auth", ["sessions"]);

    expect(mgr.areDependenciesReady("sessions")).toBe(true);
    expect(mgr.areDependenciesReady("auth")).toBe(false);

    mgr.setStatus("sessions", "initialized");
    expect(mgr.areDependenciesReady("auth")).toBe(true);
  });

  test("getReadyPlugins returns plugins with satisfied deps", () => {
    const mgr = new PluginDependencyManager();
    mgr.addPlugin("cors", []);
    mgr.addPlugin("sessions", []);
    mgr.addPlugin("auth", ["sessions", "cors"]);
    mgr.addPlugin("logging", []);

    // Only cors, sessions, logging should be ready (no deps)
    const ready = mgr.getReadyPlugins();
    expect(ready.map((n) => n.name).sort()).toEqual(["cors", "logging", "sessions"]);
  });

  test("setStatus updates plugin status", () => {
    const mgr = new PluginDependencyManager();
    mgr.addPlugin("test", []);
    expect(mgr.getPlugin("test")?.status).toBe("registered");
    mgr.setStatus("test", "initialized");
    expect(mgr.getPlugin("test")?.status).toBe("initialized");
  });

  test("setHooks registers lifecycle hooks", () => {
    const mgr = new PluginDependencyManager();
    mgr.addPlugin("test", []);
    mgr.setHooks("test", {
      onBeforeInit: () => {},
      onAfterInit: () => {},
    });
    const node = mgr.getPlugin("test");
    expect(node?.hooks.onBeforeInit).toBeDefined();
    expect(node?.hooks.onAfterInit).toBeDefined();
  });

  test("getGraphInfo returns complete graph", () => {
    const mgr = new PluginDependencyManager();
    mgr.addPlugin("cors", []);
    mgr.addPlugin("auth", ["cors"]);
    mgr.setStatus("cors", "initialized");

    const info = mgr.getGraphInfo();
    expect(info.nodes).toHaveLength(2);
    expect(info.edges).toHaveLength(1);
    expect(info.edges[0]).toEqual({ from: "auth", to: "cors" });
    expect(info.initOrder).toEqual(["cors", "auth"]);
    expect(info.hasCycle).toBe(false);
    expect(info.cyclePath).toBeNull();
  });

  test("toDot generates valid DOT graph", () => {
    const mgr = new PluginDependencyManager();
    mgr.addPlugin("a", ["b"]);
    mgr.addPlugin("b", []);

    const dot = mgr.toDot();
    expect(dot).toContain("digraph PluginDeps");
    expect(dot).toContain('"a"');
    expect(dot).toContain('"b"');
    expect(dot).toContain('"a" -> "b"');
  });
});

// ============================================================================
// PluginBuilder
// ============================================================================

describe("PluginBuilder", () => {
  test("creates builder with default values", () => {
    const plugin = createPlugin({ name: "test", setup: () => {} });
    const builder = new PluginBuilder(plugin, async () => {});

    expect(builder.getPlugin().name).toBe("test");
    expect(builder.getDependencies()).toEqual([]);
    expect(builder.isLazy()).toBe(false);
  });

  test("dependsOn sets dependencies", () => {
    const plugin = createPlugin({ name: "test", setup: () => {} });
    const builder = new PluginBuilder(plugin, async () => {});
    builder.dependsOn(["sessions", "cors"]);

    expect(builder.getDependencies()).toEqual(["sessions", "cors"]);
  });

  test("withHooks registers lifecycle hooks", () => {
    const plugin = createPlugin({ name: "test", setup: () => {} });
    const builder = new PluginBuilder(plugin, async () => {});

    const hooks: Partial<PluginHooks> = {
      onBeforeInit: () => {},
      onAfterInit: () => {},
      onBeforeRoute: () => {},
    };
    builder.withHooks(hooks);

    const registeredHooks = builder.getHooks();
    expect(registeredHooks.onBeforeInit).toBeDefined();
    expect(registeredHooks.onAfterInit).toBeDefined();
    expect(registeredHooks.onBeforeRoute).toBeDefined();
  });

  test("lazy sets lazy flag", () => {
    const plugin = createPlugin({ name: "test", setup: () => {} });
    const builder = new PluginBuilder(plugin, async () => {});
    builder.lazy();

    expect(builder.isLazy()).toBe(true);
  });

  test("inherits dependencies from plugin config", () => {
    const plugin = createPlugin({
      name: "test",
      dependencies: ["sessions"],
      setup: () => {},
    });
    const builder = new PluginBuilder(plugin, async () => {});

    expect(builder.getDependencies()).toEqual(["sessions"]);
  });
});

// ============================================================================
// Asi Integration: Plugin methods
// ============================================================================

describe("Asi.plugin() with PluginBuilder", () => {
  test("plugin() returns PluginBuilder", () => {
    const app = new Asi({ silent: true });
    const plugin = createPlugin({ name: "test", setup: () => {} });

    const result = app.plugin(plugin);
    expect(result).toBeInstanceOf(PluginBuilder);
  });

  test("plugin() with dependsOn chains correctly", async () => {
    const app = new Asi({ silent: true });

    const sessionsPlugin = createPlugin({
      name: "sessions",
      setup: () => {},
    });
    const corsPlugin = createPlugin({
      name: "cors",
      setup: () => {},
    });
    const authPlugin = createPlugin({
      name: "auth",
      setup: () => {},
    });

    app.plugin(sessionsPlugin);
    await app.initPlugins();

    app.plugin(corsPlugin);
    await app.initPlugins();

    app.plugin(authPlugin).dependsOn(["sessions", "cors"]);
    await app.initPlugins();

    expect(app.hasPlugin("sessions")).toBe(true);
    expect(app.hasPlugin("cors")).toBe(true);
    expect(app.hasPlugin("auth")).toBe(true);
  });

  test("pluginInfo() returns graph info", async () => {
    const app = new Asi({ silent: true });

    const corsPlugin = createPlugin({ name: "cors", setup: () => {} });
    const sessionsPlugin = createPlugin({ name: "sessions", setup: () => {} });
    const authPlugin = createPlugin({ name: "auth", setup: () => {} });

    app.plugin(corsPlugin);
    app.plugin(sessionsPlugin);
    app.plugin(authPlugin).dependsOn(["sessions", "cors"]);
    await app.initPlugins();

    const info = app.pluginInfo();
    expect(info.nodes.length).toBeGreaterThanOrEqual(3);
    expect(info.initOrder.indexOf("sessions")).toBeLessThan(
      info.initOrder.indexOf("auth"),
    );
    expect(info.initOrder.indexOf("cors")).toBeLessThan(
      info.initOrder.indexOf("auth"),
    );
  });

  test("pluginDepGraph() returns DOT string", async () => {
    const app = new Asi({ silent: true });
    const p = createPlugin({ name: "dot-test", setup: () => {} });
    app.plugin(p);
    await app.initPlugins();

    const dot = app.pluginDepGraph();
    expect(dot).toContain("digraph PluginDeps");
    expect(dot).toContain('"dot-test"');
  });

  test("initPlugins detects cycles", async () => {
    const app = new Asi({ silent: true });

    // Manually add plugins with cycle to trigger error
    const a = createPlugin({ name: "a", dependencies: ["b"], setup: () => {} });
    const b = createPlugin({ name: "b", dependencies: ["a"], setup: () => {} });

    app.plugin(a);
    app.plugin(b);

    try {
      await app.initPlugins();
      // Should have thrown
      expect(true).toBe(false); // Fail if we get here
    } catch (error) {
      expect(error).toBeInstanceOf(CyclicDependencyError);
    }
  });

  test("plugin with hooks executes lifecycle hooks", async () => {
    const app = new Asi({ silent: true });
    let beforeInitCalled = false;
    let afterInitCalled = false;

    const testPlugin = createPlugin({
      name: "lifecycle-test",
      setup: () => {},
    });

    app.plugin(testPlugin).withHooks({
      onBeforeInit: () => {
        beforeInitCalled = true;
      },
      onAfterInit: () => {
        afterInitCalled = true;
      },
    });

    await app.initPlugins();

    expect(beforeInitCalled).toBe(true);
    expect(afterInitCalled).toBe(true);
  });

  test("multiple plugins with complex dependency graph", async () => {
    const app = new Asi({ silent: true });

    const initOrder: string[] = [];

    const logging = createPlugin({
      name: "logging",
      setup: () => { initOrder.push("logging"); },
    });
    const cors = createPlugin({
      name: "cors",
      setup: () => { initOrder.push("cors"); },
    });
    const sessions = createPlugin({
      name: "sessions",
      setup: () => { initOrder.push("sessions"); },
    });
    const auth = createPlugin({
      name: "auth",
      dependencies: ["sessions", "cors"],
      setup: () => { initOrder.push("auth"); },
    });
    const api = createPlugin({
      name: "api",
      dependencies: ["auth", "logging"],
      setup: () => { initOrder.push("api"); },
    });

    app.plugin(logging);
    app.plugin(cors);
    app.plugin(sessions);
    app.plugin(auth);
    app.plugin(api);

    await app.initPlugins();

    // Verify topological order: dependencies before dependents
    expect(initOrder.indexOf("sessions")).toBeLessThan(initOrder.indexOf("auth"));
    expect(initOrder.indexOf("cors")).toBeLessThan(initOrder.indexOf("auth"));
    expect(initOrder.indexOf("auth")).toBeLessThan(initOrder.indexOf("api"));
    expect(initOrder.indexOf("logging")).toBeLessThan(initOrder.indexOf("api"));
  });
});
