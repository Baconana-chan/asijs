/**
 * Response Caching Plugin for AsiJS
 * 
 * ETag generation, If-None-Match handling, and cache headers.
 * 
 * @example
 * ```ts
 * import { Asi, cache, etag } from "asijs";
 * 
 * const app = new Asi();
 * 
 * // Auto ETag for all responses
 * app.use(etag());
 * 
 * // Cache specific routes
 * app.get("/api/data", handler, {
 *   afterHandle: cache({ ttl: "1h", private: false })
 * });
 * 
 * // Or use as a plugin
 * app.plugin(cachePlugin({ defaultTtl: "5m" }));
 * ```
 */

import { createPlugin, type AsiPlugin } from "./plugin";
import type { Context } from "./context";
import type { Middleware, AfterHandler } from "./types";

// ===== Types =====

export type TTL = number | `${number}s` | `${number}m` | `${number}h` | `${number}d`;

export interface CacheOptions {
  /**
   * Time-to-live for cache
   * Can be number (seconds) or string like "1h", "30m", "1d"
   */
  ttl?: TTL;
  
  /**
   * Whether cache is private (per-user) or public (shared)
   * @default false (public)
   */
  private?: boolean;
  
  /**
   * Stale-while-revalidate time
   */
  staleWhileRevalidate?: TTL;
  
  /**
   * Stale-if-error time
   */
  staleIfError?: TTL;
  
  /**
   * Must revalidate with server
   * @default false
   */
  mustRevalidate?: boolean;
  
  /**
   * No cache at all
   * @default false
   */
  noCache?: boolean;
  
  /**
   * No store (don't cache at all)
   * @default false
   */
  noStore?: boolean;
  
  /**
   * Immutable content (never changes)
   * @default false
   */
  immutable?: boolean;
  
  /**
   * Custom cache key generator
   */
  key?: (ctx: Context) => string;
  
  /**
   * Vary headers
   */
  vary?: string[];
}

export interface ETagOptions {
  /**
   * Weak ETag (W/"...")
   * @default false
   */
  weak?: boolean;
  
  /**
   * Custom ETag generator
   */
  generator?: (body: string | Uint8Array) => string;
  
  /**
   * Skip ETag for certain content types
   */
  skipContentTypes?: string[];
  
  /**
   * Minimum body size to generate ETag (bytes)
   * @default 0
   */
  minSize?: number;
}

export interface CachePluginOptions {
  /**
   * Default TTL for cached responses
   */
  defaultTtl?: TTL;
  
  /**
   * Paths to cache (glob patterns)
   */
  paths?: string[];
  
  /**
   * Paths to exclude from caching
   */
  exclude?: string[];
  
  /**
   * Enable ETag generation
   * @default true
   */
  etag?: boolean | ETagOptions;
}

// ===== Helpers =====

/**
 * Parse TTL to seconds
 */
export function parseTTL(ttl: TTL): number {
  if (typeof ttl === "number") return ttl;
  
  const match = ttl.match(/^(\d+)(s|m|h|d)$/);
  if (!match) throw new Error(`Invalid TTL format: ${ttl}`);
  
  const value = parseInt(match[1], 10);
  const unit = match[2];
  
  switch (unit) {
    case "s": return value;
    case "m": return value * 60;
    case "h": return value * 3600;
    case "d": return value * 86400;
    default: return value;
  }
}

/**
 * Generate ETag from content
 */
export async function generateETag(
  content: string | Uint8Array | ArrayBuffer, 
  weak = false
): Promise<string> {
  let data: Uint8Array;
  
  if (typeof content === "string") {
    data = new TextEncoder().encode(content);
  } else if (content instanceof ArrayBuffer) {
    data = new Uint8Array(content);
  } else {
    data = content;
  }
  
  // Use Bun's fast hash if available, otherwise Web Crypto
  const hashBuffer = await crypto.subtle.digest("SHA-1", data as BufferSource);
  const hashArray = new Uint8Array(hashBuffer);
  const hashHex = Array.from(hashArray.slice(0, 8))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
  
  const etag = `"${hashHex}"`;
  return weak ? `W/${etag}` : etag;
}

/**
 * Build Cache-Control header value
 */
export function buildCacheControl(options: CacheOptions): string {
  const parts: string[] = [];
  
  if (options.noStore) {
    return "no-store";
  }
  
  if (options.noCache) {
    parts.push("no-cache");
  }
  
  if (options.private) {
    parts.push("private");
  } else {
    parts.push("public");
  }
  
  if (options.ttl !== undefined) {
    parts.push(`max-age=${parseTTL(options.ttl)}`);
  }
  
  if (options.staleWhileRevalidate !== undefined) {
    parts.push(`stale-while-revalidate=${parseTTL(options.staleWhileRevalidate)}`);
  }
  
  if (options.staleIfError !== undefined) {
    parts.push(`stale-if-error=${parseTTL(options.staleIfError)}`);
  }
  
  if (options.mustRevalidate) {
    parts.push("must-revalidate");
  }
  
  if (options.immutable) {
    parts.push("immutable");
  }
  
  return parts.join(", ");
}

// ===== ETag Middleware =====

/**
 * Create ETag middleware that auto-generates ETags and handles If-None-Match
 */
export function etag(options: ETagOptions = {}): Middleware {
  const {
    weak = false,
    skipContentTypes = ["text/event-stream", "multipart/"],
    minSize = 0,
  } = options;
  
  return async (ctx, next) => {
    const response = await next();
    
    if (!(response instanceof Response)) {
      return response;
    }
    
    // Skip for non-2xx responses
    if (response.status < 200 || response.status >= 300) {
      return response;
    }
    
    // Skip for streaming/multipart
    const contentType = response.headers.get("Content-Type") ?? "";
    if (skipContentTypes.some(skip => contentType.includes(skip))) {
      return response;
    }
    
    // Get body for ETag generation
    const body = await response.clone().arrayBuffer();
    
    // Skip if too small
    if (body.byteLength < minSize) {
      return response;
    }
    
    // Generate ETag
    const etagValue = options.generator 
      ? options.generator(new Uint8Array(body))
      : await generateETag(body, weak);
    
    // Check If-None-Match
    const ifNoneMatch = ctx.header("If-None-Match");
    if (ifNoneMatch) {
      // Parse multiple ETags
      const clientETags = ifNoneMatch.split(",").map(e => e.trim());
      
      if (clientETags.includes(etagValue) || clientETags.includes("*")) {
        // Return 304 Not Modified
        return new Response(null, {
          status: 304,
          headers: {
            ETag: etagValue,
          },
        });
      }
    }
    
    // Add ETag to response
    const newHeaders = new Headers(response.headers);
    newHeaders.set("ETag", etagValue);
    
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  };
}

// ===== Cache AfterHandle =====

/**
 * Create cache afterHandle hook for route-level caching
 */
export function cache(options: CacheOptions = {}): AfterHandler {
  const cacheControl = buildCacheControl(options);
  
  return async (ctx, response) => {
    if (!(response instanceof Response)) {
      return response;
    }
    
    const newHeaders = new Headers(response.headers);
    newHeaders.set("Cache-Control", cacheControl);
    
    // Add Vary headers
    if (options.vary && options.vary.length > 0) {
      const existing = newHeaders.get("Vary");
      const newVary = existing 
        ? [...existing.split(",").map(v => v.trim()), ...options.vary].join(", ")
        : options.vary.join(", ");
      newHeaders.set("Vary", newVary);
    }
    
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  };
}

/**
 * Create cache middleware (for use with app.use())
 */
export function cacheMiddleware(options: CacheOptions = {}): Middleware {
  const afterHandle = cache(options);
  
  return async (ctx, next) => {
    const response = await next();
    return afterHandle(ctx, response);
  };
}

// ===== No Cache Helpers =====

/**
 * No-cache middleware for dynamic content
 */
export function noCache(): AfterHandler {
  return cache({ noCache: true, noStore: true });
}

/**
 * Middleware to disable caching
 */
export function noCacheMiddleware(): Middleware {
  return cacheMiddleware({ noCache: true, noStore: true });
}

// ===== In-Memory Cache Store =====

interface CacheEntry<T> {
  value: T;
  expires: number;
  etag?: string;
}

export class MemoryCache<T = unknown> {
  private store = new Map<string, CacheEntry<T>>();
  private cleanupInterval: Timer | null = null;
  
  constructor(cleanupIntervalMs = 60_000) {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, cleanupIntervalMs);
  }
  
  set(key: string, value: T, ttl: TTL, etag?: string): void {
    const ttlSeconds = parseTTL(ttl);
    this.store.set(key, {
      value,
      expires: Date.now() + ttlSeconds * 1000,
      etag,
    });
  }
  
  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    
    if (Date.now() > entry.expires) {
      this.store.delete(key);
      return undefined;
    }
    
    return entry.value;
  }
  
  getWithMeta(key: string): CacheEntry<T> | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    
    if (Date.now() > entry.expires) {
      this.store.delete(key);
      return undefined;
    }
    
    return entry;
  }
  
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }
  
  delete(key: string): boolean {
    return this.store.delete(key);
  }
  
  clear(): void {
    this.store.clear();
  }
  
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expires) {
        this.store.delete(key);
      }
    }
  }
  
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.store.clear();
  }
  
  get size(): number {
    return this.store.size;
  }
}

// ===== Response Cache Middleware =====

/**
 * Full response caching middleware with store
 */
export function responseCacheMiddleware(options: {
  ttl: TTL;
  keyGenerator?: (ctx: Context) => string;
  store?: MemoryCache<{ body: string; headers: Record<string, string>; status: number }>;
  methods?: string[];
} = { ttl: "5m" }): Middleware {
  const {
    ttl,
    keyGenerator = (ctx) => `${ctx.method}:${ctx.path}:${ctx.request.url}`,
    store = new MemoryCache(),
    methods = ["GET", "HEAD"],
  } = options;
  
  return async (ctx, next) => {
    // Only cache specified methods
    if (!methods.includes(ctx.method)) {
      return next();
    }
    
    const cacheKey = keyGenerator(ctx);
    
    // Check cache
    const cached = store.getWithMeta(cacheKey);
    if (cached) {
      // Check If-None-Match
      const ifNoneMatch = ctx.header("If-None-Match");
      if (ifNoneMatch && cached.etag && ifNoneMatch === cached.etag) {
        return new Response(null, {
          status: 304,
          headers: { ETag: cached.etag },
        });
      }
      
      // Return cached response
      const headers = new Headers(cached.value.headers);
      headers.set("X-Cache", "HIT");
      if (cached.etag) {
        headers.set("ETag", cached.etag);
      }
      
      return new Response(cached.value.body, {
        status: cached.value.status,
        headers,
      });
    }
    
    // Get fresh response
    const response = await next();
    
    if (!(response instanceof Response)) {
      return response;
    }
    
    // Only cache successful responses
    if (response.status < 200 || response.status >= 300) {
      return response;
    }
    
    // Cache the response
    const body = await response.clone().text();
    const headersObj: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headersObj[key] = value;
    });
    
    const etagValue = await generateETag(body);
    
    store.set(cacheKey, {
      body,
      headers: headersObj,
      status: response.status,
    }, ttl, etagValue);
    
    // Add cache headers
    const newHeaders = new Headers(response.headers);
    newHeaders.set("X-Cache", "MISS");
    newHeaders.set("ETag", etagValue);
    newHeaders.set("Cache-Control", buildCacheControl({ ttl }));
    
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  };
}

// ===== Cache Plugin =====

/**
 * Create caching plugin
 */
export function cachePlugin(options: CachePluginOptions = {}): AsiPlugin {
  const middlewares: Middleware[] = [];
  
  // Add ETag middleware if enabled
  if (options.etag !== false) {
    const etagOptions = typeof options.etag === "object" ? options.etag : {};
    middlewares.push(etag(etagOptions));
  }
  
  return createPlugin({
    name: "cache",
    middleware: middlewares,
    
    decorate: {
      cacheStore: new MemoryCache(),
    },
  });
}

// ===== Presets =====

/**
 * Static asset cache headers (1 year, immutable)
 */
export const staticCache: CacheOptions = {
  ttl: "365d",
  immutable: true,
  private: false,
};

/**
 * API response cache (short TTL, private)
 */
export const apiCache: CacheOptions = {
  ttl: "1m",
  private: true,
  mustRevalidate: true,
};

/**
 * CDN-friendly cache (public, with SWR)
 */
export const cdnCache: CacheOptions = {
  ttl: "1h",
  private: false,
  staleWhileRevalidate: "5m",
  staleIfError: "1d",
};
