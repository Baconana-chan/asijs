/**
 * JSON Schema response serialization (3.2).
 *
 * `compileSerializer` pre-compiles a TypeBox / JSON Schema into a fast,
 * hand-rolled serialization function (like Fastify's fast-json-stringify):
 * field access is inlined, so we skip JSON.stringify's generic walk + V8
 * hidden-class churn. Anything the codegen can't prove safe (unions of
 * objects, records, ...) falls back to JSON.stringify — same strategy as
 * fast-json-stringify.
 *
 * - `compileSerializer(schema)` → `(value) => string`
 * - `compileResponseSerializer(response)` → `(value, status) => string | null`
 *   (status-keyed: `200`, `2xx`, `default`)
 * - `wrapWithResponseSerializer(handler, opts)` — route integration incl.
 *   content-type negotiation (Accept header → per-content-type serializer)
 * - `serializeForCache` / `deserializeFromCache` — V8.serialize binary
 *   helpers for internal caches (NOT for HTTP JSON — binary ≠ JSON)
 */

import { type TSchema } from "@sinclair/typebox";
import type { Handler } from "./types";
import type { Context } from "./context";

export type Serializer = (value: unknown) => string;

/** Route-level response schema: a single schema, or keyed by status code. */
export type ResponseSchema = TSchema | Record<string | number, TSchema>;

/** A TypeBox schema shape (structural). */
interface SchemaLike {
  type?: string;
  properties?: Record<string, SchemaLike>;
  items?: SchemaLike;
  anyOf?: SchemaLike[];
  const?: unknown;
  required?: string[];
  optional?: boolean;
}

const serializerCache = new Map<TSchema, Serializer>();

/** Reset the serializer cache (useful in tests). */
export function resetSerializerCache(): void {
  serializerCache.clear();
}

/**
 * `_o(parts)` — join JSON object parts, skipping empty optionals.
 * Only used when a schema has optional fields.
 */
function objectJoin(parts: string[]): string {
  let out = "{";
  let first = true;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === "") continue;
    if (!first) out += ",";
    out += p;
    first = false;
  }
  return out + "}";
}

/** `_a(v, fn)` — map + join array items. */
function arrayJoin(v: unknown, fn: (x: unknown) => string): string {
  if (!Array.isArray(v)) return "null";
  return "[" + v.map(fn).join(",") + "]";
}

/**
 * Generate a JS expression string that serializes `acc` according to the
 * schema, or `null` when the schema is not codegen-able.
 */
function genValue(t: SchemaLike, acc: string, depth = 0): string | null {
  if (t.anyOf) {
    const consts = t.anyOf.filter((m) => m.const !== undefined);
    if (consts.length === t.anyOf.length && consts.length > 0) {
      // enum-like union of literals → primitive type of the first member
      const c = consts[0].const;
      const type =
        typeof c === "string"
          ? "string"
          : typeof c === "number"
            ? Number.isInteger(c)
              ? "integer"
              : "number"
            : typeof c === "boolean"
              ? "boolean"
              : "";
      if (type) return genValue({ type }, acc, depth);
    }
    return null; // union of objects / mixed — fall back to JSON.stringify
  }
  if (t.const !== undefined) {
    return JSON.stringify(JSON.stringify(t.const));
  }
  switch (t.type) {
    case "string":
    case "integer":
    case "number":
    case "boolean":
      // Inline native JSON.stringify per value — no helper-call overhead.
      // JSON.stringify(undefined) returns undefined (not "null"), so map
      // missing values to null for valid JSON output.
      return `JSON.stringify((${acc} === undefined ? null : ${acc}))`;
    case "array": {
      const item = genValue(t.items ?? {}, `__v${depth + 1}`, depth + 1);
      if (item === null) return null;
      return `_a(${acc}, function(__v${depth + 1}){ return ${item}; })`;
    }
    case "object": {
      const props = t.properties;
      if (!props || Object.keys(props).length === 0) {
        // empty object → always "{}" (null-safe)
        return `(${acc} == null ? "null" : "{}")`;
      }
      const required = new Set(t.required ?? []);
      const keys = Object.keys(props);
      const hasOptional = keys.some((k) => !required.has(k));

      // Pre-escape key literals so the generated VALUE includes JSON quotes:
      // key "name" → value '"name":' → source literal '"\"name\":"'.
      const keyLit = (k: string): string => JSON.stringify(JSON.stringify(k) + ":");

      // Fast path: all fields required → direct concatenation, no array.
      if (!hasOptional) {
        // Prefix literal must include the JSON key quotes: value '{"id":' →
        // built from JSON.stringify(k) (which adds the quotes as characters).
        const chunks: string[] = [JSON.stringify("{" + JSON.stringify(keys[0]) + ":")];
        for (let i = 0; i < keys.length; i++) {
          const code = genValue(props[keys[i]], `${acc}[${JSON.stringify(keys[i])}]`, depth);
          if (code === null) return null;
          chunks.push(code);
          if (i < keys.length - 1) {
            chunks.push(JSON.stringify("," + JSON.stringify(keys[i + 1]) + ":"));
          }
        }
        chunks.push(JSON.stringify("}"));
        return `((${acc} == null) ? "null" : ${chunks.join(" + ")})`;
      }

      // Optional fields present → parts array with empty-skipping join.
      const parts: string[] = [];
      for (const k of keys) {
        const code = genValue(props[k], `${acc}[${JSON.stringify(k)}]`, depth);
        if (code === null) return null;
        if (required.has(k)) {
          parts.push(`${keyLit(k)} + ${code}`);
        } else {
          parts.push(
            `(${acc}[${JSON.stringify(k)}] !== undefined ? ${keyLit(k)} + ${code} : "")`,
          );
        }
      }
      return `((${acc} == null) ? "null" : _o([${parts.join(",")}]))`;
    }
    default:
      return null;
  }
}

/**
 * Pre-compile a TypeBox / JSON Schema into a fast serialization function.
 * Falls back to `JSON.stringify` when the schema is not codegen-able.
 * Compiled results are cached by schema object identity.
 *
 * @example
 * ```ts
 * const serialize = compileSerializer(
 *   Type.Object({ id: Type.Number(), name: Type.String() }),
 * );
 * serialize({ id: 1, name: "Ada" }); // '{"id":1,"name":"Ada"}'
 * ```
 */
export function compileSerializer(schema: TSchema): Serializer {
  const cached = serializerCache.get(schema);
  if (cached) return cached;

  let serializer: Serializer;
  const expr = genValue(schema as unknown as SchemaLike, "v");
  if (expr === null) {
    serializer = (value: unknown) => JSON.stringify(value);
  } else {
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function(
        "v",
        "_o",
        "_a",
        `return (v == null ? "null" : ${expr});`,
      ) as (
        v: unknown,
        o: (parts: string[]) => string,
        a: (v: unknown, fn: (x: unknown) => string) => string,
      ) => string;
      serializer = (value: unknown) => fn(value, objectJoin, arrayJoin);
    } catch {
      serializer = (value: unknown) => JSON.stringify(value);
    }
  }

  serializerCache.set(schema, serializer);
  return serializer;
}

/** True when the response value is a status-keyed map of schemas. */
export function isResponseSchemaMap(response: ResponseSchema): response is Record<string, TSchema> {
  if (typeof response !== "object" || response === null) return false;
  const keys = Object.keys(response);
  if (keys.length === 0) return false;
  return keys.every((k) => /^\d+$/.test(k) || /^\dxx$/i.test(k) || k.toLowerCase() === "default");
}

/** Resolve the schema for a status (exact → `Nxx` → `default`). */
export function resolveResponseSchema(
  response: ResponseSchema | undefined,
  status: number,
): TSchema | null {
  if (!response) return null;
  if (!isResponseSchemaMap(response)) return response as TSchema;
  const map = response as Record<string, TSchema>;
  const s = String(status);
  if (map[s]) return map[s];
  const xx = `${Math.floor(status / 100)}xx`;
  if (map[xx]) return map[xx];
  const lower = Object.keys(map).find((k) => k.toLowerCase() === "default");
  if (lower) return map[lower];
  return null;
}

/**
 * Compile a response schema (single or status-keyed) into a
 * `(value, status) => string | null` resolver. Returns `null` when no
 * serializer matches the status (caller falls back to default JSON).
 */
export function compileResponseSerializer(
  response: ResponseSchema,
): (value: unknown, status: number) => string | null {
  if (!isResponseSchemaMap(response)) {
    const s = compileSerializer(response as TSchema);
    return (value) => s(value);
  }
  const map = new Map<string, Serializer>();
  for (const [k, schema] of Object.entries(response as Record<string, TSchema>)) {
    map.set(k.toLowerCase(), compileSerializer(schema));
  }
  return (value, status) => {
    const exact = map.get(String(status).toLowerCase());
    if (exact) return exact(value);
    const xx = map.get(`${Math.floor(status / 100)}xx`);
    if (xx) return xx(value);
    const fallback = map.get("default");
    if (fallback) return fallback(value);
    return null;
  };
}

// ============================================================================
// Content-type negotiation
// ============================================================================

/** Pick the best matching content-type key from an Accept header. */
export function pickContentType(accept: string, keys: string[]): string | null {
  if (!accept || keys.length === 0) return null;
  const lowerKeys = keys.map((k) => k.toLowerCase());
  const parts = accept.split(",").map((p) => p.trim().split(";")[0].toLowerCase());
  // exact match, in Accept order
  for (const part of parts) {
    const idx = lowerKeys.indexOf(part);
    if (idx !== -1) return keys[idx];
  }
  // wildcard
  if (parts.includes("*/*")) {
    const json = lowerKeys.indexOf("application/json");
    if (json !== -1) return keys[json];
    return keys[0];
  }
  return null;
}

// ============================================================================
// Route integration
// ============================================================================

export interface ResponseSerializeOptions {
  /** Response schema (single or status-keyed). */
  response?: ResponseSchema;
  /** Per-content-type serializers: `"application/vnd.api+json"` → schema or fn. */
  serializers?: Record<string, TSchema | Serializer>;
}

/** Build a JSON Response from a pre-serialized body (honors ctx status + cookies). */
function makeJsonResponse(body: string, ctx: Context): Response {
  const status = (ctx as unknown as { _status?: number })._status || 200;
  const setCookies = (ctx as unknown as { _setCookies?: string[] })._setCookies;
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8" });
  if (setCookies) {
    for (const cookie of setCookies) headers.append("Set-Cookie", cookie);
  }
  return new Response(body, { status, headers });
}

/**
 * Wrap a handler so object results are serialized with the compiled response
 * serializer (status-keyed) or a content-type serializer chosen via the
 * Accept header. Non-object results (Response / string / null / Blob /
 * undefined) pass through untouched; if no serializer matches, the result
 * flows to the default JSON path.
 */
export function wrapWithResponseSerializer(
  handler: Handler,
  options?: ResponseSerializeOptions,
): Handler {
  const { response, serializers } = options ?? {};
  const hasResponse = !!response;
  const ctEntries = Object.entries(serializers ?? {});
  if (!hasResponse && ctEntries.length === 0) return handler;

  const byStatus = hasResponse
    ? compileResponseSerializer(response as ResponseSchema)
    : null;
  const ctSerializers = new Map<string, Serializer>();
  for (const [ct, s] of ctEntries) {
    ctSerializers.set(ct.toLowerCase(), typeof s === "function" ? s : compileSerializer(s as TSchema));
  }
  const ctKeys = [...ctSerializers.keys()];

  return async (ctx: Context) => {
    const result = await handler(ctx);
    if (
      result === null ||
      typeof result !== "object" ||
      result instanceof Response ||
      result instanceof Blob
    ) {
      return result;
    }

    // Content-type negotiation first (explicit serializer wins)
    if (ctKeys.length > 0) {
      const accept = ctx.request?.headers?.get?.("accept") ?? "";
      const picked = pickContentType(accept, ctKeys);
      if (picked) {
        return makeJsonResponse(ctSerializers.get(picked)!(result), ctx);
      }
    }

    // Status-keyed response schema
    if (byStatus) {
      const status = (ctx as unknown as { _status?: number })._status || 200;
      const body = byStatus(result, status);
      if (body !== null) {
        return makeJsonResponse(body, ctx);
      }
    }

    return result;
  };
}

// ============================================================================
// V8.serialize helpers (internal caches only — binary, not JSON)
// ============================================================================

/**
 * Serialize a value to binary via V8.serialize — ~2–3× faster than
 * JSON.stringify for large / complex payloads, but NOT JSON-compatible.
 * Use it for internal response caches / dedupe buffers, never for HTTP
 * JSON responses. Falls back to UTF-8 JSON when V8.serialize is missing.
 */
export function serializeForCache(value: unknown): Uint8Array {
  const v8 = (globalThis as { V8?: { serialize: (v: unknown) => Uint8Array } }).V8;
  if (v8?.serialize) {
    try {
      return v8.serialize(value);
    } catch {
      // fall through to JSON
    }
  }
  return new TextEncoder().encode(JSON.stringify(value));
}

/** Reverse of `serializeForCache`. */
export function deserializeFromCache(bytes: Uint8Array): unknown {
  const v8 = (globalThis as { V8?: { deserialize: (b: Uint8Array) => unknown } }).V8;
  if (v8?.deserialize) {
    try {
      return v8.deserialize(bytes);
    } catch {
      // fall through to JSON
    }
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
