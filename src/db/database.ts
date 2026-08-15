/**
 * Database Layer (2.3)
 *
 * Zero-dependency database access for AsiJS:
 * - SQLite via `bun:sqlite` (built into Bun — no npm install needed)
 * - PostgreSQL via lazy `import("postgres")` (installed on demand)
 *
 * @example
 * ```ts
 * import { Database } from "asijs";
 *
 * const db = new Database({ url: "file:./app.db" });
 * await db.execute("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)");
 * const rows = db.query<{ id: number; name: string }>("SELECT * FROM users");
 * db.close();
 * ```
 */

export type DatabaseType = "sqlite" | "postgres";

/**
 * Database connection + layer options.
 * The public `DatabaseConfig` (re-exported from index) is the intersection of
 * this and the existing `DatabaseConfig` from `src/database.ts` (ORM plugins),
 * so both option sets work with `app.database` / `new Database(...)`.
 */
export interface DbConfig {
  /**
   * Connection URL:
   * - sqlite: `file:./app.db` | `sqlite:./app.db` | `./app.db` | `:memory:`
   * - postgres: `postgres://user:pass@host:5432/db`
   * @default "file:./app.db"
   */
  url?: string;
  /** Driver type — auto-detected from url unless specified. @default "sqlite" */
  type?: DatabaseType;
  /** Directory with migration files (NNN_name.sql / NNN_name.up.sql). @default "./migrations" */
  migrationsDir?: string;
  /** Run pending migrations automatically on app start. @default false */
  autoMigrate?: boolean;
  /** Seed file to run (path to .sql or .ts). @default "./seed.sql" */
  seedFile?: string;
  /** Run seed automatically after migrations. @default false */
  autoSeed?: boolean;
}

/** A query result row — a plain object keyed by column name */
export type Row = Record<string, unknown>;

/**
 * Database — thin, safe wrapper around the underlying driver.
 * All methods are synchronous for sqlite (bun:sqlite is sync).
 */
export class Database {
  readonly type: DatabaseType;
  readonly url: string;
  /** Underlying driver instance (bun:sqlite Database or postgres client) */
  readonly raw: any;
  private _closed = false;

  constructor(config: DbConfig = {}) {
    this.url = config.url ?? "file:./app.db";
    const type = config.type ?? detectType(this.url);
    this.type = type;

    if (type === "postgres") {
      // Lazy-import — the `postgres` package is an optional peer dependency
      this.raw = loadPostgres(this.url);
    } else {
      this.raw = loadSqlite(this.url);
    }
  }

  /** Run a query and return all rows. */
  query<T extends Row = Row>(sql: string, params: unknown[] = []): T[] {
    this.assertOpen();
    if (this.type === "sqlite") {
      return (this.raw as SQLiteDriver).query(sql, params) as T[];
    }
    throw new Error("Database.query() on postgres is async — use queryAsync()");
  }

  /** Run a query on postgres (async). SQLite path is sync but awaitable. */
  async queryAsync<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    this.assertOpen();
    if (this.type === "sqlite") {
      return this.query<T>(sql, params);
    }
    return this.raw.unsafe(sql, params) as Promise<T[]>;
  }

  /** Execute a statement and return affected count. */
  execute(sql: string, params: unknown[] = []): number {
    this.assertOpen();
    if (this.type === "sqlite") {
      const stmt = this.raw.prepare(sql);
      const info = stmt.run(...params);
      return Number(info.changes ?? 0);
    }
    throw new Error("Database.execute() on postgres is async — use executeAsync()");
  }

  /** Execute a statement on postgres (async). */
  async executeAsync(sql: string, params: unknown[] = []): Promise<unknown> {
    this.assertOpen();
    if (this.type === "sqlite") {
      return this.execute(sql, params);
    }
    return this.raw.unsafe(sql, params);
  }

  /** First row of a query, or undefined. */
  first<T extends Row = Row>(sql: string, params: unknown[] = []): T | undefined {
    return this.query<T>(sql, params)[0];
  }

  /** Run multiple statements (e.g. a migration file) in one transaction. */
  exec(sql: string): void {
    this.assertOpen();
    if (this.type === "sqlite") {
      (this.raw as SQLiteDriver).exec(sql);
      return;
    }
    throw new Error("Database.exec() on postgres is async — use execAsync()");
  }

  /** Run multiple statements on postgres (async). */
  async execAsync(sql: string): Promise<void> {
    this.assertOpen();
    if (this.type === "sqlite") {
      this.exec(sql);
      return;
    }
    await this.raw.unsafe(sql);
  }

  /** Run `fn` inside a transaction (sqlite: BEGIN/COMMIT, rollback on throw). */
  transaction<T>(fn: () => T): T {
    this.assertOpen();
    if (this.type !== "sqlite") {
      throw new Error("Database.transaction() is sync-only (sqlite) — use transactionAsync()");
    }
    const db = this.raw as SQLiteDriver;
    db.exec("BEGIN");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  /** Run `fn` inside a transaction on postgres (async). */
  async transactionAsync<T>(fn: () => Promise<T> | T): Promise<T> {
    this.assertOpen();
    if (this.type === "sqlite") {
      return this.transaction(() => fn() as T);
    }
    const sql = this.raw;
    await sql`BEGIN`;
    try {
      const result = await fn();
      await sql`COMMIT`;
      return result;
    } catch (err) {
      await sql`ROLLBACK`;
      throw err;
    }
  }

  /** List tables in the database. */
  listTables(): string[] {
    this.assertOpen();
    if (this.type === "sqlite") {
      const rows = this.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      );
      return rows.map((r) => r.name);
    }
    throw new Error("Database.listTables() is sqlite-only — use listTablesAsync()");
  }

  /** List tables on postgres (async). */
  async listTablesAsync(): Promise<string[]> {
    if (this.type === "sqlite") return this.listTables();
    const rows = await this.queryAsync<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    return rows.map((r) => r.table_name);
  }

  /** Read a table's schema (columns) for the studio GUI. */
  tableInfo(table: string): Array<{ name: string; type: string; notnull: number; pk: number }> {
    this.assertOpen();
    if (this.type === "sqlite") {
      return this.query(
        `PRAGMA table_info(${quoteIdent(table)})`,
      ) as Array<{ name: string; type: string; notnull: number; pk: number }>;
    }
    throw new Error("Database.tableInfo() is sqlite-only — use tableInfoAsync()");
  }

  /** Read a table's columns on postgres (async). */
  async tableInfoAsync(table: string): Promise<Array<{ name: string; type: string }>> {
    if (this.type === "sqlite") return this.tableInfo(table);
    return this.queryAsync(
      `SELECT column_name AS name, data_type AS type FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
      [table],
    );
  }

  /** Close the underlying connection. */
  close(): void {
    if (this._closed) return;
    this._closed = true;
    try {
      if (this.type === "sqlite") {
        (this.raw as SQLiteDriver).close();
      } else {
        this.raw?.end?.();
      }
    } catch {
      // already closed — ignore
    }
  }

  get closed(): boolean {
    return this._closed;
  }

  private assertOpen(): void {
    if (this._closed) {
      throw new Error("Database is closed");
    }
  }
}

// ===== Driver loading =====

type SQLiteDriver = {
  query: (sql: string, params: unknown[]) => Row[];
  prepare: (sql: string) => { run: (...args: unknown[]) => { changes: number | bigint } };
  exec: (sql: string) => void;
  close: () => void;
};

function detectType(url: string): DatabaseType {
  if (/^postgres(ql)?:\/\//.test(url)) return "postgres";
  return "sqlite";
}

function loadSqlite(url: string): SQLiteDriver {
  // bun:sqlite is built into Bun — zero dependencies
  const { Database: BunSqlite } = requireBunSqlite();
  const path = sqlitePath(url);
  const db = new BunSqlite(path);
  // Enable WAL for better concurrency
  try {
    db.exec("PRAGMA journal_mode = WAL");
  } catch {
    // in-memory db — WAL not supported
  }
  return {
    query: (sql: string, params: unknown[]) => {
      const stmt = db.prepare(sql);
      return stmt.all(...params) as Row[];
    },
    prepare: (sql: string) => db.prepare(sql),
    exec: (sql: string) => db.exec(sql),
    close: () => db.close(),
  };
}

function requireBunSqlite(): { Database: new (path: string) => any } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("bun:sqlite") as { Database: new (path: string) => any };
  } catch {
    throw new Error(
      "bun:sqlite is only available on Bun. Install the `bun:sqlite`-compatible driver or use a postgres URL with the `postgres` package installed.",
    );
  }
}

function loadPostgres(url: string): any {
  try {
    // Lazy optional dependency — `postgres` is NOT bundled with asijs
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const postgres = require("postgres") as (url: string, opts?: object) => any;
    return postgres(url, { prepare: false });
  } catch {
    throw new Error(
      "PostgreSQL support requires the `postgres` package:\n  bun add postgres\n\n" +
        "Then pass a postgres:// URL to Database or AsiConfig.database.",
    );
  }
}

/** Normalize a sqlite url/path to a file path (`:memory:` stays). */
function sqlitePath(url: string): string {
  if (url === ":memory:") return ":memory:";
  if (url.startsWith("file:")) return url.slice("file:".length);
  if (url.startsWith("sqlite:")) return url.slice("sqlite:".length);
  return url;
}

/** Quote an identifier for PRAGMA (avoid injection from table names). */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
