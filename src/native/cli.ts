/**
 * `asi native` CLI commands (P0) — scaffold, build & inspect native modules.
 * Imported by src/cli.ts.
 *
 * Subcommands:
 *   asi native scaffold <lang> [name]  — generate manifest + stubs
 *   asi native build                   — compile the shared library (cargo)
 *   asi native list                    — show declared functions
 *   asi native info                    — manifest summary + staleness
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { spawnSync } from "child_process";
import { join } from "path";
import {
  parseManifest,
  findNativeRoot,
  loadManifest,
  writeManifest,
  DEFAULT_SOURCE_DIR,
  isEmbeddedLanguage,
  isSidecarLanguage,
  type NativeManifest,
  type NativeLanguage,
  type NativeTypeName,
} from "./manifest";
import {
  generateTsWrapper,
  defaultLibPathExpr,
  platformLibExt,
} from "./generate-ts";
import { generateSidecarTsClient } from "./generate-sidecar";
import { generateLuaTsClient } from "./generate-lua";
import { findLuaLib } from "./lang/lua";
import {
  isStale,
  markBuilt,
  loadNativeModule,
  type DLOpenLike,
  type NativeModule,
} from "./runtime";
import { getGenerator, supportedLanguages } from "./generators";

function c() {
  return {
    bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
    dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
    red: (s: string) => `\x1b[31m${s}\x1b[0m`,
    green: (s: string) => `\x1b[32m${s}\x1b[0m`,
    yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
    cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  };
}

/** Default example manifest used by `asi native scaffold rust`. */
function exampleManifest(name: string): NativeManifest {
  return {
    name,
    lang: "rust",
    functions: [
      {
        name: "add",
        params: { a: "number", b: "number" },
        returns: "number",
      },
      {
        name: "sha256",
        params: { input: "string" },
        returns: "string",
      },
      {
        name: "reverse",
        params: { input: "string" },
        returns: "string",
      },
    ],
  };
}

/** Entry point: `asi native <subcommand> [options]`. */
export async function handleNative(args: string[]): Promise<void> {
  const col = c();
  const sub = args[0];

  if (!sub || sub === "--help" || sub === "-h") {
    console.log(`\n${col.bold("AsiJS Native")} — native / polyglot modules\n`);
    console.log(`${col.bold("Usage:")}`);
    console.log(`  asi native scaffold <lang> [name]   Generate a native module (${supportedLanguages().join("|")})`);
    console.log(`  asi native build [--force]          Compile the shared library`);
    console.log(`  asi native test                     Smoke-run every declared function`);
    console.log(`  asi native list                     List declared native functions`);
    console.log(`  asi native info                     Manifest summary + staleness`);
    console.log();
    console.log(`${col.bold("Example:")}`);
    console.log(`  asi native scaffold rust my-crypto`);
    console.log(`  cd native && cargo build --release   # or: asi native build`);
    console.log(`  # then in your app:`);
    console.log(`  app.use(native({ cwd: process.cwd() }));`);
    console.log(`  const h = await ctx.native.sha256("hello");`);
    console.log();
    return;
  }

  switch (sub) {
    case "scaffold":
    case "new": {
      await nativeScaffold(args.slice(1));
      return;
    }
    case "build": {
      await nativeBuild(args.slice(1));
      return;
    }
    case "list":
    case "ls": {
      await nativeList(args.slice(1));
      return;
    }
    case "info": {
      await nativeInfo(args.slice(1));
      return;
    }
    case "test": {
      await nativeTest(args.slice(1));
      return;
    }
    default:
      console.error(`  ${col.red("Unknown native subcommand:")} ${sub}`);
      process.exitCode = 1;
  }
}

/** `asi native scaffold <lang> [name]` — generate manifest + stubs. */
async function nativeScaffold(args: string[]): Promise<void> {
  const col = c();
  const lang = args[0] as NativeLanguage | undefined;
  const name = args[1];

  if (!lang) {
    console.error(`  ${col.red("Missing language:")} asi native scaffold <${supportedLanguages().join("|")}> [name]`);
    process.exitCode = 1;
    return;
  }
  const langs = supportedLanguages();
  if (!langs.includes(lang as NativeLanguage)) {
    console.error(`  ${col.red(`Unsupported language "${lang}":`)} use one of ${langs.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  const generator = getGenerator(lang as NativeLanguage);

  const cwd = process.cwd();
  const moduleName = name ?? "native-module";
  const nativeRoot = join(cwd, DEFAULT_SOURCE_DIR);

  if (existsSync(join(nativeRoot, "manifest.json"))) {
    console.error(`  ${col.yellow("Native module already exists")} at ${nativeRoot} — not overwriting.`);
    process.exitCode = 1;
    return;
  }

  mkdirSync(join(nativeRoot, "src"), { recursive: true });

  const manifest: NativeManifest = exampleManifest(
    moduleName.replace(/[^a-zA-Z0-9_]/g, "_"),
  );
  manifest.lang = lang as NativeLanguage;

  await writeManifest(nativeRoot, manifest);

  // Write generator files (Cargo.toml, lib.rs, go.mod, main.go, …)
  for (const file of generator.files(manifest)) {
    writeFileSync(join(nativeRoot, file.path), file.content, "utf-8");
  }
  // Typed wrapper: bun:ffi for compiled, sidecar client for interpreted,
  // embedded-lua client for the in-process interpreter
  const isSidecar = isSidecarLanguage(manifest.lang);
  const isEmbedded = isEmbeddedLanguage(manifest.lang);
  const wrapper =
    isSidecar
      ? generateSidecarTsClient(manifest)
      : isEmbedded
        ? generateLuaTsClient(manifest)
        : generateTsWrapper(manifest, defaultLibPathExpr(manifest));
  writeFileSync(join(nativeRoot, "src", "generated.ts"), wrapper, "utf-8");

  console.log(`\n  ${col.green("✓ Native module scaffolded")} at ${nativeRoot}\n`);
  console.log(`  ${col.bold("Files:")}`);
  console.log(`    manifest.json       — functions & types (edit to add more)`);
  for (const file of generator.files(manifest)) {
    console.log(`    ${file.path.padEnd(20)} — fill in the TODO bodies`);
  }
  console.log(`    src/generated.ts    — typed ${isSidecar ? "sidecar client" : isEmbedded ? "embedded Lua client" : "bun:ffi wrapper"} (auto)`);
  console.log();
  console.log(`  ${col.bold("Next:")}`);
  console.log(`    1. Implement the functions in native/${generator.stubFile}`);
  if (isSidecar) {
    console.log(`    2. No build step — AsiJS spawns ${generator.toolchain.cmd} automatically`);
  } else if (isEmbedded) {
    console.log(`    2. No build step — AsiJS embeds liblua (dlopen) automatically`);
  } else {
    console.log(`    2. ${col.cyan("asi native build")} — compiles with ${generator.toolchain.cmd}`);
  }
  console.log(`    3. In your app: app.use(native({ cwd: process.cwd() }))`);
  console.log();
}

/** `asi native build [--force]` — compile the shared library. */
async function nativeBuild(args: string[]): Promise<void> {
  const col = c();
  const force = args.includes("--force");
  const cwd = process.cwd();
  const nativeRoot = findNativeRoot(cwd);

  if (!nativeRoot) {
    console.error(`  ${col.red("No native module found")} — run "asi native scaffold rust" first.`);
    process.exitCode = 1;
    return;
  }

  let manifest: NativeManifest;
  try {
    manifest = await loadManifest(nativeRoot);
  } catch (e) {
    console.error(`  ${col.red("Invalid manifest:")} ${(e as Error).message}`);
    process.exitCode = 1;
    return;
  }

  if (!force && !isStale(nativeRoot, manifest)) {
    console.log(`  ${col.dim("Native module is up to date — nothing to build.")}`);
    return;
  }

  const generator = getGenerator(manifest.lang);

  // Check toolchain availability
  const toolchainCheck = spawnSync(generator.toolchain.cmd, generator.toolchain.args, {
    encoding: "utf-8",
  });
  if (toolchainCheck.status !== 0) {
    console.error(
      `  ${col.red(`${generator.toolchain.cmd} not found`)} — ${generator.toolchain.hint}`,
    );
    process.exitCode = 1;
    return;
  }

  // Sidecar languages have no compile step — the interpreter runs the script.
  // Embedded interpreters (lua) also need no compile — AsiJS dlopens liblua.
  if (generator.kind === "sidecar" || generator.kind === "embedded") {
    markBuilt(nativeRoot);
    if (generator.kind === "embedded") {
      if (!findLuaLib()) {
        console.error(
          `  ${col.yellow("⚠  liblua not found")} — the script will load but calls will fail until Lua is installed.`,
        );
        console.error(
          `    MSYS2: pacman -S mingw-w64-ucrt-x86_64-lua · or set ASI_LUA_LIB=/path/to/lua55.dll`,
        );
        process.exitCode = 1;
        return;
      }
      console.log(`  ${col.green("✓ Embedded interpreter ready")} — ${manifest.lang} needs no compilation;`);
      console.log(`    AsiJS dlopens liblua to run native/${generator.stubFile} in-process.`);
    } else {
      console.log(`  ${col.green("✓ Sidecar ready")} — ${manifest.lang} needs no compilation;`);
      console.log(`    AsiJS spawns ${generator.toolchain.cmd} to run native/${generator.stubFile} directly.`);
    }
    return;
  }

  console.log(`  ${col.dim(`Building ${manifest.name} (${manifest.lang})…`)}`);
  const build = generator.build(manifest);
  // GHC (and a few other toolchains) refuse `-o target/release/...` when the
  // directory does not exist — create it up front for every language.
  mkdirSync(join(nativeRoot, "target", "release"), { recursive: true });
  const result = spawnSync(build.cmd, build.args, {
    cwd: nativeRoot,
    encoding: "utf-8",
  });

  if (result.status !== 0) {
    console.error(`  ${col.red("Build failed:")}`);
    console.error(result.stderr || result.stdout || "  (no output)");
    process.exitCode = 1;
    return;
  }

  markBuilt(nativeRoot);

  const libPath = join(
    nativeRoot,
    "target",
    "release",
    `${generator.libBaseName(manifest)}${platformLibExt()}`,
  );
  console.log(`  ${col.green("✓ Build succeeded")}`);
  console.log(`    ${col.dim(libPath)}`);
  console.log(`    Use it in your app: app.use(native({ cwd: process.cwd() }))`);
}

/** `asi native list` — show declared functions. */
async function nativeList(_args: string[]): Promise<void> {
  const col = c();
  const nativeRoot = findNativeRoot(process.cwd());
  if (!nativeRoot) {
    console.error(`  ${col.red("No native module found")} — run "asi native scaffold rust" first.`);
    process.exitCode = 1;
    return;
  }

  let manifest: NativeManifest;
  try {
    manifest = await loadManifest(nativeRoot);
  } catch (e) {
    console.error(`  ${col.red("Invalid manifest:")} ${(e as Error).message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n  ${col.bold(manifest.name)} (${manifest.lang}) — ${manifest.functions.length} function(s)\n`);
  for (const fn of manifest.functions) {
    const params = Object.entries(fn.params)
      .map(([n, t]) => `${n}: ${t}`)
      .join(", ");
    console.log(`    ${col.cyan(fn.name)}(${params}) -> ${fn.returns}`);
  }
  console.log();
}

/** `asi native test` — smoke-run every declared function with sample args. */
async function nativeTest(_args: string[]): Promise<void> {
  const col = c();
  const nativeRoot = findNativeRoot(process.cwd());
  if (!nativeRoot) {
    console.error(`  ${col.red("No native module found")} — run "asi native scaffold <lang>" first.`);
    process.exitCode = 1;
    return;
  }

  let manifest: NativeManifest;
  try {
    manifest = await loadManifest(nativeRoot);
  } catch (e) {
    console.error(`  ${col.red("Invalid manifest:")} ${(e as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const results = await runNativeTest(manifest, { cwd: process.cwd() });
  let passed = 0;
  let stubs = 0;
  let failed = 0;

  console.log(`\n  ${col.bold(`${manifest.name} (${manifest.lang})`)} — ${manifest.functions.length} function(s)\n`);
  for (const r of results) {
    if (r.status === "pass") {
      passed++;
      console.log(`    ${col.green("✓")} ${col.cyan(r.name)} -> ${r.result}`);
    } else if (r.status === "stub") {
      stubs++;
      console.log(`    ${col.yellow("◌")} ${col.cyan(r.name)} — TODO stub (${r.error})`);
    } else {
      failed++;
      console.log(`    ${col.red("✗")} ${col.cyan(r.name)} — ${r.error}`);
    }
  }
  console.log();
  console.log(`    ${col.green(`${passed} pass`)} · ${col.yellow(`${stubs} stub`)} · ${col.red(`${failed} fail`)}`);
  console.log();

  if (failed > 0) process.exitCode = 1;
}

// ============================================================================
// Programmatic smoke test (used by `asi native test` and tests)
// ============================================================================

/** Sample argument for a boundary type (used by the smoke test). */
export function sampleNativeArg(type: NativeTypeName): unknown {
  switch (type) {
    case "string":
      return "hello";
    case "number":
      return 1;
    case "boolean":
      return true;
    case "bytes":
      return new Uint8Array([1, 2, 3]);
    case "json":
      return { test: true };
  }
}

/** Result of a single smoke-test function. */
export interface NativeTestResult {
  name: string;
  status: "pass" | "stub" | "fail";
  result?: unknown;
  error?: string;
}

/** Options for `runNativeTest`. */
export interface NativeTestOptions {
  /** Project root (default: process.cwd()). */
  cwd?: string;
  /** Injectable dlopen for FFI modules (tests). */
  dlopen?: DLOpenLike;
}

/** Compact display form of a result value. */
function summarize(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return `Uint8Array(${value.length})`;
  }
  if (typeof value === "string" && value.length > 60) {
    return `${value.slice(0, 57)}…`;
  }
  return value;
}

/**
 * Smoke-run every function declared in the manifest with sample arguments.
 * `pass` = returned a value, `stub` = threw NotImplemented (TODO body),
 * `fail` = any other error. Used by `asi native test` and tests.
 */
export async function runNativeTest(
  manifest: NativeManifest,
  opts: NativeTestOptions = {},
): Promise<NativeTestResult[]> {
  const module = loadNativeModule(manifest, { cwd: opts.cwd }, opts.dlopen);
  const results: NativeTestResult[] = [];

  for (const fn of manifest.functions) {
    const args = Object.values(fn.params).map(sampleNativeArg);
    try {
      const value = await module[fn.name](...args);
      results.push({ name: fn.name, status: "pass", result: summarize(value) });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes("implement ")) {
        results.push({ name: fn.name, status: "stub", error: message });
      } else {
        results.push({ name: fn.name, status: "fail", error: message });
      }
    }
  }

  // release sidecar processes
  const withClose = module as NativeModule & { close?: () => void };
  try {
    withClose.close?.();
  } catch {
    // ignore
  }
  return results;
}

/** `asi native info` — manifest summary + staleness. */
async function nativeInfo(_args: string[]): Promise<void> {
  const col = c();
  const nativeRoot = findNativeRoot(process.cwd());
  if (!nativeRoot) {
    console.error(`  ${col.red("No native module found")} — run "asi native scaffold rust" first.`);
    process.exitCode = 1;
    return;
  }

  let manifest: NativeManifest;
  try {
    manifest = await loadManifest(nativeRoot);
  } catch (e) {
    console.error(`  ${col.red("Invalid manifest:")} ${(e as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const stale = isStale(nativeRoot, manifest);
  const types = new Set<string>();
  for (const fn of manifest.functions) {
    types.add(fn.returns);
    for (const t of Object.values(fn.params)) types.add(t);
  }

  console.log(`\n  ${col.bold("Native module")}`);
  console.log(`    name:        ${manifest.name}`);
  console.log(`    language:    ${manifest.lang}`);
  console.log(`    functions:   ${manifest.functions.length}`);
  console.log(`    types:       ${Array.from(types).join(", ")}`);
  console.log(`    build state: ${stale ? col.yellow("stale (run asi native build)") : col.green("up to date")}`);
  console.log();
}
