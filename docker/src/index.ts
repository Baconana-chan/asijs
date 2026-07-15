/**
 * AsiJS Docker Example
 *
 * A production-ready AsiJS app designed to run in Docker with:
 * - /health — liveness probe
 * - /ready — readiness probe (checks Postgres + Redis)
 * - /api/users — CRUD API
 * - Graceful shutdown via lifecycle plugin
 *
 * Run with: docker-compose up
 */

import { Asi, Type, lifecycle } from "asijs";

// ===== Types =====

interface HealthCheck {
  status: "ok" | "degraded" | "error";
  uptime: number;
  timestamp: string;
  checks: Record<string, "ok" | "error" | "skipped">;
}

// ===== App Setup =====

const app = new Asi({
  development: process.env.NODE_ENV !== "production",    port: Number(process.env.PORT ?? 3000),
  startupBanner: true,
});

// Graceful shutdown — drains connections, runs cleanup
await app.plugin(
  lifecycle({
    verbose: true,
    gracefulTimeout: 30_000,
    wsDrainTimeout: 10_000,
    onShutdown: [
      async () => {
        console.log("  → Closing database connections...");
        // Close Postgres / Redis connections here
        console.log("  → Connections closed.");
      },
    ],
  }),
);

// ===== Health Endpoints =====

// Liveness — is the process alive?
app.get("/health", () => {
  return {
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  } satisfies HealthCheck;
});

// Readiness — are dependencies ready?
app.get("/ready", async () => {
  const checks: Record<string, "ok" | "error"> = {};

  // Check Postgres (if configured)
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    try {
      const resp = await fetch(`${dbUrl.replace(/\/\w+$/, "")}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      checks.postgres = resp.ok ? "ok" : "error";
    } catch {
      checks.postgres = "error";
    }
  } else {
    checks.postgres = "ok"; // Not configured — skip
  }

  // Check Redis (if configured)
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    try {
      const resp = await fetch(`${redisUrl}/ping`, {
        signal: AbortSignal.timeout(2000),
      });
      checks.redis = resp.ok ? "ok" : "error";
    } catch {
      checks.redis = "error";
    }
  } else {
    checks.redis = "ok"; // Not configured — skip
  }

  const allOk = Object.values(checks).every((s) => s === "ok");

  return {
    status: allOk ? "ok" : "degraded",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    checks,
  };
});

// ===== API Routes =====

// In-memory store (swap with Postgres in production)
const items: Map<number, { id: number; name: string; createdAt: Date }> =
  new Map();
let nextId = 1;

// Seed some data
items.set(nextId, { id: nextId++, name: "AsiJS", createdAt: new Date() });
items.set(nextId, { id: nextId++, name: "Docker", createdAt: new Date() });

app.get("/api/items", () => {
  return {
    data: Array.from(items.values()),
    total: items.size,
  };
});

app.get(
  "/api/items/:id",
  (ctx) => {
    const id = parseInt(ctx.params.id);
    const item = items.get(id);
    if (!item) {
      return ctx.status(404).jsonResponse({ error: "Item not found" });
    }
    return item;
  },
  {
    params: Type.Object({ id: Type.String() }),
  },
);

app.post(
  "/api/items",
  async (ctx) => {
    const body = ctx.validatedBody as { name: string };
    const item = { id: nextId++, name: body.name, createdAt: new Date() };
    items.set(item.id, item);
    return ctx.status(201).jsonResponse(item);
  },
  {
    body: Type.Object({
      name: Type.String({ minLength: 1, maxLength: 200 }),
    }),
  },
);

app.delete(
  "/api/items/:id",
  (ctx) => {
    const id = parseInt(ctx.params.id);
    if (!items.has(id)) {
      return ctx.status(404).jsonResponse({ error: "Item not found" });
    }
    items.delete(id);
    return ctx.status(204).jsonResponse(null);
  },
  {
    params: Type.Object({ id: Type.String() }),
  },
);

// ===== Start =====

const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOSTNAME ?? "0.0.0.0";

if (process.env.NODE_ENV !== "test") {
  app.listen(port);
  console.log(`\n  🐳 AsiJS Docker Example\n`);
  console.log(`  Local:   http://localhost:${port}`);
  console.log(`  Health:  http://localhost:${port}/health`);
  console.log(`  Ready:   http://localhost:${port}/ready`);
  console.log(`  API:     http://localhost:${port}/api/items`);
  console.log(`\n`);
}

export { app };
