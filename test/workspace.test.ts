/**
 * Workspace Dev Server Tests
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { scanWorkspace, WorkspaceDevController } from "../src/workspace";

// ===== Test Helpers =====

function createTempDir(name?: string): string {
  const dir = join(
    import.meta.dir, "..", ".tmp",
    `ws-test-${name ?? Date.now()}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeFileIn(dir: string, filePath: string, content: string) {
  const fullDir = join(dir, filePath.split("/").slice(0, -1).join("/"));
  mkdirSync(fullDir, { recursive: true });
  writeFileSync(join(dir, filePath), content);
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

describe("Workspace", () => {
  afterAll(() => {
    // Cleanup all test dirs
    const tmpBase = join(import.meta.dir, "..", ".tmp");
    if (existsSync(tmpBase)) {
      try {
        rmSync(tmpBase, { recursive: true, force: true });
      } catch {}
    }
  });

  describe("scanWorkspace()", () => {
    it("should scan a simple workspace with packages", () => {
      const dir = createTempDir("packages");
      writeFileIn(
        dir, "package.json",
        JSON.stringify({ name: "test", workspaces: ["packages/*"] }),
      );
      writeFileIn(
        dir, "packages/api/package.json",
        JSON.stringify({ name: "api", type: "module" }),
      );
      writeFileIn(
        dir, "packages/api/src/index.ts",
        `import { Asi } from "asijs";\nconst app = new Asi();\napp.get("/", () => "ok");\napp.listen(3001);\n`,
      );
      writeFileIn(
        dir, "packages/web/package.json",
        JSON.stringify({ name: "web", type: "module" }),
      );
      writeFileIn(
        dir, "packages/web/src/index.tsx",
        `import { Asi, html } from "asijs";\nconst app = new Asi();\napp.get("/", () => "ok");\napp.listen(3002);\n`,
      );

      const apps = scanWorkspace({ cwd: dir });

      expect(apps.length).toBe(2);
      expect(apps[0].name).toBe("api");
      expect(apps[1].name).toBe("web");
      expect(normalizePath(apps[0].entryPoint)).toContain("packages/api/src/index.ts");
      expect(normalizePath(apps[1].entryPoint)).toContain("packages/web/src/index.tsx");
      expect(apps[0].port).toBe(3000);
      expect(apps[1].port).toBe(3001);
      expect(apps[0].status).toBe("stopped");
      expect(apps[0].process).toBeNull();
    });

    it("should return empty array when no AsiJS apps found", () => {
      const dir = createTempDir("empty");
      writeFileIn(
        dir, "package.json",
        JSON.stringify({ name: "empty", workspaces: ["packages/*"] }),
      );
      writeFileIn(
        dir, "packages/lib/package.json",
        JSON.stringify({ name: "lib" }),
      );
      writeFileIn(
        dir, "packages/lib/src/index.ts",
        `export const x = 1;`,
      );

      const apps = scanWorkspace({ cwd: dir });
      expect(apps.length).toBe(0);
    });

    it("should scan apps/ directory as fallback when no workspaces configured", () => {
      const dir = createTempDir("fallback");
      writeFileIn(
        dir, "apps/api/src/index.ts",
        `import { Asi } from "asijs";\nconst app = new Asi();\napp.listen(3001);\n`,
      );

      const apps = scanWorkspace({ cwd: dir });

      expect(apps.length).toBe(1);
      expect(apps[0].name).toBe("api");
    });

    it("should detect standalone app at root", () => {
      const dir = createTempDir("root");
      writeFileIn(
        dir, "src/index.ts",
        `import { Asi } from "asijs";\nconst app = new Asi();\napp.listen(3000);\n`,
      );

      const apps = scanWorkspace({ cwd: dir });

      expect(apps.length).toBeGreaterThanOrEqual(1);
      expect(normalizePath(apps[0].entryPoint)).toContain("src/index.ts");
    });
  });

  describe("WorkspaceDevController", () => {
    it("should create controller with correct defaults", () => {
      const controller = new WorkspaceDevController([], {});
      expect(controller.apps).toEqual([]);
      expect(controller.running).toBe(false);
      expect(controller.options.basePort).toBe(3000);
      expect(controller.options.verbose).toBe(true);
    });

    it("should assign ports starting from basePort", () => {
      const apps: any[] = [
        { name: "app1", entryPoint: "/test/src/index.ts", rootDir: "/test" },
        { name: "app2", entryPoint: "/test/src/index.ts", rootDir: "/test" },
      ];
      const controller = new WorkspaceDevController(apps, { basePort: 5000 });
      expect(apps[0].port).toBe(5000);
      expect(apps[1].port).toBe(5001);
    });

    it("should not start when already running", async () => {
      const controller = new WorkspaceDevController([], { verbose: false });
      await controller.start();
      expect(controller.running).toBe(true);
      await controller.stop();
      expect(controller.running).toBe(false);
    });
  });
});
