/**
 * Native / Polyglot Modules — runtime (1.4)
 *
 * Loads a compiled native module into a running AsiJS app and exposes it
 * as `ctx.native` via a middleware (the same pattern circuitBreaker uses
 * to add `ctx.circuitBreaker`). The shared library is dlopen'd lazily on
 * the first call.
 *
 * Also provides build-cache helpers (`isStale`, `markBuilt`) used by the
 * `asi native build` CLI to avoid recompiling unchanged sources.
 */

import { existsSync, readdirSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import type { Middleware } from "../types";
import type { NativeManifest, NativeTypeName } from "./manifest";
import { DEFAULT_SOURCE_DIR, isEmbeddedLanguage, isSidecarLanguage } from "./manifest";
import { createSidecarClient } from "./sidecar";
import { createLuaModule, findLuaLib } from "./lang/lua";
import { watchNativeModule } from "./watch";
import { platformLibExt } from "./generate-ts";

// ============================================================================
// Types
// ============================================================================

/** A loaded native module — typed per manifest function. */
export type NativeModule = Record<string, (...args: unknown[]) => unknown>;

/** How to resolve the shared library for a module. */
export interface NativeLoadOptions {
  /** Project root (default: process.cwd()). */
  cwd?: string;
  /** Path to the shared library. Defaults to <nativeRoot>/target/release/lib<name><ext>. */
  libPath?: string;
  /** Watch `native/` and rebuild/reload on change (dev, no server restart). */
  hotReload?: boolean;
  /** Rebuild FFI languages on change when `hotReload` is on. Default true. */
  buildOnChange?: boolean;
  /** Debounce in ms for the hot-reload watcher. Default 300. */
  debounceMs?: number;
  /** Print watcher lifecycle messages. Default true. */
  verbose?: boolean;
}

/** A thin wrapper isolating dlopen so tests can inject a mock. */
export interface DLOpenLike {
  (path: string, symbols: Record<string, unknown>): {
    symbols: Record<string, (...args: unknown[]) => unknown>;
  };
}

// ============================================================================
// Library path resolution
// ============================================================================

/** Resolve the compiled library path for a module (Rust layout). */
export function resolveLibPath(
  manifest: NativeManifest,
  opts: NativeLoadOptions = {},
): string {
  if (opts.libPath) return opts.libPath;
  const cwd = opts.cwd ?? process.cwd();
  const srcDir = manifest.sourceDir ?? DEFAULT_SOURCE_DIR;
  const nativeRoot = join(cwd, srcDir);
  const ext = platformLibExt();
  // cargo cdylib: `lib<name>.so`/`lib<name>.dylib` on POSIX, `<name>.dll` on Windows
  const prefix = ext === ".dll" ? "" : "lib";
  return join(nativeRoot, "target", "release", `${prefix}${manifest.name}${ext}`);
}

// ============================================================================
// Loading
// ============================================================================

/**
 * Load a native module and bind the manifest functions.
 *
 * Compiled languages (rust/go/c/cpp/zig) are dlopen'd via bun:ffi lazily
 * on first call. Sidecar languages (python/ruby/php) spawn an interpreter
 * process and speak JSON-RPC over stdio — same `ctx.native` interface.
 *
 * @param dlopenImpl  Injectable dlopen for tests (defaults to bun:ffi).
 */
export function loadNativeModule(
  manifest: NativeManifest,
  opts: NativeLoadOptions = {},
  dlopenImpl: DLOpenLike = dlopenDefault,
): NativeModule {
  if (isSidecarLanguage(manifest.lang)) {
    return createSidecarClient(manifest, { cwd: opts.cwd }) as unknown as NativeModule;
  }
  if (isEmbeddedLanguage(manifest.lang)) {
    // Embedded interpreters (Lua): dlopen liblua in-process and drive it
    // through its C API — no compilation, no sidecar process.
    return createLuaModule(manifest, {
      cwd: opts.cwd,
      libPath: opts.libPath,
      dlopen: dlopenImpl === dlopenDefault ? undefined : (dlopenImpl as never),
    }) as unknown as NativeModule;
  }
  const libPath = resolveLibPath(manifest, opts);
  // When a custom dlopen is injected (tests, mocks), skip the existence check
  const skipExistenceCheck = dlopenImpl !== dlopenDefault;
  let lib: ReturnType<DLOpenLike> | null = null;

  const getLib = (): ReturnType<DLOpenLike> => {
    if (!lib) {
      if (!skipExistenceCheck && !existsSync(libPath)) {
        throw new Error(
          `Native library not found at ${libPath} — run "asi native build" first`,
        );
      }
      try {
        const symbols: Record<string, unknown> = {
          asijs_call: { args: ["ptr"], returns: "ptr" },
          asijs_free: { args: ["ptr"], returns: "void" },
        };
        // Haskell GHC shared libs need the RTS initialised before any call.
        // bun:ffi only binds symbols listed in the dlopen map, so hs_init
        // must be declared explicitly for haskell modules.
        if (manifest.lang === "haskell") {
          symbols["hs_init"] = { args: ["ptr", "ptr"], returns: "void" };
        }
        lib = dlopenImpl(libPath, symbols);
        if (manifest.lang === "haskell") {
          const init = (lib as { symbols: Record<string, (...a: unknown[]) => unknown> })
            .symbols["hs_init"];
          if (init) init(null, null);
        }
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        throw new Error(
          `Failed to load native library ${libPath}: ${detail}. ` +
            `If the library is stale or missing symbols, run "asi native build".`,
        );
      }
    }
    return lib;
  };

  const invoke = (fnName: string, args: Record<string, unknown>): unknown => {
    const payload = JSON.stringify({ fn: fnName, args });
    return invokeJson(getLib(), payload, fnName);
  };

  const module: NativeModule = {};
  for (const fn of manifest.functions) {
    module[fn.name] = (...callArgs: unknown[]) => {
      const args: Record<string, unknown> = {};
      const paramNames = Object.keys(fn.params);
      paramNames.forEach((name, i) => {
        let v = callArgs[i];
        // bytes params travel as a JSON array of numbers — a Uint8Array would
        // stringify to an object { "0": .. } and break the native dispatchers
        if (fn.params[name] === "bytes" && v instanceof Uint8Array) {
          v = Array.from(v);
        }
        args[name] = v;
      });
      return invoke(fn.name, args);
    };
  }
  return module;
}

/** Default dlopen — uses bun:ffi when available, else a clear error. */
function dlopenDefault(
  path: string,
  symbols: Record<string, unknown>,
): ReturnType<DLOpenLike> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { dlopen } = require("bun:ffi") as {
      dlopen: (p: string, s: Record<string, unknown>) => unknown;
    };
    return dlopen(path, symbols) as ReturnType<DLOpenLike>;
  } catch {
    throw new Error(
      `Native modules require Bun's bun:ffi. Run with bun (e.g. "bun run src/index.ts").`,
    );
  }
}

/** Read a NUL-terminated C string from a raw pointer (bun:ffi path). */
function readCStringPtr(ptrValue: unknown): string {
  try {
    const { CString } = require("bun:ffi") as {
      CString: new (ptr: unknown) => { toString(): string };
    };
    return new CString(ptrValue).toString();
  } catch {
    throw new Error(
      `[native] cannot read C string from pointer — bun:ffi CString unavailable`,
    );
  }
}

/**
 * Raw JSON invocation against a loaded library.
 * The pointer returned by asijs_call is a Buffer under bun:ffi (the `ptr`
 * return type maps to a Buffer). We read it as a NUL-terminated C string,
 * parse the JSON response, then free it via asijs_free.
 */
function invokeJson(
  lib: ReturnType<DLOpenLike>,
  payload: string,
  fnName: string,
): unknown {
  const call = lib.symbols["asijs_call"];
  const free = lib.symbols["asijs_free"];
  if (!call || !free) {
    throw new Error(
      `[native:${fnName}] library does not export asijs_call/asijs_free`,
    );
  }
  // C functions expect a NUL-terminated string — append the terminator
  const bytes = new TextEncoder().encode(payload + "\0");
  const outPtr = call(bytes) as unknown;
  if (!outPtr) {
    throw new Error(`[native:${fnName}] null response from library`);
  }
  try {
    // bun:ffi passes strings as pointers — read via CString when the mock
    // returns a raw number pointer; the mock path returns a Uint8Array.
    const text =
      typeof outPtr === "number"
        ? readCStringPtr(outPtr)
        : readCString(outPtr);
    const res = JSON.parse(text) as {
      ok: boolean;
      result?: unknown;
      error?: string;
    };
    if (!res.ok) {
      throw new Error(`[native:${fnName}] ${res.error ?? "native error"}`);
    }
    return res.result;
  } finally {
    free(outPtr);
  }
}

/** Read a NUL-terminated C string from a pointer/Buffer. */
export function readCString(ptr: unknown): string {
  const buf = ptr as Uint8Array;
  let end = buf.length;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0) {
      end = i;
      break;
    }
  }
  return new TextDecoder().decode(buf.subarray(0, end));
}

// ============================================================================
// Middleware plugin (ctx.native)
// ============================================================================

/**
 * Middleware that exposes native modules as `ctx.native`.
 * The module manifest is loaded lazily on the first request that touches
 * `ctx.native`; the shared library is dlopen'd (FFI) or the interpreter is
 * spawned (sidecar) on the first call.
 *
 * With `hotReload: true` the middleware watches `native/`, rebuilds FFI
 * languages and swaps the module without restarting the server. Sidecar
 * languages (python/ruby/php) reload in place everywhere; FFI hot reload
 * works on POSIX, while on Windows a locked `.so` needs a manual restart
 * (a clear message is printed).
 *
 * @example
 * ```ts
 * import { Asi } from "asijs";
 * import { native } from "asijs/native";
 *
 * const app = new Asi();
 * app.use(native({ cwd: process.cwd(), hotReload: true }));
 *
 * app.get("/hash", async (ctx) => {
 *   const hash = await ctx.native.sha256(ctx.query.input as string);
 *   return { hash };
 * });
 * ```
 */
export function native(options: NativeLoadOptions = {}): Middleware {
  const cwd = options.cwd ?? process.cwd();
  const nativeRoot = join(cwd, DEFAULT_SOURCE_DIR);
  let manifestPromise: Promise<NativeManifest> | null = null;
  let module: NativeModule | null = null;

  const getManifest = async (): Promise<NativeManifest> => {
    if (!manifestPromise) {
      manifestPromise = import("./manifest").then(async (m) => {
        try {
          return await m.loadManifest(nativeRoot);
        } catch (e) {
          throw new Error(
            `[native] invalid manifest at ${nativeRoot}: ${(e as Error).message}`,
          );
        }
      });
    }
    return manifestPromise;
  };

  const getModule = async (): Promise<NativeModule> => {
    if (!module) {
      const manifest = await getManifest();
      module = loadNativeModule(manifest, { cwd });
    }
    return module;
  };

  /** Drop the cached manifest + module (closing sidecar processes). */
  const reload = (): void => {
    manifestPromise = null;
    if (module) {
      const withClose = module as NativeModule & { close?: () => void };
      try {
        withClose.close?.();
      } catch {
        // ignore — process already dead
      }
      module = null;
    }
  };

  // Hot reload: watch native/ and swap the module on change (dev DX 2.3)
  let stopWatch: (() => void) | null = null;
  if (options.hotReload) {
    stopWatch = watchNativeModule({
      cwd,
      buildOnChange: options.buildOnChange,
      debounceMs: options.debounceMs,
      verbose: options.verbose,
      onEvent: (event) => {
        if (event.type === "reload") {
          reload();
        }
      },
    });
  }

  const nativeMiddleware = async function nativeMiddleware(
    ctx: any,
    next: () => any,
  ): Promise<any> {
    ctx.native = new Proxy(
      {},
      {
        get: (_t, prop: string) => {
          return (...args: unknown[]) =>
            getModule().then((m) => {
              const fn = m[prop];
              if (!fn) {
                throw new Error(
                  `[native] unknown function "${prop}" — check native/manifest.json`,
                );
              }
              return fn(...args);
            });
        },
      },
    );
    return next();
  } as Middleware & { stop?: () => void };

  // Let callers (and the dev mode plugin) stop the watcher explicitly.
  // Also drops the cached module — closing sidecar processes.
  nativeMiddleware.stop = (): void => {
    stopWatch?.();
    stopWatch = null;
    reload();
  };

  return nativeMiddleware;
}

// ============================================================================
// Build cache
// ============================================================================

/** Marker file recording the last successful build. */
export function cacheMarkerPath(nativeRoot: string): string {
  return join(nativeRoot, ".asi-native-cache");
}

/**
 * Whether the native module is stale: marker missing or any source file
 * newer than the marker.
 */
export function isStale(nativeRoot: string, manifest: NativeManifest): boolean {
  const marker = cacheMarkerPath(nativeRoot);
  if (!existsSync(marker)) return true;
  const markerTime = statSync(marker).mtimeMs;
  const srcDir = join(nativeRoot, "src");
  const candidates = [
    join(nativeRoot, "manifest.json"),
    join(nativeRoot, "Cargo.toml"),
    // sidecar server scripts
    join(nativeRoot, "server.py"),
    join(nativeRoot, "server.rb"),
    join(nativeRoot, "server.php"),
    // embedded interpreter scripts (lua)
    join(nativeRoot, "lib.lua"),
  ];
  if (existsSync(srcDir)) {
    candidates.push(...walkFiles(srcDir));
  }
  for (const file of candidates) {
    if (existsSync(file) && statSync(file).mtimeMs > markerTime) {
      return true;
    }
  }
  return false;
}

/** Mark the module as built. */
export function markBuilt(nativeRoot: string): void {
  writeFileSync(
    cacheMarkerPath(nativeRoot),
    new Date().toISOString(),
    "utf-8",
  );
}

/** Recursively list files under a directory. */
function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}
