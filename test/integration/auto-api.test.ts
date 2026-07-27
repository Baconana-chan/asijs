/**
 * Integration Tests: Auto API with PostgreSQL
 *
 * These tests connect to a real PostgreSQL database running in Docker.
 * Uses docker/docker-compose.test.yml for infrastructure.
 *
 * Prerequisites:
 *   docker compose -f docker/docker-compose.test.yml up -d
 *
 * Each test:
 * 1. Connects to PostgreSQL
 * 2. Creates test tables
 * 3. Registers auto-api plugin with the real DB
 * 4. Makes HTTP requests and verifies results
 * 5. Cleans up
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Asi } from "../../src/asi";
import { autoAPI, parseQueryParams, buildSelectSQL } from "../../src/auto-api";
import {
  CONFIG,
  isPostgresAvailable,
  connectPostgres,
  setupTestDatabase,
  seedTestData,
  teardownTestDatabase,
} from "./docker-helper";

// ============================================================================
// Test configuration — use dedicated test DB
// ============================================================================

const PG_AVAILABLE = await isPostgresAvailable();

let db: Awaited<ReturnType<typeof connectPostgres>> | null = null;

describe("Auto API with PostgreSQL", () => {
  beforeAll(async () => {
    if (!PG_AVAILABLE) {
      console.log("  ⏭️  PostgreSQL not available — skipping integration tests");
      return;
    }

    db = await connectPostgres();
    await setupTestDatabase(db);
  });

  afterAll(async () => {
    if (db) {
      await teardownTestDatabase(db);
      await db.close();
    }
  });

  // Skip all tests if PG is not available
  const it = PG_AVAILABLE ? test : test.skip;

  it("should connect to PostgreSQL", async () => {
    if (!db) return;
    const result = await db.query("SELECT 1 as val");
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it("should create tables", async () => {
    if (!db) return;
    const result = await db.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    const tables = result.rows.map((r: any) => r.table_name).sort();
    expect(tables).toContain("asijs_test_users");
    expect(tables).toContain("asijs_test_posts");
    expect(tables).toContain("asijs_test_files");
  });

  it("should seed data", async () => {
    if (!db) return;
    const { userId, postId } = await seedTestData(db);

    expect(userId).toBeGreaterThan(0);
    expect(postId).toBeGreaterThan(0);

    // Verify user was inserted
    const userResult = await db.query(
      "SELECT * FROM asijs_test_users WHERE id = $1",
      [userId],
    );
    expect(userResult.rows.length).toBe(1);
    expect((userResult.rows[0] as any)?.name).toBe("Test User");
    expect((userResult.rows[0] as any)?.email).toBe("test@asijs.dev");

    // Verify post was inserted
    const postResult = await db.query(
      "SELECT * FROM asijs_test_posts WHERE id = $1",
      [postId],
    );
    expect(postResult.rows.length).toBe(1);
    expect((postResult.rows[0] as any)?.title).toBe("Test Post");
  });

  it("should register auto-api plugin with PostgreSQL and serve GET /api/:table", async () => {
    if (!db) return;

    const app = new Asi({ silent: true });

    app.plugin(autoAPI(
      async (query: string, params?: unknown[]) => {
        return db!.query(query, params);
      },
      {
        prefix: "/api",
        tables: ["asijs_test_users", "asijs_test_posts"],
        pagination: { defaultLimit: 50, maxLimit: 100 },
      },
    ));

    // Seed data and init
    await seedTestData(db!);

    // Make requests
    const listRes = await app.handle(
      new Request("http://localhost/api/asijs_test_users"),
    );
    expect(listRes.status).toBe(200);

    const listBody = await listRes.json();
    expect(listBody.data).toBeDefined();
    expect(Array.isArray(listBody.data)).toBe(true);
    expect(listBody.pagination).toBeDefined();
  });

  it("should get single record by ID via auto-api", async () => {
    if (!db) return;

    const app = new Asi({ silent: true });

    app.plugin(autoAPI(
      async (query: string, params?: unknown[]) => {
        return db!.query(query, params);
      },
      {
        prefix: "/api",
        tables: ["asijs_test_users", "asijs_test_posts"],
      },
    ));

    const { userId } = await seedTestData(db!);

    const res = await app.handle(
      new Request(`http://localhost/api/asijs_test_users/${userId}`),
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.name).toBe("Test User");
    expect(body.email).toBe("test@asijs.dev");
  });

  it("should POST (create) a new record via auto-api", async () => {
    if (!db) return;

    const app = new Asi({ silent: true });

    app.plugin(autoAPI(
      async (query: string, params?: unknown[]) => {
        return db!.query(query, params);
      },
      {
        prefix: "/api",
        tables: ["asijs_test_users", "asijs_test_posts"],
        allowCreate: true,
      },
    ));

    const createRes = await app.handle(
      new Request("http://localhost/api/asijs_test_users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "New User",
          email: "newuser@asijs.dev",
          role: "editor",
        }),
      }),
    );
    expect(createRes.status).toBe(201);

    const newUser = await createRes.json();
    expect(newUser.name).toBe("New User");
    expect(newUser.email).toBe("newuser@asijs.dev");
  });

  it("should PUT (update) a record via auto-api", async () => {
    if (!db) return;

    const app = new Asi({ silent: true });

    app.plugin(autoAPI(
      async (query: string, params?: unknown[]) => {
        return db!.query(query, params);
      },
      {
        prefix: "/api",
        tables: ["asijs_test_users", "asijs_test_posts"],
      },
    ));

    const { userId } = await seedTestData(db!);

    const updateRes = await app.handle(
      new Request(`http://localhost/api/asijs_test_users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Updated Name", email: "updated@asijs.dev" }),
      }),
    );
    expect(updateRes.status).toBe(200);

    const updated = await updateRes.json();
    expect(updated.name).toBe("Updated Name");
    expect(updated.email).toBe("updated@asijs.dev");
  });

  it("should filter records via query parameters", async () => {
    if (!db) return;

    const app = new Asi({ silent: true });

    app.plugin(autoAPI(
      async (query: string, params?: unknown[]) => {
        return db!.query(query, params);
      },
      {
        prefix: "/api",
        tables: ["asijs_test_users", "asijs_test_posts"],
      },
    ));

    // Seed multiple users with different roles
    await db!.query(
      `INSERT INTO asijs_test_users (name, email, role) VALUES ($1, $2, $3)`,
      ["Admin User", "admin@asijs.dev", "admin"],
    );
    await db!.query(
      `INSERT INTO asijs_test_users (name, email, role) VALUES ($1, $2, $3)`,
      ["Editor User", "editor@asijs.dev", "editor"],
    );

    const filteredRes = await app.handle(
      new Request("http://localhost/api/asijs_test_users?role=admin"),
    );
    expect(filteredRes.status).toBe(200);

    const body = await filteredRes.json();
    expect(body.data.length).toBeGreaterThan(0);
    for (const row of body.data) {
      expect((row as any).role).toBe("admin");
    }
  });

  it("should handle 404 for non-existent record", async () => {
    if (!db) return;

    const app = new Asi({ silent: true });

    app.plugin(autoAPI(
      async (query: string, params?: unknown[]) => {
        return db!.query(query, params);
      },
      {
        prefix: "/api",
        tables: ["asijs_test_users", "asijs_test_posts"],
      },
    ));

    const res = await app.handle(
      new Request("http://localhost/api/asijs_test_users/99999"),
    );
    expect(res.status).toBe(404);
  });

  it("should handle pagination parameters", async () => {
    if (!db) return;

    const app = new Asi({ silent: true });

    app.plugin(autoAPI(
      async (query: string, params?: unknown[]) => {
        return db!.query(query, params);
      },
      {
        prefix: "/api",
        tables: ["asijs_test_users", "asijs_test_posts"],
        pagination: { defaultLimit: 5, maxLimit: 50 },
      },
    ));

    const res = await app.handle(
      new Request("http://localhost/api/asijs_test_users?limit=5&offset=0"),
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.pagination).toBeDefined();
    expect(body.pagination.limit).toBe(5);
  });

  it("should delete a record via auto-api", async () => {
    if (!db) return;

    const app = new Asi({ silent: true });

    app.plugin(autoAPI(
      async (query: string, params?: unknown[]) => {
        return db!.query(query, params);
      },
      {
        prefix: "/api",
        tables: ["asijs_test_users", "asijs_test_posts"],
        allowDelete: true,
      },
    ));

    const { userId } = await seedTestData(db!);

    const delRes = await app.handle(
      new Request(`http://localhost/api/asijs_test_users/${userId}`, {
        method: "DELETE",
      }),
    );
    expect(delRes.status).toBe(200);

    const result = await delRes.json();
    expect(result.deleted).toBe(true);

    // Verify deleted
    const checkRes = await app.handle(
      new Request(`http://localhost/api/asijs_test_users/${userId}`),
    );
    expect(checkRes.status).toBe(404);
  });
});

// ============================================================================
// Unit-level tests for query parsing (no DB needed)
// ============================================================================

describe("parseQueryParams", () => {
  test("parses basic filters", () => {
    const params = parseQueryParams({ name: "John" }, {});
    expect(params.filters).toHaveLength(1);
    expect(params.filters[0].column).toBe("name");
    expect(params.filters[0].operator).toBe("=");
    expect(params.filters[0].value).toBe("John");
  });

  test("parses LIKE filter", () => {
    const params = parseQueryParams({ name: "like.%John%" }, {});
    expect(params.filters[0].operator).toBe("LIKE");
    expect(params.filters[0].value).toBe("%John%");
  });

  test("parses pagination", () => {
    const params = parseQueryParams(
      { limit: "10", offset: "20" },
      { pagination: { defaultLimit: 20, maxLimit: 100 } },
    );
    expect(params.limit).toBe(10);
    expect(params.offset).toBe(20);
  });

  test("respects max limit", () => {
    const params = parseQueryParams(
      { limit: "999" },
      { pagination: { defaultLimit: 20, maxLimit: 100 } },
    );
    expect(params.limit).toBe(100);
  });

  test("parses order parameter", () => {
    const params = parseQueryParams({ order: "name.desc" }, {});
    expect(params.order?.column).toBe("name");
    expect(params.order?.direction).toBe("desc");
  });
});

describe("buildSelectSQL", () => {
  test("builds basic SELECT", () => {
    const { text } = buildSelectSQL(
      "users",
      { filters: [], limit: 20, offset: 0 },
      { name: "users", columns: [], primaryKey: "id" },
    );
    expect(text).toContain("SELECT * FROM users");
    expect(text).toContain("LIMIT");
  });

  test("includes WHERE clause for filters", () => {
    const params = parseQueryParams({ name: "John" }, {});
    const { text, values } = buildSelectSQL(
      "users",
      params,
      { name: "users", columns: [], primaryKey: "id" },
    );
    expect(text).toContain("WHERE");
    expect(text).toContain("name = $1");
    expect(values).toContain("John");
  });

  test("includes ORDER BY", () => {
    const { text } = buildSelectSQL(
      "users",
      { filters: [], order: { column: "name", direction: "desc" }, limit: 20, offset: 0 },
      { name: "users", columns: [], primaryKey: "id" },
    );
    expect(text).toContain("ORDER BY name desc");
  });
});
