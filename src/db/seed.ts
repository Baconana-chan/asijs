/**
 * Seed runner (2.3)
 *
 * Runs a seed file:
 * - `.sql` — executed as-is (multi-statement)
 * - `.ts` / `.js` — dynamic import; default export is `(db) => void | Promise<void>`
 *
 * @example
 * ```ts
 * // seed.sql
 * INSERT INTO users (name) VALUES ('Alice'), ('Bob');
 * ```
 *
 * ```ts
 * // seed.ts
 * export default async (db) => {
 *   await db.execute("INSERT INTO users (name) VALUES (?)", ["Carol"]);
 * };
 * ```
 */

import { Database } from "./database";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { pathToFileURL } from "url";

export interface SeedResult {
  file: string;
  kind: "sql" | "module";
  ran: boolean;
}

/**
 * Run a seed file against the database.
 * @param db target database
 * @param seedFile path to `.sql` or `.ts`/`.js` seed file
 * @returns result descriptor
 */
export async function runSeed(db: Database, seedFile: string): Promise<SeedResult> {
  const resolved = resolve(seedFile);

  if (!existsSync(resolved)) {
    throw new Error(`Seed file not found: ${seedFile}`);
  }

  if (seedFile.endsWith(".sql")) {
    const sql = readFileSync(resolved, "utf-8");
    db.exec(sql);
    return { file: seedFile, kind: "sql", ran: true };
  }

  // TS/JS module — dynamic import with default export
  const mod = await import(pathToFileURL(resolved).href);
  const fn = mod.default ?? mod.seed;
  if (typeof fn !== "function") {
    throw new Error(
      `Seed module ${seedFile} must export a function as default (or \`seed\`): (db) => void`,
    );
  }
  await fn(db);
  return { file: seedFile, kind: "module", ran: true };
}

/**
 * Find the default seed file in a project: `seed.sql`, `seed.ts`, `./db/seed.ts`.
 * Returns the first that exists, or null.
 */
export function findSeedFile(cwd: string = process.cwd()): string | null {
  const candidates = [
    "seed.sql",
    "seed.ts",
    "seed.js",
    "db/seed.ts",
    "db/seed.sql",
  ];
  for (const candidate of candidates) {
    if (existsSync(resolve(cwd, candidate))) return candidate;
  }
  return null;
}
