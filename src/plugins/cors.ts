/**
 * Advanced CORS Plugin for AsiJS
 *
 * Supports dynamic origins, wildcard/subdomain matching, async resolvers,
 * private network access, and Vary: Origin for proper caching.
 *
 * @example
 * ```ts
 * import { Asi } from "asijs";
 * import { cors } from "asijs/plugins/cors";
 *
 * const app = new Asi();
 *
 * // Allow all origins (reflects Origin header)
 * app.use(cors());
 *
 * // Specific origin
 * app.use(cors({ origin: "https://example.com" }));
 *
 * // Multiple origins
 * app.use(cors({
 *   origin: ["https://app.example.com", "https://admin.example.com"],
 * }));
 *
 * // Wildcard subdomain matching
 * app.use(cors({ origin: "*.example.com" }));
 *
 * // Async origin resolver (database, API)
 * app.use(cors({
 *   origin: async (origin) => {
 *     const allowed = await db.isOriginAllowed(origin);
 *     return allowed;
 *   },
 * }));
 *
 * // With credentials and custom headers
 * app.use(cors({
 *   origin: "https://app.example.com",
 *   credentials: true,
 *   exposedHeaders: ["X-Request-ID", "X-Response-Time"],
 * }));
 * ```
 */

import type { Middleware } from "../types";
import type { Context } from "../context";

export interface CorsOptions {
  /**
   * Allowed origins.
   *
   * - `true` (default): reflects the request Origin header (safe with credentials)
   * - `false`: no CORS headers
   * - `string`: exact match, or wildcard `*` / `*.example.com`
   * - `string[]`: list of exact matches or wildcards
   * - `(origin: string) => boolean | Promise<boolean>`: sync/async function
   *
   * Wildcard `*.example.com` matches `app.example.com`, `admin.example.com`, etc.
   * Use `"*"` to match all origins (but credentials will be omitted unless origin is reflected).
   *
   * @default true (reflects Origin header, safe with credentials)
   */
  origin?: boolean | string | string[] | ((origin: string) => boolean | Promise<boolean>);

  /**
   * Allowed HTTP methods
   * @default ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH"]
   */
  methods?: string[];

  /**
   * Allowed request headers.
   * If empty, reflects Access-Control-Request-Headers from preflight.
   * @default []
   */
  allowedHeaders?: string[];

  /**
   * Response headers exposed to the client.
   * Common: X-Request-ID, X-Response-Time, Content-Disposition
   * @default []
   */
  exposedHeaders?: string[];

  /**
   * Allow credentials (cookies, authorization headers).
   * When true, origin must be explicit (not "*").
   * @default false
   */
  credentials?: boolean;

  /**
   * Preflight cache TTL in seconds.
   * @default 86400 (24 hours)
   */
  maxAge?: number;

  /**
   * Auto-respond to preflight (OPTIONS) requests.
   * @default true
   */
  preflight?: boolean;

  /**
   * Enable "Access-Control-Allow-Private-Network" header
   * for CORS-RFC1918 (private network access).
   * @default false
   */
  privateNetworkAccess?: boolean;

  /**
   * Optional cache for resolved origins when using async resolver.
   * Cache key = origin string, value = boolean.
   * Pass a Map to share across requests (e.g., with TTL cleanup).
   *
   * @example
   * ```ts
   * const originCache = new Map<string, boolean>();
   * app.use(cors({
   *   origin: async (o) => checkDb(o),
   *   originCache,
   * }));
   * // Clear cache periodically
   * setInterval(() => originCache.clear(), 60_000);
   * ```
   */
  originCache?: Map<string, boolean>;
}

const DEFAULT_METHODS = ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH"];
const DEFAULT_MAX_AGE = 86400;

/** Match an origin against a wildcard pattern (e.g., "*.example.com") */
function matchWildcard(pattern: string, origin: string): boolean {
  // Convert wildcard pattern to regex
  // *.example.com → /^.*\.example\.com$/
  // *.app.example.com → /^.*\.app\.example\.com$/
  // * → /^.*$/
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape special regex chars
    .replace(/\*/g, ".*"); // convert * to regex .*
  return new RegExp(`^${escaped}$`, "i").test(origin);
}

/** Normalize origin — strip trailing slash */
function normalizeOrigin(origin: string): string {
  return origin.replace(/\/+$/, "");
}

/**
 * Create CORS middleware with advanced features.
 */
export function cors(options: CorsOptions = {}): Middleware {
  const {
    origin = true,
    methods = DEFAULT_METHODS,
    allowedHeaders = [],
    exposedHeaders = [],
    credentials = false,
    maxAge = DEFAULT_MAX_AGE,
    preflight = true,
    privateNetworkAccess: pna = false,
    originCache,
  } = options;

  const methodsHeader = methods.join(", ");
  const exposedHeadersHeader =
    exposedHeaders.length > 0 ? exposedHeaders.join(", ") : null;

  // Pre-compile static origins for fast matching
  const staticOrigins = new Set<string>();
  const wildcardPatterns: string[] = [];

  if (typeof origin === "string") {
    if (origin === "*") {
      // "*" is handled in resolveOrigin with an explicit early return
    } else if (origin.includes("*")) {
      wildcardPatterns.push(normalizeOrigin(origin));
    } else {
      staticOrigins.add(normalizeOrigin(origin));
    }
  } else if (Array.isArray(origin)) {
    for (const o of origin) {
      const normalized = normalizeOrigin(o);
      if (normalized.includes("*")) {
        wildcardPatterns.push(normalized);
      } else {
        staticOrigins.add(normalized);
      }
    }
  }

  // Resolve origin — returns allowed origin string or null
  const resolveOrigin = async (
    requestOrigin: string | null,
  ): Promise<string | null> => {
    if (!requestOrigin) return null;

    const normalized = normalizeOrigin(requestOrigin);

    // Case 1: true — reflect origin (safe with credentials)
    if (origin === true) {
      return normalized;
    }

    // Case 2: false — deny all
    if (origin === false) {
      return null;
    }

    // Case 3: "*" — allow all (no credentials)
    if (origin === "*") {
      return "*";
    }

    // Case 4: Function resolver (sync or async)
    if (typeof origin === "function") {
      // Check cache first
      if (originCache?.has(normalized)) {
        return originCache.get(normalized) ? normalized : null;
      }

      try {
        const allowed = await origin(normalized);
        originCache?.set(normalized, !!allowed);
        return allowed ? normalized : null;
      } catch {
        return null;
      }
    }

    // Case 5: Static string or array — check exact match or wildcard
    if (staticOrigins.has(normalized)) {
      return normalized;
    }

    // Check wildcard patterns
    for (const pattern of wildcardPatterns) {
      if (matchWildcard(pattern, normalized)) {
        return normalized;
      }
    }

    return null;
  };

  return async (
    ctx: Context,
    next: () => Promise<Response>,
  ): Promise<Response> => {
    const requestOrigin = ctx.header("Origin");
    const allowedOrigin = await resolveOrigin(requestOrigin);

    // Preflight request (OPTIONS)
    if (preflight && ctx.method === "OPTIONS") {
      const headers = new Headers();

      if (allowedOrigin) {
        // With credentials, origin must be explicit (not "*")
        if (credentials && allowedOrigin === "*") {
          // Reflect the actual origin when credentials + wildcard
          headers.set("Access-Control-Allow-Origin", requestOrigin ?? "*");
        } else {
          headers.set("Access-Control-Allow-Origin", allowedOrigin);
        }
      }

      headers.set("Access-Control-Allow-Methods", methodsHeader);

      // Reflect requested headers or use configured
      const requestedHeaders = ctx.header("Access-Control-Request-Headers");
      if (requestedHeaders && allowedHeaders.length === 0) {
        headers.set("Access-Control-Allow-Headers", requestedHeaders);
      } else if (allowedHeaders.length > 0) {
        headers.set("Access-Control-Allow-Headers", allowedHeaders.join(", "));
      }

      if (credentials) {
        headers.set("Access-Control-Allow-Credentials", "true");
      }

      headers.set("Access-Control-Max-Age", String(maxAge));

      // Private network access (CORS-RFC1918)
      if (pna && ctx.header("Access-Control-Request-Private-Network")) {
        headers.set("Access-Control-Allow-Private-Network", "true");
      }

      // Vary on Origin for preflight too
      headers.set("Vary", "Origin");

      return new Response(null, { status: 204, headers });
    }

    // Normal request — add CORS headers to response
    const response = await next();

    if (allowedOrigin) {
      // With credentials, origin must be explicit
      if (credentials && allowedOrigin === "*") {
        response.headers.set(
          "Access-Control-Allow-Origin",
          requestOrigin ?? "*",
        );
      } else {
        response.headers.set("Access-Control-Allow-Origin", allowedOrigin);
      }
    }

    if (credentials) {
      response.headers.set("Access-Control-Allow-Credentials", "true");
    }

    if (exposedHeadersHeader) {
      response.headers.set(
        "Access-Control-Expose-Headers",
        exposedHeadersHeader,
      );
    }

    // Vary: Origin for proper caching (CDN, browser)
    const vary = response.headers.get("Vary");
    if (vary) {
      if (!vary.includes("Origin")) {
        response.headers.set("Vary", `${vary}, Origin`);
      }
    } else {
      response.headers.set("Vary", "Origin");
    }

    return response;
  };
}

export default cors;
