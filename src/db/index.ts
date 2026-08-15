/**
 * Database Layer (2.3) — zero-dependency database access, migrations,
 * seeding and an embedded studio GUI.
 */
import type { DbConfig } from "./database";

export {
  Database,
  type DbConfig,
  type DatabaseType,
  type Row,
} from "./database";
export { Migrator, migrate, slugify, type MigrationFile, type MigrationStatus } from "./migrator";
export { runSeed, findSeedFile, type SeedResult } from "./seed";
export { serveDbStudio, studioHandler, type DbStudioOptions, type StudioApiResponse } from "./studio";

/**
 * Public database config: the existing ORM-level `DatabaseConfig` from
 * `src/database.ts` (url, type, poolSize, logging) + the layer options
 * (migrationsDir, autoMigrate, seedFile, autoSeed).
 */
export type DatabaseConfig = import("../database").DatabaseConfig & DbConfig;
