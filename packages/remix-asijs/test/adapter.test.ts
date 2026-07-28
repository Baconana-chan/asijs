/**
 * Tests for asijs-remix — Remix adapter
 */

import { describe, test, expect } from "bun:test";
import { Asi } from "../../../src/index.ts";
import { createRemixHandler, createLoader, createAction } from "../src/index";

// ============================================================================
// Mock Remix Loader/Action Args
// ============================================================================

function mockRemixArgs(path: string, options: { method?: string; body?: any } = {}): { request: Request; params: Record<string, string>; context: Record<string, unknown> } {
  const url = `http://localhost${path}`;
  const headers = new Headers({ "content-type": "application/json" });
  let body: string | undefined;
  if (options.body) {
    body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  }
  return {
    request: new Request(url, { method: options.method || "GET", headers, body }),
    params: {},
    context: {},
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("asijs-remix", () => {
  test("createRemixHandler returns loader and action", () => {
    const app = new Asi({ development: false, silent: true });
    app.get("/api/hello", () => ({ message: "Hello!" }));

    const { loader, action } = createRemixHandler(app);
    expect(typeof loader).toBe("function");
    expect(typeof action).toBe("function");
  });

  test("loader returns route response", async () => {
    const app = new Asi({ development: false, silent: true });
    app.get("/api/hello", () => ({ message: "Hello!" }));

    const { loader } = createRemixHandler(app);
    const args = mockRemixArgs("/api/hello");
    const res = await loader(args as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe("Hello!");
  });

  test("action processes POST request", async () => {
    const app = new Asi({ development: false, silent: true });
    app.post("/api/data", async (ctx: any) => {
      const body = await ctx.json();
      return { received: body };
    });

    const { action } = createRemixHandler(app);
    const args = mockRemixArgs("/api/data", { method: "POST", body: { key: "value" } });
    const res = await action(args as any);
    const body = await res.json();
    expect(body.received.key).toBe("value");
  });

  test("basePath stripping works", async () => {
    const app = new Asi({ development: false, silent: true });
    app.get("/hello", () => ({ message: "stripped" }));

    const { loader } = createRemixHandler(app, { basePath: "/api" });
    const args = mockRemixArgs("/api/hello");
    const res = await loader(args as any);
    const body = await res.json();
    expect(body.message).toBe("stripped");
  });

  test("returns 404 for unknown routes", async () => {
    const app = new Asi({ development: false, silent: true });
    const { loader } = createRemixHandler(app);
    const args = mockRemixArgs("/api/unknown");
    const res = await loader(args as any);
    expect(res.status).toBe(404);
  });

  test("route params work through loader", async () => {
    const app = new Asi({ development: false, silent: true });
    app.get("/api/users/:id", (ctx: any) => ({ id: ctx.params.id }));

    const { loader } = createRemixHandler(app);
    const args = mockRemixArgs("/api/users/42");
    const res = await loader(args as any);
    const body = await res.json();
    expect(body.id).toBe("42");
  });

  test("createLoader returns a loader function", () => {
    const app = new Asi({ development: false, silent: true });
    app.get("/api/hello", () => "ok");

    const loader = createLoader(app);
    expect(typeof loader).toBe("function");
  });

  test("createAction returns an action function", () => {
    const app = new Asi({ development: false, silent: true });
    app.post("/api/test", () => "ok");

    const action = createAction(app);
    expect(typeof action).toBe("function");
  });
});
