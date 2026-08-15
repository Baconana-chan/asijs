/**
 * asijs-mcp — HTTP & SSE transports (AsiJS plugin)
 *
 * Mounts the MCP server on an existing AsiJS application:
 *
 * - `POST {path}`          — JSON-RPC over JSON (single message or batch)
 * - `POST {path}/stream`   — JSON-RPC with SSE-streamed responses
 * - `GET  {path}/sse`      — SSE stream (endpoint discovery + notifications)
 * - `GET  {path}/health`   — health check
 *
 * Optional Bearer-token auth and per-IP token-bucket rate limiting are
 * applied to all MCP endpoints via AsiJS middleware.
 */

import { createPlugin } from "asijs";
import type { AsiPlugin } from "asijs";
import type { MCPServer } from "../server";
import type { JSONRPCNotification } from "../types";

export interface MCPHTTPOptions {
  /** Mount path (default: "/mcp") */
  path?: string;
  /** Require `Authorization: Bearer <token>` on all MCP endpoints */
  authToken?: string;
  /** Rate limit MCP requests: { max, windowMs } (token bucket per client) */
  rateLimit?: { max: number; windowMs: number };
  /** Custom rate-limit key (default: x-forwarded-for / x-real-ip / "local") */
  rateLimitKey?: (request: Request) => string;
  /** Enable the SSE endpoints (default: true) */
  enableSSE?: boolean;
}

function sseEvent(event: string, data: unknown, rawData = false): string {
  const payload = rawData ? String(data) : JSON.stringify(data);
  return `event: ${event}\ndata: ${payload}\n\n`;
}

const sseHeaders = (): Headers =>
  new Headers({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

export function createMCPPlugin(server: MCPServer, options: MCPHTTPOptions = {}): AsiPlugin {
  const path = options.path ?? "/mcp";
  const authToken = options.authToken;
  const rateLimitCfg = options.rateLimit;
  const enableSSE = options.enableSSE ?? true;

  return createPlugin({
    name: "asijs-mcp",

    setup(app) {
      // ===== Auth middleware =====
      if (authToken) {
        app.use(path, async (ctx: any, next: () => Promise<unknown>) => {
          const authorization = ctx.request.headers.get("authorization");
          if (authorization !== `Bearer ${authToken}`) {
            return ctx.status(401).jsonResponse({ error: "Unauthorized" });
          }
          return next();
        });
      }

      // ===== Rate limit middleware (token bucket per client) =====
      if (rateLimitCfg) {
        const buckets = new Map<string, { tokens: number; last: number }>();
        const { max, windowMs } = rateLimitCfg;
        app.use(path, async (ctx: any, next: () => Promise<unknown>) => {
          const key = options.rateLimitKey?.(ctx.request) ??
            ctx.request.headers.get("x-forwarded-for") ??
            ctx.request.headers.get("x-real-ip") ??
            "local";

          const now = Date.now();
          let bucket = buckets.get(key);
          if (!bucket) {
            bucket = { tokens: max, last: now };
            buckets.set(key, bucket);
          }
          // Refill tokens proportional to elapsed time
          bucket.tokens = Math.min(max, bucket.tokens + ((now - bucket.last) / windowMs) * max);
          bucket.last = now;

          if (bucket.tokens < 1) {
            return ctx.status(429).jsonResponse({ error: "Too Many Requests" });
          }
          bucket.tokens -= 1;
          return next();
        });
      }

      // ===== SSE notification fan-out =====
      if (enableSSE) {
        const sessions = new Map<string, ReadableStreamDefaultController<Uint8Array>>();
        const encoder = new TextEncoder();
        const unsubscribe = server.onNotification((n: JSONRPCNotification) => {
          const frame = encoder.encode(sseEvent("message", n));
          for (const controller of sessions.values()) {
            try {
              controller.enqueue(frame);
            } catch {
              // Session closed — ignore
            }
          }
        });

        // GET {path}/sse — SSE stream with endpoint discovery
        app.get(`${path}/sse`, (ctx: any) => {
          const url = new URL(ctx.request.url);
          const sessionId = crypto.randomUUID();
          const endpoint = `${url.origin}${path}/stream?sessionId=${sessionId}`;

          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              sessions.set(sessionId, controller);
              controller.enqueue(encoder.encode(sseEvent("endpoint", endpoint, true)));
            },
            cancel() {
              sessions.delete(sessionId);
            },
          });

          return new Response(stream, { headers: sseHeaders() });
        });

        // POST {path}/stream?sessionId=... — push messages to a session
        app.post(`${path}/stream`, async (ctx: any) => {
          const url = new URL(ctx.request.url);
          const sessionId = url.searchParams.get("sessionId");
          const controller = sessionId ? sessions.get(sessionId) : undefined;
          if (!controller) {
            return ctx.status(404).jsonResponse({ error: "Session not found" });
          }

          const body = await ctx.json();
          const responses = await server.handleRaw(body);
          if (responses !== null) {
            const list = Array.isArray(responses) ? responses : [responses];
            for (const response of list) {
              try {
                controller.enqueue(encoder.encode(sseEvent("message", response)));
              } catch {
                break;
              }
            }
          }
          return ctx.status(202).jsonResponse({ accepted: true });
        });

        // Keep unsubscribe reference to avoid unused-var lint
        void unsubscribe;
      }

      // ===== POST {path} — JSON-RPC over JSON =====
      app.post(path, async (ctx: any) => {
        let body: unknown;
        try {
          body = await ctx.json();
        } catch {
          return ctx.status(400).jsonResponse({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: "Parse error" },
          });
        }

        const responses = await server.handleRaw(body);
        if (responses === null) {
          return ctx.status(202).jsonResponse({ accepted: true });
        }
        return responses;
      });

      // ===== GET {path}/health =====
      app.get(`${path}/health`, () => ({
        status: "ok",
        server: server.name,
        version: server.version,
        tools: server.toolNames.length,
      }));
    },
  });
}

/** Convenience: mount a server's HTTP transport onto its bound app */
export function mountHTTP(server: MCPServer, options: MCPHTTPOptions = {}): AsiPlugin {
  const plugin = createMCPPlugin(server, options);
  const app = server.runtimeBridge.appInstance;
  if (app && typeof app.plugin === "function") {
    (app as { plugin(p: AsiPlugin): unknown }).plugin(plugin);
  }
  return plugin;
}
