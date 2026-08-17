/**
 * asi upgrade — Automatic Upgrade for AsiJS
 *
 * - Checks the latest published version on the npm registry
 * - Compares against the installed version
 * - Updates package.json dependency (with --dry-run support)
 * - Optionally runs the codemod for breaking changes between major versions
 *
 * @example
 * ```ts
 * import { checkForUpdates, upgradeProject } from "asijs";
 *
 * const update = await checkForUpdates(process.cwd());
 * if (update.updateAvailable) console.log(update.latest);
 * ```
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

// ============================================================================
// Types
// ============================================================================

/** Result of an update check (current/latest, up-to-date flag). */
export interface UpdateCheck {
  /** Currently installed version (from package.json), or null */
  installed: string | null;
  /** Latest version on the npm registry */
  latest: string | null;
  /** True when latest > installed */
  updateAvailable: boolean;
  /** Whether the update crosses a major version boundary */
  majorBump: boolean;
  /** Human-readable message */
  message: string;
}

/** Options for `upgrade()` (target, dry-run, offline). */
export interface UpgradeOptions {
  /** Project root (default: process.cwd()) */
  cwd?: string;
  /** Print planned changes without writing (default: false) */
  dryRun?: boolean;
  /** Run the codemod for breaking changes after updating (default: false) */
  runCodemod?: boolean;
  /** Registry URL override (default: https://registry.npmjs.org) */
  registry?: string;
  /** Skip network lookups — use "latest" specifier (default: false) */
  offline?: boolean;
}

/** Result of an upgrade (applied specifier, diff, warnings). */
export interface UpgradeResult {
  /** Final package.json asijs specifier */
  newSpecifier: string;
  updated: boolean;
  codemodRun: boolean;
  message: string;
}

// ============================================================================
// Version helpers
// ============================================================================

/** Parse a semver string into { major, minor, patch } */
export function parseVersion(v: string): { major: number; minor: number; patch: number } {
  const cleaned = v.replace(/^[^0-9]*/, "").split("-")[0]!;
  const [major, minor, patch] = cleaned.split(".").map((n) => parseInt(n, 10) || 0);
  return { major: major ?? 0, minor: minor ?? 0, patch: patch ?? 0 };
}

/** Compare two versions: >0 if a newer, <0 if older, 0 if equal */
export function compareVersions(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (va.major !== vb.major) return va.major - vb.major;
  if (va.minor !== vb.minor) return va.minor - vb.minor;
  return va.patch - vb.patch;
}

/** Extract a plain version from a semver range specifier ("^1.2.3" → "1.2.3") */
export function versionFromRange(specifier: string): string | null {
  const m = specifier.match(/\d+\.\d+\.\d+/);
  return m ? m[0] : null;
}

// ============================================================================
// Registry lookup
// ============================================================================

/**
 * Fetch the latest published version of a package from the npm registry.
 * Returns null on failure (offline / no registry).
 */
export async function fetchLatestVersion(
  packageName = "asijs",
  registry = "https://registry.npmjs.org",
): Promise<string | null> {
  try {
    const res = await fetch(`${registry}/${packageName}/latest`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Check whether an update is available for the project's asijs dependency.
 *
 * @param offline - skip network lookup (returns updateAvailable: false)
 */
export async function checkForUpdates(
  cwd = process.cwd(),
  options: { offline?: boolean; registry?: string } = {},
): Promise<UpdateCheck> {
  const pkgPath = join(cwd, "package.json");
  let installed: string | null = null;

  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      const spec =
        pkg.dependencies?.asijs ??
        pkg.devDependencies?.asijs ??
        pkg.peerDependencies?.asijs;
      installed = spec ? (versionFromRange(spec) ?? spec) : null;
    } catch {
      installed = null;
    }
  }

  const latest = options.offline ? null : await fetchLatestVersion("asijs", options.registry);

  if (!latest) {
    return {
      installed,
      latest: null,
      updateAvailable: false,
      majorBump: false,
      message: installed
        ? `asijs ${installed} installed — could not check registry (offline?).`
        : "asijs is not installed in this project.",
    };
  }

  if (!installed) {
    return {
      installed: null,
      latest,
      updateAvailable: true,
      majorBump: false,
      message: `asijs is not installed. Latest: ${latest}.`,
    };
  }

  const diff = compareVersions(latest, installed);
  const majorBump = parseVersion(latest).major > parseVersion(installed).major;

  return {
    installed,
    latest,
    updateAvailable: diff > 0,
    majorBump,
    message:
      diff > 0
        ? `Update available: asijs ${installed} → ${latest}${majorBump ? " (major version bump)" : ""}`
        : `asijs ${installed} is up to date (latest ${latest}).`,
  };
}

// ============================================================================
// Upgrade
// ============================================================================

/**
 * Upgrade the project's asijs dependency.
 *
 * - Reads package.json, bumps the asijs specifier to the latest version
 * - Writes the file (unless dryRun)
 * - Optionally runs `bun install` and the codemod
 *
 * @returns Result describing what happened
 */
export async function upgradeProject(options: UpgradeOptions = {}): Promise<UpgradeResult> {
  const cwd = options.cwd ?? process.cwd();
  const pkgPath = join(cwd, "package.json");

  if (!existsSync(pkgPath)) {
    throw new Error("No package.json found in " + cwd);
  }

  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };

  const latest = options.offline
    ? "latest"
    : ((await fetchLatestVersion("asijs", options.registry)) ?? "latest");

  const sections = ["dependencies", "devDependencies", "peerDependencies"] as const;
  let found = false;
  for (const section of sections) {
    if (pkg[section] && pkg[section]!.asijs) {
      pkg[section]!.asijs = latest;
      found = true;
    }
  }

  if (!found) {
    // Not installed — add as a regular dependency
    pkg.dependencies = { ...(pkg.dependencies ?? {}), asijs: latest };
  }

  if (!options.dryRun) {
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  }

  let codemodRun = false;
  if (options.runCodemod && !options.dryRun) {
    try {
      const { runCodemod } = await import("./codemod");
      runCodemod(cwd, { from: "elysia", dryRun: false, verbose: false });
      codemodRun = true;
    } catch {
      // Codemod is best-effort — failure doesn't fail the upgrade
    }
  }

  return {
    newSpecifier: latest,
    updated: found || !options.dryRun,
    codemodRun,
    message:
      options.dryRun
        ? `Would update asijs to ${latest} (dry run — no changes written)`
        : `Updated asijs to ${latest}${codemodRun ? " and ran breaking-changes codemod" : ""}`,
  };
}
