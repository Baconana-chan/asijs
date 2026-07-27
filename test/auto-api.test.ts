import { describe, expect, it } from "bun:test";
import {
  parseQueryParams,
  buildSelectSQL,
  autoAPI,
  Asi,
} from "../src";
import type { AutoAPIOptions, TableSchema } from "../src";

// ============================================================================
// parseQueryParams
// ============================================================================

describe("parseQueryParams", () => {
  const defaultOptions: AutoAPIOptions = {
    pagination: { defaultLimit: 20, maxLimit: 100 },
  };

  it("parses limit and offset", () => {
    const result = parseQueryParams(
      { limit: "10", offset: "5" },
      defaultOptions,
    );
    expect(result.limit).toBe(10);
    expect(result.offset).toBe(5);
    expect(result.filters).toHaveLength(0);
  });

  it("caps limit at maxLimit", () => {
    const result = parseQueryParams(
      { limit: "9999" },
      defaultOptions,
    );
    expect(result.limit).toBe(100);
  });

  it("uses default limit when not specified", () => {
    const result = parseQueryParams({}, defaultOptions);
    expect(result.limit).toBe(20);
  });

  it("parses order parameter", () => {
    const result = parseQueryParams(
      { order: "name.desc" },
      defaultOptions,
    );
    expect(result.order).toBeDefined();
    expect(result.order!.column).toBe("name");
    expect(result.order!.direction).toBe("desc");
  });

  it("defaults order direction to asc", () => {
    const result = parseQueryParams(
      { order: "created_at" },
      defaultOptions,
    );
    expect(result.order).toBeDefined();
    expect(result.order!.column).toBe("created_at");
    expect(result.order!.direction).toBe("asc");
  });

  it("parses exact match filter", () => {
    const result = parseQueryParams(
      { name: "John" },
      defaultOptions,
    );
    expect(result.filters).toHaveLength(1);
    expect(result.filters[0]).toEqual({
      column: "name",
      operator: "=",
      value: "John",
    });
  });

  it("parses filter operators", () => {
    const testCases = [
      { input: "gt.10", op: ">", val: "10" },
      { input: "gte.100", op: ">=", val: "100" },
      { input: "lt.5", op: "<", val: "5" },
      { input: "lte.50", op: "<=", val: "50" },
      { input: "neq.Admin", op: "<>", val: "Admin" },
    ];

    for (const { input, op, val } of testCases) {
      const result = parseQueryParams(
        { age: input },
        defaultOptions,
      );
      expect(result.filters[0]).toEqual({
        column: "age",
        operator: op,
        value: val,
      });
    }
  });

  it("parses LIKE filter", () => {
    const result = parseQueryParams(
      { name: "like.*john*" },
      defaultOptions,
    );
    expect(result.filters[0]).toEqual({
      column: "name",
      operator: "LIKE",
      value: "*john*",
    });
  });

  it("parses ILIKE filter", () => {
    const result = parseQueryParams(
      { name: "ilike.*test*" },
      defaultOptions,
    );
    expect(result.filters[0]).toEqual({
      column: "name",
      operator: "ILIKE",
      value: "*test*",
    });
  });

  it("parses is.null filter", () => {
    const result = parseQueryParams(
      { deleted_at: "is.null" },
      defaultOptions,
    );
    expect(result.filters[0]).toEqual({
      column: "deleted_at",
      operator: "IS NULL",
      value: "",
    });
  });

  it("parses isnot.null filter", () => {
    const result = parseQueryParams(
      { deleted_at: "isnot.null" },
      defaultOptions,
    );
    expect(result.filters[0]).toEqual({
      column: "deleted_at",
      operator: "IS NOT NULL",
      value: "",
    });
  });

  it("skips select/columns params", () => {
    const result = parseQueryParams(
      { select: "id,name", columns: "id" },
      defaultOptions,
    );
    expect(result.filters).toHaveLength(0);
  });

  it("handles empty query", () => {
    const result = parseQueryParams({}, defaultOptions);
    expect(result.filters).toHaveLength(0);
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
  });
});

// ============================================================================
// buildSelectSQL
// ============================================================================

describe("buildSelectSQL", () => {
  const tableSchema: TableSchema = {
    name: "users",
    columns: [
      { name: "id", type: "integer", nullable: false, isPrimaryKey: true, isForeignKey: false },
      { name: "name", type: "text", nullable: true, isPrimaryKey: false, isForeignKey: false },
      { name: "email", type: "text", nullable: true, isPrimaryKey: false, isForeignKey: false },
      { name: "age", type: "integer", nullable: true, isPrimaryKey: false, isForeignKey: false },
    ],
    primaryKey: "id",
  };

  it("generates basic SELECT with LIMIT", () => {
    const result = buildSelectSQL(
      "users",
      { filters: [], limit: 20, offset: 0 },
      tableSchema,
    );

    expect(result.text).toContain("SELECT * FROM users");
    expect(result.text).toContain("LIMIT $1");
    expect(result.text).not.toContain("WHERE");
    expect(result.text).not.toContain("OFFSET");
    expect(result.values).toEqual([20]);
  });

  it("adds WHERE clause for filters", () => {
    const result = buildSelectSQL(
      "users",
      {
        filters: [{ column: "name", operator: "=", value: "Alice" }],
        limit: 20,
        offset: 0,
      },
      tableSchema,
    );

    expect(result.text).toContain("WHERE name = $1");
    expect(result.values).toEqual(["Alice", 20]);
  });

  it("adds ORDER BY when specified", () => {
    const result = buildSelectSQL(
      "users",
      {
        filters: [],
        order: { column: "name", direction: "desc" },
        limit: 20,
        offset: 0,
      },
      tableSchema,
    );

    expect(result.text).toContain("ORDER BY name desc");
  });

  it("adds OFFSET when offset > 0", () => {
    const result = buildSelectSQL(
      "users",
      {
        filters: [],
        limit: 20,
        offset: 50,
      },
      tableSchema,
    );

    expect(result.text).toContain("OFFSET $2");
    expect(result.values).toEqual([20, 50]);
  });

  it("handles IS NULL filter without parameter", () => {
    const result = buildSelectSQL(
      "users",
      {
        filters: [{ column: "deleted_at", operator: "IS NULL", value: "" }],
        limit: 20,
        offset: 0,
      },
      tableSchema,
    );

    expect(result.text).toContain("deleted_at IS NULL");
    expect(result.text).not.toContain("deleted_at IS NULL $"); // no param
  });

  it("combines multiple WHERE conditions with AND", () => {
    const result = buildSelectSQL(
      "users",
      {
        filters: [
          { column: "age", operator: ">", value: "18" },
          { column: "status", operator: "=", value: "active" },
        ],
        limit: 20,
        offset: 0,
      },
      tableSchema,
    );

    expect(result.text).toContain("age > $1");
    expect(result.text).toContain("status = $2");
    expect(result.text).toContain("WHERE age > $1 AND status = $2");
    expect(result.values).toEqual(["18", "active", 20]);
  });
});

// ============================================================================
// Plugin Integration (with mock DB)
// ============================================================================

describe("autoAPI plugin", () => {
  it("registers plugin with name 'auto-api'", () => {
    const mockDb = async (query: string, params?: unknown[]) => {
      return { rows: [{ id: 1, name: "Test" }], rowCount: 1 };
    };

    const app = new Asi();

    app.plugin(
      autoAPI(mockDb, {
        prefix: "/api",
        tables: ["users", "posts"],
        allowCreate: false,
        allowUpdate: false,
        allowDelete: false,
      }),
    );

    const plugins = app.getPlugins();
    expect(plugins).toContain("auto-api");
  });

  it("registers plugin even without database connection", async () => {
    const hooks: string[] = [];
    const mockDb = async (query: string, params?: unknown[]) => {
      // Mock information_schema response for introspectSchema
      return { rows: [{ id: 1 }], rowCount: 1 };
    };

    const app = new Asi();

    app.plugin(
      autoAPI(mockDb, {
        prefix: "/api",
        tables: ["users"],
        allowCreate: false,
        allowUpdate: false,
        allowDelete: false,
      }),
    );

    // introspectSchema will fail (no real DB), so no routes registered
    // But plugin registration should work
    expect(app.getPlugins()).toContain("auto-api");
  });
});
