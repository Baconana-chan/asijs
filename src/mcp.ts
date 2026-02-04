/**
 * MCP Server for AsiJS
 * 
 * Model Context Protocol server that provides AI/LLM assistants
 * with deep context about AsiJS applications.
 * 
 * @see https://modelcontextprotocol.io/
 * @module mcp
 */

import { Asi } from "./asi";
import type { AsiPlugin } from "./plugin";
import { createPlugin } from "./plugin";

// ===== Types =====

export interface MCPServerOptions {
  /** Name of the MCP server */
  name?: string;
  
  /** Version of the MCP server */
  version?: string;
  
  /** Port for MCP server (default: 3100) */
  port?: number;
  
  /** Enable debug logging */
  debug?: boolean;
  
  /** Custom tools to expose */
  tools?: MCPTool[];
  
  /** Custom resources to expose */
  resources?: MCPResource[];
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  contents: () => Promise<string>;
}

export interface MCPRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface MCPResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// ===== MCP Server =====

/**
 * MCP Server for exposing AsiJS app context to AI assistants
 */
export class MCPServer {
  private app: Asi;
  private options: Required<MCPServerOptions>;
  private tools: Map<string, MCPTool> = new Map();
  private resources: Map<string, MCPResource> = new Map();
  private boundApp: Asi | null = null;
  
  constructor(app: Asi, options: MCPServerOptions = {}) {
    this.app = app;
    this.options = {
      name: options.name ?? "asijs-mcp-server",
      version: options.version ?? "1.0.0",
      port: options.port ?? 3100,
      debug: options.debug ?? false,
      tools: options.tools ?? [],
      resources: options.resources ?? [],
    };
    
    this.registerBuiltinTools();
    this.registerBuiltinResources();
    
    // Register custom tools
    for (const tool of this.options.tools) {
      this.tools.set(tool.name, tool);
    }
    
    // Register custom resources
    for (const resource of this.options.resources) {
      this.resources.set(resource.uri, resource);
    }
  }
  
  /**
   * Bind to an Asi app for context extraction
   */
  bind(targetApp: Asi): void {
    this.boundApp = targetApp;
  }
  
  /**
   * Register built-in tools
   */
  private registerBuiltinTools(): void {
    // Tool: list_routes
    this.tools.set("list_routes", {
      name: "list_routes",
      description: "List all routes registered in the AsiJS application",
      inputSchema: {
        type: "object",
        properties: {
          method: { type: "string", description: "Filter by HTTP method" },
        },
      },
      handler: async (args) => {
        const app = this.boundApp || this.app;
        const routes = this.getRoutes(app);
        
        if (args.method) {
          return routes.filter(r => r.method === args.method);
        }
        return routes;
      },
    });
    
    // Tool: get_route_details
    this.tools.set("get_route_details", {
      name: "get_route_details",
      description: "Get detailed information about a specific route",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Route path (e.g. /users/:id)" },
          method: { type: "string", description: "HTTP method" },
        },
        required: ["path"],
      },
      handler: async (args) => {
        const app = this.boundApp || this.app;
        const routes = this.getRoutes(app);
        const route = routes.find(r => 
          r.path === args.path && 
          (!args.method || r.method === args.method)
        );
        
        if (!route) {
          return { error: "Route not found" };
        }
        
        return route;
      },
    });
    
    // Tool: get_plugins
    this.tools.set("get_plugins", {
      name: "get_plugins",
      description: "List all registered plugins",
      inputSchema: { type: "object", properties: {} },
      handler: async () => {
        const app = this.boundApp || this.app;
        return this.getPlugins(app);
      },
    });
    
    // Tool: get_middleware
    this.tools.set("get_middleware", {
      name: "get_middleware",
      description: "List all registered middleware",
      inputSchema: { type: "object", properties: {} },
      handler: async () => {
        const app = this.boundApp || this.app;
        return this.getMiddleware(app);
      },
    });
    
    // Tool: get_openapi
    this.tools.set("get_openapi", {
      name: "get_openapi",
      description: "Generate OpenAPI specification for the application",
      inputSchema: {
        type: "object",
        properties: {
          format: { type: "string", enum: ["json", "yaml"], default: "json" },
        },
      },
      handler: async () => {
        const app = this.boundApp || this.app;
        return this.generateOpenAPI(app);
      },
    });
    
    // Tool: analyze_route
    this.tools.set("analyze_route", {
      name: "analyze_route",
      description: "Analyze a route for potential issues or improvements",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Route path" },
        },
        required: ["path"],
      },
      handler: async (args) => {
        const app = this.boundApp || this.app;
        return this.analyzeRoute(app, args.path as string);
      },
    });
    
    // Tool: get_app_state
    this.tools.set("get_app_state", {
      name: "get_app_state",
      description: "Get application state and configuration",
      inputSchema: { type: "object", properties: {} },
      handler: async () => {
        const app = this.boundApp || this.app;
        return this.getAppState(app);
      },
    });
    
    // Tool: suggest_routes
    this.tools.set("suggest_routes", {
      name: "suggest_routes",
      description: "Suggest REST routes for a resource",
      inputSchema: {
        type: "object",
        properties: {
          resource: { type: "string", description: "Resource name (e.g. 'users')" },
        },
        required: ["resource"],
      },
      handler: async (args) => {
        const resource = args.resource as string;
        const singular = resource.endsWith("s") ? resource.slice(0, -1) : resource;
        
        return [
          { method: "GET", path: `/${resource}`, description: `List all ${resource}` },
          { method: "GET", path: `/${resource}/:id`, description: `Get a specific ${singular}` },
          { method: "POST", path: `/${resource}`, description: `Create a new ${singular}` },
          { method: "PUT", path: `/${resource}/:id`, description: `Update a ${singular}` },
          { method: "PATCH", path: `/${resource}/:id`, description: `Partially update a ${singular}` },
          { method: "DELETE", path: `/${resource}/:id`, description: `Delete a ${singular}` },
        ];
      },
    });
  }
  
  /**
   * Register built-in resources
   */
  private registerBuiltinResources(): void {
    // Resource: routes
    this.resources.set("asijs://routes", {
      uri: "asijs://routes",
      name: "Application Routes",
      description: "All registered routes in the application",
      mimeType: "application/json",
      contents: async () => {
        const app = this.boundApp || this.app;
        return JSON.stringify(this.getRoutes(app), null, 2);
      },
    });
    
    // Resource: config
    this.resources.set("asijs://config", {
      uri: "asijs://config",
      name: "Application Configuration",
      mimeType: "application/json",
      contents: async () => {
        const app = this.boundApp || this.app;
        return JSON.stringify(this.getAppState(app), null, 2);
      },
    });
    
    // Resource: openapi
    this.resources.set("asijs://openapi", {
      uri: "asijs://openapi",
      name: "OpenAPI Specification",
      mimeType: "application/json",
      contents: async () => {
        const app = this.boundApp || this.app;
        return JSON.stringify(this.generateOpenAPI(app), null, 2);
      },
    });
    
    // Resource: documentation
    this.resources.set("asijs://docs", {
      uri: "asijs://docs",
      name: "AsiJS Documentation",
      mimeType: "text/markdown",
      contents: async () => {
        return ASIJS_DOCS;
      },
    });
  }
  
  /**
   * Handle MCP request
   */
  async handleRequest(request: MCPRequest): Promise<MCPResponse> {
    const { id, method, params = {} } = request;
    
    if (this.options.debug) {
      console.log(`[MCP] Request: ${method}`, params);
    }
    
    try {
      switch (method) {
        case "initialize":
          return this.success(id, {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: {},
              resources: {},
            },
            serverInfo: {
              name: this.options.name,
              version: this.options.version,
            },
          });
          
        case "tools/list":
          return this.success(id, {
            tools: Array.from(this.tools.values()).map(t => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          });
          
        case "tools/call":
          const toolName = params.name as string;
          const tool = this.tools.get(toolName);
          
          if (!tool) {
            return this.error(id, -32601, `Tool not found: ${toolName}`);
          }
          
          const result = await tool.handler(params.arguments as Record<string, unknown> || {});
          return this.success(id, {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          });
          
        case "resources/list":
          return this.success(id, {
            resources: Array.from(this.resources.values()).map(r => ({
              uri: r.uri,
              name: r.name,
              description: r.description,
              mimeType: r.mimeType,
            })),
          });
          
        case "resources/read":
          const uri = params.uri as string;
          const resource = this.resources.get(uri);
          
          if (!resource) {
            return this.error(id, -32601, `Resource not found: ${uri}`);
          }
          
          const contents = await resource.contents();
          return this.success(id, {
            contents: [{
              uri: resource.uri,
              mimeType: resource.mimeType,
              text: contents,
            }],
          });
          
        case "notifications/initialized":
          // Client initialized, no response needed
          return this.success(id, {});
          
        default:
          return this.error(id, -32601, `Method not found: ${method}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.error(id, -32603, message);
    }
  }
  
  private success(id: string | number, result: unknown): MCPResponse {
    return { jsonrpc: "2.0", id, result };
  }
  
  private error(id: string | number, code: number, message: string): MCPResponse {
    return { jsonrpc: "2.0", id, error: { code, message } };
  }
  
  /**
   * Start MCP server (HTTP transport)
   */
  start(): Asi {
    const server = new Asi({ 
      port: this.options.port,
      silent: true,
      startupBanner: false,
    });
    
    // Handle JSON-RPC requests
    server.post("/", async (ctx) => {
      const body = await ctx.body<MCPRequest>();
      const response = await this.handleRequest(body);
      return response;
    });
    
    // SSE endpoint for notifications
    server.get("/sse", (ctx) => {
      const headers = new Headers({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue("data: {\"type\":\"connected\"}\n\n");
          },
        }),
        { headers }
      );
    });
    
    // Health check
    server.get("/health", () => ({ status: "ok", server: this.options.name }));
    
    server.listen(this.options.port, () => {
      console.log(`🤖 MCP Server "${this.options.name}" running on http://localhost:${this.options.port}`);
    });
    
    return server;
  }
  
  // ===== Helper methods =====
  
  private getRoutes(app: Asi): Array<{
    method: string;
    path: string;
    hasValidation: boolean;
    hasMiddleware: boolean;
  }> {
    // @ts-ignore - accessing private property
    const metadata = app["routeMetadata"] || [];
    
    return metadata.map((m: any) => ({
      method: m.method,
      path: m.path,
      hasValidation: !!(m.schemas?.body || m.schemas?.query || m.schemas?.params),
      hasMiddleware: m.middlewares?.length > 0,
    }));
  }
  
  private getPlugins(app: Asi): string[] {
    // @ts-ignore - accessing private property
    return Array.from(app["_plugins"] || []);
  }
  
  private getMiddleware(app: Asi): {
    global: number;
    pathBased: number;
  } {
    // @ts-ignore - accessing private properties
    return {
      global: app["globalMiddlewares"]?.length || 0,
      pathBased: app["pathMiddlewares"]?.size || 0,
    };
  }
  
  private generateOpenAPI(app: Asi): Record<string, unknown> {
    const routes = this.getRoutes(app);
    const paths: Record<string, unknown> = {};
    
    for (const route of routes) {
      const openApiPath = route.path.replace(/:(\w+)/g, "{$1}");
      
      if (!paths[openApiPath]) {
        paths[openApiPath] = {};
      }
      
      (paths[openApiPath] as Record<string, unknown>)[route.method.toLowerCase()] = {
        summary: `${route.method} ${route.path}`,
        responses: {
          "200": { description: "Successful response" },
        },
      };
    }
    
    return {
      openapi: "3.0.0",
      info: {
        title: "AsiJS Application",
        version: "1.0.0",
      },
      paths,
    };
  }
  
  private analyzeRoute(app: Asi, path: string): {
    path: string;
    issues: string[];
    suggestions: string[];
  } {
    const routes = this.getRoutes(app);
    const route = routes.find(r => r.path === path);
    
    const issues: string[] = [];
    const suggestions: string[] = [];
    
    if (!route) {
      issues.push("Route not found");
      return { path, issues, suggestions };
    }
    
    // Analyze
    if (!route.hasValidation && route.method !== "GET") {
      suggestions.push("Consider adding body validation for non-GET routes");
    }
    
    if (path.includes("_")) {
      suggestions.push("Consider using kebab-case instead of snake_case in URLs");
    }
    
    if (!path.startsWith("/api") && !path.startsWith("/")) {
      issues.push("Route should start with /");
    }
    
    return { path, issues, suggestions };
  }
  
  private getAppState(app: Asi): Record<string, unknown> {
    // @ts-ignore - accessing private properties
    const config = app["config"] || {};
    
    return {
      port: config.port,
      hostname: config.hostname,
      development: config.development,
      routes: this.getRoutes(app).length,
      plugins: this.getPlugins(app),
      middleware: this.getMiddleware(app),
    };
  }
}

// ===== Plugin =====

/**
 * Create MCP server plugin
 */
export function mcp(options: MCPServerOptions = {}): AsiPlugin {
  return createPlugin({
    name: "mcp",
    
    setup(app) {
      const server = new MCPServer(app as unknown as Asi, options);
      app.setState("mcpServer", server);
      
      // Auto-start if port is specified
      if (options.port) {
        server.start();
      }
    },
  });
}

/**
 * Create standalone MCP server for an Asi app
 */
export function createMCPServer(app: Asi, options?: MCPServerOptions): MCPServer {
  return new MCPServer(app, options);
}

// ===== Built-in Documentation =====

const ASIJS_DOCS = `# AsiJS Framework Documentation

## Overview
AsiJS is a Bun-first web framework designed for maximum performance and developer experience.
It provides Elysia-like API with Express-like simplicity.

## Quick Start
\`\`\`typescript
import { Asi } from "asijs";

const app = new Asi();

app.get("/", () => "Hello, AsiJS!");
app.get("/users/:id", (ctx) => ({ id: ctx.params.id }));

app.listen(3000);
\`\`\`

## Routing
- \`app.get(path, handler)\` - GET route
- \`app.post(path, handler)\` - POST route
- \`app.put(path, handler)\` - PUT route
- \`app.delete(path, handler)\` - DELETE route
- \`app.patch(path, handler)\` - PATCH route
- \`app.all(path, handler)\` - All methods

## Validation (TypeBox)
\`\`\`typescript
import { Type } from "asijs";

app.post("/users", (ctx) => ctx.validatedBody, {
  body: Type.Object({
    name: Type.String(),
    email: Type.String({ format: "email" }),
  }),
});
\`\`\`

## Middleware
\`\`\`typescript
app.use(async (ctx, next) => {
  console.log("Before");
  const result = await next();
  console.log("After");
  return result;
});
\`\`\`

## Plugins
- \`cors()\` - CORS support
- \`security()\` - Security headers
- \`openapi()\` - OpenAPI/Swagger docs
- \`rateLimit()\` - Rate limiting
- \`lifecycle()\` - Graceful shutdown
- \`trace()\` - Request tracing
- \`devMode()\` - Development dashboard

## Context (ctx)
- \`ctx.params\` - Route parameters
- \`ctx.query\` - Query parameters
- \`ctx.body<T>()\` - Parse JSON body
- \`ctx.headers\` - Request headers
- \`ctx.cookie(name)\` - Get cookie
- \`ctx.setCookie(name, value)\` - Set cookie
- \`ctx.status(code)\` - Set status
- \`ctx.redirect(url)\` - Redirect

## WebSocket
\`\`\`typescript
app.ws("/chat", {
  open: (ws) => console.log("Connected"),
  message: (ws, msg) => ws.send(\`Echo: \${msg}\`),
  close: (ws) => console.log("Disconnected"),
});
\`\`\`
`;

export { ASIJS_DOCS };
