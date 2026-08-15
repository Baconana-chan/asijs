/**
 * Tests: Workspace v2 — Production Multi-App Dashboard
 *
 * - Live metrics endpoint (/__asi/metrics): request rate, error rate, ws, breakers
 * - Dashboard v2 HTML with inline polling script
 * - Shared state bus (EventBus) integration
 * - Graceful shutdown cascade (sub-apps → root)
 */

import { describe, expect, it, afterEach } from "bun:test";
import { Workspace, EventBus, createWorkspace } from "../src/index";

const started: Array<{ stop: () => Promise<void> | void }> = [];

afterEach(async () => {
  while (started.length > 0) {
    const s = started.pop()!;
    await s.stop();
  }
});

function startWs(opts: Record<string, unknown> = {}, setup?: (ws: Workspace) => void): Promise<{ ws: Workspace; port: number }> {
  const ws = new Workspace({ verbose: false, ...opts } as never);
  ws.app("api", { development: false, silent: true } as never, (app) => {
    app.get("/users", () => [{ id: 1 }]);
    app.post("/users", () => ({ created: true }), { schema: undefined as never });
  });
  ws.appWith({
    name: "web",
    config: { development: false, silent: true } as never,
    prefix: "/web",
    setup: (app) => {
      app.get("/", () => "Hello Web");
      app.get("/broken", () => {
        throw new Error("boom");
      });
    },
  });
  setup?.(ws);
  const server = ws.listen(0);
  const port = (server as { port: number }).port;
  started.push(ws);
  return Promise.resolve({ ws, port });
}

function fetchJson(path: string, port: number): Promise<any> {
  return fetch(`http://localhost:${port}${path}`).then((r) => r.json());
}

describe("Workspace v2 — dashboard & metrics", () => {
  it("serves dashboard HTML with live polling script", async () => {
    const { port } = await startWs();
    const res = await fetch(`http://localhost:${port}/__asi/workspace`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("AsiJS Workspace Dashboard");
    expect(html).toContain("__METRICS_URL__".replace("__METRICS_URL__", "/__asi/metrics"));
    expect(html).toContain("setInterval");
  });

  it("collects request metrics per app (total, status codes, routes)", async () => {
    const { ws, port } = await startWs();

    // Hit the default (api) app a few times, plus a failing request on web
    await fetch(`http://localhost:${port}/users`);
    await fetch(`http://localhost:${port}/users`);
    await fetch(`http://localhost:${port}/web/broken`).catch(() => {});

    const metrics = await fetchJson("/__asi/metrics", port);

    const api = metrics.apps.find((a: any) => a.name === "api");
    expect(api).toBeDefined();
    expect(api.totalRequests).toBeGreaterThanOrEqual(2);
    expect(api.statusCodes["200"]).toBeGreaterThanOrEqual(2);
    expect(api.routes.length).toBeGreaterThanOrEqual(1);
    expect(api.routes.some((r: any) => r.path === "/users")).toBe(true);
    expect(api.requestRate).toBeGreaterThan(0);

    const web = metrics.apps.find((a: any) => a.name === "web");
    expect(web).toBeDefined();
    // /web/broken doesn't exist inside the web app (prefix is stripped on routing
    // by the app itself) → 404, which is recorded as an error
    expect(web.errors).toBeGreaterThanOrEqual(1);
    expect(web.errorRate).toBeGreaterThan(0);
    expect(web.routes.some((r: any) => r.path === "/web/broken" && r.errors > 0)).toBe(true);
  });

  it("reports WebSocket connection counts", async () => {
    const { ws, port } = await startWs();
    const metrics = await fetchJson("/__asi/metrics", port);
    for (const app of metrics.apps) {
      expect(typeof app.wsConnections).toBe("number");
    }
  });

  it("reports circuit breaker status from the global registry", async () => {
    const { ws, port } = await startWs();
    const metrics = await fetchJson("/__asi/metrics", port);
    expect(Array.isArray(metrics.circuitBreakers)).toBe(true);
  });

  it("reports process-level CPU/memory", async () => {
    const { port } = await startWs();
    const metrics = await fetchJson("/__asi/metrics", port);
    expect(metrics.process.pid).toBe(process.pid);
    expect(metrics.process.memory.rss).toBeGreaterThan(0);
    expect(typeof metrics.process.cpu.user).toBe("number");
  });

  it("respects metrics: false (no metrics endpoint)", async () => {
    const { port } = await startWs({ metrics: false });
    const res = await fetch(`http://localhost:${port}/__asi/metrics`);
    // No metrics endpoint when disabled → falls through to default app → 404
    expect(res.status).toBe(404);
  });
});

describe("Workspace v2 — shared state bus", () => {
  it("exposes the bus to sub-apps via state and reports bus stats", async () => {
    const bus = new EventBus({ name: "shared" });
    let received: unknown = null;
    bus.on("app.deployed", (payload) => {
      received = payload;
    });

    const { ws, port } = await startWs({ bus });

    // Sub-app handlers can emit through the bus
    const api = ws.getApps().find((a) => a.name === "api");
    const apiBus = api!.app.state<EventBus>("eventBus");
    expect(apiBus).toBe(bus);

    apiBus!.emit("app.deployed", { name: "api", version: "1.4.0" });
    expect(received).toEqual({ name: "api", version: "1.4.0" });

    const metrics = await fetchJson("/__asi/metrics", port);
    expect(metrics.bus).not.toBeNull();
    expect(metrics.bus.name).toBe("shared");
    expect(metrics.bus.emitted).toBeGreaterThanOrEqual(1);
  });

  it("reports no bus in dashboard when not configured", async () => {
    const { port } = await startWs();
    const metrics = await fetchJson("/__asi/metrics", port);
    expect(metrics.bus).toBeNull();
  });
});

describe("EventBus", () => {
  it("emits to local handlers with meta", () => {
    const bus = new EventBus({ name: "test" });
    let received: unknown = null;
    let metaReceived: unknown = null;
    bus.on("event", (payload, meta) => {
      received = payload;
      metaReceived = meta;
    });
    bus.emit("event", { ok: true });
    expect(received).toEqual({ ok: true });
    expect((metaReceived as any).topic).toBe("event");
    expect((metaReceived as any).source).toBe("test");
    expect((metaReceived as any).remote).toBe(false);
  });

  it("supports once and off", () => {
    const bus = new EventBus();
    let count = 0;
    const off = bus.on("t", () => {
      count++;
    });
    bus.emit("t", 1);
    off();
    bus.emit("t", 2);
    expect(count).toBe(1);

    let onceCount = 0;
    bus.once("u", () => {
      onceCount++;
    });
    bus.emit("u", 1);
    bus.emit("u", 2);
    expect(onceCount).toBe(1);
  });

  it("awaits async handlers via emitAsync", async () => {
    const bus = new EventBus();
    let done = false;
    bus.on("slow", async () => {
      await new Promise((r) => setTimeout(r, 5));
      done = true;
    });
    await bus.emitAsync("slow", {});
    expect(done).toBe(true);
  });

  it("tracks stats", () => {
    const bus = new EventBus({ name: "stats" });
    bus.on("a", () => {});
    bus.on("a", () => {});
    bus.on("b", () => {});
    bus.emit("a", 1);
    const stats = bus.stats();
    expect(stats.name).toBe("stats");
    expect(stats.topics).toBe(2);
    expect(stats.handlers).toBe(3);
    expect(stats.emitted).toBe(1);
    expect(stats.redisConnected).toBe(false);
  });
});

describe("Workspace v2 — graceful shutdown cascade", () => {
  it("stops sub-apps before the root server", async () => {
    const order: string[] = [];
    const ws = new Workspace({ verbose: false } as never);

    ws.app("api", { development: false, silent: true } as never, (app) => {
      // Simulate a lifecycle manager attached via lifecycle() plugin
      app.setState("lifecycleManager", {
        shutdown: async () => {
          order.push("shutdown:api");
        },
      } as never);
      app.get("/", () => "api");
    });
    ws.appWith({
      name: "web",
      config: { development: false, silent: true } as never,
      prefix: "/web",
      setup: (app) => {
        app.setState("lifecycleManager", {
          shutdown: async () => {
            order.push("shutdown:web");
          },
        } as never);
        app.get("/", () => "web");
      },
    });

    const server = ws.listen(0) as any;
    // Intercept root server.stop() to record cascade order
    const origStop = server.stop.bind(server);
    server.stop = () => {
      order.push("root:stopped");
      origStop();
    };

    await ws.stop();

    // Sub-apps shut down first, root server last
    expect(order.indexOf("shutdown:api")).toBeLessThan(order.indexOf("root:stopped"));
    expect(order.indexOf("shutdown:web")).toBeLessThan(order.indexOf("root:stopped"));
  });

  it("createWorkspace factory returns a Workspace", () => {
    const ws = createWorkspace({ verbose: false });
    expect(ws).toBeInstanceOf(Workspace);
    started.push(ws);
  });
});
