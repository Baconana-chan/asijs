import { describe, expect, it } from "bun:test";
import { Asi, MCPServer } from "../src";

describe("mcp.ts", () => {
  it("supports initialize and tools/list JSON-RPC methods", async () => {
    const app = new Asi();
    const server = new MCPServer(app, { name: "asijs-tests", version: "9.9.9" });

    const initialize = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    });
    const tools = await server.handleRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });

    expect((initialize.result as { serverInfo: { name: string } }).serverInfo.name).toBe(
      "asijs-tests",
    );
    expect(
      (tools.result as { tools: Array<{ name: string }> }).tools.map(
        (tool) => tool.name,
      ),
    ).toContain("list_routes");
  });

  it("can call built-in tools against registered routes", async () => {
    const app = new Asi();
    app.get("/users/:id", () => ({ ok: true }));
    app.post("/users", () => ({ created: true }));

    const server = new MCPServer(app);
    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "list_routes",
        arguments: { method: "GET" },
      },
    });

    const content = (response.result as { content: Array<{ text: string }> }).content[0]
      .text;
    const routes = JSON.parse(content) as Array<{ method: string; path: string }>;

    expect(routes).toEqual([
      expect.objectContaining({ method: "GET", path: "/users/:id" }),
    ]);
  });

  it("reads built-in resources like routes and docs", async () => {
    const app = new Asi();
    app.get("/health", () => ({ ok: true }));

    const server = new MCPServer(app);
    const routesResource = await server.handleRequest({
      jsonrpc: "2.0",
      id: 4,
      method: "resources/read",
      params: { uri: "asijs://routes" },
    });
    const docsResource = await server.handleRequest({
      jsonrpc: "2.0",
      id: 5,
      method: "resources/read",
      params: { uri: "asijs://docs" },
    });

    const routesText = (routesResource.result as { contents: Array<{ text: string }> })
      .contents[0].text;
    const docsText = (docsResource.result as { contents: Array<{ text: string }> })
      .contents[0].text;

    expect(routesText).toContain("/health");
    expect(docsText).toContain("# AsiJS Framework Documentation");
  });
});
