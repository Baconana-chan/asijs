/**
 * Native / Polyglot Modules — embedded Lua runtime (2.4, variant A)
 *
 * Lua runs **inside the AsiJS process**: the runtime dlopen's liblua itself
 * (`lua55.dll` / `liblua.so`) and drives it through its C API — no
 * compilation, no sidecar process, no IPC. This is the third kind of native
 * integration (embedded interpreter) and the first one on Lua.
 *
 * The generated `lib.lua` (see generate-lua.ts) defines `asijs_call(input)`
 * — a JSON-RPC boundary: it parses a `{"fn", "args"}` request, calls the
 * manifest function by name and returns a `{"ok", "result"|"error"}` JSON
 * string. This module binds the Lua C API via bun:ffi and:
 *
 *   1. creates a Lua state (`luaL_newstate`)
 *   2. opens the standard libs (`luaL_openselectedlibs`)
 *   3. loads `lib.lua` from the native root (`luaL_loadstring` + pcall)
 *   4. for each call: pushes `asijs_call` + the JSON payload and pcalls it
 *
 * Lua 5.5 exports only the raw C API (macros like `lua_pcall`/`lua_pop`/
 * `luaL_dostring`/`luaL_openlibs` are header-only), so the bindings below
 * use the exported functions: `lua_pcallk`, `lua_settop`, `luaL_loadstring`,
 * `luaL_openselectedlibs`, `lua_tolstring`.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { NativeManifest } from "../manifest";
import { DEFAULT_SOURCE_DIR } from "../manifest";

// ============================================================================
// Types
// ============================================================================

/** Thin dlopen wrapper so tests can inject a mock (mirrors runtime.DLOpenLike). */
export interface LuaDLOpen {
  (path: string, symbols: Record<string, unknown>): {
    symbols: Record<string, (...args: unknown[]) => unknown>;
  };
}

/** Options for `createLuaModule`. */
export interface LuaModuleOptions {
  /** Project root (default: process.cwd()). */
  cwd?: string;
  /** Explicit path to liblua (default: auto-detected, see findLuaLib). */
  libPath?: string;
  /** Injectable dlopen for tests (defaults to bun:ffi). */
  dlopen?: LuaDLOpen;
}

/** A loaded Lua module — one function per manifest entry + lifecycle. */
export interface LuaModule extends Record<string, (...args: unknown[]) => unknown> {
  /** Destroy the Lua state (frees the interpreter). */
  close(): void;
}

// ============================================================================
// liblua discovery
// ============================================================================

/** Candidate names for the Lua shared library per platform. */
function luaLibCandidates(): string[] {
  if (process.platform === "win32") {
    // Lua 5.5 (MSYS2 ucrt64/mingw64), then older 5.4/5.3 in the same dirs.
    return ["lua55.dll", "lua54.dll", "lua53.dll"];
  }
  if (process.platform === "darwin") {
    return ["liblua.dylib", "liblua55.dylib", "liblua5.4.dylib"];
  }
  return ["liblua.so", "liblua55.so", "liblua5.4.so", "liblua5.3.so"];
}

/** Common directories where liblua may live. */
function luaLibDirs(): string[] {
  const dirs: string[] = [];
  if (process.platform === "win32") {
    // MSYS2 installs (both UCRT64 and MINGW64 variants) on any drive
    for (const drive of ["C:", "D:", "E:", "F:"]) {
      for (const root of [`${drive}/msys64`, `${drive}/msys2`, `${drive}/msys`]) {
        dirs.push(`${root}/ucrt64/bin`, `${root}/mingw64/bin`, `${root}/usr/bin`);
      }
    }
  } else if (process.platform === "darwin") {
    dirs.push("/opt/homebrew/lib", "/usr/local/lib", "/usr/lib");
  } else {
    dirs.push("/usr/lib", "/usr/local/lib", "/lib", "/usr/lib/x86_64-linux-gnu");
  }
  return dirs;
}

/**
 * Locate liblua on this machine.
 *
 * Precedence: `ASI_LUA_LIB` env var → known directories (MSYS2 on Windows,
 * system lib dirs on POSIX) → a bare name for dlopen to resolve via the
 * loader's own search path. Returns null when nothing is found.
 */
export function findLuaLib(): string | null {
  const env = process.env.ASI_LUA_LIB;
  if (env) {
    if (existsSync(env)) return env;
    return env; // let dlopen fail with a clear message about the path
  }
  for (const dir of luaLibDirs()) {
    for (const name of luaLibCandidates()) {
      const p = join(dir, name);
      if (existsSync(p)) return p;
    }
  }
  // Bare name: dlopen will search the OS loader paths (LD_LIBRARY_PATH, …).
  return luaLibCandidates()[0] ?? null;
}

// ============================================================================
// Default dlopen (bun:ffi)
// ============================================================================

/** dlopen via bun:ffi, with a clear error when Bun is unavailable. */
function dlopenDefault(path: string, symbols: Record<string, unknown>): {
  symbols: Record<string, (...args: unknown[]) => unknown>;
} {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { dlopen } = require("bun:ffi") as {
      dlopen: (p: string, s: Record<string, unknown>) => unknown;
    };
    return dlopen(path, symbols) as {
      symbols: Record<string, (...args: unknown[]) => unknown>;
    };
  } catch {
    throw new Error(
      `Lua modules require Bun's bun:ffi. Run with bun (e.g. "bun run src/index.ts").`,
    );
  }
}

// ============================================================================
// Lua C API bindings
// ============================================================================

/**
 * Lua 5.5 C API symbols (the exported subset — macros are expanded by hand).
 * All strings cross the boundary as NUL-terminated C strings, so the `ptr`
 * args receive a Buffer with a trailing \0.
 */
function luaSymbols(): Record<string, unknown> {
  return {
    luaL_newstate: { args: [], returns: "ptr" },
    luaL_openselectedlibs: { args: ["ptr", "i32", "i32"], returns: "void" },
    luaL_loadstring: { args: ["ptr", "ptr"], returns: "i32" },
    lua_pcallk: {
      args: ["ptr", "i32", "i32", "i32", "i32", "ptr"],
      returns: "i32",
    },
    lua_getglobal: { args: ["ptr", "ptr"], returns: "i32" },
    lua_pushstring: { args: ["ptr", "ptr"], returns: "ptr" },
    lua_tolstring: { args: ["ptr", "i32", "ptr"], returns: "ptr" },
    lua_settop: { args: ["ptr", "i32"], returns: "void" },
    lua_close: { args: ["ptr"], returns: "void" },
  };
}

/** Encode a JS string as a NUL-terminated C string Buffer. */
function cstr(s: string): Buffer {
  return Buffer.from(s + "\0", "utf-8");
}

/** Read a C string returned by the Lua API (number pointer or Buffer). */
function readStr(ptr: unknown): string {
  if (typeof ptr === "number") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { CString } = require("bun:ffi") as {
        CString: new (ptr: unknown) => { toString(): string };
      };
      return new CString(ptr).toString();
    } catch {
      throw new Error("[native:lua] cannot read string from pointer");
    }
  }
  if (ptr instanceof Buffer) return ptr.toString();
  return String(ptr);
}

// ============================================================================
// Embedded Lua module
// ============================================================================

/**
 * Create an embedded Lua module: dlopen liblua, load `lib.lua` from the
 * native root and bind the manifest functions through the `asijs_call`
 * dispatcher. Functions are synchronous (in-process, no IPC).
 *
 * @example
 * ```ts
 * const mod = createLuaModule(manifest, { cwd: process.cwd() });
 * mod.add(2, 3); // 5
 * mod.close();
 * ```
 */
export function createLuaModule(
  manifest: NativeManifest,
  opts: LuaModuleOptions = {},
): LuaModule {
  const cwd = opts.cwd ?? process.cwd();
  const nativeRoot = join(cwd, manifest.sourceDir ?? DEFAULT_SOURCE_DIR);
  const scriptPath = join(nativeRoot, "lib.lua");
  if (!existsSync(scriptPath)) {
    throw new Error(
      `Lua script not found at ${scriptPath} — run "asi native scaffold lua" first`,
    );
  }

  const libPath = opts.libPath ?? findLuaLib();
  if (!libPath) {
    throw new Error(
      `[native:lua] liblua not found. Install Lua (MSYS2: pacman -S mingw-w64-ucrt-x86_64-lua) ` +
        `or set ASI_LUA_LIB=/path/to/lua55.dll`,
    );
  }

  const dl = opts.dlopen ?? dlopenDefault;
  let lib: { symbols: Record<string, (...args: unknown[]) => unknown> } | null = null;

  const getLib = (): { symbols: Record<string, (...args: unknown[]) => unknown> } => {
    if (!lib) {
      try {
        lib = dl(libPath, luaSymbols());
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        throw new Error(
          `[native:lua] failed to load liblua at ${libPath}: ${detail}. ` +
            `Set ASI_LUA_LIB to point at your Lua shared library.`,
        );
      }
    }
    return lib;
  };

  /** The lua_State pointer (a raw number under bun:ffi). */
  let state: number | null = null;

  const getState = (): number => {
    if (state !== null) return state;
    const s = getLib().symbols;
    const L = s.luaL_newstate() as unknown;
    if (!L || (typeof L === "number" && L === 0)) {
      throw new Error("[native:lua] luaL_newstate failed (out of memory?)");
    }
    state = L as number;
    s.luaL_openselectedlibs(state, -1, 0);

    const script = readFileSync(scriptPath, "utf-8");
    const rc = s.luaL_loadstring(state, cstr(script)) as number;
    if (rc !== 0) {
      const err = readStr(s.lua_tolstring(state, -1, null));
      s.lua_settop(state, -2);
      close();
      throw new Error(`[native:lua] failed to load ${scriptPath}: ${err}`);
    }
    const run = s.lua_pcallk(state, 0, -1, 0, 0, null) as number;
    if (run !== 0) {
      const err = readStr(s.lua_tolstring(state, -1, null));
      s.lua_settop(state, -2);
      close();
      throw new Error(`[native:lua] failed to run ${scriptPath}: ${err}`);
    }
    return state;
  };

  const close = (): void => {
    if (state !== null) {
      try {
        getLib().symbols.lua_close(state);
      } catch {
        // already closed
      }
      state = null;
    }
  };

  const invoke = (fnName: string, args: Record<string, unknown>): unknown => {
    const L = getState();
    const s = getLib().symbols;
    const payload = JSON.stringify({ fn: fnName, args });
    s.lua_getglobal(L, cstr("asijs_call"));
    s.lua_pushstring(L, cstr(payload));
    const rc = s.lua_pcallk(L, 1, 1, 0, 0, null) as number;
    if (rc !== 0) {
      const err = readStr(s.lua_tolstring(L, -1, null));
      s.lua_settop(L, -2);
      throw new Error(`[native:${fnName}] ${err}`);
    }
    const out = readStr(s.lua_tolstring(L, -1, null));
    s.lua_settop(L, -2);
    let res: { ok: boolean; result?: unknown; error?: string };
    try {
      res = JSON.parse(out) as { ok: boolean; result?: unknown; error?: string };
    } catch {
      throw new Error(`[native:${fnName}] invalid response from Lua: ${out.slice(0, 120)}`);
    }
    if (!res.ok) {
      throw new Error(`[native:${fnName}] ${res.error ?? "lua error"}`);
    }
    return res.result;
  };

  const module: LuaModule = { close };
  for (const fn of manifest.functions) {
    module[fn.name] = (...callArgs: unknown[]) => {
      const args: Record<string, unknown> = {};
      const paramNames = Object.keys(fn.params);
      paramNames.forEach((name, i) => {
        let v = callArgs[i];
        // bytes params travel as a JSON array of numbers
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
