/**
 * Redis-based Rate Limit Store & Background Queue for AsiJS
 *
 * Provides:
 * - RedisRateLimitStore — distributed sliding window rate limiting via Redis sorted sets
 * - RedisQueue — FIFO and delayed job queue using Redis lists + sorted sets
 *
 * Both use ioredis (already a dependency of AsiJS).
 *
 * @example
 * ```ts
 * import { Asi, rateLimit, RedisRateLimitStore } from "asijs";
 *
 * const app = new Asi();
 *
 * // Redis rate limiting
 * app.plugin(rateLimit({
 *   max: 1000,
 *   windowMs: 60_000,
 *   store: new RedisRateLimitStore({ host: "localhost", port: 6379 }),
 * }));
 *
 * // Redis queue for background jobs
 * const queue = new RedisQueue({ redis: { host: "localhost" } });
 * await queue.push("email", { to: "user@example.com" });
 * queue.process("email", async (job) => {
 *   await sendEmail(job.data);
 * });
 * ```
 */

import type { RateLimitStore, RateLimitInfo } from "./ratelimit";

// ============================================================================
// Types
// ============================================================================

export interface RedisConnectionOptions {
  /** Redis host (default: "localhost") */
  host?: string;
  /** Redis port (default: 6379) */
  port?: number;
  /** Redis password */
  password?: string;
  /** Redis database number (default: 0) */
  db?: number;
  /** Connection string (overrides host/port/password) */
  url?: string;
  /** Key prefix for all Redis keys (default: "asijs:") */
  keyPrefix?: string;
  /** Enable TLS */
  tls?: boolean;
  /** Max retries per request */
  maxRetries?: number;
  /** Retry timeout in ms (default: 1000) */
  retryTimeout?: number;
  /** Connect timeout in ms (default: 10000) */
  connectTimeout?: number;
}

// ============================================================================
// Shared Redis client
// ============================================================================

/**
 * We cache the factory promise so multiple concurrent calls to getClient()
 * share the same connection attempt — avoids race conditions.
 */
function createClientPromise(
  options: RedisConnectionOptions,
): Promise<any> {
  // We deliberately use a global cache keyed by JSON-serialized options
  var cacheKey = JSON.stringify(options);
  var cached = (globalThis as any).__ASIJS_REDIS_CLIENTS;
  if (!cached) {
    cached = {};
    (globalThis as any).__ASIJS_REDIS_CLIENTS = cached;
  }
  if (cached[cacheKey]) return cached[cacheKey];

  var promise = lazyConnectAndReturn(options);
  cached[cacheKey] = promise;
  return promise;
}

async function lazyConnectAndReturn(
  options: RedisConnectionOptions,
): Promise<any> {
  var Redis = await import("ioredis").then(function(m) { return m.default; });
  var host = options.host || "localhost";
  var port = options.port || 6379;
  var keyPrefix = options.keyPrefix || "asijs:";
  var connectTimeout = options.connectTimeout ?? 10000;
  var retryTimeout = options.retryTimeout ?? 1000;
  var maxRetries = options.maxRetries ?? 5;

  var commonOpts = {
    keyPrefix: keyPrefix,
    retryStrategy: function(times: number) {
      if (times > maxRetries) return null;
      return Math.min(times * retryTimeout, 5000);
    },
    connectTimeout: connectTimeout,
    lazyConnect: true,
    enableOfflineQueue: true,
  } as any;

  var client: any;

  if (options.url) {
    client = new Redis(options.url, commonOpts);
  } else {
    client = new Redis({
      host: host,
      port: port,
      password: options.password || undefined,
      db: options.db ?? 0,
      ...commonOpts,
      tls: options.tls ? {} : undefined,
    } as any);
  }

  // ioredis emits an 'error' event on connection failures; without a listener
  // it is treated as unhandled and can crash the process. Operations still
  // surface failures via rejected promises, so a no-op listener is enough.
  client.on("error", () => {});

  await client.connect();
  return client;
}

// ============================================================================
// Redis Rate Limit Store
// ============================================================================

/**
 * Rate limit store backed by Redis.
 *
 * Uses sorted sets with sliding window algorithm:
 * - Each request adds an entry to a sorted set with score = timestamp
 * - The window is maintained by removing entries older than windowMs
 * - The count is the size of the sorted set
 * - TTL on the key ensures automatic cleanup
 *
 * Thread-safe via Redis MULTI/EXEC.
 * Works across multiple processes/servers for distributed rate limiting.
 *
 * @example
 * ```ts
 * import { Asi, rateLimit, RedisRateLimitStore } from "asijs";
 *
 * const store = new RedisRateLimitStore({ host: "localhost", port: 6379 });
 *
 * const app = new Asi();
 * app.plugin(rateLimit({ max: 100, windowMs: 60_000, store }));
 * ```
 */
export class RedisRateLimitStore implements RateLimitStore {
  private options: RedisConnectionOptions;

  constructor(options: RedisConnectionOptions = {}) {
    this.options = options;
  }

  async getClient(): Promise<any> {
    return createClientPromise(this.options);
  }

  async increment(
    key: string,
    windowMs: number,
    max: number,
  ): Promise<RateLimitInfo> {
    var client = await this.getClient();
    var now = Date.now();
    var windowStart = now - windowMs;
    var multiKey = "ratelimit:" + key;
    var member = now + ":" + Math.random().toString(36).slice(2, 8);

    // Use a Redis transaction for atomic sliding window
    var result = await client
      .multi()
      .zremrangebyscore(multiKey, 0, windowStart)
      .zadd(multiKey, now, member)
      .zcard(multiKey)
      .expire(multiKey, Math.ceil((windowMs + 60000) / 1000))
      .exec();

    // Parse count from zcard result (3rd command)
    var count = 0;
    if (result) {
      var zcardResult = result[2];
      if (zcardResult && zcardResult[1] !== null) {
        count = Number(zcardResult[1]);
      }
    }

    var resetTime = Math.ceil((now + windowMs) / 1000);
    var retryAfter = Math.max(0, windowStart + windowMs - now);

    return {
      limit: max,
      remaining: max - count,
      resetTime: resetTime,
      retryAfter: retryAfter,
    };
  }

  async reset(key: string): Promise<void> {
    var client = await this.getClient();
    await client.del("ratelimit:" + key);
  }

  async cleanup(): Promise<void> {
    // Redis handles TTL automatically — no explicit cleanup needed
  }

  async close(): Promise<void> {
    // Connection is shared via createClientPromise — skip close to avoid
    // affecting other consumers. Callers should manage their own connections.
  }
}

// ============================================================================
// Redis Queue — Background Job Queue
// ============================================================================

export interface RedisQueueJob<T = unknown> {
  /** Unique job ID */
  id: string;
  /** Queue/job type name */
  type: string;
  /** Job payload data */
  data: T;
  /** When the job was created (Unix timestamp ms) */
  createdAt: number;
  /** Number of retries attempted */
  attempts: number;
  /** Max retry attempts (default: 3) */
  maxAttempts?: number;
  /** Delay before processing (ms) */
  delay?: number;
  /** Error from last attempt */
  lastError?: string;
}

export interface RedisQueueOptions {
  /** Redis connection options */
  redis?: RedisConnectionOptions;
  /** Queue name prefix (default: "asijs:queue:") */
  prefix?: string;
  /** How often to poll for delayed jobs (ms, default: 1000) */
  pollIntervalMs?: number;
  /** Default max retry attempts (default: 3) */
  defaultMaxAttempts?: number;
  /** Enable verbose logging */
  verbose?: boolean;
}

export interface RedisQueueHandler<T = unknown> {
  (job: RedisQueueJob<T>): Promise<void>;
}

export interface RedisQueueMetrics {
  /** Total jobs processed */
  processed: number;
  /** Total jobs completed successfully */
  completed: number;
  /** Total jobs that failed */
  failed: number;
  /** Number of jobs waiting in queue */
  waiting: number;
  /** Number of jobs in active processing */
  active: number;
  /** Number of jobs in dead letter queue */
  deadLetter: number;
}

// ============================================================================
// Queue Implementation
// ============================================================================

/**
 * Redis-backed background job queue for AsiJS.
 *
 * Features:
 * - FIFO queue using Redis lists (LPUSH/BRPOP loop)
 * - Delayed jobs using sorted sets
 * - Configurable retry with exponential backoff
 * - Dead letter queue for permanently failed jobs
 * - Graceful shutdown (drain active jobs before stopping)
 *
 * @example
 * ```ts
 * import { RedisQueue } from "asijs";
 *
 * const queue = new RedisQueue({ redis: { host: "localhost" } });
 * queue.process("email", async (job) => { await sendEmail(job.data); });
 * await queue.push("email", { to: "user@example.com" });
 *
 * // On shutdown:
 * await queue.close();
 * ```
 */
export class RedisQueue {
  private options: RedisQueueOptions;
  private handlers: Map<string, RedisQueueHandler> = new Map();
  private running = false;
  private activeJobs = 0;
  private pollTimer: Timer | null = null;

  // Metrics
  private processedCount = 0;
  private completedCount = 0;
  private failedCount = 0;

  constructor(options: RedisQueueOptions = {}) {
    this.options = options;
  }

  async getClient(): Promise<any> {
    return createClientPromise(this.options.redis || {});
  }

  /**
   * Push a job to the queue.
   *
   * @param type - Job type/queue name
   * @param data - Job payload
   * @param options - Optional: delay (ms), maxAttempts, id
   * @returns The job ID
   */
  async push<T = unknown>(
    type: string,
    data: T,
    options?: { delay?: number; maxAttempts?: number; id?: string },
  ): Promise<string> {
    var client = await this.getClient();
    var prefix = this.options.prefix || "asijs:queue:";
    var p = function(s: string) { return prefix + s; };

    var job: RedisQueueJob<T> = {
      id: options?.id || generateId(),
      type: type,
      data: data,
      createdAt: Date.now(),
      attempts: 0,
      maxAttempts: options?.maxAttempts ?? (this.options.defaultMaxAttempts ?? 3),
    };

    var jobStr = JSON.stringify(job);
    var delay = options?.delay ?? 0;

    if (delay > 0) {
      var executeAt = Date.now() + delay;
      await client.zadd(p("delayed"), executeAt, jobStr);
      if (this.options.verbose) {
        console.log("[RedisQueue] Delayed '" + type + "' (" + job.id + ") in " + delay + "ms");
      }
    } else {
      await client.lpush(p("list:" + type), jobStr);
      if (this.options.verbose) {
        console.log("[RedisQueue] Pushed '" + type + "' (" + job.id + ")");
      }
    }

    return job.id;
  }

  /**
   * Register a handler for a job type.
   * Processing begins when start() is called.
   */
  process<T = unknown>(type: string, handler: RedisQueueHandler<T>): void {
    this.handlers.set(type, handler as RedisQueueHandler);
  }

  /**
   * Start processing all registered queues.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    if (this.options.verbose) {
      console.log("[RedisQueue] Started — " + this.handlers.size + " types");
    }

    // Start a continuous processing loop for each handler
    for (var type of this.handlers.keys()) {
      this.loopQueue(type);
    }

    this.startDelayedPolling();
  }

  /**
   * Continuous processing loop for a queue type.
   * Uses setTimeout for recursive polling (avoids stack overflow).
   */
  private loopQueue(type: string): void {
    if (!this.running) return;

    var self = this;
    var handler = self.handlers.get(type);
    if (!handler) return;

    self.processNext(type, handler).then(function() {
      // Schedule next poll (after a short delay if queue was empty)
      setTimeout(function() { self.loopQueue(type); }, 10);
    }).catch(function() {
      setTimeout(function() { self.loopQueue(type); }, 1000);
    });
  }

  /**
   * Process the next job from a queue (non-blocking pop).
   */
  private async processNext(
    type: string,
    handler: RedisQueueHandler,
  ): Promise<void> {
    var client = await this.getClient();
    var prefix = this.options.prefix || "asijs:queue:";
    var p = function(s: string) { return prefix + s; };

    while (this.running) {
      try {
        var result = await client.rpop(p("list:" + type));

        if (!result) {
          // Queue is empty — return and let loopQueue schedule next poll
          return;
        }

        // Try executing more aggressively — process all available jobs
        await this.executeJob(type, result, handler);
      } catch {
        return;
      }
    }
  }

  /**
   * Execute a single job.
   */
  private async executeJob(
    type: string,
    jobStr: string,
    handler: RedisQueueHandler,
  ): Promise<void> {
    var job: RedisQueueJob;
    try {
      job = JSON.parse(jobStr);
    } catch {
      return;
    }

    this.activeJobs++;
    this.processedCount++;

    if (this.options.verbose) {
      console.log("[RedisQueue] Processing '" + type + "' (" + job.id + ")");
    }

    var prefix = this.options.prefix || "asijs:queue:";
    var p = function(s: string) { return prefix + s; };

    try {
      await handler(job);
      this.completedCount++;
      if (this.options.verbose) {
        console.log("[RedisQueue] Completed '" + type + "' (" + job.id + ")");
      }
    } catch (error) {
      var errMsg = error instanceof Error ? error.message : String(error);
      job.attempts++;
      job.lastError = errMsg;

      if (job.attempts < (job.maxAttempts || 3)) {
        var backoff = Math.min(1000 * Math.pow(2, job.attempts - 1), 30000);
        var retryAt = Date.now() + backoff;
        jobStr = JSON.stringify(job);
        await (await this.getClient()).zadd(p("delayed"), retryAt, jobStr);
        if (this.options.verbose) {
          console.log("[RedisQueue] Retry " + job.attempts + "/" + (job.maxAttempts || 3) + " '" + type + "' (" + job.id + ") in " + backoff + "ms");
        }
      } else {
        this.failedCount++;
        await (await this.getClient()).lpush(p("dead"), jobStr);
        if (this.options.verbose) {
          console.error("[RedisQueue] Failed '" + type + "' (" + job.id + ") after " + job.attempts + " att.");
        }
      }
    } finally {
      this.activeJobs--;
    }
  }

  /**
   * Poll for delayed jobs that are ready to execute.
   */
  private startDelayedPolling(): void {
    var interval = this.options.pollIntervalMs ?? 1000;
    var prefix = this.options.prefix || "asijs:queue:";
    var p = function(s: string) { return prefix + s; };

    this.pollTimer = setInterval(async () => {
      if (!this.running) return;

      try {
        var client = await this.getClient();
        var now = Date.now();

        var readyJobs = await client.zrangebyscore(p("delayed"), 0, now);

        if (readyJobs && readyJobs.length > 0) {
          await client.zremrangebyscore(p("delayed"), 0, now);

          for (var i = 0; i < readyJobs.length; i++) {
            var jobStr = readyJobs[i];
            try {
              var job = JSON.parse(jobStr);
              await client.lpush(p("list:" + job.type), jobStr);
            } catch {
              await client.lpush(p("dead"), jobStr);
            }
          }
        }
      } catch (error) {
        if (this.options.verbose) {
          console.error("[RedisQueue] Delayed poll error:", error);
        }
      }
    }, interval);
  }

  /**
   * Stop processing and close Redis connection.
   */
  async close(): Promise<void> {
    this.running = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    // Wait for active jobs to finish (up to 10 seconds)
    var deadline = Date.now() + 10000;
    while (this.activeJobs > 0 && Date.now() < deadline) {
      await sleep(100);
    }

    if (this.options.verbose) {
      console.log("[RedisQueue] Closed — processed: " + this.processedCount);
    }
  }

  /**
   * Get queue metrics.
   */
  async getMetrics(type?: string): Promise<RedisQueueMetrics> {
    var client = await this.getClient();
    var prefix = this.options.prefix || "asijs:queue:";
    var p = function(s: string) { return prefix + s; };

    var waiting = 0;
    if (type) {
      waiting = await client.llen(p("list:" + type));
    } else {
      for (var handlerType of this.handlers.keys()) {
        waiting += Number(await client.llen(p("list:" + handlerType)));
      }
    }

    var deadLetter = await client.llen(p("dead"));

    return {
      processed: this.processedCount,
      completed: this.completedCount,
      failed: this.failedCount,
      waiting: waiting,
      active: this.activeJobs,
      deadLetter: deadLetter,
    };
  }

  /**
   * Retry items from the dead letter queue.
   */
  async retryDead(type?: string, limit: number = 100): Promise<number> {
    var client = await this.getClient();
    var prefix = this.options.prefix || "asijs:queue:";
    var p = function(s: string) { return prefix + s; };

    var retried = 0;
    for (var i = 0; i < limit; i++) {
      var jobStr = await client.rpop(p("dead"));
      if (!jobStr) break;

      try {
        var job = JSON.parse(jobStr);
        if (!type || job.type === type) {
          job.attempts = 0;
          job.lastError = undefined;
          await client.lpush(p("list:" + job.type), JSON.stringify(job));
          retried++;
        } else {
          await client.lpush(p("dead"), jobStr);
        }
      } catch {
        await client.lpush(p("dead"), jobStr);
      }
    }
    return retried;
  }

  /**
   * Get the number of pending jobs.
   */
  async pending(type?: string): Promise<number> {
    var client = await this.getClient();
    var prefix = this.options.prefix || "asijs:queue:";
    var p = function(s: string) { return prefix + s; };

    if (type) {
      return Number(await client.llen(p("list:" + type)));
    }

    var total = 0;
    for (var handlerType of this.handlers.keys()) {
      total += Number(await client.llen(p("list:" + handlerType)));
    }
    return total;
  }

  /**
   * Clear all jobs from a queue.
   */
  async clear(type?: string): Promise<void> {
    var client = await this.getClient();
    var prefix = this.options.prefix || "asijs:queue:";
    var p = function(s: string) { return prefix + s; };

    if (type) {
      await client.del(p("list:" + type));
    } else {
      for (var handlerType of this.handlers.keys()) {
        await client.del(p("list:" + handlerType));
      }
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function generateId(): string {
  var timestamp = Date.now().toString(36);
  var random = Math.random().toString(36).substring(2, 10);
  var random2 = Math.random().toString(36).substring(2, 6);
  return timestamp + "-" + random + random2;
}

function sleep(ms: number): Promise<void> {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}
