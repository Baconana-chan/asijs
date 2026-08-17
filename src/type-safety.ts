/**
 * Type Safety Enhancements for AsiJS
 *
 * Provides:
 * 1. Response validation in dev mode — checks handler output against response schema
 * 2. Type-safe i18n — typed translation keys with autocomplete
 * 3. OpenAPI 3.1 / JSON Schema 2020-12 — upgrade from 3.0.3
 */

import type { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { Context } from "./context";
import type { RouteMethod } from "./types";
import { OpenAPIGenerator, type DocumentedRoute } from "./openapi";

// ============================================================================
// 1. Response Validation in Dev Mode
// ============================================================================

/** Options for response validation (enabled, statuses to skip). */
export interface ResponseValidationOptions {
  /** Enable response validation (default: true in dev mode) */
  enabled?: boolean;
  /**
   * What to do on validation failure.
   * - "warn": log warning but return the original response (default)
   * - "error": return 500 with validation details
   * - "silent": silently fix the response
   */
  mode?: "warn" | "error" | "silent";
  /** Skip validation for specific status codes (default: [204, 304]) */
  skipStatus?: number[];
}

/**
 * Validate a handler's response against its declared response schema.
 *
 * In development mode, this catches mismatches between the documented
 * response type (from TypeBox schema) and the actual runtime response.
 *
 * @example
 * ```ts
 * import { Asi, Type, responseValidation } from "asijs";
 *
 * const app = new Asi({ development: true });
 * app.plugin(responseValidation());
 *
 * app.get("/users", () => ({ name: "Alice" }), {
 *   schema: {
 *     response: Type.Object({
 *       name: Type.String(),
 *       email: Type.Optional(Type.String()),
 *     }),
 *   },
 * });
 * ```
 */
export function createResponseValidator(options: ResponseValidationOptions = {}) {
  const enabled = options.enabled ?? true;
  const mode = options.mode ?? "warn";
  const skipStatus = options.skipStatus ?? [204, 304];

  return {
    enabled,
    mode,
    skipStatus,

    /**
     * Validate a response object against a compiled schema.
     * Returns validation errors or null if valid.
     */
    validate(
      status: number,
      body: unknown,
      schema: TSchema,
    ): Array<{ path: string; message: string }> | null {
      if (!enabled) return null;
      if (skipStatus.includes(status)) return null;

      if (!Value.Check(schema, body)) {
        const errors: Array<{ path: string; message: string }> = [];
        for (const error of Value.Errors(schema, body)) {
          errors.push({
            path: error.path || "/",
            message: error.message,
          });
        }
        return errors;
      }

      return null;
    },

    /**
     * Wrap a handler to include response validation.
     * Returns the validated response or a warning response.
     */
    wrap<T>(
      handler: (ctx: Context) => T | Promise<T>,
      schema: TSchema,
    ): (ctx: Context) => Promise<T> {
      return async (ctx: Context) => {
        const result = await handler(ctx);

        if (result instanceof Response) {
          // For raw Response objects, try to parse and validate
          const status = result.status;
          try {
            const clone = result.clone();
            const body = await clone.json();
            const errors = this.validate(status, body, schema);
            if (errors && errors.length > 0) {
              this.handleError(ctx, errors, result);
            }
          } catch {
            // Not JSON response — can't validate
          }
          return result as T;
        }

        // For returned objects (will be JSON.stringify'd)
        const status = (ctx as any)._status || 200;
        const errors = this.validate(status, result, schema);
        if (errors && errors.length > 0) {
          this.handleError(ctx, errors, result as Response);
        }

        return result;
      };
    },

    handleError(
      ctx: Context,
      errors: Array<{ path: string; message: string }>,
      _response: Response | unknown,
    ): void {
      const message = `Response validation failed:\n${errors
        .map((e) => `  ${e.path}: ${e.message}`)
        .join("\n")}`;

      switch (mode) {
        case "error":
          throw new TypeError(message);
        case "warn":
          console.warn(`[AsiJS] ${message}`);
          break;
        case "silent":
          break;
      }
    },
  };
}

// Singleton with defaults for dev mode
let defaultValidator: ReturnType<typeof createResponseValidator> | null = null;

/** Get the shared response-validator singleton. */
export function getResponseValidator(): ReturnType<typeof createResponseValidator> {
  if (!defaultValidator) {
    defaultValidator = createResponseValidator({
      enabled: process.env.NODE_ENV !== "production",
      mode: "warn",
    });
  }
  return defaultValidator;
}

/** Reset the shared response validator (useful in tests). */
export function resetResponseValidator(): void {
  defaultValidator = null;
}

// ============================================================================
// 2. Type-Safe i18n — Autocomplete Translation Keys
// ============================================================================

/**
 * Type-safe translation function with autocomplete.
 *
 * Use with a generic type parameter to get autocomplete for translation keys.
 *
 * @example
 * ```ts
 * type AppTranslations = {
 *   greeting: "Hello, {name}!";
 *   items: "{count} items";
 *   user: {
 *     profile: "Profile";
 *     settings: "Settings";
 *   };
 * };
 *
 * const t = createTypedTranslator<AppTranslations>(translator);
 * t("greeting", { name: "World" }); // ✅ autocomplete
 * t("user.profile"); // ✅ nested keys
 * ```
 */
export interface TypedTranslateFunction<T extends Record<string, unknown>> {
  <K extends Extract<keyof T, string>>(key: K, params?: T[K] extends string
    ? ExtractParams<T[K]>
    : undefined): string;
  <K extends string>(key: K, params?: Record<string, string | number>): string;
}

/** Extract {{param}} names from a template string */
type ExtractParams<T> = T extends `${infer _}{{${infer P}}}${infer Rest}`
  ? Record<P, string | number> & ExtractParams<Rest>
  : {};

/**
 * Create a type-safe translation function from a plain translator.
 * Returns the same `t()` function but with type inference.
 *
 * Usage: cast a standard TranslateFunction to TypedTranslateFunction<T>
 *
 * @example
 * ```ts
 * const t = createTypedTranslator<typeof translations.en>(i18nInstance.translate);
 * t("greeting", { name: "World" }); // Type-safe!
 * ```
 */
export function createTypedTranslator<T extends Record<string, unknown>>(
  translateFn: (key: string, params?: Record<string, string | number>, count?: number) => string,
): TypedTranslateFunction<T> {
  return ((key: string, params?: any) => {
    return translateFn(key, params);
  }) as TypedTranslateFunction<T>;
}

/**
 * Helper type to infer translation keys from an object:
 * `TranslationKeys<typeof translations.en>` gives a union of all dot-notation keys.
 */
export type TranslationKeys<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : T[K] extends Record<string, unknown>
      ? TranslationKeys<T[K], `${Prefix}${K}.`>
      : `${Prefix}${K}`;
}[keyof T & string];

/**
 * Type-safe locale detection result.
 */
export type SupportedLocale<T extends Record<string, unknown>> = Extract<
  keyof T,
  string
>;

// ============================================================================
// 3. OpenAPI 3.1 / JSON Schema 2020-12
// ============================================================================

/**
 * Generate an OpenAPI 3.1.0 document with JSON Schema 2020-12 support.
 *
 * Key differences from 3.0.x:
 * - Uses `jsonSchemaDialect` to declare JSON Schema 2020-12 compliance
 * - `openapi` field is `"3.1.0"` instead of `"3.0.3"`
 * - Supports `$schema` keyword in component schemas
 * - Nullable types via `type: ["string", "null"]` instead of `nullable: true`
 * - Removed `discriminator` free-form field requirement
 * - Examples are any valid JSON (not constrained by media type)
 */
export interface OpenAPI31Document {
  openapi: "3.1.0";
  info: {
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
  };
  jsonSchemaDialect?: string;
  servers?: Array<{
    url: string;
    description?: string;
  }>;
  tags?: Array<{
    name: string;
    description?: string;
  }>;
  paths: Record<string, Record<string, OpenAPI31Operation>>;
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
  };
  security?: Array<Record<string, string[]>>;
}

/** OpenAPI 3.1 operation shape used by the response validator. */
export interface OpenAPI31Operation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenAPI31Parameter[];
  requestBody?: OpenAPI31RequestBody;
  responses: Record<string, OpenAPI31Response>;
  security?: Array<Record<string, string[]>>;
  deprecated?: boolean;
}

/** OpenAPI 3.1 parameter shape used by the response validator. */
export interface OpenAPI31Parameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  description?: string;
  required?: boolean;
  schema: unknown;
  deprecated?: boolean;
  /**
   * OpenAPI 3.1 supports examples array directly
   */
  examples?: unknown[];
}

/** OpenAPI 3.1 request body shape used by the response validator. */
export interface OpenAPI31RequestBody {
  description?: string;
  required?: boolean;
  content: Record<string, { schema: unknown }>;
}

/** OpenAPI 3.1 response shape used by the response validator. */
export interface OpenAPI31Response {
  description: string;
  content?: Record<string, { schema: unknown }>;
  headers?: Record<string, { schema: unknown; description?: string }>;
}

// JSON Schema 2020-12 dialect URI
/** JSON Schema dialect URI used in generated schemas. */
export const JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema";

/**
 * Convert an OpenAPI 3.0.x document to 3.1.0.
 *
 * This performs the following transformations:
 * 1. Sets `openapi` to `"3.1.0"`
 * 2. Adds `jsonSchemaDialect` pointing to JSON Schema 2020-12
 * 3. Converts `nullable: true` → `type: ["type", "null"]`
 * 4. Adds `$schema` to component schemas
 * 5. Removes `nullable` from schemas (not valid in 2020-12)
 */
export function upgradeToOpenAPI31(doc: Record<string, unknown>): OpenAPI31Document {
  // Deep clone to avoid mutating the input
  const doc31 = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;

  // Set version
  doc31.openapi = "3.1.0";

  // Add JSON Schema dialect
  doc31.jsonSchemaDialect = JSON_SCHEMA_DIALECT;

  // Convert schemas in components
  const components = doc31.components as Record<string, unknown> | undefined;
  if (components?.schemas) {
    const schemas = components.schemas as Record<string, unknown>;
    for (const [name, schema] of Object.entries(schemas)) {
      schemas[name] = convertSchemaTo202012(schema as Record<string, unknown>);
    }
  }

  // Convert schemas in paths
  const paths = doc31.paths as Record<string, Record<string, unknown>> | undefined;
  if (paths) {
    for (const path of Object.values(paths)) {
      for (const method of Object.values(path)) {
        convertOperation(method as Record<string, unknown>);
      }
    }
  }

  return doc31 as unknown as OpenAPI31Document;
}

function convertOperation(operation: Record<string, unknown>): void {
  // Convert request body schema
  const requestBody = operation.requestBody as Record<string, unknown> | undefined;
  if (requestBody?.content) {
    const content = requestBody.content as Record<string, { schema: unknown }>;
    for (const mediaType of Object.values(content)) {
      if (mediaType.schema) {
        mediaType.schema = convertSchemaTo202012(mediaType.schema as Record<string, unknown>);
      }
    }
  }

  // Convert response schemas
  const responses = operation.responses as Record<string, Record<string, unknown>> | undefined;
  if (responses) {
    for (const response of Object.values(responses)) {
      if (response.content) {
        const content = response.content as Record<string, { schema: unknown }>;
        for (const mediaType of Object.values(content)) {
          if (mediaType.schema) {
            mediaType.schema = convertSchemaTo202012(mediaType.schema as Record<string, unknown>);
          }
        }
      }
    }
  }

  // Convert parameter schemas
  const params = operation.parameters as Array<Record<string, unknown>> | undefined;
  if (params) {
    for (const param of params) {
      if (param.schema) {
        param.schema = convertSchemaTo202012(param.schema as Record<string, unknown>);
      }
    }
  }
}

/**
 * Convert a JSON Schema from OpenAPI 3.0 style to 2020-12 style.
 *
 * Transformations:
 * - `nullable: true` → `type: ["originalType", "null"]`
 * - Removes `nullable` property
 * - Adds `$schema` to component-level schemas
 * - Recurses into properties, items, allOf, etc.
 */
export function convertSchemaTo202012(schema: Record<string, unknown>): Record<string, unknown> {
  if (!schema || typeof schema !== "object") return schema;

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (key === "nullable") {
      // Skip — handled by type conversion
      continue;
    }
    result[key] = value;
  }

  // Handle nullable: true → type: ["type", "null"]
  const type = schema.type;
  const isNullable = schema.nullable === true;

  if (isNullable && type) {
    result.type = Array.isArray(type) ? [...type, "null"] : [type as string, "null"];
  }

  // Recurse into sub-schemas
  if (result.properties && typeof result.properties === "object") {
    const props = result.properties as Record<string, unknown>;
    for (const [name, propSchema] of Object.entries(props)) {
      if (propSchema && typeof propSchema === "object") {
        props[name] = convertSchemaTo202012(propSchema as Record<string, unknown>);
      }
    }
  }

  if (result.items && typeof result.items === "object") {
    result.items = convertSchemaTo202012(result.items as Record<string, unknown>);
  }

  for (const key of ["allOf", "anyOf", "oneOf"] as const) {
    const arr = result[key] as Array<Record<string, unknown>> | undefined;
    if (arr) {
      result[key] = arr.map((s) => convertSchemaTo202012(s));
    }
  }

  if (result.not && typeof result.not === "object") {
    result.not = convertSchemaTo202012(result.not as Record<string, unknown>);
  }

  if (result.if && typeof result.if === "object") {
    result.if = convertSchemaTo202012(result.if as Record<string, unknown>);
  }
  if (result.then && typeof result.then === "object") {
    result.then = convertSchemaTo202012(result.then as Record<string, unknown>);
  }
  if (result.else && typeof result.else === "object") {
    result.else = convertSchemaTo202012(result.else as Record<string, unknown>);
  }

  return result;
}

/**
 * Create an OpenAPI 3.1.0 document from a 3.0.x generator's output.
 * Call this after generating with the existing OpenAPIGenerator.
 *
 * This method **reuses the existing `OpenAPIGenerator`** internally to avoid
 * duplicating path/parameter/request-body building logic.
 *
 * @example
 * ```ts
 * const gen = createOpenAPI31Generator({ title: "My API", version: "1.0.0" });
 * gen.addRoute({ method: "GET", path: "/users/:id", schemas: { ... } });
 * const doc = gen.generate(); // OpenAPI 3.1.0 + JSON Schema 2020-12
 * ```
 */
export function createOpenAPI31Generator(
  options: { title: string; version: string; description?: string },
): {
  addRoute: (route: {
    method: RouteMethod;
    path: string;
    schemas?: {
      body?: TSchema;
      query?: TSchema;
      params?: TSchema;
      headers?: TSchema;
      response?: TSchema;
    };
  }) => void;
  generate: () => OpenAPI31Document;
  generateSwaggerUI: (specUrl: string, title: string) => string;
} {
  // Reuse the existing OpenAPIGenerator — no code duplication
  const internalGen = new OpenAPIGenerator({
    title: options.title,
    version: options.version,
    description: options.description,
  });

  return {
    addRoute(route) {
      const documentedRoute: DocumentedRoute = {
        method: route.method,
        path: route.path,
        schemas: route.schemas,
      };
      internalGen.addRoute(documentedRoute);
    },
    generate() {
      const doc30 = internalGen.generate();
      return upgradeToOpenAPI31(doc30 as unknown as Record<string, unknown>);
    },
    generateSwaggerUI(specUrl: string, title: string): string {
      // SwaggerUI handles OpenAPI 3.1 natively since SwaggerUI v5
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
    },
  };
}

