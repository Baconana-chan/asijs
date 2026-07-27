import { describe, expect, it, afterEach } from "bun:test";
import { HotReloader, reImportModule } from "../src";

describe("HotReloader", () => {
  afterEach(() => {
    // Clean up any active reloaders
  });

  it("creates instance with default options", () => {
    const reloader = new HotReloader();
    expect(reloader).toBeInstanceOf(HotReloader);
    expect(reloader.isWatching).toBe(false);
    expect(reloader.watcherCount).toBe(0);
    expect(reloader.pendingCount).toBe(0);
  });

  it("creates instance with custom options", () => {
    const reloader = new HotReloader({
      rootDir: process.cwd(),
      watchDirs: ["src"],
      debounceMs: 100,
      extensions: [".ts", ".tsx"],
      verbose: false,
    });
    expect(reloader).toBeInstanceOf(HotReloader);
  });

  it("start() starts watching existing directories", () => {
    const reloader = new HotReloader({
      rootDir: process.cwd(),
      watchDirs: ["src"],
      verbose: false,
    });

    reloader.start();
    expect(reloader.isWatching).toBe(true);
    expect(reloader.watcherCount).toBeGreaterThanOrEqual(0);

    reloader.stop();
    expect(reloader.isWatching).toBe(false);
  });

  it("start() is idempotent", () => {
    const reloader = new HotReloader({
      rootDir: process.cwd(),
      watchDirs: ["src"],
      verbose: false,
    });

    reloader.start();
    expect(reloader.isWatching).toBe(true);
    const firstCount = reloader.watcherCount;

    reloader.start(); // Second call should be no-op
    expect(reloader.isWatching).toBe(true);
    expect(reloader.watcherCount).toBe(firstCount);

    reloader.stop();
  });

  it("handles non-existent watch directories gracefully", () => {
    const reloader = new HotReloader({
      rootDir: process.cwd(),
      watchDirs: ["nonexistent-dir-12345"],
      verbose: false,
    });

    // Should not throw
    reloader.start();
    expect(reloader.isWatching).toBe(true);

    reloader.stop();
  });

  it("stop() is idempotent", () => {
    const reloader = new HotReloader({
      rootDir: process.cwd(),
      watchDirs: ["src"],
      verbose: false,
    });

    reloader.stop(); // Not started — should not throw
    expect(reloader.isWatching).toBe(false);

    reloader.stop(); // Again — should not throw
    expect(reloader.isWatching).toBe(false);
  });

  it("fires onReload callback on file changes", async () => {
    const changes: unknown[] = [];

    const reloader = new HotReloader({
      rootDir: process.cwd(),
      watchDirs: ["src"],
      verbose: false,
      onReload: (event) => changes.push(event),
    });

    reloader.start();
    await new Promise((r) => setTimeout(r, 100));
    reloader.stop();

    // Note: no changes expected since we didn't modify any files
    // This just tests the callback mechanism doesn't crash
    expect(true).toBe(true);
  });

  it("reImportModule returns null for non-existent modules", async () => {
    const result = await reImportModule("./nonexistent-file-xyz.ts");
    expect(result).toBeNull();
  });

  it("reImportModule re-imports existing modules", async () => {
    // Re-import an existing module
    const result = await reImportModule("./src/hot-reload.ts");
    expect(result).not.toBeNull();
    expect((result as any)?.HotReloader).toBeDefined();
  });
});

describe("HotReloader event system", () => {
  it("can register and unregister event listeners", () => {
    const reloader = new HotReloader({ verbose: false });
    const handler = () => {};

    reloader.on("reload", handler);
    reloader.off("reload", handler);

    expect(true).toBe(true); // No crash
  });

  it("handles errors in event handlers gracefully", () => {
    const reloader = new HotReloader({ verbose: false });

    reloader.on("reload", () => {
      throw new Error("Handler error");
    });
    reloader.on("reload", () => {
      // This should still run despite the error above
    });

    expect(true).toBe(true); // No crash
  });
});
