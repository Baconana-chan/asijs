/**
 * API Versioning Middleware for AsiJS
 *
 * Parses API version from URL path or request header, stores version info
 * on `ctx.apiVersion`, and adds relevant response headers.
 *
 * **Note:** This middleware does NOT rewrite the request path for route matching.
 * Routes with version prefixes must be registered explicitly using `versionPath()`
 * or route groups:
 *
 * ```ts
 * // Explicit path
 * app.get(versionPath("1.0", "/users"), handlerV1);
 * app.get(versionPath("2.0", "/users"), handlerV2);
 *
 * // Route group
 * app.group("/v1", (v1) => v1.get("/users", handlerV1));
 * app.group("/v2", (v2) => v2.get("/users", handlerV2));
 * ```
 *
 * Features:
 * - URL prefix: `/v1/users`, `/v2/users` — extracts version from URL
 * - Header: `Accept-Version: 2.0` — selects version from header
 * - Fallback strategy: latest / stable / specific default version
 * - Deprecation headers: `Sunset`, `Deprecation` for older versions
 * - `X-API-Version` response header
 *
 * @example
 * ```ts
 * import { Asi, apiVersion, versionPath } from "asijs";
 *
 * const app = new Asi();
 *
 * // URL-based versioning (routes must be registered explicitly)
 * app.use(apiVersion({ supportedVersions: ["1.0", "2.0"] }));
 * app.get(versionPath("1.0", "/users"), () => [{ id: 1, name: "Alice" }]);
 * app.get(versionPath("2.0", "/users"), () => [{ id: 1, name: "Alice", email: "a@b.com" }]);
 *
 * // Header-based versioning
 * app.use(apiVersion({ strategy: "header" }));
 * app.get("/users", handler);
 * ```
 */

import { createPlugin, type AsiPlugin } from "./plugin";
import type { Context } from "./context";
import type { Middleware } from "./types";

// ============================================================================
// Types
// ============================================================================

/** Versioning strategy */
export type VersionStrategy = "url" | "header" | "both";

/** Fallback behavior when version is not found */
export type FallbackStrategy = "latest" | "stable" | "default" | "error";

/** Response when version is not found */
export interface VersionErrorResponse {
  error: string;
  supportedVersions: string[];
  requestedVersion?: string;
}

/** Version info extracted from request */
export interface VersionInfo {
  /** Resolved version string (e.g., "2.0") */
  version: string;
  /** How the version was detected */
  source: "url" | "header" | "default";
  /** Whether this is a deprecated version */
  deprecated: boolean;
  /** Whether this version has a sunset date */
  sunset?: string;
}

/** Version configuration */
export interface VersionConfig {
  /** Version label (e.g., "1.0", "2.0") */
  version: string;
  /** Whether this version is deprecated */
  deprecated?: boolean;
  /** Sunset date (ISO string or relative like "2026-12-31") */
  sunset?: string;
  /** Migration hint for users of deprecated versions */
  migrationHint?: string;
}

/** Options for API versioning plugin */
export interface APIVersionOptions {
  /**
   * Default version to use when none is specified.
   * @default "1.0"
   */
  defaultVersion?: string;

  /**
   * List of supported versions with their config.
   * If strings are provided, they get default config.
   * @default ["1.0"]
   */
  supportedVersions?: (string | VersionConfig)[];

  /**
   * Versioning strategy.
   * - `"url"`: version is parsed from the URL path (/v1/users)
   * - `"header"`: version is in a request header (Accept-Version: 2.0)
   * - `"both"`: try URL first, fallback to header
   * @default "url"
   */
  strategy?: VersionStrategy;

  /**
   * Header name for header-based versioning.
   * @default "Accept-Version"
   */
  headerName?: string;

  /**
   * Fallback behavior when a non-existent version is requested.
   * - `"latest"`: use the highest version
   * - `"stable"`: use the latest non-deprecated version
   * - `"default"`: use the default version
   * - `"error"`: return 400/404 error
   * @default "latest"
   */
  fallback?: FallbackStrategy;

  /**
   * Whether to add `Sunset` and `Deprecation` headers for deprecated versions.
   * @default true
   */
  deprecationHeaders?: boolean;

  /**
   * Whether to add `X-API-Version` response header with the resolved version.
   * @default true
   */
  versionHeader?: boolean;

  /**
   * Whether to validate requested version against supported list.
   * When true, returns an error for unsupported versions.
   * @default true
   */
  validateVersion?: boolean;

  /**
   * Custom error response when version is not found or invalid.
   */
  errorResponse?: (version: string | null, supported: string[]) => VersionErrorResponse;

  /**
   * Callback when a deprecated version is accessed.
   */
  onDeprecated?: (ctx: Context, version: string, migrationHint?: string) => void;
}

// ============================================================================
// Version helpers
// ============================================================================

/** Compare two semver-like version strings (e.g., "2.0" > "1.5") */
function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;
    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }
  return 0;
}

/** Check if a version is supported */
function isVersionSupported(version: string, configs: VersionConfig[]): boolean {
  return configs.some((c) => c.version === version);
}

/** Find the latest version */
function findLatest(configs: VersionConfig[]): VersionConfig | undefined {
  const sorted = [...configs].sort((a, b) => compareVersions(b.version, a.version));
  return sorted[0];
}

/** Find the latest non-deprecated (stable) version */
function findStable(configs: VersionConfig[]): VersionConfig | undefined {
  const stable = configs
    .filter((c) => !c.deprecated)
    .sort((a, b) => compareVersions(b.version, a.version));
  return stable[0];
}

/** Get supported version strings */
function getVersionStrings(configs: VersionConfig[]): string[] {
  return configs.map((c) => c.version);
}

/**
 * Normalize a version string by adding a ".0" minor if it's a plain integer.
 * E.g., "1" → "1.0", "2" → "2.0", but "2.5" stays "2.5".
 */
export function normalizeVersion(version: string): string {
  // If it's just digits (like "1", "10"), append ".0"
  if (/^\d+$/.test(version)) {
    return `${version}.0`;
  }
  return version;
}

/**
 * Shrink a version string for use in URLs by removing ".0" suffix.
 * E.g., "1.0" → "1", "2.0" → "2", but "2.5" stays "2.5".
 */
export function shrinkVersion(version: string): string {
  return version.replace(/\.0$/, "");
}

/** Parse version from URL path (e.g., /v1/users → "1.0") */
export function parseVersionFromUrl(path: string): string | null {
  const match = path.match(/^\/v(\d+(?:\.\d+)?)/);
  if (!match) return null;
  return normalizeVersion(match[1]!);
}

// ============================================================================
// Deprecation headers
// ============================================================================

/**
 * Generate `Sunset` and `Deprecation` HTTP headers for a deprecated version.
 *
 * - `Sunset`: ISO date when the version will be removed
 * - `Deprecation`: RFC 8594 deprecation header with sunset hint
 */
function createDeprecationHeaders(config: VersionConfig): Record<string, string> {
  const headers: Record<string, string> = {};

  if (config.sunset) {
    const sunsetDate = config.sunset.includes("-")
      ? config.sunset
      : new Date(Date.now() + parseRelativeTime(config.sunset)).toISOString();
    headers["Sunset"] = sunsetDate;
    headers["Deprecation"] = `true; sunset="${sunsetDate}"`;
  } else {
    headers["Deprecation"] = "true";
  }

  if (config.migrationHint) {
    headers["Deprecation-Migration"] = config.migrationHint;
  }

  return headers;
}

/** Parse relative time strings like "30d", "6months", "1year" */
function parseRelativeTime(relative: string): number {
  const match = relative.match(/^(\d+)\s*(d|day|days|month|months|mon|year|years|yr)?$/);
  if (!match) return 0;

  const num = parseInt(match[1]!, 10);
  const unit = (match[2] || "d").toLowerCase()[0];

  switch (unit) {
    case "d": return num * 86400_000;
    case "m": return num * 30 * 86400_000;
    case "y": return num * 365 * 86400_000;
    default: return num * 86400_000;
  }
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Create API versioning middleware.
 *
 * Parses version from URL or header, stores on `ctx.apiVersion`,
 * and adds `X-API-Version` / deprecation response headers.
 *
 * **Routes must be registered with explicit version prefixes.**
 * Use the `versionPath()` helper to generate prefixed paths.
 *
 * @example
 * ```ts
 * // URL-based versioning
 * app.use(apiVersion({ supportedVersions: ["1.0", "2.0"] }));
 * app.get("/v1/users", () => [{ id: 1, name: "Alice" }]);
 *
 * // Header-based with validation
 * app.use(apiVersion({
 *   strategy: "header",
 *   validateVersion: true,
 *   fallback: "error",
 * }));
 *
 * // With deprecation warnings
 * app.use(apiVersion({
 *   supportedVersions: [
 *     { version: "1.0", deprecated: true, sunset: "2026-12-31", migrationHint: "Migrate to v2" },
 *     { version: "2.0" },
 *   ],
 * }));
 * ```
 */
export function apiVersion(options: APIVersionOptions = {}): Middleware {
  const {
    defaultVersion = "1.0",
    supportedVersions: rawVersions = ["1.0"],
    strategy = "url",
    headerName = "Accept-Version",
    fallback = "latest",
    deprecationHeaders = true,
    versionHeader = true,
    validateVersion = true,
    errorResponse,
    onDeprecated,
  } = options;

  // Normalize version configs
  const versionConfigs: VersionConfig[] = rawVersions.map((v) => {
    if (typeof v === "string") return { version: v };
    return v;
  });

  const supportedVersions = getVersionStrings(versionConfigs);

  // Pre-build deprecation headers for all deprecated versions
  const deprecationHeaderCache = new Map<string, Record<string, string>>();
  for (const config of versionConfigs) {
    if (config.deprecated) {
      deprecationHeaderCache.set(config.version, createDeprecationHeaders(config));
    }
  }

  // Resolve version from request (path + header)
  function resolveVersion(path: string, header: string | null): VersionInfo {
    let version: string | null = null;
    let source: VersionInfo["source"] = "default";

    // 1. Try URL-based versioning
    if (strategy === "url" || strategy === "both") {
      const urlVersion = parseVersionFromUrl(path);
      if (urlVersion) {
        version = urlVersion;
        source = "url";
      }
    }

    // 2. Try header-based versioning
    if (!version && (strategy === "header" || strategy === "both")) {
      if (header) {
        version = header.trim();
        source = "header";
      }
    }

    // 3. Validate version
    if (version && validateVersion && !isVersionSupported(version, versionConfigs)) {
      switch (fallback) {
        case "latest": {
          const latest = findLatest(versionConfigs);
          if (latest) version = latest.version;
          break;
        }
        case "stable": {
          const stable = findStable(versionConfigs);
          if (stable) version = stable.version;
          break;
        }
        case "default":
          version = defaultVersion;
          break;
        case "error":
          // Return empty version so middleware can return 400
          return { version: "", source: "default", deprecated: false };
      }
    }

    // 4. Default (if version is still null from error case, we already returned above)
    if (!version) {
      version = defaultVersion;
      source = "default";
    }

    // 5. Check deprecation
    const config = versionConfigs.find((c) => c.version === version);
    const deprecated = config?.deprecated ?? false;

    return {
      version,
      source,
      deprecated,
      sunset: deprecated ? config?.sunset : undefined,
    };
  }

  return async (ctx: Context, next: () => Promise<Response>): Promise<Response> => {
    const acceptVersion = ctx.header(headerName);
    const info = resolveVersion(ctx.path, acceptVersion);

    // If version is null (error fallback), return error
    if (!info.version) {
      const errorResp = errorResponse
        ? errorResponse(acceptVersion, supportedVersions)
        : {
            error: `Unsupported API version. Supported versions: ${supportedVersions.join(", ")}`,
            supportedVersions,
            requestedVersion: acceptVersion ?? undefined,
          };
      return new Response(JSON.stringify(errorResp), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Store version info on context
    (ctx as any).apiVersion = info;

    // Call next handler
    const response = await next();

    // Add version headers to response
    const headers = new Headers(response.headers);

    if (versionHeader) {
      headers.set("X-API-Version", info.version);
    }

    // Add deprecation headers for deprecated versions
    if (deprecationHeaders && info.deprecated) {
      const depHeaders = deprecationHeaderCache.get(info.version);
      if (depHeaders) {
        for (const [key, value] of Object.entries(depHeaders)) {
          headers.set(key, value);
        }
      }

      if (onDeprecated) {
        const config = versionConfigs.find((c) => c.version === info.version);
        onDeprecated(ctx, info.version, config?.migrationHint);
      }
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create a route prefix for a specific API version.
 *
 * @example
 * ```ts
 * // /v1/users
 * app.get(versionPath("1.0", "/users"), handlerV1);
 *
 * // /v2/users with /api prefix
 * app.get(versionPath("2.0", "/users", "api"), handlerV2);
 * // → /api/v2/users
 * ```
 */
export function versionPath(version: string, path: string, apiPrefix?: string): string {
  const v = shrinkVersion(version);
  const versioned = apiPrefix
    ? `/${apiPrefix}/v${v}${path.startsWith("/") ? path : `/${path}`}`
    : `/v${v}${path.startsWith("/") ? path : `/${path}`}`;
  return versioned;
}

// ============================================================================
// Plugin
// ============================================================================

/**
 * Create API versioning as a plugin.
 *
 * @example
 * ```ts
 * app.plugin(apiVersionPlugin({
 *   defaultVersion: "2.0",
 *   supportedVersions: ["1.0", "2.0"],
 * }));
 * ```
 */
export function apiVersionPlugin(options: APIVersionOptions = {}): AsiPlugin {
  return createPlugin({
    name: "api-version",
    middleware: [apiVersion(options)],
  });
}
