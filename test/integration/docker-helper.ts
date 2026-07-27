/**
 * Docker test container helper.
 *
 * Provides utilities to check if test containers (PostgreSQL, Redis, MinIO)
 * are running, and skip tests gracefully if they're not available.
 *
 * Usage:
 * ```ts
 * import { describe, test, expect } from "bun:test";
 * import { PG_AVAILABLE } from "../integration/docker-helper";
 *
 * const it = PG_AVAILABLE ? test : test.skip;
 * ```
 */

// ============================================================================
// Configuration — matches docker/docker-compose.test.yml
// ============================================================================

export const CONFIG = {
  postgres: {
    host: process.env.ASIJS_TEST_PG_HOST || "localhost",
    port: parseInt(process.env.ASIJS_TEST_PG_PORT || "5433", 10),
    user: process.env.ASIJS_TEST_PG_USER || "asijs",
    password: process.env.ASIJS_TEST_PG_PASSWORD || "asijs_test",
    database: process.env.ASIJS_TEST_PG_DATABASE || "asijs_test",
  },
  redis: {
    host: process.env.ASIJS_TEST_REDIS_HOST || "localhost",
    port: parseInt(process.env.ASIJS_TEST_REDIS_PORT || "6380", 10),
  },
  minio: {
    host: process.env.ASIJS_TEST_MINIO_HOST || "localhost",
    port: parseInt(process.env.ASIJS_TEST_MINIO_PORT || "9001", 10),
    accessKey: process.env.ASIJS_TEST_MINIO_ACCESS_KEY || "asijs_test",
    secretKey: process.env.ASIJS_TEST_MINIO_SECRET_KEY || "asijs_test_secret",
  },
};

// ============================================================================
// Connectivity checks (lazy — resolved on first use)
// ============================================================================

let _pgAvailable: boolean | null = null;
let _redisAvailable: boolean | null = null;
let _minioAvailable: boolean | null = null;

/**
 * Try to open a TCP connection to check if a service is reachable.
 */
async function tcpReachable(host: string, port: number, timeout = 3000): Promise<boolean> {
  try {
    // Bun.connect() can be called with a timeout via AbortSignal
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const conn = await Bun.connect({
      hostname: host,
      port,
      signal: controller.signal,
    });

    clearTimeout(timer);
    conn.end();
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if PostgreSQL is available by trying to connect.
 */
export async function isPostgresAvailable(): Promise<boolean> {
  if (_pgAvailable !== null) return _pgAvailable;

  _pgAvailable = await tcpReachable(CONFIG.postgres.host, CONFIG.postgres.port);
  return _pgAvailable;
}

/**
 * Check if Redis is available by pinging.
 */
export async function isRedisAvailable(): Promise<boolean> {
  if (_redisAvailable !== null) return _redisAvailable;

  _redisAvailable = await tcpReachable(CONFIG.redis.host, CONFIG.redis.port);
  return _redisAvailable;
}

/**
 * Check if MinIO (S3) is available by making a health check request.
 */
export async function isMinIOAvailable(): Promise<boolean> {
  if (_minioAvailable !== null) return _minioAvailable;

  try {
    const url = `http://${CONFIG.minio.host}:${CONFIG.minio.port}/minio/health/live`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    _minioAvailable = res.ok;
    return res.ok;
  } catch {
    _minioAvailable = false;
    return false;
  }
}

// ============================================================================
// PostgreSQL connection — uses Bun's built-in SQL or the `pg` package
// ============================================================================

export interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount?: number;
}

export interface DBConnection {
  query(sql: string, params?: unknown[]): Promise<QueryResult>;
  close(): Promise<void>;
}

/**
 * Connect to the test PostgreSQL database.
 * Uses the `pg` package (already a dependency) or falls back to postgres.js.
 */
export async function connectPostgres(): Promise<DBConnection> {
  const { host, port, user, password, database } = CONFIG.postgres;

  // Method 1: Node.js `pg` package (preferred — already a dependency)
  try {
    const { Pool } = await import("pg");
    const pool = new Pool({
      host,
      port,
      user,
      password,
      database,
      max: 3,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
    });

    return {
      query: async (q: string, params?: unknown[]) => {
        const result = await pool.query(q, params);
        return {
          rows: result.rows as Record<string, unknown>[],
          rowCount: result.rowCount ?? undefined,
        };
      },
      close: async () => { await pool.end(); },
    };
  } catch {
    // Fall through
  }

  // Method 2: postgres.js library (lighter)
  try {
    const { default: Postgres } = await import("postgres");
    const sql = Postgres({
      host,
      port,
      username: user,
      password,
      database,
      max: 3,
      idle_timeout: 10,
      connect_timeout: 5,
    });

    return {
      query: async (q: string, params?: unknown[]) => {
        const result = params ? await sql.unsafe(q, params) : await sql.unsafe(q);
        return {
          rows: Array.isArray(result) ? result : [{ result }],
          rowCount: Array.isArray(result) ? result.length : 1,
        };
      },
      close: async () => { await sql.end(); },
    };
  } catch {
    // Fall through
  }

  throw new Error(
    "No PostgreSQL client available. Install 'pg' or 'postgres': bun add -d pg",
  );
}

// ============================================================================
// Test database lifecycle helpers
// ============================================================================

/**
 * Setup a test database: create tables and seed data.
 */
export async function setupTestDatabase(
  db: DBConnection,
): Promise<void> {
  // Create users table
  await db.query(`
    CREATE TABLE IF NOT EXISTS asijs_test_users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      role VARCHAR(50) DEFAULT 'user',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create posts table (references users)
  await db.query(`
    CREATE TABLE IF NOT EXISTS asijs_test_posts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES asijs_test_users(id),
      title VARCHAR(255) NOT NULL,
      content TEXT,
      published BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create files/metadata table (for upload tests)
  await db.query(`
    CREATE TABLE IF NOT EXISTS asijs_test_files (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) NOT NULL,
      mime_type VARCHAR(100),
      size_bytes BIGINT,
      storage_path VARCHAR(500),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

/**
 * Seed test data into the database.
 */
export async function seedTestData(
  db: DBConnection,
): Promise<{ userId: number; postId: number }> {
  // Insert test user
  const userResult = await db.query(
    `INSERT INTO asijs_test_users (name, email, role) VALUES ($1, $2, $3) RETURNING id`,
    ["Test User", "test@asijs.dev", "admin"],
  );

  const userId = Number((userResult.rows[0] as any)?.id || 1);

  // Insert test post
  const postResult = await db.query(
    `INSERT INTO asijs_test_posts (user_id, title, content, published) VALUES ($1, $2, $3, $4) RETURNING id`,
    [userId, "Test Post", "This is test content", true],
  );

  const postId = Number((postResult.rows[0] as any)?.id || 1);

  return { userId, postId };
}

/**
 * Tear down test data.
 */
export async function teardownTestDatabase(
  db: DBConnection,
): Promise<void> {
  await db.query("DROP TABLE IF EXISTS asijs_test_posts");
  await db.query("DROP TABLE IF EXISTS asijs_test_files");
  await db.query("DROP TABLE IF EXISTS asijs_test_users");
}
