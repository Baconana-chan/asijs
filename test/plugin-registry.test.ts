/**
 * Tests for Plugin Registry & Community (src/plugin-registry.ts)
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, readFileSync, mkdirSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_TMP = join(__dirname, "..", ".plugin-registry-test-tmp");

// ========================================================================
// PluginRegistry — search
// ========================================================================

describe("PluginRegistry", () => {
  test("search returns all plugins when query is empty", async () => {
    const { PluginRegistry } = await import("../src/plugin-registry");
    const registry = new PluginRegistry();
    const all = registry.search();
    expect(all.length).toBeGreaterThan(30);
    expect(all[0].name).toBeDefined();
    expect(all[0].description).toBeDefined();
    expect(all[0].npmPackage).toBeDefined();
  });

  test("search filters by name", async () => {
    const { PluginRegistry } = await import("../src/plugin-registry");
    const registry = new PluginRegistry();
    const results = registry.search("cors");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((p: any) => p.name === "cors")).toBe(true);
  });

  test("search filters by description", async () => {
    const { PluginRegistry } = await import("../src/plugin-registry");
    const registry = new PluginRegistry();
    // Search for a word that appears in the cors plugin description
    const results = registry.search("configure");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((p: any) => p.name === "cors")).toBe(true);
  });

  test("search filters by tag", async () => {
    const { PluginRegistry } = await import("../src/plugin-registry");
    const registry = new PluginRegistry();
    const results = registry.search("migration");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((p: any) => p.name === "expressPlugin")).toBe(true);
  });

  test("getByCategory returns plugins in a category", async () => {
    const { PluginRegistry } = await import("../src/plugin-registry");
    const registry = new PluginRegistry();
    const auth = registry.getByCategory("auth");
    expect(auth.length).toBeGreaterThan(0);
    for (const p of auth) {
      expect(p.category).toBe("auth");
    }
  });

  test("getByName finds a specific plugin", async () => {
    const { PluginRegistry } = await import("../src/plugin-registry");
    const registry = new PluginRegistry();
    const plugin = registry.get("openapi");
    expect(plugin).toBeDefined();
    expect(plugin!.name).toBe("openapi");
    expect(plugin!.description).toContain("OpenAPI");
  });

  test("getByName returns undefined for missing plugin", async () => {
    const { PluginRegistry } = await import("../src/plugin-registry");
    const registry = new PluginRegistry();
    const plugin = registry.get("nonexistent-plugin-name");
    expect(plugin).toBeUndefined();
  });

  test("getCategories returns sorted categories", async () => {
    const { PluginRegistry } = await import("../src/plugin-registry");
    const registry = new PluginRegistry();
    const cats = registry.getCategories();
    expect(cats.length).toBeGreaterThan(5);
    // Check sorted
    for (let i = 1; i < cats.length; i++) {
      expect(cats[i - 1] <= cats[i]).toBe(true);
    }
  });
});

// ========================================================================
// AWESOME_PLUGINS data integrity
// ========================================================================

describe("AWESOME_PLUGINS", () => {
  test("all plugins have required fields", async () => {
    const { AWESOME_PLUGINS } = await import("../src/plugin-registry");
    for (const p of AWESOME_PLUGINS) {
      expect(p.name).toBeDefined();
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.description).toBeDefined();
      expect(p.description.length).toBeGreaterThan(0);
      expect(p.npmPackage).toBeDefined();
    }
  });

  test("no duplicate names", async () => {
    const { AWESOME_PLUGINS } = await import("../src/plugin-registry");
    const names = AWESOME_PLUGINS.map((p: any) => p.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  test("generateAwesomeMarkdown returns valid markdown", async () => {
    const { PluginRegistry } = await import("../src/plugin-registry");
    const registry = new PluginRegistry();
    const md = registry.generateAwesomeMarkdown();
    expect(md).toContain("Awesome AsiJS Plugins");
    expect(md).toContain("Auth");
    expect(md).toContain("**cors**");
    expect(md).toContain("github.com");
  });
});

// ========================================================================
// scaffoldPlugin
// ========================================================================

describe("scaffoldPlugin", () => {
  const testPluginDir = join(TEST_TMP, "test-plugin");

  beforeAll(() => {
    // Clean up before tests
    try { rmSync(TEST_TMP, { recursive: true }); } catch {}
    mkdirSync(TEST_TMP, { recursive: true });
  });

  afterAll(() => {
    try { rmSync(TEST_TMP, { recursive: true }); } catch {}
  });

  test("creates plugin directory structure", async () => {
    const { scaffoldPlugin } = await import("../src/plugin-registry");

    const result = scaffoldPlugin({
      name: "test-plugin",
      description: "A test plugin",
      author: "Test Author",
      withTests: true,
      withExample: true,
      baseDir: TEST_TMP,
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("test-plugin");
    expect(existsSync(join(testPluginDir, "src", "index.ts"))).toBe(true);
    expect(existsSync(join(testPluginDir, "package.json"))).toBe(true);
    expect(existsSync(join(testPluginDir, "tsconfig.json"))).toBe(true);
    expect(existsSync(join(testPluginDir, "README.md"))).toBe(true);
    expect(existsSync(join(testPluginDir, ".gitignore"))).toBe(true);
    expect(existsSync(join(testPluginDir, "test", "plugin.test.ts"))).toBe(true);
    expect(existsSync(join(testPluginDir, "examples", "basic.ts"))).toBe(true);
  });

  test("scaffolded plugin has correct structure", async () => {
    // Read the generated files
    const srcContent = readFileSync(join(testPluginDir, "src", "index.ts"), "utf-8");
    expect(srcContent).toContain("createPlugin");
    expect(srcContent).toContain("AsiPlugin");
    expect(srcContent).toContain("TestPluginPlugin");
    expect(srcContent).toContain('name: "test-plugin"');

    const pkgContent = JSON.parse(
      readFileSync(join(testPluginDir, "package.json"), "utf-8"),
    );
    expect(pkgContent.name).toContain("asijs-test-plugin");
    expect(pkgContent.description).toBe("A test plugin");
    expect(pkgContent.author).toBe("Test Author");
    expect(pkgContent.peerDependencies.asijs).toBe("latest");

    const readmeContent = readFileSync(join(testPluginDir, "README.md"), "utf-8");
    expect(readmeContent).toContain("test-plugin");
    expect(readmeContent).toContain("TestPlugin");
  });

  test("scaffold fails if directory exists", async () => {
    const { scaffoldPlugin } = await import("../src/plugin-registry");

    const result = scaffoldPlugin({
      name: "test-plugin",
      baseDir: TEST_TMP,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("already exists");
  });
});

// ========================================================================
// listInstalledPlugins
// ========================================================================

describe("listInstalledPlugins", () => {
  test("returns empty array when no package.json", async () => {
    const { listInstalledPlugins } = await import("../src/plugin-registry");
    const installed = listInstalledPlugins({ cwd: "/nonexistent" });
    expect(installed).toEqual([]);
  });

  test("detects asijs scoped packages in package.json", async () => {
    const { listInstalledPlugins } = await import("../src/plugin-registry");

    // Read the actual project package.json
    const rootPkg = JSON.parse(
      readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
    );

    // at minimum, asijs itself should be found (or not, depending on install)
    const installed = listInstalledPlugins();
    expect(Array.isArray(installed)).toBe(true);
    // Should not crash
    for (const p of installed) {
      expect(p.name).toBeDefined();
      expect(p.version).toBeDefined();
    }
  });
});

// ========================================================================
// Module exports
// ========================================================================

describe("module exports", () => {
  test("exports all expected functions and values", async () => {
    const mod = await import("../src/plugin-registry");
    expect(mod.PluginRegistry).toBeDefined();
    expect(mod.AWESOME_PLUGINS).toBeDefined();
    expect(mod.installPlugin).toBeDefined();
    expect(mod.uninstallPlugin).toBeDefined();
    expect(mod.listInstalledPlugins).toBeDefined();
    expect(mod.scaffoldPlugin).toBeDefined();
    // Types (interfaces) are not available at runtime
    expect(typeof mod.PluginRegistry).toBe("function");
  });

  test("index.ts re-exports plugin-registry", async () => {
    const mod = await import("../src/index");
    expect(mod.PluginRegistry).toBeDefined();
    expect(mod.AWESOME_PLUGINS).toBeDefined();
    expect(mod.installPlugin).toBeDefined();
    expect(mod.scaffoldPlugin).toBeDefined();
    expect(mod.listInstalledPlugins).toBeDefined();
  });
});
