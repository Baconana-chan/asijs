/**
 * Server/client boundaries.
 *
 * The `"use client"` directive marks a module as a client component. In a
 * bundler-free setup you register references manually via `moduleRef`; with
 * `buildClientManifest` you can derive the Flight module map from source
 * files that declare the directive.
 */
import type { ClientManifest, ClientReferenceMetadata } from "./types";

const USE_CLIENT_RE = /^["']use client["']\s*;?/;

/**
 * True when the source starts (after comments / whitespace) with the
 * `"use client"` directive.
 *
 * @example
 * ```ts
 * isClientModule(`"use client";\nimport { useState } from "react";`)
 * // → true
 * ```
 */
export function isClientModule(source: string): boolean {
  let s = source;
  for (;;) {
    s = s.replace(/^\s+/, "");
    if (s.startsWith("/*")) {
      const end = s.indexOf("*/");
      if (end === -1) break;
      s = s.slice(end + 2);
      continue;
    }
    if (s.startsWith("//")) {
      const nl = s.indexOf("\n");
      if (nl === -1) break;
      s = s.slice(nl + 1);
      continue;
    }
    break;
  }
  return USE_CLIENT_RE.test(s);
}

/** Naive export-name scanner (covers the common forms). */
export function scanExports(source: string): string[] {
  const names: string[] = [];
  const re =
    /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|class\s+([A-Za-z_$][\w$]*)|const\s+([A-Za-z_$][\w$]*)|let\s+([A-Za-z_$][\w$]*)|var\s+([A-Za-z_$][\w$]*))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const name = m.slice(1).find(Boolean);
    if (name) names.push(name);
  }
  // export { a, b as c }  /  export default
  const named = source.match(/\bexport\s*\{([^}]+)\}/g) ?? [];
  for (const block of named) {
    const inner = block.slice(block.indexOf("{") + 1, block.lastIndexOf("}"));
    for (const part of inner.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const asIdx = trimmed.lastIndexOf(" as ");
      names.push(asIdx === -1 ? trimmed : trimmed.slice(asIdx + 4).trim());
    }
  }
  if (/\bexport\s+default\b/.test(source) && !names.includes("default")) {
    names.push("default");
  }
  return [...new Set(names)];
}

/** A client module discovered from source. */
export interface ClientModuleEntry {
  /** Module id — the key used in the manifest and by the bundler. */
  id: string;
  /** File path on disk (for reference / build). */
  path: string;
  /** Raw source (used for directive + export scanning). */
  source: string;
}

/**
 * Build a Flight module map from client module sources. Only modules that
 * start with `"use client"` are included; each gets entries for every
 * detected export (plus `default`).
 */
export function buildClientManifest(entries: ClientModuleEntry[]): ClientManifest {
  const manifest: ClientManifest = {};
  for (const entry of entries) {
    if (!isClientModule(entry.source)) continue;
    const names = scanExports(entry.source);
    const record: Record<string, ClientReferenceMetadata> = {};
    const namesToAdd = names.length > 0 ? names : ["default"];
    for (const name of namesToAdd) {
      record[name] = { id: entry.id, chunks: [], name, async: true };
    }
    if (!record.default) {
      record.default = { id: entry.id, chunks: [], name: "default", async: true };
    }
    manifest[entry.id] = record;
  }
  return manifest;
}

/**
 * Create a client reference proxy for a `"use client"` module — the manual
 * boundary. When react-server-dom-webpack is installed this registers a real
 * client reference (so it can be rendered by the Flight renderer); otherwise
 * it returns a plain tagged object (safe to render on the server, no-op).
 *
 * @example
 * ```ts
 * import { moduleRef } from "asijs-react";
 * const Counter = moduleRef("/client/Counter.tsx", "default");
 * // <Counter /> — rendered on the server, hydrated on the client
 * ```
 */
export function moduleRef(moduleId: string, exportName = "default"): unknown {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rsc = require("react-server-dom-webpack/server.node") as {
      registerClientReference?: (proxy: object, id: string, name: string) => unknown;
    };
    if (typeof rsc.registerClientReference === "function") {
      return rsc.registerClientReference({}, moduleId, exportName);
    }
  } catch {
    // react-server-dom-webpack not installed — plain reference
  }
  return { __asijsClientRef: { moduleId, exportName } };
}
