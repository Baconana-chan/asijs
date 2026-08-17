#!/usr/bin/env node
/**
 * miyocss CLI
 *
 * Usage:
 *   miyocss info                 # Resolve config, validate, print token stats
 *   miyocss info --config path   # Use a specific config file
 *   miyocss info --cwd dir       # Run as if in another directory
 *   miyocss info --json          # Machine-readable JSON output
 *   miyocss --help               # Help
 *
 * The `info` command doubles as a smoke check of the 0.2 config chain:
 * loads the user config (if any), validates it with the same TypeBox
 * schemas used at runtime, resolves tokens and prints statistics.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  VERSION,
  defineConfig,
  resolveConfig,
  resolveDefaultConfig,
  staticUtilityNames,
  purgeDirectory,
  type MiyoConfig,
  type ResolvedConfig,
} from "./core";

// ===== Config loading =====

const CONFIG_NAMES = [
  "miyocss.config.ts",
  "miyocss.config.js",
  "miyocss.config.mjs",
  "miyocss.config.cjs",
  "miyocss.config.json",
];

export interface LoadedConfig {
  /** Raw user config, if a file was found and produced one. */
  config?: MiyoConfig;
  /** Path of the loaded config file, if any. */
  source?: string;
  /** True when the file was found but exported nothing usable. */
  empty?: boolean;
}

/** Locate the config file: explicit flag first, then conventional names. */
export function findConfigFile(cwd: string, explicit?: string): string | null {
  if (explicit) {
    const abs = resolve(cwd, explicit);
    return existsSync(abs) ? abs : null;
  }
  for (const name of CONFIG_NAMES) {
    const path = join(cwd, name);
    if (existsSync(path)) return path;
  }
  return null;
}

/** Load + unwrap a config file. Supports default/named/function exports. */
export async function loadUserConfig(
  file: string,
): Promise<LoadedConfig> {
  if (file.endsWith(".json")) {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    return { config: raw as MiyoConfig, source: file };
  }
  const mod = (await import(pathToFileURL(file).href)) as Record<
    string,
    unknown
  >;
  let exported = mod.default ?? mod.config;
  if (typeof exported === "function") {
    exported = (exported as () => unknown)();
  }
  if (exported === undefined || exported === null) {
    return { source: file, empty: true };
  }
  return { config: exported as MiyoConfig, source: file };
}

// ===== Validation =====

/**
 * Validate a raw config against the same TypeBox schemas used by
 * `defineConfig`. Returns `{ ok: true }` or the first error strings.
 */
export function validateConfig(config: unknown): {
  ok: boolean;
  errors: string[];
} {
  try {
    defineConfig(config as MiyoConfig);
    return { ok: true, errors: [] };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    // "miyocss: invalid config — a; b; c" → ["a", "b", "c"]
    const separator = message.indexOf("— ");
    const body =
      separator === -1 ? message : message.slice(separator + 2);
    return { ok: false, errors: body.split("; ").filter(Boolean) };
  }
}

// ===== Stats =====

export interface TokenStats {
  colors: number;
  colorSamples: string[];
  spacing: number;
  fontFamily: number;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
  borderRadius: number;
  boxShadow: number;
  opacity: number;
  zIndex: number;
  breakpoints: { count: number; names: string[] };
  staticUtilities: number;
  utilitySurface: number;
}

/** Count how many class names the resolved config can generate. */
export function countUtilitySurface(config: ResolvedConfig): number {
  const t = config.theme;
  const spacing = Object.keys(t.spacing);
  const colors = Object.keys(t.colors);

  let count = staticUtilityNames(config).length;

  // colors × (text/bg/border)
  count += colors.length * 3;

  // spacing-driven families
  const pSides = ["p", "px", "py", "pt", "pr", "pb", "pl"];
  const mSides = ["m", "mx", "my", "mt", "mr", "mb", "ml"];
  const gapSides = ["gap", "gap-x", "gap-y"];
  const insetSides = ["inset", "inset-x", "inset-y", "top", "right", "bottom", "left"];
  const negInserts = ["m", "mx", "my", "mt", "mr", "mb", "ml", "inset", "inset-x", "inset-y", "top", "right", "bottom", "left"];
  const perStep =
    pSides.length + mSides.length + gapSides.length + insetSides.length +
    negInserts.length + // negatives
    2; // w-, h-
  count += spacing.length * perStep;
  count += spacing.length * 2; // min/max-w/h

  // token maps, one utility each
  count +=
    Object.keys(t.fontSize).length +
    Object.keys(t.fontWeight).length +
    Object.keys(t.fontFamily).length +
    Object.keys(t.lineHeight).length +
    Object.keys(t.letterSpacing).length +
    Object.keys(t.borderRadius).length + 1 + // rounded (DEFAULT) + bare
    Object.keys(t.boxShadow).length + 1 + // shadow (DEFAULT) + bare
    Object.keys(t.opacity).length +
    Object.keys(t.zIndex).length;

  // grid + fractions
  count += 12 + 12 + 12 + 12 + 2; // cols, rows, col-span, row-span, fulls
  for (let den = 2; den <= 12; den++) count += den - 1; // w fractions

  return count;
}

export interface InfoStats {
  version: string;
  configSource: string | null;
  configValid: boolean;
  errors: string[];
  usingDefaults: boolean;
  stats: TokenStats;
}

/** Resolve config + gather stats + validate. Pure — CLI entry calls this. */
export async function collectInfo(options: {
  cwd: string;
  config?: string;
}): Promise<InfoStats> {
  const file = findConfigFile(options.cwd, options.config);
  let raw: MiyoConfig | undefined;
  let source: string | null = null;
  let usingDefaults = true;
  let configValid = true;
  let errors: string[] = [];

  if (file) {
    source = file;
    const loaded = await loadUserConfig(file);
    if (loaded.empty) {
      errors = ["config file exists but exports no config (no default/named export)"];
      configValid = false;
    } else {
      raw = loaded.config;
    }
  }

  if (raw !== undefined) {
    const check = validateConfig(raw);
    configValid = check.ok;
    errors = check.errors;
    usingDefaults = false;
  }

  const resolved = raw === undefined || !configValid ? resolveDefaultConfig() : resolveConfig(raw);

  return {
    version: VERSION,
    configSource: source,
    configValid,
    errors,
    usingDefaults,
    stats: {
      colors: Object.keys(resolved.theme.colors).length,
      colorSamples: Object.keys(resolved.theme.colors).slice(0, 3),
      spacing: Object.keys(resolved.theme.spacing).length,
      fontFamily: Object.keys(resolved.theme.fontFamily).length,
      fontSize: Object.keys(resolved.theme.fontSize).length,
      fontWeight: Object.keys(resolved.theme.fontWeight).length,
      lineHeight: Object.keys(resolved.theme.lineHeight).length,
      letterSpacing: Object.keys(resolved.theme.letterSpacing).length,
      borderRadius: Object.keys(resolved.theme.borderRadius).length,
      boxShadow: Object.keys(resolved.theme.boxShadow).length,
      opacity: Object.keys(resolved.theme.opacity).length,
      zIndex: Object.keys(resolved.theme.zIndex).length,
      breakpoints: {
        count: Object.keys(resolved.theme.breakpoints).length,
        names: Object.keys(resolved.theme.breakpoints),
      },
      staticUtilities: staticUtilityNames(resolved).length,
      utilitySurface: countUtilitySurface(resolved),
    },
  };
}

// ===== Formatting =====

export function formatInfo(info: InfoStats, json: boolean): string {
  if (json) {
    return JSON.stringify(info, null, 2);
  }

  const lines: string[] = [];
  lines.push(`miyocss info — v${info.version}`);
  lines.push("");

  // Config status
  if (info.configSource) {
    lines.push(`Config: ${info.configSource}`);
    if (info.configValid) {
      lines.push("  status: valid ✓ (TypeBox)");
    } else {
      lines.push("  status: INVALID ✗ — falling back to defaults");
      for (const error of info.errors) {
        lines.push(`    ✗ ${error}`);
      }
    }
  } else {
    lines.push("Config: none found — using built-in defaults");
  }
  if (info.usingDefaults) {
    lines.push("  (no user config — resolveConfig() over defaults)");
  }
  lines.push("");

  // Tokens
  lines.push("Tokens:");
  lines.push(`  colors           ${info.stats.colors}  (${info.stats.colorSamples.join(", ")} …)`);
  lines.push(`  spacing          ${info.stats.spacing} steps`);
  lines.push(`  font-family      ${info.stats.fontFamily}`);
  lines.push(`  font-size        ${info.stats.fontSize}`);
  lines.push(`  font-weight      ${info.stats.fontWeight}`);
  lines.push(`  line-height      ${info.stats.lineHeight}`);
  lines.push(`  letter-spacing   ${info.stats.letterSpacing}`);
  lines.push(`  border-radius    ${info.stats.borderRadius}`);
  lines.push(`  box-shadow       ${info.stats.boxShadow}`);
  lines.push(`  opacity          ${info.stats.opacity}`);
  lines.push(`  z-index          ${info.stats.zIndex}`);
  lines.push(
    `  breakpoints      ${info.stats.breakpoints.count}  (${info.stats.breakpoints.names.join(", ")})`,
  );
  lines.push("");

  // Utilities
  lines.push("Utilities:");
  lines.push(`  static           ${info.stats.staticUtilities}`);
  lines.push(`  estimated total  ${info.stats.utilitySurface}`);
  lines.push("");
  lines.push("Tip: validate a config early — `miyocss info` fails fast,");
  lines.push("     exactly like defineConfig() would at runtime.");

  return lines.join("\n");
}

// ===== miyocss build <dir> =====

export interface BuildStats {
  dir: string;
  out: string;
  files: number;
  classes: number;
  cssFile: string;
  cssHref: string;
  hash: string;
  size: number;
  rewritten: number;
  pruned: number;
}

/** Scan HTML files, collect used classes and write one hashed CSS file. */
export async function buildStatic({
  dir,
  out,
  name,
  minify,
  rewrite,
  config,
}: {
  dir: string;
  out?: string;
  name?: string;
  minify?: boolean;
  rewrite?: boolean;
  config?: string;
}): Promise<BuildStats> {
  // Explicit --config is resolved by the caller (relative to cwd); when absent,
  // fall back to conventional names in the scan dir.
  const file = config ? (existsSync(resolve(config)) ? resolve(config) : null) : findConfigFile(dir);
  const loaded = file ? await loadUserConfig(file) : undefined;
  const raw = loaded?.config;
  const resolved = raw === undefined ? resolveDefaultConfig() : resolveConfig(raw);

  const result = purgeDirectory({
    dir,
    out,
    name,
    minify,
    rewrite: rewrite ?? false,
    config: resolved,
  });

  return {
    dir,
    out: result.file,
    files: result.files,
    classes: result.classes,
    cssFile: result.file,
    cssHref: result.href,
    hash: result.hash,
    size: result.size,
    rewritten: result.files,
    pruned: result.pruned,
  };
}

function formatBuild(stats: BuildStats, json: boolean): string {
  if (json) return JSON.stringify(stats, null, 2);
  return [
    `miyocss build — v${VERSION}`,
    "",
    `  Directory     ${stats.dir}`,
    `  HTML files    ${stats.files}`,
    `  Unique classes ${stats.classes}`,
    `  CSS file      ${stats.cssHref} (${(stats.size / 1024).toFixed(1)} KB)`,
    `  Hash          ${stats.hash}`,
    `  Pruned stale  ${stats.pruned}`,
    "",
    "  Link this file from your pages:",
    `    <link rel="stylesheet" href="${stats.cssHref}">`,
  ].join("\n");
}

// ===== Entry =====

function isMain(): boolean {
  if ((import.meta as { main?: boolean }).main) return true;
  const arg1 = process.argv[1];
  if (!arg1) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(arg1)).href;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      [
        "miyocss — SSR-first CSS + SVG framework",
        "",
        "Usage:",
        "  miyocss info [options]",
        "  miyocss build <dir> [options]",
        "",
        "Options:",
        "  --config <path>  Use a specific config file",
        "  --cwd <dir>      Run as if in another directory",
        "  --out <dir>      Output directory for the CSS (build only)",
        "  --name <stem>    CSS filename stem, default miyocss (build only)",
        "  --no-minify      Keep readable CSS (build only)",
        "  --rewrite        Replace inline <style data-miyocss> with a <link> (build only)",
        "  --json           Machine-readable JSON output",
        "  --help           Show this help",
        "",
        "info: resolves the config, validates it with TypeBox and prints",
        "token statistics. build: scans <dir> for HTML, collects every used",
        "utility class and writes one content-hashed miyocss.<hash>.css.",
      ].join("\n"),
    );
    return;
  }

  const command = args[0] ?? "info";
  const cwdIndex = args.indexOf("--cwd");
  const cwd = cwdIndex !== -1 && args[cwdIndex + 1]
    ? resolve(args[cwdIndex + 1])
    : process.cwd();

  const configIndex = args.indexOf("--config");
  const explicitConfig =
    configIndex !== -1 && args[configIndex + 1]
      ? args[configIndex + 1]
      : undefined;

  const json = args.includes("--json");

  if (command === "build") {
    const dir = resolve(cwd, args[1] ?? ".");
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      console.error(`miyocss: build dir not found: ${dir}`);
      process.exitCode = 1;
      return;
    }
    const outIndex = args.indexOf("--out");
    const out = outIndex !== -1 && args[outIndex + 1]
      ? resolve(cwd, args[outIndex + 1])
      : undefined;
    const nameIndex = args.indexOf("--name");
    const name = nameIndex !== -1 ? args[nameIndex + 1] : undefined;
    const minify = !args.includes("--no-minify");
    const rewrite = args.includes("--rewrite");
    const stats = await buildStatic({
      dir,
      out,
      name,
      minify,
      rewrite,
      config: explicitConfig ? resolve(cwd, explicitConfig) : undefined,
    });
    console.log(formatBuild(stats, json));
    return;
  }

  if (command !== "info") {
    console.error(`miyocss: unknown command "${command}" — try "info" or "build"`);
    process.exitCode = 1;
    return;
  }

  const info = await collectInfo({ cwd, config: explicitConfig });
  console.log(formatInfo(info, json));

  if (!info.configValid) process.exitCode = 1;
}

if (isMain()) {
  main().catch((error) => {
    console.error(`miyocss: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
