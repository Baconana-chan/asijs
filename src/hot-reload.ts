/**
 * Hot Reload 2.0 — Module-level Hot Reload without Process Restart
 *
 * Replaces `bun --hot` with a smarter file watcher that:
 * 1. Watches project source files via fs.watch with 200ms debounce
 * 2. Categorizes changes: handler/middleware → hot swap; config/routes → full reload
 * 3. Invalidates Node/Bun module cache for changed files
 * 4. Emits events for HMR (browser push), lifecycle hooks, and plugin notifications
 *
 * @example
 * ```ts
 * import { HotReloader } from "asijs";
 *
 * const reloader = new HotReloader({
 *   rootDir: process.cwd(),
 *   watchDirs: ["src"],
 *   onModuleChange: (changedFiles) => {
 *     console.log(`📦 ${changedFiles.length} files changed`);
 *   },
 * });
 *
 * reloader.start();
 * ```
 */

import { watch, existsSync, readFileSync } from "fs";
import { join, relative, extname, resolve } from "path";

// ============================================================================
// Types
// ============================================================================

/** Category of a file change */
export type ChangeCategory = "handler" | "middleware" | "route" | "config" | "component" | "style" | "unknown";

/** Information about a changed file */
export interface FileChange {
  /** Absolute path to changed file */
  path: string;
  /** Relative path from rootDir */
  relativePath: string;
  /** File extension */
  extension: string;
  /** Categorized change type */
  category: ChangeCategory;
}

/** Event emitted when files change */
export interface HotReloadEvent {
  /** All detected changes in this debounced batch */
  changes: FileChange[];
  /** Categories present in this batch */
  categories: Set<ChangeCategory>;
  /** Whether a full reload is needed (routes/config changed) */
  needsFullReload: boolean;
  /** Timestamp of the event */
  timestamp: number;
}

/** Options for hot reloader */
export interface HotReloadOptions {
  /** Root directory of the project (default: process.cwd()) */
  rootDir?: string;
  /** Directories to watch relative to rootDir (default: ["src"]) */
  watchDirs?: string[];
  /** File extensions to watch (default: [".ts", ".tsx", ".js", ".jsx", ".css"]) */
  extensions?: string[];
  /** Debounce interval in ms (default: 200) */
  debounceMs?: number;
  /** Patterns to ignore (default: ["node_modules", ".git", "dist", ".test"]) */
  ignorePatterns?: string[];
  /** Enable verbose logging */
  verbose?: boolean;
  /** Callback when a hot reload event occurs */
  onReload?: (event: HotReloadEvent) => void | Promise<void>;
  /** Callback when modules are invalidated */
  onModuleChange?: (changes: FileChange[]) => void | Promise<void>;
  /** Callback when full reload is needed */
  onFullReload?: (changes: FileChange[]) => void | Promise<void>;
}

// ============================================================================
// Change Categorization
// ============================================================================

/** Pattern-based categorization of file changes */
const ROUTE_PATTERNS = [
  /routes?\.[jt]sx?$/,
  /router\.[jt]sx?$/,
  /src\/pages\//,
  /src\/routes\//,
  /app\.[jt]sx?$/,
];

const CONFIG_PATTERNS = [
  /asijs\.config\.[jt]s$/,
  /asijs\.config\.[jt]sx$/,
  /package\.json$/,
  /tsconfig\.json$/,
  /bunfig\.toml$/,
];

const HANDLER_PATTERNS = [
  /handlers?\.[jt]sx?$/,
  /actions?\.[jt]sx?$/,
  /controllers?\.[jt]sx?$/,
];

const MIDDLEWARE_PATTERNS = [
  /middleware\.[jt]sx?$/,
  /middlewares?\.[jt]sx?$/,
];

const COMPONENT_PATTERNS = [
  /components?\//,
  /\.[tj]sx$/,
];

const STYLE_PATTERNS = [
  /\.css$/,
  /\.scss$/,
  /\.less$/,
];

function categorizeChange(relativePath: string, extension: string): ChangeCategory {
  if (extension === ".css" || extension === ".scss" || extension === ".less") {
    return "style";
  }

  for (const pattern of ROUTE_PATTERNS) {
    if (pattern.test(relativePath)) return "route";
  }
  for (const pattern of CONFIG_PATTERNS) {
    if (pattern.test(relativePath)) return "config";
  }
  for (const pattern of HANDLER_PATTERNS) {
    if (pattern.test(relativePath)) return "handler";
  }
  for (const pattern of MIDDLEWARE_PATTERNS) {
    if (pattern.test(relativePath)) return "middleware";
  }
  for (const pattern of COMPONENT_PATTERNS) {
    if (extension === ".tsx" || extension === ".jsx") return "component";
    if (pattern.test(relativePath)) return "component";
  }

  return "unknown";
}

// ============================================================================
// Module Cache Invalidation
// ============================================================================

/**
 * Invalidate a module from the Bun/Node require cache.
 * On next import, the module will be re-evaluated.
 */
function invalidateModule(absolutePath: string): boolean {
  const resolved = resolve(absolutePath);

  // Node.js require.cache
  if (typeof require !== "undefined" && require.cache) {
    const nodeModules = Object.keys(require.cache).filter(
      (key) => key === resolved || key === resolved.replace(/\\/g, "/"),
    );
    for (const key of nodeModules) {
      delete require.cache[key];
    }
  }

  // Bun's import.meta.registry (runtime module registry)
  if (typeof Bun !== "undefined" && (Bun as any).importRegistry) {
    try {
      (Bun as any).importRegistry.delete(resolved);
    } catch {
      // Bun may not expose this API directly
    }
  }

  return true;
}

// ============================================================================
// HotReloader Class
// ============================================================================

/**
 * Smart file watcher with debounce and module invalidation.
 *
 * Watches project source files and categorizes changes to determine
 * the appropriate reload strategy: hot swap (handler/middleware),
 * full reload (routes/config), or component update (JSX).
 *
 * @example
 * ```ts
 * const reloader = new HotReloader({
 *   rootDir: process.cwd(),
 *   watchDirs: ["src", "app"],
 *   onReload: (event) => {
 *     if (event.needsFullReload) {
 *       // Re-import app entry point
 *     }
 *   },
 * });
 * reloader.start();
 * ```
 */
export class HotReloader {
  private options: Required<HotReloadOptions>;
  private watchers: Set<ReturnType<typeof watch>> = new Set();
  private debounceTimer: Timer | null = null;
  private pendingChanges: FileChange[] = [];
  private _isWatching = false;
  private eventListeners: Map<string, Set<(...args: unknown[]) => void>> = new Map();

  constructor(options: HotReloadOptions = {}) {
    this.options = {
      rootDir: options.rootDir ?? process.cwd(),
      watchDirs: options.watchDirs ?? ["src"],
      extensions: options.extensions ?? [".ts", ".tsx", ".js", ".jsx", ".css"],
      debounceMs: options.debounceMs ?? 200,
      ignorePatterns: options.ignorePatterns ?? ["node_modules", ".git", "dist", ".test"],
      verbose: options.verbose ?? false,
      onReload: options.onReload ?? (() => {}),
      onModuleChange: options.onModuleChange ?? (() => {}),
      onFullReload: options.onFullReload ?? (() => {}),
    };
  }

  /**
   * Start watching for file changes.
   */
  start(): void {
    if (this._isWatching) return;
    this._isWatching = true;

    const { rootDir, watchDirs, extensions, ignorePatterns, verbose } = this.options;

    for (const dir of watchDirs) {
      const watchPath = join(rootDir, dir);
      if (!existsSync(watchPath)) {
        if (verbose) {
          console.log(`[HotReload] Watch dir not found: ${watchPath} (skipping)`);
        }
        continue;
      }

      try {
        const watcher = watch(watchPath, { recursive: true }, (eventType, filename) => {
          if (!filename) return;

          const fullPath = join(watchPath, filename);
          const relativePath = relative(rootDir, fullPath);
          const ext = extname(filename).toLowerCase();

          // Check file extension
          if (!extensions.includes(ext)) return;

          // Check ignore patterns
          for (const pattern of ignorePatterns) {
            if (relativePath.includes(pattern)) return;
          }

          const category = categorizeChange(relativePath, ext);

          if (verbose) {
            console.log(`[HotReload] ${eventType}: ${relativePath} (${category})`);
          }

          this.queueChange({
            path: fullPath,
            relativePath,
            extension: ext,
            category,
          });
        });

        this.watchers.add(watcher);

        if (verbose) {
          console.log(`[HotReload] Watching: ${watchPath}`);
        }
      } catch (error) {
        console.error(`[HotReload] Failed to watch ${watchPath}:`, error);
      }
    }

    if (this.watchers.size > 0 && verbose) {
      console.log(`[HotReload] Started — ${this.watchers.size} watcher(s)`);
    }
  }

  /**
   * Queue a file change for debounced processing.
   */
  private queueChange(change: FileChange): void {
    this.pendingChanges.push(change);

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.flushChanges();
    }, this.options.debounceMs);
  }

  /**
   * Process all queued changes.
   */
  private flushChanges(): void {
    if (this.pendingChanges.length === 0) return;

    const changes = [...this.pendingChanges];
    this.pendingChanges = [];

    const categories = new Set(changes.map((c) => c.category));
    const needsFullReload = categories.has("route") || categories.has("config");

    const event: HotReloadEvent = {
      changes,
      categories,
      needsFullReload,
      timestamp: Date.now(),
    };

    // Invalidate module cache for all changed files
    for (const change of changes) {
      invalidateModule(change.path);
    }

    // Fire callbacks
    this.options.onModuleChange(changes);
    this.options.onReload(event);

    if (needsFullReload) {
      this.options.onFullReload(changes);
    }

    // Emit event for HMR
    this.emit("reload", event);

    if (this.options.verbose) {
      console.log(
        `[HotReload] Processed ${changes.length} change(s): ` +
        `${needsFullReload ? "FULL RELOAD" : "hot swap"} ` +
        `[${Array.from(categories).join(", ")}]`,
      );
    }
  }

  /**
   * Stop watching and clean up.
   */
  stop(): void {
    this._isWatching = false;

    for (const watcher of this.watchers) {
      try {
        (watcher as any).close();
      } catch {
        // Already closed
      }
    }
    this.watchers.clear();

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.pendingChanges = [];
    this.eventListeners.clear();
  }

  // ===== Event System =====

  /**
   * Register an event listener.
   */
  on(event: string, handler: (...args: unknown[]) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(handler);
  }

  /**
   * Remove an event listener.
   */
  off(event: string, handler: (...args: unknown[]) => void): void {
    this.eventListeners.get(event)?.delete(handler);
  }

  /**
   * Emit an event to all listeners.
   */
  private emit(event: string, ...args: unknown[]): void {
    this.eventListeners.get(event)?.forEach((handler) => {
      try {
        handler(...args);
      } catch (error) {
        console.error(`[HotReload] Event handler error:`, error);
      }
    });
  }

  // ===== Status =====

  /** Whether the watcher is actively watching */
  get isWatching(): boolean {
    return this._isWatching;
  }

  /** Number of active watchers */
  get watcherCount(): number {
    return this.watchers.size;
  }

  /** Pending file changes not yet flushed */
  get pendingCount(): number {
    return this.pendingChanges.length;
  }
}

// ============================================================================
// Convenience: Module Re-import
// ============================================================================

/**
 * Re-import a module after cache invalidation.
 *
 * First invalidates the cache, then does a fresh import.
 * Returns the module exports, or null if import failed.
 *
 * @example
 * ```ts
 * const freshModule = await reImportModule("./handlers/user-handler.ts");
 * app.get("/users", freshModule.listUsers);
 * ```
 */
export async function reImportModule<T = Record<string, unknown>>(
  modulePath: string,
): Promise<T | null> {
  const resolved = resolve(modulePath);
  invalidateModule(resolved);

  try {
    const mod = await import(resolved);
    return mod as T;
  } catch (error) {
    console.error(`[HotReload] Failed to re-import ${modulePath}:`, error);
    return null;
  }
}
