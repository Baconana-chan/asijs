/**
 * Distributed Tracing — W3C TraceContext propagation through Redis
 *
 * Bridges span events between AsiJS instances via Redis pub/sub, so a
 * request that hops between instances (API → worker → API) keeps a single
 * W3C trace ID. Each span event carries traceId/spanId/parentSpanId.
 *
 * @example
 * ```ts
 * import { Asi, trace, createRedisTraceBridge } from "asijs";
 *
 * const bridge = await createRedisTraceBridge({
 *   url: process.env.REDIS_URL!,
 * });
 *
 * app.plugin(trace({
 *   onResponse: (info) => bridge.emit({
 *     traceId: info.attributes.get("trace.id") ?? generateTraceId(),
 *     spanId: generateSpanId(),
 *     parentSpanId: info.attributes.get("trace.parent_span_id") as string | undefined,
 *     name: `${info.method} ${info.path}`,
 *     status: info.status,
 *     durationMs: info.duration,
 *   }),
 * }));
 * ```
 */

import type { TraceContext } from "./trace";

// ============================================================================
// Types
// ============================================================================

/** Options for the Redis trace bridge */
export interface RedisTraceBridgeOptions {
  /** Redis URL (e.g. "redis://localhost:6379") */
  url: string;
  /** Redis channel name (default: "asijs:trace:span") */
  channel?: string;
  /** Service name attached to emitted spans (default: "asijs-app") */
  serviceName?: string;
}

/** A span event emitted through the bridge */
export interface SpanEvent {
  /** W3C trace ID (32 hex chars) */
  traceId: string;
  /** Span ID (16 hex chars) */
  spanId: string;
  /** Parent span ID (16 hex chars) — links spans across instances */
  parentSpanId?: string;
  /** Span name, e.g. "GET /users" */
  name: string;
  /** HTTP status code (when known) */
  status?: number;
  /** Duration in ms */
  durationMs?: number;
  /** Service that produced the span */
  serviceName?: string;
  /** Extra attributes */
  attributes?: Record<string, unknown>;
  /** ISO timestamp */
  ts?: string;
}

/** Envelope pushed through Redis */
interface TraceEnvelope extends SpanEvent {
  source: string;
}

/** Handler for span events received from other instances */
export type SpanEventHandler = (span: SpanEvent) => void | Promise<void>;

// ============================================================================
// Bridge
// ============================================================================

/**
 * Redis trace bridge — publishes local span events to a Redis channel and
 * forwards span events from other instances to a handler.
 */
export class RedisTraceBridge {
  private pub: any = null;
  private sub: any = null;
  private options: Required<Pick<RedisTraceBridgeOptions, "channel" | "serviceName">> &
    RedisTraceBridgeOptions;
  private instanceId: string;
  private ioredis: any;
  private connected = false;
  private spanHandler: SpanEventHandler | null = null;

  constructor(options: RedisTraceBridgeOptions, ioredis: any) {
    this.options = {
      channel: "asijs:trace:span",
      serviceName: "asijs-app",
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
   * Connect to Redis and subscribe to span events.
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
          const parsed: TraceEnvelope = JSON.parse(message);
          // Skip echoes from this instance
          if (parsed.source === this.instanceId) return;
          const { source: _source, ...span } = parsed;
          void this.spanHandler?.(span);
        } catch {
          // Ignore malformed messages
        }
      });

      this.connected = true;
    } catch (error) {
      console.warn("[RedisTrace] Failed to connect:", error);
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

  /** Register a handler for spans received from other instances */
  onSpan(handler: SpanEventHandler): void {
    this.spanHandler = handler;
  }

  /**
   * Emit a span event — published to Redis for other instances.
   * Local handlers are NOT called (use `onSpan` only for remote spans).
   */
  async emit(span: SpanEvent): Promise<void> {
    if (!this.connected || !this.pub) return;

    const envelope: TraceEnvelope = {
      ...span,
      serviceName: span.serviceName ?? this.options.serviceName,
      source: this.instanceId,
      ts: span.ts ?? new Date().toISOString(),
    };

    try {
      await this.pub.publish(this.options.channel, JSON.stringify(envelope));
    } catch {
      // Ignore publish errors
    }
  }

  /**
   * Check whether a trace context should be propagated to another instance.
   * Returns the incoming context if it's remote, or a fresh one otherwise.
   */
  propagateTraceContext(ctx: TraceContext | null): TraceContext {
    return ctx ?? { traceId: newTraceId(), spanId: newSpanId(), sampled: true };
  }
}

// ============================================================================
// ID helpers
// ============================================================================

/** Generate a 32-hex W3C trace ID */
export function newTraceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Generate a 16-hex span ID */
export function newSpanId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create and connect a Redis trace bridge.
 *
 * Requires the `ioredis` package.
 */
export async function createRedisTraceBridge(
  options: RedisTraceBridgeOptions,
): Promise<RedisTraceBridge> {
  const { ioredis } = await importRedis();
  const bridge = new RedisTraceBridge(options, ioredis);
  await bridge.connect();
  return bridge;
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
      "Redis trace bridge requires 'ioredis' package. Install it with: bun add ioredis",
    );
  }
}
