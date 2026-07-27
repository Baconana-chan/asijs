/**
 * Tests: Circuit Breaker & Resilience
 *
 * Covers:
 * 1. CircuitBreaker states: CLOSED → OPEN → HALF_OPEN → CLOSED
 * 2. Sliding window error threshold
 * 3. Timeout handling
 * 4. Recovery: OPEN → HALF_OPEN → CLOSED (on success) / OPEN (on failure)
 * 5. Metrics: state, counters, timestamps
 * 6. CircuitBreakerRegistry: register, call, getHealthChecks, resetAll
 * 7. ctx.circuitBreaker integration (middleware + context)
 * 8. fallback function
 * 9. Presets: apiCircuitBreaker, dbCircuitBreaker, criticalCircuitBreaker
 * 10. callSafe (never throws)
 */

import { describe, test, expect, beforeAll, beforeEach, afterEach } from "bun:test";
import {
  CircuitBreaker,
  CircuitBreakerRegistry,
  CircuitBreakerError,
  circuitBreaker,
  apiCircuitBreaker,
  dbCircuitBreaker,
  criticalCircuitBreaker,
  getCircuitBreakerRegistry,
  resetCircuitBreakerRegistry,
} from "../src/circuit-breaker";
import { Asi } from "../src/asi";
import { testClient } from "../src/testing";
import { healthCheck } from "../src/health";

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// 1. CircuitBreaker Class — States & Transitions
// ============================================================================

describe("CircuitBreaker — States & Transitions", () => {
  test("starts in CLOSED state", () => {
    const cb = new CircuitBreaker("test", { threshold: 3, windowMs: 60_000, recoveryTimeout: 10_000 });
    expect(cb.state).toBe("CLOSED");
  });

  test("stays CLOSED when requests succeed", async () => {
    const cb = new CircuitBreaker("test", { threshold: 3, windowMs: 60_000 });
    await cb.call(() => Promise.resolve("ok"));
    expect(cb.state).toBe("CLOSED");
    expect(cb.getMetrics().successCount).toBe(1);
  });

  test("opens after threshold failures within window", async () => {
    const cb = new CircuitBreaker("test", { threshold: 3, windowMs: 60_000, recoveryTimeout: 10_000 });

    // Two failures — still CLOSED
    for (let i = 0; i < 2; i++) {
      try { await cb.call(() => Promise.reject(new Error("fail"))); } catch {}
    }
    expect(cb.state).toBe("CLOSED");

    // Third failure — opens
    try { await cb.call(() => Promise.reject(new Error("fail"))); } catch {}
    expect(cb.state).toBe("OPEN");
  });

  test("rejects requests when OPEN", async () => {
    const cb = new CircuitBreaker("test", { threshold: 1, windowMs: 60_000, recoveryTimeout: 60_000 });

    // Trip the breaker
    try { await cb.call(() => Promise.reject(new Error("fail"))); } catch {}

    expect(cb.state).toBe("OPEN");

    // Next request should be rejected
    try {
      await cb.call(() => Promise.resolve("should not reach"));
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CircuitBreakerError);
      expect((err as CircuitBreakerError).breakerName).toBe("test");
    }
  });

  test("transitions to HALF_OPEN after recovery timeout", async () => {
    const cb = new CircuitBreaker("test", {
      threshold: 1,
      windowMs: 60_000,
      recoveryTimeout: 50, // 50ms
    });

    // Trip
    try { await cb.call(() => Promise.reject(new Error("fail"))); } catch {}
    expect(cb.state).toBe("OPEN");

    // Wait for recovery timeout
    await sleep(60);

    expect(cb.state).toBe("HALF_OPEN");
  });

  test("recovery: HALF_OPEN → CLOSED on success", async () => {
    const cb = new CircuitBreaker("test", {
      threshold: 1,
      windowMs: 60_000,
      recoveryTimeout: 30,
    });

    // Trip
    try { await cb.call(() => Promise.reject(new Error("fail"))); } catch {}
    await sleep(40);

    expect(cb.state).toBe("HALF_OPEN");

    // Probe succeeds — back to CLOSED
    await cb.call(() => Promise.resolve("recovered"));
    expect(cb.state).toBe("CLOSED");
    expect(cb.getMetrics().recoveryCount).toBe(1);
  });

  test("recovery: HALF_OPEN → OPEN on failure", async () => {
    const cb = new CircuitBreaker("test", {
      threshold: 1,
      windowMs: 60_000,
      recoveryTimeout: 30,
    });

    // Trip
    try { await cb.call(() => Promise.reject(new Error("fail"))); } catch {}
    await sleep(40);

    expect(cb.state).toBe("HALF_OPEN");

    // Probe fails — back to OPEN
    try { await cb.call(() => Promise.reject(new Error("probe fail"))); } catch {}
    expect(cb.state).toBe("OPEN");
  });
});

// ============================================================================
// 2. CircuitBreaker — Metrics
// ============================================================================

describe("CircuitBreaker — Metrics", () => {
  test("metrics track success/failure/reject counts", async () => {
    const cb = new CircuitBreaker("metrics-test", {
      threshold: 2,
      windowMs: 60_000,
      recoveryTimeout: 60_000,
    });

    // 2 successes
    await cb.call(() => Promise.resolve("ok"));
    await cb.call(() => Promise.resolve("ok"));

    // 1 failure
    try { await cb.call(() => Promise.reject(new Error("fail"))); } catch {}

    const m = cb.getMetrics();
    expect(m.state).toBe("CLOSED"); // threshold=2, only 1 failure
    expect(m.successCount).toBe(2);
    expect(m.failureCount).toBe(1);
    expect(m.rejectCount).toBe(0);
    expect(m.totalCount).toBe(3);
    expect(m.remainingThreshold).toBe(1); // threshold=2, 1 failure so far
  });

  test("metrics include lastSuccess and lastFailure timestamps", async () => {
    const cb = new CircuitBreaker("timestamps", { threshold: 2, windowMs: 60_000 });

    await cb.call(() => Promise.resolve("ok"));
    expect(cb.getMetrics().lastSuccess).toBeGreaterThan(0);

    // Small delay to ensure different timestamps
    await sleep(5);

    try { await cb.call(() => Promise.reject(new Error("fail"))); } catch {}
    expect(cb.getMetrics().lastFailure).toBeGreaterThan(0);
    expect(cb.getMetrics().lastSuccess!).toBeLessThan(cb.getMetrics().lastFailure!);
  });

  test("metrics show openSince and timeUntilRecovery when OPEN", async () => {
    const cb = new CircuitBreaker("metrics-open", {
      threshold: 1,
      windowMs: 60_000,
      recoveryTimeout: 60_000,
    });

    try { await cb.call(() => Promise.reject(new Error("fail"))); } catch {}
    const m = cb.getMetrics();
    expect(m.state).toBe("OPEN");
    expect(m.openSince).toBeGreaterThan(0);
    expect(m.timeUntilRecovery).toBeGreaterThan(0);
    expect(m.rejectCount).toBe(0); // No rejects yet
  });

  test("rejectCount increases when requests rejected while OPEN", async () => {
    const cb = new CircuitBreaker("rejects", {
      threshold: 1,
      windowMs: 60_000,
      recoveryTimeout: 60_000,
    });

    // Trip
    try { await cb.call(() => Promise.reject(new Error("fail"))); } catch {}
    expect(cb.getMetrics().rejectCount).toBe(0); // The failing request isn't a "reject"

    // Rejected
    try { await cb.call(() => Promise.resolve("x")); } catch {}
    expect(cb.getMetrics().rejectCount).toBe(1);

    try { await cb.call(() => Promise.resolve("x")); } catch {}
    expect(cb.getMetrics().rejectCount).toBe(2);
  });
});

// ============================================================================
// 3. CircuitBreaker — Timeout
// ============================================================================

describe("CircuitBreaker — Timeout", () => {
  test("counts timed-out requests as failures", async () => {
    const cb = new CircuitBreaker("timeout-test", {
      threshold: 2,
      windowMs: 60_000,
      timeout: 30, // 30ms timeout
    });

    // Call a slow function — should time out
    try {
      await cb.call(() => sleep(100).then(() => "slow"));
      expect.unreachable("Should have timed out");
    } catch (err) {
      expect(err).toBeInstanceOf(CircuitBreakerError);
    }

    expect(cb.getMetrics().failureCount).toBe(1);
    // Not yet open (threshold=2)
    expect(cb.state).toBe("CLOSED");

    // Second timeout should open the circuit
    try { await cb.call(() => sleep(100).then(() => "slow")); } catch {}
    expect(cb.state).toBe("OPEN");
  });

  test("fast requests pass through normally", async () => {
    const cb = new CircuitBreaker("fast", {
      threshold: 3,
      windowMs: 60_000,
      timeout: 5000,
    });

    const result = await cb.call(() => Promise.resolve("fast-response"));
    expect(result).toBe("fast-response");
    expect(cb.getMetrics().successCount).toBe(1);
  });
});

// ============================================================================
// 4. CircuitBreaker — Fallback
// ============================================================================

describe("CircuitBreaker — Fallback", () => {
  test("fallback is called when circuit is OPEN", async () => {
    let fallbackCalled = false;
    const cb = new CircuitBreaker("with-fallback", {
      threshold: 1,
      windowMs: 60_000,
      recoveryTimeout: 60_000,
      fallback: () => {
        fallbackCalled = true;
        return { cached: true, data: "fallback-data" };
      },
    });

    // Trip
    try { await cb.call(() => Promise.reject(new Error("fail"))); } catch {}

    // Should get fallback instead of error
    const result = await cb.call(() => Promise.resolve("should-not-reach"));
    expect(fallbackCalled).toBe(true);
    expect(result).toEqual({ cached: true, data: "fallback-data" });
  });

  test("without fallback, OPEN state throws CircuitBreakerError", async () => {
    const cb = new CircuitBreaker("no-fallback", {
      threshold: 1,
      windowMs: 60_000,
      recoveryTimeout: 60_000,
    });

    try { await cb.call(() => Promise.reject(new Error("fail"))); } catch {}

    try {
      await cb.call(() => Promise.resolve("should-not-reach"));
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CircuitBreakerError);
    }
  });

  test("fallback can return different types", async () => {
    const cb = new CircuitBreaker("fallback-types", {
      threshold: 1,
      windowMs: 60_000,
      recoveryTimeout: 60_000,
      fallback: () => 42,
    });

    try { await cb.call(() => Promise.reject(new Error("fail"))); } catch {}
    const result = await cb.call(() => Promise.resolve("x"));
    expect(result).toBe(42);
  });
});

// ============================================================================
// 5. CircuitBreaker — callSafe (never throws)
// ============================================================================

describe("CircuitBreaker — callSafe", () => {
  test("returns success result on success", async () => {
    const cb = new CircuitBreaker("safe", { threshold: 3, windowMs: 60_000 });
    const result = await cb.callSafe(() => Promise.resolve("hello"));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("hello");
    }
  });

  test("returns error result on failure", async () => {
    const cb = new CircuitBreaker("safe-fail", { threshold: 3, windowMs: 60_000 });
    const result = await cb.callSafe(() => Promise.reject(new Error("boom")));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe("boom");
    }
  });

  test("returns error result when circuit is OPEN", async () => {
    const cb = new CircuitBreaker("safe-open", {
      threshold: 1,
      windowMs: 60_000,
      recoveryTimeout: 60_000,
    });

    // Trip
    await cb.callSafe(() => Promise.reject(new Error("fail")));

    // Safe call should not throw
    const result = await cb.callSafe(() => Promise.resolve("x"));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(CircuitBreakerError);
    }
  });
});

// ============================================================================
// 6. CircuitBreaker — Manual State Control
// ============================================================================

describe("CircuitBreaker — Manual Control", () => {
  test("forceState sets state directly", () => {
    const cb = new CircuitBreaker("manual", { threshold: 3, windowMs: 60_000 });
    cb.forceState("OPEN");
    expect(cb.state).toBe("OPEN");
    expect(cb.getMetrics().openSince).toBeGreaterThan(0);

    cb.forceState("HALF_OPEN");
    expect(cb.state).toBe("HALF_OPEN");

    cb.forceState("CLOSED");
    expect(cb.state).toBe("CLOSED");
  });

  test("reset clears all counters and returns to CLOSED", async () => {
    const cb = new CircuitBreaker("reset-test", {
      threshold: 1,
      windowMs: 60_000,
      recoveryTimeout: 60_000,
    });

    // Trip
    try { await cb.call(() => Promise.reject(new Error("fail"))); } catch {}
    expect(cb.state).toBe("OPEN");

    cb.reset();
    expect(cb.state).toBe("CLOSED");
    expect(cb.getMetrics().failureCount).toBe(0);
    expect(cb.getMetrics().totalCount).toBe(0);
    expect(cb.getMetrics().openSince).toBeNull();
  });
});

// ============================================================================
// 7. CircuitBreaker — ShouldTrip filter
// ============================================================================

describe("CircuitBreaker — Error Filter (shouldTrip)", () => {
  test("shouldTrip can exclude certain errors from threshold", async () => {
    const cb = new CircuitBreaker("filtered", {
      threshold: 3,
      windowMs: 60_000,
      shouldTrip: (err) => {
        // Only count 5xx errors, not 4xx
        return err instanceof Error && !err.message.includes("4xx");
      },
    });

    // 4xx error — should NOT count toward threshold
    for (let i = 0; i < 5; i++) {
      try { await cb.call(() => Promise.reject(new Error("404 4xx"))); } catch {}
    }

    expect(cb.state).toBe("CLOSED"); // Still closed, shouldTrip filtered out 4xx
    expect(cb.getMetrics().failureCount).toBe(0); // Not counted

    // 5xx error — should count
    try { await cb.call(() => Promise.reject(new Error("500 Internal"))); } catch {}
    expect(cb.getMetrics().failureCount).toBe(1);
  });
});

// ============================================================================
// 8. CircuitBreaker — onStateChange callback
// ============================================================================

describe("CircuitBreaker — onStateChange callback", () => {
  test("callback fires on state transitions", async () => {
    const transitions: Array<{ from: string; to: string }> = [];

    const cb = new CircuitBreaker("cb-events", {
      threshold: 1,
      windowMs: 60_000,
      recoveryTimeout: 30,
      onStateChange: (name, from, to) => {
        transitions.push({ from, to });
      },
    });

    // Trip: CLOSED → OPEN
    try { await cb.call(() => Promise.reject(new Error("fail"))); } catch {}
    expect(transitions.length).toBe(1);
    expect(transitions[0]).toEqual({ from: "CLOSED", to: "OPEN" });

    // Wait for recovery
    await sleep(40);

    // State auto-transition: OPEN → HALF_OPEN (fires callback)
    expect(cb.state).toBe("HALF_OPEN");
    expect(transitions.length).toBe(2);
    expect(transitions[1]).toEqual({ from: "OPEN", to: "HALF_OPEN" });

    // Recovery: HALF_OPEN → CLOSED
    await cb.call(() => Promise.resolve("ok"));
    expect(transitions.length).toBe(3);
    expect(transitions[2]).toEqual({ from: "HALF_OPEN", to: "CLOSED" });
  });
});

// ============================================================================
// 9. CircuitBreakerRegistry
// ============================================================================

describe("CircuitBreakerRegistry", () => {
  let registry: CircuitBreakerRegistry;

  beforeEach(() => {
    registry = new CircuitBreakerRegistry();
  });

  test("register and get a breaker", () => {
    const cb = new CircuitBreaker("my-api", { threshold: 5, windowMs: 60_000 });
    registry.register("my-api", cb);
    expect(registry.get("my-api")).toBe(cb);
    expect(registry.has("my-api")).toBe(true);
    expect(registry.has("unknown")).toBe(false);
    expect(registry.size).toBe(1);
  });

  test("call through a registered breaker", async () => {
    const cb = new CircuitBreaker("api", { threshold: 5, windowMs: 60_000 });
    registry.register("api", cb);

    const result = await registry.call("api", () => Promise.resolve("data"));
    expect(result).toBe("data");
    expect(cb.getMetrics().successCount).toBe(1);
  });

  test("throws if calling unregistered breaker", async () => {
    try {
      await registry.call("unknown", () => Promise.resolve("x"));
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect((err as Error).message).toContain("unknown");
    }
  });

  test("callSafe with unknown breaker returns error result", async () => {
    const result = await registry.callSafe("nonexistent", () => Promise.resolve("x"));
    expect(result.success).toBe(false);
  });

  test("getAllMetrics returns metrics for all breakers", () => {
    const cb1 = new CircuitBreaker("api-1", { threshold: 3, windowMs: 60_000 });
    const cb2 = new CircuitBreaker("api-2", { threshold: 5, windowMs: 60_000 });
    registry.register("api-1", cb1);
    registry.register("api-2", cb2);

    const all = registry.getAllMetrics();
    expect(Object.keys(all).length).toBe(2);
    expect(all["api-1"].state).toBe("CLOSED");
    expect(all["api-2"].state).toBe("CLOSED");
  });

  test("getHealthChecks returns health check functions", () => {
    const cb = new CircuitBreaker("healthy-api", { threshold: 5, windowMs: 60_000 });
    registry.register("healthy-api", cb);

    const checks = registry.getHealthChecks();
    expect(checks["cb:healthy-api"]).toBeDefined();
    expect(typeof checks["cb:healthy-api"]).toBe("function");
  });

  test("resetAll resets all breakers", async () => {
    const cb = new CircuitBreaker("api", {
      threshold: 1,
      windowMs: 60_000,
      recoveryTimeout: 60_000,
    });
    registry.register("api", cb);

    // Trip
    try { await cb.call(() => Promise.reject(new Error("fail"))); } catch {}
    expect(cb.state).toBe("OPEN");

    registry.resetAll();
    expect(cb.state).toBe("CLOSED");
  });

  test("remove unregisters a breaker", () => {
    const cb = new CircuitBreaker("temp", { threshold: 3, windowMs: 60_000 });
    registry.register("temp", cb);
    expect(registry.size).toBe(1);

    registry.remove("temp");
    expect(registry.size).toBe(0);
    expect(registry.has("temp")).toBe(false);
  });

  test("getNames returns all breaker names", () => {
    registry.register("a", new CircuitBreaker("a", { threshold: 3, windowMs: 60_000 }));
    registry.register("b", new CircuitBreaker("b", { threshold: 3, windowMs: 60_000 }));
    const names = registry.getNames();
    expect(names.sort()).toEqual(["a", "b"]);
  });
});

// ============================================================================
// 10. Healthcheck Integration
// ============================================================================

describe("Healthcheck Integration", () => {
  test("getHealthCheck returns healthy for CLOSED state", () => {
    const cb = new CircuitBreaker("healthy", { threshold: 5, windowMs: 60_000 });
    const check = cb.getHealthCheck();
    const result = check() as any;
    expect(result.status).toBe("healthy");
    expect(result.meta.state).toBe("CLOSED");
  });

  test("getHealthCheck returns unhealthy for OPEN state", async () => {
    const cb = new CircuitBreaker("unhealthy", {
      threshold: 1,
      windowMs: 60_000,
      recoveryTimeout: 60_000,
    });

    try { await cb.call(() => Promise.reject(new Error("fail"))); } catch {}

    const check = cb.getHealthCheck();
    const result = check() as any;
    expect(result.status).toBe("unhealthy");
    expect(result.meta.state).toBe("OPEN");
    expect(result.meta.failureCount).toBe(1);
  });

  test("getHealthCheck returns degraded for HALF_OPEN state", async () => {
    const cb = new CircuitBreaker("degraded", {
      threshold: 1,
      windowMs: 60_000,
      recoveryTimeout: 30,
    });

    try { await cb.call(() => Promise.reject(new Error("fail"))); } catch {}
    await sleep(40);

    const check = cb.getHealthCheck();
    const result = check() as any;
    expect(result.status).toBe("degraded");
    expect(result.meta.state).toBe("HALF_OPEN");
  });

  test("registry.getHealthChecks can be used with healthCheck middleware", () => {
    const registry = new CircuitBreakerRegistry();
    const cb = new CircuitBreaker("test-api", { threshold: 5, windowMs: 60_000 });
    registry.register("test-api", cb);

    const checks = registry.getHealthChecks();
    expect(Object.keys(checks)).toContain("cb:test-api");
    const result = checks["cb:test-api"]() as any;
    expect(result.status).toBe("healthy");
    expect(result.meta.successCount).toBe(0);
  });
});

// ============================================================================
// 11. Middleware Integration
// ============================================================================

describe("Middleware Integration", () => {
  test("circuitBreaker middleware adds ctx.circuitBreaker", async () => {
    const app = new Asi({ silent: true });

    app.use(circuitBreaker({
      name: "test-api",
      threshold: 5,
      windowMs: 60_000,
      recoveryTimeout: 10_000,
      timeout: 5000,
    }));

    app.get("/data", async (ctx: any) => {
      const result = await ctx.circuitBreaker("test-api", async () => {
        return { message: "hello" };
      });
      return result;
    });

    const res = await app.handle(new Request("http://localhost/data"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe("hello");
  });

  test("circuit breaker rejects when OPEN (middleware)", async () => {
    resetCircuitBreakerRegistry();
    const app = new Asi({ silent: true });

    app.use(circuitBreaker({
      name: "failing-api",
      threshold: 1,
      windowMs: 60_000,
      recoveryTimeout: 60_000,
    }));

    app.get("/fail", async (ctx: any) => {
      const result = await ctx.circuitBreaker("failing-api", async () => {
        throw new Error("API failure");
      });
      return result;
    });

    // Trip the breaker
    const res1 = await app.handle(new Request("http://localhost/fail"));
    // Depends on error handler — may be 500 or custom
    expect(res1.status).toBeGreaterThanOrEqual(400);

    // Next request should be rejected
    const res2 = await app.handle(new Request("http://localhost/fail"));
    // Also fails
    expect(res2.status).toBeGreaterThanOrEqual(400);
  });

  test("circuit breaker with fallback works through middleware", async () => {
    resetCircuitBreakerRegistry();
    const app = new Asi({ silent: true });

    app.use(circuitBreaker({
      name: "api-with-fallback",
      threshold: 1,
      windowMs: 60_000,
      recoveryTimeout: 60_000,
      fallback: () => ({ cached: true, data: "fallback" }),
    }));

    app.get("/data", async (ctx: any) => {
      const result = await ctx.circuitBreaker("api-with-fallback", async () => {
        throw new Error("API down");
      });
      return ctx.jsonResponse(result);
    });

    // Trip it
    await app.handle(new Request("http://localhost/data"));

    // Next call should get fallback
    const res = await app.handle(new Request("http://localhost/data"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ cached: true, data: "fallback" });
  });

  test("presets work through middleware", () => {
    const apiMiddleware = apiCircuitBreaker("preset-api");
    expect(typeof apiMiddleware).toBe("function");

    const dbMiddleware = dbCircuitBreaker("preset-db");
    expect(typeof dbMiddleware).toBe("function");

    const criticalMiddleware = criticalCircuitBreaker("preset-critical");
    expect(typeof criticalMiddleware).toBe("function");
  });
});

// ============================================================================
// 12. Global Registry & Reset
// ============================================================================

describe("Global Registry", () => {
  test("getCircuitBreakerRegistry returns a singleton", () => {
    const r1 = getCircuitBreakerRegistry();
    const r2 = getCircuitBreakerRegistry();
    expect(r1).toBe(r2);
  });

  test("resetCircuitBreakerRegistry clears the singleton", () => {
    const r1 = getCircuitBreakerRegistry();
    resetCircuitBreakerRegistry();
    const r2 = getCircuitBreakerRegistry();
    expect(r1).not.toBe(r2);
  });
});

// ============================================================================
// 13. Edge Cases
// ============================================================================

describe("Edge Cases", () => {
  test("error window prunes old errors", async () => {
    const cb = new CircuitBreaker("pruning", {
      threshold: 3,
      windowMs: 30, // 30ms window
      recoveryTimeout: 10_000,
    });

    // 2 failures
    try { await cb.call(() => Promise.reject(new Error("fail"))); } catch {}
    try { await cb.call(() => Promise.reject(new Error("fail"))); } catch {}
    expect(cb.state).toBe("CLOSED"); // threshold=3

    // Wait for window to pass
    await sleep(40);

    // Now the old errors should be pruned
    // A third failure should NOT trip because old ones expired
    try { await cb.call(() => Promise.reject(new Error("fail"))); } catch {}
    expect(cb.state).toBe("CLOSED"); // Old errors pruned, so only 1 in current window
  });

  test("calling forceState triggers onStateChange", () => {
    let changed = false;
    const cb = new CircuitBreaker("force-cb", {
      threshold: 3,
      windowMs: 60_000,
      onStateChange: () => { changed = true; },
    });

    cb.forceState("OPEN");
    expect(changed).toBe(true);
  });

  test("multiple breakers in registry don't interfere", async () => {
    const registry = new CircuitBreakerRegistry();

    const cb1 = new CircuitBreaker("api-1", { threshold: 1, windowMs: 60_000, recoveryTimeout: 60_000 });
    const cb2 = new CircuitBreaker("api-2", { threshold: 5, windowMs: 60_000 });

    registry.register("api-1", cb1);
    registry.register("api-2", cb2);

    // Trip api-1
    try { await registry.call("api-1", () => Promise.reject(new Error("fail"))); } catch {}
    expect(cb1.state).toBe("OPEN");

    // api-2 should still work
    const result = await registry.call("api-2", () => Promise.resolve("still-working"));
    expect(result).toBe("still-working");
    expect(cb2.state).toBe("CLOSED");
  });
});
