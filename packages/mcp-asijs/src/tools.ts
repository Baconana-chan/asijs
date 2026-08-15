/**
 * asijs-mcp — Built-in tools
 *
 * Deep AsiJS integration tools: routes, OpenAPI, plugins (with the
 * dependency graph), middleware, app state, circuit breakers, WebSocket
 * pub-sub rooms, hot reload, SSG paths, serverless warm-up, rate limiter
 * metrics, and workflows.
 *
 * Legacy v1 tool names (`list_routes`, `get_openapi`, …) are kept as
 * aliases for backwards compatibility.
 */

import type { MCPServer } from "./server";
import { errorResult, stringify } from "./content";
import type { MCPTool, ToolContext } from "./types";

/** Convert a plain object to minimal YAML (enough for an OpenAPI spec) */
export function toYAML(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (value === null || value === undefined) return `${pad}null`;
  if (typeof value === "string") return `${pad}"${value.replace(/"/g, '\\"')}"`;
  if (typeof value === "number" || typeof value === "boolean") return `${pad}${String(value)}`;

  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]`;
    return value.map((v) => `${pad}- ${toYAML(v, indent + 1).trimStart()}`).join("\n");
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return `${pad}{}`;
    const lines: string[] = [];
    for (const [key, v] of entries) {
      if (v === null || v === undefined) continue;
      if (typeof v === "object" && !Array.isArray(v)) {
        lines.push(`${pad}${key}:`);
        lines.push(toYAML(v, indent + 1));
      } else if (Array.isArray(v)) {
        lines.push(`${pad}${key}:`);
        lines.push(toYAML(v, indent + 1));
      } else {
        lines.push(`${pad}${key}: ${toYAML(v, 0).trimStart()}`);
      }
    }
    return lines.join("\n");
  }

  return `${pad}${String(value)}`;
}

export function createBuiltinTools(server: MCPServer): MCPTool[] {
  const runtime = server.runtimeBridge;

  /** Guard for mutating tools */
  const requireMutation = (): string | null =>
    server.allowMutation ? null : "Disabled — enable `allowMutation` in the MCP server options";

  const tools: MCPTool[] = [
    // ===== Routes =====
    {
      name: "asijs/routes/list",
      description:
        "List all routes registered in the AsiJS application. Returns method, path, validation and middleware flags. Optional `method` filter.",
      inputSchema: {
        type: "object",
        properties: { method: { type: "string", description: "Filter by HTTP method (GET, POST, …)" } },
      },
      handler: (args) => {
        const result = runtime.routes();
        if (!result.available) return result;
        if (args.method) {
          return {
            ...result,
            total: result.routes.filter((r) => r.method === args.method).length,
            routes: result.routes.filter((r) => r.method === args.method),
          };
        }
        return result;
      },
    },
    {
      name: "asijs/routes/analyze",
      description:
        "Analyze a route for potential issues or improvements (missing validation, naming, middleware).",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Route path (e.g. /users/:id)" },
          method: { type: "string", description: "Optional HTTP method" },
        },
        required: ["path"],
      },
      handler: (args) => runtime.analyzeRoute(String(args.path), args.method ? String(args.method) : undefined),
    },
    {
      name: "asijs/routes/suggest",
      description: "Suggest a conventional RESTful route set for a resource.",
      inputSchema: {
        type: "object",
        properties: { resource: { type: "string", description: "Resource name (e.g. users)" } },
        required: ["resource"],
      },
      handler: (args) => runtime.suggestRoutes(String(args.resource)),
    },

    // ===== OpenAPI =====
    {
      name: "asijs/openapi/get",
      description: "Generate the OpenAPI specification for the application (json or yaml).",
      inputSchema: {
        type: "object",
        properties: { format: { type: "string", enum: ["json", "yaml"], default: "json" } },
      },
      handler: (args) => {
        const spec = runtime.openAPI();
        if (args.format === "yaml" && spec && typeof spec === "object" && "paths" in spec) {
          return { format: "yaml", spec: toYAML(spec) };
        }
        return spec;
      },
    },

    // ===== Plugins =====
    {
      name: "asijs/plugins/list",
      description: "List all registered plugins.",
      inputSchema: { type: "object", properties: {} },
      handler: () => runtime.plugins(),
    },
    {
      name: "asijs/plugins/graph",
      description:
        "Plugin dependency graph: nodes with init status, edges, initialization order, and cycle detection.",
      inputSchema: { type: "object", properties: {} },
      handler: () => runtime.pluginGraph(),
    },
    {
      name: "asijs/middleware/info",
      description: "Global and path-based middleware counts.",
      inputSchema: { type: "object", properties: {} },
      handler: () => runtime.middleware(),
    },

    // ===== App state =====
    {
      name: "asijs/state/get",
      description: "Application state: port, hostname, dev mode, route/plugin/middleware counts.",
      inputSchema: { type: "object", properties: {} },
      handler: () => runtime.appState(),
    },
    {
      name: "asijs/state/set",
      description: "Set a shared state value on the AsiJS application. Requires `allowMutation`.",
      inputSchema: {
        type: "object",
        properties: {
          key: { type: "string", description: "State key" },
          value: { description: "State value (JSON-serializable)" },
        },
        required: ["key"],
      },
      handler: (args, ctx: ToolContext) => {
        const disabled = requireMutation();
        if (disabled) return errorResult(disabled);
        const key = String(args.key);
        const ok = runtime.setState(key, args.value);
        ctx.log("info", `state.${key} set`, "asijs/state/set");
        return { ok, key };
      },
    },

    // ===== Circuit breakers =====
    {
      name: "asijs/circuit-breakers/list",
      description:
        "Circuit breaker health: CLOSED/OPEN/HALF_OPEN states, success/failure/reject counts, recovery status.",
      inputSchema: { type: "object", properties: {} },
      handler: () => runtime.circuitBreakers(),
    },
    {
      name: "asijs/circuit-breakers/reset",
      description: "Reset a circuit breaker to CLOSED (or all breakers when `name` is omitted). Requires `allowMutation`.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string", description: "Breaker name — omit to reset all" } },
      },
      handler: (args, ctx: ToolContext) => {
        const disabled = requireMutation();
        if (disabled) return errorResult(disabled);
        const name = args.name ? String(args.name) : undefined;
        const result = name
          ? { ok: runtime.resetCircuitBreaker(name), name }
          : { ok: true, reset: runtime.resetAllCircuitBreakers(), all: true };
        ctx.log("warning", `circuit breaker reset: ${name ?? "all"}`, "asijs/circuit-breakers/reset");
        return result;
      },
    },

    // ===== WebSocket pub-sub =====
    {
      name: "asijs/ws/rooms",
      description:
        "WebSocket pub-sub state: active connections, rooms, presence count, and per-room connection counts.",
      inputSchema: { type: "object", properties: {} },
      handler: () => runtime.wsRooms(),
    },
    {
      name: "asijs/ws/presence",
      description: "Presence data for connections in a WebSocket room.",
      inputSchema: {
        type: "object",
        properties: { room: { type: "string", description: "Room name" } },
        required: ["room"],
      },
      handler: (args) => runtime.wsRoomDetails(String(args.room)),
    },

    // ===== Hot reload =====
    {
      name: "asijs/hot-reload/status",
      description: "Hot reloader status: watching state, watcher count, pending file changes.",
      inputSchema: { type: "object", properties: {} },
      handler: () => runtime.hotReload(),
    },

    // ===== Serverless =====
    {
      name: "asijs/serverless/status",
      description: "Serverless warm-up status: whether the app was warmed up and the warm-up time.",
      inputSchema: { type: "object", properties: {} },
      handler: () => runtime.serverlessStatus(),
    },

    // ===== SSG =====
    {
      name: "asijs/ssg/paths",
      description: "Static site generation paths (configured or computed from GET routes without params).",
      inputSchema: { type: "object", properties: {} },
      handler: () => runtime.ssgPaths(),
    },

    // ===== Rate limiter =====
    {
      name: "asijs/ratelimit/metrics",
      description: "Rate limiter metrics (current RPS, limits) when a rate limiter is registered.",
      inputSchema: { type: "object", properties: {} },
      handler: () => runtime.rateLimiter(),
    },

    // ===== Workflows =====
    {
      name: "asijs/workflow/list",
      description: "List available workflows that can be executed.",
      inputSchema: { type: "object", properties: {} },
      handler: () => ({
        available: true,
        workflows: server.workflowNames.map((name) => {
          const w = server.workflow(name);
          return { name, description: w?.description };
        }),
      }),
    },
    {
      name: "asijs/workflow/run",
      description:
        "Execute a workflow with the given input. Workflows can chain HTTP calls, code steps and delays. Emits progress notifications.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Workflow name" },
          input: { type: "object", description: "Workflow input arguments" },
        },
        required: ["name"],
      },
      handler: async (args, ctx: ToolContext) => {
        const name = String(args.name);
        const input = (args.input ?? {}) as Record<string, unknown>;
        if (!server.workflowNames.includes(name)) {
          return errorResult(`Workflow not found: ${name}`);
        }
        ctx.progress(0, 100, `Starting workflow ${name}`);
        const result = await server.runWorkflow(name, input, ctx);
        ctx.progress(100, 100, `Workflow ${name} complete`);
        return result;
      },
    },

    // ===== Utility =====
    {
      name: "asijs/ping",
      description: "Server status and uptime information.",
      inputSchema: { type: "object", properties: {} },
      handler: () => ({
        status: "ok",
        server: server.name,
        version: server.version,
        tools: server.toolNames.length,
        workflows: server.workflowNames.length,
      }),
    },

    // ===== Legacy aliases (v1 compatibility) =====
    {
      name: "list_routes",
      description: "List all routes registered in the AsiJS application (legacy alias of asijs/routes/list).",
      inputSchema: {
        type: "object",
        properties: { method: { type: "string", description: "Filter by HTTP method" } },
      },
      handler: (args) => runtime.routes(),
    },
    {
      name: "get_route_details",
      description: "Get detailed information about a specific route (legacy).",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          method: { type: "string" },
        },
        required: ["path"],
      },
      handler: (args) => runtime.analyzeRoute(String(args.path), args.method ? String(args.method) : undefined),
    },
    {
      name: "get_plugins",
      description: "List all registered plugins (legacy alias of asijs/plugins/list).",
      inputSchema: { type: "object", properties: {} },
      handler: () => runtime.plugins(),
    },
    {
      name: "get_middleware",
      description: "Get middleware counts (legacy alias of asijs/middleware/info).",
      inputSchema: { type: "object", properties: {} },
      handler: () => runtime.middleware(),
    },
    {
      name: "get_openapi",
      description: "Generate the OpenAPI specification (legacy alias of asijs/openapi/get).",
      inputSchema: { type: "object", properties: {} },
      handler: () => runtime.openAPI(),
    },
    {
      name: "analyze_route",
      description: "Analyze a route for potential issues (legacy alias of asijs/routes/analyze).",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
      handler: (args) => runtime.analyzeRoute(String(args.path)),
    },
    {
      name: "get_app_state",
      description: "Get application state and configuration (legacy alias of asijs/state/get).",
      inputSchema: { type: "object", properties: {} },
      handler: () => runtime.appState(),
    },
    {
      name: "suggest_routes",
      description: "Suggest RESTful routes for a resource (legacy alias of asijs/routes/suggest).",
      inputSchema: {
        type: "object",
        properties: { resource: { type: "string" } },
        required: ["resource"],
      },
      handler: (args) => runtime.suggestRoutes(String(args.resource)),
    },
  ];

  return tools;
}

// Re-export helpers used elsewhere
export { stringify };
