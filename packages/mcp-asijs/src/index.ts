/**
 * asijs-mcp — MCP v2 server for AsiJS
 *
 * Model Context Protocol v2025-06-18 server with pluggable transports
 * (stdio, HTTP, SSE), deep AsiJS runtime integration (routes, circuit
 * breakers, WebSocket rooms, hot reload, SSG, serverless, plugin graph,
 * rate limiter), dynamic documentation, prompts, sampling, roots,
 * pagination and custom workflows.
 *
 * @example
 * ```ts
 * // Claude Desktop / Cursor / Zed — stdio
 * import { Asi } from "asijs";
 * import { mcp } from "asijs-mcp";
 *
 * const app = new Asi();
 * app.get("/users", () => [{ id: 1 }]);
 *
 * mcp(app, { name: "my-app" }).start(); // stdio
 * ```
 *
 * @example
 * ```ts
 * // HTTP transport on the same Asi app
 * import { Asi } from "asijs";
 * import { createMCPServer, createMCPPlugin } from "asijs-mcp";
 *
 * const app = new Asi();
 * const server = createMCPServer(app, { name: "my-app" });
 * app.plugin(createMCPPlugin(server, { path: "/mcp", authToken: "secret" }));
 * app.listen(3000);
 * ```
 */

export { MCPServer } from "./server";
export type { ClientLink, ClientCapabilities } from "./server";
export { AsiRuntimeBridge } from "./runtime";
export type { RoomManagerLike, HotReloaderLike } from "./runtime";

export { StdioTransport } from "./transports/stdio";
export type { StdioTransportOptions, StreamLike } from "./transports/stdio";
export { createMCPPlugin, mountHTTP } from "./transports/http";
export type { MCPHTTPOptions } from "./transports/http";

export {
  textContent,
  imageContent,
  audioContent,
  blobContent,
  resourceContent,
  stringify,
  toolResult,
  errorResult,
} from "./content";
export { paginate, decodeCursor, type Paginated } from "./pagination";
export { runWorkflow, validateInput, createBuiltinWorkflows, type ValidationIssue } from "./workflows";
export { toYAML } from "./tools";
export { loadDocsResources, findMarkdownFiles, type DocsFile } from "./resources";

export {
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  JSONRPCErrorCodes,
  type JSONRPCRequest,
  type JSONRPCNotification,
  type JSONRPCResponse,
  type JSONRPCMessage,
  type RequestMeta,
  type MCPTool,
  type ToolContext,
  type ContentBlock,
  type ToolCallResult,
  type MCPResource,
  type ResourceContents,
  type MCPResourceTemplate,
  type MCPPrompt,
  type MCPPromptArgument,
  type PromptMessage,
  type SamplingRequest,
  type SamplingResponse,
  type SamplingMessage,
  type MCPRoot,
  type LogLevel,
  type Workflow,
  type WorkflowStep,
  type WorkflowRunContext,
  type HttpMethod,
  type MCPServerOptions,
  type RuntimeBridgeOptions,
} from "./types";

import { MCPServer } from "./server";
import type { Asi } from "asijs";
import type { MCPServerOptions } from "./types";

/**
 * Create an MCP server bound to an AsiJS application.
 *
 * @example
 * ```ts
 * import { Asi } from "asijs";
 * import { createMCPServer } from "asijs-mcp";
 *
 * const app = new Asi();
 * const server = createMCPServer(app, { name: "my-app" });
 * server.start(); // stdio
 * ```
 */
export function createMCPServer(app: Asi | null = null, options: MCPServerOptions = {}): MCPServer {
  return new MCPServer(app, options);
}

/**
 * Create an MCP server (convenience alias for `createMCPServer`).
 *
 * @example
 * ```ts
 * // Claude Desktop config:
 * // { "mcpServers": { "asijs-app": { "command": "bun",
 * //   "args": ["-e", "import { mcp } from 'asijs-mcp'; import { Asi } from 'asijs'; mcp(new Asi()).start()"],
 * //   "transport": "stdio" } } }
 * ```
 */
export function mcp(app: Asi | null = null, options: MCPServerOptions = {}): MCPServer {
  return new MCPServer(app, options);
}
