/**
 * Request Deduplication & Cache Stampede Protection for AsiJS
 *
 * Features:
 * 1. **Request Deduplication** — identical concurrent requests are merged;
 *    only one reaches the backend, others share the result.
 * 2. **Cache Stampede Protection** — probabilistic early expiration (XFetch
 *    algorithm) prevents multiple workers from refreshing the same key
 *    simultaneously.
 * 3. **MemoryCache / Redis integration** — plug any cache store that
 *    supports get/set with TTL.
 *
 * @example
 * ```ts
 * import { Asi, deduplicate, MemoryCache } from "asijs";
 *
 * const app = new Asi();
 *
 * // Simple — dedup by URL
 * app.use(deduplicate());
 *
 * // With cache stampede protection
 * const cache = new MemoryCache();
 * app.use(deduplicate({
 *   cache,
 *   ttl: 5000,            // cache TTL (ms)
 *   xfetch: true,          // enable XFetch early expiration
 *   // Key by URL + query
 *   keyGenerator: (ctx) => `${ctx.path}:${JSON.stringify(ctx.query)}`,
 * }));
 *
 * // With Redis-like store
 * app.use(deduplicate({
 *   cache: redisClient,     // any { get, set } compatible store
 *   ttl: 10_000,
 * }));
 * ```
 */

import type { Middleware } from "./types";
import type { Context } from "./context";
import { MemoryCache } from "./cache";

// ============================================================================
// Types
// ============================================================================

/** Cache store interface — compatible with MemoryCache and Redis-like stores */
export interface DedupCacheStore<T = unknown> {
  get(key: string): T | undefined | Promise<T | undefined>;
  set(key: string, value: T, ttlMs: number): void | Promise<void>;
}

/** Snapshot of deduplication metrics */
export interface DedupMetrics {
  /** Total requests received */
  totalRequests: number;
  /** Requests that were deduplicated (merged into an in-flight request) */
  deduplicatedRequests: number;
  /** Requests that went to the backend (cache miss or first request) */
  backendRequests: number;
  /** Cache hits (returned cached response without hitting backend) */
  cacheHits: number;
  /** XFetch early refreshes (probabilistic expiry triggered refresh) */
  xfetchRefreshes: number;
  /** Number of unique keys currently in-flight */
  inflightCount: number;
  /** Number of unique keys currently cached */
  cachedCount: number;
  /** Average wait time for deduplicated requests (ms) */
  avgDedupWaitMs: number;
}

/** Options for the deduplicate middleware */
export interface DeduplicateOptions {
  /**
   * Custom key generator for deduplication.
   * Default: `ctx.method + ":" + ctx.path + ":" + ctx.request.url`
   */
  keyGenerator?: (ctx: Context) => string;

  /**
   * Maximum time (ms) to wait for an in-flight request before falling back.
   * When exceeded, the waiting request gets a fallback response.
   * @default 5000 (5 seconds)
   */
  maxWaitMs?: number;

  /**
   * Fallback response when the wait time exceeds maxWaitMs.
   * Default: 503 Service Unavailable with "Request deduplication timeout".
   */
  fallback?: (ctx: Context) => Response | Promise<Response>;

  /**
   * Optional cache store for caching results.
   * When provided, cached results are returned on subsequent requests.
   *
   * Can be a MemoryCache instance, a Redis-like client with `get`/`set`,
   * or any object implementing DedupCacheStore.
   */
  cache?: DedupCacheStore;

  /**
   * Cache TTL in milliseconds (when cache is provided).
   * @default 5000 (5 seconds)
   */
  ttl?: number;

  /**
   * Enable XFetch probabilistic early expiration for cache stampede protection.
   * When true, cached items near their expiry have a probability of being
   * refreshed early, preventing thundering herds.
   * @default false (disabled)
   */
  xfetch?: boolean;

  /**
   * XFetch beta parameter — controls how aggressive the early refresh is.
   * Higher values = more early refreshes (more protection, more load).
   * Typical values: 0.5–2.0.
   * @default 1.0
   */
  xfetchBeta?: number;

  /**
   * HTTP methods to deduplicate. Only these methods are intercepted.
   * @default ["GET", "HEAD"]
   */
  methods?: string[];

  /**
   * Skip deduplication for certain requests.
   * Return true to skip dedup for this request.
   */
  skip?: (ctx: Context) => boolean | Promise<boolean>;
}

// ============================================================================
// In-Flight Request Manager
// ============================================================================

interface InflightEntry {
  promise: Promise<Response>;
  startTime: number;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Manages in-flight requests for deduplication.
 *
 * Tracks requests by key and allows subsequent identical requests
 * to await the same promise instead of hitting the backend again.
 */
export class InflightManager {
  private _inflight = new Map<string, InflightEntry>();

  /**
   * Get an existing in-flight request promise.
   * Returns undefined if no request is in-flight for this key.
   */
  get(key: string): { promise: Promise<Response>; waitTime: number } | undefined {
    const entry = this._inflight.get(key);
    if (!entry) return undefined;
    return {
      promise: entry.promise,
      waitTime: Date.now() - entry.startTime,
    };
  }

  /**
   * Track a new in-flight request.
   * Stores the promise and a timeout to clean up on max wait.
   */
  set(
    key: string,
    promise: Promise<Response>,
    maxWaitMs: number,
    onTimeout: () => void,
  ): void {
    const entry: InflightEntry = {
      promise,
      startTime: Date.now(),
      timer: setTimeout(() => {
        // Clean up on timeout
        this._inflight.delete(key);
        onTimeout();
      }, maxWaitMs),
    };
    this._inflight.set(key, entry);
  }

  /**
   * Remove a completed in-flight request.
   */
  delete(key: string): void {
    const entry = this._inflight.get(key);
    if (entry) {
      if (entry.timer) clearTimeout(entry.timer);
      this._inflight.delete(key);
    }
  }

  /**
   * Check if a key is currently in-flight.
   */
  has(key: string): boolean {
    return this._inflight.has(key);
  }

  /**
   * Get the number of in-flight requests.
   */
  get size(): number {
    return this._inflight.size;
  }

  /**
   * Clear all in-flight requests (for cleanup).
   */
  clear(): void {
    for (const entry of this._inflight.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this._inflight.clear();
  }
}

// ============================================================================
// XFetch — Probabilistic Early Expiration
// ============================================================================

/**
 * XFetch algorithm for cache stampede protection.
 *
 * Given a cached item with age `age`, TTL `ttl`, and beta parameter `beta`,
 * the probability of early refresh is:
 *
 *   P(refresh) = beta * (age / ttl)
 *
 * As the item approaches its TTL, the probability increases linearly.
 * Beta controls the trade-off between protection and extra load.
 * Beta = 1.0 means ~50% chance of refresh at 50% of TTL.
 */
export function xfetchShouldRefresh(
  age: number,
  ttl: number,
  beta: number,
): boolean {
  if (age <= 0 || ttl <= 0) return false;
  const ratio = age / ttl;
  if (ratio >= 1) return true; // Expired — always refresh
  const probability = beta * ratio;
  return Math.random() < probability;
}

/**
 * Create an XFetch-enabled cache wrapper.
 * Wraps a cache store and adds probabilistic early expiration logic.
 */
export function xfetchWrap(
  store: DedupCacheStore,
  options: {
    ttl: number;
    beta?: number;
    onRefresh?: (key: string) => void;
  },
): DedupCacheStore {
  const beta = options.beta ?? 1.0;
  const ttl = options.ttl;

  // Internal store for creation timestamps (needed for XFetch age calculation)
  const timestamps = new Map<string, number>();
  // Stale values store — when early refresh is triggered, the stale value
  // is kept here for fallback if the backend call fails.
  const staleValues = new Map<string, unknown>();

  return {
    get(key: string): unknown | undefined {
      const value = store.get(key);
      if (value === undefined || value === null) return undefined;

      // Check XFetch: should we refresh early?
      const createdAt = timestamps.get(key);
      if (createdAt !== undefined) {
        const age = Date.now() - createdAt;
        if (xfetchShouldRefresh(age, ttl, beta)) {
          // Probabilistic early refresh triggered!
          // Save the stale value for fallback, then return undefined
          // to force a backend call.
          staleValues.set(key, value);
          options.onRefresh?.(key);
          return undefined;
        }
      }

      return value;
    },

    set(key: string, value: unknown, ttlMs: number): void {
      timestamps.set(key, Date.now());
      staleValues.delete(key);
      store.set(key, value, ttlMs);
    },

    getStale(key: string): unknown | undefined {
      return staleValues.get(key);
    },
  } as DedupCacheStore & { getStale: (key: string) => unknown | undefined };
}

// ============================================================================
// Default Key Generator
// ============================================================================

function defaultKeyGenerator(ctx: Context): string {
  return `${ctx.method}:${ctx.path}:${ctx.request.url}`;
}

// ============================================================================
// Deduplication Middleware
// ============================================================================

/**
 * Create a deduplication middleware that merges identical concurrent requests.
 *
 * @example
 * ```ts
 * // Simple URL-based dedup
 * app.use(deduplicate());
 *
 * // With caching and XFetch protection
 * app.use(deduplicate({
 *   cache: new MemoryCache(),
 *   ttl: 5000,
 *   xfetch: true,
 * }));
 *
 * // With custom key and fallback
 * app.use(deduplicate({
 *   keyGenerator: (ctx) => ctx.header("X-Request-Id") ?? ctx.path,
 *   maxWaitMs: 2000,
 *   fallback: (ctx) => new Response("Timeout", { status: 503 }),
 * }));
 * ```
 */
export function deduplicate(options: DeduplicateOptions = {}): Middleware {
  const {
    keyGenerator = defaultKeyGenerator,
    maxWaitMs = 5000,
    fallback: fallbackFn,
    cache: cacheStore,
    ttl = 5000,
    xfetch: useXFetch = false,
    xfetchBeta = 1.0,
    methods = ["GET", "HEAD"],
    skip,
  } = options;

  const inflight = new InflightManager();
  let totalRequests = 0;
  let deduplicatedRequests = 0;
  let backendRequests = 0;
  let cacheHits = 0;
  let xfetchRefreshes = 0;
  let totalDedupWait = 0;

  // Wrap cache with XFetch if enabled
  const effectiveCache: DedupCacheStore | undefined = useXFetch && cacheStore
    ? xfetchWrap(cacheStore, {
        ttl,
        beta: xfetchBeta,
        onRefresh: (key) => { xfetchRefreshes++; },
      })
    : cacheStore;

  return async (ctx: Context, next: () => Promise<Response>): Promise<Response> => {
    // Only deduplicate specified methods
    if (!methods.includes(ctx.method)) {
      return next();
    }

    // Skip check
    if (skip && (await skip(ctx))) {
      return next();
    }

    totalRequests++;
    const key = keyGenerator(ctx);

    // === Step 1: Check cache first ===
    if (effectiveCache) {
      const cached = await Promise.resolve(effectiveCache.get(key));
      if (cached !== undefined && cached !== null) {
        cacheHits++;
        // Cached data is stored as { body, status, headers } — reconstruct Response
        const data = cached as { body: string; status: number; headers: Record<string, string> };
        if (typeof data === 'object' && data !== null && 'body' in data) {
          return new Response(data.body, {
            status: data.status,
            headers: data.headers,
          });
        }
        // Fallback: try to use as-is (backward compat)
        return _cloneResponse(cached as unknown as Response);
      }
    }

    // === Step 2: Check in-flight ===
    const inflightEntry = inflight.get(key);
    if (inflightEntry) {
      deduplicatedRequests++;
      totalDedupWait += inflightEntry.waitTime;

      // Wait for the in-flight request, but not longer than maxWaitMs
      const timeoutPromise = new Promise<Response>((resolve) => {
        const timer = setTimeout(() => {
          if (fallbackFn) {
            resolve(fallbackFn(ctx));
          } else {
            resolve(
              new Response(
                JSON.stringify({ error: "Request deduplication timeout" }),
                {
                  status: 503,
                  headers: { "Content-Type": "application/json" },
                },
              ),
            );
          }
        }, maxWaitMs - inflightEntry.waitTime);
        // Clean up timer if the promise resolves first
        inflightEntry.promise.finally(() => clearTimeout(timer));
      });

      // Clone the response so each waiter gets their own body stream
      return Promise.race([
        inflightEntry.promise.then((res) => _cloneResponse(res)),
        timeoutPromise,
      ]);
    }

    // === Step 3: First request — go to backend ===
    backendRequests++;

    // Create the promise for this request
    const responsePromise = (async (): Promise<Response> => {
      try {
        const response = await next();

        // Cache the response if caching is enabled (only 2xx responses)
        if (effectiveCache && response.status >= 200 && response.status < 300) {
          const body = await response.clone().text();
          const headers: Record<string, string> = {};
          response.headers.forEach((v, k) => { headers[k] = v; });
          await Promise.resolve(effectiveCache.set(key, { body, status: response.status, headers }, ttl));
        }

        return response;
      } catch (err) {
        // If the backend fails, try to use a stale value (from XFetch)
        const staleStore = effectiveCache as any;
        const staleValue = typeof staleStore?.getStale === 'function' ? staleStore.getStale(key) : undefined;
        if (staleValue) {
          const data = staleValue as { body: string; status: number; headers: Record<string, string> };
          if (typeof data === 'object' && data !== null && 'body' in data) {
            return new Response(data.body, {
              status: data.status,
              headers: data.headers,
            });
          }
        }
        // No stale value — return 503
        return new Response(
          JSON.stringify({ error: "Backend error" }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      } finally {
        inflight.delete(key);
      }
    })();

    inflight.set(key, responsePromise, maxWaitMs, () => {
      // Timeout cleanup — if the original request is still going
      // and no fallback was configured, just let it complete silently
    });

    return responsePromise;
  };
}

// ============================================================================
// Presets
// ============================================================================

/**
 * Preset: Simple URL-based deduplication for API routes.
 * Deduplicates concurrent GET/HEAD requests by URL.
 */
export function simpleDeduplicate(overrides?: Partial<DeduplicateOptions>): Middleware {
  return deduplicate({
    methods: ["GET", "HEAD"],
    maxWaitMs: 3000,
    ...overrides,
  });
}

/**
 * Preset: Cached deduplication with XFetch stampede protection.
 * Caches GET responses for 10 seconds and uses probabilistic early expiration.
 */
export function cachedDeduplicate(overrides?: Partial<DeduplicateOptions>): Middleware {
  return deduplicate({
    cache: new MemoryCache(),
    ttl: 10_000,
    xfetch: true,
    xfetchBeta: 1.0,
    methods: ["GET", "HEAD"],
    maxWaitMs: 3000,
    ...overrides,
  });
}

/**
 * Preset: Aggressive deduplication for expensive queries.
 * Longer TTL (30s), higher XFetch beta for more protection, longer wait.
 */
export function expensiveQueryDeduplicate(overrides?: Partial<DeduplicateOptions>): Middleware {
  return deduplicate({
    cache: new MemoryCache(),
    ttl: 30_000,
    xfetch: true,
    xfetchBeta: 2.0,
    methods: ["GET", "HEAD"],
    maxWaitMs: 5000,
    ...overrides,
  });
}

// ============================================================================
// Helper: Clone a Response (preserves body, status, headers)
// ============================================================================

/**
 * Clone a Response object, creating an independent copy.
 * Unlike Response.clone(), this works even if the body was already cloned.
 */
function _cloneResponse(res: Response): Response {
  // If the response can be cloned, do it
  try {
    return res.clone();
  } catch {
    // If clone fails (body already used), create a new response
    // Try to read from a stored body
    const status = res.status;
    const headers = new Headers(res.headers);
    return new Response(null, { status, headers });
  }
}

// Re-export MemoryCache for convenience
export { MemoryCache } from "./cache";
