/**
 * asijs-mcp — MCPServer core
 *
 * Transport-agnostic Model Context Protocol v2 server. Handles JSON-RPC
 * dispatch, protocol negotiation (2024-11-05 → 2025-06-18), cursor
 * pagination, progress notifications, cancellation, sampling and roots
 * (server → client), plus the tool/resource/prompt/workflow registries.
 *
 * Plug a transport in with `setClientLink` / `start("stdio")` /
 * `createMCPPlugin(server, options)`.
 */

import {
  coerceParams,
  error,
  isRequest,
  notification,
  parseMessage,
  success,
} from "./jsonrpc";
import { errorResult, stringify, toolResult } from "./content";
import { paginate } from "./pagination";
import { AsiRuntimeBridge } from "./runtime";
import { runWorkflow } from "./workflows";
import { createBuiltinTools } from "./tools";
import { createBuiltinResources } from "./resources";
import { createBuiltinPrompts } from "./prompts";
import { createBuiltinWorkflows } from "./workflows";
import { StdioTransport } from "./transports/stdio";
import { createMCPPlugin, type MCPHTTPOptions } from "./transports/http";
import type { AsiPlugin } from "asijs";
import {
  JSONRPCErrorCodes,
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  type ContentBlock,
  type JSONRPCNotification,
  type JSONRPCRequest,
  type JSONRPCResponse,
  type LogLevel,
  type MCPPrompt,
  type MCPResource,
  type MCPResourceTemplate,
  type MCPServerOptions,
  type MCPTool,
  type MCPRoot,
  type PromptMessage,
  type RequestMeta,
  type SamplingRequest,
  type SamplingResponse,
  type ToolCallResult,
  type ToolContext,
  type Workflow,
} from "./types";

// ============================================================================
// Client link (server → client messages)
// ============================================================================

export interface ClientLink {
  /** Deliver a notification to the client */
  sendNotification?(notification: JSONRPCNotification): void | Promise<void>;
  /** Send a request to the client and await its response (sampling, roots) */
  request?(request: JSONRPCRequest): Promise<unknown>;
}

export interface ClientCapabilities {
  sampling?: boolean;
  roots?: boolean;
  [key: string]: unknown;
}

// ============================================================================
// MCPServer
// ============================================================================

export class MCPServer {
  readonly name: string;
  readonly version: string;
  readonly instructions?: string;

  private options: Required<Pick<MCPServerOptions, "pageSize" | "allowMutation" | "debug">>;
  private protocolVersion: string;

  private tools = new Map<string, MCPTool>();
  private resources = new Map<string, MCPResource>();
  private resourceTemplates = new Map<string, MCPResourceTemplate>();
  private prompts = new Map<string, MCPPrompt>();
  private workflows = new Map<string, Workflow>();

  private runtime: AsiRuntimeBridge;
  private docsDir?: string;

  private clientCapabilities: ClientCapabilities = {};
  private clientVersion: string | null = null;
  private roots: MCPRoot[] = [];
  private cancelled = new Set<string | number>();
  private logLevel: LogLevel = "info";
  private nextRequestId = 1;

  private clientLink: ClientLink | null = null;
  private notificationSinks = new Set<(n: JSONRPCNotification) => void>();

  /**
   * @param app The Asi application to expose (optional — can be bound later)
   * @param options Server configuration
   */
  constructor(app: import("asijs").Asi | null = null, options: MCPServerOptions = {}) {
    this.name = options.name ?? "asijs-mcp";
    this.version = options.version ?? "1.0.0";
    this.instructions = options.instructions;
    this.protocolVersion = options.protocolVersion ?? PROTOCOL_VERSION;
    this.options = {
      pageSize: options.pageSize ?? 50,
      allowMutation: options.allowMutation ?? false,
      debug: options.debug ?? false,
    };
    this.docsDir = options.docsDir;
    this.runtime = new AsiRuntimeBridge(app, options.runtime);

    // Built-ins first, then user-provided (user wins on name conflicts)
    this.registerBuiltinTools();
    this.registerBuiltinResources();
    this.registerBuiltinPrompts();
    for (const workflow of createBuiltinWorkflows()) this.addWorkflow(workflow);

    for (const tool of options.tools ?? []) this.addTool(tool);
    for (const resource of options.resources ?? []) this.addResource(resource);
    for (const template of options.resourceTemplates ?? []) this.addResourceTemplate(template);
    for (const prompt of options.prompts ?? []) this.addPrompt(prompt);
    for (const workflow of options.workflows ?? []) this.addWorkflow(workflow);
  }

  /** Bind (or rebind) the Asi application */
  bind(app: import("asijs").Asi | null): this {
    this.runtime.setApp(app);
    return this;
  }

  // ===== Registration =====

  addTool(tool: MCPTool): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  addResource(resource: MCPResource): this {
    this.resources.set(resource.uri, resource);
    return this;
  }

  addResourceTemplate(template: MCPResourceTemplate): this {
    this.resourceTemplates.set(template.uriTemplate, template);
    return this;
  }

  addPrompt(prompt: MCPPrompt): this {
    this.prompts.set(prompt.name, prompt);
    return this;
  }

  addWorkflow(workflow: Workflow): this {
    this.workflows.set(workflow.name, workflow);
    return this;
  }

  get toolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /** Whether mutating tools (state/set, circuit-breakers/reset) are enabled */
  get allowMutation(): boolean {
    return this.options.allowMutation;
  }

  /** Page size for cursor-paginated lists */
  get pageSize(): number {
    return this.options.pageSize;
  }

  /** The AsiJS runtime bridge (routes, circuit breakers, rooms, …) */
  get runtimeBridge(): AsiRuntimeBridge {
    return this.runtime;
  }

  /** Configured docs directory (if any) */
  get docsDirPath(): string | undefined {
    return this.docsDir;
  }

  get workflowNames(): string[] {
    return Array.from(this.workflows.keys());
  }

  /** Get a registered workflow by name */
  workflow(name: string): Workflow | undefined {
    return this.workflows.get(name);
  }

  /** Execute a registered workflow (used by the workflow tools) */
  async runWorkflow(
    name: string,
    input: Record<string, unknown>,
    progressCtx: Pick<ToolContext, "progress" | "log" | "cancelled">,
  ): Promise<unknown> {
    const workflow = this.workflows.get(name);
    if (!workflow) throw new Error(`Workflow not found: ${name}`);
    return runWorkflow(workflow, input, {
      progress: progressCtx.progress,
      log: progressCtx.log,
      cancelled: progressCtx.cancelled,
      runtime: this.runtime,
    });
  }

  // ===== Client link =====

  /**
   * Attach a client link so the server can send notifications and requests
   * (sampling, roots) to the client.
   */
  setClientLink(link: ClientLink | null): void {
    this.clientLink = link;
  }

  /** Subscribe to server-initiated notifications (used by SSE transport) */
  onNotification(sink: (n: JSONRPCNotification) => void): () => void {
    this.notificationSinks.add(sink);
    return () => this.notificationSinks.delete(sink);
  }

  /** Send a notification to the client */
  sendNotification(method: string, params?: Record<string, unknown>): void {
    const n = notification(method, params);
    for (const sink of this.notificationSinks) {
      try {
        sink(n);
      } catch (err) {
        this.debug(`notification sink error: ${String(err)}`);
      }
    }
    this.clientLink?.sendNotification?.(n);
  }

  /** Emit a progress notification (no-op without a progress token) */
  notifyProgress(token: string | number | undefined, progress: number, total?: number, message?: string): void {
    if (token === undefined) return;
    this.sendNotification("notifications/progress", {
      progressToken: token,
      progress,
      ...(total !== undefined ? { total } : {}),
      ...(message !== undefined ? { message } : {}),
    });
  }

  /** Emit a log notification */
  log(level: LogLevel, data: unknown, logger?: string): void {
    this.sendNotification("notifications/message", {
      level,
      data,
      ...(logger ? { logger } : {}),
    });
  }

  // ===== Server → client requests =====

  /** Ask the client to generate a message (requires client `sampling` capability) */
  async requestSampling(params: SamplingRequest): Promise<SamplingResponse | null> {
    if (!this.clientCapabilities.sampling) return null;
    if (!this.clientLink?.request) return null;
    const response = await this.clientLink.request({
      jsonrpc: "2.0",
      id: this.nextRequestId++,
      method: "sampling/createMessage",
      params: params as unknown as Record<string, unknown>,
    });
    return response as SamplingResponse;
  }

  /** Ask the client for its project roots (requires client `roots` capability) */
  async requestRootsList(): Promise<MCPRoot[] | null> {
    if (!this.clientCapabilities.roots) return null;
    if (!this.clientLink?.request) return null;
    const response = (await this.clientLink.request({
      jsonrpc: "2.0",
      id: this.nextRequestId++,
      method: "roots/list",
      params: {},
    })) as { roots?: MCPRoot[] };
    this.roots = response?.roots ?? [];
    return this.roots;
  }

  /** The roots reported by the client (if any) */
  get clientRoots(): MCPRoot[] {
    return [...this.roots];
  }

  // ===== Message handling =====

  /**
   * Handle a single JSON-RPC message.
   * Notifications resolve to `null` (no response expected).
   */
  async handleMessage(msg: JSONRPCRequest | JSONRPCNotification): Promise<JSONRPCResponse | null> {
    if (!isRequest(msg)) {
      await this.handleNotification(msg);
      return null;
    }
    return this.handleRequest(msg);
  }

  /**
   * Handle a raw message: a single message, a JSON string, or a batch array.
   * Returns a response, an array of responses, or null (all notifications).
   */
  async handleRaw(raw: string | unknown): Promise<JSONRPCResponse | JSONRPCResponse[] | null> {
    const parsed = parseMessage(raw);

    if (parsed.response) return parsed.response;
    if (parsed.batch) {
      const responses: JSONRPCResponse[] = [];
      for (const msg of parsed.batch) {
        const response = await this.handleMessage(msg);
        if (response) responses.push(response);
      }
      return responses.length > 0 ? responses : null;
    }
    if (parsed.message) return this.handleMessage(parsed.message);
    return error(null, JSONRPCErrorCodes.INVALID_REQUEST, "Invalid Request");
  }

  private debug(...args: unknown[]): void {
    if (this.options.debug) console.error("[asijs-mcp]", ...args);
  }

  // ===== Request dispatch =====

  private async handleRequest(request: JSONRPCRequest): Promise<JSONRPCResponse> {
    const { id, method, params } = request;
    this.debug(`request ${method}`, params);

    const paramsResult = coerceParams(params);
    if (!paramsResult.ok) return paramsResult.response;

    try {
      switch (method) {
        case "initialize":
          return this.handleInitialize(id, paramsResult.params);
        case "ping":
          return success(id, {});
        case "tools/list":
          return this.handleToolsList(id, paramsResult.params);
        case "tools/call":
          return this.handleToolsCall(id, paramsResult.params);
        case "resources/list":
          return this.handleResourcesList(id, paramsResult.params);
        case "resources/templates/list":
          return success(id, {
            resourceTemplates: Array.from(this.resourceTemplates.values()).map((t) => ({
              uriTemplate: t.uriTemplate,
              name: t.name,
              description: t.description,
              mimeType: t.mimeType,
            })),
          });
        case "resources/read":
          return this.handleResourcesRead(id, paramsResult.params);
        case "prompts/list":
          return this.handlePromptsList(id, paramsResult.params);
        case "prompts/get":
          return this.handlePromptsGet(id, paramsResult.params);
        case "completion/complete":
          return this.handleCompletion(id, paramsResult.params);
        case "logging/setLevel":
          return this.handleSetLogLevel(id, paramsResult.params);
        case "sampling/createMessage":
          return this.handleInboundSampling(id, paramsResult.params);
        default:
          return error(id, JSONRPCErrorCodes.METHOD_NOT_FOUND, `Method not found: ${method}`);
      }
    } catch (err) {
      this.debug(`error in ${method}:`, err);
      return error(id, JSONRPCErrorCodes.INTERNAL_ERROR, err instanceof Error ? err.message : String(err));
    }
  }

  // ===== Initialize =====

  private handleInitialize(id: string | number, params: Record<string, unknown>): JSONRPCResponse {
    const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : undefined;
    const clientCaps = (params.capabilities ?? {}) as Record<string, unknown>;

    this.clientVersion = requested ?? null;
    this.clientCapabilities = {
      sampling: Boolean((clientCaps.sampling as { sampling?: unknown } | undefined)?.sampling ?? clientCaps.sampling),
      roots: Boolean((clientCaps.roots as { roots?: unknown } | undefined)?.roots ?? clientCaps.roots),
    };
    // Client may enable sampling/roots via `{ sampling: {}, roots: {} }` objects
    if (clientCaps.sampling && typeof clientCaps.sampling === "object") this.clientCapabilities.sampling = true;
    if (clientCaps.roots && typeof clientCaps.roots === "object") this.clientCapabilities.roots = true;

    const negotiated = requested && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
      ? requested
      : this.protocolVersion;

    return success(id, {
      protocolVersion: negotiated,
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
        logging: {},
        completions: {},
      },
      serverInfo: { name: this.name, version: this.version },
      ...(this.instructions ? { instructions: this.instructions } : {}),
    });
  }

  // ===== Notifications =====

  private async handleNotification(n: JSONRPCNotification): Promise<void> {
    switch (n.method) {
      case "notifications/initialized":
      case "notifications/resources/updated":
        return;
      case "notifications/cancelled": {
        const requestId = (n.params as { requestId?: string | number } | undefined)?.requestId;
        if (requestId !== undefined) this.cancelled.add(requestId);
        return;
      }
      case "notifications/roots/list_changed": {
        // Roots changed — re-request them from the client
        try {
          await this.requestRootsList();
        } catch {
          // Client may not respond — ignore
        }
        return;
      }
      default:
        return;
    }
  }

  // ===== Tools =====

  private handleToolsList(id: string | number, params: Record<string, unknown>): JSONRPCResponse {
    const { items, nextCursor } = paginate(
      Array.from(this.tools.values()).map((t) => ({
        name: t.name,
        ...(t.description ? { description: t.description } : {}),
        inputSchema: t.inputSchema ?? { type: "object", properties: {} },
      })),
      typeof params.cursor === "string" ? params.cursor : undefined,
      this.options.pageSize,
    );
    return success(id, {
      tools: items,
      ...(nextCursor ? { _meta: { nextCursor } } : {}),
    });
  }

  private async handleToolsCall(id: string | number, params: Record<string, unknown>): Promise<JSONRPCResponse> {
    const name = params.name as string;
    const tool = this.tools.get(name);
    if (!tool) {
      return success(id, toolResult(`Tool not found: ${name}`, true));
    }

    const args = (params.arguments ?? {}) as Record<string, unknown>;
    const meta = (params._meta ?? {}) as RequestMeta;
    const progressToken = meta.progressToken;

    const ctx: ToolContext = {
      progressToken,
      progress: (progress, total, message) =>
        this.notifyProgress(progressToken, progress, total, message),
      log: (level, data, logger) => this.log(level, data, logger),
      cancelled: () => this.cancelled.has(id),
      server: this,
    };

    try {
      const result = await tool.handler(args, ctx);
      return success(id, toolResult(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.debug(`tool ${name} failed:`, err);
      return success(id, errorResult(message));
    } finally {
      this.cancelled.delete(id);
    }
  }

  // ===== Resources =====

  private handleResourcesList(id: string | number, params: Record<string, unknown>): JSONRPCResponse {
    const { items, nextCursor } = paginate(
      Array.from(this.resources.values()).map((r) => ({
        uri: r.uri,
        name: r.name,
        ...(r.description ? { description: r.description } : {}),
        ...(r.mimeType ? { mimeType: r.mimeType } : {}),
      })),
      typeof params.cursor === "string" ? params.cursor : undefined,
      this.options.pageSize,
    );
    return success(id, {
      resources: items,
      ...(nextCursor ? { _meta: { nextCursor } } : {}),
    });
  }

  private resolveResource(uri: string): MCPResource | null {
    const direct = this.resources.get(uri);
    if (direct) return direct;
    for (const template of this.resourceTemplates.values()) {
      const resolved = template.resolve(uri);
      if (resolved) return resolved;
    }
    return null;
  }

  private async handleResourcesRead(id: string | number, params: Record<string, unknown>): Promise<JSONRPCResponse> {
    const uri = params.uri as string;
    if (typeof uri !== "string" || !uri) {
      return error(id, JSONRPCErrorCodes.INVALID_PARAMS, "Missing required parameter: uri");
    }

    const resource = this.resolveResource(uri);
    if (!resource) {
      return error(id, JSONRPCErrorCodes.INVALID_PARAMS, `Resource not found: ${uri}`);
    }

    let contents: string | { text?: string; blob?: string; mimeType?: string };
    if (resource.contents) {
      const raw = await resource.contents();
      contents = typeof raw === "string" ? raw : raw;
    } else if (resource.text !== undefined) {
      contents = resource.text;
    } else {
      return error(id, JSONRPCErrorCodes.INTERNAL_ERROR, `Resource ${uri} has no contents`);
    }

    const block = typeof contents === "string"
      ? { uri, mimeType: resource.mimeType, text: contents }
      : { uri, mimeType: contents.mimeType ?? resource.mimeType, ...(contents.text !== undefined ? { text: contents.text } : {}), ...(contents.blob !== undefined ? { blob: contents.blob } : {}) };

    return success(id, { contents: [block] });
  }

  // ===== Prompts =====

  private handlePromptsList(id: string | number, params: Record<string, unknown>): JSONRPCResponse {
    const { items, nextCursor } = paginate(
      Array.from(this.prompts.values()).map((p) => ({
        name: p.name,
        ...(p.description ? { description: p.description } : {}),
        ...(p.arguments && p.arguments.length > 0 ? { arguments: p.arguments } : {}),
      })),
      typeof params.cursor === "string" ? params.cursor : undefined,
      this.options.pageSize,
    );
    return success(id, {
      prompts: items,
      ...(nextCursor ? { _meta: { nextCursor } } : {}),
    });
  }

  private async handlePromptsGet(id: string | number, params: Record<string, unknown>): Promise<JSONRPCResponse> {
    const name = params.name as string;
    const prompt = this.prompts.get(name);
    if (!prompt) {
      return error(id, JSONRPCErrorCodes.INVALID_PARAMS, `Prompt not found: ${name}`);
    }

    const args = (params.arguments ?? {}) as Record<string, unknown>;

    // Validate required arguments
    for (const arg of prompt.arguments ?? []) {
      if (arg.required && args[arg.name] === undefined) {
        return error(id, JSONRPCErrorCodes.INVALID_PARAMS, `Missing required argument: ${arg.name}`);
      }
    }

    const result = await prompt.get(args);
    const messages: PromptMessage[] = result.messages;
    return success(id, {
      ...(result.description ? { description: result.description } : {}),
      messages,
    });
  }

  // ===== Completion =====

  private handleCompletion(id: string | number, params: Record<string, unknown>): JSONRPCResponse {
    const ref = (params.ref ?? {}) as { type?: string; name?: string };
    const argument = (params.argument ?? {}) as { name?: string; value?: unknown };
    const prefix = typeof argument.value === "string" ? argument.value : "";

    let candidates: string[] = [];
    switch (ref.type) {
      case "ref/tool":
        candidates = Array.from(this.tools.keys());
        break;
      case "ref/prompt":
        candidates = Array.from(this.prompts.keys());
        break;
      case "ref/resource":
        candidates = Array.from(this.resources.keys());
        break;
      case "ref/workflow":
        candidates = Array.from(this.workflows.keys());
        break;
      default:
        return success(id, { completion: { values: [], total: 0, hasMore: false, _type: "list" } });
    }

    const values = prefix
      ? candidates.filter((c) => c.toLowerCase().includes(prefix.toLowerCase()))
      : candidates;

    return success(id, {
      completion: { values: values.slice(0, 100), total: values.length, hasMore: values.length > 100, _type: "list" },
    });
  }

  // ===== Logging =====

  private handleSetLogLevel(id: string | number, params: Record<string, unknown>): JSONRPCResponse {
    const level = params.level as LogLevel;
    const allowed: LogLevel[] = ["debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"];
    if (!allowed.includes(level)) {
      return error(id, JSONRPCErrorCodes.INVALID_PARAMS, `Invalid log level: ${String(level)}`);
    }
    this.logLevel = level;
    return success(id, {});
  }

  // ===== Sampling (inbound — forwarded to the real client) =====

  private async handleInboundSampling(id: string | number, params: Record<string, unknown>): Promise<JSONRPCResponse> {
    if (!this.clientLink?.request) {
      return error(id, JSONRPCErrorCodes.METHOD_NOT_FOUND, "No client link available for sampling/createMessage");
    }
    try {
      const result = await this.clientLink.request({
        jsonrpc: "2.0",
        id: this.nextRequestId++,
        method: "sampling/createMessage",
        params,
      });
      return success(id, result);
    } catch (err) {
      return error(id, JSONRPCErrorCodes.INTERNAL_ERROR, err instanceof Error ? err.message : String(err));
    }
  }

  // ===== Transports =====

  /**
   * Start a transport. Defaults to stdio (Claude Desktop, Cursor, Zed).
   *
   * @example
   * ```ts
   * const server = mcp(app);
   * server.start();          // stdio
   * server.start("stdio");
   * ```
   */
  start(transport: "stdio" | StdioTransport = "stdio"): StdioTransport {
    const t = transport === "stdio" ? new StdioTransport(this) : transport;
    t.start();
    return t;
  }

  /**
   * Mount the HTTP/SSE transport onto the bound Asi app.
   * Returns the plugin (also auto-mounted when an app is bound).
   */
  startHTTP(options: MCPHTTPOptions = {}): AsiPlugin {
    const plugin = createMCPPlugin(this, options);
    const app = this.runtime.appInstance;
    if (app && typeof (app as unknown as { plugin?: unknown }).plugin === "function") {
      (app as unknown as { plugin(p: AsiPlugin): unknown }).plugin(plugin);
    }
    return plugin;
  }

  // ===== Built-ins =====

  private registerBuiltinTools(): void {
    // NOTE: tools/resources/prompts only `import type` from this module,
    // so there is no runtime circular dependency.
    for (const tool of createBuiltinTools(this)) {
      if (!this.tools.has(tool.name)) this.addTool(tool);
    }
  }

  private registerBuiltinResources(): void {
    for (const resource of createBuiltinResources(this, this.docsDir)) {
      if (!this.resources.has(resource.uri)) this.addResource(resource);
    }
  }

  private registerBuiltinPrompts(): void {
    for (const prompt of createBuiltinPrompts(this)) {
      if (!this.prompts.has(prompt.name)) this.addPrompt(prompt);
    }
  }
}
