/**
 * Workspace Dev Server — Selective Hot-Reload for Bun Monorepos
 *
 * In a Bun workspace with multiple sub-apps, `bun --hot` reloads everything
 * when any file changes. This module spawns each sub-app as its own Bun process
 * with --hot, so only the sub-app whose files changed gets reloaded.
 *
 * @example
 * ```ts
 * import { asiDev } from "asijs";
 *
 * const ws = await asiDev();
 * // All sub-apps now run with independent hot-reload
 * ```
 *
 * CLI usage:
 * ```bash
 * bunx asijs dev
 * ```
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, relative, basename } from "path";

// ========================================================================
// Types
// ========================================================================

/** A detected sub-app in the workspace */
export interface SubApp {
  /** Sub-app display name */
  name: string;
  /** Path to entry file (e.g. src/index.ts) */
  entryPoint: string;
  /** Root directory of this sub-app */
  rootDir: string;
  /** Port assigned for development */
  port: number;
  /** Current process (null if not running) */
  process: SubAppProcess | null;
  /** Status */
  status: "stopped" | "starting" | "running" | "error";
  /** Last error message */
  lastError?: string;
}

/** Rate limit configuration for workspace sub-apps */
export interface WorkspaceRateLimitConfig {
  /** Enable automatic rate limiting (default: false) */
  enabled?: boolean;
  /** Maximum requests per time window per tenant (default: 1000) */
  max?: number;
  /** Time window in milliseconds (default: 60_000 = 1 minute) */
  windowMs?: number;
}

/** Options for workspace dev mode */
export interface WorkspaceDevOptions {
  /** Base port for the first sub-app (each gets incremented) */
  basePort?: number;
  /** Explicit list of sub-app configs */
  apps?: SubAppConfig[];
  /** Custom environment variables */
  env?: Record<string, string>;
  /** Enable verbose logging */
  verbose?: boolean;
  /**
   * Automatic per-tenant rate limiting configuration.
   * When set, each sub-app receives env vars so that
   * `workspaceRateLimit()` auto-configures without arguments.
   */
  rateLimit?: WorkspaceRateLimitConfig;
}

/** Sub-app configuration */
export interface SubAppConfig {
  name: string;
  entryPoint: string;
  rootDir?: string;
  port?: number;
  env?: Record<string, string>;
}

/** Process handle for a running sub-app */
export interface SubAppProcess {
  process: unknown; // Bun.Subprocess at runtime
  pid: number;
  startedAt: Date;
  restartCount: number;
}

// ========================================================================
// Workspace Scanner
// ========================================================================

/**
 * Scan the current working directory for a Bun workspace and detect sub-apps.
 *
 * Detection strategy:
 * 1. Read root `package.json` for `workspaces` field
 * 2. For each workspace glob, find packages with AsiJS entry files
 * 3. If no workspaces found, scan for common entry files
 *
 * @returns Array of detected sub-apps
 */
export function scanWorkspace(
  options: { cwd?: string } = {},
): SubApp[] {
  const cwd = options.cwd ?? process.cwd();
  const apps: SubApp[] = [];

  // Helper to check if a package is an AsiJS app
  const tryAddApp = (pkgDir: string, name?: string): SubApp | null => {
    const attempts = [
      join(pkgDir, "src", "index.ts"),
      join(pkgDir, "src", "index.tsx"),
      join(pkgDir, "src", "app.ts"),
      join(pkgDir, "index.ts"),
    ];

    for (const entry of attempts) {
      if (existsSync(entry)) {
        const appName =
          name ||
          basename(pkgDir) ||
          relative(cwd, pkgDir).replace(/[/\\]/g, "-") ||
          "app";

        // Check if it imports from asijs (heuristic)
        const content = readFileSync(entry, "utf-8");
        const isAsiApp = /from\s+["']asijs["']/.test(content);

        if (isAsiApp) {
          const app: SubApp = {
            name: appName,
            entryPoint: entry,
            rootDir: pkgDir,
            port: 0, // assigned deterministically after sorting
            process: null,
            status: "stopped",
          };
          apps.push(app);
          return app;
        }
      }
    }
    return null;
  };

  // 1. Try reading root package.json for workspaces
  const pkgPath = join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      const workspaces: string[] = pkg.workspaces || pkg.workspace?.packages || [];

      if (workspaces.length > 0) {
        for (const pattern of workspaces) {
          // Simple glob expansion — convert * to match all dirs
          const baseDir = pattern.replace(/\*.*$/, "").replace(/\/$/, "");
          const fullBase = join(cwd, baseDir);

          if (existsSync(fullBase)) {
            const entries = readdirSync(fullBase);
            for (const entry of entries) {
              const pkgDir = join(fullBase, entry);
              if (statSync(pkgDir).isDirectory()) {
                const pkgJsonPath = join(pkgDir, "package.json");
                let pkgName: string | undefined;
                if (existsSync(pkgJsonPath)) {
                  try {
                    pkgName = JSON.parse(
                      readFileSync(pkgJsonPath, "utf-8"),
                    ).name;
                  } catch {
                    // ignore
                  }
                }
                tryAddApp(pkgDir, pkgName || entry);
              }
            }
          }
        }
      }
    } catch {
      // Invalid package.json
    }
  }

  // 2. No workspaces found — scan common locations
  if (apps.length === 0) {
    // Check root itself
    tryAddApp(cwd);

    // Check packages/, apps/, sub-apps/ directories
    for (const dir of ["packages", "apps", "sub-apps"]) {
      const fullDir = join(cwd, dir);
      if (existsSync(fullDir)) {
        const entries = readdirSync(fullDir);
        for (const entry of entries) {
          const pkgDir = join(fullDir, entry);
          if (statSync(pkgDir).isDirectory()) {
            tryAddApp(pkgDir, entry);
          }
        }
      }
    }
  }

  // Sort by name for deterministic order (filesystem order varies by OS)
  apps.sort((a, b) => a.name.localeCompare(b.name));

  // Assign ports AFTER sorting so they are deterministic on every platform —
  // readdir order differs between filesystems (Linux uses hash order), so
  // ports assigned during discovery would end up swapped after the sort.
  let assignedPort = 3000;
  for (const app of apps) {
    app.port = assignedPort++;
  }

  return apps;
}

// ========================================================================
// Workspace Dev Server
// ========================================================================

/**
 * Start workspace dev mode — spawn each sub-app as a separate Bun process
 * with `--hot` so changes only reload the affected sub-app.
 *
 * Each sub-app gets a unique port.
 *
 * @returns Controller to stop all processes
 */
export async function startWorkspaceDev(
  apps: SubApp[],
  options: WorkspaceDevOptions = {},
): Promise<WorkspaceDevController> {
  const controller = new WorkspaceDevController(apps, options);
  await controller.start();
  return controller;
}

// ========================================================================
// Standalone Dev Mode
// ========================================================================

/**
 * Common entry file candidates for a standalone AsiJS app.
 */
const STANDALONE_ENTRIES = [
  "src/index.ts",
  "src/index.tsx",
  "src/app.ts",
  "src/app.tsx",
  "src/main.ts",
  "src/server.ts",
  "index.ts",
  "index.tsx",
  "app.ts",
  "main.ts",
  "server.ts",
];

/**
 * Find the entry file for a standalone AsiJS app.
 * Scans common locations and checks that the file imports from "asijs".
 *
 * @param cwd - Working directory to search (default: process.cwd())
 * @returns The entry file path, or null if not found
 */
export function findStandaloneEntry(cwd?: string): string | null {
  const root = cwd ?? process.cwd();

  for (const entry of STANDALONE_ENTRIES) {
    const fullPath = join(root, entry);
    if (existsSync(fullPath)) {
      try {
        const content = readFileSync(fullPath, "utf-8");
        // Check if it imports from asijs (heuristic)
        if (/from\s+["']asijs["']/.test(content)) {
          return fullPath;
        }
      } catch {
        continue;
      }
    }
  }

  return null;
}

/**
 * Start dev mode for a standalone app (no workspace).
 *
 * Detects the entry file and spawns `bun --hot` on it,
 * giving the same hot-reload experience as workspace mode
 * but for a single app.
 *
 * @example
 * ```ts
 * import { startStandaloneDev } from "asijs";
 *
 * const controller = await startStandaloneDev();
 * // App runs with bun --hot
 * ```
 *
 * @returns Controller to stop the process
 */
export async function startStandaloneDev(
  options: WorkspaceDevOptions = {},
): Promise<WorkspaceDevController> {
  const cwd = process.cwd();
  const entry = findStandaloneEntry(cwd);

  if (!entry) {
    throw new Error(
      "No AsiJS app found. Create one with `bunx asijs create my-app` " +
      "or ensure your entry file (src/index.ts) imports from \"asijs\".",
    );
  }

  const app: SubApp = {
    name: basename(cwd),
    entryPoint: entry,
    rootDir: cwd,
    port: options.basePort ?? 3000,
    process: null,
    status: "stopped",
  };

  return startWorkspaceDev([app], {
    ...options,
    basePort: options.basePort ?? 3000,
    verbose: options.verbose ?? true,
  });
}

// ========================================================================
// Convenience: auto-detect workspace or standalone
// ========================================================================

/**
 * Convenience: auto-detect workspace or standalone, start dev mode.
 *
 * - If a Bun workspace is found with sub-apps, runs them with independent hot-reload.
 * - If no workspace but a standalone AsiJS app is found, runs it with `bun --hot`.
 * - If nothing is found, throws an error.
 *
 * @example
 * ```ts
 * import { asiDev } from "asijs";
 *
 * const controller = await asiDev();
 * // Workspace or standalone — auto-detected
 * ```
 */
export async function asiDev(
  options: WorkspaceDevOptions = {},
): Promise<WorkspaceDevController> {
  // 1. Try workspace mode first
  const apps = scanWorkspace();

  if (apps.length > 0) {
    return startWorkspaceDev(apps, options);
  }

  // 2. Fall back to standalone mode
  return startStandaloneDev(options);
}

/**
 * Controller for managing workspace dev processes.
 */
export class WorkspaceDevController {
  readonly apps: SubApp[];
  readonly options: Required<WorkspaceDevOptions>;
  private _running = false;

  constructor(apps: SubApp[], options: WorkspaceDevOptions = {}) {
    this.apps = apps;
    this.options = {
      basePort: options.basePort ?? 3000,
      apps: options.apps ?? [],
      env: options.env ?? {},
      verbose: options.verbose ?? true,
      rateLimit: options.rateLimit ?? { enabled: false },
    };

    // Assign ports
    let port = this.options.basePort;
    for (const app of this.apps) {
      app.port = port++;
    }
  }

  /**
   * Start all sub-app processes
   */
  async start(): Promise<void> {
    if (this._running) return;
    this._running = true;

    if (this.apps.length === 0) {
      console.log("  No sub-apps to start.");
      return;
    }

    this.printHeader();

    const startPromises = this.apps.map((app) => this.startApp(app));
    await Promise.all(startPromises);

    console.log("");
    console.log("All sub-apps started.");
    console.log("   Press Ctrl+C to stop all.");
    console.log("");
  }

  /**
   * Start a single sub-app as a Bun process with --hot
   */
  private async startApp(app: SubApp): Promise<void> {
    app.status = "starting";

    const verbose = this.options.verbose;
    const env: Record<string, string> = {
      PORT: String(app.port),
      ASIJS_DEV: "1",
      ASIJS_WORKSPACE: "1",
      ASIJS_APP_NAME: app.name,
      ...this.options.env,
    };

    // Inject rate limit env vars if configured
    const rl = this.options.rateLimit;
    if (rl) {
      env.ASIJS_RATE_LIMIT_ENABLED = rl.enabled !== false ? "1" : "0";
      if (rl.max !== undefined) {
        env.ASIJS_RATE_LIMIT_MAX = String(rl.max);
      }
      if (rl.windowMs !== undefined) {
        env.ASIJS_RATE_LIMIT_WINDOW_MS = String(rl.windowMs);
      }
    }

    const fullEnv = { ...(process.env as Record<string, string>), ...env };

    if (verbose) {
      console.log(
        "  Running " + app.name + " on http://localhost:" + app.port,
      );
      console.log("     Entry: " + relative(process.cwd(), app.entryPoint));
    }

    try {
      const proc = Bun.spawn(
        ["bun", "--hot", app.entryPoint],
        {
          cwd: app.rootDir,
          env: fullEnv,
          stdio: ["ignore", "inherit", "inherit"],
          onExit: (_proc: any, exitCode: number | null, signalCode: number | null) => {
            if (exitCode !== null && exitCode !== 0) {
              // Non-zero exit — could be a crash or explicit kill
              if (signalCode === 15 || signalCode === 2 || signalCode === 1) {
                // SIGTERM(15), SIGINT(2), SIGHUP(1) — expected shutdown
                return;
              }
              app.status = "error";
              app.lastError = "Exited with code " + exitCode +
                (signalCode != null ? " (signal " + signalCode + ")" : "");
              if (verbose) {
                console.error("  [" + app.name + "] crashed with code " + exitCode);
              }
            }
          },
        },
      );

      app.process = {
        process: proc,
        pid: proc.pid,
        startedAt: new Date(),
        restartCount: 0,
      };
      app.status = "running";
    } catch (error) {
      app.status = "error";
      app.lastError = String(error);
      console.error("  Failed to start " + app.name + ":", error);
    }
  }

  /**
   * Kill a sub-app process
   */
  private killProcess(app: SubApp): void {
    if (app.process) {
      try {
        (app.process.process as any).kill();
      } catch {
        // Already dead
      }
      app.process = null;
    }
    app.status = "stopped";
  }

  /**
   * Restart a single sub-app
   */
  async restartApp(name: string): Promise<void> {
    const app = this.apps.find((a) => a.name === name);
    if (!app) {
      throw new Error("Sub-app \"" + name + "\" not found");
    }

    if (this.options.verbose) {
      console.log("  Restarting " + app.name + "...");
    }

    this.killProcess(app);
    await this.startApp(app);
  }

  /**
   * Stop all sub-app processes
   */
  async stop(): Promise<void> {
    if (!this._running) return;
    this._running = false;

    if (this.options.verbose) {
      console.log("");
      console.log("Stopping all sub-apps...");
    }

    for (const app of this.apps) {
      this.killProcess(app);
    }

    if (this.options.verbose) {
      console.log("All sub-apps stopped.");
      console.log("");
    }
  }

  /**
   * Get running status
   */
  get running(): boolean {
    return this._running;
  }

  /**
   * Print startup header
   */
  private printHeader(): void {
    const wsName = basename(process.cwd());
    console.log("");
    console.log("Workspace Dev - " + wsName);
    console.log("   " + this.apps.length + " sub-app(s) with independent hot-reload");
    console.log("");
  }
}
