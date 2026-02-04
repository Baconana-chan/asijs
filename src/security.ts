/**
 * Security Headers Plugin for AsiJS
 * 
 * Helmet-like security headers with sensible defaults.
 * Protects against common web vulnerabilities.
 * 
 * @example
 * ```ts
 * import { Asi, security } from "asijs";
 * 
 * const app = new Asi();
 * 
 * // Apply all security headers with defaults
 * app.plugin(security());
 * 
 * // Or customize
 * app.plugin(security({
 *   contentSecurityPolicy: {
 *     directives: {
 *       defaultSrc: ["'self'"],
 *       scriptSrc: ["'self'", "https://cdn.example.com"],
 *     }
 *   },
 *   hsts: { maxAge: 31536000, includeSubDomains: true },
 * }));
 * ```
 */

import { createPlugin, type AsiPlugin } from "./plugin";
import type { Context } from "./context";
import type { Middleware } from "./types";

// ===== Types =====

export interface ContentSecurityPolicyOptions {
  /** Use report-only mode (doesn't block, just reports) */
  reportOnly?: boolean;
  
  /** CSP directives */
  directives?: {
    defaultSrc?: string[];
    scriptSrc?: string[];
    styleSrc?: string[];
    imgSrc?: string[];
    fontSrc?: string[];
    connectSrc?: string[];
    mediaSrc?: string[];
    objectSrc?: string[];
    frameSrc?: string[];
    childSrc?: string[];
    workerSrc?: string[];
    frameAncestors?: string[];
    formAction?: string[];
    baseUri?: string[];
    manifestSrc?: string[];
    upgradeInsecureRequests?: boolean;
    blockAllMixedContent?: boolean;
    reportUri?: string;
    reportTo?: string;
  };
}

export interface HstsOptions {
  /** Max age in seconds */
  maxAge?: number;
  /** Include subdomains */
  includeSubDomains?: boolean;
  /** Preload */
  preload?: boolean;
}

export interface ReferrerPolicyOptions {
  policy?: 
    | "no-referrer"
    | "no-referrer-when-downgrade"
    | "same-origin"
    | "origin"
    | "strict-origin"
    | "origin-when-cross-origin"
    | "strict-origin-when-cross-origin"
    | "unsafe-url";
}

export interface PermissionsPolicyOptions {
  /** Feature permissions */
  features?: {
    accelerometer?: string[];
    ambientLightSensor?: string[];
    autoplay?: string[];
    camera?: string[];
    displayCapture?: string[];
    encryptedMedia?: string[];
    fullscreen?: string[];
    geolocation?: string[];
    gyroscope?: string[];
    magnetometer?: string[];
    microphone?: string[];
    midi?: string[];
    payment?: string[];
    pictureInPicture?: string[];
    publicKeyCredentialsGet?: string[];
    screenWakeLock?: string[];
    syncXhr?: string[];
    usb?: string[];
    webShare?: string[];
    xrSpatialTracking?: string[];
  };
}

export interface SecurityOptions {
  /**
   * Content-Security-Policy header
   * Set to false to disable
   */
  contentSecurityPolicy?: ContentSecurityPolicyOptions | false;
  
  /**
   * X-Content-Type-Options: nosniff
   * @default true
   */
  noSniff?: boolean;
  
  /**
   * X-Frame-Options header
   * @default "SAMEORIGIN"
   */
  frameOptions?: "DENY" | "SAMEORIGIN" | false;
  
  /**
   * Strict-Transport-Security header
   * Only sent over HTTPS
   */
  hsts?: HstsOptions | false;
  
  /**
   * X-XSS-Protection header (legacy, but still useful)
   * @default "0" (disabled as per modern best practices)
   */
  xssFilter?: boolean | "block" | false;
  
  /**
   * Referrer-Policy header
   * @default "strict-origin-when-cross-origin"
   */
  referrerPolicy?: ReferrerPolicyOptions | false;
  
  /**
   * X-DNS-Prefetch-Control header
   * @default "off"
   */
  dnsPrefetchControl?: "on" | "off" | false;
  
  /**
   * X-Download-Options header (IE specific)
   * @default true
   */
  ieNoOpen?: boolean;
  
  /**
   * X-Permitted-Cross-Domain-Policies header
   * @default "none"
   */
  crossDomainPolicy?: "none" | "master-only" | "by-content-type" | "all" | false;
  
  /**
   * Permissions-Policy header
   */
  permissionsPolicy?: PermissionsPolicyOptions | false;
  
  /**
   * Origin-Agent-Cluster header
   * @default true
   */
  originAgentCluster?: boolean;
  
  /**
   * Cross-Origin-Embedder-Policy header
   */
  crossOriginEmbedderPolicy?: "unsafe-none" | "require-corp" | "credentialless" | false;
  
  /**
   * Cross-Origin-Opener-Policy header
   */
  crossOriginOpenerPolicy?: "unsafe-none" | "same-origin-allow-popups" | "same-origin" | false;
  
  /**
   * Cross-Origin-Resource-Policy header
   */
  crossOriginResourcePolicy?: "same-site" | "same-origin" | "cross-origin" | false;
}

// ===== Default Values =====

const defaultCSPDirectives: ContentSecurityPolicyOptions["directives"] = {
  defaultSrc: ["'self'"],
  baseUri: ["'self'"],
  fontSrc: ["'self'", "https:", "data:"],
  formAction: ["'self'"],
  frameAncestors: ["'self'"],
  imgSrc: ["'self'", "data:"],
  objectSrc: ["'none'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  upgradeInsecureRequests: true,
};

// ===== Helper Functions =====

function buildCSPHeader(options: ContentSecurityPolicyOptions): string {
  const directives = { ...defaultCSPDirectives, ...options.directives };
  const parts: string[] = [];
  
  for (const [key, value] of Object.entries(directives)) {
    if (value === undefined || value === false) continue;
    
    // Convert camelCase to kebab-case
    const directive = key.replace(/([A-Z])/g, "-$1").toLowerCase();
    
    if (value === true) {
      parts.push(directive);
    } else if (Array.isArray(value)) {
      parts.push(`${directive} ${value.join(" ")}`);
    } else if (typeof value === "string") {
      parts.push(`${directive} ${value}`);
    }
  }
  
  return parts.join("; ");
}

function buildHstsHeader(options: HstsOptions): string {
  const parts = [`max-age=${options.maxAge ?? 15552000}`]; // 180 days default
  
  if (options.includeSubDomains !== false) {
    parts.push("includeSubDomains");
  }
  
  if (options.preload) {
    parts.push("preload");
  }
  
  return parts.join("; ");
}

function buildPermissionsPolicyHeader(options: PermissionsPolicyOptions): string {
  if (!options.features) return "";
  
  const parts: string[] = [];
  
  for (const [feature, allowlist] of Object.entries(options.features)) {
    if (!allowlist) continue;
    
    // Convert camelCase to kebab-case
    const featureName = feature.replace(/([A-Z])/g, "-$1").toLowerCase();
    
    if (allowlist.length === 0) {
      parts.push(`${featureName}=()`);
    } else {
      const origins = allowlist.map(o => o === "self" ? "self" : `"${o}"`).join(" ");
      parts.push(`${featureName}=(${origins})`);
    }
  }
  
  return parts.join(", ");
}

// ===== Security Middleware =====

/**
 * Create security headers middleware
 */
export function securityHeaders(options: SecurityOptions = {}): Middleware {
  // Pre-compute headers for performance
  const headers: Array<[string, string]> = [];
  
  // Content-Security-Policy
  if (options.contentSecurityPolicy !== false) {
    const cspOptions = typeof options.contentSecurityPolicy === "object" 
      ? options.contentSecurityPolicy 
      : {};
    const headerName = cspOptions.reportOnly 
      ? "Content-Security-Policy-Report-Only"
      : "Content-Security-Policy";
    headers.push([headerName, buildCSPHeader(cspOptions)]);
  }
  
  // X-Content-Type-Options
  if (options.noSniff !== false) {
    headers.push(["X-Content-Type-Options", "nosniff"]);
  }
  
  // X-Frame-Options
  if (options.frameOptions !== false) {
    headers.push(["X-Frame-Options", options.frameOptions ?? "SAMEORIGIN"]);
  }
  
  // X-XSS-Protection (set to 0 by modern best practices)
  if (options.xssFilter === true) {
    headers.push(["X-XSS-Protection", "1"]);
  } else if (options.xssFilter === "block") {
    headers.push(["X-XSS-Protection", "1; mode=block"]);
  } else if (options.xssFilter !== false) {
    headers.push(["X-XSS-Protection", "0"]);
  }
  
  // Referrer-Policy
  if (options.referrerPolicy !== false) {
    const policy = typeof options.referrerPolicy === "object"
      ? options.referrerPolicy.policy
      : "strict-origin-when-cross-origin";
    headers.push(["Referrer-Policy", policy ?? "strict-origin-when-cross-origin"]);
  }
  
  // X-DNS-Prefetch-Control
  if (options.dnsPrefetchControl !== false) {
    headers.push(["X-DNS-Prefetch-Control", options.dnsPrefetchControl ?? "off"]);
  }
  
  // X-Download-Options
  if (options.ieNoOpen !== false) {
    headers.push(["X-Download-Options", "noopen"]);
  }
  
  // X-Permitted-Cross-Domain-Policies
  if (options.crossDomainPolicy !== false) {
    headers.push(["X-Permitted-Cross-Domain-Policies", options.crossDomainPolicy ?? "none"]);
  }
  
  // Permissions-Policy
  if (options.permissionsPolicy !== false && options.permissionsPolicy) {
    const ppHeader = buildPermissionsPolicyHeader(options.permissionsPolicy);
    if (ppHeader) {
      headers.push(["Permissions-Policy", ppHeader]);
    }
  }
  
  // Origin-Agent-Cluster
  if (options.originAgentCluster !== false) {
    headers.push(["Origin-Agent-Cluster", "?1"]);
  }
  
  // Cross-Origin-Embedder-Policy
  if (options.crossOriginEmbedderPolicy) {
    headers.push(["Cross-Origin-Embedder-Policy", options.crossOriginEmbedderPolicy]);
  }
  
  // Cross-Origin-Opener-Policy
  if (options.crossOriginOpenerPolicy) {
    headers.push(["Cross-Origin-Opener-Policy", options.crossOriginOpenerPolicy]);
  }
  
  // Cross-Origin-Resource-Policy
  if (options.crossOriginResourcePolicy) {
    headers.push(["Cross-Origin-Resource-Policy", options.crossOriginResourcePolicy]);
  }
  
  // Return middleware
  return async (ctx: Context, next) => {
    const response = await next();
    
    // Apply headers to response
    if (response instanceof Response) {
      const newHeaders = new Headers(response.headers);
      for (const [name, value] of headers) {
        newHeaders.set(name, value);
      }
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    }
    
    return response;
  };
}

// ===== Security Plugin =====

/**
 * Create security headers plugin
 */
export function security(options: SecurityOptions = {}): AsiPlugin {
  return createPlugin({
    name: "security",
    middleware: [securityHeaders(options)],
  });
}

// ===== Presets =====

/**
 * Strict security preset (recommended for APIs)
 */
export const strictSecurity: SecurityOptions = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  frameOptions: "DENY",
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: "no-referrer" },
  crossOriginEmbedderPolicy: "require-corp",
  crossOriginOpenerPolicy: "same-origin",
  crossOriginResourcePolicy: "same-origin",
};

/**
 * Relaxed security preset (for development or when needed)
 */
export const relaxedSecurity: SecurityOptions = {
  contentSecurityPolicy: false,
  hsts: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
};

/**
 * API security preset (no CSP, optimized for JSON APIs)
 */
export const apiSecurity: SecurityOptions = {
  contentSecurityPolicy: false, // APIs don't serve HTML
  frameOptions: "DENY",
  hsts: { maxAge: 31536000, includeSubDomains: true },
  referrerPolicy: { policy: "no-referrer" },
  crossOriginResourcePolicy: "same-origin",
};

// ===== Nonce Generator =====

/**
 * Generate a cryptographic nonce for CSP
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Middleware to add nonce to context for use in templates
 */
export function nonceMiddleware(): Middleware {
  return async (ctx, next) => {
    const nonce = generateNonce();
    (ctx.store as Record<string, unknown>)["cspNonce"] = nonce;
    return next();
  };
}
