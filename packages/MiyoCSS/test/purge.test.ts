import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
  PurgeCache,
  hashCss,
  collectClassesFromHtml,
  purgeToFile,
  purgeDirectory,
  findHtmlFiles,
  resolveDefaultConfig,
  defineConfig,
} from "../src/core";
import { buildStatic } from "../src/cli";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
const config = resolveDefaultConfig();

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "miyocss-purge-"));
}

describe("hashCss", () => {
  test("is deterministic for identical CSS", () => {
    expect(hashCss("a{}")).toBe(hashCss("a{}"));
  });

  test("changes when CSS changes", () => {
    expect(hashCss("a{}")).not.toBe(hashCss("b{}"));
  });

  test("is a 10-char hex string", () => {
    expect(hashCss("p-4")).toMatch(/^[0-9a-f]{10}$/);
  });
});

describe("collectClassesFromHtml", () => {
  test("extracts classes from class attributes", () => {
    const html = '<div class="flex p-4"><span class="hover:bg-red-500">x</span></div>';
    const classes = collectClassesFromHtml(html);
    expect(classes.has("flex")).toBe(true);
    expect(classes.has("p-4")).toBe(true);
    expect(classes.has("hover:bg-red-500")).toBe(true);
  });

  test("handles single quotes and multiple attrs", () => {
    const html = `<div class='a b' data-x='1' class="c">`;
    const classes = collectClassesFromHtml(html);
    expect([...classes].sort()).toEqual(["a", "b", "c"]);
  });

  test("ignores non-class attributes", () => {
    const html = '<input class="input" data-class="not-a-class">';
    const classes = collectClassesFromHtml(html);
    expect(classes.has("input")).toBe(true);
    expect(classes.has("not-a-class")).toBe(false);
  });

  test("returns empty set for no classes", () => {
    expect(collectClassesFromHtml("<p>hi</p>").size).toBe(0);
  });
});

describe("PurgeCache", () => {
  test("accumulates and dedupes classes", () => {
    const cache = new PurgeCache(config);
    cache.add(["flex", "p-4"]);
    cache.add(["p-4", "bg-red-500"]);
    expect(cache.size).toBe(3);
    expect(cache.classNames.sort()).toEqual(["bg-red-500", "flex", "p-4"]);
  });

  test("addFromHtml scans class attributes", () => {
    const cache = new PurgeCache(config);
    cache.addFromHtml('<div class="grid gap-2">x</div>');
    expect(cache.size).toBe(2);
  });

  test("css() generates only collected classes", () => {
    const cache = new PurgeCache(config);
    cache.add(["flex", "p-4", "hover:bg-red-500"]);
    const css = cache.css(false);
    expect(css).toContain(".flex");
    expect(css).toContain(".p-4");
    expect(css).toContain(".hover\\:bg-red-500:hover");
    expect(css).not.toContain(".hidden");
  });

  test("css() minifies by default", () => {
    const cache = new PurgeCache(config);
    cache.add(["flex", "p-4"]);
    const css = cache.css();
    expect(css.includes("\n  ")).toBe(false);
  });

  test("hash() reflects content", () => {
    const a = new PurgeCache(config);
    const b = new PurgeCache(config);
    a.add(["flex"]);
    b.add(["grid"]);
    expect(a.hash()).not.toBe(b.hash());
  });

  test("reset clears classes", () => {
    const cache = new PurgeCache(config);
    cache.add(["flex"]);
    expect(cache.size).toBe(1);
    cache.reset();
    expect(cache.size).toBe(0);
  });

  test("accepts a MiyoConfig (defineConfig) too", () => {
    const cache = new PurgeCache(defineConfig({ extend: { theme: { colors: { brand: "#123" } } } }));
    cache.add(["bg-brand"]);
    expect(cache.css()).toContain("#123");
  });
});

describe("purgeToFile", () => {
  test("writes miyocss.<hash>.css with content", () => {
    const dir = tempDir();
    try {
      const cache = new PurgeCache(config);
      cache.add(["flex", "p-4"]);
      const result = purgeToFile(cache, { dir });
      expect(result.href).toBe(`miyocss.${result.hash}.css`);
      expect(readdirSync(dir)).toEqual([result.href]);
      const css = readFileSync(join(dir, result.href), "utf-8");
      expect(css).toContain(".flex");
      expect(css).not.toContain(".grid");
      expect(result.classes).toBe(2);
      expect(result.size).toBe(css.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("prunes stale siblings on content change", () => {
    const dir = tempDir();
    try {
      const cache = new PurgeCache(config);
      cache.add(["flex"]);
      const first = purgeToFile(cache, { dir });
      cache.add(["grid"]);
      const second = purgeToFile(cache, { dir });
      expect(first.href).not.toBe(second.href);
      expect(readdirSync(dir)).toEqual([second.href]);
      expect(second.pruned).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("immutable file: same content → same name, no rewrite", () => {
    const dir = tempDir();
    try {
      const cache = new PurgeCache(config);
      cache.add(["flex"]);
      const a = purgeToFile(cache, { dir });
      const b = purgeToFile(cache, { dir });
      expect(a.href).toBe(b.href);
      expect(b.pruned).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("custom name stem", () => {
    const dir = tempDir();
    try {
      const cache = new PurgeCache(config);
      cache.add(["flex"]);
      const result = purgeToFile(cache, { dir, name: "app" });
      expect(result.href.startsWith("app.")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("purgeDirectory", () => {
  test("scans HTML files and writes one CSS", () => {
    const dir = tempDir();
    try {
      mkdirSync(join(dir, "sub"), { recursive: true });
      writeFileSync(join(dir, "index.html"), '<div class="flex p-4">Home</div>');
      writeFileSync(join(dir, "about.html"), '<div class="grid gap-2">About</div>');
      writeFileSync(join(dir, "sub", "deep.html"), '<div class="hidden">Deep</div>');
      writeFileSync(join(dir, "README.txt"), "not html");

      const result = purgeDirectory({ dir });
      expect(result.files).toBe(3);
      expect(result.classes).toBe(5); // flex p-4 grid gap-2 hidden
      const css = readFileSync(result.file, "utf-8");
      for (const cls of ["flex", "p-4", "grid", "gap-2", "hidden"]) {
        expect(css).toContain(`.${cls}`);
      }
      // No rewrite by default — HTML untouched.
      expect(readFileSync(join(dir, "index.html"), "utf-8")).toContain("class=\"flex p-4\"");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rewrite replaces inline style tags with a <link>", () => {
    const dir = tempDir();
    try {
      writeFileSync(
        join(dir, "index.html"),
        '<html><head><style data-miyocss>.flex{display:flex}</style></head>' +
          '<body class="flex p-4">Hi</body></html>',
      );
      const result = purgeDirectory({ dir, rewrite: true });
      const html = readFileSync(join(dir, "index.html"), "utf-8");
      expect(html).not.toContain("<style data-miyocss>");
      expect(html).toContain(`<link rel="stylesheet" href="${result.href}">`);
      expect(result.files).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("empty dir yields empty CSS and 0 files", () => {
    const dir = tempDir();
    try {
      const result = purgeDirectory({ dir });
      expect(result.files).toBe(0);
      expect(result.classes).toBe(0);
      expect(readFileSync(result.file, "utf-8")).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("findHtmlFiles", () => {
  test("recurses and skips node_modules/.git", () => {
    const dir = tempDir();
    try {
      mkdirSync(join(dir, "node_modules"), { recursive: true });
      mkdirSync(join(dir, ".git"), { recursive: true });
      mkdirSync(join(dir, "pages"), { recursive: true });
      writeFileSync(join(dir, "a.html"), "");
      writeFileSync(join(dir, "pages", "b.html"), "");
      writeFileSync(join(dir, "node_modules", "x.html"), "");
      writeFileSync(join(dir, ".git", "y.html"), "");
      const files = findHtmlFiles(dir).map((f) => f.replaceAll("\\", "/").replace(dir.replaceAll("\\", "/"), ""));
      expect(files).toContain("/a.html");
      expect(files).toContain("/pages/b.html");
      expect(files.some((f) => f.includes("node_modules"))).toBe(false);
      expect(files.some((f) => f.includes(".git"))).toBe(false);
      expect(files.length).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("CLI build command", () => {
  test("miyocss build writes one hashed CSS (via buildStatic)", async () => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, "index.html"), '<div class="flex p-4 hover:bg-red-500">x</div>');
      const stats = await buildStatic({ dir });
      expect(stats.files).toBe(1);
      expect(stats.classes).toBe(3);
      expect(stats.cssHref).toBe(`miyocss.${stats.hash}.css`);
      expect(readdirSync(dir)).toContain(stats.cssHref);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("CLI spawn: build --json returns structured stats", () => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, "index.html"), '<div class="grid gap-4">x</div>');
      const proc = spawnSync(
        "bun",
        ["run", CLI, "build", dir, "--json"],
        { encoding: "utf-8" },
      );
      expect(proc.status).toBe(0);
      const out = JSON.parse(proc.stdout.trim());
      expect(out.files).toBe(1);
      expect(out.classes).toBe(2);
      expect(out.cssHref).toMatch(/^miyocss\.[0-9a-f]{10}\.css$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("CLI spawn: build with --rewrite swaps inline styles", () => {
    const dir = tempDir();
    try {
      writeFileSync(
        join(dir, "index.html"),
        '<style data-miyocss>.flex{display:flex}</style><div class="flex">x</div>',
      );
      const proc = spawnSync(
        "bun",
        ["run", CLI, "build", dir, "--rewrite"],
        { encoding: "utf-8" },
      );
      expect(proc.status).toBe(0);
      const html = readFileSync(join(dir, "index.html"), "utf-8");
      expect(html).toContain('<link rel="stylesheet" href="miyocss.');
      expect(html).not.toContain("<style data-miyocss>");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("CLI spawn: build on missing dir fails with exit 1", () => {
    const proc = spawnSync(
      "bun",
      ["run", CLI, "build", join(tmpdir(), "miyocss-definitely-missing-xyz")],
      { encoding: "utf-8" },
    );
    expect(proc.status).toBe(1);
    expect(proc.stderr).toContain("not found");
  });
});
