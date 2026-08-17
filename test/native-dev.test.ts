import { describe, test, expect } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";

import { Asi } from "../src/asi";
import { parseManifest, type NativeManifest } from "../src/native/manifest";
import { generatePythonServer } from "../src/native/generate-sidecar";
import { native, loadNativeModule, readCString } from "../src/native/runtime";
import { watchNativeModule } from "../src/native/watch";
import { runNativeTest } from "../src/native/cli";

// ============================================================================
// Helpers
// ============================================================================

const PY = process.platform === "win32" ? "python" : "python3";

function toolchainAvailable(cmd: string, args: string[]): boolean {
  const r = spawnSync(cmd, args, { encoding: "utf-8" });
  return r.status === 0;
}

const hasPython = toolchainAvailable(PY, ["--version"]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface TempProject {
  dir: string;
  nativeRoot: string;
  cleanup: () => void;
}

/** Create a temp project with a python sidecar module (implemented add). */
function makePythonProject(): TempProject {
  const dir = mkdtempSync(join(tmpdir(), "asi-native-dev-"));
  const nativeRoot = join(dir, "native");
  mkdirSync(join(nativeRoot, "src"), { recursive: true });

  const manifest = parseManifest({
    name: "calc",
    lang: "python",
    functions: [
      { name: "add", params: { a: "number", b: "number" }, returns: "number" },
      { name: "reverse", params: { input: "string" }, returns: "string" },
      { name: "sha256", params: { input: "string" }, returns: "string" },
    ],
  });
  writeFileSync(
    join(nativeRoot, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8",
  );
  const src = generatePythonServer(manifest).replace(
    'raise NotImplementedError("implement add")',
    "return a + b",
  );
  writeFileSync(join(nativeRoot, "server.py"), src, "utf-8");

  return {
    dir,
    nativeRoot,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        setTimeout(() => {
          try {
            rmSync(dir, { recursive: true, force: true });
          } catch {
            // ignore
          }
        }, 200);
      }
    },
  };
}

/** Mock dlopen library: dispatches JSON payloads to a function. */
function makeMockDlopen(dispatch: (payload: { fn: string; args: Record<string, unknown> }) => unknown) {
  return (
    _path: string,
    symbols: Record<string, unknown>,
  ): { symbols: Record<string, (...a: unknown[]) => unknown> } => ({
    symbols: {
      asijs_call: (bytes: unknown) => {
        const payload = JSON.parse(readCString(bytes)) as {
          fn: string;
          args: Record<string, unknown>;
        };
        const result = dispatch(payload);
        return new TextEncoder().encode(JSON.stringify({ ok: true, result }) + "\0");
      },
      asijs_free: () => {},
    },
  });
}

// ============================================================================
// Hot reload watcher (2.3)
// ============================================================================

describe("native hot reload watcher (2.3)", () => {
  test("sidecar change triggers a reload event (no build needed)", async () => {
    const { dir, nativeRoot, cleanup } = makePythonProject();
    const events: string[] = [];
    const stop = watchNativeModule({
      cwd: dir,
      debounceMs: 50,
      verbose: false,
      onEvent: (e) => events.push(e.type),
    });

    await sleep(200); // let the watcher settle
    const src = readFileSync(join(nativeRoot, "server.py"), "utf-8");
    writeFileSync(join(nativeRoot, "server.py"), src + "\n# change", "utf-8");

    await sleep(700); // debounce + fs.watch delivery
    expect(events).toContain("reload");

    stop();
    cleanup();
  });

  test("ignored paths (target/, generated.ts) do not trigger reload", async () => {
    const { dir, nativeRoot, cleanup } = makePythonProject();
    const events: string[] = [];
    const stop = watchNativeModule({
      cwd: dir,
      debounceMs: 50,
      verbose: false,
      onEvent: (e) => events.push(e.type),
    });

    await sleep(200);
    // writing into target/ or generated.ts must be ignored
    mkdirSync(join(nativeRoot, "target", "release"), { recursive: true });
    writeFileSync(join(nativeRoot, "target", "release", "libcalc.so"), "x", "utf-8");
    writeFileSync(join(nativeRoot, "src", "generated.ts"), "// generated", "utf-8");
    writeFileSync(join(nativeRoot, ".asi-native-cache"), "marker", "utf-8");

    await sleep(700);
    expect(events.filter((e) => e === "reload")).toHaveLength(0);

    stop();
    cleanup();
  });

  test("stop() closes the watcher (no further events)", async () => {
    const { dir, nativeRoot, cleanup } = makePythonProject();
    const events: string[] = [];
    const stop = watchNativeModule({
      cwd: dir,
      debounceMs: 50,
      verbose: false,
      onEvent: (e) => events.push(e.type),
    });
    await sleep(200);
    stop();

    writeFileSync(join(nativeRoot, "server.py"), "# after stop", "utf-8");
    await sleep(500);
    expect(events.filter((e) => e === "reload")).toHaveLength(0);

    cleanup();
  });
});

// ============================================================================
// Middleware hot reload (2.3)
// ============================================================================

describe("native middleware hot reload (2.3)", () => {
  test.skipIf(!hasPython)(
    "picks up sidecar changes without restarting the server",
    async () => {
      const { dir, nativeRoot, cleanup } = makePythonProject();
      const app = new Asi({ silent: true } as any);
      const mw = native({
        cwd: dir,
        hotReload: true,
        debounceMs: 50,
        verbose: false,
      }) as any;
      app.use(mw);
      app.get("/add", async (ctx: any) => ({ r: await ctx.native.add(2, 3) }));

      const r1 = await app.handle(new Request("http://x/add"));
      expect(await r1.json()).toEqual({ r: 5 });

      // change the implementation: a + b + 100
      const src = readFileSync(join(nativeRoot, "server.py"), "utf-8").replace(
        "return a + b",
        "return a + b + 100",
      );
      writeFileSync(join(nativeRoot, "server.py"), src, "utf-8");

      await sleep(900); // debounce + reload + respawn

      const r2 = await app.handle(new Request("http://x/add"));
      expect(await r2.json()).toEqual({ r: 105 });

      mw.stop();
      cleanup();
    },
    30_000,
  );

  test("invalid manifest surfaces the native root path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "asi-native-bad-"));
    const nativeRoot = join(dir, "native");
    mkdirSync(nativeRoot, { recursive: true });
    writeFileSync(join(nativeRoot, "manifest.json"), "{ not json", "utf-8");

    const app = new Asi({ silent: true } as any);
    const mw = native({ cwd: dir });
    app.use(mw);
    app.get("/x", async (ctx: any) => ({ r: await ctx.native.add(1, 1) }));

    const res = await app.handle(new Request("http://x/x"));
    // error path — the promise rejects, so this should be a 500 with our message
    const body = await res.text();
    expect(res.status).toBe(500);
    expect(body).toContain("invalid manifest at");
    // path appears in the JSON-escaped error body (backslashes doubled)
    expect(body.replace(/\\\\/g, "\\")).toContain(nativeRoot);

    mw.stop();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test("stale/missing library error mentions asi native build", () => {
    const manifest = parseManifest({
      name: "m",
      lang: "rust",
      functions: [{ name: "add", params: {}, returns: "number" }],
    });
    const badDlopen = (): never => {
      throw new Error("symbol asijs_call not found");
    };
    expect(() => loadNativeModule(manifest, {}, badDlopen as any).add()).toThrow(
      /run \"asi native build\"/,
    );
  });
});

// ============================================================================
// asi native test — smoke runner (2.3)
// ============================================================================

describe("native smoke test (2.3)", () => {
  test("runNativeTest classifies pass / stub / fail", async () => {
    const manifest = parseManifest({
      name: "m",
      lang: "rust",
      functions: [
        { name: "add", params: { a: "number", b: "number" }, returns: "number" },
        { name: "boom", params: {}, returns: "string" },
        { name: "err", params: {}, returns: "string" },
      ],
    });
    const dlopen = makeMockDlopen((payload) => {
      if (payload.fn === "boom") throw new Error("implement boom");
      if (payload.fn === "err") throw new Error("segfault");
      return 2;
    });
    const results = await runNativeTest(manifest, { dlopen: dlopen as any });

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ name: "add", status: "pass", result: 2 });
    expect(results[1].status).toBe("stub");
    expect(results[1].error).toContain("implement boom");
    expect(results[2]).toEqual({
      name: "err",
      status: "fail",
      error: "segfault",
    });
  });

  test.skipIf(!hasPython)(
    "runNativeTest runs a real python module and marks stubs",
    async () => {
      const { dir, cleanup } = makePythonProject();
      const manifest = parseManifest({
        name: "calc",
        lang: "python",
        sourceDir: "native",
        functions: [
          { name: "add", params: { a: "number", b: "number" }, returns: "number" },
          { name: "sha256", params: { input: "string" }, returns: "string" },
        ],
      });
      const results = await runNativeTest(manifest, { cwd: dir });

      const add = results.find((r) => r.name === "add");
      const sha = results.find((r) => r.name === "sha256");
      expect(add?.status).toBe("pass");
      expect(add?.result).toBe(2);
      expect(sha?.status).toBe("stub");
      expect(sha?.error).toContain("implement sha256");

      cleanup();
    },
    30_000,
  );
});
