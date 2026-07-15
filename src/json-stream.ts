/**
 * JSON Streaming & NDJSON for AsiJS
 *
 * Provides memory-efficient streaming of large JSON arrays and
 * newline-delimited JSON (NDJSON / JSONL) responses.
 *
 * Instead of allocating the entire JSON string in memory, data is
 * serialised and sent chunk-by-chunk as a ReadableStream.
 *
 * @example
 * ```ts
 * import { Asi, streamJsonResponse, streamNDJsonResponse } from "asijs";
 *
 * const app = new Asi();
 *
 * // Stream a large array without buffering
 * app.get("/users", (ctx) => ctx.streamJson([
 *   { id: 1, name: "Alice" },
 *   { id: 2, name: "Bob" },
 *   // …thousands more…
 * ]));
 *
 * // Stream from an async generator (paginated DB results)
 * app.get("/stream", (ctx) => ctx.streamJson(asyncUsers()));
 *
 * async function* asyncUsers() {
 *   for await (const batch of queryDb("SELECT * FROM users")) {
 *     for (const row of batch) yield row;
 *   }
 * }
 *
 * // NDJSON — one JSON object per line (logs, events, streaming ETL)
 * app.get("/logs", (ctx) => ctx.streamNDJson(logStream()));
 * ```
 */

// ============================================================================
// Types
// ============================================================================

export interface StreamJsonOptions {
  /** Custom replacer passed to JSON.stringify */
  replacer?: (this: unknown, key: string, value: unknown) => unknown;
  /** Indentation string or number (default: undefined for compact) */
  space?: string | number;
  /** HTTP status code (default: 200) */
  status?: number;
  /** Additional response headers */
  headers?: Record<string, string>;
}

export interface StreamNDJsonOptions {
  /** Custom replacer passed to JSON.stringify */
  replacer?: (this: unknown, key: string, value: unknown) => unknown;
  /** HTTP status code (default: 200) */
  status?: number;
  /** Additional response headers */
  headers?: Record<string, string>;
}

// ============================================================================
// Helpers
// ============================================================================

const encoder = new TextEncoder();

function serializeItem(
  item: unknown,
  replacer?: (this: unknown, key: string, value: unknown) => unknown,
): string {
  // JSON.stringify handles all types: strings, numbers, booleans, null, objects
  return JSON.stringify(item, replacer as any);
}

// ============================================================================
// JSON Array Stream
// ============================================================================

/**
 * Create a ReadableStream that emits a JSON array chunk by chunk.
 *
 * Accepts either a synchronously-known array (iterates eagerly) or an
 * async iterable (streams items as they arrive).
 *
 * The output format is a well-formed JSON array:
 *   [item1,item2,item3,…]
 *
 * @example
 * ```ts
 * // From a sync array
 * const stream = createJsonStream([1, 2, 3]);
 * new Response(stream, {
 *   headers: { "Content-Type": "application/json" },
 * });
 *
 * // From an async generator
 * const stream = createJsonStream(asyncIterable());
 * ```
 */
export function createJsonStream<T = unknown>(
  data: T[] | AsyncIterable<T>,
  options?: { replacer?: (this: unknown, key: string, value: unknown) => unknown },
): ReadableStream<Uint8Array> {
  const replacer = options?.replacer;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Send opening bracket
        controller.enqueue(encoder.encode("["));

        if (Array.isArray(data)) {
          // Sync array — fast path
          const items = data as T[];
          for (let i = 0; i < items.length; i++) {
            if (i > 0) {
              controller.enqueue(encoder.encode(","));
            }
            const json = serializeItem(items[i], replacer);
            controller.enqueue(encoder.encode(json));
          }
        } else {
          // Async iterable — stream as items arrive
          const iter = (data as AsyncIterable<T>)[Symbol.asyncIterator]();
          let first = true;

          while (true) {
            const { done, value } = await iter.next();
            if (done) break;

            if (first) {
              first = false;
            } else {
              controller.enqueue(encoder.encode(","));
            }
            const json = serializeItem(value, replacer);
            controller.enqueue(encoder.encode(json));
          }
        }

        // Send closing bracket
        controller.enqueue(encoder.encode("]"));
        controller.close();
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        controller.error(error);
      }
    },
  });
}

/**
 * Create a HTTP Response that streams a JSON array.
 *
 * @example
 * ```ts
 * app.get("/users", (ctx) => {
 *   return streamJsonResponse(allUsers);
 * });
 * ```
 */
export function streamJsonResponse<T = unknown>(
  data: T[] | AsyncIterable<T>,
  options: StreamJsonOptions = {},
): Response {
  const stream = createJsonStream(data, { replacer: options.replacer });

  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  headers.set("X-Content-Type-Options", "nosniff");
  // Disable buffering so data reaches the client immediately
  headers.set("Cache-Control", "no-cache");

  return new Response(stream, {
    status: options.status ?? 200,
    headers,
  });
}

// ============================================================================
// NDJSON Stream (Newline-Delimited JSON)
// ============================================================================

/**
 * Create a ReadableStream that emits NDJSON (newline-delimited JSON).
 *
 * Each item is serialised and followed by `\n`, producing output like:
 *   {"id":1}\n{"id":2}\n{"id":3}\n
 *
 * Accepts both sync arrays and async iterables.
 *
 * @example
 * ```ts
 * const stream = createNDJsonStream([
 *   { id: 1, name: "Alice" },
 *   { id: 2, name: "Bob" },
 * ]);
 * ```
 */
export function createNDJsonStream<T = unknown>(
  data: AsyncIterable<T> | Iterable<T>,
  options?: { replacer?: (this: unknown, key: string, value: unknown) => unknown },
): ReadableStream<Uint8Array> {
  const replacer = options?.replacer;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Try async iterable first
        const maybeAsync = data as AsyncIterable<T>;
        const asyncIter = maybeAsync[Symbol.asyncIterator]
          ? maybeAsync[Symbol.asyncIterator]()
          : null;

        if (asyncIter) {
          // Async iterable
          while (true) {
            const { done, value } = await asyncIter.next();
            if (done) break;
            const json = serializeItem(value, replacer);
            controller.enqueue(encoder.encode(json + "\n"));
          }
        } else {
          // Sync iterable (array, Set, etc.)
          const sync = data as Iterable<T>;
          for (const item of sync) {
            const json = serializeItem(item, replacer);
            controller.enqueue(encoder.encode(json + "\n"));
          }
        }

        controller.close();
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        controller.error(error);
      }
    },
  });
}

/**
 * Create a HTTP Response that streams NDJSON (newline-delimited JSON).
 *
 * Content-Type is set to `application/x-ndjson`.
 *
 * @example
 * ```ts
 * app.get("/logs", (ctx) => {
 *   return streamNDJsonResponse([
 *     { level: "info", msg: "started" },
 *     { level: "warn", msg: "high memory" },
 *   ]);
 * });
 * ```
 */
export function streamNDJsonResponse<T = unknown>(
  data: AsyncIterable<T> | Iterable<T>,
  options: StreamNDJsonOptions = {},
): Response {
  const stream = createNDJsonStream(data, { replacer: options.replacer });

  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/x-ndjson");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Cache-Control", "no-cache");

  return new Response(stream, {
    status: options.status ?? 200,
    headers,
  });
}
