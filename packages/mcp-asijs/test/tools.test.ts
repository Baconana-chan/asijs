/**
 * Tests: AsiJS runtime bridge tools — routes, OpenAPI, plugins graph,
 * circuit breakers, WebSocket rooms, hot reload, SSG, serverless,
 * rate limiter and workflows.
 */

import { describe, expect, it } from "bun:test";
import {
  Asi,
  circuitBreaker,
  getCircuitBreakerRegistry,
  resetCircuitBreakerRegistry,
} from "../../../src/index.ts";
import { createMCPServer, type RoomManagerLike } from "../src/index";

interface CallResult {
  result: {
    content: Array<{ text: string }>;
    isError?: boolean;
    structuredContent?: unknown;
  };
}

async function callTool(
  server: ReturnType<typeof createMCPServer>,
  name: string,
  args: Record<string, unknown> = {},
  id = 1,
): Promise<CallResult> {
  const response = (await server.handleRaw({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args },
  })) as CallResult;
  return response;
}

function parseText(result: CallResult): unknown {
  return JSON.parse(result.result.content[0].text);
}

function makeRoomManager(): RoomManagerLike {
  const rooms = new Map<string, number>();
  return {
    getStats: () => ({
      connections: 3,
      rooms: rooms.size,
      presenceCount: 2,
      roomStats: Array.from(rooms.entries()).map(([room, count]) => ({ room, count })),
    }),
    listRooms: () => Array.from(rooms.keys()),
    getRoomCount: (room: string) => rooms.get(room) ?? 0,
    hasRoom: (room: string) => rooms.has(room),
    getRoomPresence: (room: string) =>
      room === "general" ? [{ data: { username: "alice" } }, { data: { username: "bob" } }] : [],
  };
}

describe("asijs-mcp AsiJS bridge tools", () => {
  it("lists routes from a bound Asi app", async () => {
    const app = new Asi({ development: false, silent: true });
    app.get("/users", () => []);
    app.get("/users/:id", () => ({}), { schema: { params: {} } as never });
    app.post("/users", () => ({}));

    const server = createMCPServer(app);
    const result = await callTool(server, "asijs/routes/list");
    const data = parseText(result) as { available: boolean; routes: Array<{ method: string; path: string }> };

    expect(data.available).toBe(true);
    expect(data.routes.map((r) => `${r.method} ${r.path}`)).toContain("GET /users/:id");
    expect(data.routes).toHaveLength(3);
  });

  it("analyzes a route and suggests improvements", async () => {
    const app = new Asi({ development: false, silent: true });
    app.post("/api/create_user", () => ({})); // snake_case, no validation

    const server = createMCPServer(app);
    const result = await callTool(server, "asijs/routes/analyze", { path: "/api/create_user" });
    const data = parseText(result) as { found: boolean; issues: string[]; suggestions: string[] };

    expect(data.found).toBe(true);
    expect(data.suggestions.some((s) => s.includes("validation"))).toBe(true);
    expect(data.suggestions.some((s) => s.includes("kebab-case"))).toBe(true);
  });

  it("suggests RESTful routes for a resource", async () => {
    const server = createMCPServer(null);
    const result = await callTool(server, "asijs/routes/suggest", { resource: "users" });
    const data = parseText(result) as Array<{ method: string; path: string }>;
    expect(data).toHaveLength(6);
    expect(data[0]).toEqual({ method: "GET", path: "/users", description: expect.any(String) as never });
  });

  it("generates OpenAPI with paths from routes", async () => {
    const app = new Asi({ development: false, silent: true });
    app.get("/health", () => ({ ok: true }));
    app.get("/users/:id", () => ({}));

    const server = createMCPServer(app);
    const result = await callTool(server, "asijs/openapi/get", { format: "yaml" });
    const data = parseText(result) as { format: string; spec: string };
    expect(data.format).toBe("yaml");
    expect(data.spec).toContain("/users/{id}");
  });

  it("reports the plugin dependency graph", async () => {
    const app = new Asi({ development: false, silent: true });
    const pluginA = { name: "plugin-a", config: {}, apply: async () => {} };
    const pluginB = { name: "plugin-b", config: {}, apply: async () => {} };
    app.plugin(pluginA as never).dependsOn([] as never);
    app.plugin(pluginB as never).dependsOn(["plugin-a"] as never);
    await app.initPlugins();

    const server = createMCPServer(app);
    const result = await callTool(server, "asijs/plugins/graph");
    const data = parseText(result) as { available: boolean; initOrder: string[] };

    expect(data.available).toBe(true);
    expect(data.initOrder).toContain("plugin-a");
    expect(data.initOrder).toContain("plugin-b");
  });

  it("reports circuit breaker metrics and respects allowMutation gating", async () => {
    resetCircuitBreakerRegistry();
    const app = new Asi({ development: false, silent: true });
    app.use(circuitBreaker({ name: "db", threshold: 1 }));

    const breaker = getCircuitBreakerRegistry().get("db")!;
    breaker.forceState("OPEN");

    const server = createMCPServer(app, { allowMutation: false });
    const list = await callTool(server, "asijs/circuit-breakers/list");
    const data = parseText(list) as { summary: { open: number } };
    expect(data.summary.open).toBe(1);

    // Reset should be blocked without allowMutation
    const blocked = await callTool(server, "asijs/circuit-breakers/reset", { name: "db" });
    expect(blocked.result.isError).toBe(true);
    expect(breaker.state).toBe("OPEN");

    // With allowMutation it works
    const mutable = createMCPServer(app, { allowMutation: true });
    const reset = await callTool(mutable, "asijs/circuit-breakers/reset", { name: "db" });
    const resetData = parseText(reset) as { ok: boolean };
    expect(resetData.ok).toBe(true);
    expect(breaker.state).toBe("CLOSED");
    resetCircuitBreakerRegistry();
  });

  it("reports WebSocket room stats and presence", async () => {
    const manager = makeRoomManager();
    const app = new Asi({ development: false, silent: true });
    const server = createMCPServer(app, { runtime: { roomManagers: manager } });

    const rooms = await callTool(server, "asijs/ws/rooms");
    const roomsData = parseText(rooms) as { available: boolean; managers: Array<{ connections: number; rooms: string[] }> };
    expect(roomsData.available).toBe(true);
    expect(roomsData.managers[0].connections).toBe(3);

    const presence = await callTool(server, "asijs/ws/presence", { room: "general" });
    const presenceData = parseText(presence) as { room: string };
    expect(presenceData.room).toBe("general");
  });

  it("reports hot reload, serverless and SSG status", async () => {
    const app = new Asi({ development: false, silent: true });
    app.get("/", () => "home");
    app.get("/about", () => "about");
    app.get("/users/:id", () => ({}));

    const server = createMCPServer(app, {
      runtime: {
        hotReloader: { isWatching: true, watcherCount: 2, pendingCount: 0 },
        ssgPaths: ["/", "/about"],
      },
    });

    const hr = await callTool(server, "asijs/hot-reload/status");
    const hrData = parseText(hr) as { available: boolean; isWatching: boolean };
    expect(hrData.available).toBe(true);
    expect(hrData.isWatching).toBe(true);

    const sl = await callTool(server, "asijs/serverless/status");
    const slData = parseText(sl) as { available: boolean; isWarmedUp: boolean };
    expect(slData.available).toBe(true);
    expect(typeof slData.isWarmedUp).toBe("boolean");

    const ssg = await callTool(server, "asijs/ssg/paths");
    const ssgData = parseText(ssg) as { available: boolean; paths: string[] };
    expect(ssgData.available).toBe(true);
    expect(ssgData.paths).toContain("/about");
  });

  it("reports rate limiter metrics when registered", async () => {
    const app = new Asi({ development: false, silent: true });
    const server = createMCPServer(app, {
      runtime: {
        rateLimiter: {
          name: "api",
          getMetrics: () => ({ rps: 42, limit: 100, windowMs: 60_000 }),
        },
      },
    });

    const result = await callTool(server, "asijs/ratelimit/metrics");
    const data = parseText(result) as { available: boolean; metrics: { rps: number } };
    expect(data.available).toBe(true);
    expect(data.metrics.rps).toBe(42);
  });

  it("gates state/set behind allowMutation", async () => {
    const app = new Asi({ development: false, silent: true });
    const safe = createMCPServer(app);
    const blocked = await callTool(safe, "asijs/state/set", { key: "x", value: 1 });
    expect(blocked.result.isError).toBe(true);

    const mutable = createMCPServer(app, { allowMutation: true });
    const set = await callTool(mutable, "asijs/state/set", { key: "x", value: 1 });
    expect(parseText(set)).toEqual({ ok: true, key: "x" });
    expect(app.state("x")).toBe(1);
  });

  it("lists and runs workflows through tools", async () => {
    const app = new Asi({ development: false, silent: true });
    const server = createMCPServer(app, {
      workflows: [
        {
          name: "custom/hello",
          description: "Says hello",
          inputSchema: {
            type: "object",
            required: ["name"],
            properties: { name: { type: "string" } },
          },
          steps: [
            {
              type: "code",
              run: (input: Record<string, unknown>) => ({ message: `Hello, ${String(input.name)}!` }),
            },
          ],
        },
      ],
    });

    const list = await callTool(server, "asijs/workflow/list");
    const names = (parseText(list) as { workflows: Array<{ name: string }> }).workflows.map((w) => w.name);
    expect(names).toContain("custom/hello");
    expect(names).toContain("asijs/app-snapshot");

    const run = await callTool(server, "asijs/workflow/run", { name: "custom/hello", input: { name: "AI" } });
    const data = parseText(run) as { result: { message: string } };
    expect(data.result.message).toBe("Hello, AI!");
  });

  it("rejects workflow runs with invalid input", async () => {
    const app = new Asi({ development: false, silent: true });
    const server = createMCPServer(app, {
      workflows: [
        {
          name: "custom/needs-name",
          inputSchema: {
            type: "object",
            required: ["name"],
            properties: { name: { type: "string" } },
          },
          steps: [{ type: "code", run: () => true }],
        },
      ],
    });

    const run = await callTool(server, "asijs/workflow/run", { name: "custom/needs-name", input: {} });
    expect(run.result.isError).toBe(true);
    expect(run.result.content[0].text).toContain("Missing required property");
  });

  it("exposes legacy v1 tool names for compatibility", async () => {
    const app = new Asi({ development: false, silent: true });
    app.get("/ping", () => "pong");
    const server = createMCPServer(app);

    const legacy = await callTool(server, "list_routes");
    const data = parseText(legacy) as { routes: Array<{ path: string }> };
    expect(data.routes.map((r) => r.path)).toContain("/ping");
  });
});
