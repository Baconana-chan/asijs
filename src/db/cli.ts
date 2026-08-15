/**
 * `asi db` CLI commands (2.3) — migrate / seed / studio.
 * Imported by src/cli.ts.
 */

import { existsSync } from "fs";
import { resolve, join } from "path";
import { Database, type DbConfig } from "./database";
import { Migrator } from "./migrator";
import { runSeed, findSeedFile } from "./seed";
import { serveDbStudio } from "./studio";

interface DbCliConfig {
  url?: string;
  type?: "sqlite" | "postgres";
  migrationsDir?: string;
  seedFile?: string;
  autoMigrate?: boolean;
}

function c() {
  // Minimal ANSI colors (same helpers as src/cli.ts)
  return {
    bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
    dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
    red: (s: string) => `\x1b[31m${s}\x1b[0m`,
    green: (s: string) => `\x1b[32m${s}\x1b[0m`,
    yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
    cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  };
}

/** Parse `--key value` and `--key=value` flags from args. */
function parseFlags(args: string[]): { flags: Record<string, string | undefined>; rest: string[] } {
  const flags: Record<string, string | undefined> = {};
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const next = args[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[arg.slice(2)] = next;
          i++;
        } else {
          // Valueless boolean flag
          flags[arg.slice(2)] = "true";
        }
      }
    } else {
      rest.push(arg);
    }
  }
  return { flags, rest };
}

/** Load database config: flags → asi.config.(ts|js) → env → defaults. */
async function resolveDbConfig(
  flags: Record<string, string | undefined>,
): Promise<DbCliConfig> {
  const cwd = process.cwd();
  let fromConfig: DbCliConfig = {};

  // 1. asi.config.ts / asi.config.js — dynamic import
  for (const candidate of ["asi.config.ts", "asi.config.js"]) {
    const path = join(cwd, candidate);
    if (existsSync(path)) {
      try {
        const mod = await import(resolve(path));
        const cfg = mod.default ?? mod.config ?? {};
        if (cfg && typeof cfg === "object") {
          const database = (cfg as any).database as DbCliConfig | undefined;
          if (database) fromConfig = database;
        }
        if ((cfg as any).database !== undefined) break;
      } catch (err) {
        // config failed to load — continue to defaults
        void err;
      }
      break;
    }
  }

  // 2. env DATABASE_URL
  const envUrl = process.env.DATABASE_URL;

  return {
    url: flags.url ?? fromConfig.url ?? envUrl,
    type: (flags.type as "sqlite" | "postgres" | undefined) ?? fromConfig.type,
    migrationsDir: flags["migrations-dir"] ?? fromConfig.migrationsDir,
    seedFile: flags.seed ?? fromConfig.seedFile,
  };
}

/** `asi db migrate [--create "name"] [--down] [--status] [--url ...]` */
export async function dbMigrate(args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const col = c();

  if (flags.create !== undefined) {
    const db = openDb(flags);
    const migrator = new Migrator(db, { dir: flags["migrations-dir"] });
    const file = migrator.create(flags.create || "new_migration");
    console.log(`  ${col.green("✓")} Created migration ${col.cyan(file)}`);
    db.close();
    return;
  }

  const db = openDb(flags);
  const migrator = new Migrator(db, { dir: flags["migrations-dir"] });

  try {
    if (flags.status) {
      const status = migrator.status();
      console.log(`\n  ${col.bold("Migration status")} (${migrator.directory})\n`);
      if (status.length === 0) {
        console.log(`  ${col.dim("No migration files found.")}`);
      }
      for (const s of status) {
        const mark = s.applied ? col.green("✓") : col.yellow("·");
        const stamp = s.appliedAt ? col.dim(`  ${s.appliedAt}`) : "";
        console.log(`  ${mark} ${s.name}${stamp}`);
      }
      console.log();
      return;
    }

    if (flags.down) {
      const result = migrator.down();
      if (!result) {
        console.log(`  ${col.yellow("Nothing to roll back — no applied migrations.")}`);
      } else {
        console.log(`  ${col.green("↙")} Rolled back ${col.cyan(result.name)}`);
      }
      return;
    }

    const result = migrator.up();
    if (result.applied.length === 0) {
      console.log(`  ${col.dim("No pending migrations.")}`);
    } else {
      console.log(`  ${col.green("✓")} Applied ${result.applied.length} migration(s):`);
      for (const name of result.applied) {
        console.log(`    ${col.green("+")} ${name}`);
      }
    }
  } finally {
    db.close();
  }
}

/** `asi db seed [file] [--url ...]` */
export async function dbSeed(args: string[]): Promise<void> {
  const { flags, rest } = parseFlags(args);
  const col = c();
  const db = openDb(flags);

  try {
    const seedFile = rest[0] ?? flags.seed ?? findSeedFile(process.cwd());
    if (!seedFile) {
      console.log(
        `  ${col.yellow("No seed file found.")} ${col.dim("Create seed.sql or seed.ts, or pass a path.")}`,
      );
      return;
    }
    await runSeed(db, seedFile);
    console.log(`  ${col.green("🌱")} Seeded database from ${col.cyan(seedFile)}`);
  } catch (err) {
    console.error(`  ${col.red("✗")} Seed failed: ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

/** `asi db studio [--port N] [--url ...]` */
export function dbStudio(args: string[]): void {
  const { flags } = parseFlags(args);
  const col = c();
  const db = openDb(flags);

  const port = flags.port ? parseInt(flags.port, 10) : 5500;
  const server = serveDbStudio(db, { port, silent: false });
  console.log(`  ${col.dim("Press Ctrl+C to stop.")}`);

  const stop = () => {
    try {
      (server as any).stop?.();
    } catch {
      /* noop */
    }
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

function openDb(flags: Record<string, string | undefined>): Database {
  const url = flags.url ?? process.env.DATABASE_URL ?? "file:./app.db";
  return new Database({ url, type: flags.type as "sqlite" | "postgres" | undefined });
}

/** Main entry for `asi db` — dispatches subcommands. */
export async function handleDb(args: string[]): Promise<void> {
  const col = c();
  const sub = args[0];

  if (!sub || sub === "--help" || sub === "-h") {
    console.log(`\n${col.bold("AsiJS Database")} — migrate, seed & browse the database\n`);
    console.log(`${col.bold("Usage:")}`);
    console.log(`  asi db migrate [--create \"name\"] [--down] [--status]`);
    console.log(`  asi db seed [file]`);
    console.log(`  asi db studio [--port 5500]`);
    console.log();
    console.log(`${col.bold("Options:")}`);
    console.log(`  --url <url>            Connection string (or DATABASE_URL)`);
    console.log(`  --migrations-dir <dir> Migration directory (default ./migrations)`);
    console.log();
    console.log(`${col.bold("Config:")}`, "reads `database` from asi.config.ts/js, then DATABASE_URL env.");
    console.log();
    return;
  }

  switch (sub) {
    case "migrate":
    case "m": {
      await dbMigrate(args.slice(1));
      return;
    }
    case "seed":
    case "s": {
      await dbSeed(args.slice(1));
      return;
    }
    case "studio": {
      dbStudio(args.slice(1));
      return;
    }
    default:
      console.error(`  ${col.red("Unknown db subcommand:")} ${sub}`);
      process.exitCode = 1;
  }
}
