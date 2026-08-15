/**
 * Migrator — file-based database migrations (2.3)
 *
 * Conventions (migrationsDir, default `./migrations`):
 * - `001_create_users.sql`           — up-only migration
 * - `001_create_users.up.sql`        — up + `001_create_users.down.sql` (reversible)
 *
 * Files are applied in filename order; applied names are tracked in the
 * `__migrations` table (name, applied_at).
 *
 * @example
 * ```ts
 * const migrator = new Migrator(db, { dir: "./migrations" });
 * await migrator.up();      // apply pending
 * await migrator.down();    // rollback last
 * console.log(await migrator.status());
 * ```
 */

import { Database } from "./database";
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { basename, join } from "path";

export interface MigrationFile {
  /** Sort key derived from the filename */
  id: string;
  name: string;
  up: string;
  down?: string;
}

export interface MigrationStatus {
  name: string;
  applied: boolean;
  appliedAt?: string;
}

export class Migrator {
  private db: Database;
  private dir: string;

  constructor(db: Database, options: { dir?: string } = {}) {
    this.db = db;
    this.dir = options.dir ?? "./migrations";
  }

  get directory(): string {
    return this.dir;
  }

  /** Scan the migrations directory and return migration files in order. */
  list(): MigrationFile[] {
    if (!existsSync(this.dir)) return [];
    const files = readdirSync(this.dir).filter((f) => f.endsWith(".sql"));

    const byId = new Map<string, MigrationFile>();
    const pendingDown = new Map<string, string>();

    // Pass 1 — collect up-migrations and stash down-scripts (down files may
    // sort before their matching up file, so associate them in a second pass).
    for (const file of files) {
      if (file.includes(".down.sql")) {
        const base = file.replace(/\.down\.sql$/i, "");
        pendingDown.set(base, readFileSync(join(this.dir, file), "utf-8"));
        continue;
      }

      const name = file.endsWith(".up.sql")
        ? file.replace(/\.up\.sql$/i, "")
        : file.replace(/\.sql$/i, "");
      const id = name.split("_")[0] ?? name;
      byId.set(id, {
        id,
        name,
        up: readFileSync(join(this.dir, file), "utf-8"),
      });
    }

    // Pass 2 — attach down scripts to their up migrations
    for (const [base, sql] of pendingDown) {
      const id = base.split("_")[0] ?? base;
      const entry = byId.get(id);
      if (entry) entry.down = sql;
    }

    return Array.from(byId.values()).sort((a, b) => {
      const na = parseInt(a.id, 10) || 0;
      const nb = parseInt(b.id, 10) || 0;
      if (na !== nb) return na - nb;
      return a.id < b.id ? -1 : 1;
    });
  }

  /** Apply all pending migrations (idempotent — tracks applied names). */
  up(): { applied: string[]; skipped: number } {
    this.ensureTrackTable();
    const applied = new Set(this.appliedNames());
    const result: string[] = [];
    const migrations = this.list();

    for (const migration of migrations) {
      if (applied.has(migration.name)) continue;
      this.applyOne(migration);
      result.push(migration.name);
    }

    return { applied: result, skipped: migrations.length - result.length };
  }

  /** Roll back the most recently applied migration. */
  down(): { name: string; rolledBack: boolean } | null {
    this.ensureTrackTable();
    const applied = this.appliedNames();
    if (applied.length === 0) return null;

    const last = applied[applied.length - 1]!;
    const migrations = this.list();
    const migration = migrations.find((m) => m.name === last);

    if (!migration) {
      // Migration file was deleted — just untrack it
      this.db.execute("DELETE FROM __migrations WHERE name = ?", [last]);
      return { name: last, rolledBack: true };
    }

    if (migration.down) {
      this.db.transaction(() => {
        this.db.exec(migration.down!);
        this.db.execute("DELETE FROM __migrations WHERE name = ?", [last]);
      });
    } else {
      // No down script — untrack without touching data
      this.db.execute("DELETE FROM __migrations WHERE name = ?", [last]);
    }

    return { name: last, rolledBack: true };
  }

  /** Applied vs pending status for every known migration file. */
  status(): MigrationStatus[] {
    this.ensureTrackTable();
    const applied = new Set(this.appliedNames());
    const appliedAt = this.appliedAtMap();
    return this.list().map((m) => ({
      name: m.name,
      applied: applied.has(m.name),
      appliedAt: appliedAt.get(m.name),
    }));
  }

  /** Names of applied migrations, in application order. */
  appliedNames(): string[] {
    return this.db
      .query<{ name: string }>("SELECT name FROM __migrations ORDER BY rowid")
      .map((r) => r.name);
  }

  /** Scaffold a new migration file: `NNN_<name>.sql`. Returns the created path. */
  create(name: string): string {
    mkdirSync(this.dir, { recursive: true });
    const next = this.nextNumber();
    const file = join(this.dir, `${String(next).padStart(3, "0")}_${slugify(name)}.sql`);
    writeFileSync(
      file,
      `-- Migration: ${name}\n-- Generated by \`asi db migrate --create\`\n\n\n`,
      "utf-8",
    );
    return file;
  }

  private ensureTrackTable(): void {
    this.db.execute(
      "CREATE TABLE IF NOT EXISTS __migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
    );
  }

  private applyOne(migration: MigrationFile): void {
    this.db.transaction(() => {
      this.db.exec(migration.up);
      this.db.execute(
        "INSERT INTO __migrations (name, applied_at) VALUES (?, ?)",
        [migration.name, new Date().toISOString()],
      );
    });
  }

  private appliedAtMap(): Map<string, string> {
    const map = new Map<string, string>();
    for (const row of this.db.query<{ name: string; applied_at: string }>(
      "SELECT name, applied_at FROM __migrations",
    )) {
      map.set(row.name, row.applied_at);
    }
    return map;
  }

  private nextNumber(): number {
    const files = this.list();
    let max = 0;
    for (const f of files) {
      const n = parseInt(f.id, 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
    return max + 1;
  }
}

/** Normalize a migration name to a filesystem-safe slug. */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "migration"
  );
}

/** Convenience: create a Migrator and apply pending migrations. */
export function migrate(db: Database, dir?: string): { applied: string[]; skipped: number } {
  return new Migrator(db, { dir }).up();
}
