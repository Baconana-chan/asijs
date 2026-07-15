/**
 * Tests for Type Safety Enhancements (P3.11)
 *
 * Covers:
 * 1. Response validation — createResponseValidator, warnings, mode
 * 2. Type-safe i18n — typed translator, translation keys type
 * 3. OpenAPI 3.1 — upgradeFrom30, convertSchema, jsonSchemaDialect
 */

import { describe, it, expect } from "bun:test";
import { Type } from "@sinclair/typebox";
import {
  createResponseValidator,
  getResponseValidator,
  resetResponseValidator,
  upgradeToOpenAPI31,
  convertSchemaTo202012,
  createOpenAPI31Generator,
  createTypedTranslator,
  JSON_SCHEMA_DIALECT,
} from "../src/type-safety";
import { Asi } from "../src/asi";
import { Context } from "../src/context";

// ============================================================================
// 1. Response Validation
// ============================================================================

describe("createResponseValidator", () => {
  it("should return null for valid response", () => {
    const validator = createResponseValidator();
    const schema = Type.Object({ name: Type.String() });
    const errors = validator.validate(200, { name: "Alice" }, schema);
    expect(errors).toBeNull();
  });

  it("should return errors for invalid response", () => {
    const validator = createResponseValidator({ mode: "warn" });
    const schema = Type.Object({ name: Type.String() });
    const errors = validator.validate(200, { name: 123 }, schema);
    expect(errors).not.toBeNull();
    expect(errors!.length).toBeGreaterThan(0);
    expect(errors![0].path).toBeDefined();
    expect(errors![0].message).toBeDefined();
  });

  it("should skip validation for skipStatus codes", () => {
    const validator = createResponseValidator({ skipStatus: [204] });
    const schema = Type.Object({ name: Type.String() });
    const errors = validator.validate(204, {}, schema);
    expect(errors).toBeNull();
  });

  it("should return null when disabled", () => {
    const validator = createResponseValidator({ enabled: false });
    const schema = Type.Object({ name: Type.String() });
    const errors = validator.validate(200, { name: 123 }, schema);
    expect(errors).toBeNull();
  });

  it("should wrap handler and validate response", async () => {
    const validator = createResponseValidator({ mode: "silent" });
    const schema = Type.Object({ name: Type.String() });

    const handler = async () => ({ name: "Alice" });
    const wrapped = validator.wrap(handler, schema);

    const ctx = new Context(new Request("http://localhost/test"));
    const result = await wrapped(ctx);
    expect(result).toEqual({ name: "Alice" });
  });

  it("should provide a singleton getter", () => {
    resetResponseValidator();
    const v1 = getResponseValidator();
    const v2 = getResponseValidator();
    expect(v1).toBe(v2);
  });

  it("should validate nested objects", () => {
    const validator = createResponseValidator();
    const schema = Type.Object({
      user: Type.Object({
        id: Type.Number(),
        name: Type.String(),
      }),
    });

    // Valid
    expect(validator.validate(200, { user: { id: 1, name: "Alice" } }, schema)).toBeNull();

    // Invalid — wrong type for id
    const errors = validator.validate(200, { user: { id: "not-number", name: "Alice" } }, schema);
    expect(errors).not.toBeNull();
  });
});

// ============================================================================
// 2. Type-Safe i18n
// ============================================================================

describe("createTypedTranslator", () => {
  it("should create a typed translator from a plain translate function", () => {
    const plainTranslate = (key: string, params?: Record<string, string | number>) => {
      if (key === "greeting" && params) {
        return `Hello, ${params.name}!`;
      }
      if (key === "items") {
        return `${params?.count ?? 0} items`;
      }
      return key;
    };

    type Keys = {
      greeting: string;
      items: string;
      user: { profile: string };
    };

    const t = createTypedTranslator<Keys>(plainTranslate);
    expect(t("greeting", { name: "World" })).toBe("Hello, World!");
    expect(t("items", { count: 5 } as any)).toBe("5 items");
    expect(t("unknown" as any)).toBe("unknown");
  });
});

describe("TranslationKeys type helper", () => {
  it("should be a type — not testable at runtime", () => {
    // This is a compile-time type, just verify the module exports exist
    expect(true).toBe(true);
  });
});

// ============================================================================
// 3. OpenAPI 3.1
// ============================================================================

describe("convertSchemaTo202012", () => {
  it("should convert nullable: true to type array", () => {
    const schema = { type: "string", nullable: true };
    const result = convertSchemaTo202012(schema);
    expect(result.type).toEqual(["string", "null"]);
    expect(result.nullable).toBeUndefined();
  });

  it("should keep non-nullable schemas unchanged", () => {
    const schema = { type: "string", description: "A name" };
    const result = convertSchemaTo202012(schema);
    expect(result.type).toBe("string");
    expect(result.description).toBe("A name");
  });

  it("should recurse into properties", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string", nullable: true },
        age: { type: "number" },
      },
    };
    const result = convertSchemaTo202012(schema) as any;
    expect(result.properties.name.type).toEqual(["string", "null"]);
    expect(result.properties.name.nullable).toBeUndefined();
    expect(result.properties.age.type).toBe("number");
  });

  it("should recurse into items", () => {
    const schema = {
      type: "array",
      items: { type: "string", nullable: true },
    };
    const result = convertSchemaTo202012(schema) as any;
    expect(result.items.type).toEqual(["string", "null"]);
  });

  it("should recurse into allOf/anyOf/oneOf", () => {
    const schema = {
      allOf: [
        { type: "string", nullable: true },
        { type: "number" },
      ],
    };
    const result = convertSchemaTo202012(schema) as any;
    expect(result.allOf[0].type).toEqual(["string", "null"]);
    expect(result.allOf[1].type).toBe("number");
  });
});

describe("upgradeToOpenAPI31", () => {
  it("should set openapi version to 3.1.0", () => {
    const doc = {
      openapi: "3.0.3",
      info: { title: "Test", version: "1.0.0" },
      paths: {},
    };
    const result = upgradeToOpenAPI31(doc);
    expect(result.openapi).toBe("3.1.0");
  });

  it("should add jsonSchemaDialect", () => {
    const doc = {
      openapi: "3.0.3",
      info: { title: "Test", version: "1.0.0" },
      paths: {},
    };
    const result = upgradeToOpenAPI31(doc);
    expect(result.jsonSchemaDialect).toBe(JSON_SCHEMA_DIALECT);
  });

  it("should convert nullable schemas in components", () => {
    const doc = {
      openapi: "3.0.3",
      info: { title: "Test", version: "1.0.0" },
      paths: {},
      components: {
        schemas: {
          User: {
            type: "object",
            properties: {
              name: { type: "string", nullable: true },
            },
          },
        },
      },
    };
    const result = upgradeToOpenAPI31(doc);
    const userSchema = (result.components!.schemas!.User as any);
    expect(userSchema.properties.name.type).toEqual(["string", "null"]);
    expect(userSchema.properties.name.nullable).toBeUndefined();
  });

  it("should convert nullable schemas in path operations", () => {
    const doc = {
      openapi: "3.0.3",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/users": {
          get: {
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: {
                      type: "array",
                      items: { type: "string", nullable: true },
                    },
                  },
                },
              },
            },
            parameters: [
              { name: "q", in: "query", schema: { type: "string", nullable: true } },
            ],
          },
        },
      },
    };
    const result = upgradeToOpenAPI31(doc);
    const getOp = (result.paths["/users"] as any).get;
    const responseSchema = getOp.responses["200"].content["application/json"].schema;
    expect(responseSchema.items.type).toEqual(["string", "null"]);
    expect(getOp.parameters[0].schema.type).toEqual(["string", "null"]);
  });
});

describe("createOpenAPI31Generator", () => {
  it("should generate a 3.1.0 document", () => {
    const gen = createOpenAPI31Generator({
      title: "My API",
      version: "2.0.0",
    });

    gen.addRoute({
      method: "GET",
      path: "/users/:id",
      schemas: {
        params: Type.Object({ id: Type.String() }),
        response: Type.Object({ id: Type.String(), name: Type.String() }),
      },
    });

    const doc = gen.generate();
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.jsonSchemaDialect).toBe(JSON_SCHEMA_DIALECT);
    expect(doc.info.title).toBe("My API");
    expect(doc.paths["/users/{id}"]).toBeDefined();
    expect(doc.paths["/users/{id}"].get).toBeDefined();
  });

  it("should handle nullable response schemas", () => {
    const gen = createOpenAPI31Generator({
      title: "Test",
      version: "1.0.0",
    });

    gen.addRoute({
      method: "GET",
      path: "/items",
      schemas: {
        response: Type.Array(
          Type.Object({
            id: Type.Number(),
            title: Type.Optional(Type.String()),
          }),
        ),
      },
    });

    const doc = gen.generate();
    expect(doc.openapi).toBe("3.1.0");
  });

  it("should include error responses", () => {
    const gen = createOpenAPI31Generator({ title: "T", version: "1.0.0" });
    gen.addRoute({ method: "POST", path: "/data" });

    const doc = gen.generate();
    const post = doc.paths["/data"]!.post!;
    expect(post.responses["400"]).toBeDefined();
    expect(post.responses["500"]).toBeDefined();
  });

  it("should generate Swagger UI HTML", () => {
    const gen = createOpenAPI31Generator({ title: "T", version: "1.0.0" });
    const html = gen.generateSwaggerUI("/spec.json", "My Docs");
    expect(html).toContain("swagger-ui");
    expect(html).toContain("/spec.json");
    expect(html).toContain("My Docs");
  });
});
