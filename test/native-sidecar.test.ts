import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";

import {
  parseManifest,
  type NativeManifest,
} from "../src/native/manifest";
import {
  generatePythonServer,
  generateRubyServer,
  generatePhpServer,
  generateSidecarTsClient,
} from "../src/native/generate-sidecar";
import {
  createSidecarClient,
  type SidecarChild,
  type SidecarSpawn,
} from "../src/native/sidecar";
import { loadNativeModule } from "../src/native/runtime";

// ============================================================================
// Helpers
// ============================================================================

const PY = process.platform === "win32" ? "python" : "python3";

function toolchainAvailable(cmd: string, args: string[]): boolean {
  const r = spawnSync(cmd, args, { encoding: "utf-8" });
  return r.status === 0;
}

function makeManifest(): NativeManifest {
  return parseManifest({
    name: "calc",
    lang: "python",
    sourceDir: ".",
    functions: [
      { name: "add", params: { a: "number", b: "number" }, returns: "number" },
      { name: "reverse", params: { input: "string" }, returns: "string" },
      { name: "echoBytes", params: { b: "bytes" }, returns: "bytes" },
      { name: "sha256", params: { input: "string" }, returns: "string" },
    ],
  });
}

function makeTempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "asi-sidecar-"));
  return {
    dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // windows: retry once after the process handle is released
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- controllable stdout stream for the mock process ---
class StreamQueue implements AsyncIterable<Uint8Array> {
  private chunks: Uint8Array[] = [];
  private waiters: Array<(r: IteratorResult<Uint8Array>) => void> = [];
  private done = false;

  push(chunk: Uint8Array): void {
    if (this.done) return;
    this.chunks.push(chunk);
    this.flush();
  }

  end(): void {
    if (this.done) return;
    this.done = true;
    this.flush();
  }

  private flush(): void {
    while (this.chunks.length > 0 && this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      waiter({ value: this.chunks.shift()!, done: false });
    }
    if (this.done && this.waiters.length > 0) {
      while (this.waiters.length > 0) {
        this.waiters.shift()!({ value: undefined as unknown as Uint8Array, done: true });
      }
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    return {
      next: (): Promise<IteratorResult<Uint8Array>> =>
        new Promise((resolve) => {
          if (this.chunks.length > 0) {
            resolve({ value: this.chunks.shift()!, done: false });
          } else if (this.done) {
            resolve({ value: undefined as unknown as Uint8Array, done: true });
          } else {
            this.waiters.push(resolve);
          }
        }),
    };
  }
}

class MockProc implements SidecarChild {
  stdin = {
    write: (d: string) => {
      this.requests.push(d);
    },
  };
  stdout: StreamQueue = new StreamQueue();
  stderr: StreamQueue = new StreamQueue();
  exited: Promise<number | null>;
  kill = (): void => {
    this.crashed = true;
  };
  pid: number;
  cmd: string;
  args: string[];
  requests: string[] = [];
  crashed = false;
  private exitResolve!: (code: number | null) => void;

  constructor(cmd: string, args: string[], pid: number) {
    this.cmd = cmd;
    this.args = args;
    this.pid = pid;
    this.exited = new Promise((r) => {
      this.exitResolve = r;
    });
  }

  /** Simulate the interpreter writing a JSON-RPC response line. */
  emitLine(line: string): void {
    this.stdout.push(new TextEncoder().encode(line + "\n"));
  }

  /** Simulate the interpreter crashing. */
  crash(code = 1): void {
    this.stdout.end();
    this.exitResolve(code);
  }
}

function makeMockSpawn(): {
  spawn: SidecarSpawn;
  procs: MockProc[];
} {
  const procs: MockProc[] = [];
  let pidCounter = 1000;
  return {
    spawn: (cmd, args, _opts): SidecarChild => {
      const proc = new MockProc(cmd, args, ++pidCounter);
      procs.push(proc);
      return proc;
    },
    procs,
  };
}

const quickOptions = { backoffMs: 10, maxBackoffMs: 100, forwardStderr: false };

// ============================================================================
// Script generation
// ============================================================================

describe("sidecar server generation (2.2)", () => {
  const manifest = makeManifest();

  test("python server has stubs, dispatcher and type tables", () => {
    const src = generatePythonServer(manifest);
    expect(src).toContain("def add(a, b):");
    expect(src).toContain("def sha256(input):");
    expect(src).toContain("raise NotImplementedError(\"implement add\")");
    expect(src).toContain('"add": { "a": "number", "b": "number" }');
    expect(src).toContain('"echoBytes": "bytes"');
    expect(src).toContain("_HANDLERS = {");
    expect(src).toContain("unknown function");
    expect(src).toContain("base64.b64decode");
  });

  test("python server escapes reserved words", () => {
    const m = parseManifest({
      name: "kw",
      lang: "python",
      functions: [
        { name: "class", params: { from: "string" }, returns: "string" },
      ],
    });
    const src = generatePythonServer(m);
    expect(src).toContain("def class_(from_):");
    expect(src).toContain('"class": class_');
    // parameter table keeps original names (wire contract)
    expect(src).toContain('"from": "string"');
  });

  test("ruby server has stubs and dispatcher", () => {
    const src = generateRubyServer(manifest);
    // Ruby 3 kwargs: dispatcher calls handler.call(**args), so stubs use `a:`
    expect(src).toContain("def add(a:, b:)");
    expect(src).toContain("def reverse(input:)");
    expect(src).toContain('raise "implement add"');
    expect(src).toContain('"add" => method(:add)');
    expect(src).toContain("unknown function");
    expect(src).toContain("Base64.decode64");
    expect(src).toContain('"add" => { "a" => "number", "b" => "number" }');
  });

  test("php server has stubs and dispatcher", () => {
    const src = generatePhpServer(manifest);
    expect(src).toContain("function add($a, $b) {");
    expect(src).toContain('"add" => "add"');
    expect(src).toContain("unknown function");
    expect(src).toContain("base64_decode");
    expect(src).toContain("call_user_func_array");
    // PHP array syntax: "fn" => [ ... ] (a `"fn":` prefix is invalid PHP)
    expect(src).toContain('"add" => [ "a" => "number", "b" => "number" ]');
  });

  test("ts client generator produces typed interface over createSidecarClient", () => {
    const src = generateSidecarTsClient(manifest);
    expect(src).toContain('import { createSidecarClient, type NativeModule } from "asijs/native";');
    expect(src).toContain("add(a: number, b: number): Promise<number>;");
    expect(src).toContain("echoBytes(b: Uint8Array): Promise<Uint8Array>;");
    expect(src).toContain('"lang": "python"');
  });
});

// ============================================================================
// Mock-spawn roundtrip
// ============================================================================

describe("sidecar client — JSON-RPC over stdio (2.2)", () => {
  test("spawns interpreter with the server script and round-trips a call", async () => {
    const { dir, cleanup } = makeTempDir();
    const { spawn, procs } = makeMockSpawn();
    const client = createSidecarClient(makeManifest(), {
      cwd: dir,
      spawn,
      interpreter: { cmd: "python3", args: ["-u"] },
      ...quickOptions,
    });

    const p = client.add(2, 3);
    await sleep(10);

    expect(procs.length).toBe(1);
    expect(procs[0].cmd).toBe("python3");
    expect(procs[0].args).toEqual(["-u", join(dir, "server.py")]);

    const req = JSON.parse(procs[0].requests[0]) as { id: number; fn: string; args: Record<string, unknown> };
    expect(req.fn).toBe("add");
    expect(req.args).toEqual({ a: 2, b: 3 });

    procs[0].emitLine(JSON.stringify({ id: req.id, ok: true, result: 5 }));
    expect(await p).toBe(5);

    client.close();
    cleanup();
  });

  test("bytes args are base64-encoded on the wire and results decoded", async () => {
    const { dir, cleanup } = makeTempDir();
    const { spawn, procs } = makeMockSpawn();
    const client = createSidecarClient(makeManifest(), {
      cwd: dir,
      spawn,
      interpreter: { cmd: "python3" },
      ...quickOptions,
    });

    const p = client.echoBytes(new Uint8Array([1, 2, 255]));
    await sleep(10);
    const req = JSON.parse(procs[0].requests[0]) as { id: number; fn: string; args: Record<string, unknown> };
    expect(req.args.b).toBe("AQL/"); // base64 of [1, 2, 255]

    procs[0].emitLine(JSON.stringify({ id: req.id, ok: true, result: "AwQ=" }));
    expect(await p).toEqual(new Uint8Array([3, 4]));

    client.close();
    cleanup();
  });

  test("ok:false responses reject with the interpreter error message", async () => {
    const { dir, cleanup } = makeTempDir();
    const { spawn, procs } = makeMockSpawn();
    const client = createSidecarClient(makeManifest(), {
      cwd: dir,
      spawn,
      interpreter: { cmd: "python3" },
      ...quickOptions,
    });

    const p = client.reverse("abc");
    await sleep(10);
    const req = JSON.parse(procs[0].requests[0]) as { id: number };
    procs[0].emitLine(JSON.stringify({ id: req.id, ok: false, error: "boom" }));
    await expect(p).rejects.toThrow(/\[native:reverse\] boom/);

    client.close();
    cleanup();
  });

  test("unknown function and wrong arg count give clear client-side errors", async () => {
    const { dir, cleanup } = makeTempDir();
    const { spawn } = makeMockSpawn();
    const client = createSidecarClient(makeManifest(), {
      cwd: dir,
      spawn,
      interpreter: { cmd: "python3" },
      ...quickOptions,
    });

    // unknown functions are undefined on the direct client (the ctx.native
    // proxy gives a clear error instead)
    expect((client as unknown as Record<string, unknown>).nope).toBeUndefined();
    await expect(client.add(1)).rejects.toThrow(/expected 2 argument/);

    client.close();
    cleanup();
  });

  test("non-JSON output lines are ignored", async () => {
    const { dir, cleanup } = makeTempDir();
    const { spawn, procs } = makeMockSpawn();
    const client = createSidecarClient(makeManifest(), {
      cwd: dir,
      spawn,
      interpreter: { cmd: "python3" },
      ...quickOptions,
    });

    const p = client.add(1, 1);
    await sleep(10);
    const req = JSON.parse(procs[0].requests[0]) as { id: number };
    procs[0].emitLine("some stray print");
    procs[0].emitLine(JSON.stringify({ id: req.id, ok: true, result: 2 }));
    expect(await p).toBe(2);

    client.close();
    cleanup();
  });

  test("concurrent calls are correlated by id", async () => {
    const { dir, cleanup } = makeTempDir();
    const { spawn, procs } = makeMockSpawn();
    const client = createSidecarClient(makeManifest(), {
      cwd: dir,
      spawn,
      interpreter: { cmd: "python3" },
      ...quickOptions,
    });

    const p1 = client.add(1, 2);
    const p2 = client.add(10, 20);
    await sleep(10);

    expect(procs.length).toBe(1);
    expect(procs[0].requests.length).toBe(2);
    const req1 = JSON.parse(procs[0].requests[0]) as { id: number; args: Record<string, unknown> };
    const req2 = JSON.parse(procs[0].requests[1]) as { id: number; args: Record<string, unknown> };
    expect(req1.id).not.toBe(req2.id);

    // respond out of order
    procs[0].emitLine(JSON.stringify({ id: req2.id, ok: true, result: 30 }));
    procs[0].emitLine(JSON.stringify({ id: req1.id, ok: true, result: 3 }));
    expect(await p1).toBe(3);
    expect(await p2).toBe(30);

    client.close();
    cleanup();
  });

  test("close kills the process and rejects pending requests", async () => {
    const { dir, cleanup } = makeTempDir();
    const { spawn, procs } = makeMockSpawn();
    const client = createSidecarClient(makeManifest(), {
      cwd: dir,
      spawn,
      interpreter: { cmd: "python3" },
      ...quickOptions,
    });

    const p = client.add(1, 1);
    await sleep(10);
    expect(procs[0].crashed).toBe(false);
    client.close();
    expect(procs[0].crashed).toBe(true);
    await expect(p).rejects.toThrow(/closed/);
    await expect(client.add(2, 2)).rejects.toThrow(/closed/);

    cleanup();
  });
});

// ============================================================================
// Restart on crash
// ============================================================================

describe("sidecar client — lifecycle & restart (2.2)", () => {
  test("crash rejects pending calls, next call respawns with backoff", async () => {
    const { dir, cleanup } = makeTempDir();
    const { spawn, procs } = makeMockSpawn();
    const client = createSidecarClient(makeManifest(), {
      cwd: dir,
      spawn,
      interpreter: { cmd: "python3" },
      ...quickOptions,
    });

    // first call succeeds
    const p1 = client.add(2, 3);
    await sleep(10);
    const req1 = JSON.parse(procs[0].requests[0]) as { id: number };
    procs[0].emitLine(JSON.stringify({ id: req1.id, ok: true, result: 5 }));
    expect(await p1).toBe(5);

    // second call is in flight when the process dies
    const p2 = client.add(7, 1);
    await sleep(10);
    const req2 = JSON.parse(procs[0].requests[1]) as { id: number };
    procs[0].crash(1);
    await expect(p2).rejects.toThrow(/exited/);

    // next call spawns a fresh process (backoff only delays a few ms)
    const p3 = client.add(4, 4);
    await sleep(50);
    expect(procs.length).toBe(2);
    expect(procs[1].requests.length).toBe(1);
    const req3 = JSON.parse(procs[1].requests[0]) as { id: number };
    procs[1].emitLine(JSON.stringify({ id: req3.id, ok: true, result: 8 }));
    expect(await p3).toBe(8);

    client.close();
    cleanup();
  });

  test("spawn failure surfaces a clear error", async () => {
    const { dir, cleanup } = makeTempDir();
    const client = createSidecarClient(makeManifest(), {
      cwd: dir,
      spawn: (() => {
        throw new Error("ENOENT");
      }) as SidecarSpawn,
      interpreter: { cmd: "definitely-missing-interp" },
      ...quickOptions,
    });

    await expect(client.add(1, 1)).rejects.toThrow(
      /failed to start "definitely-missing-interp/,
    );
    client.close();
    cleanup();
  });
});

// ============================================================================
// Real Python e2e (skipped when python3 is unavailable)
// ============================================================================

describe("sidecar — real Python e2e (2.2)", () => {
  const skip = !toolchainAvailable(PY, ["--version"]);

  test.skipIf(skip)(
    "loadNativeModule runs a python module end-to-end through ctx.native",
    async () => {
      const { dir, cleanup } = makeTempDir();
      const manifest = makeManifest();
      // implement some bodies in the generated script
      let src = generatePythonServer(manifest);
      src = src.replace(
        'raise NotImplementedError("implement add")',
        "return a + b",
      );
      src = src.replace(
        'raise NotImplementedError("implement reverse")',
        "return input[::-1]",
      );
      src = src.replace(
        'raise NotImplementedError("implement echoBytes")',
        "return b",
      );
      writeFileSync(join(dir, "server.py"), src, "utf-8");
      writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

      const module = loadNativeModule(manifest, { cwd: dir });

      expect(await (module.add as (...a: unknown[]) => Promise<unknown>)(2, 3)).toBe(5);
      expect(await (module.reverse as (...a: unknown[]) => Promise<unknown>)("abc")).toBe("cba");
      expect(
        await (module.echoBytes as (...a: unknown[]) => Promise<unknown>)(new Uint8Array([1, 2, 255])),
      ).toEqual(new Uint8Array([1, 2, 255]));

      // unimplemented function → the interpreter error comes back as a JS error.
      // NOTE: use a manual try/catch here — `expect(p).rejects` hangs with a
      // real Bun.spawn pipe on Windows (bun:test quirk), the mock path is fine.
      let errMsg = "";
      try {
        await (module.sha256 as (...a: unknown[]) => Promise<unknown>)("x");
      } catch (e) {
        errMsg = (e as Error).message;
      }
      expect(errMsg).toContain("implement sha256");

      (module as unknown as { close?: () => void }).close?.();
      cleanup();
    },
    60_000,
  );

  test.skipIf(skip)("manifest accepts python/ruby/php languages", () => {
    expect(parseManifest({ name: "m", lang: "python", functions: [] }).lang).toBe("python");
    expect(parseManifest({ name: "m", lang: "ruby", functions: [] }).lang).toBe("ruby");
    expect(parseManifest({ name: "m", lang: "php", functions: [] }).lang).toBe("php");
  });
});

// ============================================================================
// Real Ruby e2e (skipped when ruby is unavailable)
// ============================================================================

describe("sidecar — real Ruby e2e (2.2)", () => {
  const skip = !toolchainAvailable("ruby", ["--version"]);

  test.skipIf(skip)(
    "loadNativeModule runs a ruby module end-to-end through ctx.native",
    async () => {
      const { dir, cleanup } = makeTempDir();
      const manifest = { ...makeManifest(), lang: "ruby" as const };
      let src = generateRubyServer(manifest);
      // Ruby stubs use kwargs (`a:`) and RuntimeError (`raise`)
      src = src.replace('raise "implement add"', "return a + b");
      src = src.replace('raise "implement reverse"', "return input.reverse");
      src = src.replace('raise "implement echoBytes"', "return b");
      writeFileSync(join(dir, "server.rb"), src, "utf-8");
      writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

      const module = loadNativeModule(manifest, { cwd: dir });

      expect(await (module.add as (...a: unknown[]) => Promise<unknown>)(2, 3)).toBe(5);
      expect(await (module.reverse as (...a: unknown[]) => Promise<unknown>)("abc")).toBe("cba");
      expect(
        await (module.echoBytes as (...a: unknown[]) => Promise<unknown>)(new Uint8Array([1, 2, 255])),
      ).toEqual(new Uint8Array([1, 2, 255]));

      let errMsg = "";
      try {
        await (module.sha256 as (...a: unknown[]) => Promise<unknown>)("x");
      } catch (e) {
        errMsg = (e as Error).message;
      }
      expect(errMsg).toContain("implement sha256");

      (module as unknown as { close?: () => void }).close?.();
      cleanup();
    },
    60_000,
  );
});

// ============================================================================
// Real PHP e2e (skipped when php is unavailable)
// ============================================================================

describe("sidecar — real PHP e2e (2.2)", () => {
  const skip = !toolchainAvailable("php", ["--version"]);

  test.skipIf(skip)(
    "loadNativeModule runs a php module end-to-end through ctx.native",
    async () => {
      const { dir, cleanup } = makeTempDir();
      const manifest = { ...makeManifest(), lang: "php" as const };
      let src = generatePhpServer(manifest);
      src = src.replace('throw new RuntimeException("implement add");', "return $a + $b;");
      src = src.replace('throw new RuntimeException("implement reverse");', "return strrev($input);");
      src = src.replace('throw new RuntimeException("implement echoBytes");', "return $b;");
      writeFileSync(join(dir, "server.php"), src, "utf-8");
      writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

      const module = loadNativeModule(manifest, { cwd: dir });

      expect(await (module.add as (...a: unknown[]) => Promise<unknown>)(2, 3)).toBe(5);
      expect(await (module.reverse as (...a: unknown[]) => Promise<unknown>)("abc")).toBe("cba");
      expect(
        await (module.echoBytes as (...a: unknown[]) => Promise<unknown>)(new Uint8Array([1, 2, 255])),
      ).toEqual(new Uint8Array([1, 2, 255]));

      let errMsg = "";
      try {
        await (module.sha256 as (...a: unknown[]) => Promise<unknown>)("x");
      } catch (e) {
        errMsg = (e as Error).message;
      }
      expect(errMsg).toContain("implement sha256");

      (module as unknown as { close?: () => void }).close?.();
      cleanup();
    },
    60_000,
  );
});
