/**
 * Node.js Server Adapter for AsiJS
 *
 * Implements the ServerAdapter interface using Node.js built-in http/https modules.
 * Requires Node.js 18+ (fetch API available globally).
 *
 * EADDRINUSE handling: Node.js fires it asynchronously via the `error` event,
 * unlike Bun.serve() which throws synchronously. The adapter handles this
 * internally — if the requested port is busy, it automatically retries on the
 * next port (up to autoPortRange attempts). The server starts on the first
 * available port, and the port is readable from the handle's `port` property.
 *
 * @example
 * ```ts
 * import { Asi } from "asijs";
 * import { nodeAdapter } from "asijs/node";
 *
 * const app = new Asi({ serverAdapter: nodeAdapter() });
 * app.get("/", () => "Hello from Node.js!");
 * app.listen(3000);
 * ```
 */

import type { Asi } from "../../asi";
import type { ServerAdapter, ServerAdapterConfig, ServerHandle } from "../types";

// Lazy-loaded module references — initialized on first use
let httpModule: typeof import("http") | null = null;
let httpsModule: typeof import("https") | null = null;

// WebSocket module (ws package) — optional, lazy loaded
let wsModule: typeof import("ws") | null = null;

let initPromise: Promise<void> | null = null;

/**
 * Initialize HTTP modules. Safe to call multiple times.
 * Returns immediately if already initialized.
 */
function ensureHttp(): Promise<void> {
  if (httpModule && httpsModule) return Promise.resolve();
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const [http, https] = await Promise.all([
        import("http") as Promise<typeof import("http")>,
        import("https") as Promise<typeof import("https")>,
      ]);
      httpModule = http;
      httpsModule = https;
    } catch (err) {
      initPromise = null; // Reset so next call retries
      throw err;
    }
  })();

  return initPromise;
}

/** Try to load the optional ws module (non-fatal if not available) */
async function ensureWs(): Promise<boolean> {
  if (wsModule) return true;
  try {
    wsModule = await import("ws") as typeof import("ws");
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if HTTP modules are loaded and ready for sync createServer().
 * If false, call await ensureHttp() before listen().
 */
export function isHttpReady(): boolean {
  return httpModule !== null && httpsModule !== null;
}

/** Simple path matching for WebSocket routes (supports :param) */
function matchWsPath(pattern: string, path: string): boolean {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return false;
  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i];
    if (pp.startsWith(":")) continue;
    if (pp !== pathParts[i]) return false;
  }
  return true;
}

/** Convert a Node.js IncomingMessage + body Buffer to a Web API Request */
function nodeReqToWebRequest(
  req: import("http").IncomingMessage,
  body: Buffer | null,
): Request {
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${host}`);
  const headers = new Headers();

  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    headers.append(req.rawHeaders[i], req.rawHeaders[i + 1]);
  }

  const init: RequestInit & { duplex?: string } = {
    method: req.method ?? "GET",
    headers,
  };

  if (body != null && body.length > 0) {
    // duplex: "half" is required for ReadableStream bodies in Node 18+
    // Node 21+ no longer requires it, but including it is harmless
    init.duplex = "half";
    // Buffer → Uint8Array (compatible with BodyInit in Node 18+)
    init.body = new Uint8Array(body);
  }

  return new Request(url, init as RequestInit);
}

/** Stream a Web API Response to a Node.js ServerResponse */
async function writeWebResponse(
  res: import("http").ServerResponse,
  webResponse: Response,
): Promise<void> {
  res.statusCode = webResponse.status;
  if (webResponse.statusText) {
    res.statusMessage = webResponse.statusText;
  }

  webResponse.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  if (webResponse.body) {
    try {
      const reader = webResponse.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) res.write(value);
      }
    } catch {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("Internal Server Error");
        return;
      }
    }
  }

  res.end();
}

/** Collect the body from a Node.js IncomingMessage with size limit */
function collectBody(
  req: import("http").IncomingMessage,
  maxBodySize: number,
): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;

    req.on("data", (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > maxBodySize) {
        reject(new Error(`Request body exceeds maximum size of ${maxBodySize} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      resolve(chunks.length > 0 ? Buffer.concat(chunks) : null);
    });

    req.on("error", reject);
  });
}

/**
 * Set up WebSocket upgrade handling on a Node.js HTTP server.
 * Uses the `ws` package (lazy-loaded, optional dependency).
 * Handles path matching, beforeUpgrade checks, and event delegation.
 *
 * The upgrade handler is registered unconditionally (no early return if ws
 * module isn't loaded yet) — the ws module is lazy-loaded inside the async
 * handler on the first upgrade request. This avoids a race between the
 * fire-and-forget ensureWs() call in nodeAdapter() and the synchronous
 * createServer() call.
 */
function setupWebSocketUpgrade(
  server: import("http").Server,
  routes: NonNullable<ServerAdapterConfig["webSocketRoutes"]>,
): void {
  // Only register upgrade handler once per server instance
  if ((server as any).__wsUpgradeRegistered) return;
  (server as any).__wsUpgradeRegistered = true;

  // Lazy WSS — created on first upgrade after ws module is loaded
  let wss: import("ws").WebSocketServer | null = null;

  server.on("upgrade", async (req, socket, head) => {
    // Lazy-load ws module on first upgrade request
    if (!wsModule) {
      const loaded = await ensureWs();
      if (!loaded) {
        socket.destroy();
        return;
      }
    }

    // Lazily create WSS once ws module is confirmed loaded
    if (!wss) {
      wss = new (wsModule!.WebSocketServer)({ noServer: true });
    }

    const url = new URL(
      req.url || "/",
      `http://${req.headers.host || "localhost"}`,
    );

    // Find matching route
    const route = routes.find((r) => matchWsPath(r.path, url.pathname));
    if (!route) {
      socket.destroy();
      return;
    }

    // Run beforeUpgrade check if configured
    if (route.beforeUpgrade) {
      const webRequest = nodeReqToWebRequest(req, null);
      try {
        const allowed = await route.beforeUpgrade(webRequest);
        if (!allowed) {
          socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
          socket.destroy();
          return;
        }
      } catch {
        socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
        socket.destroy();
        return;
      }
    }

    // Upgrade using the ws package
    wss.handleUpgrade(req, socket, head, (ws) => {
      const handlers = route.handlers;
      if (!handlers) return;

      // Emit open event
      handlers.open?.(ws);

      // Attach event listeners
      ws.on("message", (data: any) => {
        handlers.message?.(ws, data);
      });

      ws.on("close", (code: number, reason: string) => {
        handlers.close?.(ws, code, reason);
      });

      ws.on("error", (error: Error) => {
        handlers.error?.(ws, error);
      });
    });
  });
}

/**
 * Create a Node.js ServerAdapter.
 *
 * HTTP modules are lazily loaded on first request. For most use cases this
 * completes instantly (<1ms). If createServer() is called before modules load,
 * it throws with a clear message — call `await ensureHttp()` before `listen()`.
 *
 * EADDRINUSE handling: the adapter retries on higher ports automatically.
 * Since Node.js fires EADDRINUSE asynchronously, the retry is also async.
 * The returned server handle's `port` property dynamically reads the actual
 * port from the underlying Node.js server, so it's always correct.
 *
 * @param options  TLS configuration and body size limit
 */
export function nodeAdapter(options: {
  tls?: {
    key: string | Buffer;
    cert: string | Buffer;
    ca?: string | Buffer;
  };
  maxBodySize?: number;
} = {}): ServerAdapter {
  // Start loading HTTP and WebSocket modules immediately (non-blocking)
  ensureHttp();
  ensureWs(); // Fire-and-forget; upgrade handler has fallback if not yet loaded

  return {
    name: "node",

    createServer(
      _app: Asi,
      config: ServerAdapterConfig,
      handleRequest: (request: Request) => Promise<Response>,
    ): ServerHandle {
      const isSecure = !!(options.tls || config.tls);
      const tlsConfig = options.tls ?? config.tls;
      const bodyLimit =
        config.maxRequestBodySize ?? options.maxBodySize ?? 128 * 1024 * 1024;
      const hostname = config.hostname ?? "0.0.0.0";
      const maxAttempts = config.autoPort ? (config.autoPortRange ?? 10) : 1;

      // Request listener shared across retry attempts
      const requestListener = (
        req: import("http").IncomingMessage,
        res: import("http").ServerResponse,
      ) => {
        collectBody(req, bodyLimit)
          .then((body) => {
            const request = nodeReqToWebRequest(req, body);
            return handleRequest(request);
          })
          .then((response) => writeWebResponse(res, response))
          .catch((err) => {
            if (!res.headersSent) {
              res.statusCode = 500;
              res.setHeader("Content-Type", "text/plain; charset=utf-8");
              res.end("Internal Server Error");
            }
          });
      };

      // Ensure modules are loaded
      const httpMod = httpModule;
      const httpsMod = httpsModule;
      if (!httpMod || !httpsMod) {
        throw new Error(
          "Node.js http/https modules not yet loaded. " +
            "This is a race condition — call `await ensureHttp()` before `listen()`, " +
            "or use the default Bun server.",
        );
      }

      // Module for creating servers (http vs https)
      const mod = isSecure ? httpsMod : httpMod;

      // State shared across async retries
      let nodeServer: import("http").Server | null = null;
      let attemptCount = 0;
      let serverListening = false;
      let lastPort = config.port;

      /**
       * Try to listen on a given port. If EADDRINUSE, retry on the next port.
       * Node.js fires EADDRINUSE asynchronously, so retries are also async.
       */
      const tryListen = (port: number) => {
        attemptCount++;
        lastPort = port;

        // Close previous server if this is a retry
        if (nodeServer) {
          // Detach old listeners to prevent stale callbacks
          nodeServer.removeAllListeners("error");
          nodeServer.removeAllListeners("listening");
          try {
            nodeServer.close();
          } catch (closeErr) {
            console.warn(
              `[Asi Node Adapter] Error closing previous server on port ${port}:`,
              closeErr,
            );
          }
        }

        const serverOptions: Record<string, unknown> = {};
        if (tlsConfig) {
          serverOptions.key = tlsConfig.key;
          serverOptions.cert = tlsConfig.cert;
          if (tlsConfig.ca) serverOptions.ca = tlsConfig.ca;
        }

        nodeServer = (mod as typeof import("http")).createServer(
          serverOptions as any,
          requestListener,
        );

        // Handle EADDRINUSE — retry on next port
        nodeServer.once("error", (err: NodeJS.ErrnoException) => {
          if (err.code === "EADDRINUSE" && attemptCount < maxAttempts) {
            // Async retry on next port
            const nextPort = config.port + attemptCount;
            tryListen(nextPort);
          } else {
            // Non-retriable error — just log it
            // (can't throw sync from async handler)
            console.error(`[Asi Node Adapter] Server error on port ${port}:`, err.message);
          }
        });

        // Update our state when the server actually starts
        nodeServer.once("listening", () => {
          serverListening = true;
          const addr = nodeServer!.address();
          if (addr && typeof addr === "object") {
            lastPort = addr.port;
          }
        });

        // Set up WebSocket upgrade handling if routes are configured
        if (config.webSocketRoutes && config.webSocketRoutes.length > 0) {
          setupWebSocketUpgrade(nodeServer, config.webSocketRoutes);
        }

        // Start listening (async — EADDRINUSE fires via 'error' event)
        nodeServer.listen(port, hostname);
      };

      // Kick off the first attempt
      tryListen(config.port);

      // Return a ServerHandle with a dynamic port getter.
      // The port reads from server.address() after listening event fires,
      // otherwise returns the last attempted port.
      return {
        get port(): number {
          if (nodeServer) {
            try {
              const addr = nodeServer.address();
              if (addr && typeof addr === "object") {
                return addr.port;
              }
            } catch {
              // server might be closed/errored
            }
          }
          return lastPort;
        },
        hostname,
        stop: () => {
          nodeServer?.close();
          nodeServer = null;
        },
      } as ServerHandle;
    },
  };
}

export { ensureHttp };
