/**
 * Tests: workflow engine — input validation, declarative steps, HTTP steps,
 * code steps, delays, logging, cancellation.
 */

import { describe, expect, it } from "bun:test";
import { Asi } from "../../../src/index.ts";
import {
  createMCPServer,
  validateInput,
  runWorkflow,
  type Workflow,
  type WorkflowRunContext,
} from "../src/index";
import { AsiRuntimeBridge } from "../src/runtime";

function testCtx(overrides: Partial<WorkflowRunContext> = {}): Omit<WorkflowRunContext, "steps"> & { runtime: AsiRuntimeBridge } {
  const events: Array<{ type: string; data: unknown }> = [];
  const ctx = {
    progress: () => {},
    log: () => {},
    cancelled: () => false,
    runtime: new AsiRuntimeBridge(null),
    ...overrides,
  } as unknown as Omit<WorkflowRunContext, "steps"> & { runtime: AsiRuntimeBridge };
  return ctx;
}

describe("validateInput", () => {
  it("enforces required properties", () => {
    const issues = validateInput(
      { type: "object", required: ["name"], properties: { name: { type: "string" } } },
      {},
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("name");
  });

  it("checks types and nested objects", () => {
    const issues = validateInput(
      {
        type: "object",
        properties: {
          age: { type: "number", minimum: 18 },
          tags: { type: "array", items: { type: "string" } },
          meta: { type: "object", properties: { ok: { type: "boolean" } } },
        },
      },
      { age: 12, tags: ["a", 42], meta: { ok: "yes" } },
    );
    expect(issues.length).toBeGreaterThanOrEqual(3);
  });

  it("checks enums and string length", () => {
    const issues = validateInput(
      {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["a", "b"] },
          code: { type: "string", minLength: 3 },
        },
      },
      { mode: "z", code: "ab" },
    );
    expect(issues).toHaveLength(2);
  });
});

describe("runWorkflow", () => {
  it("runs declarative steps in order", async () => {
    const workflow: Workflow = {
      name: "test/seq",
      steps: [
        { type: "code", run: () => 1 },
        { type: "code", run: (_input, prev) => (prev as number) + 1 },
        { type: "code", run: (_input, prev) => (prev as number) * 10 },
      ],
    };
    const result = (await runWorkflow(workflow, {}, testCtx())) as { result: number; steps: unknown[] };
    expect(result.result).toBe(20);
    expect(result.steps).toHaveLength(3);
  });

  it("runs imperative workflows", async () => {
    const workflow: Workflow = {
      name: "test/imperative",
      run: async (input) => ({ echoed: input.value }),
    };
    const result = await runWorkflow(workflow, { value: "x" }, testCtx());
    expect(result).toEqual({ echoed: "x" });
  });

  it("performs real HTTP calls", async () => {
    // A tiny HTTP server to hit
    const app = new Asi({ development: false, silent: true });
    app.post("/echo", async (ctx: any) => {
      const body = await ctx.json();
      return { echoed: body, at: "server" };
    });
    const server = await app.listen(0);
    const url = `http://localhost:${server.port}/echo`;

    const workflow: Workflow = {
      name: "test/http",
      steps: [
        {
          type: "http",
          url: (_input, _prev) => url,
          method: "POST",
          body: { hello: "world" },
          transform: async (response) => response.json(),
        },
      ],
    };

    try {
      const result = (await runWorkflow(workflow, {}, testCtx())) as { result: { status: number; data: { echoed: { hello: string } } } };
      expect(result.result.status).toBe(200);
      expect(result.result.data.echoed.hello).toBe("world");
    } finally {
      server.stop(true);
    }
  });

  it("supports delay and log steps", async () => {
    const logs: string[] = [];
    const workflow: Workflow = {
      name: "test/delay",
      steps: [
        { type: "log", message: "starting" },
        { type: "delay", ms: 5 },
        { type: "log", message: (_input, prev) => `prev=${JSON.stringify(prev)}` },
      ],
    };
    const ctx = testCtx({
      log: (_level, data) => logs.push(String(data)),
    });
    const start = Date.now();
    await runWorkflow(workflow, {}, ctx);
    expect(Date.now() - start).toBeGreaterThanOrEqual(4);
    expect(logs[0]).toBe("starting");
  });

  it("throws when cancelled between steps", async () => {
    const workflow: Workflow = {
      name: "test/cancel",
      steps: [
        { type: "code", run: () => "step1" },
        { type: "code", run: () => "step2" },
      ],
    };
    const ctx = testCtx({ cancelled: () => true });
    await expect(runWorkflow(workflow, {}, ctx)).rejects.toThrow(/cancelled/i);
  });

  it("validates input before running", async () => {
    const workflow: Workflow = {
      name: "test/validate",
      inputSchema: {
        type: "object",
        required: ["url"],
        properties: { url: { type: "string" } },
      },
      run: () => "ran",
    };
    await expect(runWorkflow(workflow, {}, testCtx())).rejects.toThrow(/Missing required property "url"/);
  });

  it("runs the built-in http-request workflow against a live server", async () => {
    const app = new Asi({ development: false, silent: true });
    app.get("/ping", () => ({ pong: true }));
    const server = await app.listen(0);
    const url = `http://localhost:${server.port}/ping`;

    const mcp = createMCPServer(null);
    try {
      const result = await mcp.runWorkflow("asijs/http-request", { url }, {
        progress: () => {},
        log: () => {},
        cancelled: () => false,
      });
      const data = result as { result: { status: number; ok: boolean; data: { pong: boolean } } };
      expect(data.result.status).toBe(200);
      expect(data.result.data.pong).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  it("runs the built-in app-snapshot workflow", async () => {
    const app = new Asi({ development: false, silent: true });
    app.get("/users", () => []);
    const mcp = createMCPServer(app);
    const result = await mcp.runWorkflow("asijs/app-snapshot", {}, {
      progress: () => {},
      log: () => {},
      cancelled: () => false,
    });
    const snapshot = (result as { result: { routes: { available: boolean } } }).result;
    expect(snapshot.routes.available).toBe(true);
  });
});
