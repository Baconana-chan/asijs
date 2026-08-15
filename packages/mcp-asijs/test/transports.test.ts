/**
 * Tests: stdio transport and HTTP/SSE plugin transport (auth, rate limit).
 */

import { describe, expect, it } from "bun:test";
import { Readable } from "node:stream";
import { Asi } from "../../../src/index.ts";
import {
  MCPServer,
  StdioTransport,
  createMCPPlugin,
  createMCPServer,
  type StreamLike,
} from "../src/index";

class CollectOutput implements StreamLike {
  chunks: string[] = [];
  write(chunk: string): void {
    this.chunks.push(chunk);
  }
  on(): unknown {
    return this;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("stdio transport", () => {
  it("responds to line-delimited JSON-RPC", async () => {
    const server = createMCPServer(null, { name: "stdio-test" });
    const input = Readable.from([
      '{"jsonrpc":"2.0","id":1,"method":"ping"}\n',
      '{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n',
    ]);
    const output = new CollectOutput();
    const transport = new StdioTransport(server, {
      input: input as unknown as StreamLike,
      output,
      log: () => {},
    });
    transport.start();

    await sleep(30);

    const lines = output.chunks.join("").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0].id).toBe(1);
    expect(lines[0].result).toEqual({});
    expect(lines[1].id).toBe(2);
    expect(lines[1].result.tools.length).toBeGreaterThan(0);
  });

  it("handles notifications without responding", async () => {
    const server = createMCPServer(null);
    const input = Readable.from(['{"jsonrpc":"2.0","method":"notifications/initialized"}\n']);
    const output = new CollectOutput();
    const transport = new StdioTransport(server, {
      input: input as unknown as StreamLike,
      output,
      log: () => {},
    });
    transport.start();
    await sleep(20);
    expect(output.chunks.join("")).toBe("");
  });

  it("returns parse errors for malformed lines", async () => {
    const server = createMCPServer(null);
    const input = Readable.from(["{oops\n"]);
    const output = new CollectOutput();
    const transport = new StdioTransport(server, {
      input: input as unknown as StreamLike,
      output,
      log: () => {},
    });
    transport.start();
    await sleep(20);
    const parsed = JSON.parse(output.chunks.join("").trim());
    expect(parsed.error.code).toBe(-32700);
  });

  it("processes partial lines split across chunks", async () => {
    const server = createMCPServer(null);
    const input = Readable.from(['{"jsonrpc":"2.0","id":1',',"method":"ping"}\n']);
    const output = new CollectOutput();
    const transport = new StdioTransport(server, {
      input: input as unknown as StreamLike,
      output,
      log: () => {},
    });
    transport.start();
    await sleep(30);
    const parsed = JSON.parse(output.chunks.join("").trim());
    expect(parsed.id).toBe(1);
    expect(parsed.result).toEqual({});
  });
});

describe("HTTP transport", () => {
  async function makeApp(options: { authToken?: string; rateLimit?: { max: number; windowMs: number } } = {}) {
    const app = new Asi({ development: false, silent: true });
    const server = createMCPServer(app, { name: "http-test" });
    app.plugin(
      createMCPPlugin(server, {
        path: "/mcp",
        authToken: options.authToken,
        rateLimit: options.rateLimit,
      }),
    );
    await app.initPlugins();
    return { app, server };
  }

  const rpc = (id: number, method: string, params?: Record<string, unknown>) =>
    JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });

  it("serves JSON-RPC over POST", async () => {
    const { app } = await makeApp();
    const response = await app.handle(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: rpc(1, "ping"),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: number; result: unknown };
    expect(body.id).toBe(1);
    expect(body.result).toEqual({});
  });

  it("handles batches over POST", async () => {
    const { app } = await makeApp();
    const response = await app.handle(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([
          { jsonrpc: "2.0", id: 1, method: "ping" },
          { jsonrpc: "2.0", id: 2, method: "ping" },
        ]),
      }),
    );
    const body = (await response.json()) as Array<{ id: number }>;
    expect(body).toHaveLength(2);
  });

  it("returns 202 for notification-only payloads", async () => {
    const { app } = await makeApp();
    const response = await app.handle(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      }),
    );
    expect(response.status).toBe(202);
  });

  it("enforces Bearer auth", async () => {
    const { app } = await makeApp({ authToken: "secret" });

    const unauthorized = await app.handle(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: rpc(1, "ping"),
      }),
    );
    expect(unauthorized.status).toBe(401);

    const authorized = await app.handle(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer secret" },
        body: rpc(1, "ping"),
      }),
    );
    expect(authorized.status).toBe(200);
  });

  it("rate limits after max requests", async () => {
    const { app } = await makeApp({ rateLimit: { max: 3, windowMs: 60_000 } });

    for (let i = 0; i < 3; i++) {
      const response = await app.handle(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: rpc(i, "ping"),
        }),
      );
      expect(response.status).toBe(200);
    }

    const limited = await app.handle(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: rpc(4, "ping"),
      }),
    );
    expect(limited.status).toBe(429);
  });

  it("serves a health endpoint", async () => {
    const { app } = await makeApp();
    const response = await app.handle(new Request("http://localhost/mcp/health"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  it("streams responses over SSE", async () => {
    const { app } = await makeApp();

    const sseResponse = await app.handle(new Request("http://localhost/mcp/sse"));
    expect(sseResponse.status).toBe(200);
    expect(sseResponse.headers.get("content-type")).toContain("text/event-stream");

    const reader = sseResponse.body!.getReader();
    const decoder = new TextDecoder();
    const first = decoder.decode((await reader.read()).value);
    expect(first).toContain("event: endpoint");

    const sessionId = first.match(/sessionId=([^\s]+)/)?.[1];
    expect(sessionId).toBeDefined();

    // Send a message through the stream session
    const streamResponse = await app.handle(
      new Request(`http://localhost/mcp/stream?sessionId=${sessionId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: rpc(42, "ping"),
      }),
    );
    expect(streamResponse.status).toBe(202);

    const second = decoder.decode((await reader.read()).value);
    expect(second).toContain("event: message");
    expect(second).toContain('"id":42');
    await reader.cancel();
  });

  it("streams server notifications to SSE sessions", async () => {
    const { app, server } = await makeApp();

    const sseResponse = await app.handle(new Request("http://localhost/mcp/sse"));
    const reader = sseResponse.body!.getReader();
    const decoder = new TextDecoder();
    const first = decoder.decode((await reader.read()).value);

    // Server-initiated notification (e.g. progress from a tool call)
    const received: string[] = [];
    const readLoop = (async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        received.push(decoder.decode(value));
      }
    })();

    // Wait a tick so the SSE subscription is registered
    await sleep(10);
    server.sendNotification("notifications/progress", { progressToken: "t", progress: 1 });

    await sleep(20);
    expect(received.some((chunk) => chunk.includes("notifications/progress"))).toBe(true);
    await reader.cancel();
    await readLoop.catch(() => {});
  });
});
