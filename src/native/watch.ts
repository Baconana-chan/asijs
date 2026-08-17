/**
 * Native / Polyglot Modules — hot reload watcher (2.3)
 *
 * Watches the `native/` directory and, on change, rebuilds FFI languages
 * (rust/go/c/cpp/zig) and emits a `reload` event so the runtime can swap
 * the module without restarting the server. Sidecar languages (python/ruby/php)
 * need no build — a `reload` is emitted immediately and the interpreter is
 * respawned on the next call.
 *
 * Used by the `native({ hotReload: true })` middleware and available as a
 * standalone helper for custom wiring.
 */

import { watch, existsSync, statSync, type FSWatcher } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";
import { findNativeRoot, loadManifest, type NativeManifest } from "./manifest";
import { getGenerator } from "./generators";

// ============================================================================
// Types
// ============================================================================

/** Watcher lifecycle / build events. */
export type NativeWatchEventType = "started" | "reload" | "build-failed" | "stopped";

export interface NativeWatchEvent {
  type: NativeWatchEventType;
  message: string;
}

/** Options for `watchNativeModule`. */
export interface NativeWatchOptions {
  /** Project root (default: process.cwd()). */
  cwd?: string;
  /** Rebuild FFI languages on change. Default true. */
  buildOnChange?: boolean;
  /** Debounce in ms before rebuilding. Default 300. */
  debounceMs?: number;
  /** Print lifecycle messages to console. Default true. */
  verbose?: boolean;
  /** Event callback (watch errors go here too). */
  onEvent?: (event: NativeWatchEvent) => void;
}

// ============================================================================
// Watcher
// ============================================================================

/** Paths that must not trigger a rebuild (build output, generated files). */
const IGNORE_PATTERNS = [
  "target",
  ".asi-native-cache",
  "generated.ts",
  "node_modules",
  ".git",
];

function isIgnored(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, "/");
  return IGNORE_PATTERNS.some((p) => norm.includes(p));
}

/**
 * Watch a native module directory and rebuild/reload on changes.
 *
 * @returns A stop function. Also emits events via `options.onEvent`:
 *   `started`, `reload`, `build-failed`, `stopped`.
 *
 * @example
 * ```ts
 * import { watchNativeModule } from "asijs/native";
 *
 * const stop = watchNativeModule({
 *   cwd: process.cwd(),
 *   onEvent: (e) => console.log(`[native] ${e.message}`),
 * });
 * // later: stop();
 * ```
 */
export function watchNativeModule(options: NativeWatchOptions = {}): () => void {
  const cwd = options.cwd ?? process.cwd();
  const buildOnChange = options.buildOnChange ?? true;
  const debounceMs = options.debounceMs ?? 300;
  const verbose = options.verbose ?? true;
  const emit = (type: NativeWatchEventType, message: string): void => {
    if (verbose && type !== "started" && type !== "stopped") {
      const prefix = type === "build-failed" ? "[native] ✗" : "[native] ✓";
      if (type === "build-failed") console.error(`${prefix} ${message}`);
      else console.log(`${prefix} ${message}`);
    }
    options.onEvent?.({ type, message });
  };

  const nativeRoot = findNativeRoot(cwd);
  if (!nativeRoot) {
    emit("stopped", "no native module found — nothing to watch");
    return () => {};
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let manifest: NativeManifest | null = null;
  const watchers = new Set<FSWatcher>();

  const loadManifestSafe = async (): Promise<void> => {
    try {
      manifest = await loadManifest(nativeRoot);
    } catch (e) {
      manifest = null;
      emit("build-failed", `invalid manifest: ${(e as Error).message}`);
    }
  };

  const rebuild = (): boolean => {
    if (!manifest) return true; // nothing to build against — just reload
    const gen = getGenerator(manifest.lang);
    // sidecar/embedded — no compilation: the interpreter or liblua state is
    // re-created on the next call, so just emit reload
    if (gen.kind !== "ffi") return true;

    const build = gen.build(manifest);
    const res = spawnSync(build.cmd, build.args, {
      cwd: nativeRoot,
      encoding: "utf-8",
    });
    if (res.status !== 0) {
      const detail = (res.stderr || res.stdout || "").trim().split("\n").slice(-3).join(" ");
      emit(
        "build-failed",
        `build failed for ${manifest.name} (${manifest.lang}): ${detail}`,
      );
      return false;
    }
    return true;
  };

  const handleChange = async (): Promise<void> => {
    if (stopped) return;
    // Re-read the manifest first (functions/lang may have changed), then build
    await loadManifestSafe();
    const ok = rebuild();
    if (stopped) return;
    if (ok) {
      emit("reload", `${manifest?.name ?? "module"} rebuilt — module reloaded`);
    } else if (manifest && getGenerator(manifest.lang).kind === "ffi") {
      // Build failed (e.g. the .so is locked on Windows) — tell the user why
      emit(
        "build-failed",
        "library not reloaded. If the shared library is locked (Windows), " +
          'close the app and run "asi native build", then restart.',
      );
    }
  };

  const onFsEvent = (_eventType: string, filename: string | null): void => {
    if (stopped) return;
    // null filenames and directory-change events (Windows fires `change "src"`
    // when a child is written) must not trigger a rebuild.
    if (!filename) return;
    try {
      if (statSync(join(nativeRoot, filename)).isDirectory()) return;
    } catch {
      // path no longer exists — treat as a file event (deletion)
    }
    if (isIgnored(filename)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void handleChange();
    }, debounceMs);
  };

  // Watch the native root recursively; fall back to watching each subdirectory
  // on platforms where recursive watch is unavailable.
  const addWatch = (dir: string): void => {
    if (!existsSync(dir)) return;
    try {
      watchers.add(watch(dir, { recursive: true }, onFsEvent));
    } catch {
      try {
        watchers.add(watch(dir, onFsEvent));
      } catch {
        // unwatchable — ignore
      }
    }
  };

  addWatch(nativeRoot);
  // ensure nested source dirs (e.g. native/src for rust) are covered on
  // non-recursive platforms. Never watch build output (target/) — it is
  // written by our own rebuilds and would loop forever.
  for (const sub of ["src"]) {
    const subPath = join(nativeRoot, sub);
    if (existsSync(subPath)) addWatch(subPath);
  }

  emit("started", `watching ${nativeRoot}`);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    for (const w of watchers) {
      try {
        w.close();
      } catch {
        // already closed
      }
    }
    watchers.clear();
    emit("stopped", "watcher stopped");
  };
}

// ============================================================================
// Rebuild helper (used by tests + cli)
// ============================================================================

/**
 * Rebuild a native module in place. Returns `{ ok, message }` where `message`
 * carries the build failure detail when `ok` is false. Sidecar languages
 * trivially succeed (no compilation).
 */
export function rebuildNativeModule(
  nativeRoot: string,
  manifest: NativeManifest,
): { ok: boolean; message?: string } {
  const gen = getGenerator(manifest.lang);
  if (gen.kind !== "ffi") {
    // sidecar/embedded — nothing to compile; reload happens on next call
    return { ok: true };
  }
  const build = gen.build(manifest);
  const res = spawnSync(build.cmd, build.args, {
    cwd: nativeRoot,
    encoding: "utf-8",
  });
  if (res.status !== 0) {
    const detail = (res.stderr || res.stdout || "no output").trim();
    return { ok: false, message: detail };
  }
  return { ok: true };
}
