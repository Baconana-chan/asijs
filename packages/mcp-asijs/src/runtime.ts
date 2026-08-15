/**
 * asijs-mcp — AsiJS runtime bridge
 *
 * Gives AI assistants live visibility into a running AsiJS application:
 * routes, plugins (with the dependency graph), middleware, circuit breakers,
 * WebSocket pub-sub rooms, hot reload state, SSG pages, serverless warm-up
 * stats, and rate limiter metrics.
 *
 * Every accessor is defensive — if the application doesn't use a feature,
 * the tool returns a friendly "not available" value instead of throwing.
 */

import {
  getCircuitBreakerRegistry,
  serverless,
  type Asi,
  type CircuitBreakerMetrics,
  type RoomManager,
  type HotReloader,
} from "asijs";
import type { RuntimeBridgeOptions } from "./types";

/** Structural subset of RoomManager we rely on (keeps the bridge testable) */
export interface RoomManagerLike {
  getStats(): { connections: number; rooms: number; presenceCount: number; roomStats: Array<{ room: string; count: number }> };
  listRooms(): string[];
  getRoomCount(room: string): number;
  hasRoom?(room: string): boolean;
  getRoomPresence?(room: string): Array<{ data: Record<string, unknown> }>;
  getAllPresence?(): Map<unknown, Record<string, unknown>>;
}

/** Structural subset of HotReloader we rely on */
export interface HotReloaderLike {
  isWatching: boolean;
  watcherCount: number;
  pendingCount: number;
}

export class AsiRuntimeBridge {
  private app: Asi | null;
  private options: {
    roomManagers: RoomManagerLike[];
    hotReloader: HotReloaderLike | null;
    ssgPaths: string[];
    rateLimiter: RuntimeBridgeOptions["rateLimiter"] | null;
  };

  constructor(app: Asi | null, options: RuntimeBridgeOptions = {}) {
    this.app = app;
    this.options = {
      roomManagers: options.roomManagers ? (Array.isArray(options.roomManagers) ? options.roomManagers : [options.roomManagers]) : [],
      hotReloader: (options.hotReloader as HotReloaderLike | null) ?? null,
      ssgPaths: options.ssgPaths ?? [],
      rateLimiter: options.rateLimiter ?? null,
    };
  }

  /** Bind or replace the Asi application instance */
  setApp(app: Asi | null): void {
    this.app = app;
  }

  get appInstance(): Asi | null {
    return this.app;
  }

  // ===== Routes =====

  routes() {
    const app = this.app;
    if (!app || typeof app.getRoutes !== "function") {
      return { available: false, reason: "No Asi application bound", routes: [] };
    }
    try {
      const routes = app.getRoutes();
      return { available: true, total: routes.length, routes };
    } catch (err) {
      return { available: false, reason: String(err), routes: [] };
    }
  }

  analyzeRoute(path: string, method?: string) {
    const app = this.app;
    if (!app || typeof app.getRoutes !== "function") {
      return { available: false, reason: "No Asi application bound" };
    }
    const routes = app.getRoutes();
    const route = routes.find((r) => r.path === path && (!method || r.method === method));

    if (!route) {
      return { path, method, found: false, issues: ["Route not found"], suggestions: [] };
    }

    const issues: string[] = [];
    const suggestions: string[] = [];

    if (!route.hasValidation && route.method !== "GET") {
      suggestions.push("Consider adding body/query validation for non-GET routes");
    }
    if (path.includes("_")) {
      suggestions.push("Consider kebab-case instead of snake_case in URL paths");
    }
    if (!path.startsWith("/")) {
      issues.push("Route path should start with '/'");
    }
    if (route.hasMiddleware) {
      suggestions.push("Route has middleware — check ordering and auth coverage");
    }

    return { path, method: route.method, found: true, hasValidation: route.hasValidation, hasMiddleware: route.hasMiddleware, issues, suggestions };
  }

  /** Suggest a conventional RESTful route set for a resource */
  suggestRoutes(resource: string) {
    const singular = resource.endsWith("s") ? resource.slice(0, -1) : resource;
    return [
      { method: "GET", path: `/${resource}`, description: `List all ${resource}` },
      { method: "GET", path: `/${resource}/:id`, description: `Get a specific ${singular}` },
      { method: "POST", path: `/${resource}`, description: `Create a new ${singular}` },
      { method: "PUT", path: `/${resource}/:id`, description: `Replace a ${singular}` },
      { method: "PATCH", path: `/${resource}/:id`, description: `Partially update a ${singular}` },
      { method: "DELETE", path: `/${resource}/:id`, description: `Delete a ${singular}` },
    ];
  }

  // ===== OpenAPI =====

  openAPI() {
    const routes = this.routes();
    if (!routes.available) return routes;

    const paths: Record<string, Record<string, unknown>> = {};
    for (const route of routes.routes) {
      const openApiPath = route.path.replace(/:(\w+)/g, "{$1}");
      paths[openApiPath] ??= {};
      paths[openApiPath][route.method.toLowerCase()] = {
        summary: `${route.method} ${route.path}`,
        responses: { "200": { description: "Successful response" } },
      };
    }

    const app = this.app;
    const cfg = app && typeof app.getAppConfig === "function" ? app.getAppConfig() : null;

    return {
      openapi: "3.0.0",
      info: {
        title: cfg?.development ? "AsiJS Application (development)" : "AsiJS Application",
        version: "1.0.0",
      },
      paths,
    };
  }

  // ===== Plugins =====

  plugins() {
    const app = this.app;
    if (!app || typeof app.getPlugins !== "function") {
      return { available: false, reason: "No Asi application bound", plugins: [] };
    }
    return { available: true, plugins: app.getPlugins() };
  }

  pluginGraph() {
    const app = this.app;
    if (!app || typeof app.pluginInfo !== "function") {
      return { available: false, reason: "No Asi application bound" };
    }
    try {
      const info = app.pluginInfo();
      return {
        available: true,
        nodes: info.nodes.map((n) => ({ name: n.name, status: n.status, dependencies: n.dependencies })),
        edges: info.edges,
        initOrder: info.initOrder,
        hasCycle: info.hasCycle,
        cyclePath: info.cyclePath,
      };
    } catch (err) {
      return { available: false, reason: String(err) };
    }
  }

  middleware() {
    const app = this.app;
    if (!app || typeof app.getMiddlewareInfo !== "function") {
      return { available: false, reason: "No Asi application bound" };
    }
    return { available: true, ...app.getMiddlewareInfo() };
  }

  // ===== App state =====

  appState() {
    const app = this.app;
    if (!app || typeof app.getAppConfig !== "function") {
      return { available: false, reason: "No Asi application bound" };
    }
    const cfg = app.getAppConfig();
    const routes = this.routes();
    return {
      available: true,
      port: cfg.port,
      hostname: cfg.hostname,
      development: cfg.development,
      routes: routes.available ? routes.total : 0,
      plugins: this.plugins(),
      middleware: this.middleware(),
    };
  }

  getState<T = unknown>(key: string): T | undefined {
    const app = this.app;
    if (!app || typeof app.state !== "function") return undefined;
    return app.state<T>(key);
  }

  setState(key: string, value: unknown): boolean {
    const app = this.app;
    if (!app || typeof app.setState !== "function") return false;
    app.setState(key, value);
    return true;
  }

  // ===== Circuit breakers =====

  circuitBreakers() {
    try {
      const registry = getCircuitBreakerRegistry();
      const names = registry.getNames();
      const metrics = registry.getAllMetrics();
      const summary = { open: 0, halfOpen: 0, closed: 0, total: names.length };
      for (const m of Object.values(metrics)) {
        if (m.state === "OPEN") summary.open++;
        else if (m.state === "HALF_OPEN") summary.halfOpen++;
        else summary.closed++;
      }
      return {
        available: true,
        summary,
        breakers: names.map((name) => ({ name, metrics: metrics[name] })),
      };
    } catch {
      return { available: false, reason: "Circuit breaker registry unavailable", breakers: [] };
    }
  }

  circuitBreaker(name: string): CircuitBreakerMetrics | null {
    try {
      const metrics = getCircuitBreakerRegistry().getAllMetrics();
      return metrics[name] ?? null;
    } catch {
      return null;
    }
  }

  resetCircuitBreaker(name: string): boolean {
    try {
      const registry = getCircuitBreakerRegistry();
      const breaker = registry.get(name);
      if (!breaker) return false;
      breaker.reset();
      return true;
    } catch {
      return false;
    }
  }

  resetAllCircuitBreakers(): number {
    try {
      const registry = getCircuitBreakerRegistry();
      const count = registry.getNames().length;
      registry.resetAll();
      return count;
    } catch {
      return 0;
    }
  }

  // ===== WebSocket pub-sub =====

  private roomManagers(): RoomManagerLike[] {
    const list = Array.isArray(this.options.roomManagers)
      ? this.options.roomManagers
      : this.options.roomManagers
        ? [this.options.roomManagers]
        : [];
    return list;
  }

  wsRooms() {
    const managers = this.roomManagers();
    if (managers.length === 0) {
      return { available: false, reason: "No RoomManager registered (pass `roomManagers` to the MCP server options)", managers: [] };
    }
    return {
      available: true,
      managers: managers.map((m) => {
        const stats = m.getStats();
        return {
          connections: stats.connections,
          roomCount: stats.rooms,
          presenceCount: stats.presenceCount,
          roomStats: stats.roomStats,
          rooms: m.listRooms(),
        };
      }),
    };
  }

  wsRoomDetails(room: string) {
    const managers = this.roomManagers();
    const results: unknown[] = [];
    for (const m of managers) {
      const count = m.getRoomCount(room);
      const presence = m.getRoomPresence
        ? m.getRoomPresence(room).map((p) => p.data)
        : [];
      results.push({ count, presence });
    }
    return { available: results.length > 0, room, managers: results };
  }

  // ===== Hot reload =====

  hotReload() {
    const hr = this.options.hotReloader;
    if (!hr) {
      return { available: false, reason: "No HotReloader registered (pass `hotReloader` to the MCP server options)" };
    }
    return {
      available: true,
      isWatching: hr.isWatching,
      watcherCount: hr.watcherCount,
      pendingCount: hr.pendingCount,
    };
  }

  // ===== Serverless =====

  serverlessStatus() {
    return {
      available: true,
      isWarmedUp: serverless.isWarmedUp,
      warmUpTimeMs: serverless.warmUpTime,
    };
  }

  // ===== SSG =====

  ssgPaths() {
    const explicit = this.options.ssgPaths;
    if (explicit && explicit.length > 0) {
      return { available: true, source: "configured", paths: explicit };
    }
    const routes = this.routes();
    if (!routes.available) return { available: false, reason: "No Asi application bound", paths: [] };
    const staticPaths = routes.routes
      .filter((r) => r.method === "GET" && !r.path.includes(":"))
      .map((r) => r.path);
    return { available: true, source: "computed-from-routes", paths: staticPaths };
  }

  // ===== Rate limiter =====

  rateLimiter() {
    const rl = this.options.rateLimiter;
    if (!rl || typeof rl.getMetrics !== "function") {
      return { available: false, reason: "No rate limiter registered (pass `rateLimiter` with a getMetrics() to the MCP server options)" };
    }
    const metrics = rl.getMetrics();
    return {
      available: true,
      name: rl.name ?? "rate-limiter",
      metrics: metrics instanceof Promise ? undefined : metrics,
    };
  }
}
