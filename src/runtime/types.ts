/**
 * Runtime abstraction for AsiJS
 *
 * Defines interfaces for pluggable HTTP servers (Bun, Node.js, etc.)
 */

import type { Asi } from "../asi";

/** Configuration passed to the server adapter */
export interface ServerAdapterConfig {
  port: number;
  hostname?: string;
  tls?: {
    key?: string | Buffer | Array<string | Buffer>;
    cert?: string | Buffer | Array<string | Buffer>;
    ca?: string | Buffer | Array<string | Buffer>;
    passphrase?: string;
  };
  reusePort?: boolean;
  maxRequestBodySize?: number;
  idleTimeout?: number;
  lowMemoryMode?: boolean;

  /** Auto-port fallback — try next port if requested port is in use */
  autoPort?: boolean;
  /** How many ports to try before giving up (default: 10) */
  autoPortRange?: number;

  /** WebSocket routes for upgrade handling (Node.js adapter) */
  webSocketRoutes?: Array<{
    path: string;
    beforeUpgrade?: (request: Request) => boolean | Promise<boolean>;
    /** WebSocket event handlers passed through from Asi.ws() */
    handlers?: {
      open?: (ws: any) => void | Promise<void>;
      message?: (ws: any, data: any) => void | Promise<void>;
      close?: (ws: any, code: number, reason: string) => void | Promise<void>;
      error?: (ws: any, error: Error) => void | Promise<void>;
    };
  }>;
}

/** Server adapter interface — pluggable HTTP server backends */
export interface ServerAdapter {
  /** Adapter name for display/debugging */
  name: string;

  /**
   * Create an HTTP server that handles requests using the given fetch handler.
   * Returns a ServerHandle with port, stop(), etc.
   * Note: this is called synchronously from Asi.listen(), so it MUST return
   * immediately. For async setup (e.g., dynamic imports), use lazy init or
   * check typeof Bun !== "undefined" before calling.
   */
  createServer(
    app: Asi,
    config: ServerAdapterConfig,
    handleRequest: (request: Request) => Promise<Response>,
  ): ServerHandle;
}

/** Runtime detection result */
export type RuntimeName = "bun" | "node";

/** Unified server handle returned by Asi.listen() */
export interface ServerHandle {
  port: number;
  hostname?: string;
  stop(): void;
  /** Whether the server is currently running */
  running?: boolean;
}
