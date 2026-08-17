/**
 * toon-asijs — TOON (Token-Oriented Object Notation) adapter for AsiJS.
 *
 * TOON is a token-optimized encoding of the JSON data model designed for
 * LLM/AI clients: indentation instead of braces, tabular forms for uniform
 * arrays — ~30–60% fewer tokens than JSON in typical cases while staying
 * lossless for JSON-serializable values.
 *
 * This package wraps the official `@toon-format/toon` SDK as an AsiJS
 * `DataFormat`, so the formats layer understands TOON natively:
 *
 * ```ts
 * import { Asi } from "asijs";
 * import { registerToonFormat } from "toon-asijs";
 *
 * registerToonFormat();                 // enable TOON for negotiation + parsing
 *
 * const app = new Asi({ format: "toon" });  // default response format = TOON
 * // or: app.setFormat("toon");
 *
 * app.post("/config", async (ctx) => {
 *   const body = await ctx.parseBody();    // Content-Type: application/toon → parsed
 *   return body;                           // serialized to TOON
 * });
 * ```
 *
 * Without AsiJS (plain fetch servers, CLI tools) `createToonFormat()` /
 * `getToonFormat()` still work standalone — they only need `@toon-format/toon`.
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { encode, decode } from "@toon-format/toon";
import type { EncodeOptions, DecodeOptions } from "@toon-format/toon";

// ===== Types =====

/**
 * Structural match for AsiJS `DataFormat` (kept local so this package has no
 * runtime/type dependency on `asijs` — `createToonFormat()` works standalone).
 */
export interface ToonFormat {
  /** Unique format name — "toon". */
  name: string;
  /** MIME types this format speaks (lowercase). */
  contentTypes: string[];
  /** File extensions: [".toon"]. */
  extensions: string[];
  /** Default MIME type used for responses. */
  contentType: string;
  /** Parse TOON wire text into a plain JS value. */
  parse(text: string): unknown;
  /** Serialize a plain JS value into TOON wire text. */
  serialize(value: unknown): string;
}

/** Options passed through to the `@toon-format/toon` SDK. */
export interface ToonFormatOptions {
  /** Spaces per indentation level (SDK default: 2). */
  indentSize?: number;
  /** Delimiter for array values and tabular rows: "," | "\t" | "|" (default ","). */
  delimiter?: "," | "\t" | "|";
  /** Strict decoding — array counts, indentation, duplicate keys (default true). */
  strict?: boolean;
}

// ===== Format =====

/** MIME types TOON speaks. `application/toon` is the canonical one. */
export const TOON_CONTENT_TYPES = [
  "application/toon",
  "text/toon",
  "application/x-toon",
] as const;

/** Canonical response MIME type. */
export const TOON_CONTENT_TYPE = "application/toon";

/** File extensions. */
export const TOON_EXTENSIONS = [".toon"] as const;

/**
 * Create a TOON `DataFormat`. Pure — only needs `@toon-format/toon`, usable
 * with any server or CLI without AsiJS.
 *
 * @param options — passthrough encode/decode options (indentSize, delimiter, strict)
 */
export function createToonFormat(options: ToonFormatOptions = {}): ToonFormat {
  const encodeOptions: EncodeOptions | undefined =
    options.indentSize !== undefined || options.delimiter !== undefined
      ? { indentSize: options.indentSize, delimiter: options.delimiter }
      : undefined;
  const decodeOptions: DecodeOptions | undefined =
    options.strict !== undefined ? { strict: options.strict } : undefined;

  return {
    name: "toon",
    contentTypes: [...TOON_CONTENT_TYPES],
    extensions: [...TOON_EXTENSIONS],
    contentType: TOON_CONTENT_TYPE,
    parse: (text: string) => decode(text, decodeOptions),
    serialize: (value: unknown) => encode(value, encodeOptions),
  };
}

let cachedFormat: ToonFormat | null = null;

/**
 * Cached TOON format singleton — repeated calls return the same instance
 * (cheap for hot-path reuse in `registerFormat` / `setFormat`).
 */
export function getToonFormat(options?: ToonFormatOptions): ToonFormat {
  if (!cachedFormat) cachedFormat = createToonFormat(options);
  return cachedFormat;
}

// ===== Registration =====

let registerFn: ((fmt: ToonFormat) => void) | null = null;

/**
 * Load AsiJS `registerFormat` lazily:
 * 1. published consumer — `require("asijs")` (peer dependency);
 * 2. in-repo dev — fall back to the core source at `../../../src/index.ts`.
 */
function loadRegisterFormat(): (fmt: ToonFormat) => void {
  if (registerFn) return registerFn;
  const req = createRequire(import.meta.url);

  try {
    const mod = req("asijs") as { registerFormat?: (fmt: ToonFormat) => void };
    if (typeof mod.registerFormat === "function") {
      registerFn = mod.registerFormat;
      return registerFn;
    }
  } catch {
    // asijs not resolvable from node_modules — try the repo dev layout below
  }

  const corePath = fileURLToPath(new URL("../../../src/index.ts", import.meta.url));
  const core = req(corePath) as { registerFormat?: (fmt: ToonFormat) => void };
  if (typeof core.registerFormat !== "function") {
    throw new Error(
      "[toon-asijs] Could not load registerFormat from asijs. " +
        "Install asijs (bun add asijs) or register manually: registerFormat(createToonFormat()).",
    );
  }
  registerFn = core.registerFormat;
  return registerFn;
}

/**
 * Create the TOON format and register it with AsiJS — after this call
 * `setFormat("toon")`, `Accept: application/toon` negotiation and
 * `parseBody()` by `Content-Type: application/toon` all work.
 *
 * Idempotent: registering the same format twice is a no-op for the registry.
 *
 * @param options — encode/decode passthrough options
 * @returns the registered TOON format
 */
export function registerToonFormat(options?: ToonFormatOptions): ToonFormat {
  const fmt = createToonFormat(options);
  loadRegisterFormat()(fmt);
  return fmt;
}
