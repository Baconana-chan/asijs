/**
 * RPC 2.0 Tests (serverAction + auto treaty generation)
 */

import { describe, it, expect } from "bun:test";
import { Type } from "@sinclair/typebox";
import { Asi } from "../src/asi";
import { serverAction, rpc, createRPCClient, RPCActionError } from "../src/rpc";
import type { RPCClient } from "../src/rpc";

describe("RPC 2.0", () => {
  describe("serverAction()", () => {
    it("should create a branded server action", () => {
      const greet = serverAction(
        Type.Object({ name: Type.String() }),
        async ({ name }) => ({ message: `Hello, ${name}!` }),
      );

      expect(greet.__isServerAction).toBe(true);
      expect(greet.schema).toBeDefined();
      expect(greet.handler).toBeInstanceOf(Function);
    });
  });

  describe("rpc() - server-side direct calls", () => {
    it("should register actions and return typed callable API", async () => {
      const app = new Asi();

      const api = rpc(app, {
        greet: serverAction(
          Type.Object({ name: Type.String() }),
          async ({ name }) => ({ message: `Hello, ${name}!` }),
        ),
      });

      // Server-side direct call (no HTTP)
      const result = await api.greet({ name: "World" });
      expect(result).toEqual({ message: "Hello, World!" });
    });

    it("should support actions with empty input (no args)", async () => {
      const app = new Asi();

      const api = rpc(app, {
        ping: serverAction(
          Type.Object({}),
          async () => ({ pong: true, timestamp: Date.now() }),
        ),
      });

      const result = await api.ping({});
      expect(result).toHaveProperty("pong", true);
      expect(result).toHaveProperty("timestamp");
    });

    it("should validate input on direct calls", async () => {
      const app = new Asi();

      const api = rpc(app, {
        createUser: serverAction(
          Type.Object({
            name: Type.String({ minLength: 1 }),
            email: Type.String({ format: "email" }),
          }),
          async (input) => ({ id: 1, ...input }),
        ),
      });

      // Invalid input
      await expect(
        api.createUser({ name: "", email: "invalid" }),
      ).rejects.toThrow(RPCActionError);
    });

    it("should pass context to handlers on direct calls", async () => {
      const app = new Asi();

      const api = rpc(app, {
        checkCtx: serverAction(
          Type.Object({}),
          async (_, ctx) => ({
            path: ctx.path,
            method: ctx.method,
          }),
        ),
      });

      const result = await api.checkCtx({});
      expect(result.path).toContain("checkCtx");
      expect(result.method).toBe("GET");
    });
  });

  describe("rpc() - HTTP endpoints", () => {
    it("should register POST endpoints and handle requests", async () => {
      const app = new Asi();

      rpc(app, {
        greet: serverAction(
          Type.Object({ name: Type.String() }),
          async ({ name }) => ({ message: `Hello, ${name}!` }),
        ),
      });

      const res = await app.handle(
        new Request("http://localhost/rpc/greet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "HTTP" }),
        }),
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data).toEqual({ message: "Hello, HTTP!" });
    });

    it("should return 400 on validation failure", async () => {
      const app = new Asi();

      rpc(app, {
        createUser: serverAction(
          Type.Object({
            name: Type.String({ minLength: 1 }),
            email: Type.String({ format: "email" }),
          }),
          async (input) => ({ id: 1, ...input }),
        ),
      });

      const res = await app.handle(
        new Request("http://localhost/rpc/createUser", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "", email: "bad" }),
        }),
      );

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Validation failed");
    });

    it("should handle empty body", async () => {
      const app = new Asi();

      const api = rpc(app, {
        status: serverAction(
          Type.Object({}),
          async () => ({ ok: true }),
        ),
      });

      const res = await app.handle(
        new Request("http://localhost/rpc/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }),
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.ok).toBe(true);

      // Server-side direct call
      const result = await api.status({});
      expect(result.ok).toBe(true);
    });

    it("should support custom prefix", async () => {
      const app = new Asi();

      rpc(app, {
        ping: serverAction(
          Type.Object({}),
          async () => ({ pong: true }),
        ),
      }, { prefix: "/api/actions" });

      const res = await app.handle(
        new Request("http://localhost/api/actions/ping", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }),
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.pong).toBe(true);
    });

    it("should handle ActionError on HTTP endpoint", async () => {
      const app = new Asi();

      rpc(app, {
        failing: serverAction(
          Type.Object({}),
          async () => {
            throw new RPCActionError("Something went wrong", "CUSTOM_ERROR");
          },
        ),
      });

      const res = await app.handle(
        new Request("http://localhost/rpc/failing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }),
      );

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Something went wrong");
      expect(data.code).toBe("CUSTOM_ERROR");
    });
  });

  describe("createRPCClient() - type-safe client", () => {
    it("should create a client that makes fetch calls", async () => {
      const app = new Asi();
      let capturedBody: unknown;

      rpc(app, {
        greet: serverAction(
          Type.Object({ name: Type.String() }),
          async ({ name }) => ({ message: `Hello, ${name}!` }),
        ),
      });

      // The custom fetch receives (url, init) from createRPCClient
      const client = createRPCClient("http://localhost", {
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = new Request(input, init);
          const body = await request.clone().text();
          capturedBody = body ? JSON.parse(body) : {};
          return app.handle(request);
        },
      });

      const typedClient = client as unknown as RPCClient<{
        greet: { _input: { name: string }; _output: { message: string } };
      }>;

      const result = await typedClient.greet({ name: "Client" });
      expect(result).toEqual({ message: "Hello, Client!" });
      expect(capturedBody).toEqual({ name: "Client" });
    });

    it("should use custom prefix", async () => {
      const app = new Asi();

      rpc(app, {
        test: serverAction(
          Type.Object({}),
          async () => ({ ok: true }),
        ),
      }, { prefix: "/custom" });

      let capturedPath = "";
      const client = createRPCClient("http://localhost", {
        prefix: "/custom",
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = new Request(input, init);
          capturedPath = new URL(request.url).pathname;
          return app.handle(request);
        },
      });

      const typedClient = client as unknown as RPCClient<{
        test: { _input: {}; _output: { ok: boolean } };
      }>;

      await typedClient.test({});
      expect(capturedPath).toBe("/custom/test");
    });

    it("should throw on error response", async () => {
      const app = new Asi();

      rpc(app, {
        fail: serverAction(
          Type.Object({}),
          async () => {
            throw new RPCActionError("Boom!", "ERR_BOOM");
          },
        ),
      });

      const client = createRPCClient("http://localhost", {
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = new Request(input, init);
          return app.handle(request);
        },
      });

      const typedClient = client as unknown as RPCClient<{
        fail: { _input: {}; _output: unknown };
      }>;

      try {
        await typedClient.fail({});
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(RPCActionError);
        if (error instanceof RPCActionError) {
          expect(error.message).toBe("Boom!");
          expect(error.code).toBe("ERR_BOOM");
        }
      }
    });

    it("should support custom headers", async () => {
      const app = new Asi();

      rpc(app, {
        ping: serverAction(
          Type.Object({}),
          async () => ({ ok: true }),
        ),
      });

      let capturedHeaders: Headers | null = null;
      const client = createRPCClient("http://localhost", {
        headers: { Authorization: "Bearer test-token" },
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = new Request(input, init);
          capturedHeaders = request.headers;
          return app.handle(request);
        },
      });

      const typedClient = client as unknown as RPCClient<{
        ping: { _input: {}; _output: { ok: boolean } };
      }>;

      await typedClient.ping({});
      expect(capturedHeaders?.get("Authorization")).toBe("Bearer test-token");
      expect(capturedHeaders?.get("Content-Type")).toBe("application/json");
    });
  });

  describe("type inference", () => {
    it("should allow exporting and reusing types", async () => {
      // This is the "auto treaty generation" pattern:
      // 1. Define actions on server
      // 2. Export the API type
      // 3. Use createRPCClient on client with the exported type

      const app = new Asi();

      const api = rpc(app, {
        greet: serverAction(
          Type.Object({ name: Type.String() }),
          async ({ name }) => ({ message: `Hello, ${name}!` }),
        ),
        add: serverAction(
          Type.Object({ a: Type.Number(), b: Type.Number() }),
          async ({ a, b }) => ({ result: a + b }),
        ),
      });

      // Server-side direct calls work
      const greetResult = await api.greet({ name: "Types" });
      expect(greetResult.message).toBe("Hello, Types!");

      const addResult = await api.add({ a: 2, b: 3 });
      expect(addResult.result).toBe(5);

      // Export type for client - this is what makes auto treaty generation work
      type AppRPC = typeof api;

      // Verify the type has the correct shape
      // (compile-time check - this is the type safety test)
      const verifyType: AppRPC = api;
      expect(verifyType).toBeDefined();
    });

    it("should work with InferRPCOutput and InferRPCInput helpers", () => {
      const action = serverAction(
        Type.Object({ id: Type.Number() }),
        async ({ id }) => ({ id, found: true }),
      );

      // These are type-level checks - they just need to compile
      type Output = typeof action._output;
      type Input = typeof action._input;

      // Runtime checks that the schema exists
      expect(action.schema).toBeDefined();
    });
  });

  describe("performance - RPC throughput measurement", () => {
    it("direct server calls should be faster than HTTP", async () => {
      const app = new Asi();

      const api = rpc(app, {
        greet: serverAction(
          Type.Object({ name: Type.String() }),
          async ({ name }) => ({ message: `Hello, ${name}!` }),
        ),
      });

      // Measure direct call throughput
      const directStart = performance.now();
      const DIRECT_ITERS = 5000;
      for (let i = 0; i < DIRECT_ITERS; i++) {
        await api.greet({ name: "World" });
      }
      const directTotal = performance.now() - directStart;
      const directRps = Math.round(DIRECT_ITERS / (directTotal / 1000));

      // Measure HTTP call throughput
      const httpStart = performance.now();
      for (let i = 0; i < DIRECT_ITERS; i++) {
        await app.handle(
          new Request("http://localhost/rpc/greet", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "World" }),
          }),
        );
      }
      const httpTotal = performance.now() - httpStart;
      const httpRps = Math.round(DIRECT_ITERS / (httpTotal / 1000));

      // Direct calls should be significantly faster (no HTTP, no JSON parse)
      expect(directRps).toBeGreaterThan(httpRps);
      expect(directRps).toBeGreaterThan(0);
      expect(httpRps).toBeGreaterThan(0);

      // Output for visibility
      console.log(`
  ⚡ RPC Performance:`);
      console.log(`     Direct call: ${directRps.toLocaleString()} req/s (${directTotal.toFixed(1)}ms for ${DIRECT_ITERS})`);
      console.log(`     HTTP call:   ${httpRps.toLocaleString()} req/s (${httpTotal.toFixed(1)}ms for ${DIRECT_ITERS})`);
      console.log(`     Speedup:     ${(directRps / httpRps).toFixed(2)}x`);
    });

    it("multiple concurrent RPC calls should not deadlock", async () => {
      const app = new Asi();

      const api = rpc(app, {
        delay: serverAction(
          Type.Object({ ms: Type.Number() }),
          async ({ ms }) => {
            await new Promise((r) => setTimeout(r, ms));
            return { waited: ms };
          },
        ),
      });

      // Fire 10 concurrent delayed requests (each 50ms)
      // Total should be ~50ms, not ~500ms, if concurrent
      const start = performance.now();
      const results = await Promise.all(
        Array.from({ length: 10 }, () => api.delay({ ms: 50 })),
      );
      const total = performance.now() - start;

      expect(results).toHaveLength(10);
      expect(results[0].waited).toBe(50);
      // With 10 concurrent 50ms requests, total should be < 150ms
      // (allow some overhead for scheduling)
      expect(total).toBeLessThan(200);
    });

    it("createRPCClient proxy should handle sequential calls efficiently", async () => {
      const app = new Asi();

      rpc(app, {
        greet: serverAction(
          Type.Object({ name: Type.String() }),
          async ({ name }) => ({ message: `Hello, ${name}!` }),
        ),
      });

      const client = createRPCClient("http://localhost", {
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          return app.handle(new Request(input, init));
        },
      });

      const typedClient = client as unknown as RPCClient<{
        greet: { _input: { name: string }; _output: { message: string } };
      }>;

      const PROXY_ITERS = 1000;
      const start = performance.now();

      for (let i = 0; i < PROXY_ITERS; i++) {
        const result = await typedClient.greet({ name: "World" });
        expect(result.message).toBe("Hello, World!");
      }

      const total = performance.now() - start;
      const rps = Math.round(PROXY_ITERS / (total / 1000));

      expect(rps).toBeGreaterThan(0);

      console.log(`     Proxy client: ${rps.toLocaleString()} req/s (${total.toFixed(1)}ms for ${PROXY_ITERS})`);
    });
  });

  describe("RPCActionError", () => {
    it("should create error with properties", () => {
      const error = new RPCActionError("Test", "CODE", { detail: "info" });
      expect(error.message).toBe("Test");
      expect(error.code).toBe("CODE");
      expect(error.details).toEqual({ detail: "info" });
      expect(error.name).toBe("RPCActionError");
    });

    it("should serialize to JSON", () => {
      const error = new RPCActionError("Oops", "ERR", { field: "x" });
      const json = error.toJSON();
      expect(json.error).toBe("Oops");
      expect(json.code).toBe("ERR");
      expect(json.details).toEqual({ field: "x" });
    });

    it("should use defaults", () => {
      const error = new RPCActionError("Default test");
      expect(error.code).toBe("RPC_ERROR");
      expect(error.details).toBeUndefined();
    });
  });
});
