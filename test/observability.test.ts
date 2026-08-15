/**
 * Tests: Observability Suite
 *
 * - OTel Logs Bridge (OTLP conversion, severity mapping, buffering)
 * - Healthcheck dashboard (/__health HTML + JSON)
 * - Grafana dashboard export
 */

import { describe, expect, it, afterEach } from "bun:test";
import { Asi } from "../src/asi";
import {
  OTLPLogsExporter,
  entryToOTLPLogRecord,
  levelToSeverityNumber,
  levelToSeverityText,
  createGrafanaDashboard,
  healthDashboard,
  buildHealthSnapshot,
  renderHealthDashboardHTML,
  RedisTraceBridge,
  newTraceId,
  newSpanId,
} from "../src/index";

const started: Array<{ stop: () => void }> = [];
afterEach(() => {
  while (started.length > 0) started.pop()!.stop();
});

function request(path = "/", method = "GET"): Request {
  return new Request(`http://localhost${path}`, { method });
}

// ========================================================================
// OTel Logs Bridge
// ========================================================================

describe("OTel Logs Bridge", () => {
  it("maps log levels to OTel severity numbers", () => {
    expect(levelToSeverityNumber("debug")).toBe(5);
    expect(levelToSeverityNumber("info")).toBe(9);
    expect(levelToSeverityNumber("warn")).toBe(13);
    expect(levelToSeverityNumber("error")).toBe(17);
    expect(levelToSeverityText("error")).toBe("ERROR");
  });

  it("converts a structured entry to an OTLP log record with semantic conventions", () => {
    const record = entryToOTLPLogRecord(
      {
        timestamp: new Date().toISOString(),
        level: "error",
        service: "api",
        environment: "production",
        event: "DB connection failed",
        method: "GET",
        path: "/users",
        status: 500,
        durationMs: 123.4,
        requestId: "req-1",
        error: "ECONNREFUSED",
        errorType: "SystemError",
      },
      "api",
      "instance-1",
    );

    expect(record.severityNumber).toBe(17);
    expect(record.body.stringValue).toBe("DB connection failed");
    const attrs = Object.fromEntries(record.attributes.map((a) => [a.key, a.value.stringValue]));
    expect(attrs["service.name"]).toBe("api");
    expect(attrs["http.request.method"]).toBe("GET");
    expect(attrs["url.path"]).toBe("/users");
    expect(attrs["http.response.status_code"]).toBe("500");
    expect(attrs["http.request.duration.ms"]).toBe("123.4");
    expect(attrs["http.request.id"]).toBe("req-1");
    expect(attrs["error.message"]).toBe("ECONNREFUSED");
    expect(attrs["error.type"]).toBe("SystemError");
  });

  it("buffers records and flushes on demand", async () => {
    const exporter = new OTLPLogsExporter({
      endpoint: "http://localhost:1/v1/logs", // will fail — we just check flush returns a result
      serviceName: "test",
      bufferSize: 10,
    });
    exporter.record({ level: "info", service: "s", environment: "e", event: "x", timestamp: "t" } as any);
    exporter.record({ level: "warn", service: "s", environment: "e", event: "y", timestamp: "t" } as any);
    expect(exporter.buffered).toBe(2);

    const result = await exporter.flush();
    expect(result.exported).toBe(2);
    expect(result.success).toBe(false); // unreachable endpoint, but records were consumed
    expect(exporter.buffered).toBe(0);
    exporter.stop();
  });

  it("rejects invalid severity mapping gracefully", () => {
    expect(levelToSeverityNumber("bogus" as any)).toBe(9); // default INFO
  });
});

// ========================================================================
// Healthcheck Dashboard
// ========================================================================

describe("healthDashboard", () => {
  it("serves HTML at /__health", async () => {
    const app = new Asi({ development: false, silent: true });
    app.use(
      healthDashboard({
        checks: {
          db: async () => {},
          redis: () => ({ status: "healthy" as const }),
        },
      }),
    );
    app.get("/", () => "ok");
    const server = app.listen(0) as any;
    started.push(server);

    const res = await fetch(`http://localhost:${server.port}/__health`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("AsiJS");
    expect(html).toContain("db");
    expect(html).toContain("redis");
    expect(html).toContain("setInterval");
  });

  it("serves JSON snapshot at /__health.json with healthy status", async () => {
    const app = new Asi({ development: false, silent: true });
    app.use(
      healthDashboard({
        checks: { db: async () => {} },
      }),
    );
    const server = app.listen(0) as any;
    started.push(server);

    const res = await fetch(`http://localhost:${server.port}/__health.json`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("healthy");
    expect(body.checks.db.status).toBe("healthy");
    expect(body.pid).toBe(process.pid);
    expect(typeof body.memory.rss).toBe("number");
  });

  it("returns 503 when a check fails", async () => {
    const app = new Asi({ development: false, silent: true });
    app.use(
      healthDashboard({
        checks: {
          db: async () => {
            throw new Error("db down");
          },
        },
      }),
    );
    const server = app.listen(0) as any;
    started.push(server);

    const res = await fetch(`http://localhost:${server.port}/__health`);
    expect(res.status).toBe(503);
    const json = await fetch(`http://localhost:${server.port}/__health.json`).then((r) => r.json());
    expect(json.status).toBe("unhealthy");
    expect(json.checks.db.status).toBe("unhealthy");
    expect(json.checks.db.message).toBe("db down");
  });

  it("reports OPEN circuit breakers as degraded", async () => {
    const { CircuitBreaker, getCircuitBreakerRegistry, resetCircuitBreakerRegistry } = await import("../src/index");
    resetCircuitBreakerRegistry();
    const breaker = new CircuitBreaker("external-api", { threshold: 1, recoveryTimeout: 60_000 });
    getCircuitBreakerRegistry().register("external-api", breaker);
    // Force OPEN by exceeding the threshold
    for (let i = 0; i < 2; i++) {
      await breaker.call(() => {
        throw new Error("fail");
      }).catch(() => {});
    }

    const snapshot = await buildHealthSnapshot({ checks: {} });
    expect(snapshot.circuitBreakers.some((c) => c.name === "external-api" && c.state === "OPEN")).toBe(true);
    expect(snapshot.status).toBe("degraded");
    resetCircuitBreakerRegistry();
  });

  it("renderHealthDashboardHTML includes structure and breaker section", async () => {
    const snapshot = await buildHealthSnapshot({ checks: {} });
    const html = renderHealthDashboardHTML(snapshot, 5);
    expect(html).toContain("Circuit Breakers");
    expect(html).toContain("Custom checks");
    expect(html).toContain("setInterval(refresh, 5000)");
    // When breakers are registered a table is rendered
    expect(html.includes("<table>") || html.includes("No circuit breakers registered")).toBe(true);
  });
});

// ========================================================================
// Grafana Dashboard
// ========================================================================

describe("Grafana dashboard export", () => {
  it("generates a valid Grafana dashboard JSON", () => {
    const dashboard = createGrafanaDashboard();
    expect(dashboard.title).toBe("AsiJS Metrics");
    expect(dashboard.uid).toBe("asijs-metrics");
    expect(dashboard.refresh).toBe("30s");
    expect(Array.isArray(dashboard.panels)).toBe(true);
    expect((dashboard.panels as any[]).length).toBeGreaterThanOrEqual(6);
    expect(dashboard.tags).toContain("asijs");
  });

  it("uses the configured prefix in PromQL expressions", () => {
    const dashboard = createGrafanaDashboard({ prefix: "app" });
    const panels = dashboard.panels as Array<{ targets: Array<{ expr: string }> }>;
    expect(panels[0].targets[0].expr).toContain("app_requests_total");
  });

  it("includes latency quantile panels", () => {
    const dashboard = createGrafanaDashboard();
    const panels = dashboard.panels as Array<{ targets: Array<{ expr: string }> }>;
    const latency = panels.find((p) => (p.targets ?? []).some((t) => t.expr.includes("histogram_quantile")));
    expect(latency).toBeDefined();
  });
});

// ========================================================================
// Redis Trace Bridge (unit — no real Redis)
// ========================================================================

describe("RedisTraceBridge", () => {
  it("generates W3C-compatible IDs", () => {
    expect(newTraceId()).toMatch(/^[0-9a-f]{32}$/);
    expect(newSpanId()).toMatch(/^[0-9a-f]{16}$/);
  });

  it("constructs without connecting", () => {
    const bridge = new RedisTraceBridge({ url: "redis://localhost:6379" }, {} as any);
    expect(bridge.isConnected()).toBe(false);
    expect(bridge.channel).toBe("asijs:trace:span");
  });

  it("propagates an incoming trace context or creates a fresh one", () => {
    const bridge = new RedisTraceBridge({ url: "redis://localhost:6379" }, {} as any);
    const incoming = { traceId: newTraceId(), spanId: newSpanId(), sampled: true };
    const propagated = bridge.propagateTraceContext(incoming);
    expect(propagated).toBe(incoming);

    const fresh = bridge.propagateTraceContext(null);
    expect(fresh.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(fresh.sampled).toBe(true);
  });
});
