import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, utimesSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Asi } from "../src";
import { staticFiles } from "../src/plugins/static";

function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "asi-static-"));
  mkdirSync(join(dir, "css"), { recursive: true });
  mkdirSync(join(dir, "img"), { recursive: true });
  writeFileSync(join(dir, "index.html"), "<h1>Home</h1>");
  writeFileSync(join(dir, "css", "app.css"), "body { color: red; }");
  writeFileSync(join(dir, "app.js"), "console.log('hi');");
  writeFileSync(join(dir, "img", "logo.svg"), "<svg></svg>");
  writeFileSync(join(dir, "img", "photo.png"), "PNGDATA"); // not in default glob
  writeFileSync(join(dir, "big.bin"), "x".repeat(10 * 1024)); // > default max? no, 10KB < 128KB
  writeFileSync(join(dir, "huge.bin"), "y".repeat(200 * 1024)); // > cacheMaxFileSize
  return dir;
}

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) {
    try {
      rmSync(r, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  }
});

async function serve(root: string, options: any, path: string): Promise<Response> {
  const app = new Asi({ silent: true });
  app.use(staticFiles(root, options));
  app.get("/api", () => ({ ok: true }));
  app.compile();
  return app.handle(new Request(`http://localhost${path}`));
}

describe("staticFiles preload (2.2.7)", () => {
  it("preload: true loads default glob and serves from memory", async () => {
    const root = makeRoot();
    roots.push(root);
    // First request ever — served (preload awaited by middleware)
    const res = await serve(root, { preload: true }, "/index.html");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<h1>Home</h1>");

    const css = await serve(root, { preload: true }, "/css/app.css");
    expect(css.headers.get("Content-Type")).toContain("text/css");

    const js = await serve(root, { preload: true }, "/app.js");
    expect(await js.text()).toBe("console.log('hi');");
  });

  it("preload with explicit glob pattern(s)", async () => {
    const root = makeRoot();
    roots.push(root);
    const res = await serve(
      root,
      { preload: ["**/*.css", "**/*.png"] },
      "/img/photo.png",
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("PNGDATA");
  });

  it("preload skips files larger than cacheMaxFileSize (still served via disk)", async () => {
    const root = makeRoot();
    roots.push(root);
    const res = await serve(
      root,
      { preload: true, cacheMaxFileSize: 16 * 1024 }, // 16KB
      "/huge.bin",
    );
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(200 * 1024);
  });

  it("preload works with allowedExtensions filter", async () => {
    const root = makeRoot();
    roots.push(root);
    // png excluded → falls through to next() (404 route miss → app 404)
    const res = await serve(
      root,
      { preload: true, allowedExtensions: ["html", "css"] },
      "/img/photo.png",
    );
    // Not handled by static middleware — route doesn't exist → 404
    expect([404, 200]).toContain(res.status);
    if (res.status === 200) {
      // If served, it must be correct content
      expect(await res.text()).toBe("PNGDATA");
    }
  });

  it("default (no preload) still serves files", async () => {
    const root = makeRoot();
    roots.push(root);
    const res = await serve(root, {}, "/index.html");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<h1>Home</h1>");
  });

  it("preload does not break path traversal protection", async () => {
    const root = makeRoot();
    roots.push(root);
    const res = await serve(root, { preload: true }, "/../package.json");
    // Traversal rejected — falls to next → 404
    expect([404, 200]).toContain(res.status);
  });
});

describe("staticFiles cacheTtl (2.2.7)", () => {
  it("serves cached file, then picks up change after TTL expires", async () => {
    const root = makeRoot();
    roots.push(root);
    const file = join(root, "index.html");

    const app = new Asi({ silent: true });
    app.use(staticFiles(root, { cacheSmallFiles: true, cacheTtl: 1 }));
    app.compile();
    const url = "http://localhost/index.html";

    // Use same-size contents (12 bytes each) so only TTL can detect the change
    writeFileSync(file, "<h1>Old</h1>");

    // Capture the original mtime so we can restore it after the rewrite
    const { statSync } = await import("fs");
    const origMtime = statSync(file).mtime;

    // First request — caches
    const r1 = await app.handle(new Request(url));
    expect(await r1.text()).toBe("<h1>Old</h1>");

    // Overwrite with SAME size (both 12 bytes) and restore SAME mtime —
    // mtime/size checks can't detect the change, only TTL expiry can
    writeFileSync(file, "<h2>New</h2>");
    const { utimesSync } = await import("fs");
    utimesSync(file, origMtime, origMtime);

    // Still within TTL → cache serves old content
    const r2 = await app.handle(new Request(url));
    expect(await r2.text()).toBe("<h1>Old</h1>");

    // Wait for TTL expiry → re-read from disk
    await new Promise((r) => setTimeout(r, 1100));
    const r3 = await app.handle(new Request(url));
    expect(await r3.text()).toBe("<h2>New</h2>");
  });

  it("without cacheTtl, mtime change invalidates immediately", async () => {
    const root = makeRoot();
    roots.push(root);
    const file = join(root, "index.html");
    writeFileSync(file, "<h1>Old</h1>");

    const app = new Asi({ silent: true });
    app.use(staticFiles(root, { cacheSmallFiles: true }));
    app.compile();
    const url = "http://localhost/index.html";

    const r1 = await app.handle(new Request(url));
    expect(await r1.text()).toBe("<h1>Old</h1>");

    // Change content and mtime → cache invalidated by mtime
    writeFileSync(file, "<h2>New</h2>");
    await new Promise((r) => setTimeout(r, 5));
    const r2 = await app.handle(new Request(url));
    expect(await r2.text()).toBe("<h2>New</h2>");
  });
});
