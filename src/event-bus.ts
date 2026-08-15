/**
 * EventBus — shared state bus for AsiJS Workspace
 *
 * In-memory pub/sub between sub-apps inside one Workspace process, plus an
 * optional Redis bridge for cross-process / cross-instance communication.
 *
 * @example
 * ```ts
 * import { EventBus, createRedisEventBus } from "asijs";
 *
 * // In-memory only
 * const bus = new EventBus();
 * bus.on("order.created", (order) => console.log("New order:", order.id));
 * bus.emit("order.created", { id: 1, total: 99 });
 *
 * // With Redis bridge (cross-instance)
 * const bus2 = await createRedisEventBus({ url: "redis://localhost:6379" });
 * // bus2.on(...) / bus2.emit(...) — shared across all instances on the channel
 * ```
 *
 * Workspace integration:
 * ```ts
 * const ws = new Workspace({ bus });
 * // Each sub-app gets the bus via app.getState("eventBus")
 * ```
 */

// ============================================================================
// Types
// ============================================================================

/** Event handler — sync or async */
export type EventHandler<T = unknown> = (
  payload: T,
  meta: EventMeta,
) => void | Promise<void>;

/** Metadata passed to every handler */
export interface EventMeta {
  /** Topic the event was emitted on */
  topic: string;
  /** Source instance id (for Redis cross-instance) */
  source: string;
  /** Epoch ms timestamp */
  ts: number;
  /** True when the event came from another instance via Redis */
  remote: boolean;
}

/** Options for the in-memory bus */
export interface EventBusOptions {
  /** Instance name — used as `source` in meta (default: auto-generated) */
  name?: string;
  /** Cap on stored handler count per topic (default: 1000, protects from leaks) */
  maxHandlersPerTopic?: number;
}

/** Options for the Redis bridge */
export interface RedisEventBusOptions {
  /** Redis URL (e.g. "redis://localhost:6379") */
  url: string;
  /** Redis channel name (default: "asijs:event-bus") */
  channel?: string;
  /**
   * Whether events published by this instance should also be delivered to
   * local handlers. Default: true (local emit + remote delivery).
   */
  echoLocal?: boolean;
}

/** Envelope pushed through Redis */
interface RedisEnvelope {
  topic: string;
  payload: unknown;
  source: string;
  ts: number;
}

/** Snapshot of bus stats (for the workspace dashboard) */
export interface EventBusStats {
  /** Instance name */
  name: string;
  /** Number of unique topics with at least one handler */
  topics: number;
  /** Total handler registrations */
  handlers: number;
  /** Total events emitted (local + remote) */
  emitted: number;
  /** Whether the Redis bridge is connected */
  redisConnected: boolean;
  /** Redis channel (when bridged) */
  redisChannel?: string;
}

// ============================================================================
// EventBus
// ============================================================================

/**
 * Shared state bus for AsiJS Workspace.
 *
 * Emits events to local handlers and — when bridged to Redis — to handlers
 * on every other instance subscribed to the same channel.
 */
export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();
  private options: Required<EventBusOptions>;
  private emitted = 0;
  private redisBridge: RedisEventBusBridge | null = null;

  constructor(options: EventBusOptions = {}) {
    this.options = {
      name: options.name ?? `bus-${crypto.randomUUID().slice(0, 8)}`,
      maxHandlersPerTopic: options.maxHandlersPerTopic ?? 1000,
    };
  }

  /** Instance name */
  get name(): string {
    return this.options.name;
  }

  /**
   * Subscribe to a topic.
   *
   * @returns Unsubscribe function
   */
  on<T = unknown>(topic: string, handler: EventHandler<T>): () => void {
    let set = this.handlers.get(topic);
    if (!set) {
      set = new Set();
      this.handlers.set(topic, set);
    }

    // Guard against handler leaks
    if (set.size >= this.options.maxHandlersPerTopic) {
      throw new Error(
        `EventBus: too many handlers (${set.size}) for topic "${topic}". ` +
          "Use off()/unsubscribe to release handlers.",
      );
    }

    set.add(handler as EventHandler);
    return () => this.off(topic, handler as EventHandler);
  }

  /**
   * Subscribe to a topic once — auto-unsubscribes after the first delivery.
   */
  once<T = unknown>(topic: string, handler: EventHandler<T>): () => void {
    const wrapped: EventHandler<T> = (payload, meta) => {
      this.off(topic, wrapped);
      return handler(payload, meta);
    };
    return this.on(topic, wrapped);
  }

  /**
   * Remove a handler from a topic.
   */
  off<T = unknown>(topic: string, handler: EventHandler<T>): void {
    const set = this.handlers.get(topic);
    if (!set) return;
    set.delete(handler as EventHandler);
    if (set.size === 0) {
      this.handlers.delete(topic);
    }
  }

  /**
   * Emit an event to local handlers and — when bridged — to Redis.
   *
   * Handlers are invoked synchronously (async handlers are awaited in
   * `emitAsync`). Use `emitAsync` when you need to await them.
   */
  emit<T = unknown>(topic: string, payload: T): void {
    const meta: EventMeta = {
      topic,
      source: this.options.name,
      ts: Date.now(),
      remote: false,
    };
    this.deliver(topic, payload, meta);

    // Forward to Redis for cross-instance delivery
    this.redisBridge?.publish(topic, payload, this.options.name).catch(() => {});
  }

  /**
   * Emit an event and await all (async) handlers.
   */
  async emitAsync<T = unknown>(topic: string, payload: T): Promise<void> {
    const meta: EventMeta = {
      topic,
      source: this.options.name,
      ts: Date.now(),
      remote: false,
    };
    await this.deliverAsync(topic, payload, meta);
    await this.redisBridge?.publish(topic, payload, this.options.name);
  }

  /** Deliver to local handlers (sync) */
  private deliver<T>(topic: string, payload: T, meta: EventMeta): void {
    this.emitted++;
    const set = this.handlers.get(topic);
    if (!set) return;
    for (const handler of set) {
      const result = handler(payload, meta);
      // Fire-and-forget async handlers (use emitAsync to await)
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch((err) => {
          console.error(`[EventBus] handler error on "${topic}":`, err);
        });
      }
    }
  }

  /** Deliver to local handlers (async-aware) */
  private async deliverAsync<T>(topic: string, payload: T, meta: EventMeta): Promise<void> {
    this.emitted++;
    const set = this.handlers.get(topic);
    if (!set) return;
    for (const handler of set) {
      await handler(payload, meta);
    }
  }

  /** Deliver an event received from Redis (remote) */
  private deliverRemote(topic: string, payload: unknown, source: string, ts: number): void {
    this.deliver(topic, payload, {
      topic,
      source,
      ts,
      remote: true,
    });
  }

  /** Attach a Redis bridge (internal) */
  _attachRedis(bridge: RedisEventBusBridge): void {
    this.redisBridge = bridge;
    bridge.onRemote((topic, payload, source, ts) => {
      this.deliverRemote(topic, payload, source, ts);
    });
  }

  /** Detach the Redis bridge (internal) */
  _detachRedis(): void {
    this.redisBridge = null;
  }

  /** Remove all handlers (for tests / teardown) */
  clear(): void {
    this.handlers.clear();
  }

  /** Snapshot of bus stats — used by the workspace dashboard */
  stats(): EventBusStats {
    return {
      name: this.options.name,
      topics: this.handlers.size,
      handlers: Array.from(this.handlers.values()).reduce(
        (sum, set) => sum + set.size,
        0,
      ),
      emitted: this.emitted,
      redisConnected: this.redisBridge?.isConnected() ?? false,
      redisChannel: this.redisBridge?.channel,
    };
  }

  /** Check if any handler is registered for a topic */
  has(topic: string): boolean {
    return this.handlers.has(topic) && this.handlers.get(topic)!.size > 0;
  }
}

// ============================================================================
// Redis Bridge
// ============================================================================

/**
 * Redis pub/sub bridge for EventBus.
 *
 * Lazily imports `ioredis` — the package must be installed to use the bridge.
 */
export class RedisEventBusBridge {
  private pub: any = null;
  private sub: any = null;
  private options: Required<Pick<RedisEventBusOptions, "channel" | "echoLocal">> &
    RedisEventBusOptions;
  private instanceId: string;
  private ioredis: any;
  private connected = false;
  private remoteHandler: ((
    topic: string,
    payload: unknown,
    source: string,
    ts: number,
  ) => void) | null = null;

  constructor(options: RedisEventBusOptions, ioredis: any) {
    this.options = {
      channel: "asijs:event-bus",
      echoLocal: true,
      ...options,
    };
    this.instanceId = crypto.randomUUID().slice(0, 8);
    this.ioredis = ioredis;
  }

  /** Channel name */
  get channel(): string {
    return this.options.channel;
  }

  /**
   * Connect to Redis and start the subscription.
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    try {
      this.pub = new this.ioredis(this.options.url);
      this.sub = new this.ioredis(this.options.url);

      await this.sub.subscribe(this.options.channel);

      this.sub.on("message", (channel: string, message: string) => {
        if (channel !== this.options.channel) return;
        try {
          const parsed: RedisEnvelope = JSON.parse(message);
          // Skip events from this instance (no echo through Redis)
          if (parsed.source === this.instanceId) return;
          this.remoteHandler?.(parsed.topic, parsed.payload, parsed.source, parsed.ts);
        } catch {
          // Ignore malformed messages
        }
      });

      this.connected = true;
    } catch (error) {
      console.warn("[EventBus:Redis] Failed to connect:", error);
      this.connected = false;
    }
  }

  /**
   * Disconnect from Redis.
   */
  async disconnect(): Promise<void> {
    this.connected = false;
    try {
      if (this.sub) {
        await this.sub.unsubscribe(this.options.channel);
        await this.sub.quit();
      }
      if (this.pub) {
        await this.pub.quit();
      }
    } catch {
      // Ignore disconnect errors
    }
  }

  /** Whether the bridge is connected */
  isConnected(): boolean {
    return this.connected;
  }

  /** Register the callback for remote events (called by EventBus) */
  onRemote(
    handler: (topic: string, payload: unknown, source: string, ts: number) => void,
  ): void {
    this.remoteHandler = handler;
  }

  /**
   * Publish an event to Redis for other instances.
   */
  async publish(topic: string, payload: unknown, source: string): Promise<void> {
    if (!this.connected || !this.pub) return;

    const envelope: RedisEnvelope = {
      topic,
      payload,
      source: this.instanceId,
      ts: Date.now(),
    };

    try {
      await this.pub.publish(this.options.channel, JSON.stringify(envelope));
    } catch {
      // Ignore publish errors
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an EventBus with a connected Redis bridge.
 *
 * Requires the `ioredis` package.
 *
 * @example
 * ```ts
 * const bus = await createRedisEventBus({ url: process.env.REDIS_URL! });
 * bus.on("deploy", (d) => console.log(d));
 * bus.emit("deploy", { app: "api", version: "1.4.0" });
 * ```
 */
export async function createRedisEventBus(
  options: RedisEventBusOptions,
): Promise<EventBus> {
  const { ioredis } = await importRedis();
  const bus = new EventBus();
  const bridge = new RedisEventBusBridge(options, ioredis);
  bus._attachRedis(bridge);
  await bridge.connect();
  return bus;
}

// ============================================================================
// Lazy Redis Import
// ============================================================================

async function importRedis(): Promise<{ ioredis: any }> {
  try {
    const mod = await import("ioredis");
    return { ioredis: mod.default || mod };
  } catch {
    throw new Error(
      "EventBus Redis bridge requires 'ioredis' package. Install it with: bun add ioredis",
    );
  }
}
