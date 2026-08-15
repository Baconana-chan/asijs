/**
 * asijs-mcp — Protocol types (Model Context Protocol v2025-06-18)
 *
 * Covers: JSON-RPC 2.0 messages, tools, resources, resource templates,
 * prompts, sampling, roots, progress, and pagination.
 */

// ============================================================================
// Protocol versions
// ============================================================================

/** Latest protocol version supported by this server */
export const PROTOCOL_VERSION = "2025-06-18";

/** All protocol versions this server can speak */
export const SUPPORTED_PROTOCOL_VERSIONS = [
  "2024-11-05",
  "2025-03-26",
  "2025-06-18",
] as const;

// ============================================================================
// JSON-RPC 2.0
// ============================================================================

/** A JSON-RPC request (client → server, or server → client) */
export interface JSONRPCRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/** A JSON-RPC notification (fire-and-forget, no id) */
export interface JSONRPCNotification {
  jsonrpc: "2.0";
  /** Notifications MUST NOT have an id */
  method: string;
  params?: Record<string, unknown>;
}

/** A JSON-RPC response */
export interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/** Any JSON-RPC message */
export type JSONRPCMessage =
  | JSONRPCRequest
  | JSONRPCNotification
  | JSONRPCResponse;

/** Standard JSON-RPC error codes */
export const JSONRPCErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  /** Server error range: -32000 .. -32099 */
  SERVER_ERROR: -32000,
} as const;

// ============================================================================
// Meta
// ============================================================================

/** `_meta` params on requests — progress tokens */
export interface RequestMeta {
  /** Opaque token echoed back in `notifications/progress` */
  progressToken?: string | number;
}

// ============================================================================
// Tools
// ============================================================================

/** Context passed to tool handlers */
export interface ToolContext {
  /** Emit a progress notification (if a progress token is attached) */
  progress(progress: number, total?: number, message?: string): void;
  /** Emit a log notification */
  log(level: LogLevel, data: unknown, logger?: string): void;
  /** True if the client sent `notifications/cancelled` for this request */
  cancelled(): boolean;
  /** Opaque progress token attached by the client */
  progressToken?: string | number;
  /** The server instance (for advanced use) */
  server: import("./server").MCPServer;
}

/** A single tool exposed to AI clients */
export interface MCPTool {
  /** Unique tool name (namespaced: `asijs/routes/list`) */
  name: string;
  /** Human-readable description — this is what the LLM reads */
  description?: string;
  /** JSON Schema for the tool arguments */
  inputSchema?: Record<string, unknown>;
  /**
   * Execute the tool.
   *
   * Return a `ToolCallResult` for full control, or any value which is
   * auto-wrapped into a text content block. Throw to report an error
   * (the error becomes `isError: true`).
   */
  handler: (args: Record<string, unknown>, ctx: ToolContext) => unknown | Promise<unknown>;
}

/** Content block kinds (v2025-03-26+) */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "audio"; data: string; mimeType: string }
  | { type: "blob"; data: string; mimeType: string }
  | { type: "resource"; resource: { uri: string; mimeType?: string; text?: string } };

/** Result of a `tools/call` */
export interface ToolCallResult {
  content: ContentBlock[];
  /** True when the tool failed — the client surfaces this to the model */
  isError?: boolean;
  /** Machine-readable result (optional, mirrors the text content) */
  structuredContent?: unknown;
}

// ============================================================================
// Resources
// ============================================================================

/** Contents of a resource read */
export interface ResourceContents {
  uri: string;
  mimeType?: string;
  /** Text contents (either text or blob must be set) */
  text?: string;
  /** Base64-encoded binary contents */
  blob?: string;
}

/** A resource exposed to AI clients */
export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  /** Static text contents */
  text?: string;
  /** Lazy contents — evaluated on each `resources/read` */
  contents?: () => Promise<ResourceContents | string> | ResourceContents | string;
}

/** A URI template for dynamic resources */
export interface MCPResourceTemplate {
  uriTemplate: string;
  name: string;
  description?: string;
  mimeType?: string;
  /** Resolve a concrete URI from the template */
  resolve: (uri: string) => MCPResource | null;
}

// ============================================================================
// Prompts
// ============================================================================

/** Argument declaration for a prompt */
export interface MCPPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

/** A message inside a prompt */
export interface PromptMessage {
  role: "user" | "assistant";
  content: { type: "text"; text: string };
}

/** A prompt exposed to AI clients */
export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: MCPPromptArgument[];
  /** Build the prompt messages for given arguments */
  get: (
    args: Record<string, unknown>,
  ) => Promise<{ description?: string; messages: PromptMessage[] }> | { description?: string; messages: PromptMessage[] };
}

// ============================================================================
// Sampling (server → client LLM calls)
// ============================================================================

export interface SamplingMessage {
  role: "user" | "assistant";
  content: { type: "text"; text: string };
}

export interface ModelPreferences {
  hints?: Array<{ name: string; href?: string }>;
  costPriority?: number;
  speedPriority?: number;
  intelligencePriority?: number;
}

export interface SamplingRequest {
  messages: SamplingMessage[];
  modelPreferences?: ModelPreferences;
  systemPrompt?: string;
  includeContext?: "none" | "thisServer" | "allServers";
  maxTokens: number;
  stopSequences?: string[];
  temperature?: number;
  metadata?: Record<string, unknown>;
}

export interface SamplingResponse {
  role: "assistant";
  content: { type: "text"; text: string };
  model?: string;
  stopReason?: string;
}

// ============================================================================
// Roots (client → server project roots)
// ============================================================================

export interface MCPRoot {
  uri: string;
  name?: string;
}

// ============================================================================
// Logging
// ============================================================================

export type LogLevel = "debug" | "info" | "notice" | "warning" | "error" | "critical" | "alert" | "emergency";

// ============================================================================
// Workflows
// ============================================================================

/** HTTP methods usable in workflow steps */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** A single workflow step */
export type WorkflowStep =
  | {
      type: "http";
      url: string | ((input: Record<string, unknown>, prev: unknown) => string);
      method?: HttpMethod | ((input: Record<string, unknown>, prev: unknown) => HttpMethod);
      headers?: Record<string, string> | ((input: Record<string, unknown>, prev: unknown) => Record<string, string>);
      body?: unknown | ((input: Record<string, unknown>, prev: unknown) => unknown);
      /** Extract a value from the HTTP response (default: parsed JSON) */
      transform?: (response: Response) => unknown | Promise<unknown>;
    }
  | {
      type: "code";
      run: (input: Record<string, unknown>, prev: unknown, ctx: WorkflowRunContext) => unknown | Promise<unknown>;
    }
  | {
      type: "delay";
      ms: number | ((input: Record<string, unknown>) => number);
    }
  | {
      type: "log";
      message: string | ((input: Record<string, unknown>, prev: unknown) => string);
    }
  | {
      type: "result";
      /** Select the final workflow result (default: last step's output) */
      value?: (input: Record<string, unknown>, prev: unknown) => unknown;
    };

/** Context passed to workflow runs */
export interface WorkflowRunContext {
  /** Emit a progress notification */
  progress(progress: number, total?: number, message?: string): void;
  /** Emit a log notification */
  log(level: LogLevel, data: unknown, logger?: string): void;
  /** True if the client cancelled the run */
  cancelled(): boolean;
  /** Intermediary results of all completed steps */
  steps: unknown[];
}

/** A custom workflow definition — AI can create and run these */
export interface Workflow {
  /** Unique workflow name */
  name: string;
  description?: string;
  /** JSON Schema subset for input validation */
  inputSchema?: Record<string, unknown>;
  /** Declarative steps */
  steps?: WorkflowStep[];
  /** Imperative alternative to `steps` */
  run?: (input: Record<string, unknown>, ctx: WorkflowRunContext) => unknown | Promise<unknown>;
}

// ============================================================================
// Server options
// ============================================================================

/** Runtime integration options — plug in your app's live instances */
export interface RuntimeBridgeOptions {
  /** WebSocket RoomManager(s) used by the app (from createRoomManager()) */
  roomManagers?: import("./runtime").RoomManagerLike | Array<import("./runtime").RoomManagerLike>;
  /** HotReloader instance running for the app */
  hotReloader?: import("./runtime").HotReloaderLike;
  /** Known static SSG output paths */
  ssgPaths?: string[];
  /** Rate limiter with a metrics accessor */
  rateLimiter?: {
    name?: string;
    /** Return current rate-limit metrics */
    getMetrics?: () => unknown | Promise<unknown>;
  };
}

/** Options for the MCP server */
export interface MCPServerOptions {
  /** Server name reported in `initialize` (default: "asijs-mcp") */
  name?: string;
  /** Server version (default: "1.0.0") */
  version?: string;
  /** Short instructions served to the client in `initialize` */
  instructions?: string;
  /** Protocol version to report (default: 2025-06-18) */
  protocolVersion?: string;
  /** Custom tools */
  tools?: MCPTool[];
  /** Custom resources */
  resources?: MCPResource[];
  /** Custom resource templates */
  resourceTemplates?: MCPResourceTemplate[];
  /** Custom prompts */
  prompts?: MCPPrompt[];
  /** Custom workflows */
  workflows?: Workflow[];
  /**
   * Directory of markdown files to expose as `docs://` resources.
   * Scanned lazily — every `.md` file becomes `docs://<slug>`.
   */
  docsDir?: string;
  /** Runtime integration options */
  runtime?: RuntimeBridgeOptions;
  /** Page size for cursor-paginated lists (default: 50) */
  pageSize?: number;
  /** Enable mutating tools (state/set, circuit-breakers/reset). Default: false */
  allowMutation?: boolean;
  /** Enable verbose debug logging */
  debug?: boolean;
}
