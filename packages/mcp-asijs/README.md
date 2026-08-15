# asijs-mcp — MCP v2: AI-Native Protocol for AsiJS

Model Context Protocol server with pluggable transports (stdio / HTTP / SSE),
deep AsiJS runtime integration, prompts, sampling, roots, pagination, dynamic
documentation and custom workflows.

## Installation

```bash
bun add asijs-mcp
```

> Requires `asijs` as a peer dependency.

## Usage

### stdio — Claude Desktop, Cursor, Zed, Continue.dev

```ts
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

### HTTP / SSE on the same app

```ts
import { Asi } from "asijs";
import { createMCPServer, createMCPPlugin } from "asijs-mcp";

const app = new Asi();
const server = createMCPServer(app, { name: "my-app" });

app.plugin(createMCPPlugin(server, {
  path: "/mcp",
  authToken: "secret",
  rateLimit: { max: 60, windowMs: 60_000 },
}));

app.listen(3000);
```

## Features

- **Protocol v2025-06-18** — tools, resources, prompts, sampling, roots, progress, pagination, streaming content blocks, logging, completion
- **Deep runtime integration** — routes, circuit breakers, WebSocket rooms/presence, hot reload, SSG paths, serverless stats, plugin graph, rate limiter metrics
- **Dynamic documentation** — `docsDir` scans markdown into `docs://<slug>` resources
- **Auth** — Bearer token + token-bucket rate limiting via AsiJS middleware
- **Custom workflows** — declarative steps (`http` / `code` / `delay` / `log` / `result`) plus built-ins (`asijs/http-request`, `asijs/chain-requests`, `asijs/app-snapshot`)
- **67 tests** — stdio, protocol, pagination, resources, prompts, workflows, asi-bridge

## Documentation

See [docs/features/mcp-v2.md](../../docs/features/mcp-v2.md) for the full guide.
