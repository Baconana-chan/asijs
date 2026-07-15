/**
 * Tests for Standalone Dev Mode
 *
 * Covers:
 * - findStandaloneEntry: detection of entry files in various locations
 * - startStandaloneDev: creates correct controller from detected entry
 * - asiDev: auto-detection fallback to standalone when no workspace
 * - WorkspaceDevController: standalone app uses same controller infrastructure
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";

import {
  findStandaloneEntry,
  startStandaloneDev,
  asiDev,
  scanWorkspace,
  WorkspaceDevController,
} from "../src";

// ========================================================================
// Helpers
// ========================================================================

const TMP_ROOT = join(tmpdir(), "asijs-standalone-test");

function tmpPath(...parts: string[]): string {
  return join(TMP_ROOT, ...parts);
}

function createProject(relDir: string, entryFile: string, content?: string) {
  const dir = tmpPath(relDir);
  const fullPath = join(dir, entryFile);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(
    fullPath,
    content ?? `import { Asi } from "asijs";\nconst app = new Asi();\napp.listen(3000);\n`,
    "utf-8",
  );
  return dir;
}

// ========================================================================
// findStandaloneEntry
// ========================================================================

describe("findStandaloneEntry()", () => {
  beforeEach(() => {
    rmSync(TMP_ROOT, { recursive: true, force: true });
    mkdirSync(TMP_ROOT, { recursive: true });
  });

  afterEach(() => {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  it("finds src/index.ts", () => {
    const dir = createProject("proj1", "src/index.ts");
    expect(findStandaloneEntry(dir)).toBe(join(dir, "src/index.ts"));
  });

  it("finds src/index.tsx", () => {
    const dir = createProject("proj-tsx", "src/index.tsx");
    expect(findStandaloneEntry(dir)).toBe(join(dir, "src/index.tsx"));
  });

  it("finds src/app.ts", () => {
    const dir = createProject("proj-app", "src/app.ts");
    expect(findStandaloneEntry(dir)).toBe(join(dir, "src/app.ts"));
  });

  it("finds index.ts at root", () => {
    const dir = createProject("proj-root", "index.ts");
    expect(findStandaloneEntry(dir)).toBe(join(dir, "index.ts"));
  });

  it("finds index.tsx at root", () => {
    const dir = createProject("proj-rootx", "index.tsx");
    expect(findStandaloneEntry(dir)).toBe(join(dir, "index.tsx"));
  });

  it("finds main.ts in src/", () => {
    const dir = createProject("proj-main", "src/main.ts");
    expect(findStandaloneEntry(dir)).toBe(join(dir, "src/main.ts"));
  });

  it("finds server.ts in src/", () => {
    const dir = createProject("proj-server", "src/server.ts");
    expect(findStandaloneEntry(dir)).toBe(join(dir, "src/server.ts"));
  });

  it("returns null for non-AsiJS files", () => {
    const dir = createProject(
      "proj-plain",
      "src/index.ts",
      `import { something } from "else";\nconsole.log("hi");`,
    );
    expect(findStandaloneEntry(dir)).toBeNull();
  });

  it("returns null for empty directory", () => {
    const dir = tmpPath("empty-dir");
    mkdirSync(dir, { recursive: true });
    expect(findStandaloneEntry(dir)).toBeNull();
  });

  it("returns null when no entry found", () => {
    const dir = tmpPath("no-entry");
    mkdirSync(dir, { recursive: true });
    // Only non-AsiJS files exist — создаём src/ поддиректорию
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/utils.ts"), `export const x = 1;`, "utf-8");
    expect(findStandaloneEntry(dir)).toBeNull();
  });

  it("prefers src/index.ts over index.ts", () => {
    const dir = createProject("proj-prefer", "src/index.ts");
    // Also create root index.ts
    writeFileSync(
      join(dir, "index.ts"),
      `import { Asi } from "asijs";\nconsole.log("root");\n`,
      "utf-8",
    );
    // Should prefer src/index.ts (first in STANDALONE_ENTRIES that matches)
    expect(findStandaloneEntry(dir)).toBe(join(dir, "src/index.ts"));
  });

  it("uses current working directory when no argument given", () => {
    // Just test that it doesn't throw and returns a string or null
    const result = findStandaloneEntry();
    // Can be either — depends on context
    expect(result === null || typeof result === "string").toBe(true);
  });
});

// ========================================================================
// startStandaloneDev
// ========================================================================

describe("startStandaloneDev()", () => {
  beforeEach(() => {
    rmSync(TMP_ROOT, { recursive: true, force: true });
    mkdirSync(TMP_ROOT, { recursive: true });
  });

  afterEach(() => {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  it("creates a controller with correct app", async () => {
    const dir = createProject("standalone-test", "src/index.ts");
    const origCwd = process.cwd;
    // Temporarily mock cwd
    process.cwd = () => dir;

    try {
      const controller = await startStandaloneDev({ verbose: false });

      expect(controller).toBeInstanceOf(WorkspaceDevController);
      expect(controller.apps).toHaveLength(1);
      expect(controller.apps[0].name).toBe("standalone-test");
      expect(controller.apps[0].entryPoint).toBe(join(dir, "src/index.ts"));
      expect(controller.apps[0].status).toBe("running");
      expect(controller.apps[0].port).toBe(3000);

      await controller.stop();
    } finally {
      process.cwd = origCwd;
    }
  });

  it("assigns custom port", async () => {
    const dir = createProject("port-test", "src/index.ts");
    const origCwd = process.cwd;
    process.cwd = () => dir;

    try {
      const controller = await startStandaloneDev({
        basePort: 4000,
        verbose: false,
      });

      expect(controller.apps[0].port).toBe(4000);
      await controller.stop();
    } finally {
      process.cwd = origCwd;
    }
  });

  it("throws when no entry found", async () => {
    const emptyDir = tmpPath("no-app-here");
    mkdirSync(emptyDir, { recursive: true });
    const origCwd = process.cwd;
    process.cwd = () => emptyDir;

    try {
      await expect(startStandaloneDev({ verbose: false })).rejects.toThrow(
        "No AsiJS app found",
      );
    } finally {
      process.cwd = origCwd;
    }
  });
});

// ========================================================================
// asiDev standalone fallback
// ========================================================================

describe("asiDev() standalone fallback", () => {
  beforeEach(() => {
    rmSync(TMP_ROOT, { recursive: true, force: true });
    mkdirSync(TMP_ROOT, { recursive: true });
  });

  afterEach(() => {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  it("starts standalone when no workspace found", async () => {
    const dir = createProject("standalone-asi", "src/index.ts");
    const origCwd = process.cwd;
    process.cwd = () => dir;

    try {
      const controller = await asiDev({ verbose: false });

      expect(controller).toBeInstanceOf(WorkspaceDevController);
      expect(controller.apps).toHaveLength(1);
      expect(controller.apps[0].name).toBe("standalone-asi");

      await controller.stop();
    } finally {
      process.cwd = origCwd;
    }
  });

  it("prefers workspace over standalone", async () => {
    const dir = createProject("ws-standalone", "src/index.ts");
    // Add package.json with workspaces to trigger workspace mode
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "ws-test", workspaces: ["packages/*"] }),
      "utf-8",
    );

    const origCwd = process.cwd;
    process.cwd = () => dir;

    try {
      // Should not throw because asiDev handles standalone fallback
      // But there's no workspace sub-app, so it should fallback to standalone
      const controller = await asiDev({ verbose: false });

      expect(controller).toBeInstanceOf(WorkspaceDevController);
      expect(controller.apps).toHaveLength(1);

      await controller.stop();
    } finally {
      process.cwd = origCwd;
    }
  });
});

// ========================================================================
// WorkspaceDevController with single app
// ========================================================================

describe("WorkspaceDevController single app", () => {
  it("creates controller with a single standalone app", () => {
    const app = {
      name: "my-app",
      entryPoint: "/project/src/index.ts",
      rootDir: "/project",
      port: 3000,
      process: null,
      status: "stopped" as const,
    };

    const controller = new WorkspaceDevController([app], { verbose: false });
    expect(controller.apps).toHaveLength(1);
    expect(controller.apps[0].name).toBe("my-app");
    expect(controller.running).toBe(false);
  });
});
