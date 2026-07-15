/**
 * Healthcheck Endpoints Preset for AsiJS
 *
 * Provides /health, /ready, and /live endpoints with custom checks.
 *
 * @example
 * ```ts
 * import { Asi, healthCheck } from "asijs";
 *
 * const app = new Asi();
 *
 * // Simple — default /health, /ready, /live
 * app.use(healthCheck());
 *
 * // With custom checks
 * app.use(healthCheck({
 *   checks: {
 *     database: async () => {
 *       await db.ping();
 *       return { status: "healthy" };
 *     },
 *     cache: () => redis.ping(),
 *   },
 * }));
 *
 * // Custom paths
 * app.use(healthCheck({
 *   healthPath: "/healthz",
 *   readyPath: "/readiness",
 *   livePath: "/liveness",
 *   checks: {
 *     db: () => db.ping(),
 *   },
 * }));
 * ```
 */

import type { Middleware } from "./types";
import type { Context } from "./context";

// ===== Types =====

/** Result of a single health check */
export interface HealthCheckResult {
  status: "healthy" | "unhealthy" | "degraded";
  /** Optional message with details */
  message?: string;
  /** Optional extra data (latency, version, etc.) */
  meta?: Record<string, unknown>;
}

/** A health check function — sync or async */
export type HealthCheckFn =
  | (() => HealthCheckResult | Promise<HealthCheckResult>)
  | (() => void | Promise<void>);

/** Health check registry — key is check name */
export interface HealthChecks {
  [name: string]: HealthCheckFn;
}

/** Standard health response body */
export interface HealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  version?: string;
  uptime?: number;
  timestamp: string;
  checks: Record<
    string,
    {
      status: "healthy" | "unhealthy" | "degraded";
      message?: string;
      meta?: Record<string, unknown>;
    }
  >;
}

/** Options for healthCheck middleware */
export interface HealthCheckOptions {
  /**
   * URL path for the full health endpoint (all checks).
   * @default "/health"
   */
  healthPath?: string;

  /**
   * URL path for the readiness endpoint (is app ready for traffic?).
   * @default "/ready"
   */
  readyPath?: string;

  /**
   * URL path for the liveness endpoint (is app alive?).
   * @default "/live"
   */
  livePath?: string;

  /**
   * Named health checks to run.
   * Each key is the check name, value is a sync/async function.
   *
   * A function that returns `{ status: "healthy" }` marks the check as healthy.
   * A function that returns `{ status: "unhealthy" }` or throws marks it as unhealthy.
   * A function that returns nothing (void) is treated as healthy if no error.
   *
   * @example
   * ```ts
   * checks: {
   *   db: async () => { await db.raw("SELECT 1"); },
   *   redis: () => client.ping(),
   *   disk: () => ({ status: "healthy", meta: { free: "42GB" } }),
   * }
   * ```
   */
  checks?: HealthChecks;

  /**
   * Checks that are critical for readiness (must pass for /ready to be healthy).
   * If not specified, ALL checks are considered critical.
   *
   * @example
   * ```ts
   * readinessCritical: ["database", "cache"]
   * ```
   */
  readinessCritical?: string[];

  /**
   * Checks that run ONLY on /health (not on /ready or /live).
   * Useful for expensive or non-critical checks (disk space, long queries).
   *
   * @example
   * ```ts
   * healthOnly: ["disk", "longQuery"]
   * ```
   */
  healthOnly?: string[];

  /**
   * Application version to include in responses.
   * If not set, reads from `process.env.APP_VERSION` or `process.env.npm_package_version`.
   */
  version?: string;

  /**
   * Include process uptime in responses.
   * @default true
   */
  showUptime?: boolean;

  /**
   * Custom response headers (e.g., for caching headers on /health).
   */
  headers?: Record<string, string>;
}

// ===== Defaults =====

const DEFAULT_PATHS = {
  health: "/health",
  ready: "/ready",
  live: "/live",
};

// ===== Helpers =====

/** Get app version from various sources */
function resolveVersion(version?: string): string | undefined {
  if (version) return version;
  return (
    process.env.APP_VERSION ??
    process.env.npm_package_version ??
    undefined
  );
}

/** Run a single check and normalize the result */
async function runCheck(
  name: string,
  fn: HealthCheckFn,
): Promise<
  HealthResponse["checks"][string]
> {
  const start = performance.now();

  try {
    const result = await fn();

    // If function returned a HealthCheckResult, use it
    if (
      result &&
      typeof result === "object" &&
      "status" in result
    ) {
      const r = result as HealthCheckResult;
      return {
        status: r.status,
        message: r.message,
        meta: {
          duration: `${(performance.now() - start).toFixed(1)}ms`,
          ...r.meta,
        },
      };
    }

    // Void return — assume healthy
    return { status: "healthy" as const, meta: { duration: `${(performance.now() - start).toFixed(1)}ms` } };
  } catch (err: any) {
    return {
      status: "unhealthy" as const,
      message: err?.message ?? String(err),
      meta: { duration: `${(performance.now() - start).toFixed(1)}ms` },
    };
  }
}

/** Run all checks and build the HealthResponse */
async function runAllChecks(
  checks: HealthChecks,
  filterNames?: string[],
): Promise<HealthResponse> {
  const checkEntries = Object.entries(checks);
  const results: HealthResponse["checks"] = {};
  let overall: HealthResponse["status"] = "healthy";

  // Run all checks in parallel
  const promises = checkEntries.map(async ([name, fn]) => {
    // Skip filtered checks
    if (filterNames && !filterNames.includes(name)) {
      return;
    }

    const r = await runCheck(name, fn);
    results[name] = r;
    if (r.status !== "healthy") {
      overall = "unhealthy";
    }
  });

  await Promise.all(promises);

  return {
    status: overall,
    timestamp: new Date().toISOString(),
    checks: results,
  };
}

// ===== Middleware =====

/**
 * Create health check middleware that responds to /health, /ready, /live.
 *
 * @example
 * ```ts
 * app.use(healthCheck({
 *   checks: {
 *     db: () => db.ping(),
 *     redis: () => client.ping(),
 *   },
 * }));
 * ```
 */
export function healthCheck(options: HealthCheckOptions = {}): Middleware {
  const {
    healthPath = DEFAULT_PATHS.health,
    readyPath = DEFAULT_PATHS.ready,
    livePath = DEFAULT_PATHS.live,
    checks = {},
    readinessCritical,
    healthOnly = [],
    version: versionOpt,
    showUptime = true,
    headers: customHeaders = {},
  } = options;

  const version = resolveVersion(versionOpt);
  const startTime = Date.now();

  // Precompile path set for fast matching
  const paths = new Set([healthPath, readyPath, livePath]);

  // Precompute response headers
  const baseHeaders: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    ...customHeaders,
  };

  // Determine which checks are critical for readiness
  const criticalForReady = readinessCritical ?? Object.keys(checks);

  return async (ctx: Context, next: () => Promise<Response>): Promise<Response> => {
    // Only intercept GET/HEAD requests to health-related paths
    if (ctx.method !== "GET" && ctx.method !== "HEAD") {
      return next();
    }

    const requestPath = ctx.path;

    if (!paths.has(requestPath)) {
      return next();
    }

    // === /live — simple liveness (no checks, always healthy if running) ===
    if (requestPath === livePath) {
      const body: Record<string, unknown> = {
        status: "healthy",
        timestamp: new Date().toISOString(),
      };

      if (showUptime) {
        body.uptime = Math.floor((Date.now() - startTime) / 1000);
      }

      return new Response(ctx.method === "HEAD" ? null : JSON.stringify(body), {
        status: 200,
        headers: baseHeaders,
      });
    }

    // === /ready — readiness (critical checks only) ===
    if (requestPath === readyPath) {
      const criticalChecks: HealthChecks = {};
      for (const name of criticalForReady) {
        if (healthOnly.includes(name)) continue;
        if (name in checks) {
          criticalChecks[name] = checks[name];
        }
      }

      const response = await runAllChecks(criticalChecks);

      if (showUptime) {
        response.uptime = Math.floor((Date.now() - startTime) / 1000);
      }
      if (version) {
        response.version = version;
      }

      const status = response.status === "healthy" ? 200 : 503;

      return new Response(
        ctx.method === "HEAD" ? null : JSON.stringify(response),
        {
          status,
          headers: baseHeaders,
        },
      );
    }

    // === /health — full health (all checks) ===
    const response = await runAllChecks(checks);

    if (showUptime) {
      response.uptime = Math.floor((Date.now() - startTime) / 1000);
    }
    if (version) {
      response.version = version;
    }

    const status = response.status === "healthy" ? 200 : 503;

    return new Response(
      ctx.method === "HEAD" ? null : JSON.stringify(response),
      {
        status,
        headers: baseHeaders,
      },
    )
  };
}

export default healthCheck;
