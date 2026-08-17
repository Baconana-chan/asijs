/**
 * Rate Limiting Plugin for AsiJS
 *
 * Implements token bucket and sliding window algorithms
 * with in-memory storage (Redis support can be added).
 *
 * @example
 * ```ts
 * import { Asi, rateLimit } from "asijs";
 *
 * const app = new Asi();
 *
 * // Global rate limiting
 * app.plugin(rateLimit({
 *   max: 100,           // 100 requests
 *   windowMs: 60_000,   // per minute
 * }));
 *
 * // Per-route rate limiting
 * app.get("/api/expensive", handler, {
 *   beforeHandle: rateLimitMiddleware({
 *     max: 10,
 *     windowMs: 60_000,
 *   })
 * });
 * ```
 */

import { createPlugin, type AsiPlugin } from "./plugin";
import type { BeforeHandler, Middleware } from "./types";
import type { Context } from "./context";

// ===== Types =====

/** Rate-limiting options (max, window, algorithm, store, custom handler/skip). */
export interface RateLimitOptions {
  /** Maximum number of requests in the window */
  max: number;

  /** Time window in milliseconds */
  windowMs: number;

  /**
   * Function to generate a unique key for the client
   * Default: uses IP address
   */
  keyGenerator?: (ctx: Context) => string;

  /**
   * Function to determine if request should be rate limited
   * Return false to skip rate limiting for this request
   */
  skip?: (ctx: Context) => boolean | Promise<boolean>;

  /**
   * Custom response when rate limited
   */
  handler?: (ctx: Context, info: RateLimitInfo) => Response | Promise<Response>;

  /**
   * Headers to include in response
   * @default true
   */
  headers?: boolean;

  /**
   * Algorithm to use
   * - "sliding-window": More accurate, uses sliding window counter
   * - "token-bucket": Smoother rate limiting with burst support
   * @default "sliding-window"
   */
  algorithm?: "sliding-window" | "token-bucket";

  /**
   * Store to use for rate limit data
   * @default MemoryStore
   */
  store?: RateLimitStore;

  /**
   * Message to return when rate limited
   */
  message?: string;

  /**
   * HTTP status code when rate limited
   * @default 429
   */
  statusCode?: number;
}

/** Rate-limit result: limit, remaining, reset time and retry-after. */
export interface RateLimitInfo {
  /** Total requests allowed in window */
  limit: number;
  /** Remaining requests in current window */
  remaining: number;
  /** Time when the rate limit resets (Unix timestamp in seconds) */
  resetTime: number;
  /** Time until reset in milliseconds */
  retryAfter: number;
}

/** Storage abstraction for rate-limit counters (increment / reset / cleanup). */
export interface RateLimitStore {
  /** Increment the counter and get current info */
  increment(key: string, windowMs: number, max: number): Promise<RateLimitInfo>;
  /** Reset the counter for a key */
  reset(key: string): Promise<void>;
  /** Clean up expired entries */
  cleanup?(): Promise<void>;
}

// ===== Memory Store (Sliding Window) =====

interface SlidingWindowEntry {
  count: number;
  startTime: number;
}

/** In-memory sliding-window rate-limit store. */
export class MemoryStore implements RateLimitStore {
  private store = new Map<string, SlidingWindowEntry>();
  private cleanupInterval: Timer | null = null;

  constructor(cleanupIntervalMs = 60_000) {
    // Periodic cleanup of expired entries
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, cleanupIntervalMs);
  }

  async increment(
    key: string,
    windowMs: number,
    max: number,
  ): Promise<RateLimitInfo> {
    const now = Date.now();
    let entry = this.store.get(key);

    if (!entry || now - entry.startTime >= windowMs) {
      // Start new window
      entry = { count: 1, startTime: now };
      this.store.set(key, entry);
    } else {
      // Increment in current window
      entry.count++;
    }

    const resetTime = Math.ceil((entry.startTime + windowMs) / 1000);
    const retryAfter = Math.max(0, entry.startTime + windowMs - now);

    // remaining = max - count (can go negative when over limit)
    // e.g. max=2: count=1 -> remaining=1, count=2 -> remaining=0, count=3 -> remaining=-1 (blocked)
    return {
      limit: max,
      remaining: max - entry.count,
      resetTime,
      retryAfter,
    };
  }

  async reset(key: string): Promise<void> {
    this.store.delete(key);
  }

  async cleanup(): Promise<void> {
    const now = Date.now();
    // We don't know windowMs here, so we'll keep entries for 1 hour max
    const maxAge = 3600_000;

    for (const [key, entry] of this.store) {
      if (now - entry.startTime > maxAge) {
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
}

// ===== Token Bucket Store =====

interface TokenBucketEntry {
  tokens: number;
  lastRefill: number;
}

/** Token-bucket rate-limit store with burst support. */
export class TokenBucketStore implements RateLimitStore {
  private store = new Map<string, TokenBucketEntry>();
  private cleanupInterval: Timer | null = null;

  constructor(cleanupIntervalMs = 60_000) {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, cleanupIntervalMs);
  }

  async increment(
    key: string,
    windowMs: number,
    max: number,
  ): Promise<RateLimitInfo> {
    const now = Date.now();
    let entry = this.store.get(key);

    // Refill rate: max tokens per windowMs
    const refillRate = max / windowMs; // tokens per ms

    if (!entry) {
      // New bucket, start with max - 1 tokens (consuming one for this request)
      entry = { tokens: max - 1, lastRefill: now };
      this.store.set(key, entry);
    } else {
      // Refill tokens based on time passed
      const elapsed = now - entry.lastRefill;
      const refill = elapsed * refillRate;
      entry.tokens = Math.min(max, entry.tokens + refill);
      entry.lastRefill = now;

      // Consume one token
      entry.tokens -= 1;
    }

    const resetTime = Math.ceil((now + windowMs) / 1000);
    const retryAfter =
      entry.tokens < 0 ? Math.ceil(-entry.tokens / refillRate) : 0;

    return {
      limit: max,
      remaining: Math.floor(entry.tokens),
      resetTime,
      retryAfter,
    };
  }

  async reset(key: string): Promise<void> {
    this.store.delete(key);
  }

  async cleanup(): Promise<void> {
    const now = Date.now();
    const maxAge = 3600_000;

    for (const [key, entry] of this.store) {
      if (now - entry.lastRefill > maxAge) {
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
}

// ===== Key Generators =====

/**
 * Preset key generators for common rate limiting patterns.
 *
 * @example
 * ```ts
 * import { rateLimit, rateLimitPresets } from "asijs";
 *
 * // Rate limit by IP address
 * app.plugin(rateLimit({
 *   max: 100,
 *   windowMs: 60_000,
 *   keyGenerator: rateLimitPresets.byIp,
 * }));
 *
 * // Rate limit by API key header
 * app.use(rateLimitMiddlewareFunc({
 *   max: 1000,
 *   windowMs: 3600_000,
 *   keyGenerator: rateLimitPresets.byApiKey("X-API-Key"),
 * }));
 *
 * // Rate limit by user ID (from session or auth)
 * app.use(rateLimitMiddlewareFunc({
 *   max: 50,
 *   windowMs: 60_000,
 *   keyGenerator: rateLimitPresets.byUserId,
 * }));
 *
 * // Combine multiple identifiers
 * app.use(rateLimitMiddlewareFunc({
 *   max: 200,
 *   windowMs: 60_000,
 *   keyGenerator: rateLimitPresets.combine(
 *     rateLimitPresets.byIp,
 *     rateLimitPresets.byApiKey("Authorization"),
 *   ),
 * }));
 * ```
 */
export const rateLimitPresets = {
  /**
   * Rate limit by client IP address.
   *
   * Checks X-Forwarded-For, X-Real-IP headers,
   * then falls back to "default-client".
   */
  byIp: function byIp(ctx: Context): string {
    const forwardedFor = ctx.header("X-Forwarded-For");
    if (forwardedFor) {
      return forwardedFor.split(",")[0].trim();
    }
    const realIp = ctx.header("X-Real-IP");
    if (realIp) return realIp;
    return "default-client";
  },

  /**
   * Rate limit by a specific request header (e.g., API key).
   * Falls back to IP address if header is missing.
   *
   * @param headerName - The header to use as identifier
   * @returns A key generator function
   *
   * @example
   * ```ts
   * keyGenerator: rateLimitPresets.byApiKey("X-API-Key")
   * ```
   */
  byApiKey:
    (headerName = "X-API-Key"): ((ctx: Context) => string) =>
    (ctx: Context): string => {
      const apiKey = ctx.header(headerName);
      if (apiKey) return apiKey.trim();
      // Fallback to IP
      return rateLimitPresets.byIp(ctx);
    },

  /**
   * Rate limit by user ID.
   *
   * Reads from `ctx.session?.userId`, `ctx.params.userId`,
   * or falls back to IP address.
   *
   * @example
   * ```ts
   * keyGenerator: rateLimitPresets.byUserId
   * ```
   */
  byUserId: function byUserId(ctx: Context): string {
    // Check session for authenticated user ID
    const session = (ctx as any).session;
    if (session && typeof session.get === "function") {
      const userId = session.get("userId");
      if (userId) return `user:${userId}`;
    }
    // Fallback to IP (safe — never use URL params for auth)
    return rateLimitPresets.byIp(ctx);
  },

  /**
   * Rate limit by a custom request header.
   * Similar to byApiKey but without API-specific naming.
   *
   * @param headerName - The header name to use
   * @param prefix - Optional prefix for the key (e.g., "header:")
   * @returns A key generator function
   */
  byHeader:
    (
      headerName: string,
      prefix?: string,
    ): ((ctx: Context) => string) =>
    (ctx: Context): string => {
      const value = ctx.header(headerName);
      if (value) {
        const key = value.trim();
        return prefix ? `${prefix}${key}` : `header:${headerName}:${key}`;
      }
      return rateLimitPresets.byIp(ctx);
    },

  /**
   * Combine multiple key generators into one.
   *
   * The resulting key is a combination of all generator outputs,
   * useful when you want to rate limit by multiple dimensions
   * (e.g., IP + API key).
   *
   * @param generators - Key generator functions to combine
   * @returns A combined key generator function
   *
   * @example
   * ```ts
   * keyGenerator: rateLimitPresets.combine(
   *   rateLimitPresets.byIp,
   *   rateLimitPresets.byApiKey(),
   * )
   * // Produces keys like: "192.168.1.1:api-key-123"
   * ```
   */
  combine:
    (
      ...generators: Array<(ctx: Context) => string>
    ): ((ctx: Context) => string) =>
    (ctx: Context): string =>
      generators.map((fn) => fn(ctx)).join(":"),
};

/** @internal Default key generator — uses IP */
function defaultKeyGenerator(ctx: Context): string {
  return rateLimitPresets.byIp(ctx);
}

// ===== Default Handler =====

function defaultHandler(
  ctx: Context,
  info: RateLimitInfo,
  message: string,
  statusCode: number,
): Response {
  return new Response(
    JSON.stringify({
      error: "Too Many Requests",
      message,
      retryAfter: Math.ceil(info.retryAfter / 1000),
    }),
    {
      status: statusCode,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(Math.ceil(info.retryAfter / 1000)),
        "X-RateLimit-Limit": String(info.limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(info.resetTime),
      },
    },
  );
}

// ===== Rate Limit Middleware =====

/**
 * Create a rate limiting beforeHandle hook for individual routes
 *
 * @example
 * ```ts
 * app.get("/api/expensive", handler, {
 *   beforeHandle: rateLimitMiddleware({
 *     max: 10,
 *     windowMs: 60_000,
 *   })
 * });
 * ```
 */
export function rateLimitMiddleware(options: RateLimitOptions): BeforeHandler {
  const {
    max,
    windowMs,
    keyGenerator = defaultKeyGenerator,
    skip,
    handler,
    headers = true,
    algorithm = "sliding-window",
    message = "Too many requests, please try again later.",
    statusCode = 429,
  } = options;

  const store =
    options.store ??
    (algorithm === "token-bucket" ? new TokenBucketStore() : new MemoryStore());

  return async (ctx: Context): Promise<void | Response> => {
    // Skip if configured
    if (skip && (await skip(ctx))) {
      return;
    }

    const key = keyGenerator(ctx);
    const info = await store.increment(key, windowMs, max);

    // Add rate limit headers
    if (headers) {
      ctx.setHeader("X-RateLimit-Limit", String(info.limit));
      ctx.setHeader("X-RateLimit-Remaining", String(info.remaining));
      ctx.setHeader("X-RateLimit-Reset", String(info.resetTime));
    }

    // Check if rate limited (remaining went negative means we're over the limit)
    if (info.remaining < 0) {
      if (handler) {
        return handler(ctx, info);
      }
      return defaultHandler(ctx, info, message, statusCode);
    }
  };
}

/**
 * Create rate limiting as a middleware (for use with app.use())
 */
export function rateLimitMiddlewareFunc(options: RateLimitOptions): Middleware {
  const beforeHandle = rateLimitMiddleware(options);

  return async (ctx, next) => {
    const result = await beforeHandle(ctx);
    if (result instanceof Response) {
      return result;
    }
    return next();
  };
}

// ===== Rate Limit Plugin =====

/**
 * Create global rate limiting plugin
 *
 * @example
 * ```ts
 * app.plugin(rateLimit({
 *   max: 100,
 *   windowMs: 60_000,
 *   keyGenerator: (ctx) => ctx.header("X-API-Key") ?? ctx.header("X-Forwarded-For") ?? "anon",
 * }));
 * ```
 */
export function rateLimit(options: RateLimitOptions): AsiPlugin {
  return createPlugin({
    name: "rate-limit",
    beforeHandle: rateLimitMiddleware(options),
  });
}

// ===== Presets =====

/** Standard rate limit: 100 requests per minute */
export const standardLimit = (
  overrides?: Partial<RateLimitOptions>,
): RateLimitOptions => ({
  max: 100,
  windowMs: 60_000,
  ...overrides,
});

/** Strict rate limit: 20 requests per minute */
export const strictLimit = (
  overrides?: Partial<RateLimitOptions>,
): RateLimitOptions => ({
  max: 20,
  windowMs: 60_000,
  ...overrides,
});

/** API rate limit: 1000 requests per hour */
export const apiLimit = (
  overrides?: Partial<RateLimitOptions>,
): RateLimitOptions => ({
  max: 1000,
  windowMs: 3600_000,
  ...overrides,
});

/** Auth rate limit: 5 attempts per 15 minutes (for login endpoints) */
export const authLimit = (
  overrides?: Partial<RateLimitOptions>,
): RateLimitOptions => ({
  max: 5,
  windowMs: 900_000, // 15 minutes
  message: "Too many authentication attempts, please try again later.",
  ...overrides,
});

// ========================================================================
// Tenant Rate Limiting (for Workspace / Multi-Tenant)
// ========================================================================

/**
 * Tenant-aware rate limit store.
 * Wraps any RateLimitStore and prefixes keys with the tenant ID
 * so that each tenant's counters are fully isolated.
 */
export class TenantStore implements RateLimitStore {
  private inner: RateLimitStore;
  private tenantId: string;

  constructor(tenantId: string, inner?: RateLimitStore) {
    this.tenantId = tenantId;
    this.inner = inner ?? new MemoryStore();
  }

  private tenantKey(key: string): string {
    return `${this.tenantId}:${key}`;
  }

  async increment(
    key: string,
    windowMs: number,
    max: number,
  ): Promise<RateLimitInfo> {
    return this.inner.increment(this.tenantKey(key), windowMs, max);
  }

  async reset(key: string): Promise<void> {
    return this.inner.reset(this.tenantKey(key));
  }

  async cleanup(): Promise<void> {
    if (this.inner.cleanup) {
      await this.inner.cleanup();
    }
  }
}

/**
 * Options for workspace/tenant rate limiting.
 */
export interface TenantRateLimitOptions {
  /**
   * Tenant identifier.
   * Defaults to ASIJS_APP_NAME env var, then ASIJS_TENANT_ID, then "default".
   */
  tenantId?: string;

  /** Max requests in the window per tenant */
  max?: number;

  /** Time window in milliseconds */
  windowMs?: number;

  /** Custom store (will be wrapped with TenantStore) */
  store?: RateLimitStore;

  /** Algorithm to use */
  algorithm?: "sliding-window" | "token-bucket";

  /** Custom key generator (default: IP-based) */
  keyGenerator?: (ctx: Context) => string;

  /** Skip rate limiting for certain requests */
  skip?: (ctx: Context) => boolean | Promise<boolean>;

  /** Custom response when rate limited */
  handler?: (ctx: Context, info: RateLimitInfo) => Response | Promise<Response>;

  /** Message when rate limited */
  message?: string;

  /** HTTP status code when rate limited (default: 429) */
  statusCode?: number;
}

/**
 * Default env-based options for workspace rate limiting.
 * Reads from environment variables:
 *   ASIJS_APP_NAME | ASIJS_TENANT_ID  — tenant identifier
 *   ASIJS_RATE_LIMIT_MAX               — max requests (default: 1000)
 *   ASIJS_RATE_LIMIT_WINDOW_MS         — window in ms (default: 60_000)
 *   ASIJS_RATE_LIMIT_ENABLED           — set "0" or "false" to disable
 */
export function defaultTenantOptions(): TenantRateLimitOptions {
  const enabled = process.env.ASIJS_RATE_LIMIT_ENABLED;
  if (enabled === "0" || enabled === "false" || enabled === "no") {
    return { max: Infinity, windowMs: 1 };
  }

  return {
    tenantId:
      process.env.ASIJS_APP_NAME ??
      process.env.ASIJS_TENANT_ID ??
      "default",
    max: Number(process.env.ASIJS_RATE_LIMIT_MAX) || 1000,
    windowMs: Number(process.env.ASIJS_RATE_LIMIT_WINDOW_MS) || 60_000,
  };
}

/**
 * Create a tenant-isolated rate limit plugin for workspace sub-apps.
 *
 * Automatically reads tenant config from environment variables
 * (set by the workspace controller), so sub-apps can just call:
 *
 * @example
 * ```ts
 * import { Asi, workspaceRateLimit } from "asijs";
 *
 * const app = new Asi();
 * app.plugin(workspaceRateLimit());
 * ```
 *
 * The workspace controller (asiDev) automatically injects:
 *   ASIJS_APP_NAME → tenant ID
 *   ASIJS_RATE_LIMIT_MAX → per-tenant request limit
 *   ASIJS_RATE_LIMIT_WINDOW_MS → time window
 */
export function workspaceRateLimit(
  options?: TenantRateLimitOptions,
): AsiPlugin {
  const resolved: TenantRateLimitOptions = {
    ...defaultTenantOptions(),
    ...options,
  };

  const inner = rateLimit({
    max: resolved.max ?? 1000,
    windowMs: resolved.windowMs ?? 60_000,
    store: new TenantStore(
      resolved.tenantId ?? "default",
      resolved.store,
    ),
    keyGenerator: resolved.keyGenerator,
    skip: resolved.skip,
    handler: resolved.handler,
    message: resolved.message,
    statusCode: resolved.statusCode,
    algorithm: resolved.algorithm,
  });

  return inner;
}

/**
 * Create tenant-aware rate limit middleware for individual routes.
 */
export function tenantRateLimitMiddleware(
  options?: TenantRateLimitOptions,
): BeforeHandler {
  const resolved: TenantRateLimitOptions = {
    ...defaultTenantOptions(),
    ...options,
  };

  return rateLimitMiddleware({
    max: resolved.max ?? 1000,
    windowMs: resolved.windowMs ?? 60_000,
    store: new TenantStore(
      resolved.tenantId ?? "default",
      resolved.store,
    ),
    keyGenerator: resolved.keyGenerator,
    skip: resolved.skip,
    handler: resolved.handler,
    message: resolved.message,
    statusCode: resolved.statusCode,
    algorithm: resolved.algorithm,
  });
}
