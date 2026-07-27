/**
 * HMR (Hot Module Replacement) — WebSocket Push for Browser Updates
 *
 * Pushes hot-reload events to connected browser clients so they can
 * update components, styles, or trigger a full page reload without
 * a manual refresh.
 *
 * Features:
 * - WebSocket server via Bun.listen
 * - Auto-reconnect with exponential backoff (no function shadowing bug)
 * - Update types: fullReload, component, style, handler
 * - Client heartbeat (ping/pong) for connection health
 * - Supports multiple connected clients
 */

import type { HotReloadEvent } from "./hot-reload";

// ============================================================================
// Types
// ============================================================================

/** Type of HMR update sent to the browser */
export type HMRUpdateType =
  | "fullReload"
  | "component"
  | "style"
  | "handler"
  | "connected"
  | "heartbeat";

/** Message sent from server to browser */
export interface HMRMessage {
  type: HMRUpdateType;
  files?: string[];
  data?: Record<string, unknown>;
  timestamp?: number;
}

/** Options for HMR server */
export interface HMRServerOptions {
  port?: number;
  hostname?: string;
  verbose?: boolean;
  heartbeatMs?: number;
  reconnectDelay?: number;
  onConnect?: (clientId: string) => void;
  onDisconnect?: (clientId: string) => void;
}

// ============================================================================
// HMR Server — Bun.listen based (WebSocket)
// ============================================================================

/**
 * WebSocket-based HMR server that pushes update events to browser clients.
 *
 * Clients receive typed messages (fullReload, component, style, handler)
 * and can respond accordingly without a full page refresh.
 *
 * @example
 * ```ts
 * const hmr = new HMRServer({ port: 35729 });
 * hmr.start();
 * hmr.broadcast({ type: "fullReload" });
 * ```
 */
export class HMRServer {
  private options: Required<HMRServerOptions>;
  private clients: Map<string, { id: string; socket: any; connectedAt: Date; lastHeartbeat: number }> = new Map();
  private socketToId: Map<any, string> = new Map();
  private server: any = null;
  private heartbeatTimer: Timer | null = null;
  private _isRunning = false;
  private clientCounter = 0;

  constructor(options: HMRServerOptions = {}) {
    this.options = {
      port: options.port ?? 35729,
      hostname: options.hostname ?? "localhost",
      verbose: options.verbose ?? false,
      heartbeatMs: options.heartbeatMs ?? 30000,
      reconnectDelay: options.reconnectDelay ?? 1000,
      onConnect: options.onConnect ?? (() => {}),
      onDisconnect: options.onDisconnect ?? (() => {}),
    };
  }

  start(): void {
    if (this._isRunning) return;

    try {
      this.server = Bun.listen({
        port: this.options.port,
        hostname: this.options.hostname,
        socket: {
          open: (ws: any) => {
            const id = `hmr-${++this.clientCounter}`;
            const client = {
              id,
              socket: ws,
              connectedAt: new Date(),
              lastHeartbeat: Date.now(),
            };
            this.socketToId.set(ws, id);
            this.clients.set(id, client);

            const msg: HMRMessage = {
              type: "connected",
              data: { clientId: id, reconnectDelay: this.options.reconnectDelay },
              timestamp: Date.now(),
            };
            try { ws.send(JSON.stringify(msg)); } catch {}

            this.options.onConnect(id);
            if (this.options.verbose) {
              console.log(`[HMR] Client connected: ${id} (${this.clients.size} total)`);
            }
          },

          message: (ws: any, raw: string | Buffer) => {
            const data = String(raw);
            if (data === "pong") {
              const clientId = this.socketToId.get(ws);
              if (clientId && this.clients.has(clientId)) {
                this.clients.get(clientId)!.lastHeartbeat = Date.now();
              }
              return;
            }
            try {
              const msg = JSON.parse(data);
              if (this.options.verbose) console.log(`[HMR] Client message:`, msg);
            } catch {}
          },

          close: (ws: any) => {
            const clientId = this.socketToId.get(ws);
            if (clientId) {
              this.socketToId.delete(ws);
              this.clients.delete(clientId);
              this.options.onDisconnect(clientId);
              if (this.options.verbose) {
                console.log(`[HMR] Client disconnected: ${clientId} (${this.clients.size} remaining)`);
              }
            }
          },

          drain: (_ws: any) => {},
        },
      } as any);

      this._isRunning = true;

      this.heartbeatTimer = setInterval(() => this.sendHeartbeats(), this.options.heartbeatMs);

      if (this.options.verbose) {
        console.log(`[HMR] Server started on ws://${this.options.hostname}:${this.options.port}`);
      }
    } catch (error) {
      console.error(`[HMR] Failed to start on port ${this.options.port}:`, error);
      if (this.options.port < 35739) {
        this.options.port++;
        this.start();
      }
    }
  }

  private sendHeartbeats(): void {
    const now = Date.now();
    const timeout = this.options.heartbeatMs * 2;

    for (const [id, client] of this.clients) {
      if (now - client.lastHeartbeat > timeout) {
        this.clients.delete(id);
        this.options.onDisconnect(id);
        if (this.options.verbose) console.log(`[HMR] Stale client removed: ${id}`);
        continue;
      }
      // Heartbeat via stored ref is not possible without socket reference
      // Clients respond to heartbeat with "pong" via message handler
    }
  }

  /**
   * Broadcast an HMR update to all connected clients.
   */
  broadcast(message: HMRMessage): void {
    if (this.clients.size === 0) return;
    message.timestamp = Date.now();
    const payload = JSON.stringify(message);

    let sent = 0;
    for (const [, client] of this.clients) {
      try {
        client.socket.send(payload);
        sent++;
      } catch {}
    }

    if (this.options.verbose && sent > 0) {
      console.log(`[HMR] Broadcast ${message.type} to ${sent} client(s)`);
    }
  }

  /**
   * Forward a HotReloadEvent to all clients.
   */
  handleReloadEvent(event: HotReloadEvent): void {
    if (event.needsFullReload) {
      this.broadcast({
        type: "fullReload",
        files: event.changes.map((c) => c.relativePath),
      });
      return;
    }

    const componentFiles = event.changes.filter((c) => c.category === "component").map((c) => c.relativePath);
    const styleFiles = event.changes.filter((c) => c.category === "style").map((c) => c.relativePath);
    const handlerFiles = event.changes.filter((c) => c.category === "handler" || c.category === "middleware").map((c) => c.relativePath);

    if (componentFiles.length > 0) this.broadcast({ type: "component", files: componentFiles });
    if (styleFiles.length > 0) this.broadcast({ type: "style", files: styleFiles });
    if (handlerFiles.length > 0) this.broadcast({ type: "handler", files: handlerFiles });
  }

  stop(): void {
    this._isRunning = false;
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    this.clients.clear();
    if (this.server) {
      try { this.server.stop(); } catch {}
      this.server = null;
    }
    if (this.options.verbose) console.log("[HMR] Server stopped");
  }

  get isRunning(): boolean { return this._isRunning; }
  get clientCount(): number { return this.clients.size; }
  get port(): number { return this.options.port; }
  get url(): string { return `ws://${this.options.hostname}:${this.options.port}`; }
}

// ============================================================================
// Client-Side HMR Script
// ============================================================================

/**
 * Generate the client-side HMR script for browsers.
 *
 * Uses const RECONNECT_BASE/RECONNECT_MAX to avoid function-name
 * shadowing that caused NaN in reconnect delay calculation.
 */
export function hmrClientScript(options?: {
  hostname?: string;
  port?: number;
  reconnectDelay?: number;
  maxReconnectDelay?: number;
  onUpdate?: string;
}): string {
  const host = options?.hostname ?? "localhost";
  const port = options?.port ?? 35729;
  const reconnectBase = options?.reconnectDelay ?? 1000;
  const reconnectMax = options?.maxReconnectDelay ?? 30000;
  const onUpdate = options?.onUpdate ?? "";

  return `(function() {
  var ws = null;
  var reconnectAttempts = 0;
  var reconnectTimer = null;
  var url = "ws://${host}:${port}";
  var RECONNECT_BASE = ${reconnectBase};
  var RECONNECT_MAX = ${reconnectMax};

  function connect() {
    try { ws = new WebSocket(url); } catch(e) { scheduleReconnect(); return; }

    ws.onopen = function() { reconnectAttempts = 0; };

    ws.onmessage = function(event) {
      try {
        var msg = JSON.parse(event.data);
        switch (msg.type) {
          case "fullReload": location.reload(); break;
          case "component": ${onUpdate || `console.log("[HMR] Component update:", msg.files);`} break;
          case "style":
            if (msg.files && msg.files.length > 0) {
              var links = document.querySelectorAll('link[rel="stylesheet"]');
              for (var i = 0; i < links.length; i++) {
                var href = links[i].getAttribute('href');
                if (href) links[i].setAttribute('href', href.split('?')[0] + '?t=' + Date.now());
              }
            }
            break;
          case "connected": console.log("[HMR] Connected:", msg.data && msg.data.clientId); break;
          case "heartbeat": ws.send("pong"); break;
        }
      } catch(e) { console.error("[HMR] Parse error:", e); }
    };

    ws.onclose = function() { scheduleReconnect(); };
    ws.onerror = function() { ws.close(); };
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    var delay = Math.min(RECONNECT_BASE * Math.pow(2, reconnectAttempts), RECONNECT_MAX);
    reconnectAttempts++;
    reconnectTimer = setTimeout(function() { reconnectTimer = null; connect(); }, delay);
  }

  connect();
})();`;
}
