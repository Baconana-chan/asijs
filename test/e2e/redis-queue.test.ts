/**
 * E2E Test: Redis Queue — push → process → complete
 *
 * Tests the RedisQueue class with a real Redis instance.
 * Requires Redis running (docker compose -f docker/docker-compose.test.yml up -d).
 *
 * Test scenarios:
 * 1. Push → Process → Complete (basic FIFO)
 * 2. Delayed jobs (sorted set → list)
 * 3. Retry on failure → dead letter queue
 * 4. Queue metrics
 * 5. Dead letter retry
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { RedisQueue, type RedisQueueJob } from "../../src/redis";
import { CONFIG, isRedisAvailable } from "../integration/docker-helper";

// ============================================================================
// Setup
// ============================================================================

const REDIS_AVAILABLE = await isRedisAvailable();
const QUEUE_PREFIX = `asijs:e2e:${Date.now()}:`;

let queue: RedisQueue;

describe("Redis Queue E2E", () => {
  beforeAll(async () => {
    if (!REDIS_AVAILABLE) {
      console.log("  ⏭️  Redis not available — skipping Redis queue E2E tests");
      return;
    }

    queue = new RedisQueue({
      redis: {
        host: CONFIG.redis.host,
        port: CONFIG.redis.port,
      },
      prefix: QUEUE_PREFIX,
      pollIntervalMs: 100,
      defaultMaxAttempts: 3,
      verbose: false,
    });
  });

  afterAll(async () => {
    if (queue) {
      await queue.clear();
      await queue.close();
    }
  });

  const it = REDIS_AVAILABLE ? test : test.skip;

  // ==========================================================================
  // 1. Basic FIFO: Push → Process → Complete
  // ==========================================================================

  it("should push a job and process it (basic FIFO)", async () => {
    const results: string[] = [];

    queue.process("fifo-test", async (job: RedisQueueJob) => {
      results.push(`processed: ${job.data.msg}`);
    });

    queue.start();

    const jobId = await queue.push("fifo-test", { msg: "hello" });
    expect(jobId).toBeDefined();
    expect(typeof jobId).toBe("string");

    // Wait for processing
    await sleep(500);

    expect(results.length).toBe(1);
    expect(results[0]).toBe("processed: hello");
  });

  it("should process multiple jobs in FIFO order", async () => {
    const results: string[] = [];

    queue.process("fifo-multi", async (job: RedisQueueJob) => {
      results.push(job.data.value);
    });

    queue.start();

    await queue.push("fifo-multi", { value: "first" });
    await queue.push("fifo-multi", { value: "second" });
    await queue.push("fifo-multi", { value: "third" });

    await sleep(500);

    expect(results.length).toBe(3);
    expect(results[0]).toBe("first");
    expect(results[1]).toBe("second");
    expect(results[2]).toBe("third");
  });

  // ==========================================================================
  // 2. Delayed Jobs
  // ==========================================================================

  it("should delay job execution", async () => {
    const results: Array<{ id: string; elapsed: number }> = [];
    const startTime = Date.now();

    queue.process("delayed-test", async (job: RedisQueueJob) => {
      results.push({
        id: job.id,
        elapsed: Date.now() - startTime,
      });
    });

    queue.start();

    await queue.push("delayed-test", { msg: "instant" });
    await queue.push("delayed-test", { msg: "delayed" }, { delay: 300 });

    await sleep(600);

    expect(results.length).toBe(2);
    // The delayed job should have been processed AFTER the instant one
    // and with a delay of at least 200ms
    const delayedJob = results.find((r) => r.elapsed >= 200);
    expect(delayedJob).toBeDefined();
  });

  // ==========================================================================
  // 3. Retry & Dead Letter Queue
  // ==========================================================================

  it("should retry failed jobs and move to dead letter queue after max attempts", async () => {
    const attempts: Array<{ attempt: number; time: number }> = [];
    const client = await queue.getClient();

    queue.process("retry-test", async (job: RedisQueueJob) => {
      attempts.push({ attempt: job.attempts, time: Date.now() });
      throw new Error("Simulated failure");
    });

    queue.start();

    await queue.push("retry-test", { shouldFail: true });

    // Wait for retries (maxAttempts=3, with backoff: ~1s, ~2s)
    await sleep(5000);

    // Should have attempted 3 times (attempts 0, 1, 2)
    expect(attempts.length).toBe(3);
    expect(attempts[0].attempt).toBe(0);
    expect(attempts[1].attempt).toBe(1);
    expect(attempts[2].attempt).toBe(2);

    // Check dead letter queue
    const prefix = QUEUE_PREFIX;
    const deadCount = await client.llen(`${prefix}dead`);
    expect(Number(deadCount)).toBeGreaterThanOrEqual(1);

    // Verify it's no longer in the regular queue
    const pendingCount = await queue.pending("retry-test");
    expect(pendingCount).toBe(0);
  });

  // ==========================================================================
  // 4. Queue Metrics
  // ==========================================================================

  it("should return queue metrics", async () => {
    const metrics = await queue.getMetrics();
    expect(metrics).toBeDefined();
    expect(typeof metrics.processed).toBe("number");
    expect(typeof metrics.completed).toBe("number");
    expect(typeof metrics.failed).toBe("number");
    expect(typeof metrics.waiting).toBe("number");
    expect(typeof metrics.active).toBe("number");
    expect(typeof metrics.deadLetter).toBe("number");
  });

  // ==========================================================================
  // 5. Dead Letter Retry
  // ==========================================================================

  it("should retry jobs from dead letter queue", async () => {
    // First, clear any existing data
    await queue.clear("dead-retry-test");

    // Push a job that will fail (to get into dead letter)
    const failResults: string[] = [];

    queue.process("dead-retry-test", async (job: RedisQueueJob) => {
      failResults.push(`fail-${job.attempts}`);
      throw new Error("Will fail");
    });

    queue.start();
    await queue.push("dead-retry-test", { willEndInDead: true });

    // Wait for failure + dead letter (3 attempts with backoff)
    await sleep(5000);

    // Now retry from dead letter
    const retried = await queue.retryDead("dead-retry-test");
    expect(retried).toBeGreaterThanOrEqual(1);

    // Wait — it will fail again, but we proved retryDead works
    await sleep(500);
  });

  // ==========================================================================
  // 6. Custom Job ID
  // ==========================================================================

  it("should accept custom job IDs", async () => {
    const customId = "my-custom-job-id-12345";
    const processedIds: string[] = [];

    queue.process("custom-id-test", async (job: RedisQueueJob) => {
      processedIds.push(job.id);
    });

    queue.start();

    const jobId = await queue.push(
      "custom-id-test",
      { msg: "custom id" },
      { id: customId },
    );

    expect(jobId).toBe(customId);

    await sleep(500);
    expect(processedIds).toContain(customId);
  });
});

// ============================================================================
// Helper
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
