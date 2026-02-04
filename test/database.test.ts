import { describe, test, expect } from "bun:test";
import {
  ConnectionPool,
  sql,
  buildWhere,
  buildInsert,
  buildUpdate,
  createRepository,
} from "../src/database";

describe("Database Helpers", () => {
  describe("sql template tag", () => {
    test("creates parameterized query", () => {
      const userId = 123;
      const query = sql`SELECT * FROM users WHERE id = ${userId}`;

      expect(query.text).toBe("SELECT * FROM users WHERE id = $1");
      expect(query.values).toEqual([123]);
    });

    test("handles multiple parameters", () => {
      const name = "John";
      const age = 30;
      const city = "NYC";
      const query = sql`SELECT * FROM users WHERE name = ${name} AND age = ${age} AND city = ${city}`;

      expect(query.text).toBe(
        "SELECT * FROM users WHERE name = $1 AND age = $2 AND city = $3",
      );
      expect(query.values).toEqual(["John", 30, "NYC"]);
    });

    test("handles no parameters", () => {
      const query = sql`SELECT * FROM users`;

      expect(query.text).toBe("SELECT * FROM users");
      expect(query.values).toEqual([]);
    });
  });

  describe("buildWhere", () => {
    test("builds simple WHERE clause", () => {
      const result = buildWhere({ name: "John", age: 30 });

      expect(result.text).toBe("WHERE name = $1 AND age = $2");
      expect(result.values).toEqual(["John", 30]);
    });

    test("handles null values", () => {
      const result = buildWhere({ deleted_at: null });

      expect(result.text).toBe("WHERE deleted_at IS NULL");
      expect(result.values).toEqual([]);
    });

    test("handles array values (IN clause)", () => {
      const result = buildWhere({ status: ["active", "pending"] });

      expect(result.text).toBe("WHERE status IN ($1, $2)");
      expect(result.values).toEqual(["active", "pending"]);
    });

    test("skips undefined values", () => {
      const result = buildWhere({ name: "John", age: undefined });

      expect(result.text).toBe("WHERE name = $1");
      expect(result.values).toEqual(["John"]);
    });

    test("returns empty string for empty conditions", () => {
      const result = buildWhere({});

      expect(result.text).toBe("");
      expect(result.values).toEqual([]);
    });

    test("supports OR operator", () => {
      const result = buildWhere({ name: "John", city: "NYC" }, "OR");

      expect(result.text).toBe("WHERE name = $1 OR city = $2");
      expect(result.values).toEqual(["John", "NYC"]);
    });
  });

  describe("buildInsert", () => {
    test("builds INSERT statement", () => {
      const result = buildInsert("users", {
        name: "John",
        email: "john@example.com",
        age: 30,
      });

      expect(result.text).toBe(
        "INSERT INTO users (name, email, age) VALUES ($1, $2, $3)",
      );
      expect(result.values).toEqual(["John", "john@example.com", 30]);
    });

    test("handles single column", () => {
      const result = buildInsert("logs", { message: "test" });

      expect(result.text).toBe("INSERT INTO logs (message) VALUES ($1)");
      expect(result.values).toEqual(["test"]);
    });
  });

  describe("buildUpdate", () => {
    test("builds UPDATE statement", () => {
      const result = buildUpdate("users", { name: "Jane", age: 31 });

      expect(result.text).toBe("UPDATE users SET name = $1, age = $2");
      expect(result.values).toEqual(["Jane", 31]);
    });

    test("builds UPDATE with WHERE clause", () => {
      const result = buildUpdate("users", { name: "Jane" }, { id: 123 });

      expect(result.text).toBe("UPDATE users SET name = $1 WHERE id = $2");
      expect(result.values).toEqual(["Jane", 123]);
    });

    test("handles complex WHERE conditions", () => {
      const result = buildUpdate(
        "orders",
        { status: "shipped" },
        { user_id: 1, status: ["pending", "processing"] },
      );

      expect(result.text).toBe(
        "UPDATE orders SET status = $1 WHERE user_id = $2 AND status IN ($3, $4)",
      );
      expect(result.values).toEqual(["shipped", 1, "pending", "processing"]);
    });
  });

  describe("ConnectionPool", () => {
    test("acquires and releases connections", async () => {
      let connectionCount = 0;
      const factory = () => {
        connectionCount++;
        return Promise.resolve({ id: connectionCount });
      };

      const pool = new ConnectionPool(factory, { maxSize: 5, minSize: 1 });
      await pool.initialize();

      expect(pool.stats().total).toBe(1);

      const conn1 = await pool.acquire();
      expect(pool.stats().inUse).toBe(1);
      expect(pool.stats().available).toBe(0);

      pool.release(conn1);
      expect(pool.stats().inUse).toBe(0);
      expect(pool.stats().available).toBe(1);
    });

    test("creates new connections when needed", async () => {
      let connectionCount = 0;
      const factory = () => {
        connectionCount++;
        return Promise.resolve({ id: connectionCount });
      };

      const pool = new ConnectionPool(factory, { maxSize: 5, minSize: 1 });
      await pool.initialize();

      const conn1 = await pool.acquire();
      const conn2 = await pool.acquire();

      expect(pool.stats().total).toBe(2);
      expect(pool.stats().inUse).toBe(2);

      pool.release(conn1);
      pool.release(conn2);
    });

    test("withConnection helper", async () => {
      const factory = () => Promise.resolve({ execute: async () => "result" });
      const pool = new ConnectionPool(factory, { maxSize: 5, minSize: 1 });
      await pool.initialize();

      const result = await pool.withConnection(async (conn) => {
        return (conn as { execute: () => Promise<string> }).execute();
      });

      expect(result).toBe("result");
      expect(pool.stats().inUse).toBe(0);
    });

    test("close terminates all connections", async () => {
      let closedCount = 0;
      const factory = () =>
        Promise.resolve({
          close: async () => {
            closedCount++;
          },
        });

      const pool = new ConnectionPool(factory, { maxSize: 5, minSize: 2 });
      await pool.initialize();

      await pool.close();

      expect(closedCount).toBe(2);
      expect(pool.stats().total).toBe(0);
    });
  });

  describe("createRepository", () => {
    test("provides CRUD operations", async () => {
      // Mock database execute function
      const mockData: Record<number, Record<string, unknown>> = {
        1: { id: 1, name: "John" },
        2: { id: 2, name: "Jane" },
      };

      const execute = async (query: string, params?: unknown[]) => {
        // Check COUNT first (before SELECT since COUNT uses SELECT)
        if (query.includes("COUNT")) {
          return { rows: [{ count: Object.keys(mockData).length.toString() }] };
        }
        if (query.includes("SELECT") && query.includes("WHERE")) {
          const id = params?.[0] as number;
          return { rows: mockData[id] ? [mockData[id]] : [] };
        }
        if (query.includes("SELECT")) {
          return { rows: Object.values(mockData) };
        }
        if (query.includes("INSERT")) {
          const newId = Object.keys(mockData).length + 1;
          const newRecord = {
            id: newId,
            ...(params as unknown[]).reduce(
              (acc, _, i) => ({ ...acc, [`col${i}`]: params?.[i] }),
              {},
            ),
          };
          return { rows: [newRecord] };
        }
        return { rows: [], rowCount: 1 };
      };

      const repo = createRepository<{ id: number; name: string }>(
        execute,
        "users",
      );

      // Test findById
      const user = await repo.findById(1);
      expect(user?.name).toBe("John");

      // Test findAll
      const users = await repo.findAll();
      expect(users.length).toBe(2);

      // Test count
      const count = await repo.count();
      expect(count).toBe(2);
    });
  });
});
