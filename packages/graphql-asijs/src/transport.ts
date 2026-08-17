/**
 * Transports: HTTP (POST/GET, batched) and WebSocket (graphql-ws protocol).
 *
 * Both take an injected `GraphQLExecutor`, so they are fully testable
 * without the `graphql` package.
 */
import type {
  GraphQLContext,
  GraphQLExecutionResult,
  GraphQLExecutor,
  GraphQLRequestParams,
} from "./types";

// ============================================================================
// HTTP
// ============================================================================

export interface GraphQLHTTPOptions {
  /** Executor (default: provided by the plugin via `createDefaultExecutor`). */
  executor: GraphQLExecutor;
  /** Build per-request context (the Request is always injected). */
  context?: (request: Request) => Record<string, unknown> | undefined;
  /** Allow GET requests (default true). */
  allowGet?: boolean;
  /** Support batched requests (arrays) (default true). */
  allowBatch?: boolean;
  /** Custom error handler for transport-level failures. */
  onError?: (error: Error) => Response;
  /** Verbose logging. */
  verbose?: boolean;
}

interface ParsedRequest {
  queries: Array<GraphQLRequestParams>;
}

function jsonError(message: string, status = 400): Response {
  return new Response(JSON.stringify({ errors: [{ message }] }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function parseBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text) return undefined;
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/graphql")) {
    return { query: text };
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("POST body sent invalid JSON");
  }
}

async function parseRequest(request: Request, options: GraphQLHTTPOptions): Promise<ParsedRequest> {
  const method = request.method.toUpperCase();
  if (method === "GET") {
    if (options.allowGet === false) {
      throw Object.assign(new Error("GET requests are not supported"), { status: 405 });
    }
    const url = new URL(request.url);
    const query = url.searchParams.get("query");
    if (!query) throw new Error("Must provide query string");
    let variables: Record<string, unknown> | undefined;
    const rawVars = url.searchParams.get("variables");
    if (rawVars) {
      try {
        variables = JSON.parse(rawVars) as Record<string, unknown>;
      } catch {
        throw new Error("Variables are invalid JSON");
      }
    }
    return {
      queries: [
        {
          query,
          variables,
          operationName: url.searchParams.get("operationName") ?? undefined,
        },
      ],
    };
  }

  if (method === "POST") {
    const rawBody = await parseBody(request);
    if (Array.isArray(rawBody)) {
      if (options.allowBatch === false) throw new Error("Batched requests are not supported");
      const queries: GraphQLRequestParams[] = [];
      for (const item of rawBody) {
        const op = item as Record<string, unknown> | null;
        if (!op || typeof op.query !== "string") {
          throw new Error("Each batched request must have a query string");
        }
        queries.push({
          query: op.query,
          variables: op.variables as Record<string, unknown> | undefined,
          operationName: op.operationName as string | undefined,
        });
      }
      if (queries.length === 0) throw new Error("No operations in batch");
      return { queries };
    }
    const body = rawBody as Record<string, unknown> | null;
    if (!body || typeof body.query !== "string") {
      throw new Error("Body must contain a query string");
    }
    return {
      queries: [
        {
          query: body.query,
          variables: body.variables as Record<string, unknown> | undefined,
          operationName: body.operationName as string | undefined,
        },
      ],
    };
  }

  throw Object.assign(new Error(`Method ${method} not supported`), { status: 405 });
}

/**
 * Serialize a single execution result, handling async iterables.
 * Returns `"async"` when the result is an AsyncIterable (a subscription) —
 * the caller decides how to represent that over its transport.
 */
async function serializeResult(
  result: Promise<GraphQLExecutionResult> | AsyncIterable<GraphQLExecutionResult>,
): Promise<GraphQLExecutionResult | "async"> {
  if (typeof (result as AsyncIterable<GraphQLExecutionResult>)[Symbol.asyncIterator] === "function") {
    return "async";
  }
  return (await result) as GraphQLExecutionResult;
}

/**
 * Create the GraphQL HTTP handler: `(request) => Promise<Response>`.
 * Handles GET (query params), POST (JSON / application-graphql) and batched
 * POST bodies.
 */
export function createGraphQLHandler(options: GraphQLHTTPOptions): (request: Request) => Promise<Response> {
  const { executor, context, verbose = false } = options;
  return async (request: Request): Promise<Response> => {
    if (verbose) console.log(`[graphql-asijs] ${request.method} ${new URL(request.url).pathname}`);
    try {
      const parsed = await parseRequest(request, options);
      const ctx: GraphQLContext = {
        request,
        ...(context ? context(request) : undefined),
      };

      // Batched
      if (parsed.queries.length > 1) {
        const responses: Array<GraphQLExecutionResult | { errors: [{ message: string }] }> = [];
        for (const q of parsed.queries) {
          try {
            const result = await serializeResult(executor({ ...q, context: ctx }));
            if (result === "async") {
              responses.push({
                errors: [{ message: "Subscriptions must be sent over WebSocket" }],
              });
            } else {
              responses.push(result);
            }
          } catch (error) {
            responses.push({
              errors: [{ message: error instanceof Error ? error.message : String(error) }],
            });
          }
        }
        return new Response(JSON.stringify(responses), {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        });
      }

      const q = parsed.queries[0];
      let serialized: GraphQLExecutionResult | "async";
      try {
        serialized = await serializeResult(executor({ ...q, context: ctx }));
      } catch (error) {
        // Execution errors still answer 200 with { errors } (GraphQL spec)
        return new Response(
          JSON.stringify({
            errors: [{ message: error instanceof Error ? error.message : String(error) }],
          }),
          { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
        );
      }
      if (serialized === "async") {
        return jsonError("Subscriptions must be sent over WebSocket (graphql-over-websocket)");
      }
      return new Response(JSON.stringify(serialized), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    } catch (error) {
      if (options.onError) return options.onError(error as Error);
      const status = (error as { status?: number }).status ?? 400;
      return jsonError(error instanceof Error ? error.message : String(error), status);
    }
  };
}

// ============================================================================
// WebSocket (graphql-ws protocol)
// ============================================================================

export interface GraphQLWSOptions {
  executor: GraphQLExecutor;
  /** Build per-connection context. */
  context?: (ws: unknown) => Record<string, unknown> | undefined;
  /** Keep-alive interval in ms (0 disables) (default 12000). */
  keepAlive?: number;
  /** Run a callback when a subscription completes. */
  onComplete?: (id: string) => void;
  /** Verbose logging. */
  verbose?: boolean;
}

export interface GraphQLWSHandlers {
  open?(ws: unknown): void;
  message?(ws: unknown, message: string | Uint8Array): void | Promise<void>;
  close?(ws: unknown): void;
}

interface WsLike {
  send(payload: string | object): unknown;
  close?(code?: number, reason?: string): unknown;
  data?: unknown;
}

interface ActiveSubscription {
  iterator: AsyncIterator<GraphQLExecutionResult>;
  cancel(): void;
}

/**
 * Create WebSocket handlers implementing the graphql-ws protocol
 * (`connection_init`/`connection_ack`, `subscribe`/`next`/`error`/`complete`,
 * `ping`/`pong`, keep-alive). Returns a plain object shaped for AsiJS
 * `app.ws(path, handlers)`.
 */
export function createGraphQLWSTransport(options: GraphQLWSOptions): GraphQLWSHandlers {
  const { executor, context, keepAlive = 12000, verbose = false } = options;
  const subs = new Map<string, ActiveSubscription>();
  let kaTimer: ReturnType<typeof setInterval> | null = null;
  const acked = new WeakSet<object>();

  function send(ws: WsLike, payload: object): void {
    ws.send(JSON.stringify(payload));
  }

  async function handleSubscribe(ws: WsLike, id: string, payload: Record<string, unknown>): Promise<void> {
    const query = typeof payload.query === "string" ? payload.query : "";
    if (!query) {
      send(ws, { id, type: "error", payload: { message: "subscribe payload must include a query" } });
      return;
    }
    const ctx = {
      request: new Request("http://localhost/graphql/ws", { method: "POST" }),
      ...(context ? context(ws) : undefined),
    } as GraphQLContext;

    let result: Promise<GraphQLExecutionResult> | AsyncIterable<GraphQLExecutionResult>;
    try {
      result = executor({
        query,
        variables: payload.variables as Record<string, unknown> | undefined,
        operationName: payload.operationName as string | undefined,
        context: ctx,
      });
    } catch (error) {
      send(ws, {
        id,
        type: "error",
        payload: { message: error instanceof Error ? error.message : String(error) },
      });
      return;
    }

    // Async iterable → subscription stream
    if (
      result &&
      typeof (result as AsyncIterable<GraphQLExecutionResult>)[Symbol.asyncIterator] === "function"
    ) {
      const iterator = (result as AsyncIterable<GraphQLExecutionResult>)[Symbol.asyncIterator]();
      let cancelled = false;
      const sub: ActiveSubscription = {
        iterator,
        cancel() {
          cancelled = true;
          iterator.return?.().catch(() => {});
        },
      };
      subs.set(id, sub);
      void (async () => {
        try {
          for (;;) {
            const { done, value } = await iterator.next();
            if (done) break;
            if (cancelled) return;
            send(ws, { id, type: "next", payload: value });
          }
          if (!cancelled) send(ws, { id, type: "complete" });
        } catch (error) {
          if (!cancelled) {
            send(ws, {
              id,
              type: "error",
              payload: { message: error instanceof Error ? error.message : String(error) },
            });
          }
        } finally {
          subs.delete(id);
          options.onComplete?.(id);
        }
      })();
      return;
    }

    // Single result → next + complete
    try {
      const value = await result;
      send(ws, { id, type: "next", payload: value });
      send(ws, { id, type: "complete" });
    } catch (error) {
      send(ws, {
        id,
        type: "error",
        payload: { message: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  return {
    open(ws) {
      const w = ws as WsLike;
      // Ack connection immediately (no ack-wait timeout for simplicity)
      send(w, { type: "connection_ack" });
      if (keepAlive > 0 && !kaTimer) {
        kaTimer = setInterval(() => {
          if (!w.send) clearInterval(kaTimer!);
          else send(w, { type: "ka" });
        }, keepAlive);
      }
    },
    async message(ws, raw) {
      const w = ws as WsLike;
      let msg: {
        id?: string;
        type?: string;
        payload?: Record<string, unknown>;
      };
      try {
        msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
      } catch {
        send(w, { type: "error", payload: { message: "invalid JSON" } });
        return;
      }
      if (verbose) console.log(`[graphql-asijs] ws:${msg.type}`);
      switch (msg.type) {
        case "connection_init":
          send(w, { type: "connection_ack" });
          break;
        case "ping":
          send(w, { type: "pong" });
          break;
        case "pong":
          break;
        case "subscribe": {
          if (typeof msg.id !== "string" || !msg.payload) break;
          await handleSubscribe(w, msg.id, msg.payload);
          break;
        }
        case "complete": {
          if (typeof msg.id !== "string") break;
          const sub = subs.get(msg.id);
          if (sub) {
            sub.cancel();
            subs.delete(msg.id);
            options.onComplete?.(msg.id);
          }
          break;
        }
        default:
          if (verbose) console.log(`[graphql-asijs] unknown ws message type: ${msg.type}`);
      }
    },
    close() {
      for (const sub of subs.values()) sub.cancel();
      subs.clear();
      if (kaTimer) {
        clearInterval(kaTimer);
        kaTimer = null;
      }
    },
  };
}
