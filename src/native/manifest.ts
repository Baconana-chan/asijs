/**
 * Native / Polyglot Modules — manifest (1.1)
 *
 * The manifest is the single source of truth for a native module:
 * which functions are exported, their parameter/return types, and the
 * language they are implemented in. From this one file AsiJS generates
 * both sides of the boundary:
 *   - Rust (or Go/C/Zig) stubs with `#[no_mangle]` + serde marshalling
 *   - TypeScript `bun:ffi` wrappers with typed signatures
 *
 * The user writes only the function bodies; everything else is generated.
 *
 * @example
 * ```json
 * // native/manifest.json
 * {
 *   "name": "crypto-native",
 *   "lang": "rust",
 *   "functions": [
 *     { "name": "sha256", "params": { "input": "string" }, "returns": "string" }
 *   ]
 * }
 * ```
 */

import { existsSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { Type, type TSchema, type Static } from "@sinclair/typebox";

// ============================================================================
// Types
// ============================================================================

/** Supported primitive types for the JSON boundary (v1). */
export type NativeTypeName =
  | "string"
  | "number"
  | "boolean"
  | "bytes"
  | "json";

/** Supported native module languages. */
export type NativeLanguage =
  | "rust"
  | "go"
  | "c"
  | "cpp"
  | "zig"
  | "nim"
  | "haskell"
  | "python"
  | "ruby"
  | "php"
  | "lua";

/** Languages that run as sidecar processes (JSON-RPC over stdio), not FFI. */
export const SIDECAR_LANGUAGES = ["python", "ruby", "php"] as const;

/** Whether a language is executed as a sidecar process rather than dlopen'd. */
export function isSidecarLanguage(lang: NativeLanguage): boolean {
  return (SIDECAR_LANGUAGES as readonly string[]).includes(lang);
}

/**
 * Languages that run as an embedded interpreter: the runtime dlopen's the
 * interpreter's own shared library (e.g. liblua) and drives it through its
 * C API in-process. No compilation, no separate process (Lua, first).
 */
export const EMBEDDED_LANGUAGES = ["lua"] as const;

/** Whether a language is an embedded interpreter rather than FFI/sidecar. */
export function isEmbeddedLanguage(lang: NativeLanguage): boolean {
  return (EMBEDDED_LANGUAGES as readonly string[]).includes(lang);
}

/** JSON boundary value — strings and numbers are passed directly. */
export type NativeValue =
  | string
  | number
  | boolean
  | Uint8Array
  | null
  | undefined
  | Record<string, unknown>
  | NativeValue[];

/** A single exported function declared in the manifest. */
export interface NativeFunction {
  /** Function name — identifier-safe (alphanumeric + underscore). */
  name: string;
  /** Parameter map: name → type. Empty object = no params. */
  params: Record<string, NativeTypeName>;
  /** Return type. */
  returns: NativeTypeName;
}

/** Native module manifest (mirrors native/manifest.json). */
export interface NativeManifest {
  /** Module name (identifier-safe, used in generated code). */
  name: string;
  /** Implementation language. */
  lang: NativeLanguage;
  /** Optional path to the native source dir (default: "native"). */
  sourceDir?: string;
  /** Exported functions. */
  functions: NativeFunction[];
}

// ============================================================================
// TypeBox schemas (validation)
// ============================================================================

const nativeTypeSchema = Type.Union([
  Type.Literal("string"),
  Type.Literal("number"),
  Type.Literal("boolean"),
  Type.Literal("bytes"),
  Type.Literal("json"),
]);

const nativeFunctionSchema = Type.Object({
  name: Type.String({ pattern: "^[a-zA-Z_][a-zA-Z0-9_]*$" }),
  params: Type.Record(Type.String(), nativeTypeSchema),
  returns: nativeTypeSchema,
});

const nativeManifestSchema = Type.Object({
  name: Type.String({ pattern: "^[a-zA-Z_][a-zA-Z0-9_]*$" }),
  lang: Type.Union([
    Type.Literal("rust"),
    Type.Literal("go"),
    Type.Literal("c"),
    Type.Literal("cpp"),
    Type.Literal("zig"),
    Type.Literal("nim"),
    Type.Literal("haskell"),
    Type.Literal("python"),
    Type.Literal("ruby"),
    Type.Literal("php"),
    Type.Literal("lua"),
  ]),
  sourceDir: Type.Optional(Type.String()),
  functions: Type.Array(nativeFunctionSchema),
});

/** Static type derived from the TypeBox schema (kept in sync). */
export type NativeManifestSchema = Static<typeof nativeManifestSchema>;

// ============================================================================
// Validation helpers
// ============================================================================

/** Validate a manifest object; returns a list of human-readable errors. */
export function validateManifest(input: unknown): string[] {
  const errors: string[] = [];
  if (typeof input !== "object" || input === null) {
    return ["manifest must be an object"];
  }
  const obj = input as Record<string, unknown>;

  if (typeof obj.name !== "string" || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(obj.name)) {
    errors.push(
      `name must be an identifier (got ${JSON.stringify(obj.name)})`,
    );
  }

  const langs: NativeLanguage[] = [
    "rust",
    "go",
    "c",
    "cpp",
    "zig",
    "nim",
    "haskell",
    "python",
    "ruby",
    "php",
    "lua",
  ];
  if (!langs.includes(obj.lang as NativeLanguage)) {
    errors.push(`lang must be one of: ${langs.join(", ")} (got ${JSON.stringify(obj.lang)})`);
  }

  if (!Array.isArray(obj.functions)) {
    errors.push("functions must be an array");
  } else {
    const names = new Set<string>();
    for (let i = 0; i < obj.functions.length; i++) {
      const fn = obj.functions[i] as Record<string, unknown> | undefined;
      if (typeof fn !== "object" || fn === null) {
        errors.push(`functions[${i}] must be an object`);
        continue;
      }
      if (typeof fn.name !== "string" || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(fn.name)) {
        errors.push(`functions[${i}].name must be an identifier`);
      } else if (names.has(fn.name)) {
        errors.push(`functions[${i}].name "${fn.name}" is duplicated`);
      } else {
        names.add(fn.name);
      }
      if (typeof fn.params !== "object" || fn.params === null) {
        errors.push(`functions[${i}].params must be an object`);
      } else {
        for (const [pname, ptype] of Object.entries(fn.params)) {
          if (!isNativeTypeName(ptype)) {
            errors.push(
              `functions[${i}].params.${pname} invalid type ${JSON.stringify(ptype)}`,
            );
          }
        }
      }
      if (!isNativeTypeName(fn.returns)) {
        errors.push(`functions[${i}].returns invalid type ${JSON.stringify(fn.returns)}`);
      }
    }
  }

  return errors;
}

function isNativeTypeName(v: unknown): v is NativeTypeName {
  return ["string", "number", "boolean", "bytes", "json"].includes(v as string);
}

/** Validate and normalize a manifest object; throws with a clear message. */
export function parseManifest(input: unknown): NativeManifest {
  const errors = validateManifest(input);
  if (errors.length > 0) {
    throw new Error(`Invalid native manifest:\n  - ${errors.join("\n  - ")}`);
  }
  const obj = input as Record<string, unknown>;
  return {
    name: obj.name as string,
    lang: obj.lang as NativeLanguage,
    sourceDir: (obj.sourceDir as string | undefined) ?? "native",
    functions: (obj.functions as NativeFunction[]).map((f) => ({
      name: f.name,
      params: { ...f.params },
      returns: f.returns,
    })),
  };
}

// ============================================================================
// Loading
// ============================================================================

/** Default manifest file name. */
export const MANIFEST_FILE = "manifest.json";

/** Default native source directory (relative to project root). */
export const DEFAULT_SOURCE_DIR = "native";

/**
 * Locate the native module root in a project.
 * Precedence: explicit path → `<cwd>/native/` with manifest.json → `<cwd>/native.json`.
 */
export function findNativeRoot(cwd: string): string | null {
  const candidates = [join(cwd, DEFAULT_SOURCE_DIR), cwd];
  for (const dir of candidates) {
    if (existsSync(join(dir, MANIFEST_FILE))) return dir;
  }
  // Also allow a standalone manifest at the project root
  if (existsSync(join(cwd, "native.json"))) return cwd;
  return null;
}

/** Load and parse the manifest from a native root directory. */
export async function loadManifest(nativeRoot: string): Promise<NativeManifest> {
  const manifestPath = join(nativeRoot, MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    throw new Error(
      `Native manifest not found at ${manifestPath} — run "asi native scaffold <lang>" first`,
    );
  }
  const raw = JSON.parse(await readFile(manifestPath, "utf-8")) as unknown;
  return parseManifest(raw);
}

/** Write a manifest to the native root. */
export async function writeManifest(
  nativeRoot: string,
  manifest: NativeManifest,
): Promise<void> {
  await writeFile(
    join(nativeRoot, MANIFEST_FILE),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf-8",
  );
}

// ============================================================================
// Language auto-detection
// ============================================================================

/**
 * Detect the module language from the contents of a directory.
 * Precedence: Cargo.toml → rust, go.mod → go, *.zig → zig, *.c → c,
 * then sidecar scripts server.py / server.rb / server.php.
 * Returns null when nothing recognizable is found.
 */
export function detectLanguage(dir: string): NativeLanguage | null {
  if (existsSync(join(dir, "Cargo.toml"))) return "rust";
  if (existsSync(join(dir, "go.mod"))) return "go";
  if (existsSync(join(dir, "build.zig")) || existsSync(join(dir, "build.zig.zon"))) {
    return "zig";
  }
  if (existsSync(join(dir, "lib.nim"))) return "nim";
  if (existsSync(join(dir, "lib.hs"))) return "haskell";
  if (existsSync(join(dir, "server.py"))) return "python";
  if (existsSync(join(dir, "server.rb"))) return "ruby";
  if (existsSync(join(dir, "server.php"))) return "php";
  if (existsSync(join(dir, "lib.lua"))) return "lua";
  return null;
}

/** Rust-compatible type name for a boundary type (used in generated stubs). */
export function rustTypeName(t: NativeTypeName): string {
  switch (t) {
    case "string":
      return "String";
    case "number":
      return "f64";
    case "boolean":
      return "bool";
    case "bytes":
      return "Vec<u8>";
    case "json":
      return "serde_json::Value";
  }
}

/** TS (bun:ffi) type name for a boundary type (used in generated wrappers). */
export function tsTypeName(t: NativeTypeName): string {
  switch (t) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "bytes":
      return "Uint8Array";
    case "json":
      return "unknown";
  }
}

/** Whether a manifest name is a valid JS/Rust identifier. */
export function isValidIdentifier(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}
