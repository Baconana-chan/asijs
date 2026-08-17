/**
 * Native / Polyglot Modules — sidecar runtime (2.2)
 *
 * Interpreted languages (Python/Ruby/PHP) run as a sidecar process: AsiJS
 * spawns the interpreter with the generated `server.<ext>` script and
 * speaks JSON-RPC over stdio (one JSON object per line). This module is
 * the client half — it exposes the same `ctx.native.foo(...)` interface as
 * FFI modules and manages the process lifecycle:
 *
 *   - lazy spawn on first call
 *   - kill on `close()`
 *   - restart with exponential backoff when the process crashes
 *
 * Wire format: `{"id": 1, "fn": "add", "args": {...}}\n` →
 * `{"id": 1, "ok": true, "result": ...}\n`. `bytes` values travel as
 * base64 strings (the generated script knows which params/results are
 * bytes from the manifest).
 */

import { join } from "path";
import type { NativeManifest, NativeTypeName } from "./manifest";
import { isSidecarLanguage } from "./manifest";

// ============================================================================
// Types
// ============================================================================

/** A spawned sidecar process (minimal interface shared by Bun & Node). */
export interface SidecarChild {
  stdin: { write(data: string): void };
  stdout: AsyncIterable<Uint8Array>;
  stderr?: AsyncIterable<Uint8Array>;
  /** Resolves with the exit code (or null if killed by signal). */
  exited: Promise<number | null>;
  kill(signal?: string): void;
  pid: number;
}

/** Injectable spawn function (tests inject a mock). */
export interface SidecarSpawn {
  (cmd: string, args: string[], opts: { cwd?: string }): SidecarChild;
}

/** Options for `createSidecarClient`. */
export interface SidecarOptions {
  /** Project root (default: process.cwd()). */
  cwd?: string;
  /** Injectable spawn (defaults to Bun.spawn, Node child_process fallback). */
  spawn?: SidecarSpawn;
  /** Override the interpreter command/args (defaults per language). */
  interpreter?: { cmd: string; args?: string[] };
  /** Initial restart backoff in ms (doubles on each crash). Default 100. */
  backoffMs?: number;
  /** Max restart backoff in ms. Default 5000. */
  maxBackoffMs?: number;
  /** Forward interpreter stderr to console.error. Default true. */
  forwardStderr?: boolean;
}

/** A sidecar client — typed per manifest function, returns Promises. */
export type SidecarModule = Record<string, (...args: unknown[]) => Promise<unknown>>;

/** A sidecar client with its lifecycle handle. */
export interface SidecarClient {
  /** Kill the process and reject pending requests. */
  close(): void;
  /** One async function per manifest function. */
  [key: string]: ((...args: unknown[]) => Promise<unknown>) | (() => void);
}

// ============================================================================
// Interpreter / script resolution
// ============================================================================

/** Generated server script file per language. */
const SCRIPT_FILE: Record<string, string> = {
  python: "server.py",
  ruby: "server.rb",
  php: "server.php",
};

/** Default interpreter command per language. */
function defaultInterpreter(lang: string): { cmd: string; args: string[] } {
  switch (lang) {
    case "python":
      // Windows ships `python`; POSIX distros install `python3`
      return { cmd: process.platform === "win32" ? "python" : "python3", args: [] };
    case "ruby":
      return { cmd: "ruby", args: [] };
    case "php":
      return { cmd: "php", args: [] };
    default:
      throw new Error(`[native] "${lang}" is not a sidecar language`);
  }
}

// ============================================================================
// Default spawn (Bun first, Node fallback)
// ============================================================================

/** Spawn via Bun.spawn, falling back to node:child_process outside Bun. */
function spawnDefault(cmd: string, args: string[], opts: { cwd?: string }): SidecarChild {
  const b = (globalThis as { Bun?: unknown }).Bun;
  if (typeof b !== "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proc: any = (b as any).spawn({
      cmd: [cmd, ...args],
      cwd: opts.cwd,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      stdin: { write: (d: string) => proc.stdin.write(d) },
      stdout: proc.stdout as AsyncIterable<Uint8Array>,
      stderr: proc.stderr as AsyncIterable<Uint8Array> | undefined,
      exited: proc.exited as Promise<number | null>,
      kill: (sig?: string) => proc.kill(sig),
      pid: (proc.pid as number) ?? -1,
    };
  }
  // Node fallback (bun:ffi is Bun-only, but sidecars can run in plain Node)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { spawn } = require("child_process") as typeof import("child_process");
  const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ["pipe", "pipe", "pipe"] });
  return {
    stdin: { write: (d: string) => child.stdin?.write(d) },
    stdout: child.stdout as AsyncIterable<Uint8Array>,
    stderr: child.stderr as AsyncIterable<Uint8Array> | undefined,
    exited: new Promise((resolve) => child.on("close", (code) => resolve(code))),
    kill: (sig?: string) => child.kill(sig as NodeJS.Signals | undefined),
    pid: child.pid ?? -1,
  };
}

// ============================================================================
// Wire (de)serialization
// ============================================================================

/** Encode an argument for the wire: Uint8Array → base64 string (bytes). */
function encodeArg(value: unknown, type: NativeTypeName): unknown {
  if (type === "bytes") {
    if (value instanceof Uint8Array) {
      return Buffer.from(value).toString("base64");
    }
    throw new Error("[native] bytes argument must be a Uint8Array");
  }
  return value;
}

/** Decode a wire result: base64 string → Uint8Array (bytes). */
function decodeResult(value: unknown, returns: NativeTypeName): unknown {
  if (returns === "bytes" && typeof value === "string") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }
  return value;
}

// ============================================================================
// Client
// ============================================================================

interface PendingRequest {
  fn: string;
  returns: NativeTypeName;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

/**
 * Create a sidecar client for an interpreted-language manifest.
 *
 * The returned object has one async function per manifest function and a
 * `close()` lifecycle handle. The interpreter process is spawned lazily on
 * the first call and restarted with exponential backoff if it crashes.
 */
export function createSidecarClient(
  manifest: NativeManifest,
  opts: SidecarOptions = {},
): SidecarClient {
  const lang = manifest.lang;
  const scriptFile = SCRIPT_FILE[lang];
  if (!scriptFile || !isSidecarLanguage(lang)) {
    throw new Error(
      `[native] "${lang}" is not a sidecar language — supported: python, ruby, php`,
    );
  }

  const cwd = opts.cwd ?? process.cwd();
  const nativeRoot = join(cwd, manifest.sourceDir ?? "native");
  const scriptPath = join(nativeRoot, scriptFile);
  const spawnImpl = opts.spawn ?? spawnDefault;
  const interpreter = opts.interpreter ?? defaultInterpreter(lang);
  const backoffMs = opts.backoffMs ?? 100;
  const maxBackoff = opts.maxBackoffMs ?? 5000;
  const forwardStderr = opts.forwardStderr ?? true;

  let proc: SidecarChild | null = null;
  let procPromise: Promise<SidecarChild> | null = null;
  let closed = false;
  let restarts = 0;
  let nextSpawnAt = 0;
  let nextId = 1;
  const pending = new Map<number, PendingRequest>();

  const backoffDelay = (): number =>
    Math.min(backoffMs * 2 ** Math.max(0, restarts - 1), maxBackoff);

  const handleLine = (line: string): void => {
    let res: { id?: unknown; ok?: boolean; result?: unknown; error?: string };
    try {
      res = JSON.parse(line) as { id?: unknown; ok?: boolean; result?: unknown; error?: string };
    } catch {
      return; // ignore non-JSON output
    }
    if (typeof res.id !== "number") return;
    const entry = pending.get(res.id);
    if (!entry) return;
    pending.delete(res.id);
    if (res.ok) {
      restarts = 0; // healthy round-trip resets the backoff
      entry.resolve(decodeResult(res.result, entry.returns));
    } else {
      entry.reject(
        new Error(`[native:${entry.fn}] ${res.error ?? "sidecar error"}`),
      );
    }
  };

  const attach = (child: SidecarChild): void => {
    // stdout → JSON-RPC responses
    (async () => {
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        for await (const chunk of child.stdout) {
          buffer += decoder.decode(chunk, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (line) handleLine(line);
          }
        }
      } catch {
        // stream closed — process death handled via `exited`
      }
    })();

    // stderr → console (script tracebacks are visible in dev)
    const stderr = child.stderr;
    if (stderr && forwardStderr) {
      (async () => {
        const decoder = new TextDecoder();
        let buffer = "";
        try {
          for await (const chunk of stderr) {
            buffer += decoder.decode(chunk, { stream: true });
            let idx: number;
            while ((idx = buffer.indexOf("\n")) !== -1) {
              const line = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 1);
              if (line.trim()) console.error(`[native:${lang}] ${line}`);
            }
          }
        } catch {
          // ignore
        }
      })();
    }

    // crash → reject pending, schedule restart with backoff
    child.exited.then((code) => {
      if (closed) return;
      if (proc === child) proc = null;
      restarts++;
      nextSpawnAt = Date.now() + backoffDelay();
      const err = new Error(
        `[native:${lang}] sidecar process exited (code ${code ?? "?"}) — restarting with backoff`,
      );
      for (const [, p] of pending) p.reject(err);
      pending.clear();
    });
  };

  const getProc = (): Promise<SidecarChild> => {
    if (closed) {
      return Promise.reject(new Error("[native] sidecar client is closed"));
    }
    if (proc) return Promise.resolve(proc);
    if (procPromise) return procPromise;

    const wait = Math.max(0, nextSpawnAt - Date.now());
    procPromise = (wait > 0 ? new Promise((r) => setTimeout(r, wait)) : Promise.resolve())
      .then(() => {
        if (closed) throw new Error("[native] sidecar client is closed");
        const child = spawnImpl(interpreter.cmd, [...(interpreter.args ?? []), scriptPath], {
          cwd,
        });
        proc = child;
        attach(child);
        return child;
      })
      .catch((e: Error) => {
        // spawn failure — apply backoff so we don't hot-loop
        restarts++;
        nextSpawnAt = Date.now() + backoffDelay();
        const msg = e && e.message ? e.message : String(e);
        throw new Error(
          `[native:${lang}] failed to start "${interpreter.cmd} ${scriptPath}" — ${msg}. ` +
            `Install the ${lang} interpreter or pass { interpreter } to the client.`,
        );
      })
      .finally(() => {
        procPromise = null;
      });
    return procPromise;
  };

  const invoke = (fnName: string, callArgs: unknown[]): Promise<unknown> => {
    if (closed) {
      return Promise.reject(new Error("[native] sidecar client is closed"));
    }
    const fn = manifest.functions.find((f) => f.name === fnName);
    if (!fn) {
      return Promise.reject(
        new Error(`[native] unknown function "${fnName}" — check native/manifest.json`),
      );
    }
    const paramNames = Object.keys(fn.params);
    if (callArgs.length !== paramNames.length) {
      return Promise.reject(
        new Error(
          `[native:${fnName}] expected ${paramNames.length} argument(s) (${paramNames.join(", ")}), got ${callArgs.length}`,
        ),
      );
    }
    const id = nextId++;
    const args: Record<string, unknown> = {};
    paramNames.forEach((name, i) => {
      args[name] = encodeArg(callArgs[i], fn.params[name]);
    });

    return new Promise<unknown>((resolve, reject) => {
      pending.set(id, { fn: fnName, returns: fn.returns, resolve, reject });
      getProc()
        .then(async (child) => {
          if (closed) {
            pending.delete(id);
            reject(new Error("[native] sidecar client is closed"));
            return;
          }
          const line = JSON.stringify({ id, fn: fnName, args }) + "\n";
          const w = child.stdin.write(line) as unknown;
          // Bun's FileSink buffers writes — await the flush so the request
          // actually reaches the interpreter before we wait for its reply.
          if (w && typeof w === "object" && "then" in (w as object)) {
            await (w as Promise<unknown>);
          }
        })
        .catch((e: Error) => {
          pending.delete(id);
          reject(e);
        });
    });
  };

  const client: SidecarClient = { close: () => {
    closed = true;
    if (proc) {
      try {
        proc.kill();
      } catch {
        // already dead
      }
      proc = null;
    }
    const err = new Error("[native] sidecar client closed");
    for (const [, p] of pending) p.reject(err);
    pending.clear();
  } };

  for (const fn of manifest.functions) {
    client[fn.name] = (...args: unknown[]) => invoke(fn.name, args);
  }
  return client;
}
