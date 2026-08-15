/**
 * Workspace — Production Multi-App Server
 *
 * Runs multiple AsiJS apps on a single `Bun.serve()` with:
 * - Host-based routing (Host header -> app)
 * - Prefix-based routing (/api/* -> app)
 * - Unified dev dashboard at /__asi/workspace
 * - Unified OpenAPI docs at /__asi/docs
 *
 * @example
 * ```ts
 * import { Workspace, Asi } from "asijs";
 *
 * const ws = new Workspace();
 *
 * ws.app("api", { development: true }, (app) => {
 *   app.get("/users", () => ["Alice", "Bob"]);
 * });
 *
 * ws.app("web", { development: true }, (app) => {
 *   app.get("/", () => "Hello from Web!");
 * });
 *
 * ws.listen(3000);
 * ```
 */

import { Asi, type AsiConfig } from "./asi";
import { renderToString, jsx, type JSXElement } from "./jsx";
import { getCircuitBreakerRegistry } from "./circuit-breaker";
import type { EventBus } from "./event-bus";
import type { Middleware } from "./types";

// ===== Types =====

export interface WorkspaceAppConfig {
  name: string;
  config?: AsiConfig;
  hostname?: string;
  prefix?: string;
  setup: (app: Asi) => void;
}

export interface WorkspaceOptions {
  port?: number;
  hostname?: string;
  dashboard?: boolean;
  dashboardPath?: string;
  openapi?: boolean;
  openapiPath?: string;
  onError?: (error: unknown, request: Request) => Response | Promise<Response>;
  verbose?: boolean;
  /**
   * Enable live metrics collection (request rate, error rate, ws, breakers).
   * Default: true.
   */
  metrics?: boolean;
  /** JSON metrics endpoint (default: "/__asi/metrics") */
  metricsPath?: string;
  /**
   * Shared state bus — distributed to every sub-app as `app.getState("eventBus")`.
   * See {@link EventBus}.
   */
  bus?: EventBus;
  /** Maximum time to wait for sub-app graceful shutdown (ms, default: 10_000) */
  shutdownTimeoutMs?: number;
}

interface RegisteredApp {
  name: string;
  hostname?: string;
  prefix?: string;
  app: Asi;
}

// ===== Per-route metrics =====

interface RouteStat {
  count: number;
  errors: number;
  totalDuration: number;
}

interface AppMetrics {
  totalRequests: number;
  errors: number;
  statusCodes: Record<string, number>;
  routes: Array<{
    method: string;
    path: string;
    count: number;
    errors: number;
    averageDurationMs: number;
  }>;
  requestRate: number;
  errorRate: number;
  averageDurationMs: number;
  wsConnections: number;
  startedAt: number;
}

// ===== Metrics Collector =====

/**
 * Lightweight per-app metrics collector.
 *
 * Records request counts, status codes, per-route stats and a sliding-window
 * request rate — used by the workspace dashboard / metrics endpoint.
 */
class WorkspaceMetricsCollector {
  private totalRequests = 0;
  private totalDuration = 0;
  private errors = 0;
  private statusCodes = new Map<number, number>();
  private routeStats = new Map<string, RouteStat>();
  private timestamps: number[] = [];
  private errorTimestamps: number[] = [];
  private maxHistory = 50_000;
  private startedAt = Date.now();

  /** Record a single request */
  record(duration: number, status: number, method: string, path: string): void {
    this.totalRequests++;
    this.totalDuration += duration;
    this.timestamps.push(Date.now());

    if (status >= 400) {
      this.errors++;
      this.errorTimestamps.push(Date.now());
    }

    this.statusCodes.set(status, (this.statusCodes.get(status) ?? 0) + 1);

    const key = `${method} ${path}`;
    const stat = this.routeStats.get(key) ?? {
      count: 0,
      errors: 0,
      totalDuration: 0,
    };
    stat.count++;
    stat.totalDuration += duration;
    if (status >= 400) stat.errors++;
    this.routeStats.set(key, stat);

    // Bound memory
    if (this.timestamps.length > this.maxHistory) {
      this.timestamps = this.timestamps.slice(-this.maxHistory / 2);
      this.errorTimestamps = this.errorTimestamps.slice(-this.maxHistory / 2);
    }
  }

  /** Number of requests in the last `windowMs` */
  private countInWindow(list: number[], windowMs: number, now: number): number {
    const cutoff = now - windowMs;
    let count = 0;
    // Arrays are roughly sorted — binary search the cutoff
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid] < cutoff) lo = mid + 1;
      else hi = mid;
    }
    return list.length - lo;
  }

  /** Snapshot for the dashboard / metrics endpoint */
  snapshot(): AppMetrics {
    const now = Date.now();
    const windowMs = 60_000;
    const requestsInWindow = this.countInWindow(this.timestamps, windowMs, now);
    const errorsInWindow = this.countInWindow(this.errorTimestamps, windowMs, now);

    const statusCodes: Record<string, number> = {};
    for (const [code, count] of this.statusCodes) {
      statusCodes[String(code)] = count;
    }

    const routes = Array.from(this.routeStats.entries())
      .map(([key, stat]) => {
        const [method, path] = key.split(" ");
        return {
          method,
          path,
          count: stat.count,
          errors: stat.errors,
          averageDurationMs: stat.count > 0 ? stat.totalDuration / stat.count : 0,
        };
      })
      .sort((a, b) => b.count - a.count);

    return {
      totalRequests: this.totalRequests,
      errors: this.errors,
      statusCodes,
      routes,
      requestRate: requestsInWindow / (windowMs / 1000),
      errorRate: requestsInWindow > 0 ? errorsInWindow / requestsInWindow : 0,
      averageDurationMs: this.totalRequests > 0 ? this.totalDuration / this.totalRequests : 0,
      wsConnections: 0,
      startedAt: this.startedAt,
    };
  }
}

/** Middleware that feeds a WorkspaceMetricsCollector */
function metricsCollectorMiddleware(collector: WorkspaceMetricsCollector): Middleware {
  return async (ctx, next) => {
    const start = performance.now();
    try {
      const response = await next();
      const status = response instanceof Response ? response.status : 200;
      collector.record(performance.now() - start, status, ctx.method, ctx.path);
      return response;
    } catch (error) {
      collector.record(performance.now() - start, 500, ctx.method, ctx.path);
      throw error;
    }
  };
}

// ===== CSS =====

const DASHBOARD_CSS = [
  "* { box-sizing: border-box; margin: 0; padding: 0; }",
  "body {",
  "  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;",
  "  background: #0d1117;",
  "  color: #c9d1d9;",
  "  line-height: 1.5;",
  "}",
  ".container { max-width: 1200px; margin: 0 auto; padding: 20px; }",
  "header {",
  "  background: linear-gradient(135deg, #1f6feb 0%, #8957e5 100%);",
  "  padding: 30px 20px; margin-bottom: 30px; border-radius: 8px;",
  "}",
  "h1 { font-size: 2rem; color: white; }",
  "h2 {",
  "  font-size: 1.25rem; color: #58a6ff;",
  "  margin-bottom: 15px; padding-bottom: 10px;",
  "  border-bottom: 1px solid #30363d;",
  "}",
  ".card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; margin-bottom: 20px; }",
  "table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }",
  "th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #30363d; }",
  "th { color: #8b949e; font-weight: 500; }",
  "tr:hover { background: #1c2128; }",
  ".method { font-weight: bold; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; }",
  ".GET { background: #238636; color: white; }",
  ".POST { background: #1f6feb; color: white; }",
  ".PUT { background: #9e6a03; color: white; }",
  ".PATCH { background: #8957e5; color: white; }",
  ".DELETE { background: #da3633; color: white; }",
  "code { background: #0d1117; padding: 2px 6px; border-radius: 4px; font-family: 'SF Mono', Consolas, monospace; font-size: 0.8rem; }",
  ".stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 15px; margin-bottom: 20px; }",
  ".stat { background: #21262d; padding: 15px; border-radius: 8px; text-align: center; }",
  ".stat-value { font-size: 1.8rem; font-weight: bold; color: #58a6ff; }",
  ".stat-label { color: #8b949e; font-size: 0.85rem; }",
  ".app-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600; margin-right: 4px; }",
  ".tag-host { background: #1f6feb33; color: #58a6ff; }",
  ".tag-prefix { background: #9e6a0333; color: #d29922; }",
  ".empty { color: #8b949e; text-align: center; padding: 40px; }",
  ".proc-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }",
  ".proc-item { background: #21262d; padding: 12px; border-radius: 6px; }",
  ".proc-item span { display: block; color: #8b949e; font-size: 0.75rem; }",
  ".proc-item b { display: block; font-size: 1.1rem; color: #58a6ff; margin-top: 4px; }",
  ".app-card { background: #21262d; border: 1px solid #30363d; border-radius: 6px; padding: 14px; margin: 10px 0; }",
  ".app-card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }",
  ".app-card-head span { color: #8b949e; font-size: 0.8rem; }",
  ".app-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 8px 0; }",
  ".app-stat { background: #161b22; padding: 8px 10px; border-radius: 6px; }",
  ".app-stat span { display: block; color: #8b949e; font-size: 0.7rem; }",
  ".app-stat b { display: block; font-size: 1rem; color: #c9d1d9; margin: 2px 0 4px; }",
  ".bar { height: 4px; background: #30363d; border-radius: 2px; overflow: hidden; }",
  ".bar-fill { height: 100%; border-radius: 2px; transition: width 0.4s ease; }",
  ".route-details { margin-top: 8px; }",
  ".route-details summary { cursor: pointer; color: #8b949e; font-size: 0.8rem; }",
  ".route-table { margin-top: 8px; }",
  ".route-table td, .route-table th { padding: 5px 8px; font-size: 0.75rem; }",
].join("\n");

// ===== Metrics JSON =====

function buildMetricsSnapshot(ws: Workspace): Record<string, unknown> {
  const apps = ws.getApps().map((ra) => {
    const collector = ws.getCollector(ra.name);
    const base = collector
      ? collector.snapshot()
      : {
          totalRequests: 0,
          errors: 0,
          statusCodes: {} as Record<string, number>,
          routes: [] as AppMetrics["routes"],
          requestRate: 0,
          errorRate: 0,
          averageDurationMs: 0,
          startedAt: Date.now(),
        };

    return {
      name: ra.name,
      hostname: ra.hostname ?? null,
      prefix: ra.prefix ?? null,
      routeCount: ra.app.getRoutes().length,
      plugins: ra.app.getPlugins().length,
      wsConnections: ra.app.wsConnectionCount,
      ...base,
    };
  });

  // Circuit breakers from the global registry
  const breakerRegistry = getCircuitBreakerRegistry();
  const circuitBreakers = Object.entries(breakerRegistry.getAllMetrics()).map(
    ([name, metrics]) => ({
      name,
      state: metrics.state,
      successCount: metrics.successCount,
      failureCount: metrics.failureCount,
      recoveryCount: metrics.recoveryCount ?? 0,
      lastFailure: metrics.lastFailure ?? null,
    }),
  );

  // Process-level CPU / memory
  const memory = process.memoryUsage();
  const cpu = process.cpuUsage();
  const processStart = process.uptime();

  return {
    generatedAt: Date.now(),
    process: {
      pid: process.pid,
      uptimeSeconds: processStart,
      memory: {
        rss: memory.rss,
        heapUsed: memory.heapUsed,
        heapTotal: memory.heapTotal,
        external: memory.external,
      },
      cpu: {
        user: cpu.user,
        system: cpu.system,
      },
    },
    apps,
    circuitBreakers,
    bus: ws.getBusStats(),
  };
}

// ===== Dashboard v2 =====

/** Inline JS that polls the metrics endpoint and live-renders the dashboard */
const DASHBOARD_SCRIPT = `
(function () {
  var metricsUrl = __METRICS_URL__;
  var state = null;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtMs(n) { return (n || 0).toFixed(1) + "ms"; }
  function fmtRate(n) { return (n || 0).toFixed(1); }
  function fmtBytes(n) {
    if (!n) return "0 B";
    var u = ["B", "KB", "MB", "GB"];
    var i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return n.toFixed(1) + " " + u[i];
  }
  function stateColor(s) {
    return s === "OPEN" ? "#da3633" : s === "HALF_OPEN" ? "#9e6a03" : "#238636";
  }
  function bar(value, max, color) {
    var pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
    return '<div class="bar"><div class="bar-fill" style="width:' + pct + '%;background:' + color + '"></div></div>';
  }

  function render() {
    if (!state) return;
    var d = state;

    // Header stats
    document.getElementById("stat-apps").textContent = d.apps.length;
    document.getElementById("stat-routes").textContent = d.apps.reduce(function (s, a) { return s + a.routeCount; }, 0);
    document.getElementById("stat-plugins").textContent = d.apps.reduce(function (s, a) { return s + a.plugins; }, 0);
    document.getElementById("stat-ws").textContent = d.apps.reduce(function (s, a) { return s + a.wsConnections; }, 0);
    document.getElementById("stat-req").textContent = d.apps.reduce(function (s, a) { return s + a.totalRequests; }, 0);
    document.getElementById("stat-breakers").textContent = d.circuitBreakers.length;

    // Process card
    document.getElementById("proc-pid").textContent = d.process.pid;
    document.getElementById("proc-uptime").textContent = Math.floor(d.process.uptimeSeconds) + "s";
    document.getElementById("proc-rss").textContent = fmtBytes(d.process.memory.rss);
    document.getElementById("proc-heap").textContent = fmtBytes(d.process.memory.heapUsed);
    document.getElementById("proc-cpu").textContent =
      ((d.process.cpu.user + d.process.cpu.system) / 1e6).toFixed(1) + "s";

    // Per-app cards
    var appsHtml = d.apps.map(function (a) {
      var badges = [];
      if (a.hostname) badges.push('<span class="app-badge tag-host">Host: ' + esc(a.hostname) + "</span>");
      if (a.prefix) badges.push('<span class="app-badge tag-prefix">Prefix: ' + esc(a.prefix) + "</span>");
      var maxRate = 1;
      d.apps.forEach(function (o) { if (o.requestRate > maxRate) maxRate = o.requestRate; });
      var errColor = a.errorRate > 0.05 ? "#da3633" : a.errorRate > 0.01 ? "#9e6a03" : "#238636";
      var errBar = bar(a.errorRate, Math.max(0.01, a.errorRate), errColor);
      return (
        '<div class="app-card">' +
          '<div class="app-card-head"><strong>' + esc(a.name) + "</strong>" +
            '<span>' + a.routeCount + " routes \u00B7 " + a.plugins + " plugins \u00B7 " + a.wsConnections + " ws</span></div>" +
          badges.join("") +
          '<div class="app-stats">' +
            '<div class="app-stat"><span>Req/s</span><b>' + fmtRate(a.requestRate) + "</b>" +
              bar(a.requestRate, maxRate, "#58a6ff") + "</div>" +
            '<div class="app-stat"><span>Error rate</span><b>' + (a.errorRate * 100).toFixed(2) + "%</b>" + errBar + "</div>" +
            '<div class="app-stat"><span>Avg</span><b>' + fmtMs(a.averageDurationMs) + "</b></div>" +
            '<div class="app-stat"><span>Total</span><b>' + a.totalRequests + "</b></div>" +
          "</div>" +
          '<details class="route-details"><summary>Routes (' + a.routes.length + ")</summary>" +
            '<table class="route-table"><thead><tr><th>Route</th><th>Count</th><th>Errors</th><th>Err%</th><th>Avg</th></tr></thead><tbody>' +
            a.routes.map(function (r) {
              var er = r.count > 0 ? (r.errors / r.count) * 100 : 0;
              return "<tr><td><span class=\"method \" + r.method + \"\">" + r.method + "</span> <code>" + esc(r.path) +
                "</code></td><td>" + r.count + "</td><td>" + r.errors + "</td><td>" + er.toFixed(1) + "%</td><td>" +
                fmtMs(r.averageDurationMs) + "</td></tr>";
            }).join("") +
          "</tbody></table></details>" +
        "</div>"
      );
    }).join("");
    document.getElementById("apps-list").innerHTML = appsHtml || '<p class="empty">No sub-apps</p>';

    // Circuit breakers
    var cbHtml = d.circuitBreakers.length
      ? '<table class="route-table"><thead><tr><th>Breaker</th><th>State</th><th>OK</th><th>Fail</th><th>Recoveries</th></tr></thead><tbody>' +
        d.circuitBreakers.map(function (c) {
          return "<tr><td><code>" + esc(c.name) + "</code></td><td><span style=\"color:" + stateColor(c.state) + "\">" +
            c.state + "</span></td><td>" + c.successCount + "</td><td>" + c.failureCount + "</td><td>" +
            c.recoveryCount + "</td></tr>";
        }).join("") +
      "</tbody></table>"
      : '<p class="empty">No circuit breakers registered</p>';
    document.getElementById("breakers-list").innerHTML = cbHtml;

    // Bus
    if (d.bus) {
      document.getElementById("bus-name").textContent = d.bus.name;
      document.getElementById("bus-topics").textContent = d.bus.topics;
      document.getElementById("bus-handlers").textContent = d.bus.handlers;
      document.getElementById("bus-emitted").textContent = d.bus.emitted;
      document.getElementById("bus-redis").textContent = d.bus.redisConnected ? "connected" : "in-memory";
    }

    document.getElementById("last-updated").textContent = new Date(d.generatedAt).toLocaleTimeString();
  }

  function poll() {
    fetch(metricsUrl, { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (data) { state = data; render(); })
      .catch(function () { /* keep last state */ });
  }

  poll();
  setInterval(poll, 2000);
})();
`;

function buildDashboard(apps: RegisteredApp[], ws: Workspace): JSXElement {
  const totalRoutes = apps.reduce((s, a) => s + a.app.getRoutes().length, 0);
  const totalPlugins = apps.reduce((s, a) => s + a.app.getPlugins().length, 0);

  const body: JSXElement[] = [
    jsx("header", {
      children: [
        jsx("h1", { children: "\uD83D\uDE80 AsiJS Workspace Dashboard" }),
        jsx("div", { style: "color:#8b949e;font-size:0.85rem;margin-top:6px", children: "Live monitoring \u2014 auto-refresh 2s" }),
      ],
    }),
    jsx("div", {
      className: "stats",
      children: [
        buildStat(0, "Apps", "stat-apps"),
        buildStat(0, "Routes", "stat-routes"),
        buildStat(0, "Plugins", "stat-plugins"),
        buildStat(0, "WebSocket", "stat-ws"),
        buildStat(0, "Requests", "stat-req"),
        buildStat(0, "Breakers", "stat-breakers"),
      ],
    }),
    jsx("div", {
      className: "card",
      children: [
        jsx("h2", { children: "\uD83D\uDCA0 Process" }),
        jsx("div", {
          className: "proc-grid",
          children: [
            procItem("PID", "proc-pid"),
            procItem("Uptime", "proc-uptime"),
            procItem("RSS", "proc-rss"),
            procItem("Heap", "proc-heap"),
            procItem("CPU", "proc-cpu"),
          ],
        }),
      ],
    }),
    jsx("div", {
      className: "card",
      children: [
        jsx("h2", { children: "\uD83D\uDCE6 Sub-Apps \u2014 request rate & error rate" }),
        jsx("div", { id: "apps-list", children: jsx("p", { className: "empty", children: "Loading..." }) }),
      ],
    }),
    jsx("div", {
      className: "card",
      children: [
        jsx("h2", { children: "\u26A1 Circuit Breakers" }),
        jsx("div", { id: "breakers-list", children: jsx("p", { className: "empty", children: "Loading..." }) }),
      ],
    }),
    jsx("div", {
      className: "card",
      children: [
        jsx("h2", { children: "\uD83D\uDCE4 Shared State Bus" }),
        ws.getBus()
          ? jsx("div", {
              className: "stats",
              children: [
                buildStat("\u2014", "Bus", "bus-name"),
                buildStat("0", "Topics", "bus-topics"),
                buildStat("0", "Handlers", "bus-handlers"),
                buildStat("0", "Events", "bus-emitted"),
                buildStat("\u2014", "Mode", "bus-redis"),
              ],
            })
          : jsx("p", { className: "empty", children: "No shared bus configured \u2014 pass { bus } to Workspace options" }),
      ],
    }),
    jsx("div", {
      style: "color:#8b949e;font-size:0.75rem;text-align:center;padding:10px",
      children: "Last updated: <span id=\"last-updated\">\u2014</span>",
    }),
  ];

  return jsx("html", {
    children: [
      jsx("head", {
        children: [
          jsx("title", { children: "AsiJS Workspace Dashboard" }),
          jsx("meta", { charset: "utf-8" }),
          jsx("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
          jsx("style", { children: DASHBOARD_CSS }),
        ],
      }),
      jsx("body", {
        children: jsx("div", {
          className: "container",
          children: [
            ...body,
            jsx("script", { children: DASHBOARD_SCRIPT.replace("__METRICS_URL__", JSON.stringify(ws.metricsPath)) }),
          ],
        }),
      }),
    ],
  });
}

function buildStat(value: string | number, label: string, id?: string): JSXElement {
  return jsx("div", {
    className: "stat",
    children: [
      jsx("div", { className: "stat-value", id, children: String(value) }),
      jsx("div", { className: "stat-label", children: label }),
    ],
  });
}

function procItem(label: string, id: string): JSXElement {
  return jsx("div", {
    className: "proc-item",
    children: [
      jsx("span", { children: label }),
      jsx("b", { id, children: "\u2014" }),
    ],
  });
}

// ===== OpenAPI =====

function buildOpenAPISpec(apps: RegisteredApp[]): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  const tags: Array<{ name: string }> = [];

  for (const ra of apps) {
    const prefix = ra.prefix || "";
    tags.push({ name: ra.name });

    for (const route of ra.app.getRoutes()) {
      const fullPath = prefix + route.path;
      const openPath = fullPath.replace(/:([^/]+)/g, "{$1}");
      const method = route.method.toLowerCase();

      if (!paths[openPath]) {
        paths[openPath] = {};
      }

      paths[openPath][method] = {
        operationId: ra.name + "_" + route.method + "_" + route.path.replace(/[^a-zA-Z0-9]/g, "_"),
        summary: route.method + " " + route.path,
        tags: [ra.name],
        responses: {
          "200": { description: "Successful response" },
          "400": { description: "Bad Request" },
          "500": { description: "Internal Server Error" },
        },
      };
    }
  }

  return {
    openapi: "3.0.3",
    info: {
      title: "Workspace API",
      version: "1.0.0",
      description: apps.length + " sub-app(s)",
    },
    tags,
    paths,
  };
}

function buildSwaggerHTML(jsonUrl: string, title: string): string {
  var lines = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<title>' + title + ' - Workspace API Docs</title>',
    '<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">',
    '<style>html{box-sizing:border-box;overflow-y:scroll}*,*:before,*:after{box-sizing:inherit}body{margin:0;background:#fafafa}.swagger-ui .topbar{display:none}</style>',
    '</head>',
    '<body>',
    '<div id="swagger-ui"></div>',
    '<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>',
    '<script>',
    'window.onload=function(){',
    "SwaggerUIBundle({",
    "url:'" + jsonUrl + "',",
    "dom_id:'#swagger-ui',",
    "deepLinking:true,",
    "presets:[SwaggerUIBundle.presets.apis,SwaggerUIBundle.SwaggerUIStandalonePreset],",
    "layout:'StandaloneLayout'",
    "})",
    "};",
    '</script>',
    '</body>',
    '</html>',
  ];
  return lines.join("\n");
}

// ===== Workspace Class =====

export class Workspace {
  private apps: RegisteredApp[] = [];
  private options: Required<Omit<WorkspaceOptions, "bus">>;
  private server: any = null;
  private collectors = new Map<string, WorkspaceMetricsCollector>();
  private bus: EventBus | undefined;

  constructor(options: WorkspaceOptions = {}) {
    this.options = {
      port: options.port ?? 3000,
      hostname: options.hostname ?? "0.0.0.0",
      dashboard: options.dashboard ?? true,
      dashboardPath: options.dashboardPath ?? "/__asi/workspace",
      openapi: options.openapi ?? true,
      openapiPath: options.openapiPath ?? "/__asi/docs",
      onError: options.onError ?? (() => new Response("Workspace Error", { status: 500 })),
      verbose: options.verbose ?? true,
      metrics: options.metrics ?? true,
      metricsPath: options.metricsPath ?? "/__asi/metrics",
      shutdownTimeoutMs: options.shutdownTimeoutMs ?? 10_000,
    };
    this.bus = options.bus;
  }

  app(name: string, config: AsiConfig, setup: (app: Asi) => void): this {
    var asiApp = new Asi(config);
    this.prepareApp(name, asiApp);
    setup(asiApp);
    this.apps.push({ name: name, app: asiApp });
    return this;
  }

  appWith(config: WorkspaceAppConfig): this {
    var asiApp = new Asi(config.config);
    this.prepareApp(config.name, asiApp);
    config.setup(asiApp);
    this.apps.push({
      name: config.name,
      hostname: config.hostname,
      prefix: config.prefix,
      app: asiApp,
    });
    return this;
  }

  /** Wire metrics middleware and shared state bus into a sub-app */
  private prepareApp(name: string, asiApp: Asi): void {
    if (this.options.metrics) {
      const collector = new WorkspaceMetricsCollector();
      this.collectors.set(name, collector);
      asiApp.use(metricsCollectorMiddleware(collector));
    }
    if (this.bus) {
      asiApp.setState("eventBus", this.bus);
    }
  }

  listen(portArg?: number, callback?: () => void): any {
    var port = portArg ?? this.options.port;
    var opts = this.options;

    for (var ra of this.apps) {
      ra.app.compile();
    }

    if (opts.verbose) {
      this.printBanner(port);
    }

    this.server = Bun.serve({
      port: port,
      hostname: opts.hostname,
      fetch: (request: Request) => this.handleRequest(request),
    });

    callback?.();
    return this.server;
  }

  private async handleRequest(request: Request): Promise<Response> {
    var url = new URL(request.url);
    var host = request.headers.get("host") || "";
    var path = url.pathname;
    var opts = this.options;

    // 1. Internal routes
    if (opts.dashboard || opts.openapi) {
      var internalResp = await this.tryInternal(path, request);
      if (internalResp) return internalResp;
    }

    // Helper: safely call app.handle with error fallback
    var safeHandle = async function(app: Asi, req: Request): Promise<Response> {
      try {
        return await app.handle(req);
      } catch (err) {
        return opts.onError(err, req);
      }
    };

    // 2. Match by hostname
    for (var ra of this.apps) {
      if (ra.hostname && (host === ra.hostname || host.startsWith(ra.hostname + ":"))) {
        return safeHandle(ra.app, request);
      }
    }

    // 3. Match by prefix
    for (var ra of this.apps) {
      if (ra.prefix && (path === ra.prefix || path.startsWith(ra.prefix + "/"))) {
        return safeHandle(ra.app, request);
      }
    }

    // 4. Default app (first without hostname/prefix)
    var defaultApp = this.apps.find(function(a) { return !a.hostname && !a.prefix; });
    if (defaultApp) return safeHandle(defaultApp.app, request);

    // 5. Error
    return opts.onError(
      new Error('No app for host="' + host + '" path="' + path + '"'),
      request,
    );
  }

  private async tryInternal(path: string, request: Request): Promise<Response | null> {
    var opts = this.options;

    // Dashboard HTML
    if (opts.dashboard && path === opts.dashboardPath) {
      var html = await renderToString(buildDashboard(this.apps, this));
      return new Response("<!DOCTYPE html>" + html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // Metrics JSON
    if (opts.metrics && path === opts.metricsPath) {
      var snapshot = buildMetricsSnapshot(this);
      return new Response(JSON.stringify(snapshot), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      });
    }

    // OpenAPI JSON spec
    if (opts.openapi && (path === opts.openapiPath + ".json" || path === opts.openapiPath + "/openapi.json")) {
      var doc = buildOpenAPISpec(this.apps);
      return new Response(JSON.stringify(doc, null, 2), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // OpenAPI Swagger UI
    if (opts.openapi && path === opts.openapiPath) {
      var jsonUrl = new URL(opts.openapiPath + "/openapi.json", request.url).href;
      return new Response(buildSwaggerHTML(jsonUrl, "Workspace API"), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return null;
  }

  /**
   * Graceful shutdown cascade — sub-apps first, then the root server.
   *
   * 1. Drain each sub-app's WebSocket connections
   * 2. Run each sub-app's lifecycle manager (if attached via lifecycle())
   * 3. Stop the shared Bun.serve root server
   */
  async stop(): Promise<void> {
    // 1. Sub-apps: drain WebSockets + lifecycle shutdown
    for (const ra of this.apps) {
      try {
        if (ra.app.wsConnectionCount > 0) {
          await ra.app.drainWebSockets(this.options.shutdownTimeoutMs);
        }
      } catch {
        // Drain failures shouldn't block the cascade
      }

      const lifecycleManager = ra.app.state<{ shutdown: () => Promise<void> }>("lifecycleManager");
      if (lifecycleManager && typeof lifecycleManager.shutdown === "function") {
        try {
          await lifecycleManager.shutdown();
        } catch {
          // Continue the cascade even if one sub-app fails
        }
      } else {
        ra.app.stop();
      }
    }

    // 2. Root server last
    if (this.server) {
      this.server.stop();
      this.server = null;
    }
  }

  /** Get the metrics collector for a sub-app (internal) */
  getCollector(name: string): WorkspaceMetricsCollector | undefined {
    return this.collectors.get(name);
  }

  /** Registered sub-apps (internal, for dashboard/metrics) */
  getApps(): RegisteredApp[] {
    return this.apps;
  }

  /** The shared state bus (undefined when not configured) */
  getBus(): EventBus | undefined {
    return this.bus;
  }

  /** Bus stats for the dashboard (null when no bus) */
  getBusStats(): ReturnType<EventBus["stats"]> | null {
    return this.bus ? this.bus.stats() : null;
  }

  /** Metrics endpoint path */
  get metricsPath(): string {
    return this.options.metricsPath;
  }

  private printBanner(port: number): void {
    var opts = this.options;
    var total = this.apps.reduce(function(s, a) { return s + a.app.getRoutes().length; }, 0);

    console.log("");
    console.log("  \uD83C\uDFD7\uFE0F  Workspace \u2014 " + this.apps.length + " app(s), " + total + " routes");
    for (var ra of this.apps) {
      var routes = ra.app.getRoutes().length;
      var plugins = ra.app.getPlugins().length;
      var route = ra.hostname
        ? "host=" + ra.hostname
        : ra.prefix
          ? "prefix=" + ra.prefix
          : "port=" + port;
      console.log("     " + ra.name.padEnd(16) + " " + routes + "r " + plugins + "p  " + route);
    }
    if (opts.dashboard) {
      console.log("     " + "Dashboard".padEnd(16) + " http://localhost:" + port + opts.dashboardPath);
    }
    if (opts.openapi) {
      console.log("     " + "OpenAPI".padEnd(16) + " http://localhost:" + port + opts.openapiPath);
    }
    console.log("");
  }
}

export function createWorkspace(options?: WorkspaceOptions): Workspace {
  return new Workspace(options);
}
