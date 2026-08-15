/**
 * asijs-mcp — stdio transport
 *
 * Line-delimited JSON-RPC over stdin/stdout — the primary transport for
 * Claude Desktop, Cursor, Zed, Continue.dev and other MCP clients.
 *
 * Per the spec: messages are newline-delimited JSON, no embedded newlines.
 * All diagnostics go to stderr; stdout carries only JSON-RPC messages.
 */

import type { MCPServer } from "../server";

/** Structural stream interface (accepts Node streams, Bun streams, mocks) */
export interface StreamLike {
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  on(event: "end", listener: () => void): unknown;
  write(chunk: string, encodingOrCb?: BufferEncoding | (() => void), cb?: () => void): unknown;
  removeListener?(event: string, listener: (...args: unknown[]) => void): unknown;
}

export interface StdioTransportOptions {
  /** Input stream (default: process.stdin) */
  input?: StreamLike;
  /** Output stream (default: process.stdout) */
  output?: StreamLike;
  /** Diagnostic log channel (default: console.error) */
  log?: (line: string) => void;
  /** Enable verbose logging of every message */
  debug?: boolean;
}

export class StdioTransport {
  private server: MCPServer;
  private options: {
    input: StreamLike;
    output: StreamLike;
    log: (line: string) => void;
    debug: boolean;
  };
  private buffer = "";
  private _started = false;
  private stopped = false;
  private onData: ((chunk: Buffer | string) => void) | null = null;
  private onEnd: (() => void) | null = null;

  constructor(server: MCPServer, options: StdioTransportOptions = {}) {
    this.server = server;
    this.options = {
      input: options.input ?? (process.stdin as unknown as StreamLike),
      output: options.output ?? (process.stdout as unknown as StreamLike),
      log: options.log ?? ((line: string) => console.error(line)),
      debug: options.debug ?? false,
    };
  }

  get started(): boolean {
    return this._started;
  }

  start(): this {
    if (this._started) return this;
    this._started = true;

    this.onData = (chunk) => {
      this.buffer += chunk.toString();
      // Messages are newline-delimited — process complete lines
      let newlineIndex: number;
      while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
        const line = this.buffer.slice(0, newlineIndex).trim();
        this.buffer = this.buffer.slice(newlineIndex + 1);
        if (line.length > 0) {
          void this.handleLine(line);
        }
      }
    };

    this.onEnd = () => {
      this.stop();
    };

    this.options.input.on("data", this.onData);
    this.options.input.on("end", this.onEnd);

    return this;
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this._started = false;
    try {
      this.options.input.removeListener?.("data", this.onData as (...args: unknown[]) => void);
      this.options.input.removeListener?.("end", this.onEnd as (...args: unknown[]) => void);
    } catch {
      // Stream may already be destroyed
    }
  }

  private async handleLine(line: string): Promise<void> {
    if (this.options.debug) this.options.log(`[asijs-mcp:stdio] << ${line}`);

    let responses;
    try {
      responses = await this.server.handleRaw(line);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.send({ jsonrpc: "2.0", id: null, error: { code: -32603, message } });
      return;
    }

    if (responses === null) return;
    const list = Array.isArray(responses) ? responses : [responses];
    for (const response of list) {
      this.send(response);
    }
  }

  private send(message: unknown): void {
    const line = JSON.stringify(message);
    if (this.options.debug) this.options.log(`[asijs-mcp:stdio] >> ${line}`);
    this.options.output.write(`${line}\n`);
  }
}
