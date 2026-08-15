import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { Asi } from "../src";
import { buildSSG, staticPath } from "../src/ssg";
import { existsSync, mkdirSync, rmSync, readFileSync } from "fs";
import { join } from "path";

const TEST_OUT_DIR = "dist-test-ssg";

describe("buildSSG", () => {
  beforeEach(() => {
    // Clean up before each test
    try {
      rmSync(TEST_OUT_DIR, { recursive: true });
    } catch {}
  });

  afterEach(() => {
    // Clean up after each test
    try {
      rmSync(TEST_OUT_DIR, { recursive: true });
    } catch {}
  });

  it("should render static GET routes as HTML files", async () => {
    const app = new Asi();
    app.get("/", () => new Response("<h1>Home</h1>", {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }));
    app.get("/about", () => new Response("<h1>About</h1>", {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }));

    const result = await buildSSG(app, {
      outDir: TEST_OUT_DIR,
      verbose: false,
    });

    expect(result.totalPages).toBe(2);
    expect(result.successPages).toBe(2);
    expect(result.failedPages).toBe(0);

    // Check files exist
    expect(existsSync(join(TEST_OUT_DIR, "index.html"))).toBe(true);
    expect(existsSync(join(TEST_OUT_DIR, "about", "index.html"))).toBe(true);

    // Check content
    const homeContent = readFileSync(join(TEST_OUT_DIR, "index.html"), "utf-8");
    expect(homeContent).toContain("<h1>Home</h1>");

    const aboutContent = readFileSync(join(TEST_OUT_DIR, "about", "index.html"), "utf-8");
    expect(aboutContent).toContain("<h1>About</h1>");
  });

  it("should use flat format when specified", async () => {
    const app = new Asi();
    app.get("/", () => new Response("<h1>Home</h1>", {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }));
    app.get("/about", () => new Response("<h1>About</h1>", {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }));

    const result = await buildSSG(app, {
      outDir: TEST_OUT_DIR,
      format: "flat",
      verbose: false,
    });

    expect(existsSync(join(TEST_OUT_DIR, "index.html"))).toBe(true);
    expect(existsSync(join(TEST_OUT_DIR, "about.html"))).toBe(true);
  });

  it("should skip POST routes", async () => {
    const app = new Asi();
    app.get("/", () => new Response("Home", {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }));
    app.post("/data", () => ({ ok: true }));

    const result = await buildSSG(app, {
      outDir: TEST_OUT_DIR,
      verbose: false,
    });

    expect(result.totalPages).toBe(1);
  });

  it("should render additionalPaths (dynamic routes)", async () => {
    const app = new Asi();
    app.get("/blog/:slug", (ctx: any) => new Response(`<h1>${ctx.params.slug}</h1>`, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }));

    const result = await buildSSG(app, {
      outDir: TEST_OUT_DIR,
      verbose: false,
      additionalPaths: [
        { path: "/blog/hello-world", params: { slug: "hello-world" } },
        { path: "/blog/asi-js-guide", params: { slug: "asi-js-guide" } },
      ],
    });

    expect(result.totalPages).toBe(2);
    expect(result.successPages).toBe(2);

    expect(existsSync(join(TEST_OUT_DIR, "blog", "hello-world", "index.html"))).toBe(true);
    expect(existsSync(join(TEST_OUT_DIR, "blog", "asi-js-guide", "index.html"))).toBe(true);

    const content = readFileSync(
      join(TEST_OUT_DIR, "blog", "hello-world", "index.html"),
      "utf-8",
    );
    expect(content).toContain("hello-world");
  });

  it("should render JSON responses with exportApi", async () => {
    const app = new Asi();
    app.get("/", () => ({ message: "Home" }));
    app.get("/api/data", () => ({ items: [1, 2, 3] }));

    const result = await buildSSG(app, {
      outDir: TEST_OUT_DIR,
      verbose: false,
      exportApi: true,
    });

    // Both are JSON routes — should still be exported with exportApi
    expect(result.totalPages).toBeGreaterThanOrEqual(2);
    expect(existsSync(join(TEST_OUT_DIR, "index.html"))).toBe(true);
  });    it("should handle errors gracefully", async () => {
      const app = new Asi({ silent: true });
      app.get("/ok", () => new Response("OK", {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }));
      app.get("/error", () => {
        throw new Error("Test error");
      });

      const result = await buildSSG(app, {
        outDir: TEST_OUT_DIR,
        verbose: false,
      });

      // /error should fail but /ok should succeed
      expect(result.successPages).toBe(1);
      expect(result.failedPages).toBe(1);
      // /ok maps to ok/index.html (not index.html since there's no / route)
      expect(existsSync(join(TEST_OUT_DIR, "ok", "index.html"))).toBe(true);
      // /error should NOT produce a file
      expect(existsSync(join(TEST_OUT_DIR, "error", "index.html"))).toBe(false);
    });

  it("should use custom fetch function when provided", async () => {
    const calls: string[] = [];

    const result = await buildSSG(new Asi(), {
      outDir: TEST_OUT_DIR,
      verbose: false,
      additionalPaths: [
        { path: "/test" },
      ],
      fetch: async (request) => {
        calls.push(request.url);
        return new Response("<h1>Custom</h1>", {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      },
    });

    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("/test");
    expect(result.totalPages).toBe(1);
    expect(result.successPages).toBe(1);
  });

  it("should deduplicate additionalPaths", async () => {
    const app = new Asi();
    app.get("/home", () => new Response("<h1>Home</h1>", {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }));

    const result = await buildSSG(app, {
      outDir: TEST_OUT_DIR,
      verbose: false,
      additionalPaths: [
        { path: "/home" },
        { path: "/home" },  // duplicate
      ],
    });

    // /home appears only once (from route) + no duplicates
    const homePaths = result.pages.filter((p) => p.path === "/home");
    expect(homePaths.length).toBe(1);
  });

  it("should return build result with correct stats", async () => {
    const app = new Asi();
    app.get("/a", () => new Response("A", {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }));
    app.get("/b", () => new Response("B", {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }));

    const result = await buildSSG(app, {
      outDir: TEST_OUT_DIR,
      verbose: false,
    });

    expect(result.outDir).toBe(TEST_OUT_DIR);
    expect(result.totalPages).toBe(2);
    expect(result.successPages).toBe(2);
    expect(result.failedPages).toBe(0);
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.pages.length).toBe(2);
    expect(result.pages[0].success).toBe(true);
    expect(result.pages[0].status).toBe(200);
    expect(result.pages[0].size).toBeGreaterThan(0);
  });

  it("should return empty result when no routes", async () => {
    const app = new Asi();

    const result = await buildSSG(app, {
      outDir: TEST_OUT_DIR,
      verbose: false,
    });

    expect(result.totalPages).toBe(0);
    expect(result.successPages).toBe(0);
    expect(result.failedPages).toBe(0);
  });

  it("staticPath helper creates correct SSGPath", () => {
    const p1 = staticPath("/blog/test", { slug: "test" });
    expect(p1.path).toBe("/blog/test");
    expect(p1.params).toEqual({ slug: "test" });

    const p2 = staticPath("/");
    expect(p2.path).toBe("/");
    expect(p2.params).toEqual({});

    const p3 = staticPath("/about");
    expect(p3.path).toBe("/about");
    expect(p3.params).toEqual({});
  });
});
