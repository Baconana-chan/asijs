/**
 * Content Negotiation for AsiJS
 *
 * Automatic format selection based on the Accept request header.
 * Supports JSON, HTML, XML, text, and custom content types.
 *
 * @example
 * ```ts
 * import { Asi } from "asijs";
 *
 * const app = new Asi();
 *
 * // Using ctx.negotiate() directly
 * app.get("/api/item", (ctx) => {
 *   return ctx.negotiate({
 *     json: { id: 1, name: "Item" },
 *     html: "<h1>Item 1</h1>",
 *   });
 * });
 * ```
 */

import type { Context } from "./context";

// ===== Types =====

/** One parsed entry of an Accept header (type/subtype, quality, params). */
export interface AcceptEntry {
  type: string;
  subtype: string;
  q: number;
  params: Record<string, string>;
}

/** Per-format response handlers for content negotiation (json/html/xml/text/…). */
export interface NegotiateHandlers {
  json?: unknown | (() => unknown | Promise<unknown>);
  html?: string | (() => string | Promise<string>);
  xml?: string | (() => string | Promise<string>);
  text?: string | (() => string | Promise<string>);
  [key: string]: unknown | (() => unknown | Promise<unknown>);
}

/** Options for `negotiateResponse` (default type, charset inclusion). */
export interface NegotiateOptions {
  defaultType?: string;
  includeCharset?: boolean;
}

// ===== Accept Header Parsing =====

/** Parse an Accept header into quality-sorted entries. */
export function parseAccept(acceptHeader: string): AcceptEntry[] {
  if (!acceptHeader) return [];

  const entries: AcceptEntry[] = [];

  for (const raw of acceptHeader.split(",")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(";");
    const typeSubtype = parts[0].trim();
    const slashIdx = typeSubtype.indexOf("/");

    if (slashIdx === -1) continue;

    const type = typeSubtype.slice(0, slashIdx).trim().toLowerCase();
    const subtype = typeSubtype.slice(slashIdx + 1).trim().toLowerCase();

    let q = 1;
    const params: Record<string, string> = {};

    for (let i = 1; i < parts.length; i++) {
      const param = parts[i].trim();
      const eqIdx = param.indexOf("=");
      if (eqIdx > 0) {
        const key = param.slice(0, eqIdx).trim().toLowerCase();
        const value = param.slice(eqIdx + 1).trim();

        if (key === "q") {
          q = parseFloat(value);
          if (isNaN(q) || q > 1) q = 1;
          if (q < 0) q = 0;
        } else {
          params[key] = value;
        }
      }
    }

    entries.push({ type, subtype, q, params });
  }

  entries.sort((a, b) => {
    if (b.q !== a.q) return b.q - a.q;
    const aWild = (a.type === "*" ? 1 : 0) + (a.subtype === "*" ? 1 : 0);
    const bWild = (b.type === "*" ? 1 : 0) + (b.subtype === "*" ? 1 : 0);
    return aWild - bWild;
  });

  return entries;
}

function matchesAccept(type: string, entry: AcceptEntry): boolean {
  const [main, sub] = type.split("/");
  if (entry.type === "*" && entry.subtype === "*") return true;
  if (entry.type === main && entry.subtype === "*") return true;
  if (entry.type === main && entry.subtype === sub) return true;
  return false;
}

/** Pick the best supported MIME type for an Accept header (default fallback). */
export function bestMatch(
  acceptHeader: string | null | undefined,
  supported: string[],
  defaultType = "application/json",
): string {
  if (!acceptHeader) return defaultType;
  const entries = parseAccept(acceptHeader);

  for (const entry of entries) {
    if (entry.q === 0) continue;
    for (const supportedType of supported) {
      if (matchesAccept(supportedType, entry)) {
        return supportedType;
      }
    }
  }

  return defaultType;
}

// ===== MIME Type Helpers =====

function aliasToMime(alias: string): string {
  switch (alias) {
    case "json": return "application/json";
    case "html": return "text/html";
    case "xml":  return "application/xml";
    case "text": return "text/plain";
    default:
      if (alias.includes("/")) return alias;
      return alias;
  }
}

function responseContentType(mimeType: string, includeCharset: boolean): string {
  return includeCharset ? mimeType + "; charset=utf-8" : mimeType;
}

// ===== Response Builder =====

/** Build a Response for the best matching format — 406 when nothing matches. */
export async function negotiateResponse(
  ctx: Pick<Context, "header">,
  handlers: NegotiateHandlers,
  options: NegotiateOptions = {},
): Promise<Response> {
  const { defaultType = "application/json", includeCharset = true } = options;
  const acceptHeader = ctx.header("accept");

  const supported: string[] = [];
  const typeMap: Record<string, unknown | (() => unknown | Promise<unknown>)> = {};

  for (const [key, value] of Object.entries(handlers)) {
    const mimeType = aliasToMime(key);
    supported.push(mimeType);
    typeMap[mimeType] = value;
  }

  const best = bestMatch(acceptHeader, supported, defaultType);
  const handler = typeMap[best];

  if (handler === undefined) {
    return new Response(JSON.stringify({ error: "No acceptable format" }), {
      status: 406,
      headers: { "Content-Type": "application/json" },
    });
  }

  let value: unknown;
  if (typeof handler === "function") {
    value = await (handler as () => unknown)();
  } else {
    value = handler;
  }

  if (value instanceof Response) return value;

  const contentType = responseContentType(best, includeCharset);

  if (best === "application/json" || typeof value === "object") {
    const body = typeof value === "string" ? value : JSON.stringify(value);
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": contentType },
    });
  }

  return new Response(String(value ?? ""), {
    status: 200,
    headers: { "Content-Type": contentType },
  });
}
