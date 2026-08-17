# asijs-mcp — MCP v2: AI-Native Protocol

A full [Model Context Protocol](https://modelcontextprotocol.io) server built for AsiJS: **tools, resources, prompts, sampling, roots, pagination, workflows**, with pluggable transports (stdio / HTTP / SSE) and deep runtime integration — circuit breakers, WebSocket rooms, hot reload, plugin graph, rate limiter metrics.

- Package: `asijs-mcp`
- Requires: `asijs` (peer dependency)
- Protocol: MCP `2025-06-18` (+ negotiation of earlier versions)

> For a conceptual guide (what MCP is and how AsiJS fits in), see [MCP v2 guide](/features/mcp-v2).

## Installation

```bash
bun add asijs-mcp
```

## Quick start — stdio (Claude Desktop, Cursor, Zed, Continue.dev)

```typescript
// mcp.ts
import { Asi } from "asijs";
import { mcp } from "asijs-mcp";

const app = new Asi();
app.get("/users", () => [{ id: 1, name: "Ada" }]);

mcp(app, { name: "my-app" }).start();   // stdio — default transport
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

## Quick start — HTTP / SSE on the same app

```typescript
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

## Two entry points

| Export | Purpose |
|---|---|
| `mcp(app?, options?)` | Convenience alias for `createMCPServer` — returns an `MCPServer` |
| `createMCPServer(app?, options?)` | Explicit constructor — same result, clearer intent |

Both accept `app = null` (a server not yet bound to an AsiJS app; call `.bind(app)` later).

## MCPServer API

```typescript
const server = createMCPServer(app, options);

// Registration (chainable)
server.addTool(tool);                          // MCPTool
server.addResource(resource);                  // MCPResource
server.addResourceTemplate(template);          // MCPResourceTemplate
server.addPrompt(prompt);                      // MCPPrompt
server.addWorkflow(workflow);                  // Workflow

// Introspection
server.toolNames;            // string[]
server.workflowNames;        // string[]
server.workflow(name);       // Workflow | undefined
server.allowMutation;        // boolean
server.pageSize;             // number
server.runtimeBridge;        // AsiRuntimeBridge
server.docsDirPath;          // string | undefined

// Transport
server.start(transport?);    // "stdio" | StdioTransport — blocks on stdin/stdout
server.startHTTP(options);   // → AsiPlugin to mount on an AsiJS app
server.bind(app);            // attach/replace the AsiJS app

// Client notifications & progress
server.sendNotification(method, params?);
server.notifyProgress(token, progress, total?, message?);
server.log(level, data, logger?);
server.setClientLink(link);
server.onNotification((n) => void);           // → unsubscribe
```

## Options

```typescript
interface MCPServerOptions {
  name?: string;                  // default: "asijs-mcp"
  version?: string;               // default: "1.0.0"
  instructions?: string;          // short text sent in `initialize`
  protocolVersion?: string;       // default: 2025-06-18
  tools?: MCPTool[];
  resources?: MCPResource[];
  resourceTemplates?: MCPResourceTemplate[];
  prompts?: MCPPrompt[];
  workflows?: Workflow[];
  docsDir?: string;               // markdown dir → docs://<slug> resources
  runtime?: RuntimeBridgeOptions; // deep AsiJS integration
  pageSize?: number;              // cursor-paginated lists, default: 50
  allowMutation?: boolean;        // enable mutating tools, default: false
  debug?: boolean;                // verbose logging
}
```

## Tools, resources, prompts

**Tools** are auto-discovered from AsiJS routes (`GET /users` → `get_users`), plus anything you add via `addTool` or `options.tools`. Each tool gets a Toolbox-style schema derived from the route's validation.

```typescript
server.addTool({
  name: "calculate",
  description: "Add two numbers",
  inputSchema: {
    type: "object",
    properties: {
      a: { type: "number" },
      b: { type: "number" },
    },
    required: ["a", "b"],
  },
  async handler(args, ctx) {
    return { result: args.a + args.b };
  },
});
```

**Resources** are `docs://` URIs (from `docsDir` markdown files) or custom ones; **prompts** are server-side prompt templates with arguments.

## HTTP transport options

```typescript
interface MCPHTTPOptions {
  path?: string;                    // default: "/mcp"
  authToken?: string;               // Bearer auth on all MCP endpoints
  rateLimit?: { max: number; windowMs: number };   // token bucket per client
  rateLimitKey?: (request: Request) => string;     // default: x-forwarded-for / x-real-ip / "local"
  enableSSE?: boolean;              // SSE endpoints, default: true
}
```

## Workflows

Declarative multi-step workflows runnable as MCP tools. A workflow is a list of steps, each with `http` / `code` / `delay` / `log` / `result` types, chained so each step receives the previous step's output:

```typescript
server.addWorkflow({
  name: "fetch-and-transform",
  description: "Fetch a URL, transform, and return",
  input: { url: { type: "string" } },
  steps: [
    { type: "http", url: (input) => input.url, transform: (r) => r.json() },
    { type: "code", run: (_input, prev) => ({ received: prev }) },
  ],
});
```

Built-in workflows (via `createBuiltinWorkflows()`): `asijs/http-request`, `asijs/chain-requests`, `asijs/app-snapshot`.

## AsiJS runtime bridge

`createMCPPlugin` / `options.runtime` wire the server into the running app so AI clients can inspect and (with `allowMutation: true`) drive the live application:

| Capability | Tools exposed |
|---|---|
| Routes | list, invoke, describe (OpenAPI-derived schema) |
| Circuit breakers | state, metrics, reset (`allowMutation`) |
| WebSocket rooms | presence, room membership |
| Hot reload | trigger reload, list modules |
| SSG | paths, re-render |
| Rate limiter | metrics, buckets |
| Plugins | plugin graph, dependencies |
| Serverless | platform stats |

## Pagination

`paginate(items, cursor, pageSize)` and `decodeCursor(cursor)` are exported for building cursor-paginated MCP list results (used internally for tools/resources/prompts lists).

## Transport: custom stdio

```typescript
import { StdioTransport } from "asijs-mcp";

const server = createMCPServer(app);
const t = new StdioTransport({
  input: someReadable,       // default: process.stdin
  output: someWritable,      // default: process.stdout
  log: (line) => console.error(line),
  debug: true,
});
server.start(t);
```

## Auth & rate limiting

HTTP transport ships `authToken` (Bearer) and token-bucket `rateLimit` built on AsiJS middleware — no extra wiring needed. For stronger auth, mount `createMCPPlugin` behind AsiJS's `auth.bearer()` or any other middleware.

## FAQ

**Does `allowMutation` matter for safety?** Yes. With `false` (default), only read-only tools are exposed. Enabling it adds mutating tools (circuit-breaker resets, state sets) — only turn it on for trusted clients.

**Can I use the server without an AsiJS app?** Yes — `createMCPServer(null, options)` works standalone; bind an app later with `.bind(app)`.
