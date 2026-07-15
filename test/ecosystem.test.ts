/**
 * Tests for P3.9 — Ecosystem modules
 *
 * Covers:
 * 1. OpenAPI codegen — generateClient output
 * 2. Auth.js adapter — token encode/decode, providers
 * 3. Upload provider — local storage
 * 4. Auto API — schema introspection, query parsing
 */

import { describe, it, expect } from "bun:test";
import { generateClient } from "../src/codegen";
import { authjs, authProviders, requireAuth, requireRole } from "../src/authjs";
import { upload, uploadStorage } from "../src/upload";
import { autoAPI, parseQueryParams, buildSelectSQL } from "../src/auto-api";

// ============================================================================
// 1. OpenAPI Codegen
// ============================================================================

describe("generateClient", () => {
  const sampleSpec = {
    openapi: "3.0.3",
    info: { title: "Test API", version: "1.0.0" },
    paths: {
      "/users": {
        get: {
          operationId: "listUsers",
          summary: "List all users",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer" }, required: false },
          ],
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: { type: "array", items: { type: "object", properties: { id: { type: "integer" }, name: { type: "string" } }, required: ["id", "name"] } },
                },
              },
            },
          },
        },
        post: {
          operationId: "createUser",
          summary: "Create a user",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } } },
          },
          responses: {
            "201": { description: "Created", content: { "application/json": { schema: { type: "object", properties: { id: { type: "integer" }, name: { type: "string" } }, required: ["id", "name"] } } },
            },
          },
        },
      },
      "/users/{id}": {
        get: {
          operationId: "getUser",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } } },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
      },
    },
  };

  it("should generate TypeScript client code", () => {
    const result = generateClient(sampleSpec, { clientName: "api" });
    expect(result.code).toContain("class ApiClient");
    expect(result.code).toContain("listUsers");
    expect(result.code).toContain("createUser");
    expect(result.code).toContain("getUser");
    expect(result.operations.length).toBe(3);
  });

  it("should include auth token support when spec has security", () => {
    const result = generateClient(sampleSpec, { clientName: "api" });
    expect(result.code).toContain("token");
    expect(result.code).toContain("setToken");
  });

  it("should handle custom base URL", () => {
    const result = generateClient(sampleSpec, { clientName: "myapi", baseUrl: "https://api.example.com" });
    expect(result.code).toContain("DEFAULT_BASE_URL");
    expect(result.code).toContain("https://api.example.com");
  });

  it("should generate path parameters for /users/{id}", () => {
    const result = generateClient(sampleSpec);
    const getUserOp = result.operations.find((o) => o.operationId === "getUser");
    expect(getUserOp).toBeDefined();
    expect(getUserOp!.hasParams).toBe(true);
  });
});

// ============================================================================
// 2. Auth.js
// ============================================================================

describe("authProviders", () => {
  it("should create GitHub provider", () => {
    const provider = authProviders.github({ clientId: "abc", clientSecret: "secret" });
    expect(provider.id).toBe("github");
    expect(provider.type).toBe("oauth");
    expect(provider.authorizationUrl).toContain("github.com");
  });

  it("should create Google provider", () => {
    const provider = authProviders.google({ clientId: "abc", clientSecret: "secret" });
    expect(provider.id).toBe("google");
    expect(provider.type).toBe("oauth");
    expect(provider.authorizationUrl).toContain("google.com");
  });

  it("should create credentials provider", () => {
    const provider = authProviders.credentials({
      authorize: async (creds) => ({ id: 1, email: creds.email }),
    });
    expect(provider.id).toBe("credentials");
    expect(provider.type).toBe("credentials");
  });
});

describe("authjs plugin", () => {
  it("should create plugin with valid config", () => {
    const plugin = authjs({
      secret: "test-secret",
      providers: [authProviders.credentials({ authorize: async () => ({ id: 1 }) })],
    });
    expect(plugin.name).toBe("authjs");
    expect(plugin.config).toBeDefined();
    expect(plugin.config.name).toBe("authjs");
  });
});

describe("requireAuth", () => {
  it("should return 401 when no session", () => {
    const ctx = { auth: { session: null } } as any;
    const result = requireAuth(ctx);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });
});

// ============================================================================
// 3. Upload
// ============================================================================

describe("upload local storage", () => {
  it("should create local storage provider", () => {
    const storage = uploadStorage.local("./test-uploads");
    expect(storage.name).toBe("local");
  });
});

describe("upload plugin", () => {
  it("should create upload plugin", () => {
    const plugin = upload({
      storage: uploadStorage.local("./test-uploads"),
      maxFileSize: 1024 * 1024,
    });
    expect(plugin.name).toBe("upload");
    expect(plugin.config).toBeDefined();
  });
});

// ============================================================================
// 4. Auto API
// ============================================================================

describe("parseQueryParams", () => {
  it("should parse basic filter", () => {
    const result = parseQueryParams({ name: "John" }, {});
    expect(result.filters).toHaveLength(1);
    expect(result.filters[0].column).toBe("name");
    expect(result.filters[0].operator).toBe("=");
    expect(result.filters[0].value).toBe("John");
  });

  it("should parse gt/lt operators", () => {
    const result = parseQueryParams({ age: "gt.25" }, {});
    expect(result.filters).toHaveLength(1);
    expect(result.filters[0].operator).toBe(">");
    expect(result.filters[0].value).toBe("25");
  });

  it("should parse limit and offset", () => {
    const result = parseQueryParams({ limit: "10", offset: "20" }, {});
    expect(result.limit).toBe(10);
    expect(result.offset).toBe(20);
  });

  it("should respect maxLimit", () => {
    const result = parseQueryParams({ limit: "500" }, { pagination: { maxLimit: 50 } });
    expect(result.limit).toBe(50);
  });

  it("should parse order parameter", () => {
    const result = parseQueryParams({ order: "name.desc" }, {});
    expect(result.order?.column).toBe("name");
    expect(result.order?.direction).toBe("desc");
  });

  it("should parse like operator", () => {
    const result = parseQueryParams({ name: "like.%John%" }, {});
    expect(result.filters[0].operator).toBe("LIKE");
    expect(result.filters[0].value).toBe("%John%");
  });

  it("should parse null operators", () => {
    const result = parseQueryParams({ deleted_at: "is.null" }, {});
    expect(result.filters[0].operator).toBe("IS NULL");
  });
});

describe("autoAPI plugin", () => {
  it("should create auto-api plugin", () => {
    const mockDb = async (q: string) => ({ rows: [], rowCount: 0 });
    const plugin = autoAPI(mockDb, {
      prefix: "/api",
      tables: ["users"],
    });
    expect(plugin.name).toBe("auto-api");
    expect(plugin.config).toBeDefined();
  });
});
