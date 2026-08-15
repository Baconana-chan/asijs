/**
 * Isolated allocation measurement (run as a subprocess).
 *
 * Each scenario runs in its own process: warmup → GC → baseline RSS →
 * N requests → RSS. Because the process exits after one scenario, RSS
 * growth is not contaminated by earlier scenarios (Bun never returns
 * freed pages to the OS, so sequential in-process measurements would
 * under-report later scenarios).
 *
 * Prints a single JSON line: { "name": ..., "bytesPerReq": N }
 *
 * Run by bench/p2.ts via Bun.spawnSync. Not part of the collector.
 */

import { Asi } from "../src";

const SCENARIO = process.env.ALLOC_SCENARIO || "bare";
const ITERATIONS = parseInt(process.env.ALLOC_ITERATIONS || "20000", 10);
const WARMUP = parseInt(process.env.ALLOC_WARMUP || "2000", 10);

function buildApp() {
  const app = new Asi({ development: false });
  if (SCENARIO === "mw") {
    app.use(async (ctx, next) => {
      ctx.store as unknown;
      return next();
    });
    app.use(async (ctx, next) => {
      ctx.header("x-trace", "1");
      return next();
    });
  }
  app.get("/", () => ({ message: "Hello" }));
  app.compile();
  return app;
}

const app = buildApp();
const createReq = () => new Request("http://localhost/");

// Warmup (JIT + context pool pre-allocation)
for (let i = 0; i < WARMUP; i++) {
  app.handle(createReq());
}

// GC + settle, then baseline RSS
for (let i = 0; i < 3; i++) {
  Bun.gc(true);
  await new Promise((r) => setTimeout(r, 5));
}
const base = process.memoryUsage().rss;

// Measured run
for (let i = 0; i < ITERATIONS; i++) {
  app.handle(createReq());
}

Bun.gc(true);
const end = process.memoryUsage().rss;
const bytesPerReq = Math.max(0, Math.round((end - base) / ITERATIONS));

console.log(JSON.stringify({ name: SCENARIO, bytesPerReq }));
process.exit(0);
