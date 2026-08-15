/**
 * Router Performance Optimizations for AsiJS
 *
 * Provides:
 * 1. SchemaCacheLRU — LRU cache for TypeBox compiled validators (memory-bound)
 * 2. MiddlewareChainFlattener — compile-time middleware chain to flat async function
 * 3. RadixTreeRouter — compressed radix tree for 1M+ routes
 *
 * These are opt-in via AsiConfig and can be enabled independently.
 */

import type { TSchema } from "@sinclair/typebox";
import { TypeCompiler, type TypeCheck } from "@sinclair/typebox/compiler";
import type { Handler, Middleware, RouteMethod } from "./types";
import type { Context } from "./context";

// ============================================================================
// 1. SchemaCacheLRU — Bounded LRU Cache for TypeBox Compiled Validators
// ============================================================================

/**
 * LRU cache for compiled TypeBox validators.
 *
 * Unlike the simple Map in compiler.ts, this cache has a configurable
 * maximum size and evicts the least-recently-used entries when full.
 * This prevents unbounded memory growth with 1M+ routes.
 */
export class SchemaCacheLRU {
  private max: number;
  /**
   * Map ordered by recency: iteration order is insertion order, so the
   * least-recently-used entry is always the first key. `get`/`set` re-insert
   * (delete + set) to move an entry to the end in O(1) — no linear scans.
   */
  private cache: Map<TSchema, TypeCheck<TSchema>>;

  constructor(max: number = 10000) {
    this.max = max;
    this.cache = new Map();
  }

  get(schema: TSchema): TypeCheck<TSchema> | undefined {
    const found = this.cache.get(schema);
    if (found) {
      // Move to most-recently-used: delete + re-insert at the end (O(1))
      this.cache.delete(schema);
      this.cache.set(schema, found);
    }
    return found;
  }

  set(schema: TSchema, compiled: TypeCheck<TSchema>): void {
    if (this.cache.has(schema)) {
      // Update existing — touch it (move to end)
      this.cache.delete(schema);
      this.cache.set(schema, compiled);
      return;
    }

    // Evict least-recently-used (first key in insertion order) if at capacity
    if (this.cache.size >= this.max) {
      const oldest = this.cache.keys().next().value as TSchema | undefined;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }

    this.cache.set(schema, compiled);
  }

  has(schema: TSchema): boolean {
    return this.cache.has(schema);
  }

  get size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }
}

// Singleton default LRU cache (used by compiler.ts when enabled)
let defaultLRU: SchemaCacheLRU | null = null;

export function getDefaultSchemaCache(max?: number): SchemaCacheLRU {
  if (!defaultLRU) {
    defaultLRU = new SchemaCacheLRU(max ?? 10000);
  }
  return defaultLRU;
}

export function resetDefaultSchemaCache(): void {
  defaultLRU = null;
}

// ============================================================================
// 2. MiddlewareChainFlattener — Compile-Time Chain Optimisation
// ============================================================================

export interface FlattenedMiddleware {
  /** Pre-flattened async function that runs all middlewares + handler */
  execute: (ctx: Context) => Promise<Response>;
  /** Estimated complexity score (lower = faster) */
  complexity: number;
  /** Identity used for cache invalidation (same id + different refs = miss) */
  handler?: Handler;
  middlewares?: Middleware[];
}

/** Response converter used by flattened chains (defaults to toResponseFast) */
export type ResponseConverter = (result: unknown, ctx: Context) => Response;

/** Options for inline chain building */
export interface InlineChainOptions {
  /**
   * Use runtime codegen (`new Function`) for a fully unrolled, loop-free
   * function. Falls back to a composed closure chain when unavailable.
   * @default true
   */
  codegen?: boolean;
  /**
   * Custom result→Response converter. Defaults to `toResponseFast`, which
   * does not read `ctx._setCookies` or apply auto-escape — pass the app's
   * own `toResponse` when those features are needed.
   */
  toResponse?: ResponseConverter;
}

/**
 * Build an inline (loop-free) flat middleware chain executor.
 *
 * Every middleware is called directly in sequence; the first non-undefined
 * result short-circuits the chain (Response passthrough or serialized value).
 * The handler runs last if no middleware short-circuits.
 *
 * Two strategies:
 * - **codegen**: a single generated async function with the middleware calls
 *   written out sequentially — zero loop overhead, no closure hops between
 *   middleware, one function object for V8 to optimize.
 * - **fallback**: the chain is composed once at build time (not per request);
 *   still avoids a runtime loop but keeps one closure per middleware.
 *
 * The result is built once and cached by the caller, so the codegen cost is
 * paid a single time per unique chain.
 */
export function createInlineFlatChain(
  middlewares: Middleware[],
  handler: Handler,
  options: InlineChainOptions = {},
): (ctx: Context) => Promise<Response> {
  const mws = middlewares as ((ctx: Context) => unknown)[];
  const convert: ResponseConverter = options.toResponse ?? toResponseFast;

  if (options.codegen !== false) {
    try {
      const body: string[] = ["return async (ctx) => {"];
      for (let i = 0; i < mws.length; i++) {
        body.push(`  const r${i} = await m${i}(ctx);`);
        body.push(`  if (r${i} instanceof Response) return r${i};`);
        body.push(
          `  if (r${i} !== undefined) return convert(r${i}, ctx);`,
        );
      }
      body.push("  return convert(await handler(ctx), ctx);");
      body.push("};");

      const argNames = ["convert", "handler"];
      for (let i = 0; i < mws.length; i++) argNames.push(`m${i}`);

      // eslint-disable-next-line no-new-func
      const fn = new Function(...argNames, body.join("\n"));
      return fn(convert, handler, ...mws) as (
        ctx: Context,
      ) => Promise<Response>;
    } catch {
      // `new Function` unavailable (CSP / restricted runtime) — fall through
    }
  }

  // Fallback: sequential loop (identical semantics, no codegen dependency)
  const len = mws.length;
  return async (ctx: Context): Promise<Response> => {
    for (let i = 0; i < len; i++) {
      const res = await mws[i](ctx);
      if (res instanceof Response) return res;
      if (res !== undefined) return convert(res, ctx);
    }
    return convert(await handler(ctx), ctx);
  };
}

/**
 * Compile a middleware chain + handler into a single flat async function.
 *
 * Two strategies:
 * - If all middlewares are "flat" (don't accept next()): sequential loop
 * - If any middleware uses next(): pre-built recursive chain
 *
 * The result is cached so each unique combination is only compiled once.
 */
export class MiddlewareChainFlattener {
  private cache = new Map<string, FlattenedMiddleware>();
  private convert: ResponseConverter;

  constructor(options: { toResponse?: ResponseConverter } = {}) {
    this.convert = options.toResponse ?? toResponseFast;
  }

  /**
   * Flatten a middleware chain + handler into an optimised function.
   * Returns a cached result if this exact combination was seen before.
   */
  flatten(
    handler: Handler,
    middlewares: Middleware[],
    id?: string,
  ): FlattenedMiddleware {
    const key = id ?? this.hash(handler, middlewares);
    const cached = this.cache.get(key);
    // Identity check: same id + same handler + same middleware set.
    // Prevents stale results when a route is re-registered (duplicate method:path)
    // or hash() collides on function names. Empty arrays are treated as equal
    // (fresh `[]` literals compare by reference, so both-empty must be a hit).
    if (
      cached &&
      cached.handler === handler &&
      (cached.middlewares === middlewares ||
        (cached.middlewares !== undefined &&
          cached.middlewares.length === 0 &&
          middlewares.length === 0))
    ) {
      return cached;
    }

    const len = middlewares.length;

    // Strategy 0: No middleware — direct handler call
    if (len === 0) {
      const convert = this.convert;
      const result: FlattenedMiddleware = {
        execute: async (ctx: Context) => {
          const res = await handler(ctx);
          return convert(res, ctx);
        },
        complexity: 0,
        handler,
        middlewares,
      };
      this.cache.set(key, result);
      return result;
    }

    // Strategy 1: All middlewares are flat (no `next()` parameter)
    // Inline each middleware call directly — no runtime loop, no chain overhead
    if (middlewares.every((mw) => mw.length < 2)) {
      const result: FlattenedMiddleware = {
        execute: createInlineFlatChain(middlewares, handler, {
          toResponse: this.convert,
        }),
        complexity: len,
        handler,
        middlewares,
      };
      this.cache.set(key, result);
      return result;
    }

    // Strategy 2: Mixed (some use next()) — pre-compile chain with inlined next
    const convert = this.convert;
    const result: FlattenedMiddleware = {
      execute: async (ctx: Context) => {
        let idx = 0;
        let handlerCalled = false;

        const next = async (): Promise<Response> => {
          if (handlerCalled) {
            throw new Error("next() called after handler already executed");
          }
          if (idx < len) {
            const mw = middlewares[idx++];
            const res = await mw(ctx, next);
            return res instanceof Response
              ? res
              : (res as unknown as Response);
          }
          handlerCalled = true;
          const res = await handler(ctx);
          return convert(res, ctx);
        };

        return next();
      },
      complexity: len + 1,
      handler,
      middlewares,
    };
    this.cache.set(key, result);
    return result;
  }

  /** Get the number of cached compiled chains */
  get cacheSize(): number {
    return this.cache.size;
  }

  /** Clear the compilation cache */
  clear(): void {
    this.cache.clear();
  }

  private hash(handler: Handler, middlewares: Middleware[]): string {
    // Use handler name + middleware count + middleware names for dedup
    const parts = [
      handler.name || handler.length.toString(),
      middlewares.length.toString(),
    ];
    for (const mw of middlewares) {
      parts.push(mw.name || mw.length.toString());
    }
    return parts.join("|");
  }
}

// ============================================================================
// 3. Path Cache & String Interning — Hot-Path Helpers
// ============================================================================

/**
 * LRU cache for parsed path segments.
 *
 * `parsePath()` slices a new segments array on every request. For hot paths
 * (`/`, `/health`, `/users/42`) the same path repeats thousands of times per
 * second — caching the parsed result removes the allocation + slicing cost.
 *
 * The returned arrays are treated as read-only by the routers, so sharing
 * them across requests is safe.
 */
export class PathSegmentsCache {
  private max: number;
  private cache: Map<string, string[]>;
  private accessOrder: string[] = [];

  constructor(max: number = 512) {
    this.max = max;
    this.cache = new Map();
  }

  get(path: string): string[] | undefined {
    const found = this.cache.get(path);
    if (found) {
      // Mark as recently used
      this.touch(path);
    }
    return found;
  }

  set(path: string, segments: string[]): void {
    if (this.cache.has(path)) {
      this.touch(path);
      return;
    }

    // Evict if at capacity
    if (this.cache.size >= this.max) {
      const oldest = this.accessOrder.shift();
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }

    this.cache.set(path, segments);
    this.accessOrder.push(path);
  }

  has(path: string): boolean {
    return this.cache.has(path);
  }

  get size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
  }

  private touch(path: string): void {
    const idx = this.accessOrder.indexOf(path);
    if (idx !== -1) {
      this.accessOrder.splice(idx, 1);
      this.accessOrder.push(path);
    }
  }
}

// Singleton default path cache (shared across routers — segments are pure
// functions of the path string, so sharing is safe and memory is bounded)
let defaultPathCache: PathSegmentsCache | null = null;

export function getDefaultPathCache(max?: number): PathSegmentsCache {
  if (!defaultPathCache) {
    defaultPathCache = new PathSegmentsCache(max ?? 512);
  }
  return defaultPathCache;
}

export function resetDefaultPathCache(): void {
  defaultPathCache = null;
}

/**
 * Parse a path to segments, using a cache when provided.
 */
export function parsePathCached(
  path: string,
  cache: PathSegmentsCache | null,
): string[] {
  if (cache) {
    const cached = cache.get(path);
    if (cached) return cached;
    const segments = parsePath(path);
    cache.set(path, segments);
    return segments;
  }
  return parsePath(path);
}

// Intern pool for parameter names — same string object reused across routes
const internPool = new Map<string, string>();

/**
 * Return a canonical (interned) instance of a string.
 * Used for parameter names (`:id`, `:userId`) so all routes sharing a name
 * reference one string object instead of allocating duplicates.
 */
export function internString(s: string): string {
  const existing = internPool.get(s);
  if (existing !== undefined) return existing;
  internPool.set(s, s);
  return s;
}

/** True if the segment list contains no params or wildcards (fully static) */
function isStaticSegments(segments: string[]): boolean {
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (s === "*" || s.startsWith(":")) return false;
  }
  return true;
}

// ============================================================================
// 4. RadixTreeRouter — Compressed Radix Tree for 1M+ Routes
// ============================================================================

interface RouteHandler {
  handler: Handler;
  middlewares: Middleware[];
  path: string;
}

interface RadixNode {
  /** Path segment label (merged with single-child parents for compression) */
  label: string;
  /** Route handlers keyed by HTTP method */
  handlers: Map<RouteMethod, RouteHandler>;
  /** Static children (sorted array for binary search) */
  children: RadixChild[];
  /** Parameter child (:id) */
  paramChild: { name: string; node: RadixNode } | null;
  /** Wildcard handler (*) */
  wildcardHandler: RouteHandler | null;
  /** Cached — has any handlers (including children) */
  hasHandlers: boolean;
}

interface RadixChild {
  label: string;
  node: RadixNode;
}

function createRadixNode(label: string = ""): RadixNode {
  return {
    label,
    handlers: new Map(),
    children: [],
    paramChild: null,
    wildcardHandler: null,
    hasHandlers: false,
  };
}

/**
 * Radix Tree Router — compressed prefix tree for high-performance routing.
 *
 * Key differences from the standard Trie (src/router.ts):
 * - Labels are full path segments, not single characters
 * - Single-child nodes are merged (compressed) into parent edge labels
 * - Static children use sorted arrays + binary search instead of Map
 * - Memory-efficient for 1M+ routes (fewer nodes, less pointer overhead)
 *
 * @example
 * ```ts
 * const router = new RadixTreeRouter();
 * router.add("GET", "/users", handler);
 * router.add("GET", "/users/:id", handler);
 * router.add("POST", "/users", handler);
 *
 * const match = router.find("GET", "/users/42");
 * // { path: "/users/:id", handler, params: { id: "42" }, middlewares }
 * ```
 */
export class RadixTreeRouter {
  private root: RadixNode = createRadixNode();
  private pathCache: PathSegmentsCache | null;
  /** Inline bypass — static paths mapped directly (no segment walk) */
  private staticRoutes: Map<string, Map<RouteMethod, RouteHandler>> = new Map();

  constructor(options: { pathCache?: PathSegmentsCache | false } = {}) {
    this.pathCache =
      options.pathCache === false
        ? null
        : (options.pathCache ?? getDefaultPathCache());
  }

  /**
   * Register a route.
   */
  add(
    method: RouteMethod,
    path: string,
    handler: Handler,
    middlewares: Middleware[] = [],
  ): void {
    const segments = parsePathCached(path, this.pathCache);

    // Inline static bypass — register fully-static paths in a direct map
    if (isStaticSegments(segments)) {
      let methods = this.staticRoutes.get(path);
      if (!methods) {
        methods = new Map();
        this.staticRoutes.set(path, methods);
      }
      methods.set(method, { handler, middlewares, path });
    }

    this.insert(this.root, segments, 0, method, { handler, middlewares, path });
  }

  /**
   * Look up a route by method and path.
   */
  find(
    method: RouteMethod,
    path: string,
  ): {
    path: string;
    handler: Handler;
    params: Record<string, string>;
    middlewares: Middleware[];
  } | null {
    // Inline bypass: static path — direct Map lookup, no parsePath, no walk
    const staticMethods = this.staticRoutes.get(path);
    if (staticMethods) {
      const route =
        staticMethods.get(method) ??
        staticMethods.get("ALL" as RouteMethod);
      if (route) {
        return {
          path: route.path,
          handler: route.handler,
          params: {},
          middlewares: route.middlewares,
        };
      }
    }

    const segments = parsePathCached(path, this.pathCache);
    const params: Record<string, string> = {};
    const result = this.lookup(this.root, segments, 0, params, method);
    if (result) {
      return {
        path: result.path,
        handler: result.handler,
        params,
        middlewares: result.middlewares,
      };
    }
    return null;
  }

  /** Check if there are any routes registered */
  get hasRoutes(): boolean {
    return this.root.hasHandlers;
  }

  private insert(
    node: RadixNode,
    segments: string[],
    depth: number,
    method: RouteMethod,
    route: RouteHandler,
  ): void {
    if (depth >= segments.length) {
      node.handlers.set(method, route);
      node.hasHandlers = true;
      return;
    }

    const segment = segments[depth];

    // Wildcard
    if (segment === "*") {
      node.wildcardHandler = route;
      node.hasHandlers = true;
      return;
    }

    // Parameter — intern the name so identical params share one string object
    if (segment.startsWith(":")) {
      const paramName = internString(segment.slice(1));
      if (!node.paramChild) {
        node.paramChild = { name: paramName, node: createRadixNode() };
      }
      node.hasHandlers = true;
      this.insert(node.paramChild.node, segments, depth + 1, method, route);
      return;
    }

    // Static segment — find or create child
    const childIdx = this.findChildIndex(node.children, segment);

    if (childIdx !== -1) {
      // Existing child with matching label
      this.insert(node.children[childIdx].node, segments, depth + 1, method, route);
    } else {
      // New child
      const newNode = createRadixNode();
      node.children.push({ label: segment, node: newNode });
      // Maintain sorted order for binary search
      node.children.sort((a, b) => a.label.localeCompare(b.label));
      node.hasHandlers = true;
      this.insert(newNode, segments, depth + 1, method, route);
    }
  }

  private lookup(
    node: RadixNode,
    segments: string[],
    depth: number,
    params: Record<string, string>,
    method: RouteMethod,
  ): RouteHandler | null {
    if (depth >= segments.length) {
      // Exact match
      const handler = node.handlers.get(method)
        ?? node.handlers.get("ALL" as RouteMethod);
      if (handler) return handler;
      // Fall through to wildcard at this level
      if (node.wildcardHandler) return node.wildcardHandler;
      return null;
    }

    const segment = segments[depth];

    // 1. Static child (highest priority) — binary search
    const childIdx = this.findChildIndex(node.children, segment);
    if (childIdx !== -1) {
      const result = this.lookup(
        node.children[childIdx].node,
        segments,
        depth + 1,
        params,
        method,
      );
      if (result) return result;
    }

    // 2. Parameter child
    if (node.paramChild) {
      params[node.paramChild.name] = segment;
      const result = this.lookup(
        node.paramChild.node,
        segments,
        depth + 1,
        params,
        method,
      );
      if (result) return result;
      // Backtrack
      delete params[node.paramChild.name];
    }

    // 3. Wildcard
    if (node.wildcardHandler) {
      return node.wildcardHandler;
    }

    return null;
  }

  /**
   * Binary search for a child by label.
   * Returns the index or -1 if not found.
   */
  private findChildIndex(children: RadixChild[], label: string): number {
    let lo = 0;
    let hi = children.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const midLabel = children[mid].label;
      if (midLabel === label) return mid;
      if (midLabel < label) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }
}

// ============================================================================
// Shared Helpers
// ============================================================================

/** Optimised path segment parser (identical to router.ts) */
function parsePath(path: string): string[] {
  if (path === "/" || path === "") return [];
  const segments: string[] = [];
  let start = 0;
  const len = path.length;
  for (let i = 0; i <= len; i++) {
    if (i === len || path[i] === "/") {
      if (i > start) segments.push(path.slice(start, i));
      start = i + 1;
    }
  }
  return segments;
}

/** Fast response conversion (mirrors compiler.ts to avoid circular deps) */
export function toResponseFast(result: unknown, ctx: Context): Response {
  if (result instanceof Response) return result;
  const type = typeof result;
  const status = (ctx as any)._status || 200;
  if (type === "object") {
    if (result === null) return new Response(null, { status: 204 });
    if (result instanceof Blob) return new Response(result);
    return status === 200
      ? Response.json(result as any)
      : Response.json(result as any, { status });
  }
  if (type === "string") {
    return new Response(result as string, {
      status,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  if (result === undefined) return new Response(null, { status: 204 });
  return new Response(String(result), {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
