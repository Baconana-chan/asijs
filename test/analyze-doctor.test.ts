/**
 * Tests: CLI v2 — analyze, doctor, upgrade
 */

import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  analyzeSource,
  analyzeProject,
  findSourceFiles,
  runDoctor,
  checkForUpdates,
  compareVersions,
  parseVersion,
  versionFromRange,
  upgradeProject,
} from "../src/index";

// ========================================================================
// analyze
// ========================================================================

describe("analyze — source analysis", () => {
  it("detects duplicate routes (dead code)", () => {
    const report = analyzeSource(`
import { Asi } from "asijs";
const app = new Asi();
app.get("/users", () => []);
app.get("/users", () => []);
`);
    expect(report.issues.some((i) => i.kind === "dead-route")).toBe(true);
  });

  it("detects missing validation on mutating routes", () => {
    const report = analyzeSource(`
import { Asi } from "asijs";
const app = new Asi();
app.post("/users", () => ({}));
app.post("/validated", { schema: { body: { type: "object" } } }, () => ({}));
`);
    const missing = report.issues.find((i) => i.kind === "validation");
    expect(missing).toBeDefined();
    expect(missing!.message).toContain("POST /users");
  });

  it("detects duplicate middleware", () => {
    const report = analyzeSource(`
import { Asi } from "asijs";
const app = new Asi();
app.use(logger);
app.use(logger);
`, { includeInfo: true });
    const dup = report.issues.find((i) => i.kind === "middleware");
    expect(dup).toBeDefined();
    expect(dup!.message).toContain("logger");
  });

  it("detects redundant async handler (bottleneck)", () => {
    const report = analyzeSource(`
import { Asi } from "asijs";
const app = new Asi();
app.get("/x", async () => 42);
`, { includeInfo: true });
    const bottleneck = report.issues.find((i) => i.kind === "bottleneck");
    expect(bottleneck).toBeDefined();
    expect(bottleneck!.message).toContain("/x");
  });

  it("does not flag async handlers with await", () => {
    const report = analyzeSource(`
import { Asi } from "asijs";
const app = new Asi();
app.get("/x", async () => { const d = await fetchData(); return d; });
`, { includeInfo: true });
    expect(report.issues.filter((i) => i.kind === "bottleneck")).toHaveLength(0);
  });

  it("detects path shadowing (static after dynamic)", () => {
    const report = analyzeSource(`
import { Asi } from "asijs";
const app = new Asi();
app.get("/users/:id", () => ({}));
app.get("/users/new", () => ({}));
`, { includeInfo: true });
    const shadow = report.issues.find((i) => i.kind === "shadow");
    expect(shadow).toBeDefined();
  });

  it("filters info issues by default", () => {
    const report = analyzeSource(`
import { Asi } from "asijs";
const app = new Asi();
app.get("/x", async () => 42);
`);
    // Redundant-async is info-level → filtered out
    expect(report.issues.filter((i) => i.kind === "bottleneck")).toHaveLength(0);
  });
});

describe("analyze — project scanning", () => {
  const tmp = join(tmpdir(), "asijs-analyze-test-" + Date.now());

  it("scans files and analyzes a directory", async () => {
    mkdirSync(join(tmp, "src"), { recursive: true });
    writeFileSync(
      join(tmp, "src", "index.ts"),
      `import { Asi } from "asijs";
const app = new Asi();
app.get("/users", () => []);
app.post("/users", () => ({}));
`,
    );
    writeFileSync(join(tmp, "src", "routes.ts"), `export const x = 1;`);

    const files = findSourceFiles(tmp);
    expect(files.length).toBe(2);

    const report = await analyzeProject({ cwd: tmp });
    expect(report.summary.filesScanned).toBe(2);
    expect(report.issues.some((i) => i.kind === "validation")).toBe(true);

    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns empty report for empty dir", async () => {
    mkdirSync(tmp, { recursive: true });
    const report = await analyzeProject({ cwd: tmp });
    expect(report.summary.filesScanned).toBe(0);
    expect(report.issues).toHaveLength(0);
    rmSync(tmp, { recursive: true, force: true });
  });
});

// ========================================================================
// doctor
// ========================================================================

describe("doctor — project diagnostics", () => {
  const tmp = join(tmpdir(), "asijs-doctor-test-" + Date.now());

  it("passes a healthy project", async () => {
    mkdirSync(join(tmp, "src"), { recursive: true });
    writeFileSync(
      join(tmp, "package.json"),
      JSON.stringify({
        name: "healthy",
        dependencies: { asijs: "1.4.0" },
        devDependencies: { typescript: "^5" },
        scripts: { dev: "bun run --hot src/index.ts" },
      }),
    );
    writeFileSync(
      join(tmp, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true, moduleResolution: "bundler" } }),
    );
    writeFileSync(
      join(tmp, "src", "index.ts"),
      `import { Asi } from "asijs";
import { rateLimit } from "asijs";
import { Type } from "@sinclair/typebox";
const app = new Asi();
app.plugin(rateLimit({ max: 100, windowMs: 60000 }));
app.post("/users", { schema: { body: Type.Object({ name: Type.String() }) } }, () => ({}));
app.listen(3000);
`,
    );

    const report = await runDoctor({ cwd: tmp });
    expect(report.healthy).toBe(true);
    expect(report.checks.find((c) => c.name === "strict")!.status).toBe("pass");
    expect(report.checks.find((c) => c.name === "asijs")!.status).toBe("pass");
    expect(report.checks.find((c) => c.name === "rate-limit")!.status).toBe("pass");

    rmSync(tmp, { recursive: true, force: true });
  });

  it("flags a broken project (no asijs, no strict, secrets)", async () => {
    mkdirSync(join(tmp, "src"), { recursive: true });
    writeFileSync(
      join(tmp, "package.json"),
      JSON.stringify({ name: "broken", dependencies: { express: "^4" } }),
    );
    writeFileSync(
      join(tmp, "tsconfig.json"),
      JSON.stringify({ compilerOptions: {} }),
    );
    writeFileSync(
      join(tmp, "src", "index.ts"),
      `import { Asi } from "asijs";
const app = new Asi();
const apiKey = "sk-live-1234567890abcdef";
app.listen(3000);
`,
    );

    const report = await runDoctor({ cwd: tmp });
    expect(report.checks.find((c) => c.name === "asijs")!.status).toBe("fail");
    expect(report.checks.find((c) => c.name === "strict")!.status).toBe("fail");
    expect(report.checks.find((c) => c.name === "secrets")!.status).toBe("fail");
    expect(report.summary.fail).toBeGreaterThanOrEqual(3);

    rmSync(tmp, { recursive: true, force: true });
  });

  it("handles a missing project dir gracefully", async () => {
    const report = await runDoctor({ cwd: join(tmp, "does-not-exist") });
    expect(report.summary.skip).toBeGreaterThanOrEqual(1);
    expect(report.summary.fail).toBeGreaterThanOrEqual(1);
  });
});

// ========================================================================
// upgrade
// ========================================================================

describe("upgrade — version helpers", () => {
  it("parses versions", () => {
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseVersion("v2.0.0-beta.1")).toEqual({ major: 2, minor: 0, patch: 0 });
  });

  it("compares versions", () => {
    expect(compareVersions("1.4.0", "1.3.0")).toBeGreaterThan(0);
    expect(compareVersions("1.3.0", "1.4.0")).toBeLessThan(0);
    expect(compareVersions("1.3.0", "1.3.0")).toBe(0);
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
  });

  it("extracts versions from ranges", () => {
    expect(versionFromRange("^1.2.3")).toBe("1.2.3");
    expect(versionFromRange("~1.2.3")).toBe("1.2.3");
    expect(versionFromRange("latest")).toBeNull();
  });

  it("checks for updates offline", async () => {
    const check = await checkForUpdates(process.cwd(), { offline: true });
    // The repo's own package.json is the asijs package itself — no self-dep
    expect(check.latest).toBeNull();
    expect(check.updateAvailable).toBe(false);
  });

  it("finds a local install in a temp project", async () => {
    const tmp = join(tmpdir(), "asijs-update-test-" + Date.now());
    mkdirSync(tmp, { recursive: true });
    writeFileSync(
      join(tmp, "package.json"),
      JSON.stringify({ name: "x", dependencies: { asijs: "^1.2.0" } }),
    );
    const check = await checkForUpdates(tmp, { offline: true });
    expect(check.installed).toBe("1.2.0");
    expect(check.updateAvailable).toBe(false);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("upgrades offline to latest specifier (dry run)", async () => {
    const tmp = join(tmpdir(), "asijs-upgrade-write-test-" + Date.now());
    mkdirSync(tmp, { recursive: true });
    writeFileSync(
      join(tmp, "package.json"),
      JSON.stringify({ name: "x", dependencies: { asijs: "^1.2.0" } }),
    );
    const result = await upgradeProject({ cwd: tmp, offline: true, dryRun: true });
    expect(result.newSpecifier).toBe("latest");
    expect(result.updated).toBe(true);
    rmSync(tmp, { recursive: true, force: true });
  });
});
