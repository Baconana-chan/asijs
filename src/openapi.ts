/**
 * OpenAPI / Swagger generation for AsiJS
 *
 * Generates OpenAPI 3.0 specification from route definitions and TypeBox schemas.
 *
 * @example
 * ```ts
 * import { Asi, Type, openapi } from "asijs";
 *
 * const app = new Asi();
 *
 * app.get("/users/:id", (ctx) => ({ id: ctx.params.id }), {
 *   schema: {
 *     params: Type.Object({ id: Type.String() }),
 *     response: Type.Object({ id: Type.String() }),
 *   }
 * });
 *
 * // Generate OpenAPI spec
 * app.plugin(openapi({
 *   title: "My API",
 *   version: "1.0.0",
 *   description: "My awesome API",
 * }));
 *
 * // Swagger UI at /docs
 * // OpenAPI JSON at /openapi.json
 * ```
 */

import type { TSchema } from "@sinclair/typebox";
import { createPlugin, type AsiPlugin } from "./plugin";
import type { RouteMethod } from "./types";

// ===== OpenAPI Types =====

export interface OpenAPIInfo {
  title: string;
  version: string;
  description?: string;
  termsOfService?: string;
  contact?: {
    name?: string;
    url?: string;
    email?: string;
  };
  license?: {
    name: string;
    url?: string;
  };
}

export interface OpenAPIServer {
  url: string;
  description?: string;
}

export interface OpenAPITag {
  name: string;
  description?: string;
}

export interface OpenAPIOptions {
  /** API title */
  title: string;
  /** API version */
  version: string;
  /** API description */
  description?: string;
  /** OpenAPI spec path (default: /openapi.json) */
  specPath?: string;
  /** Swagger UI path (default: /docs) */
  docsPath?: string;
  /** Servers list */
  servers?: OpenAPIServer[];
  /** Tags for grouping */
  tags?: OpenAPITag[];
  /** Security schemes */
  securitySchemes?: Record<string, OpenAPISecurityScheme>;
  /** Global security requirements */
  security?: Array<Record<string, string[]>>;
  /** Custom info fields */
  info?: Partial<OpenAPIInfo>;
}

export interface OpenAPISecurityScheme {
  type: "apiKey" | "http" | "oauth2" | "openIdConnect";
  description?: string;
  name?: string;
  in?: "query" | "header" | "cookie";
  scheme?: string;
  bearerFormat?: string;
  flows?: Record<string, unknown>;
  openIdConnectUrl?: string;
}

export interface OpenAPIDocument {
  openapi: "3.0.3";
  info: OpenAPIInfo;
  servers?: OpenAPIServer[];
  tags?: OpenAPITag[];
  paths: Record<string, Record<string, OpenAPIOperation>>;
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, OpenAPISecurityScheme>;
  };
  security?: Array<Record<string, string[]>>;
}

export interface OpenAPIOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenAPIParameter[];
  requestBody?: OpenAPIRequestBody;
  responses: Record<string, OpenAPIResponse>;
  security?: Array<Record<string, string[]>>;
  deprecated?: boolean;
}

export interface OpenAPIParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  description?: string;
  required?: boolean;
  schema: unknown;
  deprecated?: boolean;
}

export interface OpenAPIRequestBody {
  description?: string;
  required?: boolean;
  content: Record<string, { schema: unknown }>;
}

export interface OpenAPIResponse {
  description: string;
  content?: Record<string, { schema: unknown }>;
  headers?: Record<string, { schema: unknown; description?: string }>;
}

// ===== Route Metadata for OpenAPI =====

export interface RouteDocumentation {
  /** Operation summary */
  summary?: string;
  /** Operation description */
  description?: string;
  /** Tags for grouping */
  tags?: string[];
  /** Operation ID */
  operationId?: string;
  /** Mark as deprecated */
  deprecated?: boolean;
  /** Security requirements */
  security?: Array<Record<string, string[]>>;
}

/** Extended route metadata including documentation */
export interface DocumentedRoute {
  method: RouteMethod;
  path: string;
  schemas?: {
    body?: TSchema;
    query?: TSchema;
    params?: TSchema;
    headers?: TSchema;
    response?: TSchema;
  };
  docs?: RouteDocumentation;
}

// ===== TypeBox to JSON Schema conversion =====

function typeboxToJsonSchema(schema: TSchema): unknown {
  // TypeBox schemas are already JSON Schema compatible
  // We just need to clean up internal symbols
  const clone = JSON.parse(JSON.stringify(schema));

  // Remove TypeBox-specific symbols
  delete clone[Symbol.for("TypeBox.Kind")];

  return clone;
}

function extractPathParams(path: string): string[] {
  const params: string[] = [];
  const regex = /:([^/]+)/g;
  let match;
  while ((match = regex.exec(path)) !== null) {
    params.push(match[1]);
  }
  return params;
}

function convertPathToOpenAPI(path: string): string {
  // Convert :param to {param}
  return path.replace(/:([^/]+)/g, "{$1}");
}

// ===== OpenAPI Generator =====

export class OpenAPIGenerator {
  private routes: DocumentedRoute[] = [];
  private options: OpenAPIOptions;

  constructor(options: OpenAPIOptions) {
    this.options = options;
  }

  /** Add a route to the documentation */
  addRoute(route: DocumentedRoute): void {
    this.routes.push(route);
  }

  /** Generate OpenAPI document */
  generate(): OpenAPIDocument {
    const doc: OpenAPIDocument = {
      openapi: "3.0.3",
      info: {
        title: this.options.title,
        version: this.options.version,
        description: this.options.description,
        ...this.options.info,
      },
      paths: {},
    };

    if (this.options.servers) {
      doc.servers = this.options.servers;
    }

    if (this.options.tags) {
      doc.tags = this.options.tags;
    }

    if (this.options.securitySchemes) {
      doc.components = {
        securitySchemes: this.options.securitySchemes,
      };
    }

    if (this.options.security) {
      doc.security = this.options.security;
    }

    // Group routes by path
    for (const route of this.routes) {
      if (route.method === "ALL") continue; // Skip ALL routes

      const openApiPath = convertPathToOpenAPI(route.path);
      const method = route.method.toLowerCase();

      if (!doc.paths[openApiPath]) {
        doc.paths[openApiPath] = {};
      }

      const operation = this.buildOperation(route);
      doc.paths[openApiPath][method] = operation;
    }

    return doc;
  }

  private buildOperation(route: DocumentedRoute): OpenAPIOperation {
    const operation: OpenAPIOperation = {
      responses: {
        "200": {
          description: "Successful response",
        },
      },
    };

    // Add documentation
    if (route.docs) {
      if (route.docs.summary) operation.summary = route.docs.summary;
      if (route.docs.description)
        operation.description = route.docs.description;
      if (route.docs.tags) operation.tags = route.docs.tags;
      if (route.docs.operationId)
        operation.operationId = route.docs.operationId;
      if (route.docs.deprecated) operation.deprecated = route.docs.deprecated;
      if (route.docs.security) operation.security = route.docs.security;
    }

    // Build parameters
    const parameters: OpenAPIParameter[] = [];

    // Path parameters
    const pathParams = extractPathParams(route.path);
    if (route.schemas?.params) {
      const paramsSchema = typeboxToJsonSchema(route.schemas.params) as any;
      for (const paramName of pathParams) {
        const paramSchema = paramsSchema.properties?.[paramName] || {
          type: "string",
        };
        parameters.push({
          name: paramName,
          in: "path",
          required: true,
          schema: paramSchema,
          description: paramSchema.description,
        });
      }
    } else {
      // Add path params without schema
      for (const paramName of pathParams) {
        parameters.push({
          name: paramName,
          in: "path",
          required: true,
          schema: { type: "string" },
        });
      }
    }

    // Query parameters
    if (route.schemas?.query) {
      const querySchema = typeboxToJsonSchema(route.schemas.query) as any;
      const required = querySchema.required || [];

      for (const [name, propSchema] of Object.entries(
        querySchema.properties || {},
      )) {
        const schema = propSchema as any;
        parameters.push({
          name,
          in: "query",
          required: required.includes(name),
          schema,
          description: schema.description,
        });
      }
    }

    // Header parameters
    if (route.schemas?.headers) {
      const headersSchema = typeboxToJsonSchema(route.schemas.headers) as any;
      const required = headersSchema.required || [];

      for (const [name, propSchema] of Object.entries(
        headersSchema.properties || {},
      )) {
        const schema = propSchema as any;
        parameters.push({
          name,
          in: "header",
          required: required.includes(name),
          schema,
          description: schema.description,
        });
      }
    }

    if (parameters.length > 0) {
      operation.parameters = parameters;
    }

    // Request body
    if (
      route.schemas?.body &&
      ["POST", "PUT", "PATCH"].includes(route.method)
    ) {
      const bodySchema = typeboxToJsonSchema(route.schemas.body);
      operation.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: bodySchema,
          },
        },
      };
    }

    // Response schema
    if (route.schemas?.response) {
      const responseSchema = typeboxToJsonSchema(route.schemas.response);
      operation.responses["200"] = {
        description: "Successful response",
        content: {
          "application/json": {
            schema: responseSchema,
          },
        },
      };
    }

    // Add common error responses
    operation.responses["400"] = { description: "Bad Request" };
    operation.responses["500"] = { description: "Internal Server Error" };

    return operation;
  }
}

// ===== Swagger UI HTML =====

function generateSwaggerUI(specUrl: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - API Documentation</title>
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <style>
    html { box-sizing: border-box; overflow-y: scroll; }
    *, *:before, *:after { box-sizing: inherit; }
    body { margin: 0; background: #fafafa; }
    .swagger-ui .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function() {
      SwaggerUIBundle({
        url: "${specUrl}",
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset
        ],
        layout: "StandaloneLayout"
      });
    };
  </script>
</body>
</html>`;
}

// ===== OpenAPI Plugin =====

/**
 * Create OpenAPI documentation plugin
 *
 * @example
 * ```ts
 * app.plugin(openapi({
 *   title: "My API",
 *   version: "1.0.0",
 *   tags: [
 *     { name: "users", description: "User operations" }
 *   ],
 *   securitySchemes: {
 *     bearerAuth: {
 *       type: "http",
 *       scheme: "bearer",
 *       bearerFormat: "JWT"
 *     }
 *   }
 * }));
 * ```
 */
export function openapi(options: OpenAPIOptions): AsiPlugin {
  const specPath = options.specPath ?? "/openapi.json";
  const docsPath = options.docsPath ?? "/docs";

  return createPlugin({
    name: "openapi",

    setup(app) {
      // We need to access route metadata from the app
      // Store generator in state for later use
      const generator = new OpenAPIGenerator(options);
      app.setState("openapi:generator", generator);

      // Serve OpenAPI JSON
      app.get(specPath, () => {
        const gen = app.getState<OpenAPIGenerator>("openapi:generator");
        if (!gen) {
          return { error: "OpenAPI generator not found" };
        }

        // Get routes from app state
        const routes = app.getState<DocumentedRoute[]>("openapi:routes") ?? [];
        for (const route of routes) {
          gen.addRoute(route);
        }

        return gen.generate();
      });

      // Serve Swagger UI
      app.get(docsPath, (ctx) => {
        const baseUrl = `${ctx.url.protocol}//${ctx.url.host}`;
        const html = generateSwaggerUI(`${baseUrl}${specPath}`, options.title);
        return ctx.html(html);
      });
    },
  });
}

/**
 * Collect route metadata for OpenAPI documentation.
 * Call this after all routes are registered but before app.listen().
 *
 * @example
 * ```ts
 * const app = new Asi();
 * // ... register routes ...
 * collectRoutes(app);
 * app.listen(3000);
 * ```
 */
export function collectRoutes(app: {
  setState: (key: string, value: unknown) => void;
  // Access internal route metadata - this will need to be exposed by Asi
}): void {
  // This function will be called by the user to trigger route collection
  // The actual collection happens in the Asi class
}
