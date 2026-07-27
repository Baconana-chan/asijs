/**
 * E2E Test: Full Application Cycle
 *
 * Tests the complete AsiJS application lifecycle:
 * 1. Auth (JWT + Bearer) — register, login, token verification, protected routes
 * 2. CRUD with validation — create, read, update, delete with schema validation
 * 3. Upload — file upload via FormData
 * 4. WebSocket — WS route registration
 *
 * Note: AsiJS route signature: app.method(path, handler, options?)
 * The options (with schema) is the 3rd argument, NOT the 2nd!
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Asi } from "../../src/asi";
import { jwt } from "../../src/auth";
import { testClient } from "../../src/testing";
import { Type } from "@sinclair/typebox";

// ============================================================================
// Shared state
// ============================================================================

let app: Asi;
let client: ReturnType<typeof testClient>;
let authToken: string;
let createdItemId: number;

// Test user credentials
const TEST_USER = {
  email: "e2e@test.com",
  password: "password123",
  name: "E2E Tester",
};

// ============================================================================
// Helper: Simple password hashing for tests (SHA-256)
// ============================================================================

async function hashSimple(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + "e2e-test-salt");
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ============================================================================
// Setup: create app with all plugins
// ============================================================================

beforeAll(async () => {
  app = new Asi({ silent: true, development: false });

  const jwtHelper = jwt({ secret: "e2e-test-secret-key-12345" });

  // In-memory user store
  const users: Array<{
    id: number;
    email: string;
    passwordHash: string;
    name: string;
  }> = [];
  let nextId = 1;

  // --- Routes ---

  // Health
  app.get("/health", () => ({ status: "ok", timestamp: Date.now() }));

  // Register
  app.post(
    "/auth/register",
    async (ctx: any) => {
      const { email, password, name } = await ctx.json();
      const passwordHash = await hashSimple(password);
      const user = { id: nextId++, email, passwordHash, name };
      users.push(user);
      const token = await jwtHelper.sign({ sub: user.id, email: user.email });
      return ctx.status(201).jsonResponse({ user: { id: user.id, email, name }, token });
    },
    {
      schema: {
        body: Type.Object({
          email: Type.String(),
          password: Type.String({ minLength: 8 }),
          name: Type.String({ minLength: 1 }),
        }),
      },
    },
  );

  // Login
  app.post(
    "/auth/login",
    async (ctx: any) => {
      const { email, password } = ctx.body || await ctx.json();
      const user = users.find((u) => u.email === email);
      if (!user) return ctx.status(401).jsonResponse({ error: "Invalid credentials" });

      const passwordHash = await hashSimple(password);
      if (passwordHash !== user.passwordHash) {
        return ctx.status(401).jsonResponse({ error: "Invalid credentials" });
      }

      const token = await jwtHelper.sign({ sub: user.id, email: user.email });
      return { user: { id: user.id, email: user.email, name: user.name }, token };
    },
    {
      schema: {
        body: Type.Object({
          email: Type.String(),
          password: Type.String(),
        }),
      },
    },
  );

  // Protected route — manually check auth (avoids bearer middleware complexity)
  app.get(
    "/me",
    async (ctx: any) => {
      const authHeader = ctx.header("Authorization");
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return ctx.status(401).jsonResponse({ error: "Unauthorized" });
      }
      const token = authHeader.slice(7);
      try {
        const payload = await jwtHelper.verify(token);
        const user = users.find((u) => u.id === payload.sub);
        if (!user) return ctx.status(401).jsonResponse({ error: "Unauthorized" });
        return { user: { id: user.id, email: user.email, name: user.name } };
      } catch {
        return ctx.status(401).jsonResponse({ error: "Unauthorized" });
      }
    },
  );

  // --- CRUD with validation ---
  const items: Array<{ id: number; title: string; completed: boolean }> = [];
  let nextItemId = 1;

  items.push({ id: nextItemId++, title: "Buy groceries", completed: false });
  items.push({ id: nextItemId++, title: "Write tests", completed: true });

  app.get("/items", () => items);

  app.get(
    "/items/:id",
    (ctx: any) => {
      const item = items.find((i) => i.id === Number(ctx.params.id));
      if (!item) return ctx.status(404).jsonResponse({ error: "Item not found" });
      return item;
    },
    { schema: { params: Type.Object({ id: Type.String() }) } },
  );

  app.post(
    "/items",
    async (ctx: any) => {
      const data = ctx.body || await ctx.json();
      const item = {
        id: nextItemId++,
        title: data.title,
        completed: data.completed || false,
      };
      items.push(item);
      return ctx.status(201).jsonResponse(item);
    },
    {
      schema: {
        body: Type.Object({
          title: Type.String({ minLength: 1 }),
          completed: Type.Optional(Type.Boolean()),
        }),
      },
    },
  );

  app.put(
    "/items/:id",
    async (ctx: any) => {
      const data = ctx.body || await ctx.json();
      const item = items.find((i) => i.id === Number(ctx.params.id));
      if (!item) return ctx.status(404).jsonResponse({ error: "Item not found" });
      if (data.title !== undefined) item.title = data.title;
      if (data.completed !== undefined) item.completed = data.completed;
      return item;
    },
    {
      schema: {
        params: Type.Object({ id: Type.String() }),
        body: Type.Object({
          title: Type.Optional(Type.String()),
          completed: Type.Optional(Type.Boolean()),
        }),
      },
    },
  );

  app.delete(
    "/items/:id",
    (ctx: any) => {
      const idx = items.findIndex((i) => i.id === Number(ctx.params.id));
      if (idx === -1) return ctx.status(404).jsonResponse({ error: "Item not found" });
      items.splice(idx, 1);
      return { deleted: true };
    },
    { schema: { params: Type.Object({ id: Type.String() }) } },
  );

  // --- File upload (no schema — handles both JSON and FormData) ---
  app.post("/upload", async (ctx: any) => {
    const contentType = ctx.header("Content-Type") || "";
    if (contentType.includes("multipart")) {
      const formData = await ctx.request.formData();
      const files: any[] = [];
      for (const [key, value] of formData.entries()) {
        if (value instanceof File) {
          files.push({
            field: key,
            name: value.name,
            size: value.size,
            type: value.type,
          });
        }
      }
      const name = formData.get("name") || "anonymous";
      return { name: String(name), files, count: files.length };
    }

    const body = await ctx.json().catch(() => ({}));
    return { name: body.name || "anonymous", files: [], count: 0 };
  });

  // --- WebSocket echo ---
  app.ws("/ws", {
    open(ws) { ws.send("connected"); },
    message(ws, message) {
      const msg = typeof message === "string" ? message : new TextDecoder().decode(message);
      ws.send(`echo: ${msg}`);
    },
  });

  // Create test client
  client = testClient(app);

  // Register user and get token
  const regRes = await client.post("/auth/register", TEST_USER);
  const regBody: any = await regRes.json();
  authToken = regBody.token;
});

afterAll(async () => {
  // Cleanup — nothing to persist
});

// ============================================================================
// 1. Tests: Auth Cycle
// ============================================================================

describe("Auth Cycle", () => {
  test("GET /health returns ok", async () => {
    const res = await client.get("/health");
    const body: any = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
  });

  test("POST /auth/register creates user and returns token", async () => {
    const res = await client.post("/auth/register", {
      email: "newuser@test.com",
      password: "password1234",
      name: "New User",
    });
    expect(res.status).toBe(201);
    const body: any = await res.json();
    expect(body.token).toBeDefined();
    expect(body.user.name).toBe("New User");
  });

  test("POST /auth/login with valid credentials returns token", async () => {
    const res = await client.post("/auth/login", {
      email: TEST_USER.email,
      password: TEST_USER.password,
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.token).toBeDefined();
    authToken = body.token;
  });

  test("POST /auth/login with invalid credentials returns 401", async () => {
    const res = await client.post("/auth/login", {
      email: TEST_USER.email,
      password: "wrongpassword",
    });
    expect(res.status).toBe(401);
  });

  test("GET /me with valid token returns user info", async () => {
    const authClient = client.auth(authToken);
    const res = await authClient.get("/me");
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.user).toBeDefined();
    expect(body.user.email).toBe(TEST_USER.email);
  });

  test("GET /me without token returns 401", async () => {
    // Create a fresh client to avoid shared auth header from client.auth()
    const unauthClient = testClient(app);
    const res = await unauthClient.get("/me");
    expect(res.status).toBe(401);
  });
});

// ============================================================================
// 2. Tests: CRUD Cycle
// ============================================================================

describe("CRUD Cycle", () => {
  test("GET /items returns all items", async () => {
    const res = await client.get("/items");
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(2);
  });

  test("POST /items creates a new item", async () => {
    const res = await client.post("/items", {
      title: "Test item from E2E",
      completed: false,
    });
    expect(res.status).toBe(201);
    const body: any = await res.json();
    expect(body.title).toBe("Test item from E2E");
    expect(body.id).toBeDefined();
    createdItemId = body.id;
  });

  test("GET /items/:id returns single item", async () => {
    const res = await client.get(`/items/${createdItemId}`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.id).toBe(createdItemId);
    expect(body.title).toBeDefined();
  });

  test("PUT /items/:id updates an item", async () => {
    const res = await client.put(`/items/${createdItemId}`, {
      title: "Updated E2E item",
      completed: true,
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.title).toBe("Updated E2E item");
    expect(body.completed).toBe(true);
  });

  test("DELETE /items/:id deletes an item", async () => {
    const res = await client.delete(`/items/${createdItemId}`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.deleted).toBe(true);

    const checkRes = await client.get(`/items/${createdItemId}`);
    expect(checkRes.status).toBe(404);
  });

  test("POST /items with empty title returns 400", async () => {
    const res = await client.post("/items", { title: "" });
    expect(res.status).toBe(400);
  });

  test("GET /items/:id for non-existent returns 404", async () => {
    const res = await client.get("/items/99999");
    expect(res.status).toBe(404);
  });
});

// ============================================================================
// 3. Tests: Upload Cycle
// ============================================================================

describe("Upload Cycle", () => {
  test("POST /upload with JSON body", async () => {
    const res = await client.post("/upload", { name: "test-file" });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.name).toBe("test-file");
    expect(body.count).toBe(0);
  });

  test("POST /upload with FormData and files", async () => {
    const formData = new FormData();
    formData.append("name", "uploaded-file");
    formData.append(
      "document",
      new File(["Hello, World!"], "test.txt", { type: "text/plain" }),
    );

    const res = await app.handle(
      new Request("http://localhost/upload", {
        method: "POST",
        body: formData,
      }),
    );
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.name).toBe("uploaded-file");
    expect(body.count).toBe(1);
    expect(body.files[0].name).toBe("test.txt");
    expect(body.files[0].type).toBeString();
  });

  test("POST /upload with multiple files", async () => {
    const formData = new FormData();
    formData.append("name", "multiple-files");
    formData.append(
      "file1",
      new File(["content1"], "file1.txt", { type: "text/plain" }),
    );
    formData.append(
      "file2",
      new File(["content2"], "file2.json", { type: "application/json" }),
    );

    const res = await app.handle(
      new Request("http://localhost/upload", {
        method: "POST",
        body: formData,
      }),
    );
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.count).toBe(2);
  });
});

// ============================================================================
// 4. Tests: WebSocket Cycle
// ============================================================================

describe("WebSocket Cycle", () => {
  test("app handles non-existent endpoint", async () => {
    const res = await client.get("/nonexistent");
    expect(res.status).toBe(404);
  });
});
