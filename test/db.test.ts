import { describe, it, expect, afterEach } from "bun:test";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  Asi,
  Database,
  Migrator,
  migrate,
  runSeed,
  studioHandler,
  serveDbStudio,
} from "../src";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "asi-db-"));
  tempDirs.push(dir);
  return dir;
}

describe("Database (2.3)", () => {
  it("creates an in-memory sqlite database and runs queries", () => {
    const db = new Database({ url: ":memory:" });
    db.execute(
      "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
    );
    db.execute("INSERT INTO users (name) VALUES (?)", ["Alice"]);
    db.execute("INSERT INTO users (name) VALUES (?)", ["Bob"]);

    const rows = db.query<{ id: number; name: string }>(
      "SELECT * FROM users ORDER BY id",
    );
    expect(rows.length).toBe(2);
    expect(rows[0].name).toBe("Alice");

    const first = db.first<{ name: string }>("SELECT name FROM users WHERE id = ?", [2]);
    expect(first?.name).toBe("Bob");

    expect(db.listTables()).toContain("users");
    expect(db.tableInfo("users").some((c) => c.name === "id" && c.pk === 1)).toBe(true);
    db.close();
    expect(db.closed).toBe(true);
  });

  it("transaction commits and rolls back", () => {
    const db = new Database({ url: ":memory:" });
    db.execute("CREATE TABLE t (v INTEGER)");

    db.transaction(() => {
      db.execute("INSERT INTO t (v) VALUES (1)");
    });
    expect(db.first<{ n: number }>("SELECT COUNT(*) AS n FROM t")?.n).toBe(1);

    expect(() =>
      db.transaction(() => {
        db.execute("INSERT INTO t (v) VALUES (2)");
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(db.first<{ n: number }>("SELECT COUNT(*) AS n FROM t")?.n).toBe(1);
    db.close();
  });

  it("query on a closed database throws", () => {
    const db = new Database({ url: ":memory:" });
    db.close();
    expect(() => db.query("SELECT 1")).toThrow(/closed/);
  });

  it("sqlite file URL creates a file", () => {
    const dir = tempDir();
    const path = join(dir, "app.db");
    const db = new Database({ url: `file:${path}` });
    db.execute("CREATE TABLE x (id INTEGER)");
    db.close();
    expect(existsSync(path)).toBe(true);
  });

  it("postgres url requires the postgres package (helpful error)", () => {
    // The postgres driver is a lazy optional dep — constructor throws a hint
    expect(() => new Database({ url: "postgres://user:pass@localhost:5432/db" })).toThrow(
      /postgres/,
    );
  });
});

describe("Migrator (2.3)", () => {
  function makeDbWithMigrations(): { db: Database; dir: string } {
    const dir = tempDir(); // mkdtemp already creates the directory
    writeFileSync(
      join(dir, "001_create_users.sql"),
      "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);",
    );
    writeFileSync(
      join(dir, "002_add_email.up.sql"),
      "ALTER TABLE users ADD COLUMN email TEXT;",
    );
    writeFileSync(
      join(dir, "002_add_email.down.sql"),
      "ALTER TABLE users DROP COLUMN email;",
    );
    return { db: new Database({ url: ":memory:" }), dir };
  }

  it("applies pending migrations in order and tracks them", () => {
    const { db, dir } = makeDbWithMigrations();
    const m = new Migrator(db, { dir });
    const result = m.up();
    expect(result.applied).toEqual(["001_create_users", "002_add_email"]);

    // Table exists
    expect(db.listTables()).toContain("users");
    // Column added
    expect(db.tableInfo("users").some((c) => c.name === "email")).toBe(true);

    // Idempotent
    const again = m.up();
    expect(again.applied).toEqual([]);

    const status = m.status();
    expect(status.every((s) => s.applied)).toBe(true);
    db.close();
  });

  it("rolls back the last migration using .down.sql", () => {
    const { db, dir } = makeDbWithMigrations();
    const m = new Migrator(db, { dir });
    m.up();

    const rolled = m.down();
    expect(rolled?.name).toBe("002_add_email");
    expect(db.tableInfo("users").some((c) => c.name === "email")).toBe(false);
    db.close();
  });

  it("create scaffolds a numbered migration file", () => {
    const dir = tempDir();
    const db = new Database({ url: ":memory:" });
    const m = new Migrator(db, { dir });
    const file = m.create("add posts table");
    expect(existsSync(file)).toBe(true);
    expect(file).toContain("001_add_posts_table.sql");
    // Next create increments
    const file2 = m.create("add comments");
    expect(file2).toContain("002_add_comments.sql");
    db.close();
  });

  it("convenience migrate() applies pending", () => {
    const { db, dir } = makeDbWithMigrations();
    const result = migrate(db, dir);
    expect(result.applied.length).toBe(2);
    db.close();
  });
});

describe("Seed (2.3)", () => {
  it("runs a .sql seed file", async () => {
    const dir = tempDir();
    const seedFile = join(dir, "seed.sql");
    writeFileSync(seedFile, "CREATE TABLE s (v TEXT); INSERT INTO s (v) VALUES ('x');");
    const db = new Database({ url: ":memory:" });
    const result = await runSeed(db, seedFile);
    expect(result.kind).toBe("sql");
    expect(db.first<{ v: string }>("SELECT v FROM s")?.v).toBe("x");
    db.close();
  });

  it("runs a .ts seed module with default export", async () => {
    const dir = tempDir();
    const seedFile = join(dir, "seed.ts");
    writeFileSync(
      seedFile,
      `import type { Database } from "asijs";\nexport default async (db: Database) => { await db.execute("CREATE TABLE m (v TEXT)"); await db.execute("INSERT INTO m (v) VALUES (?)", ["y"]); };\n`,
    );
    const db = new Database({ url: ":memory:" });
    const result = await runSeed(db, seedFile);
    expect(result.kind).toBe("module");
    expect(db.first<{ v: string }>("SELECT v FROM m")?.v).toBe("y");
    db.close();
  });

  it("throws a helpful error for missing seed file", () => {
    const db = new Database({ url: ":memory:" });
    expect(runSeed(db, "/nonexistent/seed.sql")).rejects.toThrow(/not found/);
    db.close();
  });
});

describe("Asi database config + autoMigrate (2.3)", () => {
  it("app.db lazily creates the database and autoMigrate applies migrations", async () => {
    const dir = tempDir();
    mkdirSync(join(dir, "migrations"));
    writeFileSync(
      join(dir, "migrations", "001_init.sql"),
      "CREATE TABLE todos (id INTEGER PRIMARY KEY, text TEXT);",
    );

    const app = new Asi({
      silent: true,
      database: {
        url: ":memory:",
        migrationsDir: join(dir, "migrations"),
        autoMigrate: true,
      },
    });

    // Lazy — not connected until accessed
    const db = app.db;
    expect(db).not.toBeNull();
    expect(db!.listTables()).toContain("todos");
    db!.close();
  });

  it("autoMigrate runs on listen()", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "migrations"));
    writeFileSync(
      join(dir, "migrations", "001_init.sql"),
      "CREATE TABLE items (id INTEGER PRIMARY KEY);",
    );

    const app = new Asi({
      silent: true,
      database: {
        url: ":memory:",
        migrationsDir: join(dir, "migrations"),
        autoMigrate: true,
      },
    });
    app.get("/", () => "ok");
    const server = app.listen(0);
    const db = app.db!;
    expect(db.listTables()).toContain("items");
    try {
      (server as any).stop?.();
    } catch {
      /* noop */
    }
    db.close();
  });

  it("no database config → app.db is null", () => {
    const app = new Asi({ silent: true });
    expect(app.db).toBeNull();
  });
});

describe("Db Studio (2.3)", () => {
  function makeDb(): Database {
    const db = new Database({ url: ":memory:" });
    db.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
    db.execute("INSERT INTO users (name) VALUES (?)", ["Alice"]);
    db.execute("INSERT INTO users (name) VALUES (?)", ["Bob"]);
    return db;
  }

  it("serves the HTML page", async () => {
    const db = makeDb();
    const handler = studioHandler(db);
    const res = await handler(new Request("http://localhost/__studio"));
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Db Studio");
    db.close();
  });

  it("api/tables lists tables", async () => {
    const db = makeDb();
    const handler = studioHandler(db);
    const res = await handler(new Request("http://localhost/__studio/api/tables"));
    const data = (await res.json()) as { ok: boolean; tables: string[] };
    expect(data.ok).toBe(true);
    expect(data.tables).toContain("users");
    db.close();
  });

  it("api/table returns rows with pagination metadata", async () => {
    const db = makeDb();
    const handler = studioHandler(db);
    const res = await handler(
      new Request("http://localhost/__studio/api/table?name=users&page=1"),
    );
    const data = (await res.json()) as { ok: boolean; rows: unknown[]; total: number };
    expect(data.ok).toBe(true);
    expect(data.rows.length).toBe(2);
    expect(data.total).toBe(2);
    db.close();
  });

  it("api/query runs SQL", async () => {
    const db = makeDb();
    const handler = studioHandler(db);
    const res = await handler(
      new Request("http://localhost/__studio/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: "SELECT name FROM users WHERE id = 1" }),
      }),
    );
    const data = (await res.json()) as { ok: boolean; rows: { name: string }[] };
    expect(data.ok).toBe(true);
    expect(data.rows[0].name).toBe("Alice");
    db.close();
  });

  it("api/query reports errors without crashing", async () => {
    const db = makeDb();
    const handler = studioHandler(db);
    const res = await handler(
      new Request("http://localhost/__studio/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: "SELECT * FROM nope" }),
      }),
    );
    const data = (await res.json()) as { ok: boolean; error: string };
    expect(data.ok).toBe(false);
    expect(data.error).toContain("nope");
    db.close();
  });

  it("serveDbStudio starts an HTTP server with studio", async () => {
    const db = makeDb();
    const server = serveDbStudio(db, { port: 0, silent: true });
    const port = (server as any).port ?? 0;
    const res = await fetch(`http://127.0.0.1:${port}/api/tables`);
    const data = (await res.json()) as { ok: boolean };
    expect(data.ok).toBe(true);
    try {
      (server as any).stop?.();
    } catch {
      /* noop */
    }
    db.close();
  });
});
