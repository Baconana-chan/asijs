/**
 * Database Integration Helpers for AsiJS
 *
 * First-class support for:
 * - Drizzle ORM
 * - Prisma
 * - Kysely
 *
 * Features:
 * - Type-safe decorators
 * - Connection management
 * - Transaction helpers
 * - Query logging
 */

import type { Context } from "./context";
import type { AsiPlugin, PluginHost } from "./plugin";

// ============================================================================
// Types
// ============================================================================

/**
 * Generic database client interface
 */
export interface DatabaseClient {
  /** Execute a query */
  execute?: (query: string, params?: unknown[]) => Promise<unknown>;
  /** Close connection */
  close?: () => Promise<void>;
  /** Check connection health */
  ping?: () => Promise<boolean>;
}

/**
 * Database configuration
 */
export interface DatabaseConfig {
  /** Database URL */
  url?: string;
  /** Database type */
  type?: "postgres" | "mysql" | "sqlite" | "mssql";
  /** Connection pool size */
  poolSize?: number;
  /** Query logging */
  logging?: boolean | ((query: string, params?: unknown[]) => void);
  /** Slow query threshold in ms */
  slowQueryThreshold?: number;
}

/**
 * Transaction options
 */
export interface TransactionOptions {
  /** Isolation level */
  isolationLevel?:
    | "read-uncommitted"
    | "read-committed"
    | "repeatable-read"
    | "serializable";
  /** Timeout in ms */
  timeout?: number;
}

// ============================================================================
// Drizzle Integration
// ============================================================================

/**
 * Drizzle ORM configuration
 */
export interface DrizzleConfig extends DatabaseConfig {
  /** Drizzle client instance */
  client: unknown;
  /** Schema for type inference */
  schema?: unknown;
}

// Simple plugin type for database plugins
type SimplePlugin = {
  name: string;
  setup: (app: PluginHost) => void;
};

/**
 * Create Drizzle plugin
 *
 * @example
 * ```ts
 * import { drizzle } from 'drizzle-orm/bun-sqlite';
 * import { Database } from 'bun:sqlite';
 * import { drizzlePlugin } from 'asijs/database';
 *
 * const sqlite = new Database('db.sqlite');
 * const db = drizzle(sqlite);
 *
 * app.use(drizzlePlugin({
 *   client: db,
 *   logging: true
 * }));
 *
 * app.get('/users', async (ctx) => {
 *   return ctx.db.select().from(users).all();
 * });
 * ```
 */
export function drizzlePlugin(config: DrizzleConfig): SimplePlugin {
  const { client, logging = false, slowQueryThreshold = 100 } = config;

  // Wrap client with logging if enabled
  const wrappedClient = logging
    ? wrapWithLogging(client, logging, slowQueryThreshold)
    : client;

  return {
    name: "drizzle",
    setup(app: PluginHost) {
      // Store db in state
      app.setState("db", wrappedClient);

      // Add schema if provided
      if (config.schema) {
        app.setState("schema", config.schema);
      }
    },
  };
}

/**
 * Drizzle transaction helper
 *
 * @example
 * ```ts
 * import { withTransaction } from 'asijs/database';
 *
 * app.post('/transfer', async (ctx) => {
 *   return withTransaction(ctx.db, async (tx) => {
 *     await tx.update(accounts).set({ balance: sql`balance - 100` }).where(eq(accounts.id, fromId));
 *     await tx.update(accounts).set({ balance: sql`balance + 100` }).where(eq(accounts.id, toId));
 *     return { success: true };
 *   });
 * });
 * ```
 */
export async function withTransaction<
  T,
  DB extends { transaction: (fn: (tx: unknown) => Promise<T>) => Promise<T> },
>(
  db: DB,
  fn: (tx: unknown) => Promise<T>,
  _options?: TransactionOptions,
): Promise<T> {
  return db.transaction(fn);
}

// ============================================================================
// Prisma Integration
// ============================================================================

/**
 * Prisma client configuration
 */
export interface PrismaConfig extends DatabaseConfig {
  /** Prisma client instance */
  client: unknown;
  /** Enable query logging */
  logQueries?: boolean;
}

/**
 * Create Prisma plugin
 *
 * @example
 * ```ts
 * import { PrismaClient } from '@prisma/client';
 * import { prismaPlugin } from 'asijs/database';
 *
 * const prisma = new PrismaClient();
 *
 * app.use(prismaPlugin({
 *   client: prisma,
 *   logQueries: true
 * }));
 *
 * app.get('/users', async (ctx) => {
 *   return ctx.prisma.user.findMany();
 * });
 * ```
 */
export function prismaPlugin(config: PrismaConfig): SimplePlugin {
  const { client, logQueries = false, slowQueryThreshold = 100 } = config;

  // Setup query logging if enabled
  if (
    logQueries &&
    typeof (
      client as { $on?: (event: string, handler: (e: unknown) => void) => void }
    ).$on === "function"
  ) {
    (
      client as {
        $on: (
          event: string,
          handler: (e: { query: string; duration: number }) => void,
        ) => void;
      }
    ).$on("query", (e) => {
      const duration = e.duration;
      if (duration > slowQueryThreshold) {
        console.warn(`[SLOW QUERY] ${duration}ms: ${e.query}`);
      } else if (logQueries === true) {
        console.log(`[QUERY] ${duration}ms: ${e.query}`);
      }
    });
  }

  return {
    name: "prisma",
    setup(app: PluginHost) {
      // Store prisma in state
      app.setState("prisma", client);
    },
  };
}

/**
 * Prisma transaction helper
 *
 * @example
 * ```ts
 * import { prismaTransaction } from 'asijs/database';
 *
 * app.post('/transfer', async (ctx) => {
 *   return prismaTransaction(ctx.prisma, async (tx) => {
 *     await tx.account.update({ where: { id: fromId }, data: { balance: { decrement: 100 } } });
 *     await tx.account.update({ where: { id: toId }, data: { balance: { increment: 100 } } });
 *     return { success: true };
 *   });
 * });
 * ```
 */
export async function prismaTransaction<
  T,
  P extends { $transaction: (fn: (tx: unknown) => Promise<T>) => Promise<T> },
>(
  prisma: P,
  fn: (tx: unknown) => Promise<T>,
  options?: { maxWait?: number; timeout?: number },
): Promise<T> {
  if (options) {
    return (
      prisma as {
        $transaction: (
          fn: (tx: unknown) => Promise<T>,
          opts: typeof options,
        ) => Promise<T>;
      }
    ).$transaction(fn, options);
  }
  return prisma.$transaction(fn);
}

// ============================================================================
// Kysely Integration
// ============================================================================

/**
 * Kysely configuration
 */
export interface KyselyConfig extends DatabaseConfig {
  /** Kysely instance */
  client: unknown;
}

/**
 * Create Kysely plugin
 *
 * @example
 * ```ts
 * import { Kysely, SqliteDialect } from 'kysely';
 * import { Database } from 'bun:sqlite';
 * import { kyselyPlugin } from 'asijs/database';
 *
 * const db = new Kysely({
 *   dialect: new SqliteDialect({ database: new Database('db.sqlite') })
 * });
 *
 * app.use(kyselyPlugin({
 *   client: db,
 *   logging: true
 * }));
 *
 * app.get('/users', async (ctx) => {
 *   return ctx.kysely.selectFrom('users').selectAll().execute();
 * });
 * ```
 */
export function kyselyPlugin(config: KyselyConfig): SimplePlugin {
  const { client, logging = false, slowQueryThreshold = 100 } = config;

  // Wrap with logging if enabled
  const wrappedClient = logging
    ? wrapWithLogging(client, logging, slowQueryThreshold)
    : client;

  return {
    name: "kysely",
    setup(app: PluginHost) {
      app.setState("kysely", wrappedClient);
    },
  };
}

/**
 * Kysely transaction helper
 *
 * @example
 * ```ts
 * import { kyselyTransaction } from 'asijs/database';
 *
 * app.post('/transfer', async (ctx) => {
 *   return kyselyTransaction(ctx.kysely, async (tx) => {
 *     await tx.updateTable('accounts').set({ balance: sql`balance - 100` }).where('id', '=', fromId).execute();
 *     await tx.updateTable('accounts').set({ balance: sql`balance + 100` }).where('id', '=', toId).execute();
 *     return { success: true };
 *   });
 * });
 * ```
 */
export async function kyselyTransaction<
  T,
  K extends {
    transaction: () => {
      execute: (fn: (tx: unknown) => Promise<T>) => Promise<T>;
    };
  },
>(kysely: K, fn: (tx: unknown) => Promise<T>): Promise<T> {
  return kysely.transaction().execute(fn);
}

// ============================================================================
// Generic Database Helpers
// ============================================================================

/**
 * Create a generic database plugin
 *
 * @example
 * ```ts
 * import { databasePlugin } from 'asijs/database';
 *
 * app.use(databasePlugin('db', myDatabaseClient, {
 *   logging: true,
 *   healthCheck: true
 * }));
 * ```
 */
export function databasePlugin(
  name: string,
  client: DatabaseClient,
  options: DatabaseConfig = {},
): SimplePlugin {
  const { logging = false, slowQueryThreshold = 100 } = options;

  const wrappedClient = logging
    ? wrapWithLogging(client, logging, slowQueryThreshold)
    : client;

  return {
    name: `database:${name}`,
    setup(app: PluginHost) {
      app.setState(name, wrappedClient);
    },
  };
}

/**
 * Wrap a database client with query logging
 */
function wrapWithLogging(
  client: unknown,
  logging: boolean | ((query: string, params?: unknown[]) => void),
  slowQueryThreshold: number,
): unknown {
  // If client has execute method, wrap it
  if (typeof (client as { execute?: unknown }).execute === "function") {
    const originalExecute = (
      client as {
        execute: (query: string, params?: unknown[]) => Promise<unknown>;
      }
    ).execute.bind(client);

    (
      client as {
        execute: (query: string, params?: unknown[]) => Promise<unknown>;
      }
    ).execute = async (query: string, params?: unknown[]) => {
      const start = performance.now();
      try {
        const result = await originalExecute(query, params);
        const duration = performance.now() - start;

        if (typeof logging === "function") {
          logging(query, params);
        } else if (logging) {
          if (duration > slowQueryThreshold) {
            console.warn(`[SLOW QUERY] ${duration.toFixed(2)}ms: ${query}`);
          } else {
            console.log(`[QUERY] ${duration.toFixed(2)}ms: ${query}`);
          }
        }

        return result;
      } catch (error) {
        const duration = performance.now() - start;
        console.error(
          `[QUERY ERROR] ${duration.toFixed(2)}ms: ${query}`,
          error,
        );
        throw error;
      }
    };
  }

  return client;
}

// ============================================================================
// Connection Pool Manager
// ============================================================================

/**
 * Pool statistics
 */
export interface PoolStats {
  /** Total connections in pool */
  total: number;
  /** Available connections */
  available: number;
  /** Connections in use */
  inUse: number;
  /** Waiting requests */
  waiting: number;
}

/**
 * Connection pool for database connections
 */
export class ConnectionPool<T extends DatabaseClient> {
  private pool: T[] = [];
  private inUse: Set<T> = new Set();
  private waiting: Array<(conn: T) => void> = [];
  private waitingIndex = 0;
  private factory: () => T | Promise<T>;
  private maxSize: number;
  private minSize: number;

  constructor(
    factory: () => T | Promise<T>,
    options: { maxSize?: number; minSize?: number } = {},
  ) {
    this.factory = factory;
    this.maxSize = options.maxSize ?? 10;
    this.minSize = options.minSize ?? 1;
  }

  /**
   * Initialize pool with minimum connections
   */
  async initialize(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (let i = 0; i < this.minSize; i++) {
      promises.push(this.createConnection());
    }
    await Promise.all(promises);
  }

  private async createConnection(): Promise<void> {
    const conn = await this.factory();
    this.pool.push(conn);
  }

  /**
   * Acquire a connection from the pool
   */
  async acquire(): Promise<T> {
    // Try to get available connection
    const conn = this.pool.pop();
    if (conn) {
      this.inUse.add(conn);
      return conn;
    }

    // Create new connection if under max
    if (this.inUse.size + this.pool.length < this.maxSize) {
      const newConn = await this.factory();
      this.inUse.add(newConn);
      return newConn;
    }

    // Wait for available connection
    return new Promise((resolve) => {
      this.waiting.push(resolve);
    });
  }

  /**
   * Release a connection back to the pool
   */
  release(conn: T): void {
    this.inUse.delete(conn);

    // Give to waiting request if any
    if (this.waitingIndex < this.waiting.length) {
      const waiting = this.waiting[this.waitingIndex++];
      this.inUse.add(conn);
      waiting(conn);

      // Compact queue occasionally
      if (
        this.waitingIndex > 64 &&
        this.waitingIndex * 2 >= this.waiting.length
      ) {
        this.waiting = this.waiting.slice(this.waitingIndex);
        this.waitingIndex = 0;
      }
    } else {
      this.pool.push(conn);
      if (this.waitingIndex !== 0) {
        this.waiting = [];
        this.waitingIndex = 0;
      }
    }
  }

  /**
   * Execute a function with a connection
   */
  async withConnection<R>(fn: (conn: T) => Promise<R>): Promise<R> {
    const conn = await this.acquire();
    try {
      return await fn(conn);
    } finally {
      this.release(conn);
    }
  }

  /**
   * Get pool statistics
   */
  stats(): PoolStats {
    return {
      total: this.pool.length + this.inUse.size,
      available: this.pool.length,
      inUse: this.inUse.size,
      waiting: this.waiting.length,
    };
  }

  /**
   * Close all connections
   */
  async close(): Promise<void> {
    // Close all pooled connections
    for (const conn of this.pool) {
      if (conn.close) {
        await conn.close();
      }
    }

    // Close in-use connections
    for (const conn of this.inUse) {
      if (conn.close) {
        await conn.close();
      }
    }

    this.pool = [];
    this.inUse.clear();
    this.waiting = [];
    this.waitingIndex = 0;
  }
}

// ============================================================================
// Query Builder Helpers
// ============================================================================

/**
 * SQL template tag for safe query building
 *
 * @example
 * ```ts
 * const userId = 123;
 * const query = sql`SELECT * FROM users WHERE id = ${userId}`;
 * // query.text: 'SELECT * FROM users WHERE id = $1'
 * // query.values: [123]
 * ```
 */
export function sql(
  strings: TemplateStringsArray,
  ...values: unknown[]
): { text: string; values: unknown[] } {
  let text = "";
  const params: unknown[] = [];

  for (let i = 0; i < strings.length; i++) {
    text += strings[i];
    if (i < values.length) {
      params.push(values[i]);
      text += `$${params.length}`;
    }
  }

  return { text, values: params };
}

/**
 * Build WHERE clause from object
 */
export function buildWhere(
  conditions: Record<string, unknown>,
  operator: "AND" | "OR" = "AND",
): { text: string; values: unknown[] } {
  const parts: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(conditions)) {
    if (value === null) {
      parts.push(`${key} IS NULL`);
    } else if (value === undefined) {
      continue;
    } else if (Array.isArray(value)) {
      const placeholders = value.map((_, i) => `$${values.length + i + 1}`);
      parts.push(`${key} IN (${placeholders.join(", ")})`);
      values.push(...value);
    } else {
      parts.push(`${key} = $${values.length + 1}`);
      values.push(value);
    }
  }

  return {
    text: parts.length > 0 ? `WHERE ${parts.join(` ${operator} `)}` : "",
    values,
  };
}

/**
 * Build INSERT clause from object
 */
export function buildInsert(
  table: string,
  data: Record<string, unknown>,
): { text: string; values: unknown[] } {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const placeholders = keys.map((_, i) => `$${i + 1}`);

  return {
    text: `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders.join(", ")})`,
    values,
  };
}

/**
 * Build UPDATE clause from object
 */
export function buildUpdate(
  table: string,
  data: Record<string, unknown>,
  where?: Record<string, unknown>,
): { text: string; values: unknown[] } {
  const setClause: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(data)) {
    setClause.push(`${key} = $${values.length + 1}`);
    values.push(value);
  }

  let text = `UPDATE ${table} SET ${setClause.join(", ")}`;

  if (where) {
    const whereClause = buildWhere(where);
    // Offset parameter numbers
    const offsetWhere = whereClause.text.replace(
      /\$(\d+)/g,
      (_, n) => `$${parseInt(n) + values.length}`,
    );
    text += ` ${offsetWhere}`;
    values.push(...whereClause.values);
  }

  return { text, values };
}

// ============================================================================
// Repository Pattern
// ============================================================================

/**
 * Base repository interface
 */
export interface Repository<T, ID = number> {
  findById(id: ID): Promise<T | null>;
  findAll(options?: { limit?: number; offset?: number }): Promise<T[]>;
  create(data: Partial<T>): Promise<T>;
  update(id: ID, data: Partial<T>): Promise<T | null>;
  delete(id: ID): Promise<boolean>;
  count(): Promise<number>;
}

/**
 * Create a repository decorator
 *
 * @example
 * ```ts
 * const userRepository = createRepository<User>(ctx.db, 'users');
 *
 * app.get('/users/:id', async (ctx) => {
 *   return userRepository.findById(ctx.params.id);
 * });
 * ```
 */
export function createRepository<
  T extends Record<string, unknown>,
  ID = number,
>(
  execute: (query: string, params?: unknown[]) => Promise<{ rows: T[] }>,
  table: string,
  idColumn = "id",
): Repository<T, ID> {
  return {
    async findById(id: ID): Promise<T | null> {
      const result = await execute(
        `SELECT * FROM ${table} WHERE ${idColumn} = $1 LIMIT 1`,
        [id],
      );
      return result.rows[0] ?? null;
    },

    async findAll(options?: { limit?: number; offset?: number }): Promise<T[]> {
      let query = `SELECT * FROM ${table}`;
      const params: unknown[] = [];

      if (options?.limit) {
        query += ` LIMIT $${params.length + 1}`;
        params.push(options.limit);
      }

      if (options?.offset) {
        query += ` OFFSET $${params.length + 1}`;
        params.push(options.offset);
      }

      const result = await execute(query, params);
      return result.rows;
    },

    async create(data: Partial<T>): Promise<T> {
      const { text, values } = buildInsert(
        table,
        data as Record<string, unknown>,
      );
      const result = await execute(`${text} RETURNING *`, values);
      return result.rows[0];
    },

    async update(id: ID, data: Partial<T>): Promise<T | null> {
      const { text, values } = buildUpdate(
        table,
        data as Record<string, unknown>,
        { [idColumn]: id },
      );
      const result = await execute(`${text} RETURNING *`, values);
      return result.rows[0] ?? null;
    },

    async delete(id: ID): Promise<boolean> {
      const result = await execute(
        `DELETE FROM ${table} WHERE ${idColumn} = $1`,
        [id],
      );
      return (result as unknown as { rowCount: number }).rowCount > 0;
    },

    async count(): Promise<number> {
      const result = await execute(`SELECT COUNT(*) as count FROM ${table}`);
      return parseInt(
        (result.rows[0] as unknown as { count: string }).count,
        10,
      );
    },
  };
}

// ============================================================================
// Migration Helpers
// ============================================================================

/**
 * Migration interface
 */
export interface Migration {
  /** Migration name */
  name: string;
  /** Run migration */
  up: (db: DatabaseClient) => Promise<void>;
  /** Rollback migration */
  down: (db: DatabaseClient) => Promise<void>;
}

/**
 * Simple migration runner
 */
export async function runMigrations(
  db: DatabaseClient & {
    execute: (query: string, params?: unknown[]) => Promise<unknown>;
  },
  migrations: Migration[],
): Promise<{ applied: string[]; skipped: string[] }> {
  // Create migrations table if not exists
  await db.execute(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Get applied migrations
  const result = (await db.execute("SELECT name FROM _migrations")) as {
    rows: { name: string }[];
  };
  const appliedNames = new Set(result.rows.map((r) => r.name));

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const migration of migrations) {
    if (appliedNames.has(migration.name)) {
      skipped.push(migration.name);
      continue;
    }

    console.log(`Running migration: ${migration.name}`);
    await migration.up(db);
    await db.execute("INSERT INTO _migrations (name) VALUES ($1)", [
      migration.name,
    ]);
    applied.push(migration.name);
  }

  return { applied, skipped };
}

/**
 * Rollback last migration
 */
export async function rollbackMigration(
  db: DatabaseClient & {
    execute: (query: string, params?: unknown[]) => Promise<unknown>;
  },
  migrations: Migration[],
): Promise<string | null> {
  // Get last applied migration
  const result = (await db.execute(
    "SELECT name FROM _migrations ORDER BY applied_at DESC LIMIT 1",
  )) as { rows: { name: string }[] };

  if (result.rows.length === 0) {
    console.log("No migrations to rollback");
    return null;
  }

  const lastMigration = result.rows[0].name;
  const migration = migrations.find((m) => m.name === lastMigration);

  if (!migration) {
    throw new Error(`Migration "${lastMigration}" not found`);
  }

  console.log(`Rolling back migration: ${lastMigration}`);
  await migration.down(db);
  await db.execute("DELETE FROM _migrations WHERE name = $1", [lastMigration]);

  return lastMigration;
}

// ============================================================================
// Type Extensions
// ============================================================================

declare module "./types" {
  interface Context {
    /** Drizzle database client */
    db?: unknown;
    /** Drizzle schema */
    schema?: unknown;
    /** Prisma client */
    prisma?: unknown;
    /** Kysely client */
    kysely?: unknown;
  }
}
