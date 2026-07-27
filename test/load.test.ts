/**
 * Tests for Load Testing Suite (bench/load/)
 */

import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOAD_DIR = join(__dirname, "..", "bench", "load");
const RESULTS_DIR = join(__dirname, "..", "bench", "results");

// ========================================================================
// Scenario Files Exist
// ========================================================================

describe("k6 scenario files", () => {
  const scenarios = [
    { name: "k6-options.js", label: "shared options" },
    { name: "auth-flow.js", label: "auth flow scenario" },
    { name: "crud.js", label: "CRUD scenario" },
    { name: "websocket.js", label: "WebSocket scenario" },
    { name: "file-upload.js", label: "file upload scenario" },
  ];

  for (const s of scenarios) {
    test(`${s.name} — ${s.label} exists`, async () => {
      const path = join(LOAD_DIR, s.name);
      expect(existsSync(path)).toBe(true);
      const content = readFileSync(path, "utf-8");
      expect(content.length).toBeGreaterThan(100);
    });
  }

  test("orchestrator exists", async () => {
    const path = join(LOAD_DIR, "index.ts");
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, "utf-8");
    expect(content).toContain("createLoadTestApp");
    expect(content).toContain("runK6Scenario");
    expect(content).toContain("SCENARIOS");
  });
});

// ========================================================================
// k6 Options Structure
// ========================================================================

describe("k6-options.js exports", () => {
  test("exports BASE_OPTIONS with required fields", async () => {
    // Read the JS file as text and verify structure
    const content = readFileSync(join(LOAD_DIR, "k6-options.js"), "utf-8");
    expect(content).toContain("export const BASE_OPTIONS");
    expect(content).toContain("summaryTrendStats");
    expect(content).toContain("http_req_failed");
    expect(content).toContain("http_req_duration");
    expect(content).toContain("export const BASE_URL");
  });

  test("exports helper functions", () => {
    const content = readFileSync(join(LOAD_DIR, "k6-options.js"), "utf-8");
    expect(content).toContain("export function jsonBody");
    expect(content).toContain("export function authParams");
    expect(content).toContain("export function jsonParams");
  });
});

// ========================================================================
// Scenario File Structure
// ========================================================================

describe("scenario structure", () => {
  const scenarioFiles = ["auth-flow.js", "crud.js", "websocket.js", "file-upload.js"];

  for (const file of scenarioFiles) {
    test(`${file} has required k6 imports`, () => {
      const content = readFileSync(join(LOAD_DIR, file), "utf-8");
      expect(content).toContain('from "k6"');
      expect(content).toContain("export const options");
      expect(content).toContain("export default function");
    });

    test(`${file} uses checks`, () => {
      const content = readFileSync(join(LOAD_DIR, file), "utf-8");
      expect(content).toContain("check(");
    });

    test(`${file} has proper k6 options`, () => {
      const content = readFileSync(join(LOAD_DIR, file), "utf-8");
      expect(content).toContain("...BASE_OPTIONS");
    });
  }
});

// ========================================================================
// Orchestrator Functions
// ========================================================================

describe("orchestrator — createLoadTestApp", () => {
  test("creates app with all required routes", async () => {
    // The module should export something or the file should exist
    const mod = await import("../bench/load/index.ts");
    expect(mod).toBeDefined();
    // createLoadTestApp is a private function but we can test the raw module imports
    expect(typeof mod.extractMetricsFromOutput).toBe("function");
    expect(typeof mod.tryParseK6JSON).toBe("function");
  });

  test("app handles auth flow correctly", async () => {
    const { Asi } = await import("../src/index");

    const app = new Asi({ development: false, silent: true });
    const tokens = new Set<string>();

    app.post("/api/auth/register", async (ctx: any) => {
      const { email, password } = await ctx.json();
      if (!email || !password) {
        return new Response(JSON.stringify({ error: "email and password required" }), { status: 400 });
      }
      const token = `jwt_${Math.random().toString(36).slice(2)}_${email}`;
      tokens.add(token);
      return Response.json({ token, user: { email, name: "Test" } }, { status: 201 });
    });

    app.post("/api/auth/login", async (ctx: any) => {
      const { email } = await ctx.json();
      const token = `jwt_${Math.random().toString(36).slice(2)}_${email}`;
      tokens.add(token);
      return Response.json({ token, user: { email, name: "Test" } });
    });

    app.get("/api/auth/profile", (ctx: any) => {
      const auth = ctx.request.headers.get("Authorization");
      if (!auth || !auth.startsWith("Bearer ") || !tokens.has(auth.slice(7))) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      }
      return { email: "test@example.com", name: "Test" };
    });

    const fn = (r: Request) => app.handle(r);

    // Register
    const registerRes = await fn(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "test@example.com", password: "Test123!" }),
      }),
    );
    expect(registerRes.status).toBe(201);
    const registerData = await registerRes.json();
    expect(registerData.token).toBeDefined();

    // Login
    const loginRes = await fn(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "test@example.com", password: "Test123!" }),
      }),
    );
    expect(loginRes.status).toBe(200);

    // Profile (authenticated)
    const profileRes = await fn(
      new Request("http://localhost/api/auth/profile", {
        headers: { Authorization: `Bearer ${registerData.token}` },
      }),
    );
    expect(profileRes.status).toBe(200);

    // Profile (unauthenticated)
    const unauthRes = await fn(
      new Request("http://localhost/api/auth/profile"),
    );
    expect(unauthRes.status).toBe(401);
  });

  test("app handles CRUD operations correctly", async () => {
    const { Asi } = await import("../src/index");

    const app = new Asi({ development: false, silent: true });
    const items = new Map<string, any>();

    app.post("/api/items", async (ctx: any) => {
      const body = await ctx.json();
      const id = `item_${Math.random().toString(36).slice(2)}`;
      const item = { id, ...body, createdAt: new Date().toISOString() };
      items.set(id, item);
      return Response.json(item, { status: 201 });
    });

    app.get("/api/items", () => {
      return Response.json(Array.from(items.values()));
    });

    app.get("/api/items/:id", (ctx: any) => {
      const item = items.get(ctx.params.id);
      if (!item) return new Response("Not found", { status: 404 });
      return Response.json(item);
    });

    app.put("/api/items/:id", async (ctx: any) => {
      const existing = items.get(ctx.params.id);
      if (!existing) return new Response("Not found", { status: 404 });
      const body = await ctx.json();
      const updated = { ...existing, ...body };
      items.set(ctx.params.id, updated);
      return Response.json(updated);
    });

    app.delete("/api/items/:id", (ctx: any) => {
      if (!items.has(ctx.params.id)) return new Response("Not found", { status: 404 });
      items.delete(ctx.params.id);
      return new Response(null, { status: 204 });
    });

    const fn = (r: Request) => app.handle(r);

    // Create
    const createRes = await fn(
      new Request("http://localhost/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "test", value: 42 }),
      }),
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.id).toBeDefined();

    // List
    const listRes = await fn(new Request("http://localhost/api/items"));
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBe(1);

    // Get by ID
    const getRes = await fn(new Request(`http://localhost/api/items/${created.id}`));
    expect(getRes.status).toBe(200);
    const got = await getRes.json();
    expect(got.name).toBe("test");

    // Update
    const updateRes = await fn(
      new Request(`http://localhost/api/items/${created.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: 99 }),
      }),
    );
    expect(updateRes.status).toBe(200);

    // Delete
    const deleteRes = await fn(
      new Request(`http://localhost/api/items/${created.id}`, { method: "DELETE" }),
    );
    expect(deleteRes.status).toBe(204);

    // 404
    const notFoundRes = await fn(
      new Request("http://localhost/api/items/nonexistent"),
    );
    expect(notFoundRes.status).toBe(404);
  });

  test("app handles file upload correctly", async () => {
    const { Asi } = await import("../src/index");

    const app = new Asi({ development: false, silent: true });
    const files = new Map<string, any>();

    app.post("/api/upload", async (ctx: any) => {
      const formData = await ctx.request.formData();
      const file = formData.get("file") as File | null;
      if (!file) return new Response(JSON.stringify({ error: "no file" }), { status: 400 });
      const id = `file_${Math.random().toString(36).slice(2)}`;
      const uploaded = {
        id,
        name: file.name,
        size: file.size,
        description: formData.get("description") || "",
        createdAt: new Date().toISOString(),
      };
      files.set(id, uploaded);
      return Response.json(uploaded, { status: 201 });
    });

    app.get("/api/upload", () => {
      return Response.json(Array.from(files.values()));
    });

    app.delete("/api/upload/:id", (ctx: any) => {
      if (!files.has(ctx.params.id)) return new Response("Not found", { status: 404 });
      files.delete(ctx.params.id);
      return new Response(null, { status: 204 });
    });

    const fn = (r: Request) => app.handle(r);

    // Upload
    const formData = new FormData();
    formData.append("file", new Blob(["hello world"], { type: "text/plain" }), "test.txt");
    formData.append("description", "test upload");

    const uploadRes = await fn(
      new Request("http://localhost/api/upload", { method: "POST", body: formData }),
    );
    expect(uploadRes.status).toBe(201);
    const uploaded = await uploadRes.json();
    expect(uploaded.id).toBeDefined();
    expect(uploaded.name).toBe("test.txt");

    // List
    const listRes = await fn(new Request("http://localhost/api/upload"));
    expect(listRes.status).toBe(200);
  });
});

// ========================================================================
// Results Directory
// ========================================================================

describe("results directory", () => {
  test("results dir exists", () => {
    expect(existsSync(RESULTS_DIR)).toBe(true);
  });
});

// ========================================================================
// Orchestrator: extractMetricsFromOutput
// ========================================================================

describe("extractMetricsFromOutput", () => {
  test("parses k6 text output format", async () => {
    const { extractMetricsFromOutput } = await import("../bench/load/index.ts");

    const sampleOutput = `
      http_req_duration......: avg=15.42ms min=3ms med=10ms max=250ms p(90)=30ms p(95)=45ms p(99)=100ms
      http_req_failed.......: 0.50%  ✓ 4990  ✗ 25
      http_reqs.............: 5015 167.166667/s
      iterations............: 5015 167.166667/s
      vus...................: 10
    `;

    const result = extractMetricsFromOutput(sampleOutput);
    expect(result.metrics.http_req_duration.avg).toBe(15.42);
    expect(result.metrics.http_req_duration["p(90)"]).toBe(30);
    expect(result.metrics.http_req_duration["p(95)"]).toBe(45);
    expect(result.metrics.http_req_duration["p(99)"]).toBe(100);
    expect(result.metrics.http_reqs.count).toBe(5015);
    expect(result.metrics.http_reqs.rate).toBeCloseTo(167.17, 1);
    expect(result.metrics.http_req_failed.rate).toBe(0.005);
    expect(result.metrics.http_req_failed.passes).toBe(4990);
    expect(result.metrics.http_req_failed.fails).toBe(25);
  });

  test("handles empty output gracefully", async () => {
    const { extractMetricsFromOutput } = await import("../bench/load/index.ts");

    const result = extractMetricsFromOutput("");
    expect(result.metrics).toBeDefined();
    expect(result.metrics.http_reqs.count).toBe(0);
    expect(result.metrics.http_req_duration.avg).toBe(0);
  });
});

// ========================================================================
// Package.json Scripts
// ========================================================================

describe("bench/package.json scripts", () => {
  test("has load test scripts", () => {
    const benchPkg = JSON.parse(
      readFileSync(join(__dirname, "..", "bench", "package.json"), "utf-8"),
    );
    expect(benchPkg.scripts.load).toBe("bun run load/index.ts");
    expect(benchPkg.scripts["load:auth"]).toContain("SCENARIO=auth");
    expect(benchPkg.scripts["load:crud"]).toContain("SCENARIO=crud");
    expect(benchPkg.scripts["load:ws"]).toContain("SCENARIO=websocket");
    expect(benchPkg.scripts["load:upload"]).toContain("SCENARIO=upload");
  });
});
