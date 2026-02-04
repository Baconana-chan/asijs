import { describe, it, expect } from "bun:test";
import { Asi } from "../src";

describe("Asi Framework", () => {
  describe("Basic routing", () => {
    it("should handle GET /", async () => {
      const app = new Asi();
      app.get("/", () => "Hello");

      const res = await app.handle(new Request("http://localhost/"));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("Hello");
    });

    it("should return JSON for objects", async () => {
      const app = new Asi();
      app.get("/json", () => ({ foo: "bar" }));

      const res = await app.handle(new Request("http://localhost/json"));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(await res.json()).toEqual({ foo: "bar" });
    });

    it("should handle 404", async () => {
      const app = new Asi();
      app.get("/exists", () => "yes");

      const res = await app.handle(new Request("http://localhost/not-exists"));
      expect(res.status).toBe(404);
    });
  });

  describe("Route parameters", () => {
    it("should parse :id parameter", async () => {
      const app = new Asi();
      app.get("/user/:id", (ctx) => ({ id: ctx.params.id }));

      const res = await app.handle(new Request("http://localhost/user/123"));
      expect(await res.json()).toEqual({ id: "123" });
    });

    it("should parse multiple parameters", async () => {
      const app = new Asi();
      app.get("/user/:userId/post/:postId", (ctx) => ({
        userId: ctx.params.userId,
        postId: ctx.params.postId,
      }));

      const res = await app.handle(new Request("http://localhost/user/1/post/42"));
      expect(await res.json()).toEqual({ userId: "1", postId: "42" });
    });
  });

  describe("Query parameters", () => {
    it("should parse query string", async () => {
      const app = new Asi();
      app.get("/search", (ctx) => ({ q: ctx.query.q }));

      const res = await app.handle(new Request("http://localhost/search?q=hello"));
      expect(await res.json()).toEqual({ q: "hello" });
    });
  });

  describe("HTTP methods", () => {
    it("should handle POST", async () => {
      const app = new Asi();
      app.post("/data", async (ctx) => {
        const body = await ctx.json();
        return { received: body };
      });

      const res = await app.handle(
        new Request("http://localhost/data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ test: true }),
        })
      );
      expect(await res.json()).toEqual({ received: { test: true } });
    });

    it("should handle PUT", async () => {
      const app = new Asi();
      app.put("/item/:id", (ctx) => ({ updated: ctx.params.id }));

      const res = await app.handle(
        new Request("http://localhost/item/5", { method: "PUT" })
      );
      expect(await res.json()).toEqual({ updated: "5" });
    });

    it("should handle DELETE", async () => {
      const app = new Asi();
      app.delete("/item/:id", (ctx) => ({ deleted: ctx.params.id }));

      const res = await app.handle(
        new Request("http://localhost/item/5", { method: "DELETE" })
      );
      expect(await res.json()).toEqual({ deleted: "5" });
    });

    it("should handle ALL method", async () => {
      const app = new Asi();
      app.all("/any", (ctx) => ({ method: ctx.method }));

      const getRes = await app.handle(new Request("http://localhost/any"));
      expect(await getRes.json()).toEqual({ method: "GET" });

      const postRes = await app.handle(
        new Request("http://localhost/any", { method: "POST" })
      );
      expect(await postRes.json()).toEqual({ method: "POST" });
    });
  });

  describe("Response helpers", () => {
    it("should set custom status", async () => {
      const app = new Asi();
      app.get("/created", (ctx) => ctx.status(201).jsonResponse({ ok: true }));

      const res = await app.handle(new Request("http://localhost/created"));
      expect(res.status).toBe(201);
    });

    it("should return HTML", async () => {
      const app = new Asi();
      app.get("/page", (ctx) => ctx.html("<h1>Hello</h1>"));

      const res = await app.handle(new Request("http://localhost/page"));
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(await res.text()).toBe("<h1>Hello</h1>");
    });
  });

  describe("Wildcard routing", () => {
    it("should match wildcard", async () => {
      const app = new Asi();
      app.get("/files/*", (ctx) => ({ path: ctx.path }));

      const res = await app.handle(new Request("http://localhost/files/foo/bar/baz"));
      expect(await res.json()).toEqual({ path: "/files/foo/bar/baz" });
    });
  });

  describe("Route grouping", () => {
    it("should group routes with prefix", async () => {
      const app = new Asi();
      
      app.group("/api", (api) => {
        api.get("/users", () => ({ users: [] }));
        api.get("/posts", () => ({ posts: [] }));
      });

      const usersRes = await app.handle(new Request("http://localhost/api/users"));
      expect(await usersRes.json()).toEqual({ users: [] });

      const postsRes = await app.handle(new Request("http://localhost/api/posts"));
      expect(await postsRes.json()).toEqual({ posts: [] });
    });

    it("should support nested groups", async () => {
      const app = new Asi();
      
      app.group("/api", (api) => {
        api.group("/v1", (v1) => {
          v1.get("/users", () => ({ version: 1 }));
        });
        api.group("/v2", (v2) => {
          v2.get("/users", () => ({ version: 2 }));
        });
      });

      const v1Res = await app.handle(new Request("http://localhost/api/v1/users"));
      expect(await v1Res.json()).toEqual({ version: 1 });

      const v2Res = await app.handle(new Request("http://localhost/api/v2/users"));
      expect(await v2Res.json()).toEqual({ version: 2 });
    });
  });

  describe("Hooks", () => {
    it("should run onBeforeHandle", async () => {
      const app = new Asi();
      const calls: string[] = [];

      app.onBeforeHandle((ctx) => {
        calls.push("before");
      });

      app.get("/test", () => {
        calls.push("handler");
        return "ok";
      });

      await app.handle(new Request("http://localhost/test"));
      expect(calls).toEqual(["before", "handler"]);
    });

    it("should allow onBeforeHandle to return early", async () => {
      const app = new Asi();

      app.onBeforeHandle((ctx) => {
        if (ctx.query.auth !== "secret") {
          return ctx.status(401).jsonResponse({ error: "Unauthorized" });
        }
      });

      app.get("/protected", () => ({ data: "secret" }));

      const noAuth = await app.handle(new Request("http://localhost/protected"));
      expect(noAuth.status).toBe(401);

      const withAuth = await app.handle(new Request("http://localhost/protected?auth=secret"));
      expect(withAuth.status).toBe(200);
      expect(await withAuth.json()).toEqual({ data: "secret" });
    });

    it("should run onAfterHandle", async () => {
      const app = new Asi();

      app.onAfterHandle((ctx, response) => {
        // Добавляем заголовок к ответу
        const newHeaders = new Headers(response.headers);
        newHeaders.set("X-Custom", "modified");
        return new Response(response.body, {
          status: response.status,
          headers: newHeaders,
        });
      });

      app.get("/test", () => "ok");

      const res = await app.handle(new Request("http://localhost/test"));
      expect(res.headers.get("X-Custom")).toBe("modified");
    });
  });

  describe("Route-level hooks", () => {
    it("should run route-specific beforeHandle", async () => {
      const app = new Asi();
      const calls: string[] = [];

      app.get("/normal", () => {
        calls.push("normal");
        return "ok";
      });

      app.get("/special", () => {
        calls.push("special");
        return "ok";
      }, {
        beforeHandle: () => {
          calls.push("before-special");
        }
      });

      await app.handle(new Request("http://localhost/normal"));
      await app.handle(new Request("http://localhost/special"));

      expect(calls).toEqual(["normal", "before-special", "special"]);
    });

    it("should run route-specific afterHandle", async () => {
      const app = new Asi();

      app.get("/test", () => ({ original: true }), {
        afterHandle: (ctx, response) => {
          const newHeaders = new Headers(response.headers);
          newHeaders.set("X-Route-Hook", "yes");
          return new Response(response.body, {
            status: response.status,
            headers: newHeaders,
          });
        }
      });

      const res = await app.handle(new Request("http://localhost/test"));
      expect(res.headers.get("X-Route-Hook")).toBe("yes");
    });
  });

  describe("Custom error handling", () => {
    it("should use custom error handler", async () => {
      const app = new Asi();

      app.onError((ctx, error) => {
        return ctx.status(500).jsonResponse({
          custom: true,
          message: error instanceof Error ? error.message : "Unknown error",
        });
      });

      app.get("/throw", () => {
        throw new Error("Test error");
      });

      const res = await app.handle(new Request("http://localhost/throw"));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ custom: true, message: "Test error" });
    });

    it("should use custom 404 handler", async () => {
      const app = new Asi();

      app.onNotFound((ctx) => {
        return ctx.status(404).jsonResponse({
          custom404: true,
          path: ctx.path,
        });
      });

      const res = await app.handle(new Request("http://localhost/unknown"));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ custom404: true, path: "/unknown" });
    });
  });

  describe("Path-based middleware", () => {
    it("should apply middleware to specific path", async () => {
      const app = new Asi();
      const calls: string[] = [];

      app.use("/api", async (ctx, next) => {
        calls.push("api-middleware");
        return next();
      });

      app.get("/", () => {
        calls.push("root");
        return "root";
      });

      app.get("/api/test", () => {
        calls.push("api-test");
        return "api";
      });

      await app.handle(new Request("http://localhost/"));
      await app.handle(new Request("http://localhost/api/test"));

      expect(calls).toEqual(["root", "api-middleware", "api-test"]);
    });

    it("should NOT match /apix when pattern is /api (fix #4)", async () => {
      const app = new Asi();
      const calls: string[] = [];

      app.use("/api", async (ctx, next) => {
        calls.push("api-middleware");
        return next();
      });

      app.get("/apix", () => {
        calls.push("apix");
        return "apix";
      });

      await app.handle(new Request("http://localhost/apix"));

      // /apix НЕ должен триггерить /api middleware
      expect(calls).toEqual(["apix"]);
    });
  });

  describe("Group middleware (fix #3)", () => {
    it("should apply group middleware to routes", async () => {
      const app = new Asi();
      const calls: string[] = [];

      app.group("/api", (api) => {
        api.use(async (ctx, next) => {
          calls.push("group-mw");
          return next();
        });

        api.get("/users", () => {
          calls.push("users-handler");
          return { users: [] };
        });
      });

      app.get("/other", () => {
        calls.push("other-handler");
        return "other";
      });

      await app.handle(new Request("http://localhost/other"));
      await app.handle(new Request("http://localhost/api/users"));

      expect(calls).toEqual(["other-handler", "group-mw", "users-handler"]);
    });

    it("should pass group middleware to nested groups", async () => {
      const app = new Asi();
      const calls: string[] = [];

      app.group("/api", (api) => {
        api.use(async (ctx, next) => {
          calls.push("api-mw");
          return next();
        });

        api.group("/v1", (v1) => {
          v1.use(async (ctx, next) => {
            calls.push("v1-mw");
            return next();
          });

          v1.get("/test", () => {
            calls.push("handler");
            return "ok";
          });
        });
      });

      await app.handle(new Request("http://localhost/api/v1/test"));

      expect(calls).toEqual(["api-mw", "v1-mw", "handler"]);
    });
  });

  describe("Middleware safety (fix #2)", () => {
    it("should not call handler twice when middleware returns void", async () => {
      const app = new Asi();
      let handlerCalls = 0;

      app.use(async (ctx, next) => {
        // Middleware вызывает next() и возвращает результат
        return next();
      });

      app.get("/test", () => {
        handlerCalls++;
        return "ok";
      });

      await app.handle(new Request("http://localhost/test"));

      expect(handlerCalls).toBe(1);
    });

    it("should work with multiple middlewares", async () => {
      const app = new Asi();
      const calls: string[] = [];

      app.use(async (ctx, next) => {
        calls.push("mw1-before");
        const res = await next();
        calls.push("mw1-after");
        return res;
      });

      app.use(async (ctx, next) => {
        calls.push("mw2-before");
        const res = await next();
        calls.push("mw2-after");
        return res;
      });

      app.get("/test", () => {
        calls.push("handler");
        return "ok";
      });

      await app.handle(new Request("http://localhost/test"));

      expect(calls).toEqual([
        "mw1-before",
        "mw2-before",
        "handler",
        "mw2-after",
        "mw1-after",
      ]);
    });
  });

  describe("Router backtracking (fix #1 & #5)", () => {
    it("should correctly backtrack params on failed match", async () => {
      const app = new Asi();

      // Сценарий: /user/:id/profile и /user/admin/settings
      // Запрос /user/admin/settings должен матчить статический путь
      app.get("/user/:id/profile", (ctx) => ({ id: ctx.params.id, type: "profile" }));
      app.get("/user/admin/settings", () => ({ type: "admin-settings" }));

      const profileRes = await app.handle(new Request("http://localhost/user/123/profile"));
      expect(await profileRes.json()).toEqual({ id: "123", type: "profile" });

      const adminRes = await app.handle(new Request("http://localhost/user/admin/settings"));
      expect(await adminRes.json()).toEqual({ type: "admin-settings" });
    });
  });
});
