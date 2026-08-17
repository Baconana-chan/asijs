/**
 * Data format layer (formats).
 *
 * A `DataFormat` describes how a wire format maps to and from plain JS
 * objects: `parse(text)` for request bodies, `serialize(value)` for
 * responses, plus the MIME types and file extensions it speaks.
 *
 * JSON is registered natively (zero deps). YAML is a lazy adapter over the
 * `yaml` package (loaded on first use via `createRequire` — no import cost
 * until you actually use it). Custom formats can be registered with
 * `registerFormat()`.
 *
 * Usage:
 * ```ts
 * import { Asi, registerFormat, createYamlFormat } from "asijs";
 *
 * registerFormat(createYamlFormat());          // enable YAML for negotiation
 * const app = new Asi({ format: "yaml" });     // default format = YAML
 * // or: app.setFormat("yaml");
 *
 * app.post("/config", async (ctx) => {
 *   const body = await ctx.parseBody();        // parses by Content-Type
 *   return body;                               // serialized to YAML
 * });
 * ```
 */

import { createRequire } from "module";
import { bestMatch } from "./negotiate";
import type { Context } from "./context";

// ===== Types =====

/** A wire format: request parsing + response serialization. */
export interface DataFormat {
  /** Unique format name: "json", "yaml", "toml", ... */
  name: string;
  /** MIME types this format speaks (lowercase). */
  contentTypes: string[];
  /** File extensions: [".yaml", ".yml"]. */
  extensions: string[];
  /** Default MIME type used for responses. */
  contentType: string;
  /** Parse wire text into a plain JS value. */
  parse(text: string): unknown;
  /** Serialize a plain JS value into wire text. */
  serialize(value: unknown): string;
}

// ===== Registry =====

const registry = new Map<string, DataFormat>();
let registeredCount = 0;

/** Register a format by name and all of its content types. */
export function registerFormat(fmt: DataFormat): void {
  if (!registry.has(fmt.name.toLowerCase())) registeredCount++;
  registry.set(fmt.name.toLowerCase(), fmt);
  for (const ct of fmt.contentTypes) registry.set(ct.toLowerCase(), fmt);
}

/** Look up a format by name or by MIME type ("yaml", "application/yaml"). */
export function getFormat(nameOrContentType: string): DataFormat | undefined {
  return registry.get(nameOrContentType.toLowerCase());
}

/** All registered formats, unique by name. */
export function listFormats(): DataFormat[] {
  const byName = new Map<string, DataFormat>();
  for (const fmt of registry.values()) byName.set(fmt.name, fmt);
  return [...byName.values()];
}

/** Number of unique registered format names (used for negotiation fast-path). */
export function registeredFormatCount(): number {
  return registeredCount;
}

/** Reset the registry to only JSON (tests). */
export function resetFormats(): void {
  registry.clear();
  registeredCount = 0;
  registerFormat(jsonFormat);
}

/** Find the format for a raw Content-Type header value. */
export function formatForContentType(contentType: string | null | undefined): DataFormat | undefined {
  if (!contentType) return undefined;
  const clean = contentType.split(";")[0].trim().toLowerCase();
  return getFormat(clean);
}

// ===== JSON (native) =====

/** Built-in JSON format — zero dependencies, always registered. */
export const jsonFormat: DataFormat = {
  name: "json",
  contentTypes: ["application/json", "text/json"],
  extensions: [".json"],
  contentType: "application/json",
  parse: (text) => JSON.parse(text),
  serialize: (value) => JSON.stringify(value),
};

// ===== YAML (lazy) =====

let yamlModule: {
  parse(text: string): unknown;
  stringify(value: unknown): string;
} | null = null;

/** Load the `yaml` package on first use (sync, cached). */
function loadYaml(): { parse(text: string): unknown; stringify(value: unknown): string } {
  if (!yamlModule) {
    const req = createRequire(import.meta.url);
    yamlModule = req("yaml") as {
      parse(text: string): unknown;
      stringify(value: unknown): string;
    };
  }
  return yamlModule!;
}

/** YAML format — lazy adapter over the `yaml` package (bun add yaml). */
export function createYamlFormat(): DataFormat {
  return {
    name: "yaml",
    contentTypes: ["application/yaml", "text/yaml", "application/x-yaml"],
    extensions: [".yaml", ".yml"],
    contentType: "application/yaml",
    parse: (text) => loadYaml().parse(text),
    serialize: (value) => loadYaml().stringify(value),
  };
}

let cachedYamlFormat: DataFormat | null = null;

/** Register the YAML format (idempotent). Call once at startup. */
export function registerYamlFormat(): DataFormat {
  if (!cachedYamlFormat) {
    cachedYamlFormat = createYamlFormat();
  }
  registerFormat(cachedYamlFormat); // always (re-)register — survives resetFormats()
  return cachedYamlFormat;
}

// ===== Response serialization =====

/** Supported content types for negotiation (all registered formats). */
function supportedContentTypes(): string[] {
  return listFormats().flatMap((f) => f.contentTypes);
}

/**
 * Pick the response format for a request:
 * - explicit default format (`setFormat`) wins unless Accept asks for a
 *   registered alternative;
 * - with only JSON registered, returns JSON (fast path);
 * - `null` means "use the standard JSON path".
 */
export function pickResponseFormat(
  ctx: Pick<Context, "request">,
  defaultFormat: DataFormat | null | undefined,
): DataFormat | null {
  const fmt = defaultFormat ?? jsonFormat;
  const accept = ctx.request?.headers?.get?.("accept") ?? "";

  if (fmt.name === "json" && registeredFormatCount() <= 1) {
    return null; // fast path — plain JSON, no negotiation possible
  }

  if (accept) {
    const supported = supportedContentTypes();
    const picked = bestMatch(accept, supported, fmt.contentType);
    const pickedFmt = getFormat(picked);
    if (pickedFmt) {
      if (pickedFmt.name === "json") return null; // JSON fast path
      return pickedFmt;
    }
  }

  return fmt.name === "json" ? null : fmt;
}

/** Build a Response serialized with a format (honors ctx status + cookies). */
export function makeFormatResponse(
  body: string,
  fmt: DataFormat,
  ctx: Context,
  status: number,
  setCookies?: string[],
): Response {
  const headers = new Headers({ "Content-Type": `${fmt.contentType}; charset=utf-8` });
  if (setCookies) {
    for (const cookie of setCookies) headers.append("Set-Cookie", cookie);
  }
  return new Response(body, { status, headers });
}
