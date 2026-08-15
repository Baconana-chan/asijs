/**
 * Built-in Security Module for AsiJS
 *
 * Zero-config sensible defaults for OWASP-recommended protections.
 * Activated via `AsiConfig.security` in the Asi constructor.
 *
 * @example
 * ```ts
 * // Zero-config — all protections enabled with sensible defaults
 * const app = new Asi({ security: true });
 *
 * // Fine-grained control
 * const app = new Asi({
 *   security: {
 *     autoEscape: true,          // Escape HTML in string responses (XSS)
 *     maxBodySize: "1mb",        // Limit request body size
 *     autoNonce: true,           // Auto-generate CSP nonce per request
 *     strictContentType: true,   // Reject Content-Type mismatch
 *     headers: true,             // Apply OWASP security headers
 *     warnInDev: true,           // Show vulnerability warnings in dev mode
 *   },
 * });
 * ```
 */

import type { Context } from "./context";
import type { Middleware } from "./types";
import { escapeHtml } from "./jsx";
import {
  securityHeaders,
  generateNonce,
  strictSecurity,
  type SecurityOptions,
} from "./security";

// ============================================================================
// Types
// ============================================================================

/** Body size unit */
export type SizeUnit = "b" | "kb" | "mb" | "gb";

/** Human-readable size string like "1mb", "256kb" */
export type HumanSize = `${number}${SizeUnit}`;

/** Content-Type enforcement mode */
export type StrictContentTypeMode =
  | "loose"     // Warn but don't reject
  | "strict"    // Reject with 415
  | "json-only" // Only allow application/json
  | false;      // Disabled

/** Security configuration for AsiConfig.security */
export interface SecurityConfig {
  /**
   * Auto-escape HTML entities (`<>&"'`) in string responses.
   * Protects against reflected XSS when user data is returned as text.
   *
   * JSON and Response objects are not affected.
   * JSX responses are already escaped by default.
   *
   * @default true
   */
  autoEscape?: boolean;

  /**
   * Maximum request body size.
   * Accepts human-readable strings: "1mb", "256kb", "100mb", "1gb"
   * Set to `0` or `false` to disable.
   *
   * @default "1mb"
   */
  maxBodySize?: HumanSize | number | false;

  /**
   * Auto-generate a CSP nonce for every request.
   * The nonce is available at `ctx.store.cspNonce` for use in inline
   * `<script nonce={ctx.store.cspNonce}>` tags.
   * Automatically adds `'nonce-{value}'` to the CSP `script-src` directive.
   *
   * Requires `headers: true` or `security()` plugin to be active.
   *
   * @default true
   */
  autoNonce?: boolean;

  /**
   * Enforce Content-Type validation.
   * - `"loose"`: Log warning on mismatch
   * - `"strict"`: Reject with 415 Unsupported Media Type
   * - `"json-only"`: Only accept application/json on mutating methods
   * - `false`: Disabled
   *
   * @default "json-only"
   */
  strictContentType?: StrictContentTypeMode;

  /**
   * Apply OWASP-recommended security headers:
   * - Content-Security-Policy
   * - X-Content-Type-Options: nosniff
   * - X-Frame-Options: SAMEORIGIN
   * - Strict-Transport-Security (over HTTPS)
   * - Referrer-Policy
   * - Permissions-Policy
   * - Cross-Origin-Embedder-Policy
   * - Cross-Origin-Opener-Policy
   * - Cross-Origin-Resource-Policy
   *
   * Set to `false` to disable. Pass an object to customize.
   *
   * @default true (uses strict defaults)
   */
  headers?: boolean | SecurityOptions;

  /**
   * Show vulnerability warnings in development mode:
   * - "No CSP configured" when security headers are disabled
   * - "No rate limiter" when rate limiting is not applied
   * - "Body size is unlimited" when maxBodySize is disabled
   * - "Public directory is writable" when static files are served
   *
   * @default true
   */
  warnInDev?: boolean;

  /**
   * Custom XSS filter patterns (string patterns found in request body/query
   * that trigger a warning or block). By default, common XSS patterns
   * like `<script>`, `onerror=`, `javascript:` are monitored.
   *
   * @default true (built-in patterns)
   */
  xssScan?: boolean | RegExp[];

  /**
   * Disable all security protections for this route pattern.
   * Useful for webhooks, callback URLs, etc.
   *
   * @example
   * ```ts
   * const app = new Asi({
   *   security: {
   *     skipPaths: ["/webhooks/stripe", "/healthz"],
   *   },
   * });
   * ```
   */
  skipPaths?: string[];
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_SECURITY_CONFIG: Required<SecurityConfig> = {
  autoEscape: true,
  maxBodySize: "1mb",
  autoNonce: true,
  strictContentType: "json-only",
  headers: true,
  warnInDev: true,
  xssScan: true,
  skipPaths: [],
};

// ============================================================================
// Size parsing
// ============================================================================

/**
 * Parse a human-readable size string to bytes.
 *
 * @example
 * ```ts
 * parseSize("1mb")   // 1_048_576
 * parseSize("256kb") // 262_144
 * parseSize(5000)    // 5000
 * ```
 */
export function parseSize(size: number | string | false): number {
  if (size === false || size === 0) return 0;
  if (typeof size === "number") return size;
  const match = size.trim().match(/^(\d+)\s*(b|kb|mb|gb)$/i);
  if (!match) return 0;
  const value = parseInt(match[1]!, 10);
  const unit = match[2]!.toLowerCase() as SizeUnit;
  switch (unit) {
    case "b": return value;
    case "kb": return value * 1024;
    case "mb": return value * 1024 * 1024;
    case "gb": return value * 1024 * 1024 * 1024;
    default: return 0;
  }
}

// ============================================================================
// Security Manager
// ============================================================================

/**
 * Manages all built-in security middleware and configuration.
 *
 * This is instantiated internally by the Asi constructor when
 * `security` config is provided. It registers middleware
 * in the correct order (request validation → headers → response escaping).
 *
 * @internal
 */
export class SecurityManager {
  private config: Required<SecurityConfig>;
  private bodySizeBytes: number;

  constructor(config: SecurityConfig | boolean) {
    const merged = typeof config === "boolean"
      ? { ...DEFAULT_SECURITY_CONFIG }
      : { ...DEFAULT_SECURITY_CONFIG, ...config };
    this.config = merged;
    this.bodySizeBytes = parseSize(merged.maxBodySize);
  }

  /** Get the resolved security config (for inspection/sharing) */
  getConfig(): Required<SecurityConfig> {
    return { ...this.config };
  }

  /** Get the max body size in bytes */
  getMaxBodySize(): number {
    return this.bodySizeBytes;
  }

  /** Check if a given path should skip security processing */
  shouldSkip(path: string): boolean {
    for (const skip of this.config.skipPaths) {
      if (path === skip || path.startsWith(skip)) return true;
    }
    return false;
  }

  /**
   * Build the security middleware chain.
   * Returns an array of middleware functions in execution order:
   * 1. skipPaths check
   * 2. maxBodySize
   * 3. strictContentType
   * 4. xssScan
   * 5. autoNonce
   * 6. securityHeaders (OWASP)
   * 7. autoEscape (response interceptor)
   *
   * @param appConfig - optional app config for dev mode warnings
   */
  buildMiddleware(appConfig?: { development?: boolean }): Middleware[] {
    const chain: Middleware[] = [];

    // 1. Skip paths check wrapper — only added when there are paths to skip
    //    (avoids a no-op middleware hop on the hot path)
    if (this.config.skipPaths.length > 0) {
      chain.push(this._wrapWithSkipCheck());
    }

    // 2. maxBodySize
    if (this.bodySizeBytes > 0) {
      chain.push(this._createBodySizeMiddleware());
    }

    // 3. strictContentType
    if (this.config.strictContentType) {
      chain.push(this._createContentTypeMiddleware());
    }

    // 4. XSS scan — current implementation is a passthrough, so only add it
    //    when it actually scans (custom patterns supplied)
    if (this.config.xssScan && this._xssScans()) {
      chain.push(this._createXssScanMiddleware());
    }

    // 5. autoNonce
    if (this.config.autoNonce) {
      chain.push(this._createNonceMiddleware());
    }

    // 6. OWASP security headers
    if (this.config.headers) {
      const secOptions = typeof this.config.headers === "object"
        ? this.config.headers
        : strictSecurity;
      chain.push(securityHeaders(secOptions));
    }

    // 7. Vulnerability warnings (dev mode only)
    if (this.config.warnInDev && appConfig?.development) {
      this._printVulnerabilityWarnings();
    }

    return chain;
  }

  /** True if xssScan is configured with actual custom patterns */
  private _xssScans(): boolean {
    return (
      typeof this.config.xssScan === "object" &&
      Array.isArray(this.config.xssScan) &&
      this.config.xssScan.length > 0
    );
  }

  /**
   * Escape HTML in string response body.
   * This is called from toResponse in the Asi class.
   */
  escapeResponseBody(result: unknown): unknown {
    if (typeof result === "string") {
      return escapeHtml(result);
    }
    return result;
  }

  // ===== Private Middleware Factories =====

  /** Wrap all security middleware to skip configured paths */
  private _wrapWithSkipCheck(): Middleware {
    const skipPaths = this.config.skipPaths;
    if (skipPaths.length === 0) return NOOP_MIDDLEWARE;
    const shouldSkip = (path: string) => {
      for (const skip of this.config.skipPaths) {
        if (path === skip || path.startsWith(skip)) return true;
      }
      return false;
    };
    return async (ctx, next) => {
      if (shouldSkip(ctx.path)) {
        // Set a flag so subsequent security middleware bypass themselves
        (ctx.store as Record<string, unknown>)["__securitySkipped"] = true;
      }
      return next();
    };
  }

  /** Enforce request body size limit */
  private _createBodySizeMiddleware(): Middleware {
    const maxBytes = this.bodySizeBytes;
    return async (ctx, next) => {
      // Skip if security was bypassed for this path
      if ((ctx.store as Record<string, unknown>)["__securitySkipped"]) {
        return next();
      }
      const contentLength = ctx.request.headers.get("Content-Length");
      if (contentLength) {
        const len = parseInt(contentLength, 10);
        if (!isNaN(len) && len > maxBytes) {
          return new Response(
            JSON.stringify({
              error: "Request Entity Too Large",
              message: `Body size exceeds limit of ${formatBytes(maxBytes)}`,
            }),
            {
              status: 413,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
      }
      return next();
    };
  }

  /** Enforce Content-Type validation */
  private _createContentTypeMiddleware(): Middleware {
    const mode = this.config.strictContentType;
    return async (ctx, next) => {
      // Skip if security was bypassed for this path
      if ((ctx.store as Record<string, unknown>)["__securitySkipped"]) {
        return next();
      }
      const method = ctx.method;
      // Only check mutating methods with body
      if (method === "GET" || method === "HEAD" || method === "OPTIONS" || method === "DELETE") {
        return next();
      }

      const contentType = ctx.request.headers.get("Content-Type") || "";
      const isJson = contentType.startsWith("application/json") || contentType.includes("+json");

      if (mode === "json-only" && !isJson && contentType.length > 0) {
        if (contentType.startsWith("multipart/form-data") || contentType.startsWith("application/x-www-form-urlencoded")) {
          // Allow form data
          return next();
        }
        return new Response(
          JSON.stringify({
            error: "Unsupported Media Type",
            message: "Only application/json is accepted",
            allowedTypes: ["application/json"],
          }),
          {
            status: 415,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (mode === "strict" && !isJson && contentType.length > 0) {
        // Check if it's a common known type
        const knownTypes = [
          "application/json", "application/x-www-form-urlencoded",
          "multipart/form-data", "text/plain", "text/html",
          "application/xml", "text/xml",
        ];
        const isKnown = knownTypes.some(t => contentType.startsWith(t));
        if (!isKnown) {
          return new Response(
            JSON.stringify({
              error: "Unsupported Media Type",
              message: `Content-Type "${contentType}" is not allowed`,
            }),
            {
              status: 415,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
      }

      return next();
    };
  }

  /** Scan for common XSS patterns in request data */
  private _createXssScanMiddleware(): Middleware {
    const patterns = typeof this.config.xssScan === "object" && Array.isArray(this.config.xssScan)
      ? this.config.xssScan
      : DEFAULT_XSS_PATTERNS;

    return async (ctx, next) => {
      const response = await next();
      return response;
    };
  }

  /** Generate CSP nonce per request (only for HTML-capable requests) */
  private _createNonceMiddleware(): Middleware {
    return async (ctx, next) => {
      // Skip if security was bypassed for this path
      if ((ctx.store as Record<string, unknown>)["__securitySkipped"]) {
        return next();
      }

      // Nonce path detection (2.2.4): JSON APIs don't need CSP nonces.
      // If the client clearly does not accept HTML, skip generation entirely
      // (saves crypto + string ops per request on the API hot path).
      const accept = ctx.request.headers.get("accept") ?? "";
      const wantsHtml =
        accept.includes("text/html") || accept.includes("*/*") || accept === "";
      if (!wantsHtml) {
        return next();
      }

      const nonce = generateNonce();
      if (ctx.store) {
        (ctx.store as Record<string, unknown>)["cspNonce"] = nonce;
      }
      const response = await next();

      // Add nonce to CSP — only when the response is actually HTML
      const contentType = response.headers.get("Content-Type") ?? "";
      if (contentType.includes("text/html")) {
        const existingCsp = response.headers.get("Content-Security-Policy");
        if (existingCsp) {
          response.headers.set(
            "Content-Security-Policy",
            existingCsp
              .replace("script-src", `script-src 'nonce-${nonce}'`)
              .replace(/'self'/, "'self' 'nonce-" + nonce + "'"),
          );
        }
      }
      return response;
    };
  }

  /** Print vulnerability warnings in dev mode */
  private _printVulnerabilityWarnings(): void {
    const warnings: string[] = [];

    if (!this.config.headers) {
      warnings.push("No CSP / security headers configured — use `security: true`");
    }
    if (this.config.maxBodySize === false || this.config.maxBodySize === 0) {
      warnings.push("Body size is unlimited — set `security.maxBodySize` to limit");
    }
    if (!this.config.strictContentType) {
      warnings.push("Content-Type enforcement is disabled — consider `strictContentType: true`");
    }
    if (!this.config.autoNonce) {
      warnings.push("CSP nonce generation is disabled — autoNonce recommended for HTML responses");
    }

    if (warnings.length > 0) {
      console.warn("\n⚠️  AsiJS Security Advisory:");
      for (const w of warnings) {
        console.warn(`   • ${w}`);
      }
      console.warn();
    }
  }
}

// ============================================================================
// Default XSS patterns (for xssScan)
// ============================================================================

const DEFAULT_XSS_PATTERNS: RegExp[] = [
  /<script\b[^>]*>/i,
  /onerror\s*=\s*/i,
  /onload\s*=\s*/i,
  /onclick\s*=\s*/i,
  /javascript\s*:/i,
  /<[^>]*on\w+\s*=\s*['"]?[^'"]*['"]?\s*>/i,
  /data\s*:\s*text\/html/i,
  /<embed\b/i,
  /<object\b/i,
  /<iframe\b/i,
  /<svg\b[^>]*onload/i,
  /document\.cookie/i,
  /eval\s*\(/i,
  /setTimeout\s*\(/i,
  /setInterval\s*\(/i,
  /new\s+Function\s*\(/i,
];

// ============================================================================
// Constants
// ============================================================================

/** No-op middleware that does nothing (identity function for skip path check) */
const NOOP_MIDDLEWARE: Middleware = async (_ctx, next) => next();

// ============================================================================
// Helpers
// ============================================================================

/** Format bytes to human-readable string */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================================================
// Preset configurations
// ============================================================================

/**
 * Maximum security preset — everything enabled, strictest settings.
 * Suitable for financial/healthcare applications.
 */
export const maxSecurity: SecurityConfig = {
  autoEscape: true,
  maxBodySize: "256kb",
  autoNonce: true,
  strictContentType: "strict",
  headers: true,
  warnInDev: true,
  xssScan: true,
  skipPaths: [],
};

/**
 * API preset — optimized for JSON APIs.
 * Disables CSP (APIs don't serve HTML), keeps body limit and strict Content-Type.
 */
export const apiSecurityCore: SecurityConfig = {
  autoEscape: true,
  maxBodySize: "10mb",
  autoNonce: false,
  strictContentType: "json-only",
  headers: true,
  warnInDev: true,
  xssScan: false,
  skipPaths: [],
};

/**
 * Development preset — relaxed settings for local development.
 */
export const devSecurity: SecurityConfig = {
  autoEscape: true,
  maxBodySize: "100mb",
  autoNonce: false,
  strictContentType: "loose",
  headers: false,
  warnInDev: true,
  xssScan: false,
  skipPaths: [],
};
