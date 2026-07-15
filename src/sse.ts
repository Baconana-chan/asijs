/**
 * Server-Sent Events (SSE) for AsiJS
 *
 * Provides server-side event streaming and a client-side helper.
 *
 * @example Server
 * ```ts
 * import { Asi, sse } from "asijs";
 *
 * const app = new Asi();
 *
 * // Using sse() handler wrapper
 * app.get("/events", sse((send) => {
 *   const timer = setInterval(() => {
 *     send({ message: "tick", timestamp: Date.now() });
 *   }, 1000);
 *   return () => clearInterval(timer);
 * }));
 *
 * app.listen(3000);
 * ```
 *
 * @example Client
 * ```ts
 * import { createSSEClient } from "asijs";
 *
 * const events = createSSEClient("http://localhost:3000/events");
 *
 * events.on("message", (data) => {
 *   console.log("Received:", data);
 * });
 *
 * events.on("connected", () => {
 *   console.log("Connected!");
 * });
 * ```
 */

import type { Context } from "./context";

// ===== Types =====

/** Options for sse() handler wrapper */
export interface SSEOptions {
  /** Custom event ID generator */
  idGenerator?: () => string;

  /**
   * Reconnection time in milliseconds.
   * Sent as `retry:` field to the client.
   * @default 3000
   */
  retry?: number;

  /**
   * Send an initial comment to verify the connection.
   * @default true
   */
  initialComment?: boolean;
}

/** A single SSE event to be sent */
export interface SSEEvent {
  /** Event type (e.g., "message", "error", "update") */
  type?: string;
  /** Event data (automatically JSON-stringified if object) */
  data: unknown;
  /** Event ID (for Last-Event-ID) */
  id?: string;
}

/** SSE client event callback */
export type SSEClientCallback = (data: unknown, event?: MessageEvent) => void;

/** Callback emitted when a client connects (for manual controller) */
export type SSEConnectCallback = (controller: SSEController) => void;

/**
 * Internal SSE event for the stream controller.
 */
interface InternalSSEEvent {
  type?: string;
  data: string;
  id?: string;
}

// ===== Server-Side: SSEController =====

/**
 * Controller for managing an SSE stream.
 *
 * Provides `send()`, `close()`, and `toResponse()` to create
 * a proper HTTP response with `text/event-stream` content type.
 *
 * @example
 * ```ts
 * app.get("/stream", (ctx) => {
 *   const sse = new SSEController();
 *
 *   const timer = setInterval(() => {
 *     sse.send({ time: Date.now() });
 *   }, 1000);
 *
 *   return sse.toResponse(() => clearInterval(timer));
 * });
 * ```
 */
export class SSEController {
  private controller: ReadableStreamDefaultController<string> | null = null;
  private encoder = new TextEncoder();
  private lastId: string | null = null;
  private retry: number;
  private _closed = false;

  // Callbacks for cleanup
  private cleanupFns: (() => void)[] = [];

  constructor(options: SSEOptions = {}) {
    this.retry = options.retry ?? 3000;
  }

  /**
   * Send an event to the client.
   *
   * @param event Event data or SSEEvent object
   * @param eventType Optional event type (shorthand)
   */
  send(event: unknown, eventType?: string): void {
    if (this._closed || !this.controller) return;

    // Normalize to SSEEvent
    const sseEvent = this.normalizeEvent(event, eventType);

    // Build the SSE message
    let message = "";

    // Retry directive (sent once or when changed)
    if (sseEvent.type) {
      message += `event: ${sseEvent.type}\n`;
    }

    // Event ID
    if (sseEvent.id) {
      message += `id: ${sseEvent.id}\n`;
      this.lastId = sseEvent.id;
    }

    // Data: split multi-line data properly
    const dataStr = String(sseEvent.data);
    const lines = dataStr.split("\n");
    for (const line of lines) {
      message += `data: ${line}\n`;
    }

    // End of event
    message += "\n";

    try {
      this.controller.enqueue(message);
    } catch {
      // Stream closed
      this._closed = true;
    }
  }

  /**
   * Close the SSE stream.
   */
  close(): void {
    if (this._closed) return;
    this._closed = true;
    this.runCleanup();
    try {
      this.controller?.close();
    } catch {
      // Already closed
    }
  }

  /**
   * Create a Response object for this SSE stream.
   *
   * @param onClose Optional cleanup callback when connection closes
   * @returns Response with text/event-stream content type
   */
  toResponse(onClose?: () => void): Response {
    if (onClose) {
      this.cleanupFns.push(onClose);
    }

    // Send retry directive
    const retryBanner = `retry: ${this.retry}\n\n`;

    const stream = new ReadableStream({
      start: (controller) => {
        this.controller = controller;

        // Enqueue retry directive
        controller.enqueue(retryBanner);
      },
      cancel: () => {
        this._closed = true;
        this.runCleanup();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  /** Get the last event ID sent */
  get lastEventId(): string | null {
    return this.lastId;
  }

  /** Check if the stream is closed */
  get closed(): boolean {
    return this._closed;
  }

  private normalizeEvent(
    event: unknown,
    eventType?: string,
  ): InternalSSEEvent {
    if (typeof event === "string" || typeof event === "number" || typeof event === "boolean" || event === null) {
      return {
        type: eventType,
        data: String(event),
      };
    }

    if (eventType) {
      // Shorthand: eventType is the type, event is the data
      return {
        type: eventType,
        data: typeof event === "object" ? JSON.stringify(event) : String(event),
      };
    }

    // Full SSEEvent object
    const sseEvent = event as SSEEvent;
    return {
      type: sseEvent.type,
      data:
        typeof sseEvent.data === "object"
          ? JSON.stringify(sseEvent.data)
          : String(sseEvent.data),
      id: sseEvent.id,
    };
  }

  private runCleanup(): void {
    for (const fn of this.cleanupFns) {
      try {
        fn();
      } catch {
        // Ignore cleanup errors
      }
    }
    this.cleanupFns = [];
  }
}

// ===== Server-Side: sse() handler wrapper =====

/**
 * Create an SSE endpoint handler.
 *
 * The callback receives a `send` function and an optional cleanup
 * return. The handler automatically sets up the SSEController and
 * returns the proper Response.
 *
 * @example
 * ```ts
 * app.get("/clock", sse((send) => {
 *   const timer = setInterval(() => {
 *     send({ time: Date.now() });
 *   }, 1000);
 *   return () => clearInterval(timer);
 * }));
 * ```
 */
export function sse(
  handler: (
    send: (data: unknown, type?: string) => void,
    ctx: Context,
  ) => void | (() => void),
  options: SSEOptions = {},
) {
  return (ctx: Context): Response => {
    // Create controller (handler can access Last-Event-ID via ctx.header)
    const controller = new SSEController(options);

    // Call the handler with send function
    const cleanup = handler(
      (data: unknown, type?: string) => controller.send(data, type),
      ctx,
    );

    // Register cleanup
    return controller.toResponse(cleanup ?? undefined);
  };
}

// ===== Client-Side: createSSEClient =====

/** Options for createSSEClient */
export interface SSEClientOptions {
  /** Custom fetch implementation */
  fetch?: typeof fetch;
  /** Custom headers */
  headers?: Record<string, string>;
  /** Reconnection delay in ms (default: 3000) */
  retry?: number;
  /** Maximum number of reconnection attempts (default: Infinity) */
  maxRetries?: number;
  /** Whether to automatically reconnect (default: true) */
  autoReconnect?: boolean;
}

/** SSE client event map */
export interface SSEClientEvents {
  /** Generic message (any event type not explicitly handled) */
  message: (data: unknown, event?: { type?: string; id?: string; data: unknown }) => void;
  /** Connection opened */
  open: () => void;
  /** Connection closed */
  close: (code?: number) => void;
  /** Error occurred */
  error: (error: Error) => void;
  /** Named event types */
  [eventType: string]: (...args: any[]) => void;
}

/**
 * Client-side SSE helper.
 *
 * Connects to an SSE endpoint using fetch with streaming response,
 * parses SSE events, and emits them to registered callbacks.
 * Supports auto-reconnect with Last-Event-ID.
 *
 * @example
 * ```ts
 * const events = createSSEClient("http://localhost:3000/events");
 *
 * // Listen for all messages
 * events.on("message", (data) => console.log("Data:", data));
 *
 * // Listen for specific event types
 * events.on("update", (data) => console.log("Update:", data));
 *
 * // Connection lifecycle
 * events.on("open", () => console.log("Connected"));
 * events.on("error", (err) => console.error("Error:", err));
 *
 * // Close when done
 * setTimeout(() => events.close(), 5000);
 * ```
 */
export function createSSEClient(
  url: string,
  options: SSEClientOptions = {},
) {
  const {
    fetch: customFetch,
    headers = {},
    retry: retryOption = 3000,
    maxRetries = Infinity,
    autoReconnect = true,
  } = options;

  const callbacks = new Map<string, Set<(...args: any[]) => void>>();
  let abortController: AbortController | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  let lastEventId: string | null = null;
  let closed = false;

  /**
   * Register an event listener.
   *
   * @param event Event type ("message", "open", "close", "error", or custom type)
   * @param callback Function to call when event is received
   */
  function on(event: string, callback: (...args: any[]) => void): void {
    if (!callbacks.has(event)) {
      callbacks.set(event, new Set());
    }
    callbacks.get(event)!.add(callback);
  }

  /**
   * Remove an event listener.
   */
  function off(event: string, callback: (...args: any[]) => void): void {
    callbacks.get(event)?.delete(callback);
  }

  /**
   * Emit an event to all registered listeners.
   */
  function emit(event: string, ...args: any[]): void {
    callbacks.get(event)?.forEach((cb) => {
      try {
        cb(...args);
      } catch {
        // Ignore callback errors
      }
    });
  }

  /**
   * Parse a single SSE data chunk.
   * SSE format:
   *   event: <type>\n
   *   data: <payload>\n
   *   id: <id>\n
   *   retry: <ms>\n
   *   \n  (empty line = end of event)
   */
  function parseSSEChunk(chunk: string): void {
    const lines = chunk.split("\n");
    let currentEvent: {
      event?: string;
      data?: string;
      id?: string;
    } = {};

    for (const line of lines) {
      if (line.startsWith("event:")) {
        currentEvent.event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        const dataStr = line.slice(5);
        // Check for empty data or just whitespace
        if (dataStr.trim() || dataStr === "") {
          currentEvent.data = (currentEvent.data ?? "") + dataStr + "\n";
        }
      } else if (line.startsWith("id:")) {
        currentEvent.id = line.slice(3).trim();
        lastEventId = currentEvent.id;
      } else if (line.startsWith("retry:")) {
        // retry is handled by the client - we don't change our options dynamically
      } else if (line === "") {
        // Empty line = end of event
        if (currentEvent.data !== undefined) {
          // Trim trailing newline from data
          const dataStr = currentEvent.data.replace(/\n$/, "");
          let parsedData: unknown = dataStr;

          // Try to parse as JSON
          try {
            parsedData = JSON.parse(dataStr);
          } catch {
            // Keep as string
          }

          const eventType = currentEvent.event ?? "message";

          emit(eventType, parsedData, {
            type: currentEvent.event,
            id: currentEvent.id,
            data: parsedData,
          });

          // Also emit "message" for all events
          if (eventType !== "message") {
            emit("message", parsedData, {
              type: currentEvent.event,
              id: currentEvent.id,
              data: parsedData,
            });
          }
        }
        currentEvent = {};
      }
      // Lines starting with ":" are comments, ignore
    }
  }

  /**
   * Connect to the SSE endpoint.
   * Called automatically on creation and on reconnect.
   */
  async function connect(): Promise<void> {
    if (closed) return;

    abortController = new AbortController();
    const fetchFn = customFetch ?? fetch;

    try {
      const requestHeaders: Record<string, string> = {
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
        ...headers,
      };

      // Send Last-Event-ID for reconnection
      if (lastEventId) {
        requestHeaders["Last-Event-ID"] = lastEventId;
      }

      const response = await fetchFn(url, {
        headers: requestHeaders,
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(
          `SSE connection failed: ${response.status} ${response.statusText}`,
        );
      }

      // Reset reconnect attempts on successful connection
      reconnectAttempts = 0;

      // Emit open event
      emit("open");

      // Read the stream
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("SSE response has no body");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Split by double newlines (SSE event boundary)
        const parts = buffer.split("\n\n");
        // Last part may be incomplete
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          if (part.trim()) {
            parseSSEChunk(part + "\n\n");
          }
        }
      }

      // Stream ended (server closed connection)
      if (!closed) {
        emit("close");
        scheduleReconnect();
      }
    } catch (error: any) {
      if (error.name === "AbortError") {
        // Intentional abort — do nothing
        return;
      }

      if (!closed) {
        emit("error", error instanceof Error ? error : new Error(String(error)));
        emit("close");
        scheduleReconnect();
      }
    }
  }

  /**
   * Schedule an automatic reconnection.
   */
  function scheduleReconnect(): void {
    if (!autoReconnect || closed) return;
    if (reconnectAttempts >= maxRetries) {
      emit("error", new Error(`Max retries (${maxRetries}) reached`));
      return;
    }

    reconnectAttempts++;

    // Exponential backoff
    const delay = Math.min(retryOption * Math.pow(1.5, reconnectAttempts - 1), 30000);

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  /**
   * Close the SSE connection and stop reconnecting.
   */
  function close(): void {
    closed = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    abortController?.abort();
    abortController = null;
    emit("close");
  }

  // Start connection immediately
  connect();

  return { on, off, close, connect };
}
