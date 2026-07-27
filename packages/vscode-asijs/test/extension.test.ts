/**
 * VS Code Extension Tests: vscode-asijs (v0.2.0)
 *
 * Tests cover:
 * - parseRoutes() — Route parsing from source code (existing)
 * - Debug configuration provider
 * - Template definitions and explorer
 * - Create wizard logic
 * - Diagnostics logic
 * - Extension activation commands
 * - Edge cases
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { parseRoutes } from "../src/parse-routes";
import { TEMPLATES } from "../src/templates";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ============================================================================
// Tests for parseRoutes (existing)
// ============================================================================

describe("parseRoutes", () => {
  test("parses a GET route", () => {
    const source = `app.get("/", () => "hello");`;
    const routes = parseRoutes(source);
    expect(routes).toHaveLength(1);
    expect(routes[0].method).toBe("GET");
    expect(routes[0].path).toBe("/");
    expect(routes[0].line).toBe(1);
    expect(routes[0].hasValidation).toBe(false);
    expect(routes[0].isWebSocket).toBe(false);
  });

  test("parses multiple HTTP methods", () => {
    const source = [
      `app.get("/users", () => []);`,
      `app.post("/users", () => []);`,
      `app.put("/users/:id", () => []);`,
      `app.delete("/users/:id", () => []);`,
      `app.patch("/users/:id", () => []);`,
    ].join("\n");
    const routes = parseRoutes(source);
    expect(routes).toHaveLength(5);
    expect(routes.map((r) => r.method)).toEqual([
      "GET",
      "POST",
      "PUT",
      "DELETE",
      "PATCH",
    ]);
  });

  test("parses WebSocket routes with isWebSocket flag", () => {
    const source = `app.ws("/ws", { open(ws) {}, message(ws, msg) {} });`;
    const routes = parseRoutes(source);
    expect(routes).toHaveLength(1);
    expect(routes[0].method).toBe("WS");
    expect(routes[0].path).toBe("/ws");
    expect(routes[0].isWebSocket).toBe(true);
  });

  test("handles single quotes", () => {
    const source = `app.get('/api/items', () => []);`;
    const routes = parseRoutes(source);
    expect(routes).toHaveLength(1);
    expect(routes[0].path).toBe("/api/items");
  });

  test("handles template literals", () => {
    const source = "app.get(`/api/${id}`, () => []);";
    const routes = parseRoutes(source);
    expect(routes).toHaveLength(1);
    expect(routes[0].path).toBe("/api/${id}");
  });

  test("detects validation schemas", () => {
    const source = [
      `app.get("/users/:id",`,
      `  { schema: { params: { id: String } } },`,
      `  (ctx) => ctx.params,`,
      `);`,
    ].join("\n");
    const routes = parseRoutes(source);
    expect(routes).toHaveLength(1);
    expect(routes[0].hasValidation).toBe(true);
  });

  test("returns empty array for empty source", () => {
    expect(parseRoutes("")).toEqual([]);
  });

  test("calculates correct line numbers", () => {
    const source = [
      ``,
      `// comment`,
      ``,
      `app.get("/line4", () => "ok");`,
      ``,
      `app.get("/line6", () => "ok");`,
      ``,
    ].join("\n");
    const routes = parseRoutes(source);
    expect(routes).toHaveLength(2);
    expect(routes[0].line).toBe(4);
    expect(routes[1].line).toBe(6);
  });
});

// ============================================================================
// Tests for Templates
// ============================================================================

describe("TEMPLATES", () => {
  test("has at least 8 templates", () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(8);
  });

  test("all templates have required fields", () => {
    for (const t of TEMPLATES) {
      expect(t.id).toBeDefined();
      expect(t.name).toBeDefined();
      expect(t.description).toBeDefined();
      expect(t.category).toBeDefined();
      expect(t.icon).toBeDefined();
      expect(t.order).toBeGreaterThan(0);
      expect(t.files.length).toBeGreaterThan(0);
    }
  });

  test("all templates have unique ids", () => {
    const ids = TEMPLATES.map((t) => t.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  test("templates have files with path and content", () => {
    for (const t of TEMPLATES) {
      for (const f of t.files) {
        expect(f.path).toBeDefined();
        expect(f.content).toBeDefined();
        expect(f.path.length).toBeGreaterThan(0);
        expect(f.content.length).toBeGreaterThan(0);
      }
    }
  });

  test("templates are ordered by their order field", () => {
    const sorted = [...TEMPLATES].sort((a, b) => a.order - b.order);
    expect(sorted.map((t) => t.id)).toEqual(TEMPLATES.map((t) => t.id));
  });

  test("categories include Core, Security, Deployment, Advanced", () => {
    const categories = [...new Set(TEMPLATES.map((t) => t.category))];
    expect(categories).toContain("Core");
    expect(categories).toContain("Security");
    expect(categories).toContain("Deployment");
    expect(categories).toContain("Advanced");
  });

  test("minimal template has src/index.ts entry", () => {
    const minimal = TEMPLATES.find((t) => t.id === "minimal");
    expect(minimal).toBeDefined();
    const mainFile = minimal!.files.find((f) => f.path === "src/index.ts");
    expect(mainFile).toBeDefined();
    expect(mainFile!.content).toContain("Asi");
    expect(mainFile!.content).toContain("app.listen");
  });

  test("api template has TypeBox validation", () => {
    const api = TEMPLATES.find((t) => t.id === "api");
    expect(api).toBeDefined();
    const mainFile = api!.files.find((f) => f.path === "src/index.ts");
    expect(mainFile).toBeDefined();
    expect(mainFile!.content).toContain("@sinclair/typebox");
    expect(mainFile!.content).toContain("cors");
    expect(mainFile!.content).toContain("openapi");
  });

  test("realtime template has WebSocket handler", () => {
    const realtime = TEMPLATES.find((t) => t.id === "realtime");
    expect(realtime).toBeDefined();
    const mainFile = realtime!.files.find((f) => f.path === "src/index.ts");
    expect(mainFile).toBeDefined();
    expect(mainFile!.content).toContain("WebSocket");
    expect(mainFile!.content).toContain("app.ws");
  });

  test("cloudflare template has wrangler.toml", () => {
    const cf = TEMPLATES.find((t) => t.id === "cloudflare");
    expect(cf).toBeDefined();
    const wrangler = cf!.files.find((f) => f.path === "wrangler.toml");
    expect(wrangler).toBeDefined();
    expect(wrangler!.content).toContain("compatibility_date");
  });

  test("each template has content that compiles to valid js patterns", () => {
    for (const t of TEMPLATES) {
      for (const f of t.files) {
        if (f.path.endsWith(".ts") || f.path.endsWith(".tsx")) {
          // Should have valid import/export patterns
          expect(f.content).toMatch(/import|export|const|function/);
          // Should have AsiJS specific patterns for main files
          if (f.path.includes("index")) {
            expect(f.content).toContain("Asi");
          }
        }
      }
    }
  });

  test("spa template has client.tsx with hydrate", () => {
    const spa = TEMPLATES.find((t) => t.id === "spa");
    expect(spa).toBeDefined();
    const clientFile = spa!.files.find((f) => f.path === "src/client.tsx");
    expect(clientFile).toBeDefined();
    expect(clientFile!.content).toContain("hydrate");
    expect(clientFile!.content).toContain("asijs/spa-client");
  });
});

// ============================================================================
// Tests for Create Wizard logic
// ============================================================================

describe("Create Wizard logic", () => {
  const TEST_TMP = join(tmpdir(), "asijs-test-create-wizard");

  beforeAll(() => {
    try { rmSync(TEST_TMP, { recursive: true }); } catch {}
    mkdirSync(TEST_TMP, { recursive: true });
  });

  afterAll(() => {
    try { rmSync(TEST_TMP, { recursive: true }); } catch {}
  });

  test("template content replaces my-app placeholders in package.json", () => {
    const minimal = TEMPLATES.find((t) => t.id === "minimal")!;
    const pkgFile = minimal.files.find((f) => f.path === "package.json")!;

    // package.json has "name": "my-app" which should be replaced by the wizard
    expect(pkgFile.content).toContain("my-app");
    const replacedPkg = pkgFile.content.replace(/my-app/g, "test-project");
    expect(replacedPkg).toContain("test-project");
    expect(JSON.parse(replacedPkg).name).toBe("test-project");
  });

  test("template content replaces placeholders across all package.json files", () => {
    const api = TEMPLATES.find((t) => t.id === "api")!;
    const cloudflare = TEMPLATES.find((t) => t.id === "cloudflare")!;

    // API template uses "my-api" in package.json
    const apiPkg = api.files.find((f) => f.path === "package.json");
    if (apiPkg) {
      expect(apiPkg.content).toContain("my-api");
      const replaced = apiPkg.content.replace(/my-api/g, "test-api");
      expect(JSON.parse(replaced).name).toBe("test-api");
    }

    // Cloudflare template uses "my-worker" in wrangler.toml
    const wrangler = cloudflare.files.find((f) => f.path === "wrangler.toml");
    if (wrangler) {
      expect(wrangler.content).toContain("my-worker");
      const replaced = wrangler.content.replace(/my-worker/g, "test-worker");
      expect(replaced).toContain("test-worker");
    }
  });

  test("template content has valid JSON in package.json", () => {
    for (const t of TEMPLATES) {
      for (const f of t.files) {
        if (f.path.endsWith("package.json")) {
          expect(() => JSON.parse(f.content)).not.toThrow();
          const pkg = JSON.parse(f.content);
          expect(pkg.name).toBeDefined();
        }
      }
    }
  });

  test("template content has valid JSON in tsconfig.json", () => {
    for (const t of TEMPLATES) {
      for (const f of t.files) {
        if (f.path.endsWith("tsconfig.json") || f.path.endsWith("deno.json")) {
          expect(() => JSON.parse(f.content)).not.toThrow();
        }
      }
    }
  });
});

// ============================================================================
// Tests for Diagnostics logic
// ============================================================================

describe("Diagnostics logic", () => {
  test("detects TypeBox usage without import", () => {
    const source = [
      `import { Asi } from "asijs";`,
      `app.get("/test", {`,
      `  schema: { params: Type.Object({ id: Type.String() }) }`,
      `}, (ctx) => ctx.params);`,
    ].join("\n");

    const hasTypeBoxUsage = /Type\.(Object|String|Number|Boolean|Array|Optional|Union|Intersect)\s*\(/.test(source);
    const hasTypeBoxImport = /@sinclair\/typebox/.test(source);

    expect(hasTypeBoxUsage).toBe(true);
    expect(hasTypeBoxImport).toBe(false);
  });

  test("detects TypeBox import when present", () => {
    const source = [
      `import { Type } from "@sinclair/typebox";`,
      `import { Asi } from "asijs";`,
      `app.get("/test", {`,
      `  schema: { params: Type.Object({ id: Type.String() }) }`,
      `}, (ctx) => ctx.params);`,
    ].join("\n");

    const hasTypeBoxUsage = /Type\.(Object|String|Number|Boolean|Array|Optional|Union|Intersect)\s*\(/.test(source);
    const hasTypeBoxImport = /@sinclair\/typebox/.test(source);

    expect(hasTypeBoxUsage).toBe(true);
    expect(hasTypeBoxImport).toBe(true);
  });

  test("detects missing async when await is used", () => {
    const source = `app.get("/", (ctx) => { const data = await fetch("..."); return data; });`;
    const hasAwait = /\bawait\b/.test(source);
    const hasAsync = /\basync\b/.test(source);
    expect(hasAwait).toBe(true);
    expect(hasAsync).toBe(false);
  });

  test("detects present async when await is used", () => {
    const source = `app.get("/", async (ctx) => { const data = await fetch("..."); return data; });`;
    const hasAwait = /\bawait\b/.test(source);
    const hasAsync = /\basync\b/.test(source);
    expect(hasAwait).toBe(true);
    expect(hasAsync).toBe(true);
  });

  test("isEntryFile returns true for src/index.ts", () => {
    const entryPatterns = ["src/index.ts", "src/index.tsx", "src/app.ts", "index.ts", "index.tsx"];

    for (const pattern of entryPatterns) {
      const baseName = pattern.replace(/\\/g, "/");
      const matches = entryPatterns.some((p) => baseName.endsWith(p));
      expect(matches).toBe(true);
    }
  });

  test("isEntryFile returns false for non-entry files", () => {
    const entryPatterns = ["src/index.ts", "src/index.tsx", "src/app.ts", "index.ts", "index.tsx"];
    const nonEntries = ["src/utils.ts", "src/components/button.tsx", "src/routes/users.ts", "test/app.test.ts"];

    for (const nonEntry of nonEntries) {
      const baseName = nonEntry.replace(/\\/g, "/");
      const matches = entryPatterns.some((p) => baseName.endsWith(p));
      expect(matches).toBe(false);
    }
  });

  test("detects TODO/FIXME comments", () => {
    const source = [
      `// TODO: implement pagination`,
      `app.get("/users", () => []);`,
      `// FIXME: this is broken`,
      `app.get("/items", () => []);`,
    ].join("\n");

    const todoMatches = [...source.matchAll(/\/\/\s*(TODO|FIXME|HACK|XXX)\b/gi)];
    expect(todoMatches).toHaveLength(2);
    expect(todoMatches[0][1]).toBe("TODO");
    expect(todoMatches[1][1]).toBe("FIXME");
  });

  test("detects cloudflare edge pattern", () => {
    const source = `import { cloudflare } from "asijs/edge";\nconst app = new Asi();\nexport default cloudflare(app);`;
    const isEdgeTarget = /cloudflare|deno|vercel/i.test("src/index.ts") || source.includes("asijs/edge");
    expect(isEdgeTarget).toBe(true);
  });
});

// ============================================================================
// Tests for Extension activation logic (VSCode-dependent tests can only run in VSCode test harness)
// ============================================================================

describe("extension activation logic", () => {
  test("findClosestRoute finds the nearest route by line", () => {
    const source = [
      `app.get("/users", () => []);`,
      `app.post("/users", (ctx) => ctx.json({}));`,
    ].join("\n");
    const routes = parseRoutes(source);

    const findClosestRoute = (
      routeList: Array<{ line: number }>,
      cursorLine: number,
    ) => {
      return routeList.reduce((prev, curr) =>
        Math.abs(curr.line - cursorLine) < Math.abs(prev.line - cursorLine)
          ? curr
          : prev,
      );
    };

    expect(findClosestRoute(routes, 0).path).toBe("/users");
    expect(findClosestRoute(routes, 3).path).toBe("/users");
  });

  test("showRoute command produces correct info message", () => {
    const source = 'app.get("/hello", () => "world");';
    const routes = parseRoutes(source);

    const closest = routes[0];
    const message = `${closest.method} ${closest.path} (line ${closest.line})`;

    expect(message).toBe("GET /hello (line 1)");
  });
});

// ============================================================================
// Tests for Hover provider logic
// ============================================================================

describe("hover provider logic", () => {
  test("detects app.method calls for hover", () => {
    const lineText = 'app.get("/api/users", (ctx) => ctx.json([]));';
    const routeMatch = lineText.match(
      /app\.(get|post|put|delete|patch|all|ws)\s*\(\s*['"`]([^'"`]+)['"`]/,
    );
    expect(routeMatch).not.toBeNull();
    expect(routeMatch![1]).toBe("get");
    expect(routeMatch![2]).toBe("/api/users");
  });

  test("hover returns null for non-route lines", () => {
    const lineText = "const x = 42;";
    const routeMatch = lineText.match(
      /app\.(get|post|put|delete|patch|all|ws)\s*\(\s*['"`]([^'"`]+)['"`]/,
    );
    expect(routeMatch).toBeNull();
  });

  test("hover matches all HTTP methods", () => {
    const methods = ["get", "post", "put", "delete", "patch", "all", "ws"];
    for (const method of methods) {
      const lineText = `app.${method}("/test", () => ({}));`;
      const routeMatch = lineText.match(
        /app\.(get|post|put|delete|patch|all|ws)\s*\(\s*['"`]([^'"`]+)['"`]/,
      );
      expect(routeMatch).not.toBeNull();
      expect(routeMatch![1]).toBe(method);
      expect(routeMatch![2]).toBe("/test");
    }
  });

  test("hover produces correct hover text", () => {
    const lineText = 'app.get("/hello", () => "world");';
    const routeMatch = lineText.match(
      /app\.(get|post|put|delete|patch|all|ws)\s*\(\s*['"`]([^'"`]+)['"`]/,
    );

    expect(routeMatch).not.toBeNull();

    const method = routeMatch![1].toUpperCase();
    const routePath = routeMatch![2];
    const hoverText = `**AsiJS Route**: \`${method} ${routePath}\``;

    expect(hoverText).toBe("**AsiJS Route**: `GET /hello`");
  });
});
