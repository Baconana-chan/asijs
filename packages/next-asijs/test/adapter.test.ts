/**
 * Tests for asijs-next — Next.js adapter
 */

import { describe, test, expect } from "bun:test";
import { Asi } from "../../../src/index.ts";
import { createNextHandler, createPagesHandler } from "../src/index";

// ============================================================================
// Mock Next.js App Router Request
// ============================================================================

function mockNextRequest(path: string, options: { method?: string; body?: any; headers?: Record<string, string> } = {}) {
  const url = `http://localhost${path}`;
  const headers = new Headers(options.headers || { "content-type": "application/json" });
  let body: string | undefined;
  if (options.body) {
    body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  }
  return new Request(url, {
    method: options.method || "GET",
    headers,
    body,
  });
}

// ============================================================================
// Mock Next.js Pages Router (NextApiRequest/NextApiResponse)
// ============================================================================

function mockPagesRequest(path: string, options: { method?: string; body?: any } = {}) {
  const req: any = {
    method: options.method || "GET",
    url: `http://localhost${path}`,
    headers: { "content-type": "application/json" },
    body: options.body,
    query: {},
  };

  const resHeaders = new Headers();
  let resBody: any;
  let resStatus = 200;

  const res: any = {
    status: (code: number) => { resStatus = code; return res; },
    json: (data: any) => { resBody = data; },
    send: (data: any) => { resBody = data; },
    setHeader: (name: string, value: string) => { resHeaders.set(name, value); return res; },
    end: (data?: any) => { if (data !== undefined) resBody = data; },
    _getStatus: () => resStatus,
    _getBody: () => resBody,
    _getHeaders: () => resHeaders,
  };

  return { req, res };
}

// ============================================================================
// Tests
// ============================================================================

describe("asijs-next — App Router", () => {
  test("createNextHandler returns method handlers", () => {
    const app = new Asi({ development: false, silent: true });
    app.get("/api/hello", () => ({ message: "Hello!" }));

    const handlers = createNextHandler(app);
    expect(handlers.GET).toBeDefined();
    expect(handlers.POST).toBeDefined();
    expect(handlers.PUT).toBeDefined();
    expect(handlers.DELETE).toBeDefined();
    expect(handlers.PATCH).toBeDefined();
    expect(handlers.HEAD).toBeDefined();
    expect(handlers.OPTIONS).toBeDefined();
  });

  test("GET request returns route response", async () => {
    const app = new Asi({ development: false, silent: true });
    app.get("/api/hello", () => ({ message: "Hello!" }));

    const { GET } = createNextHandler(app);
    const req = mockNextRequest("/api/hello");
    const res = await GET(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.message).toBe("Hello!");
  });

  test("POST request with body works", async () => {
    const app = new Asi({ development: false, silent: true });
    app.post("/api/data", async (ctx: any) => {
      const body = await ctx.json();
      return { received: body };
    });

    const { POST } = createNextHandler(app);
    const req = mockNextRequest("/api/data", {
      method: "POST",
      body: { key: "value" },
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.received.key).toBe("value");
  });

  test("basePath stripping works", async () => {
    const app = new Asi({ development: false, silent: true });
    app.get("/hello", () => ({ message: "stripped" }));

    const { GET } = createNextHandler(app, { basePath: "/api" });
    const req = mockNextRequest("/api/hello");
    const res = await GET(req);
    const body = await res.json();
    expect(body.message).toBe("stripped");
  });

  test("returns 404 for unknown routes", async () => {
    const app = new Asi({ development: false, silent: true });
    const { GET } = createNextHandler(app);
    const req = mockNextRequest("/api/unknown");
    const res = await GET(req);
    expect(res.status).toBe(404);
  });

  test("handles route params", async () => {
    const app = new Asi({ development: false, silent: true });
    app.get("/api/users/:id", (ctx: any) => ({ id: ctx.params.id }));

    const { GET } = createNextHandler(app);
    const req = mockNextRequest("/api/users/42");
    const res = await GET(req);
    const body = await res.json();
    expect(body.id).toBe("42");
  });
});

describe("asijs-next — Pages Router", () => {
  test("createPagesHandler returns handler function", () => {
    const app = new Asi({ development: false, silent: true });
    app.get("/api/hello", () => ({ message: "Hello!" }));

    const handler = createPagesHandler(app);
    expect(typeof handler).toBe("function");
  });

  test("handler processes GET request", async () => {
    const app = new Asi({ development: false, silent: true });
    app.get("/api/hello", () => ({ message: "Hello!" }));

    const handler = createPagesHandler(app);
    const { req, res } = mockPagesRequest("/api/hello");
    await handler(req, res);
    expect(res._getStatus()).toBe(200);
    expect(res._getBody().message).toBe("Hello!");
  });

  test("handler sets response headers", async () => {
    const app = new Asi({ development: false, silent: true });
    app.get("/api/hello", () => new Response(JSON.stringify({ ok: true }), {
      headers: { "X-Custom": "test-value" },
    }));

    const handler = createPagesHandler(app);
    const { req, res } = mockPagesRequest("/api/hello");
    await handler(req, res);
    expect(res._getHeaders().get("X-Custom")).toBe("test-value");
  });

  test("handler returns 404 for unknown routes", async () => {
    const app = new Asi({ development: false, silent: true });
    const handler = createPagesHandler(app);
    const { req, res } = mockPagesRequest("/api/unknown");
    await handler(req, res);
    expect(res._getStatus()).toBe(404);
  });
});
