/**
 * Tests for Route Compilation
 */

import { describe, test, expect } from "bun:test";
import { Asi, Type, compileSchema, analyzeRoute } from "../src";

describe("Route Compilation", () => {
  describe("analyzeRoute", () => {
    test("should identify static routes", () => {
      const analysis = analyzeRoute("/api/users", []);
      expect(analysis.isStatic).toBe(true);
      expect(analysis.segmentCount).toBe(2);
      expect(analysis.paramNames).toEqual([]);
    });

    test("should identify dynamic routes", () => {
      const analysis = analyzeRoute("/api/users/:id", []);
      expect(analysis.isStatic).toBe(false);
      expect(analysis.paramNames).toEqual(["id"]);
    });

    test("should identify wildcard routes", () => {
      const analysis = analyzeRoute("/files/*", []);
      expect(analysis.hasWildcard).toBe(true);
      expect(analysis.isStatic).toBe(false);
    });

    test("should count middleware", () => {
      const mw1 = async (ctx: any, next: any) => next();
      const mw2 = async (ctx: any, next: any) => next();
      const analysis = analyzeRoute("/", [mw1, mw2]);
      expect(analysis.middlewareCount).toBe(2);
    });

    test("should detect validation", () => {
      const schema = { body: Type.Object({ name: Type.String() }) };
      const analysis = analyzeRoute("/", [], schema);
      expect(analysis.hasValidation).toBe(true);
    });
  });

  describe("compileSchema", () => {
    test("should compile TypeBox schema", () => {
      const schema = Type.Object({
        name: Type.String(),
        age: Type.Number(),
      });

      const compiled = compileSchema(schema);

      expect(compiled.Check({ name: "Alice", age: 25 })).toBe(true);
      expect(compiled.Check({ name: "Bob" })).toBe(false);
      expect(compiled.Check({ name: 123, age: 25 })).toBe(false);
    });

    test("should cache compiled schemas", () => {
      const schema = Type.Object({ x: Type.Number() });

      const compiled1 = compileSchema(schema);
      const compiled2 = compileSchema(schema);

      // Должен вернуть тот же объект из кэша
      expect(compiled1).toBe(compiled2);
    });
  });

  describe("Asi.compile()", () => {
    test("should compile routes", async () => {
      const app = new Asi({ development: false });

      app.get("/", () => "Hello");
      app.get("/users", () => [{ id: 1 }]);
      app.get("/user/:id", (ctx) => ({ id: ctx.params.id }));

      // Компилируем
      app.compile();

      // Проверяем что всё работает
      const res1 = await app.handle(new Request("http://localhost/"));
      expect(await res1.text()).toBe("Hello");

      const res2 = await app.handle(new Request("http://localhost/users"));
      expect(await res2.json()).toEqual([{ id: 1 }]);

      const res3 = await app.handle(new Request("http://localhost/user/42"));
      expect(await res3.json()).toEqual({ id: "42" });
    });

    test("should use static router for static paths", async () => {
      const app = new Asi({ development: false });

      app.get("/", () => "root");
      app.get("/api/health", () => ({ status: "ok" }));

      app.compile();

      const res = await app.handle(new Request("http://localhost/api/health"));
      expect(await res.json()).toEqual({ status: "ok" });
    });

    test("should handle validation in compiled routes", async () => {
      const app = new Asi({ development: false });

      app.post("/users", (ctx) => ({ created: ctx.body }), {
        schema: {
          body: Type.Object({
            name: Type.String(),
            age: Type.Number(),
          }),
        },
      });

      app.compile();

      // Valid request
      const res1 = await app.handle(
        new Request("http://localhost/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Alice", age: 25 }),
        }),
      );
      expect(res1.status).toBe(200);

      // Invalid request (missing age)
      const res2 = await app.handle(
        new Request("http://localhost/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Bob" }),
        }),
      );
      expect(res2.status).toBe(400);
    });
  });
});
