import { describe, it, expect } from "bun:test";
import { Asi, Type } from "../src";

describe("Validation", () => {
  describe("Body validation", () => {
    it("should validate JSON body", async () => {
      const app = new Asi();

      app.post(
        "/user",
        (ctx) => {
          return {
            received: ctx.body,
            name: ctx.body.name,
            age: ctx.body.age,
          };
        },
        {
          schema: {
            body: Type.Object({
              name: Type.String(),
              age: Type.Number(),
            }),
          },
        },
      );

      const res = await app.handle(
        new Request("http://localhost/user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Alice", age: 25 }),
        }),
      );

      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.name).toBe("Alice");
      expect(json.age).toBe(25);
    });

    it("should return 400 for invalid body", async () => {
      const app = new Asi();

      app.post(
        "/user",
        (ctx) => {
          return { success: true };
        },
        {
          schema: {
            body: Type.Object({
              name: Type.String(),
              age: Type.Number(),
            }),
          },
        },
      );

      const res = await app.handle(
        new Request("http://localhost/user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Alice", age: "not a number" }),
        }),
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Validation Error");
      expect(json.details).toBeDefined();
    });

    it("should coerce string numbers to numbers", async () => {
      const app = new Asi();

      app.post(
        "/user",
        (ctx) => {
          return {
            age: ctx.body.age,
            ageType: typeof ctx.body.age,
          };
        },
        {
          schema: {
            body: Type.Object({
              age: Type.Number(),
            }),
          },
        },
      );

      const res = await app.handle(
        new Request("http://localhost/user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ age: "25" }),
        }),
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.age).toBe(25);
      expect(json.ageType).toBe("number");
    });
  });

  describe("Query validation", () => {
    it("should validate query parameters", async () => {
      const app = new Asi();

      app.get(
        "/search",
        (ctx) => {
          return {
            q: ctx.query.q,
            limit: ctx.query.limit,
          };
        },
        {
          schema: {
            query: Type.Object({
              q: Type.String(),
              limit: Type.Optional(Type.Number({ default: 10 })),
            }),
          },
        },
      );

      const res = await app.handle(
        new Request("http://localhost/search?q=hello&limit=20"),
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.q).toBe("hello");
      expect(json.limit).toBe(20);
    });

    it("should use default values for optional query params", async () => {
      const app = new Asi();

      app.get(
        "/search",
        (ctx) => {
          return {
            q: ctx.query.q,
            limit: ctx.query.limit,
          };
        },
        {
          schema: {
            query: Type.Object({
              q: Type.String(),
              limit: Type.Number({ default: 10 }),
            }),
          },
        },
      );

      const res = await app.handle(
        new Request("http://localhost/search?q=hello"),
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.q).toBe("hello");
      expect(json.limit).toBe(10);
    });

    it("should return 400 for missing required query params", async () => {
      const app = new Asi();

      app.get(
        "/search",
        (ctx) => {
          return { q: ctx.query.q };
        },
        {
          schema: {
            query: Type.Object({
              q: Type.String(),
            }),
          },
        },
      );

      const res = await app.handle(new Request("http://localhost/search"));

      expect(res.status).toBe(400);
    });
  });

  describe("Params validation", () => {
    it("should validate and coerce path parameters", async () => {
      const app = new Asi();

      app.get(
        "/user/:id",
        (ctx) => {
          return {
            id: ctx.params.id,
            idType: typeof ctx.params.id,
          };
        },
        {
          schema: {
            params: Type.Object({
              id: Type.Number(),
            }),
          },
        },
      );

      const res = await app.handle(new Request("http://localhost/user/123"));

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.id).toBe(123);
      expect(json.idType).toBe("number");
    });
  });

  describe("Combined validation", () => {
    it("should validate body, query, and params together", async () => {
      const app = new Asi();

      app.put(
        "/user/:id",
        (ctx) => {
          return {
            id: ctx.params.id,
            name: ctx.body.name,
            notify: ctx.query.notify,
          };
        },
        {
          schema: {
            params: Type.Object({ id: Type.Number() }),
            body: Type.Object({ name: Type.String() }),
            query: Type.Object({ notify: Type.Boolean({ default: false }) }),
          },
        },
      );

      const res = await app.handle(
        new Request("http://localhost/user/42?notify=true", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Bob" }),
        }),
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.id).toBe(42);
      expect(json.name).toBe("Bob");
      expect(json.notify).toBe(true);
    });
  });

  describe("Optional fields", () => {
    it("should handle optional fields", async () => {
      const app = new Asi();

      app.post(
        "/user",
        (ctx) => {
          return {
            name: ctx.body.name,
            email: ctx.body.email,
          };
        },
        {
          schema: {
            body: Type.Object({
              name: Type.String(),
              email: Type.Optional(Type.String()),
            }),
          },
        },
      );

      const res = await app.handle(
        new Request("http://localhost/user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Alice" }),
        }),
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.name).toBe("Alice");
      expect(json.email).toBeUndefined();
    });
  });

  describe("Array and nested objects", () => {
    it("should validate arrays", async () => {
      const app = new Asi();

      app.post(
        "/tags",
        (ctx) => {
          return { tags: ctx.body.tags, count: ctx.body.tags.length };
        },
        {
          schema: {
            body: Type.Object({
              tags: Type.Array(Type.String()),
            }),
          },
        },
      );

      const res = await app.handle(
        new Request("http://localhost/tags", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tags: ["a", "b", "c"] }),
        }),
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.tags).toEqual(["a", "b", "c"]);
      expect(json.count).toBe(3);
    });

    it("should validate nested objects", async () => {
      const app = new Asi();

      app.post(
        "/profile",
        (ctx) => {
          return {
            name: ctx.body.user.name,
            city: ctx.body.address.city,
          };
        },
        {
          schema: {
            body: Type.Object({
              user: Type.Object({
                name: Type.String(),
              }),
              address: Type.Object({
                city: Type.String(),
                zip: Type.Optional(Type.String()),
              }),
            }),
          },
        },
      );

      const res = await app.handle(
        new Request("http://localhost/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user: { name: "Alice" },
            address: { city: "NYC" },
          }),
        }),
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.name).toBe("Alice");
      expect(json.city).toBe("NYC");
    });
  });

  // ======================================================================
  // 2.2.5 — Compiled TypeBox validation (fast path)
  // ======================================================================
  describe("Compiled validation (2.2.5)", () => {
    const schema = Type.Object({
      id: Type.Number(),
      name: Type.String({ minLength: 2 }),
      age: Type.Optional(Type.Number()),
      role: Type.Union([
        Type.Literal("admin"),
        Type.Literal("user"),
        Type.Literal("guest"),
      ]),
      tags: Type.Array(Type.String()),
      profile: Type.Object({
        bio: Type.Optional(Type.String()),
        active: Type.Boolean(),
      }),
    });

    const goodData = {
      id: 42,
      name: "Alice",
      age: 30,
      role: "admin",
      tags: ["a", "b"],
      profile: { bio: "hi", active: true },
    };

    it("fast path: valid data passes without mutation", async () => {
      const { validateAndCoerce } = await import("../src/validation");
      const data = { ...goodData };
      const result = validateAndCoerce(schema, data);
      expect(result.success).toBe(true);
      // Returns the same reference (no copy) — identity preserved
      expect(result.data).toBe(data);
    });

    it("fast path: coercion still applied when data needs it", async () => {
      const { validateAndCoerce } = await import("../src/validation");
      const result = validateAndCoerce(schema, {
        ...goodData,
        id: "42",
        age: "30",
        profile: { bio: "hi", active: "true" },
      });
      expect(result.success).toBe(true);
      expect(result.data!.id).toBe(42);
      expect(result.data!.age).toBe(30);
      expect((result.data!.profile as any).active).toBe(true);
    });

    it("fast path: defaults are still materialized", async () => {
      const { validateAndCoerce } = await import("../src/validation");
      const withDefaults = Type.Object({
        name: Type.String(),
        role: Type.String({ default: "guest" }),
        nested: Type.Optional(
          Type.Object({
            count: Type.Number({ default: 0 }),
          }),
        ),
      });
      // Defaults on provided objects are applied
      const result = validateAndCoerce(withDefaults, { name: "Al" });
      expect(result.success).toBe(true);
      expect(result.data!.role).toBe("guest");
      // Optional nested object absent → stays absent
      expect((result.data as any).nested).toBeUndefined();

      // Provided nested object → its defaults materialize
      const result2 = validateAndCoerce(withDefaults, {
        name: "Al",
        nested: {},
      });
      expect(result2.success).toBe(true);
      expect((result2.data!.nested as any).count).toBe(0);
    });

    it("fast path: invalid data produces detailed errors", async () => {
      const { validateAndCoerce } = await import("../src/validation");
      const result = validateAndCoerce(schema, {
        ...goodData,
        name: "x", // too short
        tags: [1, 2], // not strings
      });
      expect(result.success).toBe(false);
      expect(result.errors!.length).toBeGreaterThanOrEqual(1);
      expect(result.errors!.some((e) => e.path.includes("name"))).toBe(true);
    });

    it("schemaHasDefaults detects nested/array/union defaults", async () => {
      const { schemaHasDefaults } = await import("../src/validation");
      expect(schemaHasDefaults(Type.Object({ a: Type.Number() }))).toBe(false);
      expect(schemaHasDefaults(Type.Object({ a: Type.Number({ default: 1 }) }))).toBe(true);
      expect(schemaHasDefaults(Type.Object({ a: Type.Array(Type.String({ default: "x" })) }))).toBe(true);
      expect(schemaHasDefaults(Type.Union([Type.String(), Type.Number({ default: 0 })]))).toBe(true);
      // Cycle-safe: recursive schema does not hang
      const rec: any = Type.Object({ name: Type.String() });
      rec.properties.self = rec;
      expect(schemaHasDefaults(rec)).toBe(false);
    });

    it("validate() uses compiled checker and returns same data", async () => {
      const { validate } = await import("../src/validation");
      const data = { ...goodData };
      const result = validate(schema, data);
      expect(result.success).toBe(true);
      expect(result.data).toBe(data);
    });
  });
});
