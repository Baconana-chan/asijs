/**
 * Healthcheck Dashboard — /__health HTML page
 *
 * Renders a live HTML dashboard with the status of every component:
 * custom health checks (DB, Redis, ...), circuit breakers, and process info.
 *
 * @example
 * ```ts
 * import { Asi, healthDashboard } from "asijs";
 *
 * app.use(healthDashboard({
 *   checks: {
 *     database: async () => { await db.ping(); },
 *     cache: () => redis.ping(),
 *   },
 * }));
 * ```
 */

import type { Middleware } from "./types";
import type { Context } from "./context";
import { getCircuitBreakerRegistry } from "./circuit-breaker";
import type { HealthChecks, HealthCheckFn } from "./health";

// ============================================================================
// Types
// ============================================================================

export interface HealthDashboardOptions {
  /** URL path for the HTML dashboard (default: "/__health") */
  path?: string;
  /** JSON endpoint (default: "/__health.json") */
  jsonPath?: string;
  /** Named health checks (same shape as healthCheck()) */
  checks?: HealthChecks;
  /** Auto-refresh interval in seconds (default: 5) */
  refreshSeconds?: number;
  /** App version shown in the header */
  version?: string;
}

/** Normalized check result for rendering */
interface CheckSnapshot {
  status: "healthy" | "unhealthy" | "degraded";
  message?: string;
  durationMs?: number;
}

// ============================================================================
// Check runner
// ============================================================================

async function runNamedCheck(name: string, fn: HealthCheckFn): Promise<CheckSnapshot> {
  const start = performance.now();
  try {
    const result = await fn();
    if (
      result &&
      typeof result === "object" &&
      "status" in result
    ) {
      const r = result as { status: "healthy" | "unhealthy" | "degraded"; message?: string };
      return {
        status: r.status,
        message: r.message,
        durationMs: performance.now() - start,
      };
    }
    return { status: "healthy", durationMs: performance.now() - start };
  } catch (err: unknown) {
    return {
      status: "unhealthy",
      message: err instanceof Error ? err.message : String(err),
      durationMs: performance.now() - start,
    };
  }
}

// ============================================================================
// Snapshot
// ============================================================================

export interface HealthDashboardSnapshot {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  uptimeSeconds: number;
  pid: number;
  version?: string;
  checks: Record<string, CheckSnapshot>;
  circuitBreakers: Array<{
    name: string;
    state: string;
    successCount: number;
    failureCount: number;
    recoveryCount: number;
  }>;
  memory: { rss: number; heapUsed: number };
}

/** Build the dashboard snapshot (checks + circuit breakers + process) */
export async function buildHealthSnapshot(
  options: HealthDashboardOptions,
): Promise<HealthDashboardSnapshot> {
  const checks: HealthDashboardSnapshot["checks"] = {};
  const entries = Object.entries(options.checks ?? {});
  let overall: "healthy" | "degraded" | "unhealthy" = "healthy";

  await Promise.all(
    entries.map(async ([name, fn]) => {
      const result = await runNamedCheck(name, fn);
      checks[name] = result;
      if (result.status === "unhealthy") overall = "unhealthy";
      else if (result.status === "degraded" && overall !== "unhealthy") overall = "degraded";
    }),
  );

  // Circuit breakers from the global registry
  const registry = getCircuitBreakerRegistry();
  const breakerMetrics = registry.getAllMetrics();
  const circuitBreakers = Object.entries(breakerMetrics).map(([name, m]) => ({
    name,
    state: m.state,
    successCount: m.successCount,
    failureCount: m.failureCount,
    recoveryCount: m.recoveryCount ?? 0,
  }));
  // Any OPEN breaker makes the dashboard degraded
  if (circuitBreakers.some((c) => c.state === "OPEN") && overall === "healthy") {
    overall = "degraded";
  }

  const memory = process.memoryUsage();

  return {
    status: overall,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    pid: process.pid,
    version: options.version ?? process.env.APP_VERSION ?? process.env.npm_package_version,
    checks,
    circuitBreakers,
    memory: { rss: memory.rss, heapUsed: memory.heapUsed },
  };
}

// ============================================================================
// HTML rendering
// ============================================================================

const HEALTH_CSS = [
  "* { box-sizing: border-box; margin: 0; padding: 0; }",
  "body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #c9d1d9; line-height: 1.5; }",
  ".container { max-width: 900px; margin: 0 auto; padding: 20px; }",
  "h1 { font-size: 1.6rem; margin-bottom: 6px; }",
  "h2 { font-size: 1.1rem; color: #58a6ff; margin: 20px 0 10px; border-bottom: 1px solid #30363d; padding-bottom: 6px; }",
  ".banner { padding: 16px 20px; border-radius: 8px; margin-bottom: 20px; color: white; font-weight: 600; }",
  ".banner.healthy { background: #238636; }",
  ".banner.degraded { background: #9e6a03; }",
  ".banner.unhealthy { background: #da3633; }",
  ".grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }",
  ".card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 14px; }",
  ".check { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: #21262d; border-radius: 6px; margin-bottom: 8px; }",
  ".status-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 8px; }",
  ".healthy .status-dot { background: #3fb950; }",
  ".unhealthy .status-dot { background: #f85149; }",
  ".degraded .status-dot { background: #d29922; }",
  ".status-text { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; }",
  ".healthy .status-text { color: #3fb950; }",
  ".unhealthy .status-text { color: #f85149; }",
  ".degraded .status-text { color: #d29922; }",
  ".dim { color: #8b949e; font-size: 0.8rem; }",
  ".meta { display: flex; gap: 20px; flex-wrap: wrap; color: #8b949e; font-size: 0.8rem; margin-bottom: 16px; }",
  "code { background: #0d1117; padding: 2px 6px; border-radius: 4px; font-family: 'SF Mono', Consolas, monospace; font-size: 0.8rem; }",
  "table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }",
  "th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #30363d; }",
  "th { color: #8b949e; font-weight: 500; }",
].join("\n");

function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c] as string));
}

function fmtBytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

function checksHtml(snapshot: HealthDashboardSnapshot): string {
  const entries = Object.entries(snapshot.checks);
  if (entries.length === 0) {
    return '<p class="dim">No custom checks registered — pass { checks } to healthDashboard().</p>';
  }
  return entries
    .map(
      ([name, c]) => `<div class="check ${c.status}">
        <span><span class="status-dot"></span><code>${esc(name)}</code>
          ${c.message ? `<span class="dim"> — ${esc(c.message)}</span>` : ""}</span>
        <span class="status-text">${c.status}${c.durationMs != null ? ` · ${c.durationMs.toFixed(1)}ms` : ""}</span>
      </div>`,
    )
    .join("");
}

function breakersHtml(snapshot: HealthDashboardSnapshot): string {
  if (snapshot.circuitBreakers.length === 0) {
    return '<p class="dim">No circuit breakers registered.</p>';
  }
  return `<table>
    <thead><tr><th>Breaker</th><th>State</th><th>OK</th><th>Fail</th><th>Recoveries</th></tr></thead>
    <tbody>${snapshot.circuitBreakers
      .map(
        (c) => `<tr class="${c.state === "OPEN" ? "unhealthy" : c.state === "HALF_OPEN" ? "degraded" : "healthy"}">
          <td><code>${esc(c.name)}</code></td>
          <td><span class="status-dot"></span><span class="status-text">${c.state}</span></td>
          <td>${c.successCount}</td><td>${c.failureCount}</td><td>${c.recoveryCount}</td>
        </tr>`,
      )
      .join("")}
    </tbody></table>`;
}

/** Render the dashboard as an HTML string */
export function renderHealthDashboardHTML(snapshot: HealthDashboardSnapshot, refreshSeconds: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Health — AsiJS</title>
<style>${HEALTH_CSS}</style>
</head>
<body>
<div class="container">
  <div class="banner ${snapshot.status}">
    ${snapshot.status === "healthy" ? "✓" : snapshot.status === "degraded" ? "⚠" : "✗"} System ${snapshot.status.toUpperCase()}
  </div>
  <div class="meta">
    <span>PID <code>${snapshot.pid}</code></span>
    <span>Uptime <code>${snapshot.uptimeSeconds}s</code></span>
    <span>RSS <code>${fmtBytes(snapshot.memory.rss)}</code></span>
    <span>Heap <code>${fmtBytes(snapshot.memory.heapUsed)}</code></span>
    ${snapshot.version ? `<span>v<code>${esc(snapshot.version)}</code></span>` : ""}
    <span class="dim">Last updated: <code>${esc(snapshot.timestamp)}</code></span>
  </div>

  <h2>Components</h2>
  <div class="grid">
    <div class="card"><h3 style="font-size:0.9rem;color:#8b949e;margin-bottom:8px">Custom checks</h3>${checksHtml(snapshot)}</div>
  </div>

  <h2>Circuit Breakers</h2>
  ${breakersHtml(snapshot)}
</div>
<script>
function refresh() {
  fetch(location.pathname + ".json", { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (d) { location.reload(); })
    .catch(function () {});
}
setInterval(refresh, ${refreshSeconds * 1000});
</script>
</body>
</html>`;
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Create the health dashboard middleware — serves:
 * - `GET {path}` (`/__health`) — HTML dashboard with auto-refresh
 * - `GET {jsonPath}` (`/__health.json`) — JSON snapshot
 *
 * @example
 * ```ts
 * app.use(healthDashboard({
 *   checks: {
 *     database: async () => { await db.ping(); },
 *     redis: () => redis.ping(),
 *   },
 * }));
 * ```
 */
export function healthDashboard(options: HealthDashboardOptions = {}): Middleware {
  const {
    path = "/__health",
    jsonPath = "/__health.json",
    checks = {},
    refreshSeconds = 5,
    version,
  } = options;

  const opts: HealthDashboardOptions = { path, jsonPath, checks, refreshSeconds, version };

  return async (ctx: Context, next: () => Promise<Response>): Promise<Response> => {
    if (ctx.method !== "GET" && ctx.method !== "HEAD") {
      return next();
    }

    if (ctx.path === jsonPath) {
      const snapshot = await buildHealthSnapshot(opts);
      const status = snapshot.status === "healthy" ? 200 : 503;
      return new Response(JSON.stringify(snapshot), {
        status,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    if (ctx.path === path) {
      const snapshot = await buildHealthSnapshot(opts);
      const status = snapshot.status === "healthy" ? 200 : 503;
      return new Response(renderHealthDashboardHTML(snapshot, refreshSeconds), {
        status,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    return next();
  };
}
