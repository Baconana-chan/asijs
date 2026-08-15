# MCP v2 — AI-Native Protocol (`asijs-mcp`)

> **Status**: planned for v1.4.0. Standalone package: `asijs-mcp`.

`asijs-mcp` is the next-generation Model Context Protocol server for AsiJS —
an AI-native protocol with pluggable transports, deep runtime integration,
prompts, sampling, roots, pagination and custom workflows.

The built-in MCP server in the core package (`mcp()` / `createMCPServer` from
`asijs`) remains stable (HTTP transport, 7 built-in tools) for backward
compatibility.

## Install

```bash
bun add asijs-mcp
```

## Quick Start — stdio (Claude Desktop, Cursor, Zed, Continue.dev)

```typescript
import { Asi } from "asijs";
import { mcp } from "asijs-mcp";

const app = new Asi();
app.get("/users", () => [{ id: 1, name: "Ada" }]);

mcp(app, { name: "my-app" }).start(); // stdio — default transport
```

Claude Desktop config:

```json
{
  "mcpServers": {
    "asijs-app": {
      "command": "bun",
      "args": ["-e", "import { Asi } from 'asijs'; import { mcp } from 'asijs-mcp'; mcp(new Asi()).start()"],
      "transport": "stdio"
    }
  }
}
```

## Transports

| Transport | When to use |
|-----------|-------------|
| `stdio` | Desktop MCP clients (Claude Desktop, Cursor, Zed, Continue.dev) |
| `http` | Same-process HTTP JSON-RPC (`POST /mcp`) |
| `sse` | Streaming: endpoint discovery + notifications (`GET /mcp/sse`, `POST /mcp/stream`) |

### HTTP / SSE on the same app

```typescript
import { Asi } from "asijs";
import { createMCPServer, createMCPPlugin } from "asijs-mcp";

const app = new Asi();
const server = createMCPServer(app, { name: "my-app" });

app.plugin(createMCPPlugin(server, {
  path: "/mcp",
  authToken: "secret",               // Bearer auth via AsiJS middleware
  rateLimit: { max: 60, windowMs: 60_000 },
}));

app.listen(3000);
```

## Protocol (v2025-06-18)

- **Prompts** — template prompts grounded with real app data: `asijs/analyze-route`,
  `asijs/generate-crud`, `asijs/debug-request`, `asijs/security-audit`,
  `asijs/architecture-review`, `asijs/optimize-routes`
- **Sampling** — LLM-to-LLM calls for agent chains (server requests the client to generate)
- **Roots** — the client tells the server where the project root is
- **Progress** — `notifications/progress` for long-running operations
- **Pagination** — cursor-based `tools/list`, `resources/list`, `prompts/list` for 1000+ routes
- **Streaming results** — `image`, `audio`, `blob`, `resource` content blocks
- **Logging** — `logging/setLevel` + `notifications/message`
- **Completion** — `completion/complete` for argument autocomplete

## Deep AsiJS Runtime Integration

Built-in tools expose live runtime state:

| Tool | Exposes |
|------|---------|
| `asijs/routes/*` | Registered routes, route analysis, REST suggestions |
| `asijs/openapi/get` | Generated OpenAPI spec |
| `asijs/plugins/*` | Plugin list + dependency graph |
| `asijs/middleware/info` | Middleware counts |
| `asijs/state/*` | App state (get/set, gated by `allowMutation`) |
| `asijs/circuit-breakers/*` | Circuit breaker health (OPEN/CLOSED/HALF_OPEN), reset |
| `asijs/ws/*` | WebSocket rooms, presence, active connections |
| `asijs/hot-reload/status` | Hot reload status |
| `asijs/serverless/status` | Cold start statistics |
| `asijs/ssg/paths` | Static SSG output paths |
| `asijs/ratelimit/metrics` | Current RPS, limits |
| `asijs/workflow/*` | Custom workflow definitions + runs |

## Dynamic Documentation

Point `docsDir` at your markdown docs — every `.md` file becomes a `docs://<slug>`
resource:

```typescript
const server = createMCPServer(app, { docsDir: "./docs" });
```

## Custom Workflows

AI can define declarative workflows (webhook → action → response):

```typescript
const server = createMCPServer(app, {
  workflows: [
    {
      name: "notify-on-event",
      steps: [
        { type: "http", url: "https://hooks.example.com/slack", method: "POST", body: { text: "Deploy finished" } },
        { type: "delay", ms: 1000 },
        { type: "log", message: (_input, prev) => `Sent: ${JSON.stringify(prev)}` },
      ],
    },
  ],
});
```

Run them via the `asijs/workflow/run` tool or programmatically with `runWorkflow()`.

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `name` | `"asijs-mcp"` | Server name in `initialize` |
| `pageSize` | `50` | Cursor pagination page size |
| `allowMutation` | `false` | Enable mutating tools (`state/set`, `circuit-breakers/reset`) |
| `docsDir` | — | Markdown dir exposed as `docs://` resources |
| `tools` / `resources` / `prompts` / `workflows` | — | Custom definitions |
| `runtime` | — | Plug in live `RoomManager`, `HotReloader`, SSG paths, rate limiter |
