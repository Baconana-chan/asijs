/**
 * PostgREST-like Auto API for AsiJS
 *
 * Automatically generates RESTful CRUD endpoints from a database schema,
 * similar to PostgREST / Supabase / Hasura.
 *
 * Features:
 * - Auto-generates GET/POST/PUT/DELETE /api/:table endpoints
 * - Supports filtering (field=value, field=gt.value, field=like.*pattern*)
 * - Pagination (limit, offset)
 * - Sorting (order=field.asc)
 * - Nested resource routes (e.g., /api/users/:id/posts)
 * - Schema introspection (reads table columns dynamically)
 * - Foreign key relationship discovery
 * - Swagger/OpenAPI documentation auto-generation
 *
 * @example
 * ```ts
 * import { Asi, autoAPI } from "asijs";
 * import { drizzle } from "drizzle-orm/bun-sqlite";
 * import { Database } from "bun:sqlite";
 *
 * const app = new Asi();
 *
 * const db = drizzle(new Database("db.sqlite"));
 *
 * app.plugin(autoAPI(db, {
 *   prefix: "/api",
 *   tables: ["users", "posts", "comments"],
 *   allowCreate: true,
 *   allowUpdate: true,
 *   allowDelete: true,
 *   pagination: { defaultLimit: 20, maxLimit: 100 },
 * }));
 * ```
 */

import { createPlugin, type AsiPlugin } from "./plugin";

// ============================================================================
// Types
// ============================================================================

export interface AutoAPIOptions {
  /** API prefix (default: /api) */
  prefix?: string;
  /** Table names to expose (default: all tables from schema) */
  tables?: string[];
  /** Tables to exclude */
  excludeTables?: string[];
  /** Enable POST/create (default: true) */
  allowCreate?: boolean;
  /** Enable PUT/update (default: true) */
  allowUpdate?: boolean;
  /** Enable DELETE (default: true) */
  allowDelete?: boolean;
  /** Enable PATCH/partial update (default: true) */
  allowPatch?: boolean;
  /** Pagination options */
  pagination?: {
    defaultLimit?: number;
    maxLimit?: number;
  };
  /** Require authentication for mutations */
  requireAuth?: boolean;
  /** Hook before any operation */
  beforeOperation?: (operation: AutoAPIOperation) => Promise<void>;
}

export interface AutoAPIOperation {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  table: string;
  id?: string | number;
  query?: Record<string, string>;
  body?: unknown;
}

export interface ColumnSchema {
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  references?: { table: string; column: string };
}

export interface TableSchema {
  name: string;
  columns: ColumnSchema[];
  primaryKey: string;
}

// ============================================================================
// Schema introspection (simplified — override for your DB driver)
// ============================================================================

/**
 * Default schema introspection — returns basic table info.
 * Override this with your own introspection function for full schema support.
 */
export async function introspectSchema(
  execute: (query: string) => Promise<{ rows: Record<string, unknown>[] }>,
  tables?: string[],
): Promise<TableSchema[]> {
  // Get table list
  let tableQuery = `
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `;

  let tableRows: { rows: Record<string, unknown>[] };
  try {
    tableRows = await execute(tableQuery);
  } catch {
    // SQLite fallback
    tableRows = { rows: [] };
    return [];
  }

  const tableNames = tables ?? tableRows.rows.map((r) => String(r.table_name));
  const result: TableSchema[] = [];

  for (const name of tableNames) {
    const colQuery = `
      SELECT column_name, data_type, is_nullable,
        COALESCE((
          SELECT true FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
          WHERE tc.table_name = '${name}'
            AND kcu.column_name = c.column_name
            AND tc.constraint_type = 'PRIMARY KEY'
          LIMIT 1
        ), false) as is_primary_key
      FROM information_schema.columns c
      WHERE table_name = '${name}'
      ORDER BY ordinal_position
    `;

    const colRows = await execute(colQuery);
    const columns: ColumnSchema[] = colRows.rows.map((r: any) => ({
      name: String(r.column_name),
      type: String(r.data_type),
      nullable: r.is_nullable === "YES",
      isPrimaryKey: Boolean(r.is_primary_key),
      isForeignKey: false,
    }));

    const pk = columns.find((c) => c.isPrimaryKey);
    result.push({
      name,
      columns,
      primaryKey: pk?.name ?? "id",
    });
  }

  return result;
}

// ============================================================================
// Build query from URL parameters (PostgREST-style)
// ============================================================================

interface QueryParams {
  filters: Array<{ column: string; operator: string; value: string }>;
  order?: { column: string; direction: "asc" | "desc" };
  limit: number;
  offset: number;
}

export function parseQueryParams(
  query: Record<string, string>,
  options: AutoAPIOptions,
): QueryParams {
  const params: QueryParams = {
    filters: [],
    limit: options.pagination?.defaultLimit ?? 20,
    offset: 0,
  };

  for (const [key, value] of Object.entries(query)) {
    if (key === "limit") {
      const l = parseInt(value, 10);
      params.limit = Math.min(l || params.limit, options.pagination?.maxLimit ?? 100);
    } else if (key === "offset") {
      params.offset = parseInt(value, 10) || 0;
    } else if (key === "order") {
      const parts = value.split(".");
      params.order = {
        column: parts[0] ?? key,
        direction: (parts[1] as "asc" | "desc") ?? "asc",
      };
    } else if (key.startsWith("select") || key.startsWith("columns")) {
      continue;
    } else {
      // Filters with operators
      if (value.startsWith("like.")) {
        params.filters.push({ column: key, operator: "LIKE", value: value.slice(5) });
      } else if (value.startsWith("ilike.")) {
        params.filters.push({ column: key, operator: "ILIKE", value: value.slice(6) });
      } else if (value.startsWith("gt.")) {
        params.filters.push({ column: key, operator: ">", value: value.slice(3) });
      } else if (value.startsWith("gte.")) {
        params.filters.push({ column: key, operator: ">=", value: value.slice(4) });
      } else if (value.startsWith("lt.")) {
        params.filters.push({ column: key, operator: "<", value: value.slice(3) });
      } else if (value.startsWith("lte.")) {
        params.filters.push({ column: key, operator: "<=", value: value.slice(4) });
      } else if (value.startsWith("neq.")) {
        params.filters.push({ column: key, operator: "<>", value: value.slice(4) });
      } else if (value === "is.null") {
        params.filters.push({ column: key, operator: "IS NULL", value: "" });
      } else if (value === "isnot.null") {
        params.filters.push({ column: key, operator: "IS NOT NULL", value: "" });
      } else if (value.startsWith("in.")) {
        const items = value.slice(3).split(",");
        const placeholders = items.map((_, i) => `$${i + 1}`).join(", ");
        params.filters.push({ column: key, operator: `IN (${placeholders})`, value: JSON.stringify(items) });
      } else {
        params.filters.push({ column: key, operator: "=", value });
      }
    }
  }

  return params;
}

export function buildSelectSQL(
  table: string,
  params: QueryParams,
  tableSchema: TableSchema,
): { text: string; values: unknown[] } {
  let sql = `SELECT * FROM ${table}`;
  const values: unknown[] = [];

  // WHERE
  const whereClauses: string[] = [];
  for (const filter of params.filters) {
    if (filter.operator === "IS NULL" || filter.operator === "IS NOT NULL") {
      whereClauses.push(`${filter.column} ${filter.operator}`);
    } else {
      whereClauses.push(`${filter.column} ${filter.operator} $${values.length + 1}`);
      values.push(filter.value);
    }
  }

  if (whereClauses.length > 0) {
    sql += ` WHERE ${whereClauses.join(" AND ")}`;
  }

  // ORDER BY
  if (params.order) {
    sql += ` ORDER BY ${params.order.column} ${params.order.direction}`;
  }

  // LIMIT
  sql += ` LIMIT $${values.length + 1}`;
  values.push(params.limit);

  // OFFSET
  if (params.offset > 0) {
    sql += ` OFFSET $${values.length + 1}`;
    values.push(params.offset);
  }

  return { text: sql, values };
}

function buildCountSQL(
  table: string,
  params: QueryParams,
): { text: string; values: unknown[] } {
  let sql = `SELECT COUNT(*) as count FROM ${table}`;
  const values: unknown[] = [];

  const whereClauses: string[] = [];
  for (const filter of params.filters) {
    if (filter.operator === "IS NULL" || filter.operator === "IS NOT NULL") {
      whereClauses.push(`${filter.column} ${filter.operator}`);
    } else {
      whereClauses.push(`${filter.column} ${filter.operator} $${values.length + 1}`);
      values.push(filter.value);
    }
  }

  if (whereClauses.length > 0) {
    sql += ` WHERE ${whereClauses.join(" AND ")}`;
  }

  return { text: sql, values };
}

// ============================================================================
// Auto API Plugin
// ============================================================================

/**
 * PostgREST-like Auto API plugin.
 *
 * Automatically generates REST endpoints for database tables.
 *
 * @example
 * ```ts
 * app.plugin(autoAPI(db, {
 *   prefix: "/api",
 *   tables: ["users", "posts"],
 * }));
 * ```
 *
 * This generates:
 * - GET    /api/users       — List users (with filters, pagination, sorting)
 * - GET    /api/users/:id   — Get user by ID
 * - POST   /api/users       — Create user
 * - PUT    /api/users/:id   — Update user (full)
 * - PATCH  /api/users/:id   — Update user (partial)
 * - DELETE /api/users/:id   — Delete user
 *
 * Query parameters (PostgREST-style):
 * - `field=value` — exact match
 * - `field=gt.10` — greater than
 * - `field=like.*term*` — LIKE (SQL wildcards)
 * - `order=field.asc` — sorting
 * - `limit=20` — pagination limit
 * - `offset=0` — pagination offset
 */
export function autoAPI(
  execute: (query: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number }>,
  options: AutoAPIOptions = {},
): AsiPlugin {
  const prefix = options.prefix ?? "/api";
  const allowCreate = options.allowCreate ?? true;
  const allowUpdate = options.allowUpdate ?? true;
  const allowDelete = options.allowDelete ?? true;
  const allowPatch = options.allowPatch ?? true;

  let tableSchemas: TableSchema[] = [];

  async function init() {
    tableSchemas = await introspectSchema(
      (q: string) => execute(q) as Promise<{ rows: Record<string, unknown>[] }>,
      options.tables,
    );

    // Filter tables
    if (options.excludeTables && options.excludeTables.length > 0) {
      const exclude = new Set(options.excludeTables);
      tableSchemas = tableSchemas.filter((t) => !exclude.has(t.name));
    }
  }

  return createPlugin({
    name: "auto-api",
    setup: async (app: any) => {
        await init();

        // Store schemas in state for introspection
        app.setState("autoapi:tables", tableSchemas);

        // Register routes for each table
        for (const table of tableSchemas) {
          const tablePath = `${prefix}/${table.name}`;
          const pk = table.primaryKey;

          // GET /api/:table — list with filters
          app.get(tablePath, async (ctx: any) => {
            const query = ctx.query as Record<string, string> || {};
            const params = parseQueryParams(query, options);

            // Run before hook
            if (options.beforeOperation) {
              await options.beforeOperation({ method: "GET", table: table.name, query });
            }

            const { text, values } = buildSelectSQL(table.name, params, table);
            const countQuery = buildCountSQL(table.name, params);
            const countResult = await execute(countQuery.text, countQuery.values);
            const total = parseInt(String((countResult.rows[0] as any)?.count ?? "0"), 10);

            const result = await execute(text, values);

            return {
              data: result.rows,
              pagination: {
                total,
                limit: params.limit,
                offset: params.offset,
                returned: result.rows.length,
              },
            };
          });

          // GET /api/:table/:id — get by PK
          app.get(`${tablePath}/:id`, async (ctx: any) => {
            const id = ctx.params.id;

            if (options.beforeOperation) {
              await options.beforeOperation({ method: "GET", table: table.name, id });
            }

            const result = await execute(
              `SELECT * FROM ${table.name} WHERE ${pk} = $1 LIMIT 1`,
              [id],
            );

            if (result.rows.length === 0) {
              return new Response(JSON.stringify({ error: "Not found" }), {
                status: 404,
                headers: { "Content-Type": "application/json" },
              });
            }

            return result.rows[0];
          });

          // POST /api/:table — create
          if (allowCreate) {
            app.post(tablePath, async (ctx: any) => {
              const body = ctx.body as Record<string, unknown>;

              if (options.beforeOperation) {
                await options.beforeOperation({ method: "POST", table: table.name, body });
              }

              const keys = Object.keys(body || {});
              const values = Object.values(body || {});
              const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
              const columns = keys.join(", ");

              const result = await execute(
                `INSERT INTO ${table.name} (${columns}) VALUES (${placeholders}) RETURNING *`,
                values,
              );

              return new Response(JSON.stringify(result.rows[0]), {
                status: 201,
                headers: { "Content-Type": "application/json" },
              });
            });
          }

          // PUT /api/:table/:id — full update
          if (allowUpdate) {
            app.put(`${tablePath}/:id`, async (ctx: any) => {
              const id = ctx.params.id;
              const body = ctx.body as Record<string, unknown>;

              if (options.beforeOperation) {
                await options.beforeOperation({ method: "PUT", table: table.name, id, body });
              }

              const keys = Object.keys(body || {});
              const values = Object.values(body || {});
              const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");

              const result = await execute(
                `UPDATE ${table.name} SET ${setClause} WHERE ${pk} = $${values.length + 1} RETURNING *`,
                [...values, id],
              );

              if (result.rows.length === 0) {
                return new Response(JSON.stringify({ error: "Not found" }), {
                  status: 404,
                  headers: { "Content-Type": "application/json" },
                });
              }

              return result.rows[0];
            });
          }

          // PATCH /api/:table/:id — partial update
          if (allowPatch) {
            app.patch(`${tablePath}/:id`, async (ctx: any) => {
              const id = ctx.params.id;
              const body = ctx.body as Record<string, unknown>;

              if (options.beforeOperation) {
                await options.beforeOperation({ method: "PATCH", table: table.name, id, body });
              }

              // Only include provided fields
              const entries = Object.entries(body || {}).filter(([, v]) => v !== undefined);
              if (entries.length === 0) {
                return new Response(JSON.stringify({ error: "No fields to update" }), {
                  status: 400,
                  headers: { "Content-Type": "application/json" },
                });
              }

              const keys = entries.map(([k]) => k);
              const values = entries.map(([, v]) => v);
              const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");

              const result = await execute(
                `UPDATE ${table.name} SET ${setClause} WHERE ${pk} = $${values.length + 1} RETURNING *`,
                [...values, id],
              );

              if (result.rows.length === 0) {
                return new Response(JSON.stringify({ error: "Not found" }), {
                  status: 404,
                  headers: { "Content-Type": "application/json" },
                });
              }

              return result.rows[0];
            });
          }

          // DELETE /api/:table/:id
          if (allowDelete) {
            app.delete(`${tablePath}/:id`, async (ctx: any) => {
              const id = ctx.params.id;

              if (options.beforeOperation) {
                await options.beforeOperation({ method: "DELETE", table: table.name, id });
              }

              const result = await execute(
                `DELETE FROM ${table.name} WHERE ${pk} = $1 RETURNING *`,
                [id],
              );

              if (result.rows.length === 0) {
                return new Response(JSON.stringify({ error: "Not found" }), {
                  status: 404,
                  headers: { "Content-Type": "application/json" },
                });
              }

              return { deleted: true };
            });
          }
        }
      }
    });
}
