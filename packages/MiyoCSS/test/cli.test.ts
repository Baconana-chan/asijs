import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  collectInfo,
  countUtilitySurface,
  findConfigFile,
  validateConfig,
  formatInfo,
} from "../src/cli";
import { resolveDefaultConfig } from "../src/core";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

/** file:// URL of the package core entry — for configs written into temp dirs. */
const CORE_URL = pathToFileURL(
  join(import.meta.dir, "..", "src", "core", "index.ts"),
).href;

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "miyocss-cli-"));
}

describe("findConfigFile", () => {
  test("finds conventional names in priority order", () => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, "miyocss.config.json"), "{}");
      expect(findConfigFile(dir)?.endsWith(".json")).toBe(true);
      writeFileSync(join(dir, "miyocss.config.ts"), "");
      expect(findConfigFile(dir)?.endsWith(".ts")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("explicit path wins over conventional", () => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, "custom.ts"), "");
      expect(findConfigFile(dir, "custom.ts")?.endsWith("custom.ts")).toBe(true);
      expect(findConfigFile(dir, "missing.ts")).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("validateConfig", () => {
  test("accepts a valid config", () => {
    expect(validateConfig({ theme: { spacing: { 1: "4px" } } })).toEqual({
      ok: true,
      errors: [],
    });
  });

  test("returns paths of invalid configs", () => {
    const result = validateConfig({ theme: { colors: { blue: 123 } } });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("/theme/colors/blue");
  });
});

describe("countUtilitySurface", () => {
  test("counts static + token-driven + grid + fractions", () => {
    const resolved = resolveDefaultConfig();
    const count = countUtilitySurface(resolved);
    // defaults: 18 colors × 3 + 33 spacing steps × ~40 + typography + grid
    expect(count).toBeGreaterThan(1800);
    expect(count).toBeLessThan(4000);
  });

  test("grows with extended tokens", async () => {
    const dir = tempDir();
    try {
      writeFileSync(
        join(dir, "miyocss.config.ts"),
        `import { defineConfig } from "${CORE_URL}";
export default defineConfig({ extend: { theme: { colors: { brand: "#6d28d9" } } } });`,
      );
      const info = await collectInfo({ cwd: dir });
      const plain = countUtilitySurface(resolveDefaultConfig());
      expect(info.stats.utilitySurface).toBe(plain + 3); // +1 color × 3 families
      expect(info.stats.colors).toBeGreaterThan(120);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("collectInfo", () => {
  test("no config → defaults, valid", async () => {
    const info = await collectInfo({ cwd: tempDir() });
    expect(info.configSource).toBeNull();
    expect(info.usingDefaults).toBe(true);
    expect(info.configValid).toBe(true);
    expect(info.stats.spacing).toBeGreaterThan(30);
    expect(info.stats.breakpoints.names).toContain("lg");
  });

  test("loads a .ts config and reports it", async () => {
    const dir = tempDir();
    try {
      writeFileSync(
        join(dir, "miyocss.config.ts"),
        `import { defineConfig } from "${CORE_URL}";
export default defineConfig({ options: { prefix: "mi-" }, extend: { theme: { spacing: { 18: "72px" } } } });`,
      );
      const info = await collectInfo({ cwd: dir });
      expect(info.configSource).toContain("miyocss.config.ts");
      expect(info.usingDefaults).toBe(false);
      expect(info.configValid).toBe(true);
      expect(info.stats.spacing).toBeGreaterThan(33); // default + 18
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("invalid config → invalid + defaults fallback", async () => {
    const dir = tempDir();
    try {
      writeFileSync(
        join(dir, "miyocss.config.ts"),
        `export default { theme: { colors: { blue: 123 } } };`,
      );
      const info = await collectInfo({ cwd: dir });
      expect(info.configValid).toBe(false);
      expect(info.errors.join(" ")).toContain("/theme/colors/blue");
      expect(info.stats.spacing).toBeGreaterThan(30); // still resolved defaults
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("empty config file (no export) is reported", async () => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, "miyocss.config.ts"), `export const x = 1;`);
      const info = await collectInfo({ cwd: dir });
      expect(info.configValid).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("formatInfo", () => {
  test("text output contains token sections", async () => {
    const info = await collectInfo({ cwd: tempDir() });
    const text = formatInfo(info, false);
    expect(text).toContain("miyocss info — v");
    expect(text).toContain("Tokens:");
    expect(text).toContain("colors");
    expect(text).toContain("breakpoints");
    expect(text).toContain("estimated total");
  });

  test("json output is parseable and complete", async () => {
    const info = await collectInfo({ cwd: tempDir() });
    const parsed = JSON.parse(formatInfo(info, true));
    expect(parsed.stats.colors).toBe(info.stats.colors);
    expect(parsed.configValid).toBe(true);
  });
});

describe("CLI end-to-end (spawn)", () => {
  test("`bun run src/cli.ts info` prints stats", () => {
    const dir = tempDir();
    try {
      const result = spawnSync("bun", ["run", CLI, "info", "--cwd", dir], {
        encoding: "utf8",
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("miyocss info — v0.1.0");
      expect(result.stdout).toContain("spacing");
      expect(result.stdout).toContain("breakpoints");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("`--json` output is valid JSON", () => {
    const dir = tempDir();
    try {
      const result = spawnSync(
        "bun",
        ["run", CLI, "info", "--cwd", dir, "--json"],
        { encoding: "utf8" },
      );
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.stats.utilitySurface).toBeGreaterThan(1000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("invalid config → exit code 1 + error printed", () => {
    const dir = tempDir();
    try {
      writeFileSync(
        join(dir, "miyocss.config.ts"),
        `export default { theme: { colors: { blue: 123 } } };`,
      );
      const result = spawnSync(
        "bun",
        ["run", CLI, "info", "--cwd", dir],
        { encoding: "utf8" },
      );
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("INVALID");
      expect(result.stdout).toContain("/theme/colors/blue");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("`--help` prints usage and exits 0", () => {
    const result = spawnSync("bun", ["run", CLI, "--help"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("miyocss");
    expect(result.stdout).toContain("--config");
  });
});
