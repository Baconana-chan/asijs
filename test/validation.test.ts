import { describe, it, expect } from "bun:test";
import { Asi, Type } from "../src";

describe("Validation", () => {
  describe("Body validation", () => {
    it("should validate JSON body", async () => {
      const app = new Asi();

      app.post("/user", (ctx) => {
        return { 
          received: ctx.body,
          name: ctx.body.name,
          age: ctx.body.age,
        };
      }, {
        schema: {
          body: Type.Object({
            name: Type.String(),
            age: Type.Number(),
          }),
        },
      });

      const res = await app.handle(
        new Request("http://localhost/user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Alice", age: 25 }),
        })
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.name).toBe("Alice");
      expect(json.age).toBe(25);
    });

    it("should return 400 for invalid body", async () => {
      const app = new Asi();

      app.post("/user", (ctx) => {
        return { success: true };
      }, {
        schema: {
          body: Type.Object({
            name: Type.String(),
            age: Type.Number(),
          }),
        },
      });

      const res = await app.handle(
        new Request("http://localhost/user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Alice", age: "not a number" }),
        })
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Validation Error");
      expect(json.details).toBeDefined();
    });

    it("should coerce string numbers to numbers", async () => {
      const app = new Asi();

      app.post("/user", (ctx) => {
        return { 
          age: ctx.body.age,
          ageType: typeof ctx.body.age,
        };
      }, {
        schema: {
          body: Type.Object({
            age: Type.Number(),
          }),
        },
      });

      const res = await app.handle(
        new Request("http://localhost/user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ age: "25" }),
        })
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

      app.get("/search", (ctx) => {
        return { 
          q: ctx.query.q,
          limit: ctx.query.limit,
        };
      }, {
        schema: {
          query: Type.Object({
            q: Type.String(),
            limit: Type.Optional(Type.Number({ default: 10 })),
          }),
        },
      });

      const res = await app.handle(
        new Request("http://localhost/search?q=hello&limit=20")
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.q).toBe("hello");
      expect(json.limit).toBe(20);
    });

    it("should use default values for optional query params", async () => {
      const app = new Asi();

      app.get("/search", (ctx) => {
        return { 
          q: ctx.query.q,
          limit: ctx.query.limit,
        };
      }, {
        schema: {
          query: Type.Object({
            q: Type.String(),
            limit: Type.Number({ default: 10 }),
          }),
        },
      });

      const res = await app.handle(
        new Request("http://localhost/search?q=hello")
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.q).toBe("hello");
      expect(json.limit).toBe(10);
    });

    it("should return 400 for missing required query params", async () => {
      const app = new Asi();

      app.get("/search", (ctx) => {
        return { q: ctx.query.q };
      }, {
        schema: {
          query: Type.Object({
            q: Type.String(),
          }),
        },
      });

      const res = await app.handle(
        new Request("http://localhost/search")
      );

      expect(res.status).toBe(400);
    });
  });

  describe("Params validation", () => {
    it("should validate and coerce path parameters", async () => {
      const app = new Asi();

      app.get("/user/:id", (ctx) => {
        return { 
          id: ctx.params.id,
          idType: typeof ctx.params.id,
        };
      }, {
        schema: {
          params: Type.Object({
            id: Type.Number(),
          }),
        },
      });

      const res = await app.handle(
        new Request("http://localhost/user/123")
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.id).toBe(123);
      expect(json.idType).toBe("number");
    });
  });

  describe("Combined validation", () => {
    it("should validate body, query, and params together", async () => {
      const app = new Asi();

      app.put("/user/:id", (ctx) => {
        return { 
          id: ctx.params.id,
          name: ctx.body.name,
          notify: ctx.query.notify,
        };
      }, {
        schema: {
          params: Type.Object({ id: Type.Number() }),
          body: Type.Object({ name: Type.String() }),
          query: Type.Object({ notify: Type.Boolean({ default: false }) }),
        },
      });

      const res = await app.handle(
        new Request("http://localhost/user/42?notify=true", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Bob" }),
        })
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

      app.post("/user", (ctx) => {
        return { 
          name: ctx.body.name,
          email: ctx.body.email,
        };
      }, {
        schema: {
          body: Type.Object({
            name: Type.String(),
            email: Type.Optional(Type.String()),
          }),
        },
      });

      const res = await app.handle(
        new Request("http://localhost/user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Alice" }),
        })
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

      app.post("/tags", (ctx) => {
        return { tags: ctx.body.tags, count: ctx.body.tags.length };
      }, {
        schema: {
          body: Type.Object({
            tags: Type.Array(Type.String()),
          }),
        },
      });

      const res = await app.handle(
        new Request("http://localhost/tags", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tags: ["a", "b", "c"] }),
        })
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.tags).toEqual(["a", "b", "c"]);
      expect(json.count).toBe(3);
    });

    it("should validate nested objects", async () => {
      const app = new Asi();

      app.post("/profile", (ctx) => {
        return { 
          name: ctx.body.user.name,
          city: ctx.body.address.city,
        };
      }, {
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
      });

      const res = await app.handle(
        new Request("http://localhost/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user: { name: "Alice" },
            address: { city: "NYC" },
          }),
        })
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.name).toBe("Alice");
      expect(json.city).toBe("NYC");
    });
  });
});
