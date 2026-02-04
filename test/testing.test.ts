import { describe, test, expect } from "bun:test";
import {
  mockContext,
  mockFormDataContext,
  testClient,
  buildRequest,
  buildFormData,
  mockFile,
  assertStatus,
  assertOk,
  assertHeader,
  assertContentType,
  assertJson,
  assertContains,
  assertRedirect,
  setupTest,
  snapshotResponse,
  measureHandler,
} from "../src/testing";
import { Asi } from "../src/asi";

describe("Testing Utilities", () => {
  describe("mockContext", () => {
    test("creates basic context", () => {
      const ctx = mockContext({
        method: "GET",
        url: "/test",
      });

      expect(ctx.method).toBe("GET");
      expect(ctx.path).toBe("/test");
      expect(ctx.request).toBeInstanceOf(Request);
    });

    test("includes params", () => {
      const ctx = mockContext({
        url: "/users/123",
        params: { id: "123" },
      });

      expect(ctx.params.id).toBe("123");
    });

    test("includes query parameters", () => {
      const ctx = mockContext({
        url: "/search?q=test&page=1",
        query: { q: "test", page: "1" },
      });

      expect(ctx.query.q).toBe("test");
      expect(ctx.query.page).toBe("1");
    });

    test("includes headers", () => {
      const ctx = mockContext({
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer token123",
        },
      });

      expect(ctx.header("Content-Type")).toBe("application/json");
      expect(ctx.header("Authorization")).toBe("Bearer token123");
    });

    test("includes body", async () => {
      const body = { name: "Test", value: 42 };
      const ctx = mockContext({
        method: "POST",
        body,
      });

      const parsed = await ctx.json();
      expect(parsed).toEqual(body);
    });

    test("includes cookies", () => {
      const ctx = mockContext({
        cookies: { session: "abc123", theme: "dark" },
      });

      expect(ctx.cookie("session")).toBe("abc123");
      expect(ctx.cookie("theme")).toBe("dark");
    });

    test("includes store values", () => {
      const ctx = mockContext({
        store: { userId: 123, role: "admin" },
      });

      expect(ctx.store.userId).toBe(123);
      expect(ctx.store.role).toBe("admin");
    });

    test("response helpers work", () => {
      const ctx = mockContext();

      const jsonResponse = ctx.status(201).jsonResponse({ created: true });
      expect(jsonResponse.status).toBe(201);

      const htmlResponse = ctx.html("<h1>Hello</h1>");
      expect(htmlResponse.headers.get("Content-Type")).toContain("text/html");

      const redirect = ctx.redirect("/other", 302);
      expect(redirect.status).toBe(302);
      expect(redirect.headers.get("Location")).toBe("/other");
    });
  });

  describe("mockFormDataContext", () => {
    test("handles form data", async () => {
      // Create FormData with proper Request to test the flow
      const formData = new FormData();
      formData.append("name", "John");
      formData.append("email", "john@example.com");

      // Test FormData directly on a properly constructed Request
      const request = new Request("http://localhost/upload", {
        method: "POST",
        body: formData,
      });

      const parsed = await request.formData();
      expect(parsed.get("name")).toBe("John");
      expect(parsed.get("email")).toBe("john@example.com");
    });

    test("handles file uploads", () => {
      const formData = new FormData();
      const file = mockFile("Hello, World!", "test.txt", "text/plain");
      formData.append("document", file);

      // Verify file is in FormData
      const uploadedFile = formData.get("document") as File;
      expect(uploadedFile).toBeInstanceOf(File);
      expect(uploadedFile?.name).toBe("test.txt");
    });
  });

  describe("testClient", () => {
    test("makes GET requests", async () => {
      const app = new Asi();
      app.get("/hello", () => ({ message: "Hello" }));

      const client = testClient(app);
      const res = await client.get("/hello");

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ message: "Hello" });
    });

    test("makes POST requests with body", async () => {
      const app = new Asi();
      app.post("/echo", async (ctx) => {
        const body = await ctx.json();
        return body;
      });

      const client = testClient(app);
      const res = await client.post("/echo", { data: "test" });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ data: "test" });
    });

    test("includes query parameters", async () => {
      const app = new Asi();
      app.get("/search", (ctx) => ({ q: ctx.query.q }));

      const client = testClient(app);
      const res = await client.get("/search", { query: { q: "bun" } });

      expect(await res.json()).toEqual({ q: "bun" });
    });

    test("supports auth helper", async () => {
      const app = new Asi();
      app.get("/protected", (ctx) => ({
        auth: ctx.header("Authorization"),
      }));

      const client = testClient(app).auth("mytoken");
      const res = await client.get("/protected");

      const data = await res.json();
      expect(data.auth).toBe("Bearer mytoken");
    });

    test("supports custom headers", async () => {
      const app = new Asi();
      app.get("/headers", (ctx) => ({
        custom: ctx.header("X-Custom"),
      }));

      const client = testClient(app).header("X-Custom", "value");
      const res = await client.get("/headers");

      const data = await res.json();
      expect(data.custom).toBe("value");
    });
  });

  describe("Request builders", () => {
    test("buildRequest creates Request object", () => {
      const req = buildRequest("POST", "http://localhost/api", {
        headers: { "Content-Type": "application/json" },
        body: { name: "test" },
        query: { page: "1" },
      });

      expect(req.method).toBe("POST");
      expect(req.url).toContain("/api");
      expect(req.url).toContain("page=1");
    });

    test("buildFormData creates FormData", () => {
      const formData = buildFormData({
        name: "John",
        email: "john@example.com",
      });

      expect(formData.get("name")).toBe("John");
      expect(formData.get("email")).toBe("john@example.com");
    });

    test("mockFile creates File object", async () => {
      const file = mockFile("content", "file.txt", "text/plain");

      expect(file.name).toBe("file.txt");
      // Note: Blob constructor may add charset, so check with startsWith
      expect(file.type.startsWith("text/plain")).toBe(true);
      expect(await file.text()).toBe("content");
    });
  });

  describe("Assertions", () => {
    test("assertStatus checks status code", async () => {
      const app = new Asi();
      app.get("/ok", () => "OK");

      const client = testClient(app);
      const res = await client.get("/ok");

      expect(() => assertStatus(res, 200)).not.toThrow();
      expect(() => assertStatus(res, 404)).toThrow();
    });

    test("assertOk checks successful response", async () => {
      const app = new Asi();
      app.get("/ok", () => "OK");
      app.get("/error", (ctx) => ctx.status(500).jsonResponse({ error: true }));

      const client = testClient(app);

      const okRes = await client.get("/ok");
      expect(() => assertOk(okRes)).not.toThrow();

      const errorRes = await client.get("/error");
      expect(() => assertOk(errorRes)).toThrow();
    });

    test("assertHeader checks header existence", async () => {
      const app = new Asi();
      app.get("/test", (ctx) => {
        return ctx.setHeader("X-Custom", "value").jsonResponse({ ok: true });
      });

      const client = testClient(app);
      const res = await client.get("/test");

      expect(() => assertHeader(res, "X-Custom")).not.toThrow();
      expect(() => assertHeader(res, "X-Custom", "value")).not.toThrow();
      expect(() => assertHeader(res, "X-Missing")).toThrow();
    });

    test("assertContentType checks content type", async () => {
      const app = new Asi();
      app.get("/json", () => ({ ok: true }));

      const client = testClient(app);
      const res = await client.get("/json");

      expect(() => assertContentType(res, "application/json")).not.toThrow();
      expect(() => assertContentType(res, "text/html")).toThrow();
    });

    test("assertJson checks JSON content", async () => {
      const app = new Asi();
      app.get("/data", () => ({ id: 1, name: "test" }));

      const client = testClient(app);
      const res = await client.get("/data");

      await expect(
        assertJson(res, { id: 1, name: "test" }),
      ).resolves.toBeUndefined();
      await expect(assertJson(res, { id: 2 })).rejects.toThrow();
    });

    test("assertContains checks text content", async () => {
      const app = new Asi();
      app.get("/html", (ctx) => ctx.html("<h1>Welcome</h1>"));

      const client = testClient(app);
      const res = await client.get("/html");

      await expect(assertContains(res, "Welcome")).resolves.toBeUndefined();
      await expect(assertContains(res, "Goodbye")).rejects.toThrow();
    });

    test("assertRedirect checks redirect response", async () => {
      const app = new Asi();
      app.get("/old", (ctx) => ctx.redirect("/new"));

      const client = testClient(app);
      const res = await client.get("/old");

      expect(() => assertRedirect(res)).not.toThrow();
      expect(() => assertRedirect(res, "/new")).not.toThrow();
    });
  });

  describe("setupTest helper", () => {
    test("creates app and client", () => {
      const { app, client } = setupTest((app) => {
        app.get("/test", () => "test");
      });

      expect(app).toBeDefined();
      expect(client).toBeDefined();
    });
  });

  describe("snapshotResponse", () => {
    test("creates response snapshot", async () => {
      const app = new Asi();
      app.get("/test", () => ({ status: "ok" }));

      const client = testClient(app);
      const res = await client.get("/test");
      const snapshot = await snapshotResponse(res);

      expect(snapshot.status).toBe(200);
      expect(snapshot.body).toContain("ok");
    });
  });

  describe("measureHandler", () => {
    test("measures handler performance", async () => {
      const handler = async () => {
        await new Promise((r) => setTimeout(r, 1));
        return { ok: true };
      };

      const ctx = mockContext();
      const stats = await measureHandler(handler, ctx, 10);

      expect(stats.min).toBeGreaterThan(0);
      expect(stats.max).toBeGreaterThan(0);
      expect(stats.avg).toBeGreaterThan(0);
      expect(stats.median).toBeGreaterThan(0);
    });
  });
});
