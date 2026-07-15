import { describe, expect, it } from "bun:test";
import {
  Asi,
  MetricsCollector,
  Timing,
  parseTraceparent,
  trace,
} from "../src";

describe("trace.ts", () => {
  it("parseTraceparent() parses W3C trace context", () => {
    const context = parseTraceparent(
      "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    );

    expect(context).toEqual({
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      sampled: true,
    });
  });

  it("Timing produces Server-Timing formatted metrics", () => {
    const timing = new Timing();
    timing.start("db", "Database query");
    timing.end("db");

    expect(timing.toServerTimingHeader()).toContain(
      'db;dur=',
    );
    expect(timing.toServerTimingHeader()).toContain('desc="Database query"');
  });

  it("MetricsCollector aggregates totals and averages", () => {
    const collector = new MetricsCollector();

    collector.record({
      requestId: "r1",
      method: "GET",
      path: "/users",
      routePattern: "/users",
      startTime: 0,
      duration: 50,
      status: 200,
      attributes: new Map(),
      events: [],
    });
    collector.record({
      requestId: "r2",
      method: "POST",
      path: "/users",
      routePattern: "/users",
      startTime: 0,
      duration: 150,
      status: 201,
      attributes: new Map(),
      events: [],
    });

    expect(collector.getMetrics().totalRequests).toBe(2);
    expect(collector.getAverageResponseTime()).toBe(100);
    expect(collector.toPrometheusFormat()).toContain("http_requests_total 2");
  });

  it("trace() propagates trace context and adds response headers", async () => {
    const app = new Asi();
    let seenTraceId: string | undefined;
    let seenParentSpanId: string | undefined;

    await app.plugin(
      trace({
        onRequest(info) {
          seenTraceId = info.attributes.get("trace.id") as string | undefined;
          seenParentSpanId = info.attributes.get(
            "trace.parent_span_id",
          ) as string | undefined;
        },
      }),
    );
    app.get("/", () => "ok");

    const response = await app.handle(
      new Request("http://localhost/", {
        headers: {
          traceparent:
            "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        },
      }),
    );

    expect(response.headers.get("X-Request-ID")).toBeString();
    expect(response.headers.get("X-Response-Time")).toContain("ms");
    expect(seenTraceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(seenParentSpanId).toBe("00f067aa0ba902b7");
  });
});
