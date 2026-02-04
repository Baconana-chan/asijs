import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Asi } from "../src/asi";
import {
  // Lifecycle
  lifecycle,
  healthCheck,
  LifecycleManager,
  // Security
  security,
  securityHeaders,
  strictSecurity,
  apiSecurity,
  generateNonce,
  // Cache
  cache,
  etag,
  generateETag,
  parseTTL,
  buildCacheControl,
  MemoryCache,
  // Trace
  trace,
  traceMiddleware,
  MetricsCollector,
  Timing,
  generateRequestId,
  generateTraceId,
  generateSpanId,
  parseCron,
  matchesCron,
  getNextRun,
  // Scheduler
  Scheduler,
  schedules,
  interval,
  cron,
  // Dev
  devMode,
  debugLog,
  delay,
} from "../src";

describe("Phase 6 Features", () => {
  describe("Lifecycle Manager", () => {
    it("should create lifecycle manager", () => {
      const manager = new LifecycleManager({ handleSignals: false });
      expect(manager).toBeDefined();
      expect(manager.shuttingDown).toBe(false);
    });

    it("should register shutdown handlers", async () => {
      const manager = new LifecycleManager({
        handleSignals: false,
        verbose: false,
      });
      let called = false;

      manager.onShutdown(async () => {
        called = true;
      });

      await manager.shutdown();
      expect(called).toBe(true);
    });

    it("should integrate as plugin", async () => {
      const app = new Asi();
      app.plugin(lifecycle({ handleSignals: false, verbose: false }));

      expect(app.state("lifecycleManager")).toBeDefined();
    });

    it("should add health check endpoints", async () => {
      const app = new Asi();
      app.plugin(healthCheck());

      const healthRes = await app.handle(
        new Request("http://localhost/health"),
      );
      expect(healthRes.status).toBe(200);
      const body = await healthRes.json();
      expect(body.status).toBe("healthy");

      const liveRes = await app.handle(new Request("http://localhost/live"));
      expect(liveRes.status).toBe(200);
      const liveBody = await liveRes.json();
      expect(liveBody.alive).toBe(true);
    });
  });

  describe("Security Headers", () => {
    it("should add default security headers", async () => {
      const app = new Asi();
      app.plugin(security());
      app.get("/", () => "ok");

      const res = await app.handle(new Request("http://localhost/"));

      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
      expect(res.headers.get("X-XSS-Protection")).toBe("0");
      expect(res.headers.get("Referrer-Policy")).toBe(
        "strict-origin-when-cross-origin",
      );
    });

    it("should use strict security preset", async () => {
      const app = new Asi();
      app.plugin(security(strictSecurity));
      app.get("/", () => "ok");

      const res = await app.handle(new Request("http://localhost/"));

      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
      expect(res.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    });

    it("should use API security preset", async () => {
      const app = new Asi();
      app.plugin(security(apiSecurity));
      app.get("/", () => ({ data: "test" }));

      const res = await app.handle(new Request("http://localhost/"));

      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
      // API preset doesn't set CSP
      expect(res.headers.get("Content-Security-Policy")).toBeNull();
    });

    it("should generate cryptographic nonce", () => {
      const nonce1 = generateNonce();
      const nonce2 = generateNonce();

      expect(nonce1).toBeDefined();
      expect(nonce1.length).toBeGreaterThan(10);
      expect(nonce1).not.toBe(nonce2);
    });
  });

  describe("Response Caching", () => {
    it("should parse TTL values", () => {
      expect(parseTTL(60)).toBe(60);
      expect(parseTTL("30s")).toBe(30);
      expect(parseTTL("5m")).toBe(300);
      expect(parseTTL("2h")).toBe(7200);
      expect(parseTTL("1d")).toBe(86400);
    });

    it("should build Cache-Control header", () => {
      expect(buildCacheControl({ ttl: "1h" })).toBe("public, max-age=3600");
      expect(buildCacheControl({ ttl: "5m", private: true })).toBe(
        "private, max-age=300",
      );
      expect(buildCacheControl({ noStore: true })).toBe("no-store");
      expect(buildCacheControl({ ttl: "1h", immutable: true })).toBe(
        "public, max-age=3600, immutable",
      );
    });

    it("should generate ETag", async () => {
      const etag1 = await generateETag("hello world");
      const etag2 = await generateETag("hello world");
      const etag3 = await generateETag("different");

      expect(etag1).toBe(etag2);
      expect(etag1).not.toBe(etag3);
      expect(etag1).toMatch(/^"[a-f0-9]+"/);
    });

    it("should handle MemoryCache", () => {
      const cache = new MemoryCache();

      cache.set("key1", "value1", "1h");
      expect(cache.get("key1")).toBe("value1");
      expect(cache.has("key1")).toBe(true);
      expect(cache.size).toBe(1);

      cache.delete("key1");
      expect(cache.has("key1")).toBe(false);

      cache.destroy();
    });

    it("should add ETag via middleware", async () => {
      const app = new Asi();
      app.use(etag());
      app.get("/", () => ({ data: "test" }));

      const res = await app.handle(new Request("http://localhost/"));
      expect(res.headers.get("ETag")).toBeDefined();
    });

    it("should return 304 for matching ETag", async () => {
      const app = new Asi();
      app.use(etag());
      app.get("/", () => ({ data: "test" }));

      // First request to get ETag
      const res1 = await app.handle(new Request("http://localhost/"));
      const etagValue = res1.headers.get("ETag")!;

      // Second request with If-None-Match
      const res2 = await app.handle(
        new Request("http://localhost/", {
          headers: { "If-None-Match": etagValue },
        }),
      );

      expect(res2.status).toBe(304);
    });

    it("should add cache headers via afterHandle", async () => {
      const app = new Asi();
      app.get("/cached", () => ({ data: "test" }), {
        afterHandle: cache({ ttl: "1h", private: false }),
      });

      const res = await app.handle(new Request("http://localhost/cached"));
      expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
    });
  });

  describe("Tracing / Observability", () => {
    it("should generate request ID", () => {
      const id1 = generateRequestId();
      const id2 = generateRequestId();

      expect(id1).toBeDefined();
      expect(id1).not.toBe(id2);
    });

    it("should generate trace and span IDs", () => {
      const traceId = generateTraceId();
      const spanId = generateSpanId();

      expect(traceId.length).toBe(32);
      expect(spanId.length).toBe(16);
    });

    it("should track timing", () => {
      const timing = new Timing();

      timing.start("db");
      // Simulate work
      let sum = 0;
      for (let i = 0; i < 1000; i++) sum += i;
      timing.end("db");

      const header = timing.toServerTimingHeader();
      expect(header).toContain("db;dur=");
    });

    it("should collect metrics", () => {
      const collector = new MetricsCollector();

      collector.record({
        requestId: "1",
        method: "GET",
        path: "/users",
        startTime: 0,
        duration: 50,
        status: 200,
        attributes: new Map(),
        events: [],
      });

      collector.record({
        requestId: "2",
        method: "POST",
        path: "/users",
        startTime: 0,
        duration: 100,
        status: 201,
        attributes: new Map(),
        events: [],
      });

      const metrics = collector.getMetrics();
      expect(metrics.totalRequests).toBe(2);
      expect(metrics.totalDuration).toBe(150);
      expect(collector.getAverageResponseTime()).toBe(75);
    });

    it("should add request ID header via trace middleware", async () => {
      const app = new Asi();
      app.plugin(trace({ logRequests: false }));
      app.get("/", () => "ok");

      const res = await app.handle(new Request("http://localhost/"));
      expect(res.headers.get("X-Request-ID")).toBeDefined();
      expect(res.headers.get("X-Response-Time")).toBeDefined();
    });
  });

  describe("Scheduler / Cron", () => {
    it("should parse cron expressions", () => {
      const daily = parseCron("0 0 * * *");
      expect(daily.minute.values).toEqual([0]);
      expect(daily.hour.values).toEqual([0]);
      expect(daily.dayOfMonth.values.length).toBe(31);

      const hourly = parseCron("0 * * * *");
      expect(hourly.minute.values).toEqual([0]);
      expect(hourly.hour.values.length).toBe(24);
    });

    it("should parse cron shortcuts", () => {
      const daily = parseCron("@daily");
      expect(daily.minute.values).toEqual([0]);
      expect(daily.hour.values).toEqual([0]);

      const hourly = parseCron("@hourly");
      expect(hourly.minute.values).toEqual([0]);
    });

    it("should match cron expressions", () => {
      const every5min = parseCron("*/5 * * * *");

      const date1 = new Date("2026-02-03T10:00:00");
      const date2 = new Date("2026-02-03T10:05:00");
      const date3 = new Date("2026-02-03T10:03:00");

      expect(matchesCron(date1, every5min)).toBe(true);
      expect(matchesCron(date2, every5min)).toBe(true);
      expect(matchesCron(date3, every5min)).toBe(false);
    });

    it("should calculate next run time", () => {
      const everyHour = parseCron("0 * * * *");
      const from = new Date("2026-02-03T10:30:00");

      const next = getNextRun(everyHour, from);
      expect(next.getHours()).toBe(11);
      expect(next.getMinutes()).toBe(0);
    });

    it("should create scheduler", () => {
      const sched = new Scheduler({ verbose: false });

      sched.addJob({
        name: "test",
        schedule: 1000, // every second
        handler: () => {},
      });

      expect(sched.listJobs()).toHaveLength(1);
      sched.stop();
    });

    it("should have common schedules", () => {
      expect(schedules.everyMinute).toBe("* * * * *");
      expect(schedules.hourly).toBe("0 * * * *");
      expect(schedules.daily).toBe("0 0 * * *");
    });

    it("should create jobs with helpers", () => {
      const intervalJob = interval("test1", 5000, () => {});
      expect(intervalJob.name).toBe("test1");
      expect(intervalJob.schedule).toBe(5000);

      const cronJob = cron("test2", "0 * * * *", () => {});
      expect(cronJob.name).toBe("test2");
      expect(cronJob.schedule).toBe("0 * * * *");
    });
  });

  describe("Dev Mode", () => {
    it("should enable dev dashboard", async () => {
      const app = new Asi();
      app.plugin(devMode({ banner: false }));
      app.get("/api", () => ({ data: "test" }));

      // Access dashboard
      const res = await app.handle(new Request("http://localhost/__dev"));
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/html");
    });

    it("should provide routes API", async () => {
      const app = new Asi();
      app.plugin(devMode({ banner: false }));
      app.get("/users", () => []);
      app.post("/users", () => ({}));

      const res = await app.handle(
        new Request("http://localhost/__dev/routes"),
      );
      expect(res.status).toBe(200);
      const routes = await res.json();
      expect(Array.isArray(routes)).toBe(true);
    });

    it("should delay responses with delay middleware", async () => {
      const app = new Asi();
      app.use(delay(50));
      app.get("/", () => "ok");

      const start = Date.now();
      await app.handle(new Request("http://localhost/"));
      const duration = Date.now() - start;

      expect(duration).toBeGreaterThanOrEqual(40);
    });
  });

  describe("Auto Port", () => {
    it("should find next available port when current is in use", async () => {
      const app1 = new Asi({
        development: true,
        silent: true,
        startupBanner: false,
      });
      app1.get("/", () => "app1");

      const app2 = new Asi({
        development: true,
        silent: true,
        startupBanner: false,
      });
      app2.get("/", () => "app2");

      // Start first server on port 4000
      const server1 = app1.listen(4000);
      expect(server1.port).toBe(4000);

      // Start second server - should auto-find port 4001
      const server2 = app2.listen(4000);
      expect(server2.port).toBe(4001);

      // Cleanup
      server1.stop();
      server2.stop();
    });

    it("should throw error when autoPort is disabled", () => {
      const app1 = new Asi({
        autoPort: false,
        silent: true,
        startupBanner: false,
      });
      app1.get("/", () => "app1");

      const app2 = new Asi({
        autoPort: false,
        silent: true,
        startupBanner: false,
      });
      app2.get("/", () => "app2");

      const server1 = app1.listen(4100);

      expect(() => app2.listen(4100)).toThrow();

      server1.stop();
    });

    it("should support PORT=0 for random port", () => {
      const app = new Asi({ silent: true, startupBanner: false });
      app.get("/", () => "ok");

      const server = app.listen(0);
      expect(server.port).toBeGreaterThan(0);
      expect(server.port).not.toBe(0);

      server.stop();
    });

    it("should read PORT from environment", () => {
      const originalPort = process.env.PORT;
      process.env.PORT = "4200";

      const app = new Asi({ silent: true, startupBanner: false });
      app.get("/", () => "ok");

      const server = app.listen();
      expect(server.port).toBe(4200);

      server.stop();

      // Restore
      if (originalPort) {
        process.env.PORT = originalPort;
      } else {
        delete process.env.PORT;
      }
    });
  });

  describe("Environment Detection", () => {
    it("should detect development mode by default", () => {
      const app = new Asi({ silent: true });
      // @ts-ignore - accessing private config for test
      expect(app["config"].development).toBe(true);
    });
  });

  describe("Enhanced Error Messages", () => {
    it("should suggest similar routes in 404", async () => {
      const app = new Asi({ development: true });
      app.get("/users", () => []);
      app.get("/users/:id", () => ({}));
      app.post("/users", () => ({}));

      // Request wrong path
      const res = await app.handle(new Request("http://localhost/user"));
      expect(res.status).toBe(404);

      const body = await res.json();
      expect(body.error).toBe("Not Found");
      expect(body.suggestions).toBeDefined();
      expect(body.suggestions.length).toBeGreaterThan(0);
    });

    it("should include expected/received in validation errors", async () => {
      const { Type, validate } = await import("../src");

      // Test the validation module directly
      const schema = Type.Object({
        name: Type.String(),
        age: Type.Number(),
      });

      const result = validate(schema, { name: 123, age: "hello" });

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
      expect(result.errors![0].expected).toBeDefined();
      expect(result.errors![0].received).toBeDefined();
    });
  });
});
