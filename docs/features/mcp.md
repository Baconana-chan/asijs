# MCP Server

AsiJS includes a built-in **Model Context Protocol (MCP)** server for AI/LLM assistants to inspect and interact with your application.

```typescript
import { mcp, MCPServer } from "asijs";

// As a plugin (auto-starts MCP server)
app.plugin(mcp({
  port: 3100,
  name: "my-app-mcp",
}));

// Or standalone
const server = new MCPServer(app, { port: 3100 });
server.start();
```

## Built-in Tools

| Tool | Description |
|------|-------------|
| `list_routes` | List all registered routes |
| `get_route_details` | Get route info (validation, middleware) |
| `get_plugins` | List all registered plugins |
| `get_middleware` | Get middleware counts |
| `get_openapi` | Generate OpenAPI spec |
| `get_app_state` | Get app configuration |
| `suggest_routes` | Suggest RESTful routes for a resource |

## Custom Tools & Resources

```typescript
const server = new MCPServer(app, {
  tools: [
    {
      name: "get_stats",
      description: "Get app statistics",
      inputSchema: { type: "object", properties: {} },
      handler: async () => ({ uptime: process.uptime() }),
    },
  ],
  resources: [
    {
      uri: "asijs://custom/data",
      name: "Custom Data",
      contents: async () => JSON.stringify({ key: "value" }),
    },
  ],
});
```
