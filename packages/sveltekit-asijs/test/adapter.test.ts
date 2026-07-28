/**
 * Tests for asijs-sveltekit — SvelteKit adapter
 */

import { describe, test, expect } from "bun:test";
import { Asi } from "../../../src/index.ts";
import { createSvelteKitHook, createServerHandler, createUniversalHandler } from "../src/index";

// ============================================================================
// Mock SvelteKit Event
// ============================================================================

function mockSvelteKitEvent(path: string, options: { method?: string; body?: any } = {}): any {
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
    url,
    params: {},
    locals: {},
    cookies: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
    },
    platform: {},
    fetch: globalThis.fetch,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("asijs-sveltekit", () => {
  test("createSvelteKitHook returns handle function", () => {
    const app = new Asi({ development: false, silent: true });
    app.get("/api/hello", () => ({ message: "Hello!" }));

    const handle = createSvelteKitHook(app);
    expect(typeof handle).toBe("function");
    expect(handle.length).toBe(2); // handle(event, resolve)
  });

  test("handle passes through non-API routes", async () => {
    const app = new Asi({ development: false, silent: true });
    app.get("/api/hello", () => ({ message: "Hello!" }));

    const handle = createSvelteKitHook(app, { basePath: "/api" });
    const event = mockSvelteKitEvent("/non-api/page");
    const resolve = () => new Response("SvelteKit page");
    const res = await handle(event, resolve);
    const text = await res.text();
    expect(text).toBe("SvelteKit page");
  });

  test("handle returns AsiJS response for API routes", async () => {
    const app = new Asi({ development: false, silent: true });
    app.get("/api/hello", () => ({ message: "Hello!" }));

    const handle = createSvelteKitHook(app, { basePath: "/api" });
    const event = mockSvelteKitEvent("/api/hello");
    const resolve = () => new Response("should not reach");
    const res = await handle(event, resolve);
    const body = await res.json();
    expect(body.message).toBe("Hello!");
  });

  test("handle falls through on 404", async () => {
    const app = new Asi({ development: false, silent: true });
    app.get("/api/hello", () => "existing");

    const handle = createSvelteKitHook(app, { basePath: "/api" });
    const event = mockSvelteKitEvent("/api/unknown");
    const resolve = () => new Response("fallback");
    const res = await handle(event, resolve);
    const text = await res.text();
    expect(text).toBe("fallback");
  });

  test("createServerHandler returns method-specific handler", async () => {
    const app = new Asi({ development: false, silent: true });
    app.get("/api/hello", () => ({ message: "Hello!" }));

    const GET = createServerHandler(app, "GET");
    const event = mockSvelteKitEvent("/api/hello");
    const res = await GET(event);
    const body = await res.json();
    expect(body.message).toBe("Hello!");
  });

  test("createServerHandler returns 405 for wrong method", async () => {
    const app = new Asi({ development: false, silent: true });
    app.get("/api/hello", () => "ok");

    const POST = createServerHandler(app, "POST");
    const event = mockSvelteKitEvent("/api/hello", { method: "GET" });
    const res = await POST(event);
    expect(res.status).toBe(405);
  });

  test("createUniversalHandler handles all methods", async () => {
    const app = new Asi({ development: false, silent: true });
    app.get("/api/hello", () => ({ from: "GET" }));
    app.post("/api/hello", () => ({ from: "POST" }));

    const handler = createUniversalHandler(app);
    const getEvent = mockSvelteKitEvent("/api/hello", { method: "GET" });
    const postEvent = mockSvelteKitEvent("/api/hello", { method: "POST" });

    const getRes = await handler(getEvent);
    const getBody = await getRes.json();
    expect(getBody.from).toBe("GET");

    const postRes = await handler(postEvent);
    const postBody = await postRes.json();
    expect(postBody.from).toBe("POST");
  });

  test("handles POST with body", async () => {
    const app = new Asi({ development: false, silent: true });
    app.post("/api/data", async (ctx: any) => {
      const body = await ctx.json();
      return { received: body };
    });

    const handle = createSvelteKitHook(app, { basePath: "/api" });
    const event = mockSvelteKitEvent("/api/data", { method: "POST", body: { key: "value" } });
    const resolve = () => new Response("fallback");
    const res = await handle(event, resolve);
    const body = await res.json();
    expect(body.received.key).toBe("value");
  });
});
