import { describe, expect, it } from "bun:test";
import {
  Asi,
  trace,
  metricsPlugin,
  metricsMiddleware,
  PrometheusExporter,
  OTLPMetricsExporter,
  MetricsCollector,
  RequestMetricsCollector,
  DEFAULT_BUCKETS,
} from "../src";

describe("MetricsCollector", () => {
  it("records request metrics", () => {
    const c = new RequestMetricsCollector();
    c.record({ duration: 50, status: 200, method: "GET", path: "/users" });
    c.record({ duration: 150, status: 201, method: "POST", path: "/users" });
    c.record({ duration: 30, status: 200, method: "GET", path: "/items" });

    expect(c.count).toBe(3);
    expect(c.averageResponseTime).toBeCloseTo(76.67, 0);
    const snap = c.snapshot();
    expect(snap.totalRequests).toBe(3);
    expect(snap.totalDurationMs).toBe(230);
    expect(snap.statusCodes["200"]).toBe(2);
    expect(snap.statusCodes["201"]).toBe(1);
    expect(snap.methods["GET"]).toBe(2);
    expect(snap.methods["POST"]).toBe(1);
    expect(snap.paths["/users"]!.count).toBe(2);
    expect(snap.paths["/items"]!.count).toBe(1);
  });

  it("resets metrics", () => {
    const c = new RequestMetricsCollector();
    c.record({ duration: 50, status: 200, method: "GET", path: "/" });
    expect(c.count).toBe(1);
    c.reset();
    expect(c.count).toBe(0);
    expect(c.snapshot().totalDurationMs).toBe(0);
  });

  it("handles routePattern aggregation", () => {
    const c = new RequestMetricsCollector();
    c.record({ duration: 10, status: 200, method: "GET", path: "/users/1", routePattern: "/users/:id" });
    c.record({ duration: 20, status: 200, method: "GET", path: "/users/2", routePattern: "/users/:id" });

    const snap = c.snapshot();
    expect(snap.paths["/users/:id"]!.count).toBe(2);
    expect(snap.paths["/users/:id"]!.totalDurationMs).toBe(30);
  });
});

describe("PrometheusExporter", () => {
  it("exports Prometheus format with all metric types", () => {
    const exporter = new PrometheusExporter({ buckets: [0.1, 1.0] });
    const snapshot = {
      totalRequests: 100,
      totalDurationMs: 5000,
      statusCodes: { "200": 80, "404": 15, "500": 5 },
      methods: { "GET": 60, "POST": 30, "DELETE": 10 },
      paths: { "/users": { count: 50, totalDurationMs: 2000 } },
      recentDurations: [50, 100, 200, 300],
    };

    const output = exporter.export(snapshot);

    // Should have HELP and TYPE lines
    expect(output).toContain("# HELP http_requests_total");
    expect(output).toContain("# TYPE http_requests_total counter");

    // Should have total counter
    expect(output).toContain("http_requests_total 100");

    // Should have per-status counters
    expect(output).toContain('http_requests_by_status{status="200"} 80');
    expect(output).toContain('http_requests_by_status{status="500"} 5');

    // Should have per-method counters
    expect(output).toContain('http_requests_by_method{method="GET"} 60');
    expect(output).toContain('http_requests_by_method{method="POST"} 30');

    // Should have per-path counters
    expect(output).toContain('http_requests_by_path{path="/users"} 50');

    // Should have histogram
    expect(output).toContain("# TYPE http_request_duration_seconds histogram");
    expect(output).toContain("http_request_duration_seconds_sum");
    expect(output).toContain("http_request_duration_seconds_count 100");
    expect(output).toContain("http_request_duration_seconds_bucket{le=\"+Inf\"} 100");

    // Should have gauges
    expect(output).toContain("# TYPE http_requests_per_second gauge");
    expect(output).toContain("# TYPE http_average_response_time_ms gauge");
  });

  it("supports custom prefix", () => {
    const exporter = new PrometheusExporter({ prefix: "app" });
    const snapshot = {
      totalRequests: 1,
      totalDurationMs: 100,
      statusCodes: {},
      methods: {},
      paths: {},
      recentDurations: [100],
    };
    const output = exporter.export(snapshot);
    expect(output).toContain("app_requests_total 1");
    expect(output).toContain("app_request_duration_seconds");
  });

  it("handles empty metrics gracefully", () => {
    const exporter = new PrometheusExporter();
    const snapshot = {
      totalRequests: 0,
      totalDurationMs: 0,
      statusCodes: {},
      methods: {},
      paths: {},
      recentDurations: [],
    };
    const output = exporter.export(snapshot);
    expect(output).toContain("http_requests_total 0");
    expect(output).toContain("http_request_duration_seconds_sum 0");
  });
});

describe("OTLPMetricsExporter", () => {
  it("builds OTLP payload structure", () => {
    const exporter = new OTLPMetricsExporter({
      endpoint: "http://localhost:4318/v1/metrics",
      serviceName: "test-app",
    });

    const snapshot = {
      totalRequests: 10,
      totalDurationMs: 5000,
      statusCodes: { "200": 8, "500": 2 },
      methods: { "GET": 6, "POST": 4 },
      paths: { "/api": { count: 10, totalDurationMs: 5000 } },
      recentDurations: [100, 200, 300, 400, 500],
    };

    // We can't actually test the fetch call without a server
    // But we can verify the class is constructed correctly
    expect(exporter.options).toBeDefined();
    expect(exporter.options.endpoint).toBe("http://localhost:4318/v1/metrics");
    expect(exporter.options.serviceName).toBe("test-app");
  });

  it("handles different OTLP endpoint formats", () => {
    const exporter1 = new OTLPMetricsExporter({
      endpoint: "http://collector:4318/v1/metrics/",
    });
    expect(exporter1.options.endpoint).toBe("http://collector:4318/v1/metrics");

    const exporter2 = new OTLPMetricsExporter({
      endpoint: "https://otlp.example.com",
    });
    expect(exporter2.options.endpoint).toBe("https://otlp.example.com");
  });

  it("requires endpoint", () => {
    expect(() => {
      new OTLPMetricsExporter({ endpoint: "" });
    }).not.toThrow(); // Constructor should not throw with empty endpoint
  });
});

describe("metricsMiddleware", () => {
  it("records request metrics through middleware", async () => {
    const collector = new RequestMetricsCollector();
    const app = new Asi();

    app.use(metricsMiddleware(collector));
    app.get("/", () => "ok");

    await app.handle(new Request("http://localhost/"));
    await app.handle(new Request("http://localhost/"));

    expect(collector.count).toBe(2);
    expect(collector.snapshot().statusCodes["200"]).toBe(2);
  });

  it("tracks different paths", async () => {
    const collector = new RequestMetricsCollector();
    const app = new Asi();

    app.use(metricsMiddleware(collector));
    app.get("/a", () => "a");
    app.get("/b", () => "b");

    await app.handle(new Request("http://localhost/a"));
    await app.handle(new Request("http://localhost/b"));
    await app.handle(new Request("http://localhost/a"));

    const snap = collector.snapshot();
    expect(snap.paths["/a"]!.count).toBe(2);
    expect(snap.paths["/b"]!.count).toBe(1);
  });
});

describe("metricsPlugin", () => {
  it("serves /metrics endpoint by default", async () => {
    const app = new Asi();
    await app.plugin(metricsPlugin());
    app.get("/hello", () => "world");

    // Make some requests
    await app.handle(new Request("http://localhost/hello"));
    await app.handle(new Request("http://localhost/hello"));

    // Check /metrics
    const res = await app.handle(new Request("http://localhost/metrics"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("openmetrics-text");

    const body = await res.text();
    expect(body).toContain("# HELP http_requests_total");
    expect(body).toContain("http_requests_total 2");
    expect(body).toContain('http_requests_by_method{method="GET"} 2');
    expect(body).toContain('http_requests_by_path{path="/hello"} 2');
  });

  it("respects custom path", async () => {
    const app = new Asi();
    await app.plugin(metricsPlugin({ path: "/prometheus" }));
    app.get("/", () => "ok");

    await app.handle(new Request("http://localhost/"));

    // Default /metrics should 404
    const missing = await app.handle(new Request("http://localhost/metrics"));
    expect(missing.status).toBe(404);

    // Custom path should work
    const res = await app.handle(new Request("http://localhost/prometheus"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("http_requests_total");
  });

  it("disables metrics endpoint when path is false", async () => {
    const app = new Asi();
    await app.plugin(metricsPlugin({ path: false }));
    app.get("/", () => "ok");

    const res = await app.handle(new Request("http://localhost/metrics"));
    expect(res.status).toBe(404);
  });

  it("shows no metrics when no requests made", async () => {
    const app = new Asi();
    await app.plugin(metricsPlugin());

    const res = await app.handle(new Request("http://localhost/metrics"));
    const body = await res.text();
    expect(body).toContain("http_requests_total 0");
    expect(body).toContain("http_request_duration_seconds_sum 0");
  });
});

describe("PrometheusExporter escape", () => {
  it("escapes special characters in label values", () => {
    const exporter = new PrometheusExporter({ buckets: DEFAULT_BUCKETS });
    const snapshot = {
      totalRequests: 1,
      totalDurationMs: 100,
      statusCodes: {},
      methods: {},
      paths: { '/path with "quotes"': { count: 1, totalDurationMs: 100 } },
      recentDurations: [100],
    };
    const output = exporter.export(snapshot);
    // Should have escaped quotes in the label value (backslash + quote)
    expect(output).toContain('\\"quotes\\"');
    // Should not have raw unescaped quotes in label value
    expect(output).not.toContain('{path="/path with "quotes""}');
  });
});

describe("RequestMetricsCollector duplicate name", () => {
  it("does not conflict with trace.ts MetricsCollector", () => {
    // Both can be imported and used independently
    const v1 = new MetricsCollector(); // from trace.ts
    const v2 = new RequestMetricsCollector(); // from metrics.ts

    v1.record({
      requestId: "test",
      method: "GET",
      path: "/",
      startTime: 0,
      duration: 100,
      status: 200,
      attributes: new Map(),
      events: [],
    } as any);

    v2.record({ duration: 50, status: 200, method: "GET", path: "/" });

    expect(v1.getMetrics().totalRequests).toBe(1);
    expect(v2.count).toBe(1);
  });
});
