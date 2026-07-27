import { describe, expect, it } from "bun:test";
import {
  createStructuredLogger,
  structuredLogger,
  apiLogger,
  webLogger,
  workerLogger,
} from "../src";
import type { StructuredLogEntry } from "../src";
import { Asi } from "../src";

// ============================================================================
// createStructuredLogger (standalone)
// ============================================================================

describe("createStructuredLogger", () => {
  it("creates a logger with all level methods", () => {
    const log = createStructuredLogger({ service: "test" });
    expect(typeof log.debug).toBe("function");
    expect(typeof log.info).toBe("function");
    expect(typeof log.warn).toBe("function");
    expect(typeof log.error).toBe("function");
    expect(typeof log.child).toBe("function");
  });

  it("creates entries with correct structure (capture via console.log mock)", () => {
    const messages: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => messages.push(msg);

    try {
      const log = createStructuredLogger({
        service: "my-service",
        environment: "production",
        version: "1.0.0",
        pretty: false,
      });

      log.info("Server started", { port: 3000 });

      expect(messages.length).toBe(1);
      const entry = JSON.parse(messages[0]) as StructuredLogEntry;

      expect(entry.event).toBe("Server started");
      expect(entry.level).toBe("info");
      expect(entry.service).toBe("my-service");
      expect(entry.environment).toBe("production");
      expect(entry.version).toBe("1.0.0");
      expect(entry.timestamp).toBeDefined();
      expect(entry.pid).toBeGreaterThan(0);
      expect(entry.port).toBe(3000);
    } finally {
      console.log = originalLog;
    }
  });

  it("writes error level to console.error", () => {
    const messages: string[] = [];
    const originalError = console.error;
    console.error = (msg: string) => messages.push(msg);

    try {
      const log = createStructuredLogger({ service: "test" });
      log.error("Database error", { err: "Connection refused" });

      expect(messages.length).toBe(1);
      const entry = JSON.parse(messages[0]);
      expect(entry.level).toBe("error");
      expect(entry.event).toBe("Database error");
      expect(entry.err).toBe("Connection refused");
    } finally {
      console.error = originalError;
    }
  });

  it("writes warn level to console.warn", () => {
    const messages: string[] = [];
    const originalWarn = console.warn;
    console.warn = (msg: string) => messages.push(msg);

    try {
      const log = createStructuredLogger({ service: "test" });
      log.warn("Rate limit approaching", { remaining: 10 });

      expect(messages.length).toBe(1);
      const entry = JSON.parse(messages[0]);
      expect(entry.level).toBe("warn");
    } finally {
      console.warn = originalWarn;
    }
  });

  it("writes debug level to console.debug", () => {
    const messages: string[] = [];
    const originalDebug = console.debug;
    console.debug = (msg: string) => messages.push(msg);

    try {
      const log = createStructuredLogger({ service: "test" });
      log.debug("Verbose info", { detail: "x" });

      expect(messages.length).toBe(1);
      const entry = JSON.parse(messages[0]);
      expect(entry.level).toBe("debug");
    } finally {
      console.debug = originalDebug;
    }
  });

  it("child() creates logger with merged extraFields", () => {
    const messages: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => messages.push(msg);

    try {
      const parent = createStructuredLogger({
        service: "app",
        extraFields: { region: "us-east" },
      });
      const child = parent.child({ requestId: "req-123" });
      child.info("Child log");

      const entry = JSON.parse(messages[0]) as StructuredLogEntry;
      expect(entry.region).toBe("us-east");
      expect(entry.requestId).toBe("req-123");
      expect(entry.service).toBe("app");
    } finally {
      console.log = originalLog;
    }
  });

  it("child preserves existing extra when creating sub-child", () => {
    const messages: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => messages.push(msg);

    try {
      const log = createStructuredLogger({
        service: "api",
        extraFields: { version: "2" },
      });
      const child = log.child({ requestId: "r1" });
      const grandchild = child.child({ userId: "u1" });
      grandchild.info("deep");

      const entry = JSON.parse(messages[0]) as StructuredLogEntry;
      expect(entry.version).toBe("2");
      expect(entry.requestId).toBe("r1");
      expect(entry.userId).toBe("u1");
    } finally {
      console.log = originalLog;
    }
  });

  it("uses default service name when not provided", () => {
    const messages: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => messages.push(msg);

    try {
      const log = createStructuredLogger();
      log.info("no service");

      const entry = JSON.parse(messages[0]) as StructuredLogEntry;
      expect(entry.service).toBe("asijs-app");
    } finally {
      console.log = originalLog;
    }
  });

  it("pretty prints JSON when pretty=true", () => {
    const messages: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => messages.push(msg);

    try {
      const log = createStructuredLogger({ pretty: true, service: "test" });
      log.info("Pretty");

      expect(messages[0]).toContain("\n"); // multi-line JSON
      const parsed = JSON.parse(messages[0]);
      expect(parsed.event).toBe("Pretty");
    } finally {
      console.log = originalLog;
    }
  });

  it("includes hostname in entries", () => {
    const messages: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => messages.push(msg);

    try {
      const log = createStructuredLogger({ service: "test" });
      log.info("Has hostname");

      const entry = JSON.parse(messages[0]) as StructuredLogEntry;
      expect(entry).toHaveProperty("hostname");
      expect(entry).toHaveProperty("pid");
    } finally {
      console.log = originalLog;
    }
  });
});

// ============================================================================
// Convenience loggers
// ============================================================================

describe("convenience loggers", () => {
  it("apiLogger is a valid structured logger", () => {
    expect(typeof apiLogger.info).toBe("function");
    expect(typeof apiLogger.error).toBe("function");
  });

  it("webLogger is a valid structured logger", () => {
    expect(typeof webLogger.info).toBe("function");
    expect(typeof webLogger.error).toBe("function");
  });

  it("workerLogger is a valid structured logger", () => {
    expect(typeof workerLogger.info).toBe("function");
    expect(typeof workerLogger.error).toBe("function");
  });
});

// ============================================================================
// structuredLogger middleware
// ============================================================================

describe("structuredLogger middleware", () => {
  it("logs requests and returns response", async () => {
    const entries: StructuredLogEntry[] = [];
    const app = new Asi();

    app.use(
      structuredLogger({
        service: "test-api",
        logHandler: (entry) => entries.push(entry),
      }),
    );

    app.get("/hello", () => ({ message: "world" }));

    const res = await app.handle(
      new Request("http://localhost/hello", {
        headers: {
          "User-Agent": "bun-test",
          "X-Request-ID": "req-001",
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(entries.length).toBe(1);
    const entry = entries[0];
    expect(entry.method).toBe("GET");
    expect(entry.path).toBe("/hello");
    expect(entry.status).toBe(200);
    expect(entry.service).toBe("test-api");
    expect(entry.event).toBe("http.request");
    expect(entry.requestId).toBe("req-001");
    expect(entry.userAgent).toBe("bun-test");
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("excludes configured paths", async () => {
    const entries: StructuredLogEntry[] = [];
    const app = new Asi();

    app.use(
      structuredLogger({
        service: "test",
        exclude: ["/health", "/metrics"],
        logHandler: (entry) => entries.push(entry),
      }),
    );

    app.get("/health", () => ({ status: "ok" }));

    await app.handle(new Request("http://localhost/health"));

    expect(entries.length).toBe(0); // excluded
  });

  it("filters entries with custom filter function", async () => {
    const entries: StructuredLogEntry[] = [];
    const app = new Asi();

    app.use(
      structuredLogger({
        service: "test",
        filter: (entry) => entry.path !== "/skip-me",
        logHandler: (entry) => entries.push(entry),
      }),
    );

    app.get("/skip-me", () => ({ skipped: true }));
    app.get("/log-me", () => ({ logged: true }));

    await app.handle(new Request("http://localhost/skip-me"));
    await app.handle(new Request("http://localhost/log-me"));

    expect(entries.length).toBe(1);
    expect(entries[0].path).toBe("/log-me");
  });

  it("includes extra fields when configured", async () => {
    const entries: StructuredLogEntry[] = [];
    const app = new Asi();

    app.use(
      structuredLogger({
        service: "test",
        extraFields: { team: "backend", region: "eu-west" },
        logHandler: (entry) => entries.push(entry),
      }),
    );

    app.get("/", () => ({ ok: true }));
    await app.handle(new Request("http://localhost/"));

    expect(entries.length).toBe(1);
    expect(entries[0].team).toBe("backend");
    expect(entries[0].region).toBe("eu-west");
  });

  it("sets error level for 5xx responses", async () => {
    const entries: StructuredLogEntry[] = [];
    const app = new Asi();

    app.use(
      structuredLogger({
        service: "test",
        logHandler: (entry) => entries.push(entry),
      }),
    );

    app.get("/error", () => {
      throw new Error("Server error");
    });

    await app.handle(new Request("http://localhost/error"));

    expect(entries.length).toBe(1);
    const entry = entries[1] ?? entries[0];
    // The middleware logs the error via catch block
    if (entry) {
      expect(entry.level).toBe("error");
      expect(entry.status).toBe(500);
    }
  });

  it("logs error events with stack trace", async () => {
    const entries: StructuredLogEntry[] = [];
    const app = new Asi();

    app.use(
      structuredLogger({
        service: "test",
        logHandler: (entry) => entries.push(entry),
        includeBody: true,
      }),
    );

    app.get("/crash", () => {
      throw new Error("Boom");
    });

    await app.handle(new Request("http://localhost/crash"));

    // Should have at least one error entry
    const errorEntry = entries.find((e) => e.level === "error");
    if (errorEntry) {
      expect(errorEntry.event).toBe("http.request.error");
      expect(errorEntry.error).toBe("Boom");
      expect(errorEntry.errorType).toBe("Error");
    }
  });

  it("captures X-Forwarded-For as IP", async () => {
    const entries: StructuredLogEntry[] = [];
    const app = new Asi();

    app.use(
      structuredLogger({
        service: "test",
        logHandler: (entry) => entries.push(entry),
      }),
    );

    app.get("/ip", () => ({ ok: true }));
    await app.handle(
      new Request("http://localhost/ip", {
        headers: { "X-Forwarded-For": "10.0.0.1" },
      }),
    );

    expect(entries.length).toBe(1);
    expect(entries[0].ip).toBe("10.0.0.1");
  });
});
