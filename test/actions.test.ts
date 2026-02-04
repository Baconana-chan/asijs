/**
 * Server Actions Tests
 */

import { describe, it, expect } from "bun:test";
import { Type } from "@sinclair/typebox";
import { Asi } from "../src/asi";
import {
  action,
  simpleAction,
  registerActions,
  registerBatchActions,
  ActionError,
  requireAuth,
  actionRateLimit,
} from "../src/actions";

describe("Server Actions", () => {
  describe("action()", () => {
    it("should create an action with validation", () => {
      const testAction = action(
        Type.Object({ name: Type.String() }),
        async (input) => ({ hello: input.name })
      );

      expect(testAction.__isAction).toBe(true);
      expect(testAction.inputSchema).toBeDefined();
      expect(testAction.handler).toBeInstanceOf(Function);
    });

    it("should create a simple action without input", () => {
      const testAction = simpleAction(async () => ({ status: "ok" }));

      expect(testAction.__isAction).toBe(true);
    });
  });

  describe("registerActions()", () => {
    it("should register actions as POST endpoints", async () => {
      const app = new Asi();

      const actions = {
        getStatus: simpleAction(async () => ({ status: "ok" })),
        echo: action(
          Type.Object({ message: Type.String() }),
          async (input) => ({ echo: input.message })
        ),
      };

      registerActions(app, actions, { prefix: "/api" });

      // Test getStatus
      const res1 = await app.handle(new Request("http://localhost/api/getStatus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }));

      expect(res1.status).toBe(200);
      const data1 = await res1.json();
      expect(data1.success).toBe(true);
      expect(data1.data.status).toBe("ok");

      // Test echo
      const res2 = await app.handle(new Request("http://localhost/api/echo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Hello!" }),
      }));

      expect(res2.status).toBe(200);
      const data2 = await res2.json();
      expect(data2.success).toBe(true);
      expect(data2.data.echo).toBe("Hello!");
    });

    it("should validate input", async () => {
      const app = new Asi();

      const actions = {
        createUser: action(
          Type.Object({
            name: Type.String({ minLength: 1 }),
            email: Type.String({ format: "email" }),
          }),
          async (input) => ({ user: input })
        ),
      };

      registerActions(app, actions);

      // Invalid email
      const res = await app.handle(new Request("http://localhost/actions/createUser", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "John", email: "invalid" }),
      }));

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.code).toBe("VALIDATION_ERROR");
    });

    it("should handle ActionError", async () => {
      const app = new Asi();

      const actions = {
        fail: simpleAction(async () => {
          throw new ActionError("Custom error", "CUSTOM_CODE", 422);
        }),
      };

      registerActions(app, actions);

      const res = await app.handle(new Request("http://localhost/actions/fail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }));

      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.error).toBe("Custom error");
      expect(data.code).toBe("CUSTOM_CODE");
    });
  });

  describe("middleware", () => {
    it("should run requireAuth middleware", async () => {
      const app = new Asi();

      const getUser = (ctx: any) => {
        const auth = ctx.header("authorization");
        if (auth === "Bearer valid") return { id: 1, name: "Admin" };
        return null;
      };

      const actions = {
        protected: action(
          Type.Object({}),
          async (_input, ctx) => ({ user: (ctx as any).user }),
          { middleware: [requireAuth(getUser)] }
        ),
      };

      registerActions(app, actions);

      // Without auth
      const res1 = await app.handle(new Request("http://localhost/actions/protected", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }));

      expect(res1.status).toBe(401);

      // With auth
      const res2 = await app.handle(new Request("http://localhost/actions/protected", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer valid",
        },
        body: JSON.stringify({}),
      }));

      expect(res2.status).toBe(200);
      const data = await res2.json();
      expect(data.data.user.name).toBe("Admin");
    });

    it("should run actionRateLimit middleware", async () => {
      const app = new Asi();

      const actions = {
        limited: action(
          Type.Object({}),
          async () => ({ ok: true }),
          { middleware: [actionRateLimit(2, 60000)] }
        ),
      };

      registerActions(app, actions);

      // First two should succeed
      const res1 = await app.handle(new Request("http://localhost/actions/limited", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }));
      expect(res1.status).toBe(200);

      const res2 = await app.handle(new Request("http://localhost/actions/limited", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }));
      expect(res2.status).toBe(200);

      // Third should fail
      const res3 = await app.handle(new Request("http://localhost/actions/limited", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }));
      expect(res3.status).toBe(429);
    });
  });

  describe("batch actions", () => {
    it("should execute multiple actions in batch", async () => {
      const app = new Asi();

      const actions = {
        add: action(
          Type.Object({ a: Type.Number(), b: Type.Number() }),
          async ({ a, b }) => ({ result: a + b })
        ),
        multiply: action(
          Type.Object({ a: Type.Number(), b: Type.Number() }),
          async ({ a, b }) => ({ result: a * b })
        ),
      };

      registerActions(app, actions);
      registerBatchActions(app, actions);

      const res = await app.handle(new Request("http://localhost/actions/__batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          { action: "add", input: { a: 2, b: 3 } },
          { action: "multiply", input: { a: 4, b: 5 } },
        ]),
      }));

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.results).toHaveLength(2);
      expect(data.results[0].success).toBe(true);
      expect(data.results[0].data.result).toBe(5);
      expect(data.results[1].success).toBe(true);
      expect(data.results[1].data.result).toBe(20);
    });

    it("should handle unknown actions in batch", async () => {
      const app = new Asi();

      const actions = {
        existing: simpleAction(async () => ({ ok: true })),
      };

      registerActions(app, actions);
      registerBatchActions(app, actions);

      const res = await app.handle(new Request("http://localhost/actions/__batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          { action: "existing", input: {} },
          { action: "nonexistent", input: {} },
        ]),
      }));

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.results[0].success).toBe(true);
      expect(data.results[1].success).toBe(false);
      expect(data.results[1].code).toBe("UNKNOWN_ACTION");
    });
  });

  describe("ActionError", () => {
    it("should create error with all properties", () => {
      const error = new ActionError("Test error", "TEST_CODE", 400, { field: "value" });

      expect(error.message).toBe("Test error");
      expect(error.code).toBe("TEST_CODE");
      expect(error.status).toBe(400);
      expect(error.details).toEqual({ field: "value" });
    });

    it("should serialize to JSON", () => {
      const error = new ActionError("Test error", "TEST_CODE", 400, { field: "value" });
      const json = error.toJSON();

      expect(json.error).toBe("Test error");
      expect(json.code).toBe("TEST_CODE");
      expect(json.details).toEqual({ field: "value" });
    });
  });
});
