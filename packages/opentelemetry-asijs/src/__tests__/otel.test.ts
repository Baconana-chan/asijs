/**
 * Tests for @asijs/opentelemetry package
 *
 * These tests verify:
 * - TracerManager configuration and lifecycle
 * - Instrumentation middleware
 * - Metrics recording
 * - Logs emission
 * - Plugin integration
 *
 * Since actual OTel SDK packages may not be installed in CI,
 * tests gracefully handle missing dependencies.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";

// ========================================================================
// Tracer Manager
// ========================================================================

describe("tracerManager", () => {
  test("has expected API shape", async () => {
    const { tracerManager } = await import("../tracer");

    expect(tracerManager.isInitialized).toBe(false);
    expect(tracerManager.isShutdown).toBe(false);
    expect(typeof tracerManager.configure).toBe("function");
    expect(typeof tracerManager.shutdown).toBe("function");
    expect(typeof tracerManager.getTracer).toBe("function");
    expect(typeof tracerManager.startSpan).toBe("function");
    expect(typeof tracerManager.withSpan).toBe("function");
  });

  test("configure works with minimal config", async () => {
    const { tracerManager } = await import("../tracer");

    // Configure without OTel deps — should log warning but not throw
    await tracerManager.configure({
      serviceName: "test-service",
      exporters: ["console"],
    });

    // May or may not be initialized depending on whether OTel API is installed
    // The test just verifies no crash
    await tracerManager.shutdown();
  });

  test("getConfig returns config", async () => {
    const { tracerManager } = await import("../tracer");
    const config = tracerManager.getConfig();
    expect(config).toBeDefined();
  });

  test("withSpan works without OTel", async () => {
    const { tracerManager } = await import("../tracer");

    const result = await tracerManager.withSpan(
      "test-span",
      async () => "hello",
    );

    expect(result).toBe("hello");
  });

  test("withSpan propagates errors", async () => {
    const { tracerManager } = await import("../tracer");

    try {
      await tracerManager.withSpan("test-span", async () => {
        throw new Error("test error");
      });
      // Should not reach here
      expect(true).toBe(false);
    } catch (error: any) {
      expect(error.message).toBe("test error");
    }
  });
});

// ========================================================================
// Instrumentation
// ========================================================================

describe("instrumentation", () => {
  test("otelInstrumentationMiddleware returns a function", async () => {
    const { otelInstrumentationMiddleware } = await import("../instrument");

    const mw = otelInstrumentationMiddleware();
    expect(typeof mw).toBe("function");
    expect(mw.length).toBe(2); // (ctx, next)
  });

  test("instrumentHandler wraps a handler", async () => {
    const { instrumentHandler } = await import("../instrument");

    const wrapped = instrumentHandler(
      (ctx: any) => "result",
      "test-handler",
    );

    const result = await wrapped({} as any);
    expect(result).toBe("result");
  });

  test("instrumentQuery passes through without OTel", async () => {
    const { instrumentQuery } = await import("../instrument");

    const result = await instrumentQuery(
      "SELECT 1",
      Promise.resolve([{ id: 1 }]),
    );

    expect(result).toEqual([{ id: 1 }]);
  });

  test("instrumentQuery handles errors", async () => {
    const { instrumentQuery } = await import("../instrument");

    try {
      await instrumentQuery("SELECT bad", Promise.reject(new Error("DB error")));
      expect(true).toBe(false);
    } catch (error: any) {
      expect(error.message).toBe("DB error");
    }
  });

  test("instrumentFetch passes through without OTel", async () => {
    const { instrumentFetch } = await import("../instrument");

    // Mock fetch
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("ok", { status: 200 });

    try {
      const result = await instrumentFetch("http://test.com");
      expect(result instanceof Response).toBe(true);
      const text = await (result as Response).text();
      expect(text).toBe("ok");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ========================================================================
// Metrics Manager
// ========================================================================

describe("metricsManager", () => {
  test("has expected API shape", async () => {
    const { metricsManager } = await import("../metrics");

    expect(metricsManager.isInitialized).toBe(false);
    expect(typeof metricsManager.configure).toBe("function");
    expect(typeof metricsManager.shutdown).toBe("function");
    expect(typeof metricsManager.recordRequest).toBe("function");
  });

  test("recordRequest does not throw without init", async () => {
    const { metricsManager } = await import("../metrics");

    // Should silently no-op
    metricsManager.recordRequest({
      method: "GET",
      path: "/test",
      status: 200,
      durationMs: 42.5,
    });
  });

  test("configure works without OTel deps", async () => {
    const { metricsManager } = await import("../metrics");

    await metricsManager.configure({
      exporters: ["console"],
      exportIntervalMs: 60000,
    });

    await metricsManager.shutdown();
  });

  test("incrementInFlight / decrementInFlight no-op without init", async () => {
    const { metricsManager } = await import("../metrics");

    metricsManager.incrementInFlight();
    metricsManager.decrementInFlight();
  });
});

// ========================================================================
// Logs Manager
// ========================================================================

describe("logsManager", () => {
  test("has expected API shape", async () => {
    const { logsManager } = await import("../logs");

    expect(logsManager.isInitialized).toBe(false);
    expect(typeof logsManager.configure).toBe("function");
    expect(typeof logsManager.shutdown).toBe("function");
    expect(typeof logsManager.emit).toBe("function");
    expect(typeof logsManager.info).toBe("function");
    expect(typeof logsManager.warn).toBe("function");
    expect(typeof logsManager.error).toBe("function");
    expect(typeof logsManager.debug).toBe("function");
  });

  test("emit does not throw without init", async () => {
    const { logsManager } = await import("../logs");

    logsManager.emit("test message");
    logsManager.info("info message");
    logsManager.warn("warn message");
    logsManager.error("error message");
  });

  test("configure works without OTel deps", async () => {
    const { logsManager } = await import("../logs");

    await logsManager.configure({
      exporters: ["console"],
      minimumSeverity: "INFO",
    });

    await logsManager.shutdown();
  });

  test("createRequestLoggerMiddleware returns middleware", async () => {
    const { logsManager } = await import("../logs");

    const mw = logsManager.createRequestLoggerMiddleware();
    expect(typeof mw).toBe("function");
  });
});

// ========================================================================
// SeverityNumber
// ========================================================================

describe("SeverityNumber", () => {
  test("has correct constants", async () => {
    const { SeverityNumber } = await import("../logs");

    expect(SeverityNumber.UNSPECIFIED).toBe(0);
    expect(SeverityNumber.TRACE).toBe(1);
    expect(SeverityNumber.DEBUG).toBe(5);
    expect(SeverityNumber.INFO).toBe(9);
    expect(SeverityNumber.WARN).toBe(13);
    expect(SeverityNumber.ERROR).toBe(17);
    expect(SeverityNumber.FATAL).toBe(21);
  });
});

// ========================================================================
// Plugin
// ========================================================================

describe("otelPlugin", () => {
  test("plugin has correct shape", async () => {
    const { otelPlugin } = await import("../plugin");

    const plugin = otelPlugin({
      tracer: { serviceName: "test" },
    });

    expect(plugin.name).toBe("@asijs/opentelemetry");
    expect(plugin.config).toBeDefined();
    expect(plugin.config.name).toBe("@asijs/opentelemetry");
    expect(typeof plugin.config.setup).toBe("function");
  });

  test("plugin setup can be called", async () => {
    const { otelPlugin } = await import("../plugin");

    const plugin = otelPlugin({
      tracer: { serviceName: "test" },
      metrics: false,
      logs: false,
    });

    // Mock app
    const mockApp = {
      use: () => mockApp,
    } as any;
    const mockState = new Map<string, unknown>();
    const mockDecorators = new Map<string, unknown>();

    await plugin.apply(mockApp, mockState, mockDecorators);

    // Should have registered decorators
    expect(mockDecorators.has("tracer")).toBe(true);
  });
});

// ========================================================================
// Types
// ========================================================================

describe("types", () => {
  test("types module exists", async () => {
    const types = await import("../types");
    expect(types).toBeDefined();
  });
});
