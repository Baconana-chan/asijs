/**
 * Tests: JSON-RPC protocol, lifecycle, pagination, progress, cancellation,
 * sampling and roots.
 */

import { describe, expect, it } from "bun:test";
import { Asi } from "../../../src/index.ts";
import { MCPServer } from "../src/index";

function initServer(extra: Record<string, unknown> = {}) {
  const server = new MCPServer(null, { name: "test-server", version: "9.9.9", ...extra });
  return server;
}

async function initialize(server: MCPServer, caps: Record<string, unknown> = {}) {
  return server.handleRaw({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: caps, clientInfo: { name: "test-client", version: "1.0" } },
  });
}

describe("asijs-mcp protocol", () => {
  it("negotiates protocol version and reports capabilities", async () => {
    const server = initServer();
    const response = (await initialize(server)) as { result: Record<string, unknown> };

    expect(response.result.protocolVersion).toBe("2025-06-18");
    expect(response.result.serverInfo).toEqual({ name: "test-server", version: "9.9.9" });
    expect(response.result.capabilities).toHaveProperty("tools");
    expect(response.result.capabilities).toHaveProperty("resources");
    expect(response.result.capabilities).toHaveProperty("prompts");
  });

  it("falls back to server version for unknown client protocol versions", async () => {
    const server = initServer({ protocolVersion: "2025-06-18" });
    const response = (await server.handleRaw({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "1999-01-01" },
    })) as { result: { protocolVersion: string } };
    expect(response.result.protocolVersion).toBe("2025-06-18");
  });

  it("responds to ping", async () => {
    const server = initServer();
    const response = (await server.handleRaw({
      jsonrpc: "2.0",
      id: 5,
      method: "ping",
    })) as { result: Record<string, unknown> };
    expect(response.id).toBe(5);
    expect(response.result).toEqual({});
  });

  it("returns parse error for invalid JSON", async () => {
    const server = initServer();
    const response = (await server.handleRaw("{not json")) as { error: { code: number } };
    expect(response.error.code).toBe(-32700);
  });

  it("returns invalid request for non-JSON-RPC objects", async () => {
    const server = initServer();
    const response = (await server.handleRaw({ hello: "world" })) as { error: { code: number } };
    expect(response.error.code).toBe(-32600);
  });

  it("returns method not found for unknown methods", async () => {
    const server = initServer();
    const response = (await server.handleRaw({
      jsonrpc: "2.0",
      id: 1,
      method: "bogus/method",
    })) as { error: { code: number } };
    expect(response.error.code).toBe(-32601);
  });

  it("handles batch requests", async () => {
    const server = initServer();
    const responses = (await server.handleRaw([
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ])) as Array<{ id: number; result: unknown }>;
    expect(responses).toHaveLength(2);
    expect(responses[0].id).toBe(1);
    expect(responses[1].id).toBe(2);
  });

  it("returns null for notifications", async () => {
    const server = initServer();
    const response = await server.handleRaw({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    expect(response).toBeNull();
  });

  it("paginates tools/list with cursors", async () => {
    const server = initServer({ pageSize: 5 });
    // Custom tools to fill the list beyond one page
    for (let i = 0; i < 10; i++) {
      server.addTool({
        name: `custom/tool-${i}`,
        description: `Tool ${i}`,
        inputSchema: { type: "object", properties: {} },
        handler: () => i,
      });
    }
    await initialize(server);

    const page1 = (await server.handleRaw({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    })) as { result: { tools: Array<{ name: string }>; _meta?: { nextCursor?: string } } };

    expect(page1.result.tools).toHaveLength(5);
    expect(page1.result._meta?.nextCursor).toBeDefined();

    // Page through the whole list (21 built-ins + 10 custom = 31 tools, pageSize 5)
    const names: string[] = [...page1.result.tools.map((t) => t.name)];
    let cursor = page1.result._meta?.nextCursor;
    let id = 2;
    while (cursor) {
      const page = (await server.handleRaw({
        jsonrpc: "2.0",
        id: id++,
        method: "tools/list",
        params: { cursor },
      })) as { result: { tools: Array<{ name: string }>; _meta?: { nextCursor?: string } } };
      expect(page.result.tools.length).toBeLessThanOrEqual(5);
      names.push(...page.result.tools.map((t) => t.name));
      cursor = page.result._meta?.nextCursor;
    }

    // Cursor pagination covers every tool exactly once — same set as an unpaginated list
    const allServer = initServer({ pageSize: 10_000 });
    for (let i = 0; i < 10; i++) {
      allServer.addTool({
        name: `custom/tool-${i}`,
        description: `Tool ${i}`,
        inputSchema: { type: "object", properties: {} },
        handler: () => i,
      });
    }
    await initialize(allServer);
    const all = (await allServer.handleRaw({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    })) as { result: { tools: Array<{ name: string }> } };
    expect(names).toHaveLength(all.result.tools.length);
    expect(new Set(names).size).toBe(all.result.tools.length);
  });

  it("reports tool errors with isError", async () => {
    const server = initServer();
    server.addTool({
      name: "custom/boom",
      description: "Throws",
      inputSchema: { type: "object", properties: {} },
      handler: () => {
        throw new Error("kaboom");
      },
    });
    await initialize(server);

    const response = (await server.handleRaw({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "custom/boom", arguments: {} },
    })) as { result: { content: Array<{ text: string }>; isError: boolean } };

    expect(response.result.isError).toBe(true);
    expect(response.result.content[0].text).toContain("kaboom");
  });

  it("supports progress tokens on tools/call", async () => {
    const server = initServer();
    const progressEvents: Array<{ progressToken: unknown; progress: number }> = [];
    server.onNotification((n) => {
      if (n.method === "notifications/progress") progressEvents.push(n.params as never);
    });

    server.addTool({
      name: "custom/step",
      description: "Emits progress",
      inputSchema: { type: "object", properties: {} },
      handler: async (_args, ctx) => {
        ctx.progress(1, 3, "step 1");
        ctx.progress(2, 3, "step 2");
        ctx.progress(3, 3, "done");
        return { ok: true };
      },
    });
    await initialize(server);

    await server.handleRaw({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "custom/step", arguments: {}, _meta: { progressToken: "abc" } },
    });

    expect(progressEvents).toHaveLength(3);
    expect(progressEvents[0].progressToken).toBe("abc");
    expect(progressEvents[0].progress).toBe(1);
  });

  it("does not emit progress without a token", async () => {
    const server = initServer();
    const events: unknown[] = [];
    server.onNotification((n) => {
      if (n.method === "notifications/progress") events.push(n);
    });
    server.addTool({
      name: "custom/nop",
      description: "No token",
      inputSchema: { type: "object", properties: {} },
      handler: (_args, ctx) => {
        ctx.progress(50, 100, "no token attached");
        return true;
      },
    });
    await initialize(server);
    await server.handleRaw({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "custom/nop" } });
    expect(events).toHaveLength(0);
  });

  it("honours notifications/cancelled", async () => {
    const server = initServer();
    await initialize(server);

    let sawCancelled = false;
    server.addTool({
      name: "custom/slow",
      description: "Checks cancellation",
      inputSchema: { type: "object", properties: {} },
      handler: async (_args, ctx) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        sawCancelled = ctx.cancelled();
        return sawCancelled;
      },
    });

    // Fire request id=42, then cancel it
    const callPromise = server.handleRaw({
      jsonrpc: "2.0",
      id: 42,
      method: "tools/call",
      params: { name: "custom/slow", arguments: {} },
    });
    await server.handleRaw({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 42 },
    });
    await callPromise;

    expect(sawCancelled).toBe(true);
  });

  it("requests sampling from the client when the capability is present", async () => {
    const server = initServer();
    let receivedMethod = "";
    server.setClientLink({
      request: async (request) => {
        receivedMethod = request.method;
        return { role: "assistant", content: { type: "text", text: "hello from client" } };
      },
    });
    await initialize(server, { sampling: {} });

    const result = await server.requestSampling({
      messages: [{ role: "user", content: { type: "text", text: "Hi" } }],
      maxTokens: 10,
    });

    expect(receivedMethod).toBe("sampling/createMessage");
    expect(result?.content.text).toBe("hello from client");
  });

  it("refuses sampling when the client lacks the capability", async () => {
    const server = initServer();
    server.setClientLink({
      request: async () => {
        throw new Error("should not be called");
      },
    });
    await initialize(server, {}); // no sampling capability
    const result = await server.requestSampling({
      messages: [{ role: "user", content: { type: "text", text: "Hi" } }],
      maxTokens: 10,
    });
    expect(result).toBeNull();
  });

  it("tracks client roots", async () => {
    const server = initServer();
    server.setClientLink({
      request: async () => ({ roots: [{ uri: "file:///project", name: "project" }] }),
    });
    await initialize(server, { roots: {} });

    const roots = await server.requestRootsList();
    expect(roots).toEqual([{ uri: "file:///project", name: "project" }]);
    expect(server.clientRoots).toHaveLength(1);
  });

  it("supports completion/complete for tool names", async () => {
    const server = initServer();
    await initialize(server);
    const response = (await server.handleRaw({
      jsonrpc: "2.0",
      id: 1,
      method: "completion/complete",
      params: { ref: { type: "ref/tool" }, argument: { name: "name", value: "asijs/routes" } },
    })) as { result: { completion: { values: string[] } } };

    expect(response.result.completion.values).toContain("asijs/routes/list");
  });

  it("supports logging/setLevel", async () => {
    const server = initServer();
    const ok = (await server.handleRaw({
      jsonrpc: "2.0",
      id: 1,
      method: "logging/setLevel",
      params: { level: "debug" },
    })) as { result: unknown };
    expect(ok.result).toEqual({});

    const bad = (await server.handleRaw({
      jsonrpc: "2.0",
      id: 2,
      method: "logging/setLevel",
      params: { level: "nope" },
    })) as { error: { code: number } };
    expect(bad.error.code).toBe(-32602);
  });

  it("provides rich content helpers", async () => {
    const server = initServer();
    await initialize(server);

    server.addTool({
      name: "custom/content",
      description: "Returns rich content",
      inputSchema: { type: "object", properties: {} },
      handler: async () => ({
        content: [
          { type: "text", text: "plain" },
          { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
          { type: "audio", data: "c291bmQ=", mimeType: "audio/wav" },
          { type: "blob", data: "YmluYXJ5", mimeType: "application/octet-stream" },
        ],
      }),
    });

    const response = (await server.handleRaw({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "custom/content", arguments: {} },
    })) as { result: { content: Array<{ type: string; mimeType: string }> } };

    const types = response.result.content.map((c) => c.type);
    expect(types).toEqual(["text", "image", "audio", "blob"]);
  });
});
