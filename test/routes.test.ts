import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import path from "path";
import fs from "fs";
import { Asi, scanRoutes, registerFileRoutes, type FileRoutesOptions } from "../src";

/** Create a temp directory with route files for testing */
function createTestDir(): string {
  const testDir = path.join(
    import.meta.dirname,
    ".test-routes-" + Math.random().toString(36).slice(2),
  );
  return testDir;
}

interface RouteFileDef {
  relativePath: string;
  content: string;
}

function writeRouteFiles(baseDir: string, files: RouteFileDef[]): void {
  for (const f of files) {
    const fullPath = path.join(baseDir, f.relativePath);
    const dir = path.dirname(fullPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, f.content, "utf-8");
  }
}

function cleanupTestDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("scanRoutes", () => {
  let testDir: string;

  afterAll(() => {
    if (testDir) cleanupTestDir(testDir);
  });

  it("returns empty array for non-existent directory", async () => {
    const routes = await scanRoutes("/nonexistent/path/asijs-test");
    expect(routes).toBeEmpty();
  });

  it("returns empty array for empty directory", async () => {
    testDir = createTestDir();
    fs.mkdirSync(testDir, { recursive: true });

    const routes = await scanRoutes(testDir);
    expect(routes).toBeEmpty();
  });

  it("converts [id] to :id in route path", async () => {
    testDir = createTestDir();

    writeRouteFiles(testDir, [
      {
        relativePath: "users/[id].ts",
        content: `export function get(ctx) { return { id: ctx.params.id }; }`,
      },
    ]);

    const routes = await scanRoutes(testDir);
    expect(routes).toHaveLength(1);
    expect(routes[0].method).toBe("GET");
    expect(routes[0].path).toBe("/users/:id");
  });

  it("handles index.ts as directory root", async () => {
    testDir = createTestDir();
    writeRouteFiles(testDir, [
      {
        relativePath: "users/index.ts",
        content: `export function get(ctx) { return ["user list"]; }`,
      },
    ]);

    const routes = await scanRoutes(testDir);
    expect(routes).toHaveLength(1);
    expect(routes[0].method).toBe("GET");
    expect(routes[0].path).toBe("/users");
  });

  it("handles root index.ts as /", async () => {
    testDir = createTestDir();
    writeRouteFiles(testDir, [
      {
        relativePath: "index.ts",
        content: `export function get(ctx) { return "root"; }`,
      },
    ]);

    const routes = await scanRoutes(testDir);
    expect(routes).toHaveLength(1);
    expect(routes[0].method).toBe("GET");
    expect(routes[0].path).toBe("/");
  });

  it("ignores files starting with _", async () => {
    testDir = createTestDir();
    writeRouteFiles(testDir, [
      {
        relativePath: "users.ts",
        content: `export function get(ctx) { return "users"; }`,
      },
      {
        relativePath: "_helpers.ts",
        content: `export function get(ctx) { return "helper"; }`,
      },
      {
        relativePath: "_private/auth.ts",
        content: `export function get(ctx) { return "secret"; }`,
      },
    ]);

    const routes = await scanRoutes(testDir);
    expect(routes).toHaveLength(1);
    expect(routes[0].path).toBe("/users");
  });

  it("ignores directories starting with _", async () => {
    testDir = createTestDir();
    writeRouteFiles(testDir, [
      {
        relativePath: "public/hello.ts",
        content: `export function get(ctx) { return "hello"; }`,
      },
      {
        relativePath: "_components/button.ts",
        content: `export function get(ctx) { return "button"; }`,
      },
    ]);

    const routes = await scanRoutes(testDir);
    expect(routes).toHaveLength(1);
    expect(routes[0].path).toBe("/public/hello");
  });

  it("strips (groups) from route path", async () => {
    testDir = createTestDir();
    writeRouteFiles(testDir, [
      {
        relativePath: "(auth)/login.ts",
        content: `export function post(ctx) { return { ok: true }; }`,
      },
      {
        relativePath: "(api)/v1/users.ts",
        content: `export function get(ctx) { return []; }`,
      },
    ]);

    const routes = await scanRoutes(testDir);
    expect(routes).toHaveLength(2);

    const login = routes.find((r) => r.method === "POST");
    expect(login).toBeDefined();
    expect(login!.path).toBe("/login");

    const users = routes.find((r) => r.method === "GET");
    expect(users).toBeDefined();
    expect(users!.path).toBe("/v1/users");
  });

  it("detects multiple HTTP methods from a single file", async () => {
    testDir = createTestDir();
    writeRouteFiles(testDir, [
      {
        relativePath: "users.ts",
        content: `
          export function get(ctx) { return { method: "GET" }; }
          export function post(ctx) { return { method: "POST" }; }
          export function put(ctx) { return { method: "PUT" }; }
          export function del(ctx) { return { method: "DELETE" }; }
        `,
      },
    ]);

    const routes = await scanRoutes(testDir);
    expect(routes).toHaveLength(3); // get, post, put — del is not a standard method
  });

  it("detects methods via file suffix (users.get.ts)", async () => {
    testDir = createTestDir();
    writeRouteFiles(testDir, [
      {
        relativePath: "users.get.ts",
        content: `export default function(ctx) { return "users"; }`,
      },
      {
        relativePath: "posts.post.ts",
        content: `export default function(ctx) { return "created"; }`,
      },
    ]);

    const routes = await scanRoutes(testDir);
    expect(routes).toHaveLength(2);

    const getRoute = routes.find((r) => r.method === "GET");
    expect(getRoute).toBeDefined();
    expect(getRoute!.path).toBe("/users");

    const postRoute = routes.find((r) => r.method === "POST");
    expect(postRoute).toBeDefined();
    expect(postRoute!.path).toBe("/posts");
  });

  it("supports default export object with method keys", async () => {
    testDir = createTestDir();
    writeRouteFiles(testDir, [
      {
        relativePath: "items.ts",
        content: `
          export default {
            get(ctx) { return { action: "list" }; },
            post(ctx) { return { action: "create" }; },
          };
        `,
      },
    ]);

    const routes = await scanRoutes(testDir);
    expect(routes).toHaveLength(2);
  });

  it("handles prefix option", async () => {
    testDir = createTestDir();
    writeRouteFiles(testDir, [
      {
        relativePath: "users.ts",
        content: `export function get(ctx) { return "users"; }`,
      },
    ]);

    const routes = await scanRoutes(testDir, { prefix: "/api/v1" });
    expect(routes).toHaveLength(1);
    expect(routes[0].path).toBe("/api/v1/users");
  });

  it("handles nested path segments", async () => {
    testDir = createTestDir();
    writeRouteFiles(testDir, [
      {
        relativePath: "api/v1/users/[userId]/posts/[postId].ts",
        content: `export function get(ctx) { return ctx.params; }`,
      },
    ]);

    const routes = await scanRoutes(testDir);
    expect(routes).toHaveLength(1);
    expect(routes[0].path).toBe("/api/v1/users/:userId/posts/:postId");
  });
});

describe("registerFileRoutes", () => {
  let testDir: string;

  afterAll(() => {
    if (testDir) cleanupTestDir(testDir);
  });

  it("registers routes on an Asi instance and they respond", async () => {
    testDir = createTestDir();
    writeRouteFiles(testDir, [
      {
        relativePath: "users.ts",
        content: `
          export function get(ctx) {
            return { users: ["alice", "bob"] };
          }
        `,
      },
    ]);

    const app = new Asi({ silent: true });
    await registerFileRoutes(app, { dir: testDir });

    // Test via handle
    const res1 = await app.handle(new Request("http://localhost/users"));
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.users).toEqual(["alice", "bob"]);
  });
});

describe("Asi.fromFileRoutes", () => {
  let testDir: string;

  afterAll(() => {
    if (testDir) cleanupTestDir(testDir);
  });

  it("scans and registers routes via Asi method", async () => {
    testDir = createTestDir();
    writeRouteFiles(testDir, [
      {
        relativePath: "hello.ts",
        content: `export function get(ctx) { return { message: "Hello, World!" }; }`,
      },
      {
        relativePath: "users/[id].ts",
        content: `export function get(ctx) { return { id: ctx.params.id, name: "User " + ctx.params.id }; }`,
      },
    ]);

    const app = new Asi({ silent: true });
    await app.fromFileRoutes({ dir: testDir });

    // Test GET /hello
    const res1 = await app.handle(new Request("http://localhost/hello"));
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.message).toBe("Hello, World!");

    // Test GET /users/42
    const res2 = await app.handle(new Request("http://localhost/users/42"));
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.id).toBe("42");
    expect(body2.name).toBe("User 42");
  });

  it("can be called with no options (defaults to src/routes)", async () => {
    // This is a smoke test — if no src/routes directory exists, should silently succeed
    const app = new Asi({ silent: true });
    await app.fromFileRoutes();
    // Should not throw
    expect(true).toBe(true);
  });
});

describe("route file schemas", () => {
  let testDir: string;

  afterAll(() => {
    if (testDir) cleanupTestDir(testDir);
  });

  it("supports per-method schemas exported from route file", async () => {
    testDir = createTestDir();
    writeRouteFiles(testDir, [
      {
        relativePath: "users/[id].ts",
        content: `
          import { Type } from "@sinclair/typebox";

          export const schemas = {
            GET: {
              schema: {
                params: Type.Object({ id: Type.String() })
              }
            }
          };

          export function get(ctx) {
            return { id: ctx.params.id };
          }
        `,
      },
    ]);

    const app = new Asi({ silent: true });
    await app.fromFileRoutes({ dir: testDir });

    const res = await app.handle(new Request("http://localhost/users/abc"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("abc");
  });

  it("applies schema validation and returns 400 on invalid input", async () => {
    testDir = createTestDir();
    writeRouteFiles(testDir, [
      {
        relativePath: "validate.ts",
        content: `
          import { Type } from "@sinclair/typebox";
          import type { Static } from "@sinclair/typebox";

          const QuerySchema = Type.Object({
            limit: Type.Optional(Type.Number()),
          });

          export const schema = {
            schema: {
              query: Type.Object({
                search: Type.String({ minLength: 1 }),
              }),
            },
          };

          export function get(ctx) {
            return { search: ctx.query.search };
          }
        `,
      },
    ]);

    const app = new Asi({ silent: true });
    await app.fromFileRoutes({ dir: testDir });

    // Without required query param → 400
    const res1 = await app.handle(new Request("http://localhost/validate"));
    expect(res1.status).toBe(400);
    const body1 = await res1.json();
    expect(body1.error).toBe("Validation Error");

    // With valid query → 200
    const res2 = await app.handle(
      new Request("http://localhost/validate?search=test"),
    );
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.search).toBe("test");
  });
});

describe("edge cases", () => {
  let testDir: string;

  afterAll(() => {
    if (testDir) cleanupTestDir(testDir);
  });

  it("skips non-source files (.txt, .json, .md)", async () => {
    testDir = createTestDir();
    writeRouteFiles(testDir, [
      {
        relativePath: "readme.md",
        content: "# API docs",
      },
      {
        relativePath: "data.json",
        content: '{"key":"value"}',
      },
    ]);

    const routes = await scanRoutes(testDir);
    expect(routes).toBeEmpty();
  });

  it("handles method suffix with default export", async () => {
    testDir = createTestDir();
    writeRouteFiles(testDir, [
      {
        relativePath: "health.get.ts",
        content: `export default (ctx) => ({ status: "ok" });`,
      },
    ]);

    const routes = await scanRoutes(testDir);
    expect(routes).toHaveLength(1);
    expect(routes[0].method).toBe("GET");
    expect(routes[0].path).toBe("/health");
  });

  it("ignores .d.ts files", async () => {
    testDir = createTestDir();
    writeRouteFiles(testDir, [
      {
        relativePath: "types.d.ts",
        content: `export interface User { id: string; }`,
      },
    ]);

    const routes = await scanRoutes(testDir);
    expect(routes).toBeEmpty();
  });
});
