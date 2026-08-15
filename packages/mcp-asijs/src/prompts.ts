/**
 * asijs-mcp — Built-in prompts
 *
 * Template-driven prompts that ground the AI with real application data:
 * route analysis, CRUD generation, request debugging, security audits,
 * architecture reviews, and route optimization.
 */

import type { MCPServer } from "./server";
import type { MCPPrompt } from "./types";

function routesSummary(server: MCPServer): string {
  const routes = server.runtimeBridge.routes();
  if (!routes.available) return "(no Asi application bound)";
  return routes.routes.map((r) => `${r.method} ${r.path}${r.hasValidation ? " (validated)" : ""}`).join("\n") || "(no routes)";
}

export function createBuiltinPrompts(server: MCPServer): MCPPrompt[] {
  return [
    {
      name: "asijs/analyze-route",
      description:
        "Analyze a specific route for issues: missing validation, naming problems, middleware coverage, security concerns.",
      arguments: [
        { name: "path", description: "Route path to analyze (e.g. /users/:id)", required: true },
        { name: "method", description: "HTTP method to narrow the analysis" },
      ],
      get: (args) => {
        const path = String(args.path);
        const analysis = server.runtimeBridge.analyzeRoute(path, args.method ? String(args.method) : undefined);
        return {
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `Analyze the route ${args.method ?? "ANY"} ${path} in this AsiJS application.

Route details:
${JSON.stringify(analysis, null, 2)}

Registered routes:
${routesSummary(server)}

Provide a concrete, actionable review: validation gaps, middleware coverage, REST conventions, and a recommended fix for each issue.`,
              },
            },
          ],
        };
      },
    },
    {
      name: "asijs/generate-crud",
      description: "Generate a complete REST CRUD implementation (routes, TypeBox schemas, handlers) for a resource.",
      arguments: [
        { name: "resource", description: "Resource name, e.g. 'users' or 'posts'", required: true },
        { name: "fields", description: 'Comma-separated field list, e.g. "id:number,name:string,email:string"' },
      ],
      get: (args) => {
        const resource = String(args.resource);
        const singular = resource.endsWith("s") ? resource.slice(0, -1) : resource;
        const fields = String(args.fields ?? "id:number,name:string");
        const fieldLines = fields
          .split(",")
          .map((f) => f.trim())
          .filter(Boolean)
          .map((f) => {
            const [name, type] = f.split(":");
            return `    ${name}: Type.${capitalize((type ?? "string").trim())}(),`;
          })
          .join("\n");

        return {
          description: `Generate CRUD routes for ${resource}`,
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `Generate a complete, production-ready CRUD API for the "${resource}" resource using AsiJS.

Requirements:
- RESTful routes: GET /${resource}, GET /${resource}/:id, POST /${resource}, PUT /${resource}/:id, PATCH /${resource}/:id, DELETE /${resource}/:id
- TypeBox validation schemas for body/params where applicable, with fields:
${fieldLines}
- A simple in-memory store (Map) with the fields: ${fields}
- Proper status codes (201 on create, 404 on missing ${singular})
- Follow this existing app's conventions. Registered routes:
${routesSummary(server)}

Format the answer as a single TypeScript file with explanatory comments.`,
              },
            },
          ],
        };
      },
    },
    {
      name: "asijs/debug-request",
      description: "Debug a failing request — paste method/path/status/error and get root-cause analysis.",
      arguments: [
        { name: "method", description: "HTTP method", required: true },
        { name: "path", description: "Request path", required: true },
        { name: "status", description: "Response status code" },
        { name: "error", description: "Error message or stack" },
      ],
      get: (args) => ({
        description: "Debug a failing request",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `A request is failing. Debug it.

Request: ${String(args.method)} ${String(args.path)}
Status: ${args.status ?? "unknown"}
Error: ${args.error ?? "(none provided)"}

Registered routes:
${routesSummary(server)}

Diagnose the most likely cause (route not found, validation failure, handler crash, middleware blocking) and give the exact fix.`,
            },
          },
        ],
      }),
    },
    {
      name: "asijs/security-audit",
      description: "Audit the application for security issues: validation, auth, headers, rate limiting, sensitive routes.",
      get: () => {
        const routes = server.runtimeBridge.routes();
        const plugins = server.runtimeBridge.plugins();
        const middleware = server.runtimeBridge.middleware();
        return {
          description: "Security audit of the AsiJS application",
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `Perform a security audit of this AsiJS application.

Routes:
${routesSummary(server)}

Plugins: ${JSON.stringify(plugins)}
Middleware: ${JSON.stringify(middleware)}
Circuit breakers: ${JSON.stringify(server.runtimeBridge.circuitBreakers())}

Check specifically:
1. Non-GET routes without validation
2. Routes that might expose sensitive data (users, tokens, config)
3. Missing security plugins (cors, security headers, rate limit)
4. Any route that returns raw input (XSS risk)
5. Authentication coverage on admin/mutation endpoints

Return a prioritized list of findings with severities and concrete fixes.`,
              },
            },
          ],
        };
      },
    },
    {
      name: "asijs/architecture-review",
      description: "Review the overall application architecture: route organization, plugin usage, middleware strategy.",
      get: () => ({
        description: "Architecture review",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Review the architecture of this AsiJS application.

Routes:
${routesSummary(server)}

Plugins & dependency graph:
${JSON.stringify(server.runtimeBridge.pluginGraph(), null, 2)}

Middleware: ${JSON.stringify(server.runtimeBridge.middleware())}
App state: ${JSON.stringify(server.runtimeBridge.appState())}

Assess: route organization (groups/prefixes), plugin usage, middleware placement, validation coverage, and suggest a concrete refactor if needed.`,
            },
          },
        ],
      }),
    },
    {
      name: "asijs/optimize-routes",
      description: "Find optimization opportunities: repeated paths, missing grouping, validation gaps, non-RESTful design.",
      get: () => {
        const routes = server.runtimeBridge.routes();
        const byPath = new Map<string, string[]>();
        if (routes.available) {
          for (const r of routes.routes) {
            const list = byPath.get(r.path) ?? [];
            list.push(r.method);
            byPath.set(r.path, list);
          }
        }
        const overlaps = Array.from(byPath.entries())
          .filter(([, methods]) => methods.length >= 3)
          .map(([path, methods]) => ({ path, methods }));
        return {
          description: "Route optimization analysis",
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `Find optimization opportunities in this AsiJS application.

Routes:
${routesSummary(server)}

Paths with 3+ methods (candidates for app.group()): ${JSON.stringify(overlaps)}

Recommend: grouping related routes, renaming non-RESTful paths, adding validation where missing, and any deduplication.`,
              },
            },
          ],
        };
      },
    },
  ];
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
