/**
 * Redis Pub-Sub Bridge for AsiJS WebSocket
 *
 * Allows broadcasting messages across multiple AsiJS instances
 * via Redis Pub/Sub. When one instance broadcasts a message,
 * it's forwarded to all subscribed instances.
 *
 * @example
 * ```ts
 * import { Asi, createRoomManager, createRedisPubSub } from "asijs";
 *
 * const rooms = createRoomManager();
 * const redisPubSub = await createRedisPubSub({
 *   url: process.env.REDIS_URL || "redis://localhost:6379",
 *   roomManager: rooms,
 * });
 *
 * app.ws("/chat", {
 *   open(ws) { ws.join("general"); },
 *   message(ws, msg) {
 *     ws.broadcast({ type: "chat", text: msg.toString() });
 *   },
 * });
 *
 * // When this instance broadcasts via rooms, it's also published to Redis.
 * // All other instances subscribed to the same Redis channel receive it.
 * ```
 */

import type { RoomManager } from "./ws-pubsub";

// ============================================================================
// Types
// ============================================================================

/** Redis connection config for the pub-sub bridge */
export interface RedisPubSubOptions {
  /** Redis URL (e.g., "redis://localhost:6379") */
  url: string;
  /** Room manager instance to bridge */
  roomManager: RoomManager;
  /** Redis channel name for messages (default: "asijs:ws:broadcast") */
  channel?: string;
  /**
   * Whether messages from this instance should be re-broadcast locally.
   * Set to false if you handle local broadcast separately (default: false).
   */
  echoMessages?: boolean;
}

/** Message envelope for cross-instance broadcast */
interface PubSubMessage {
  /** Type: "broadcast" */
  type: "broadcast";
  /** JSON payload */
  payload: string;
  /** Target rooms (empty = all) */
  rooms?: string[];
  /** Instance ID that sent this (to avoid echo) */
  instanceId: string;
  /** Timestamp */
  ts: number;
}

// ============================================================================
// Redis Pub-Sub Bridge
// ============================================================================

/**
 * Creates a Redis pub-sub bridge for cross-instance WebSocket messaging.
 *
 * When a message is broadcast via the RoomManager, it's also published
 * to a Redis channel. All other instances subscribed to that channel
 * receive and re-broadcast the message locally.
 *
 * @example
 * ```ts
 * const bridge = await createRedisPubSub({
 *   url: process.env.REDIS_URL!,
 *   roomManager: rooms,
 * });
 * ```
 */
export async function createRedisPubSub(
  options: RedisPubSubOptions,
): Promise<RedisPubSubBridge> {
  const { ioredis } = await importRedis();
  const bridge = new RedisPubSubBridge(options, ioredis);
  await bridge.connect();
  return bridge;
}

/**
 * Redis Pub-Sub bridge instance.
 */
export class RedisPubSubBridge {
  private pub: any = null;
  private sub: any = null;
  private options: RedisPubSubOptions;
  private instanceId: string;
  private ioredis: any;
  private connected = false;

  constructor(options: RedisPubSubOptions, ioredis: any) {
    this.options = {
      echoMessages: false,
      channel: "asijs:ws:broadcast",
      ...options,
    };
    this.instanceId = crypto.randomUUID().slice(0, 8);
    this.ioredis = ioredis;
  }

  /**
   * Connect to Redis and set up pub/sub.
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    try {
      this.pub = new this.ioredis(this.options.url);
      this.sub = new this.ioredis(this.options.url);

      // Subscribe to channel
      await this.sub.subscribe(this.options.channel);

      // Handle incoming messages from Redis
      this.sub.on("message", (channel: string, message: string) => {
        if (channel !== this.options.channel) return;

        try {
          const parsed: PubSubMessage = JSON.parse(message);

          // Skip messages from this instance (no echo)
          if (parsed.instanceId === this.instanceId) return;

          // Re-broadcast locally
          this.options.roomManager.broadcast(
            parsed.payload,
            parsed.rooms ? { rooms: parsed.rooms } : undefined,
          );
        } catch {
          // Ignore parse errors
        }
      });

      this.connected = true;

      // Listen for broadcasts from the room manager and forward to Redis
      this.hookRoomManager();
    } catch (error) {
      console.warn("[RedisPubSub] Failed to connect:", error);
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

  /**
   * Check if connected to Redis.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Publish a message to Redis (for manual use).
   */
  async publish(payload: string, rooms?: string[]): Promise<void> {
    if (!this.connected || !this.pub) return;

    const message: PubSubMessage = {
      type: "broadcast",
      payload,
      rooms,
      instanceId: this.instanceId,
      ts: Date.now(),
    };

    try {
      await this.pub.publish(this.options.channel, JSON.stringify(message));
    } catch {
      // Ignore publish errors
    }
  }

  /**
   * Hook into the room manager to forward local broadcasts to Redis.
   * We monkey-patch the broadcast method to also publish to Redis.
   */
  private hookRoomManager(): void {
    const manager = this.options.roomManager;
    const originalBroadcast = manager.broadcast.bind(manager);
    const bridge = this;

    manager.broadcast = function (data: unknown, options?: { rooms?: string[]; exclude?: any }) {
      // First, do the local broadcast
      originalBroadcast(data, options);

      // Then publish to Redis
      const payload = typeof data === "string" ? data : JSON.stringify(data);
      bridge.publish(payload, options?.rooms).catch(() => {});
    };
  }
}

// ============================================================================
// Lazy Redis Import
// ============================================================================

/**
 * Lazy import ioredis (only when Redis pub-sub is used).
 */
async function importRedis(): Promise<{ ioredis: any }> {
  try {
    const mod = await import("ioredis");
    return { ioredis: mod.default || mod };
  } catch {
    throw new Error(
      "Redis pub-sub requires 'ioredis' package. Install it with: bun add ioredis",
    );
  }
}
