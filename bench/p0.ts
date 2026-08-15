/**
 * P0 Hot-Path Benchmarks
 *
 * Targeted scenarios for the 2.2 performance work:
 * 1. Concurrency — throughput with N in-flight requests (context pool relevance)
 * 2. Route Table Scaling — radix vs trie at 10/100/1000/10000 routes
 * 3. Static File Serving — preload (in-memory) vs disk
 * 4. Validation — array of 100 items + error path (invalid payload)
 *
 * Run: bun run bench:p0
 * Output is parsed by bench/collect.ts (groups via 📊 headers).
 */

import { Asi, Type } from "../src";
import { staticFiles } from "../src/plugins/static";
import { Elysia, t } from "elysia";
import { Hono } from "hono";
import { writeFileSync, rmSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const ITERATIONS = parseInt(process.env.BENCH_ITERATIONS || "10000", 10);
const WARMUP = parseInt(process.env.BENCH_WARMUP || "1000", 10);

interface BenchResult {
  name: string;
  rps: number;
  avgMs: number;
  totalMs: number;
  errors: number;
}

type RequestFactory = () => Request;

/** Sequential runner. `expectedStatus` lets the error-path scenario be clean. */
async function runBench(
  name: string,
  handler: (req: Request) => Promise<Response>,
  createRequest: RequestFactory,
  iterations: number = ITERATIONS,
  expectedStatus: number = 200,
): Promise<BenchResult> {
  let errors = 0;
  for (let i = 0; i < WARMUP; i++) {
    const response = await handler(createRequest());
    if (response.status !== expectedStatus) errors++;
  }
  if (errors > 0) console.error(`⚠️  ${name}: ${errors}/${WARMUP} warmup failures`);
  errors = 0;
  if (typeof Bun !== "undefined" && Bun.gc) Bun.gc(true);

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const response = await handler(createRequest());
    if (response.status !== expectedStatus) errors++;
  }
  const totalMs = performance.now() - start;
  return {
    name,
    rps: Math.round(iterations / (totalMs / 1000)),
    avgMs: totalMs / iterations,
    totalMs,
    errors,
  };
}

/** Concurrent runner — processes requests in batches of `concurrency`. */
async function runConcurrentBench(
  name: string,
  handler: (req: Request) => Promise<Response>,
  createRequest: RequestFactory,
  concurrency: number,
  iterations: number = ITERATIONS,
): Promise<BenchResult> {
  let errors = 0;
  for (let i = 0; i < Math.min(WARMUP, 300); i++) {
    const response = await handler(createRequest());
    if (response.status !== 200) errors++;
  }
  // One warmup batch at the target concurrency
  {
    const chunk = Math.min(concurrency, 200);
    const reqs = Array.from({ length: chunk }, createRequest);
    const responses = await Promise.all(reqs.map((r) => handler(r)));
    for (const res of responses) if (res.status !== 200) errors++;
  }
  if (errors > 0) console.error(`⚠️  ${name}: ${errors} warmup failures`);
  errors = 0;
  if (typeof Bun !== "undefined" && Bun.gc) Bun.gc(true);

  const start = performance.now();
  for (let i = 0; i < iterations; i += concurrency) {
    const chunk = Math.min(concurrency, iterations - i);
    const reqs = Array.from({ length: chunk }, createRequest);
    const responses = await Promise.all(reqs.map((r) => handler(r)));
    for (const res of responses) if (res.status !== 200) errors++;
  }
  const totalMs = performance.now() - start;
  return {
    name,
    rps: Math.round(iterations / (totalMs / 1000)),
    avgMs: totalMs / iterations,
    totalMs,
    errors,
  };
}

function printResults(testName: string, results: BenchResult[]) {
  console.log(`\n📊 ${testName}`);
  console.log("─".repeat(70));
  for (const r of results) {
    if (r.errors > 0) console.error(`   ⚠️  ${r.name}: ${r.errors} errors!`);
  }
  results.sort((a, b) => b.rps - a.rps);
  const best = results[0].rps;
  for (const r of results) {
    const percent = ((r.rps / best) * 100).toFixed(1);
    const bar = "█".repeat(Math.round(Number(percent) / 5));
    const errMark = r.errors > 0 ? " ⚠️" : "";
    console.log(
      `${r.name.padEnd(25)} ${r.rps.toLocaleString("en-US").padStart(10)} req/s ` +
        `(${r.avgMs.toFixed(4)}ms) ${bar} ${percent}%${errMark}`,
    );
  }
}

// ========== 1. Concurrency ==========

function createSimpleAsiApp() {
  const app = new Asi({ development: false });
  app.get("/", () => ({ message: "Hello" }));
  return app;
}
function createSimpleElysiaApp() {
  return new Elysia().get("/", () => ({ message: "Hello" }));
}
function createSimpleHonoApp() {
  const app = new Hono();
  app.get("/", (c) => c.json({ message: "Hello" }));
  return app;
}

async function benchConcurrency() {
  const asiApp = createSimpleAsiApp();
  const elysiaApp = createSimpleElysiaApp();
  const honoApp = createSimpleHonoApp();
  const createReq: RequestFactory = () => new Request("http://localhost/");

  for (const c of [10, 100, 1000]) {
    const results: BenchResult[] = [];
    results.push(await runConcurrentBench("AsiJS", (r) => asiApp.handle(r), createReq, c));
    results.push(await runConcurrentBench("Elysia", (r) => elysiaApp.handle(r), createReq, c));
    results.push(await runConcurrentBench("Hono", (r) => honoApp.fetch(r), createReq, c));
    printResults(`Concurrency (C=${c} in-flight)`, results);
  }
}

// ========== 2. Route Table Scaling ==========

async function benchRouteScaling() {
  for (const n of [10, 100, 1000, 10000]) {
    const radixApp = new Asi({ development: false });
    const trieApp = new Asi({ development: false, router: "trie" });
    for (let i = 0; i < n; i++) {
      const p = `/r${i}`;
      const body = { i };
      radixApp.get(p, () => body);
      trieApp.get(p, () => body);
    }
    // Worst-case lookup position — the last registered route
    const lastPath = `/r${n - 1}`;
    const createReq: RequestFactory = () => new Request(`http://localhost${lastPath}`);
    const iters =
      n <= 100
        ? ITERATIONS
        : n <= 1000
          ? Math.max(2000, Math.floor(ITERATIONS / 2))
          : Math.max(1000, Math.floor(ITERATIONS / 4));

    const results: BenchResult[] = [];
    results.push(await runBench(`radix (N=${n})`, (r) => radixApp.handle(r), createReq, iters));
    results.push(await runBench(`trie  (N=${n})`, (r) => trieApp.handle(r), createReq, iters));
    printResults(`Route Table Scaling (N=${n})`, results);
  }
}

// ========== 3. Static File Serving (preload vs disk) ==========

async function benchStaticPreload() {
  const dir = mkdtempSync(join(tmpdir(), "asi-p0-static-"));
  writeFileSync(join(dir, "index.html"), "<h1>Hello AsiJS</h1>".repeat(64));

  const diskApp = new Asi({ development: false });
  diskApp.use(staticFiles(dir, { prefix: "/static" }));
  diskApp.compile();

  const preloadApp = new Asi({ development: false });
  preloadApp.use(staticFiles(dir, { prefix: "/static", preload: true }));
  preloadApp.compile();

  const createReq: RequestFactory = () =>
    new Request("http://localhost/static/index.html");
  const iters = Math.max(2000, Math.floor(ITERATIONS / 2));

  const results: BenchResult[] = [];
  try {
    results.push(await runBench("AsiJS (disk)", (r) => diskApp.handle(r), createReq, iters));
    results.push(await runBench("AsiJS (preload)", (r) => preloadApp.handle(r), createReq, iters));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  printResults("Static File Serving (preload vs disk)", results);
}

// ========== 4. Validation: arrays + error path ==========

const userSchema = Type.Object({
  id: Type.Number(),
  name: Type.String(),
  email: Type.String(),
});
const userArraySchema = Type.Array(userSchema);

const VALID_ARRAY_BODY = JSON.stringify(
  Array.from({ length: 100 }, (_, i) => ({
    id: i,
    name: `User ${i}`,
    email: `user${i}@example.com`,
  })),
);
const INVALID_ARRAY_BODY = JSON.stringify(
  Array.from({ length: 100 }, (_, i) => ({
    id: `not-a-number-${i}`,
    name: `User ${i}`,
    email: `user${i}@example.com`,
  })),
);

function createArrayValAsiApp() {
  const app = new Asi({ development: false });
  app.post(
    "/users",
    (ctx: any) => ({ ok: true, count: ctx.body.length }),
    { schema: { body: userArraySchema } },
  );
  app.compile();
  return app;
}
function createArrayValElysiaApp() {
  return new Elysia().post(
    "/users",
    ({ body }: any) => ({ ok: true, count: body.length }),
    {
      body: t.Array(
        t.Object({ id: t.Number(), name: t.String(), email: t.String() }),
      ),
    },
  );
}

async function benchArrayValidation() {
  const asiApp = createArrayValAsiApp();
  const elysiaApp = createArrayValElysiaApp();
  const validReq: RequestFactory = () =>
    new Request("http://localhost/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: VALID_ARRAY_BODY,
    });
  const invalidReq: RequestFactory = () =>
    new Request("http://localhost/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: INVALID_ARRAY_BODY,
    });
  const iters = Math.max(1000, Math.floor(ITERATIONS / 2));

  const valid: BenchResult[] = [];
  valid.push(await runBench("AsiJS (array 100, valid)", (r) => asiApp.handle(r), validReq, iters));
  valid.push(await runBench("Elysia (array 100, valid)", (r) => elysiaApp.handle(r), validReq, iters));
  printResults("Array Validation (100 items, valid)", valid);

  const invalid: BenchResult[] = [];
  // AsiJS returns 400 for validation errors; Elysia defaults to 422
  invalid.push(await runBench("AsiJS (array 100, invalid)", (r) => asiApp.handle(r), invalidReq, iters, 400));
  invalid.push(await runBench("Elysia (array 100, invalid)", (r) => elysiaApp.handle(r), invalidReq, iters, 422));
  printResults("Validation Error Path (100-item array, invalid)", invalid);
}

// ========== Main ==========

async function main() {
  console.log("🏃 AsiJS P0 Hot-Path Benchmarks");
  console.log(`   Iterations: ${ITERATIONS.toLocaleString()}  Warmup: ${WARMUP.toLocaleString()}`);
  console.log("═".repeat(70));

  await benchConcurrency();
  await benchRouteScaling();
  await benchStaticPreload();
  await benchArrayValidation();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
