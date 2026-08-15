/**
 * Tests: resources (built-in + dynamic docs) and prompts.
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Asi } from "../../../src/index.ts";
import { MCPServer, loadDocsResources, createMCPServer } from "../src/index";

async function initialize(server: MCPServer) {
  await server.handleRaw({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
  });
}

describe("asijs-mcp resources", () => {
  it("lists built-in resources", async () => {
    const app = new Asi({ development: false, silent: true });
    app.get("/users", () => []);
    const server = createMCPServer(app);
    await initialize(server);

    const response = (await server.handleRaw({
      jsonrpc: "2.0",
      id: 1,
      method: "resources/list",
    })) as { result: { resources: Array<{ uri: string }> } };

    const uris = response.result.resources.map((r) => r.uri);
    expect(uris).toContain("asijs://routes");
    expect(uris).toContain("asijs://runtime");
    expect(uris).toContain("asijs://docs");
  });

  it("reads the routes resource as JSON", async () => {
    const app = new Asi({ development: false, silent: true });
    app.get("/health", () => ({ ok: true }));
    const server = createMCPServer(app);
    await initialize(server);

    const response = (await server.handleRaw({
      jsonrpc: "2.0",
      id: 1,
      method: "resources/read",
      params: { uri: "asijs://routes" },
    })) as { result: { contents: Array<{ text: string }> } };

    const parsed = JSON.parse(response.result.contents[0].text) as { routes: Array<{ path: string }> };
    expect(parsed.routes.map((r) => r.path)).toContain("/health");
  });

  it("returns 400-ish error for unknown resource URIs", async () => {
    const server = createMCPServer(null);
    await initialize(server);
    const response = (await server.handleRaw({
      jsonrpc: "2.0",
      id: 1,
      method: "resources/read",
      params: { uri: "asijs://nope" },
    })) as { error: { code: number } };
    expect(response.error.code).toBe(-32602);
  });

  it("reads custom resources with lazy contents", async () => {
    let calls = 0;
    const server = createMCPServer(null, {
      resources: [
        {
          uri: "custom://counter",
          name: "Counter",
          contents: async () => {
            calls++;
            return { text: `called ${calls} times` };
          },
        },
      ],
    });
    await initialize(server);

    for (let i = 0; i < 3; i++) {
      await server.handleRaw({
        jsonrpc: "2.0",
        id: i,
        method: "resources/read",
        params: { uri: "custom://counter" },
      });
    }
    expect(calls).toBe(3);
  });

  it("loads dynamic docs from a directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "asijs-mcp-docs-"));
    mkdirSync(join(dir, "nested"));
    writeFileSync(join(dir, "getting-started.md"), "# Getting Started\n\nQuick start guide.");
    writeFileSync(join(dir, "nested", "websocket.md"), "# WebSocket\n\nPub-sub guide.");
    writeFileSync(join(dir, "notes.txt"), "not markdown");

    const { resources, template } = loadDocsResources(dir);
    const uris = resources.map((r) => r.uri);

    expect(uris).toContain("docs://getting-started");
    expect(uris).toContain("docs://nested/websocket");
    expect(uris).toContain("docs://all");
    expect(uris).not.toContain("docs://notes");

    const resolved = template.resolve("docs://nested/websocket");
    expect(resolved).not.toBeNull();
    expect((await resolved!.contents!()) as string).toContain("# WebSocket");
  });

  it("serves dynamic docs as resources when docsDir is configured", async () => {
    const dir = mkdtempSync(join(tmpdir(), "asijs-mcp-live-"));
    writeFileSync(join(dir, "api.md"), "# API Reference\n\nAll endpoints.");

    const server = createMCPServer(null, { docsDir: dir });
    await initialize(server);

    const read = (await server.handleRaw({
      jsonrpc: "2.0",
      id: 1,
      method: "resources/read",
      params: { uri: "docs://api" },
    })) as { result: { contents: Array<{ text: string }> } };
    expect(read.result.contents[0].text).toContain("# API Reference");
  });

  it("lists resource templates", async () => {
    const dir = mkdtempSync(join(tmpdir(), "asijs-mcp-tpl-"));
    writeFileSync(join(dir, "x.md"), "# X");

    const server = createMCPServer(null, { docsDir: dir });
    await initialize(server);

    const response = (await server.handleRaw({
      jsonrpc: "2.0",
      id: 1,
      method: "resources/templates/list",
    })) as { result: { resourceTemplates: Array<{ uriTemplate: string }> } };

    expect(response.result.resourceTemplates.map((t) => t.uriTemplate)).toContain("docs://{slug}");
  });

  it("paginates resources/list", async () => {
    const server = createMCPServer(null, { pageSize: 2 });
    await initialize(server);
    const response = (await server.handleRaw({
      jsonrpc: "2.0",
      id: 1,
      method: "resources/list",
    })) as { result: { resources: unknown[]; _meta?: { nextCursor?: string } } };
    expect(response.result.resources.length).toBeLessThanOrEqual(2);
    expect(response.result._meta?.nextCursor).toBeDefined();
  });
});

describe("asijs-mcp prompts", () => {
  it("lists built-in prompts", async () => {
    const server = createMCPServer(null);
    await initialize(server);
    const response = (await server.handleRaw({
      jsonrpc: "2.0",
      id: 1,
      method: "prompts/list",
    })) as { result: { prompts: Array<{ name: string }> } };
    const names = response.result.prompts.map((p) => p.name);
    expect(names).toContain("asijs/analyze-route");
    expect(names).toContain("asijs/generate-crud");
    expect(names).toContain("asijs/security-audit");
  });

  it("gets a prompt with messages and real app context", async () => {
    const app = new Asi({ development: false, silent: true });
    app.get("/users", () => []);
    const server = createMCPServer(app);
    await initialize(server);

    const response = (await server.handleRaw({
      jsonrpc: "2.0",
      id: 1,
      method: "prompts/get",
      params: { name: "asijs/analyze-route", arguments: { path: "/users" } },
    })) as { result: { messages: Array<{ role: string; content: { text: string } }> } };

    expect(response.result.messages[0].role).toBe("user");
    expect(response.result.messages[0].content.text).toContain("/users");
  });

  it("errors on missing required prompt arguments", async () => {
    const server = createMCPServer(null);
    await initialize(server);
    const response = (await server.handleRaw({
      jsonrpc: "2.0",
      id: 1,
      method: "prompts/get",
      params: { name: "asijs/analyze-route", arguments: {} },
    })) as { error: { code: number; message: string } };
    expect(response.error.code).toBe(-32602);
    expect(response.error.message).toContain("path");
  });

  it("generates a CRUD prompt with TypeBox schemas", async () => {
    const server = createMCPServer(null);
    await initialize(server);
    const response = (await server.handleRaw({
      jsonrpc: "2.0",
      id: 1,
      method: "prompts/get",
      params: { name: "asijs/generate-crud", arguments: { resource: "posts", fields: "id:number,title:string" } },
    })) as { result: { messages: Array<{ content: { text: string } }> } };
    const text = response.result.messages[0].content.text;
    expect(text).toContain("POST /posts");
    expect(text).toContain("Type.Number()");
    expect(text).toContain("Type.String()");
  });
});
