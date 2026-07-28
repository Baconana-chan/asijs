/**
 * Tests for asijs-astro — Astro adapter
 */

import { describe, test, expect } from "bun:test";
import { Asi } from "../../../src/index.ts";
import { createAstroHandler, createEndpoint } from "../src/index";

// ============================================================================
// Mock Astro APIContext
// ============================================================================

function mockAstroContext(path: string, options: { method?: string; body?: any } = {}) {
  const url = new URL(`http://localhost${path}`);
  const headers = new Headers({ "content-type": "application/json" });
  let body: any;
  if (options.body) {
    body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  }

  return {
    request: new Request(url.toString(), {
      method: options.method || "GET",
      headers,
      body,
    }),
    cookies: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
    },
    params: {},
    redirect: (path: string, status?: number) => new Response(null, { status: status || 302, headers: { Location: path } }),
    url,
    locals: {},
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("asijs-astro", () => {
  test("createAstroHandler returns endpoint function", () => {
    const app = new Asi({ development: false, silent: true });
    app.get("/api/hello", () => ({ message: "Hello!" }));

    const handler = createAstroHandler(app);
    expect(typeof handler).toBe("function");
  });

  test("handles GET request", async () => {
    const app = new Asi({ development: false, silent: true });
    app.get("/api/hello", () => ({ message: "Hello!" }));

    const handler = createAstroHandler(app);
    const context = mockAstroContext("/api/hello");
    const res = await handler(context as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe("Hello!");
  });

  test("handles POST with body", async () => {
    const app = new Asi({ development: false, silent: true });
    app.post("/api/data", async (ctx: any) => {
      const body = await ctx.json();
      return { received: body };
    });

    const handler = createAstroHandler(app);
    const context = mockAstroContext("/api/data", { method: "POST", body: { key: "value" } });
    const res = await handler(context as any);
    const body = await res.json();
    expect(body.received.key).toBe("value");
  });

  test("basePath stripping works", async () => {
    const app = new Asi({ development: false, silent: true });
    app.get("/hello", () => ({ message: "stripped" }));

    const handler = createAstroHandler(app, { basePath: "/api" });
    const context = mockAstroContext("/api/hello");
    const res = await handler(context as any);
    const body = await res.json();
    expect(body.message).toBe("stripped");
  });

  test("returns 404 for unknown routes", async () => {
    const app = new Asi({ development: false, silent: true });
    const handler = createAstroHandler(app);
    const context = mockAstroContext("/api/unknown");
    const res = await handler(context as any);
    expect(res.status).toBe(404);
  });

  test("createEndpoint returns method-specific handler", async () => {
    const app = new Asi({ development: false, silent: true });
    app.get("/api/hello", () => ({ message: "GET only" }));

    const GET = createEndpoint(app, "GET");
    const context = mockAstroContext("/api/hello");
    const res = await GET(context as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe("GET only");
  });

  test("createEndpoint returns 405 for wrong method", async () => {
    const app = new Asi({ development: false, silent: true });
    app.get("/api/hello", () => "ok");

    const POST = createEndpoint(app, "GET");
    const context = mockAstroContext("/api/hello", { method: "POST" });
    const res = await POST(context as any);
    expect(res.status).toBe(405);
  });
});
