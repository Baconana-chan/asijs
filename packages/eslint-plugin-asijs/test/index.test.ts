/**
 * ESLint Plugin Tests: eslint-plugin-asijs
 *
 * Tests cover all 4 rules:
 * - no-unused-route — Warns about excessive route registrations
 * - no-missing-handler — Ensures routes have handler functions
 * - no-duplicate-route — Detects duplicate route registrations
 * - validate-schema — Ensures validation schemas are defined for routes with parameters
 */

import { describe, test, expect } from "bun:test";
import { RuleTester } from "eslint";
import plugin = require("../src/index");

const ruleTester = new RuleTester({
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: "module",
  },
});

// RuleTester internally uses describe/it — we must call ruleTester.run()
// directly inside describe() blocks, NOT inside test() calls.
// The tester registers its own test cases via the framework's describe/it.

// ============================================================================
// Rule: no-unused-route
// ============================================================================

describe("no-unused-route", () => {
  const rule = plugin.rules["no-unused-route"];

  test("rule exists", () => {
    expect(rule).toBeDefined();
    expect(rule!.meta?.type).toBe("suggestion");
    expect(rule!.meta?.docs?.description).toContain("unused");
  });

  ruleTester.run("no-unused-route", rule!, {
    valid: [
      {
        name: "single route under threshold",
        code: `app.get("/", () => "hello");`,
      },
      {
        name: "two routes under threshold",
        code: [
          `app.get("/users", () => []);`,
          `app.post("/users", (ctx) => ctx.json({ created: true }));`,
        ].join("\n"),
      },
      {
        name: "non-route calls ignored",
        code: [
          `app.use(logger);`,
          `app.plugin(cors());`,
          `app.onError(handler);`,
        ].join("\n"),
      },
    ],
    invalid: [
      {
        name: "over 50 routes triggers warning",
        code: Array.from({ length: 51 }, (_, i) =>
          `app.get("/route${i}", () => "ok");`,
        ).join("\n"),
        errors: [{ messageId: "unusedRoute" }],
      },
    ],
  });
});

// ============================================================================
// Rule: no-missing-handler
// ============================================================================

describe("no-missing-handler", () => {
  const rule = plugin.rules["no-missing-handler"];

  test("rule exists", () => {
    expect(rule).toBeDefined();
    expect(rule!.meta?.type).toBe("problem");
    expect(rule!.meta?.docs?.description).toContain("handler");
  });

  ruleTester.run("no-missing-handler", rule!, {
    valid: [
      { name: "GET with handler", code: `app.get("/", () => "ok");` },
      {
        name: "POST with handler",
        code: `app.post("/data", async (ctx) => ctx.json({}));`,
      },
      {
        name: "PUT with handler and options",
        code: `app.put("/items/:id", { schema: {} }, (ctx) => "updated");`,
      },
      {
        name: "DELETE with handler",
        code: `app.delete("/items/:id", (ctx) => "deleted");`,
      },
      {
        name: "PATCH with handler",
        code: `app.patch("/items/:id", (ctx) => "patched");`,
      },
      {
        name: "multiple routes with handlers",
        code: [
          `app.get("/a", () => "a");`,
          `app.get("/b", () => "b");`,
          `app.get("/c", () => "c");`,
        ].join("\n"),
      },
      {
        name: "non-route calls ignored",
        code: `console.log("hello");`,
      },
    ],
    invalid: [
      {
        name: "GET without handler",
        code: `app.get("/users");`,
        errors: [{ messageId: "missingHandler" }],
      },
      {
        name: "POST without handler",
        code: `app.post("/users");`,
        errors: [{ messageId: "missingHandler" }],
      },
      {
        name: "PUT without handler",
        code: `app.put("/items/:id");`,
        errors: [{ messageId: "missingHandler" }],
      },
      {
        name: "DELETE without handler",
        code: `app.delete("/items/:id");`,
        errors: [{ messageId: "missingHandler" }],
      },
      {
        name: "PATCH without handler",
        code: `app.patch("/items/:id");`,
        errors: [{ messageId: "missingHandler" }],
      },
    ],
  });
});

// ============================================================================
// Rule: no-duplicate-route
// ============================================================================

describe("no-duplicate-route", () => {
  const rule = plugin.rules["no-duplicate-route"];

  test("rule exists", () => {
    expect(rule).toBeDefined();
    expect(rule!.meta?.type).toBe("problem");
    expect(rule!.meta?.docs?.description).toContain("duplicate");
  });

  ruleTester.run("no-duplicate-route", rule!, {
    valid: [
      {
        name: "unique routes are fine",
        code: [
          `app.get("/users", () => []);`,
          `app.post("/users", () => []);`,
          `app.put("/users/:id", () => []);`,
          `app.delete("/users/:id", () => []);`,
        ].join("\n"),
      },
      {
        name: "different methods same path is fine",
        code: [
          `app.get("/items", () => []);`,
          `app.post("/items", () => []);`,
        ].join("\n"),
      },
      {
        name: "single route is fine",
        code: `app.get("/", () => "hello");`,
      },
    ],
    invalid: [
      {
        name: "duplicate GET route",
        code: [
          `app.get("/users", () => []);`,
          `app.get("/users", () => []);`,
        ].join("\n"),
        errors: [{ messageId: "duplicateRoute" }],
      },
      {
        name: "duplicate POST route",
        code: [
          `app.post("/data", () => ({}));`,
          `app.post("/data", () => ({}));`,
        ].join("\n"),
        errors: [{ messageId: "duplicateRoute" }],
      },
      {
        name: "triple duplicate reports second and third",
        code: [
          `app.get("/x", () => "a");`,
          `app.get("/x", () => "b");`,
          `app.get("/x", () => "c");`,
        ].join("\n"),
        errors: [{ messageId: "duplicateRoute" }, { messageId: "duplicateRoute" }],
      },
    ],
  });
});

// ============================================================================
// Rule: validate-schema
// ============================================================================

describe("validate-schema", () => {
  const rule = plugin.rules["validate-schema"];

  test("rule exists", () => {
    expect(rule).toBeDefined();
    expect(rule!.meta?.type).toBe("suggestion");
    expect(rule!.meta?.docs?.description).toContain("schema");
  });

  ruleTester.run("validate-schema", rule!, {
    valid: [
      {
        name: "route without params needs no schema",
        code: `app.get("/static", () => "ok");`,
      },
      {
        name: "route with params and schema in options",
        code: `app.get("/users/:id", { schema: { params: { id: String } } }, (ctx) => ctx.params);`,
      },
      {
        name: "POST with body schema",
        code: `app.post("/users", { schema: { body: { name: String } } }, (ctx) => "created");`,
      },
      {
        name: "route without dynamic params needs no schema",
        code: `app.get("/about", () => "about");`,
      },
    ],
    invalid: [
      {
        name: "route with :param but no schema",
        code: `app.get("/users/:id", (ctx) => ctx.params);`,
        errors: [{ messageId: "missingSchema" }],
      },
      {
        name: "route with wildcard but no schema",
        code: `app.get("/files/*", (ctx) => "file");`,
        errors: [{ messageId: "missingSchema" }],
      },
      {
        name: "route with :param and only handler (no options)",
        code: `app.get("/users/:id", (ctx) => ctx.params);`,
        errors: [{ messageId: "missingSchema" }],
      },
      {
        name: "route with :param and options object without schema (3+ args)",
        // Note: the validate-schema rule checks arg[2] for options, but
        // in a 3-arg pattern path/options/handler, arg[1] is the options.
        // For routes with 3+ args, the rule checks arg[1] as fallback.
        // This test uses a 3-arg pattern where arg[2] is an options-like object
        // to exercise the check path.
        code: `app.get("/users/:id", (ctx) => ctx.params, { validate: true });`,
        errors: [{ messageId: "missingSchema" }],
      },
    ],
  });
});

// ============================================================================
// Plugin structure
// ============================================================================

describe("plugin structure", () => {
  test("exports all 4 rules", () => {
    expect(plugin.rules).toBeDefined();
    expect(Object.keys(plugin.rules)).toHaveLength(4);
    expect(plugin.rules).toHaveProperty("no-unused-route");
    expect(plugin.rules).toHaveProperty("no-missing-handler");
    expect(plugin.rules).toHaveProperty("no-duplicate-route");
    expect(plugin.rules).toHaveProperty("validate-schema");
  });

  test("exports recommended config", () => {
    expect(plugin.configs).toBeDefined();
    expect(plugin.configs!.recommended).toBeDefined();
    expect(plugin.configs!.recommended.plugins).toContain("asijs");
    expect(plugin.configs!.recommended.rules["asijs/no-missing-handler"]).toBe("error");
    expect(plugin.configs!.recommended.rules["asijs/no-duplicate-route"]).toBe("warn");
  });

  test("exports all config", () => {
    expect(plugin.configs!.all).toBeDefined();
    expect(Object.keys(plugin.configs!.all.rules)).toHaveLength(4);
  });
});
