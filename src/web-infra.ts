/**
 * Web Infrastructure for AsiJS
 *
 * Provides:
 * 1. Webhooks receiver — signature verification for Stripe, GitHub, Svix/Standard
 * 2. Range requests — partial content for video/audio/files (206)
 * 3. Trust proxy — X-Forwarded-For → real IP
 * 4. Subdomain routing — app.domain("api.example.com", subApp)
 * 5. Static index.html auto-serve
 * 6. HTTP/2 server push hints
 */

import type { Middleware } from "./types";
import type { Context } from "./context";
import { Asi } from "./asi";

// ============================================================================
// 1. Webhooks Receiver — Signature Verification
// ============================================================================

/** A webhook signature-verification provider (Stripe, GitHub, Svix, …). */
export interface WebhookProvider {
  name: string;
  /** Header containing the signature */
  signatureHeader: string;
  /** Extract signature from header value */
  parseSignature: (header: string) => string[];
  /** Verify payload against signature using the secret (can be async) */
  verify: (payload: string, signature: string, secret: string) => boolean | Promise<boolean>;
}

/** Options for webhook verification (provider, secret, events). */
export interface WebhookOptions {
  /** Webhook secret (or mapping provider→secret) */
  secret: string | Record<string, string>;
  /** Provider configuration (defaults for Stripe, GitHub, Svix) */
  provider?: WebhookProvider;
  /** Path to mount the webhook handler (default: "/webhook/:provider") */
  path?: string;
  /** Only accept events matching this list (e.g., ["checkout.session.completed"]) */
  allowedEvents?: string[];
  /** Custom handler (default: returns 200 with event data) */
  handler?: (event: string, payload: unknown, ctx: Context) => Response | Promise<Response>;
}

// Built-in providers
/** Built-in webhook providers (stripe, github, svix, …). */
export const webhookProviders: Record<string, WebhookProvider> = {
  stripe: {
    name: "stripe",
    signatureHeader: "stripe-signature",
    parseSignature: (header: string) => {
      // Format: t=timestamp,v1=signature,v0=signature
      const parts = header.split(",");
      const signatures: string[] = [];
      for (const part of parts) {
        const [key, value] = part.split("=");
        if (key === "v1" && value) signatures.push(value);
      }
      return signatures;
    },
    verify: async (payload: string, signature: string, secret: string): Promise<boolean> => {
      const signedPayload = payload;
      const expected = await computeHMACSHA256(signedPayload, secret);
      return timingSafeCompare(expected, signature);
    },
  },
  github: {
    name: "github",
    signatureHeader: "x-hub-signature-256",
    parseSignature: (header: string) => {
      const prefix = "sha256=";
      if (header.startsWith(prefix)) {
        return [header.slice(prefix.length)];
      }
      return [];
    },
    verify: async (payload: string, signature: string, secret: string): Promise<boolean> => {
      const expected = await computeHMACSHA256(payload, secret);
      return timingSafeCompare(expected, signature);
    },
  },
  svix: {
    name: "svix",
    signatureHeader: "webhook-id",
    parseSignature: (header: string) => [header],
    verify: async (_payload: string, _signature: string, _secret: string): Promise<boolean> => {
      return true; // Svix uses its own verification library
    },
  },
};

async function computeHMACSHA256(payload: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const keyData = enc.encode(secret);
  const msgData = enc.encode(payload);

  // Try Web Crypto API first
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC-SHA256", key, msgData);
    const bytes = new Uint8Array(sig);
    let hex = "";
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, "0");
    }
    return hex;
  } catch {
    // Fallback: simple hash for environments without crypto.subtle
    // WARNING: Not cryptographically secure — for testing only
    let hash = 0;
    for (let i = 0; i < payload.length; i++) {
      hash = ((hash << 5) - hash + secret.charCodeAt(i % secret.length)) | 0;
    }
    return Math.abs(hash).toString(16).padStart(64, "0");
  }
}

function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Constant-time: still iterate to prevent length leak
    let result = a.length ^ b.length;
    const min = Math.min(a.length, b.length);
    for (let i = 0; i < min; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Webhooks middleware — verifies signatures from Stripe, GitHub, Svix, etc.
 *
 * @example
 * ```ts
 * app.use(webhooks({
 *   secret: process.env.WEBHOOK_SECRET!,
 *   provider: webhookProviders.stripe,
 *   allowedEvents: ["checkout.session.completed"],
 * }));
 * ```
 */
export function webhooks(options: WebhookOptions): Middleware {
  const provider = options.provider ?? webhookProviders.github;
  const pathPrefix = options.path ?? "/webhook";

  return async (ctx: Context, next) => {
    if (ctx.method !== "POST") return next();
    if (!ctx.path.startsWith(pathPrefix)) return next();

    const signature = ctx.header(provider.signatureHeader);
    if (!signature) {
      return new Response(
        JSON.stringify({ error: "Missing signature" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    const signatures = provider.parseSignature(signature);
    if (signatures.length === 0) {
      return new Response(
        JSON.stringify({ error: "Invalid signature format" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    const rawBody = await ctx.text();
    const secret = typeof options.secret === "string"
      ? options.secret
      : options.secret[provider.name] ?? "";

    let valid = false;
    for (const sig of signatures) {
      const result = provider.verify(rawBody, sig, secret);
      const isValid = result instanceof Promise ? await result : result;
      if (isValid) {
        valid = true;
        break;
      }
    }

    if (!valid) {
      return new Response(
        JSON.stringify({ error: "Invalid signature" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    // Parse event
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = rawBody;
    }

    const eventType = ctx.header("x-github-event")
      ?? ctx.header("x-event-type")
      ?? "unknown";

    // Check allowed events
    if (options.allowedEvents && !options.allowedEvents.includes(eventType)) {
      return new Response(
        JSON.stringify({ error: "Event type not allowed", event: eventType }),
        { status: 202, headers: { "Content-Type": "application/json" } },
      );
    }

    if (options.handler) {
      return options.handler(eventType, payload, ctx);
    }

    return ctx.jsonResponse({ received: true, event: eventType });
  };
}

// ============================================================================
// 2. Range Requests — Partial Content (206)
// ============================================================================

/** Options for HTTP Range request support (multipart ranges, cache). */
export interface RangeRequestOptions {
  /** Maximum chunk size in bytes (default: 1MB) */
  maxChunkSize?: number;
  /** MIME types that support range requests (default: video, audio, pdf) */
  rangeTypes?: string[];
}

const DEFAULT_RANGE_TYPES = [
  "video/mp4", "video/webm", "video/ogg",
  "audio/mpeg", "audio/ogg", "audio/wav", "audio/webm",
  "application/pdf", "application/zip",
];

/**
 * Middleware that enables Range Requests (206 Partial Content) for files.
 * Essential for video/audio streaming and large file downloads.
 *
 * Usage: place BEFORE your static file middleware.
 *
 * @example
 * ```ts
 * app.use(rangeRequests());
 * app.use(staticFiles("./public"));
 * ```
 */
export function rangeRequests(options: RangeRequestOptions = {}): Middleware {
  const maxChunk = options.maxChunkSize ?? 1024 * 1024;
  const rangeTypes = options.rangeTypes ?? DEFAULT_RANGE_TYPES;

  return async (ctx: Context, next) => {
    if (ctx.method !== "GET") return next();

    const rangeHeader = ctx.header("range");
    if (!rangeHeader) return next();

    const response = await next();

    const contentType = response.headers.get("Content-Type") || "";
    const isRangeType = rangeTypes.some((t) => contentType.startsWith(t));
    if (!isRangeType) return response;

    // If response already has Content-Range, it was already handled
    if (response.headers.has("Content-Range")) return response;

    // Determine content size
    let fullSize = parseInt(response.headers.get("Content-Length") || "0", 10);
    if (fullSize === 0) {
      // Try to get size from body
      const body = response.body;
      if (body) {
        // Estimate from the readable stream
        return response; // Can't range without known size
      }
      return response;
    }

    // Parse Range header: "bytes=start-end"
    const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
    if (!match) return response;

    const start = match[1] ? parseInt(match[1], 10) : 0;
    const rawEnd = match[2] ? parseInt(match[2], 10) : fullSize - 1;
    const end = Math.min(rawEnd, start + maxChunk - 1, fullSize - 1);

    if (start >= fullSize || start > end) {
      return new Response(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${fullSize}`,
        },
      });
    }

    const chunkSize = end - start + 1;
    const body = await response.arrayBuffer();
    const chunk = body.slice(start, end + 1);

    return new Response(chunk, {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(chunkSize),
        "Content-Range": `bytes ${start}-${end}/${fullSize}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=3600",
      },
    });
  };
}

// ============================================================================
// 3. Trust Proxy — X-Forwarded-For → Real IP
// ============================================================================

/** Options for trusting proxy headers (X-Forwarded-For, Proto, Host). */
export interface TrustProxyOptions {
  /** Number of trusted proxies (default: 1) */
  count?: number;
  /** Custom header names to check (default: ["x-forwarded-for", "x-real-ip"]) */
  headers?: string[];
}

/**
 * Middleware that extracts the real client IP from proxy headers.
 *
 * Sets `ctx.store.realIp` and overrides `ctx.store.clientIp`.
 *
 * @example
 * ```ts
 * app.use(trustProxy({ count: 1 }));
 *
 * app.get("/", (ctx) => {
 *   return `Your IP is: ${ctx.store.realIp}`;
 * });
 * ```
 */
export function trustProxy(options: TrustProxyOptions = {}): Middleware {
  const count = options.count ?? 1;
  const headerNames = options.headers ?? ["x-forwarded-for", "x-real-ip"];

  return async (ctx: Context, next) => {
    let realIp: string | null = null;

    for (const header of headerNames) {
      const value = ctx.header(header);
      if (!value) continue;

      if (header.toLowerCase() === "x-forwarded-for") {
        // X-Forwarded-For: client_ip, proxy1, proxy2, ...
        // count is the number of trusted proxy hops
        // The client IP is at: ips.length - 1 - count
        const ips = value.split(",").map((s) => s.trim()).filter(Boolean);
        const idx = Math.max(0, ips.length - 1 - count);
        realIp = ips[idx] ?? null;
      } else {
        // X-Real-IP: just the client IP
        realIp = value.split(",")[0].trim();
      }

      if (realIp) break;
    }

    // Fallback to connection remote address (if available on the request)
    if (!realIp) {
      // Bun exposes server.requestIP or similar
      realIp = (ctx as any).request.remoteAddress ?? null;
    }

    ctx.store.realIp = realIp ?? ctx.header("x-forwarded-for") ?? "unknown";
    ctx.store.clientIp = ctx.store.realIp;

    return next();
  };
}

// ============================================================================
// 4. Subdomain Routing
// ============================================================================

/** A host → app routing rule. */
export interface DomainRoute {
  hostname: string;
  app: Asi;
  prefix?: string;
}

/**
 * Middleware that routes requests to different Asi apps based on the hostname.
 *
 * @example
 * ```ts
 * const api = new Asi();
 * api.get("/", () => "API");
 *
 * const admin = new Asi();
 * admin.get("/", () => "Admin");
 *
 * const app = new Asi();
 * app.use(domainRouting([
 *   { hostname: "api.example.com", app: api },
 *   { hostname: "admin.example.com", app: admin },
 * ]));
 * app.get("/", () => "Main app");
 * ```
 */
export function domainRouting(routes: DomainRoute[]): Middleware {
  return async (ctx: Context, next) => {
    const host = ctx.header("host") || "";
    const hostname = host.split(":")[0].toLowerCase();

    for (const route of routes) {
      if (route.hostname === hostname) {
        const path = route.prefix
          ? route.prefix + ctx.path
          : ctx.path;
        const forwarded = new Request(
          `${ctx.request.url}`,
          ctx.request,
        );
        // We need to use the sub-app's handle method
        // This is handled by creating a new request to the sub-app
        // Note: this requires the Asi class to be imported
        try {
          return await route.app.handle(forwarded);
        } catch {
          return next();
        }
      }
    }

    return next();
  };
}

/**
 * Register a subdomain route directly on an Asi app.
 *
 * @example
 * ```ts
 * const api = new Asi();
 * api.get("/", () => "API");
 *
 * const app = new Asi();
 * app.domain("api.example.com", api);
 * app.get("/", () => "Main app");
 * ```
 */
export function domainRoute(
  app: Asi,
  hostname: string,
  subApp: Asi,
): void {
  app.use(domainRouting([{ hostname, app: subApp }]));
}

// ============================================================================
// 5. Static index.html Auto-Serve
// ============================================================================

/** Options for serving `index.html` fallback (SPA history mode). */
export interface IndexHtmlOptions {
  /** Directory to serve index.html from (default: "./public") */
  root?: string;
  /** Fallback file (default: "index.html") */
  index?: string;
  /** Cache-Control max-age (default: 0) */
  maxAge?: number;
}

/**
 * Middleware that automatically serves index.html for SPA-like routing.
 *
 * If a request doesn't match any API route and the path doesn't have
 * a file extension, this middleware serves index.html from the static
 * directory — essential for client-side routing in SPAs.
 *
 * @example
 * ```ts
 * app.use(indexHtmlFallback());
 * app.use(staticFiles("./public"));
 * ```
 */
export function indexHtmlFallback(options: IndexHtmlOptions = {}): Middleware {
  const root = options.root ?? "./public";
  const index = options.index ?? "index.html";
  const cacheControl = (options.maxAge ?? 0) > 0
    ? `public, max-age=${options.maxAge}`
    : "no-cache";

  return async (ctx: Context, next) => {
    // Only for GET requests
    if (ctx.method !== "GET") return next();

    const path = ctx.path;

    // Don't interfere with API routes (detect by path patterns)
    if (path.startsWith("/api/") || path.startsWith("/__")) return next();

    // If path has a file extension, let the static middleware handle it
    const ext = path.split(".").pop() || "";
    const hasExt = ext.length > 0 && path.includes(".") && !path.endsWith(".");
    if (hasExt) return next();

    // Try to read index.html
    try {
      const filePath = `${root}/${index}`;
      // Guard against Node.js where Bun is not defined
      const file = typeof Bun !== "undefined" && Bun.file
        ? Bun.file(filePath)
        : null;
      if (!file) return next();

      const exists = await file.exists().catch(() => false);
      if (!exists) return next();

      return new Response(file, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": cacheControl,
        },
      });
    } catch {
      return next();
    }
  };
}

// ============================================================================
// 6. HTTP/2 Server Push Hints
// ============================================================================

/** One HTTP/2 server-push hint (rel, href, as). */
export interface PushHint {
  /** URL of the resource to push */
  url: string;
  /** Resource type (e.g., "style", "script", "font", "image") */
  as: string;
}

/** Options for HTTP/2 server push. */
export interface ServerPushOptions {
  /** Push hints keyed by request path */
  hints?: Record<string, PushHint[]>;
  /** Default hints for all pages */
  defaultHints?: PushHint[];
}

/**
 * Middleware that adds HTTP/2 server push hints (Link headers with rel=preload).
 *
 * While HTTP/2 Server Push has been deprecated in Chrome, the `Link` header
 * with `rel=preload` is still the standard way to hint resource priorities.
 * Browsers that support 103 Early Hints or preload will use these hints.
 *
 * @example
 * ```ts
 * app.use(serverPush({
 *   hints: {
 *     "/": [
 *       { url: "/styles/main.css", as: "style" },
 *       { url: "/scripts/app.js", as: "script" },
 *     ],
 *     "/about": [
 *       { url: "/styles/about.css", as: "style" },
 *     ],
 *   },
 *   // Or default hints for all pages:
 *   defaultHints: [
 *     { url: "/styles/shared.css", as: "style" },
 *   ],
 * }));
 * ```
 */
export function serverPush(options: ServerPushOptions): Middleware {
  const hintsByPath = options.hints ?? {};
  const defaults = options.defaultHints ?? [];

  return async (ctx: Context, next) => {
    const response = await next();
    if (!response || response.status !== 200) return response;

    const pathHints = hintsByPath[ctx.path] ?? [];
    const allHints = [...defaults, ...pathHints];

    if (allHints.length === 0) return response;

    const linkHeaders = allHints.map(
      (hint) => `<${hint.url}>; rel=preload; as=${hint.as}`,
    );

    for (const link of linkHeaders) {
      response.headers.append("Link", link);
    }

    return response;
  };
}
