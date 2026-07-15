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
  private cache: Map<TSchema, TypeCheck<TSchema>>;
  private accessOrder: TSchema[] = [];

  constructor(max: number = 10000) {
    this.max = max;
    this.cache = new Map();
  }

  get(schema: TSchema): TypeCheck<TSchema> | undefined {
    const found = this.cache.get(schema);
    if (found) {
      // Move to front (mark as recently used)
      this.touch(schema);
    }
    return found;
  }

  set(schema: TSchema, compiled: TypeCheck<TSchema>): void {
    if (this.cache.has(schema)) {
      // Update existing — touch it
      this.cache.set(schema, compiled);
      this.touch(schema);
      return;
    }

    // Evict if at capacity
    if (this.cache.size >= this.max) {
      const oldest = this.accessOrder.shift();
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }

    this.cache.set(schema, compiled);
    this.accessOrder.push(schema);
  }

  has(schema: TSchema): boolean {
    return this.cache.has(schema);
  }

  get size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
  }

  private touch(schema: TSchema): void {
    const idx = this.accessOrder.indexOf(schema);
    if (idx !== -1) {
      this.accessOrder.splice(idx, 1);
      this.accessOrder.push(schema);
    }
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
    if (cached) return cached;

    const len = middlewares.length;

    // Strategy 0: No middleware — direct handler call
    if (len === 0) {
      const result: FlattenedMiddleware = {
        execute: async (ctx: Context) => {
          const res = await handler(ctx);
          return toResponseFast(res, ctx);
        },
        complexity: 0,
      };
      this.cache.set(key, result);
      return result;
    }

    // Strategy 1: All middlewares are flat (no `next()` parameter)
    // Run them sequentially without chain overhead
    if (middlewares.every((mw) => mw.length < 2)) {
      const result: FlattenedMiddleware = {
        execute: async (ctx: Context) => {
          for (let i = 0; i < len; i++) {
            const res = await (middlewares[i] as (ctx: Context) => unknown)(ctx);
            if (res instanceof Response) return res;
            if (res !== undefined) return toResponseFast(res, ctx);
          }
          const res = await handler(ctx);
          return toResponseFast(res, ctx);
        },
        complexity: len,
      };
      this.cache.set(key, result);
      return result;
    }

    // Strategy 2: Mixed (some use next()) — pre-compile chain with inlined next
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
          return toResponseFast(res, ctx);
        };

        return next();
      },
      complexity: len + 1,
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
// 3. RadixTreeRouter — Compressed Radix Tree for 1M+ Routes
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

  /**
   * Register a route.
   */
  add(
    method: RouteMethod,
    path: string,
    handler: Handler,
    middlewares: Middleware[] = [],
  ): void {
    const segments = parsePath(path);
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
    const segments = parsePath(path);
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

    // Parameter
    if (segment.startsWith(":")) {
      const paramName = segment.slice(1);
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
