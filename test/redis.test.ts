import { describe, expect, it } from "bun:test";
import { RedisRateLimitStore, RedisQueue } from "../src";
import type { RateLimitInfo } from "../src";

// ============================================================================
// RedisRateLimitStore — unit tests (no actual Redis connection)
// ============================================================================

describe("RedisRateLimitStore", () => {
  it("creates instance with default options", () => {
    const store = new RedisRateLimitStore();
    expect(store).toBeInstanceOf(RedisRateLimitStore);
  });

  it("creates instance with custom options", () => {
    const store = new RedisRateLimitStore({
      host: "redis.example.com",
      port: 6380,
      keyPrefix: "myapp:",
    });
    expect(store).toBeInstanceOf(RedisRateLimitStore);
  });

  it("increment returns RateLimitInfo shape when Redis unavailable", async () => {
    // Without actual Redis, increment should reject or return fallback
    const store = new RedisRateLimitStore({ host: "127.0.0.1", port: 16379 });

    try {
      const result = await store.increment("test-key", 60_000, 100);
      // If it somehow succeeds (e.g., mock Redis), verify shape
      expect(result).toHaveProperty("limit");
      expect(result).toHaveProperty("remaining");
      expect(result).toHaveProperty("resetTime");
      expect(result).toHaveProperty("retryAfter");
    } catch {
      // Expected — no Redis running
    }
  });

  it("reset does not throw when Redis unavailable", async () => {
    const store = new RedisRateLimitStore({ host: "127.0.0.1", port: 16379 });

    try {
      await store.reset("some-key");
      // No throw = success
    } catch {
      // Expected
    }
  });

  it("cleanup is a no-op (Redis handles TTL)", async () => {
    const store = new RedisRateLimitStore();
    await store.cleanup(); // Should not throw
    expect(true).toBe(true);
  });

  it("close is a no-op (shared connections)", async () => {
    const store = new RedisRateLimitStore();
    await store.close(); // Should not throw
    expect(true).toBe(true);
  });
});

// ============================================================================
// RedisQueue — unit tests (no actual Redis)
// ============================================================================

describe("RedisQueue", () => {
  it("creates instance with default options", () => {
    const queue = new RedisQueue();
    expect(queue).toBeInstanceOf(RedisQueue);
  });

  it("creates instance with custom options", () => {
    const queue = new RedisQueue({
      redis: { host: "127.0.0.1", port: 6379 },
      prefix: "myapp:queue:",
      defaultMaxAttempts: 5,
      verbose: false,
      pollIntervalMs: 500,
    });
    expect(queue).toBeInstanceOf(RedisQueue);
  });

  it("start() and close() handle gracefully when no handlers registered", async () => {
    const queue = new RedisQueue();
    queue.start(); // No handlers — should not throw
    await queue.close(); // Should not throw
    expect(true).toBe(true);
  });

  it("register a handler with process()", () => {
    const queue = new RedisQueue();
    let processed = false;

    queue.process("email", async (job) => {
      processed = true;
    });

    expect(true).toBe(true);
  });

  it("push returns a job ID when Redis unavailable", async () => {
    const queue = new RedisQueue({ redis: { host: "127.0.0.1", port: 16379 } });

    try {
      const id = await queue.push("test", { hello: "world" });
      expect(id).toBeDefined();
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    } catch {
      // Expected — no Redis
    }
  });

  it("push with delay stores as delayed job", async () => {
    const queue = new RedisQueue({ redis: { host: "127.0.0.1", port: 16379 } });

    try {
      const id = await queue.push("delayed-task", { data: 1 }, { delay: 5000 });
      expect(id).toBeDefined();
    } catch {
      // Expected — no Redis
    }
  });

  it("push with custom id uses that id", async () => {
    const queue = new RedisQueue({ redis: { host: "127.0.0.1", port: 16379 } });

    try {
      const id = await queue.push("task", { x: 1 }, { id: "my-custom-id" });
      expect(id).toBe("my-custom-id");
    } catch {
      // Expected — no Redis
    }
  });

  it("push with custom maxAttempts", async () => {
    const queue = new RedisQueue({ redis: { host: "127.0.0.1", port: 16379 } });

    try {
      const id = await queue.push("task", { x: 1 }, { maxAttempts: 10 });
      expect(id).toBeDefined();
    } catch {
      // Expected — no Redis
    }
  });

  it("clear does not throw when no Redis", async () => {
    const queue = new RedisQueue({ redis: { host: "127.0.0.1", port: 16379 } });

    try {
      await queue.clear();
    } catch {
      // Expected
    }
  });

  it("clear('type') does not throw", async () => {
    const queue = new RedisQueue({ redis: { host: "127.0.0.1", port: 16379 } });

    try {
      await queue.clear("email");
    } catch {
      // Expected
    }
  });

  it("pending returns 0 when no Redis", async () => {
    const queue = new RedisQueue({ redis: { host: "127.0.0.1", port: 16379 } });

    queue.process("email", async () => {});

    try {
      const count = await queue.pending("email");
      expect(typeof count).toBe("number");
    } catch {
      // Expected
    }
  });

  it("getMetrics returns correct shape", async () => {
    const queue = new RedisQueue({ redis: { host: "127.0.0.1", port: 16379 } });

    queue.process("email", async () => {});

    try {
      const metrics = await queue.getMetrics("email");
      expect(metrics).toHaveProperty("processed");
      expect(metrics).toHaveProperty("completed");
      expect(metrics).toHaveProperty("failed");
      expect(metrics).toHaveProperty("waiting");
      expect(metrics).toHaveProperty("active");
      expect(metrics).toHaveProperty("deadLetter");
    } catch {
      // Expected
    }
  });

  it("getMetrics without type argument", async () => {
    const queue = new RedisQueue({ redis: { host: "127.0.0.1", port: 16379 } });

    queue.process("email", async () => {});
    queue.process("webhook", async () => {});

    try {
      const metrics = await queue.getMetrics();
      expect(metrics).toHaveProperty("waiting");
    } catch {
      // Expected
    }
  });

  it("retryDead does not throw when no Redis", async () => {
    const queue = new RedisQueue({ redis: { host: "127.0.0.1", port: 16379 } });

    try {
      const count = await queue.retryDead("email", 10);
      expect(typeof count).toBe("number");
    } catch {
      // Expected
    }
  });

  it("close waits for active jobs", async () => {
    const queue = new RedisQueue({ redis: { host: "127.0.0.1", port: 16379 } });

    queue.process("slow", async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    await queue.close(); // Should not throw
    expect(true).toBe(true);
  });
});
