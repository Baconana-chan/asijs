/**
 * P1 API-Case Benchmarks
 *
 * Targeted scenarios for common API workloads:
 * 1. Query Cache (2.2.6) — repeated query strings (cache hit) vs unique (miss)
 * 2. 404 Fast Path — no route match (missing-route lookup cost)
 * 3. Error Path — handler throws (error handling + response cost)
 * 4. Large JSON Bodies — 10KB / 100KB with validation
 *
 * Run: bun run bench:p1
 * Output is parsed by bench/collect.ts (groups via 📊 headers).
 *
 * Note on the query cache: the default query cache is a module-level
 * singleton, and `queryCache: false` disables it globally. Order matters —
 * hit/miss benches run on the cached app FIRST, then we create the
 * `queryCache: false` app and re-enable via resetDefaultQueryCache().
 */

import { Asi, Type, resetDefaultQueryCache } from "../src";
import { Elysia, t } from "elysia";
import { Hono } from "hono";

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

/** Sequential runner. `expectedStatus` lets the 404/error-path scenarios be clean. */
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

// ========== 1. Query Cache (2.2.6): hit vs miss ==========

// Realistic filter/pagination query — enough pairs that parsing cost is visible
const FIXED_QUERY =
  "q=hello&limit=10&page=1&sort=asc&status=active&category=books&price=gt:10&tags=a,b,c";

/** AsiJS app that reads ctx.query (triggers lazy query parsing). */
function createAsiQueryApp(queryCache?: boolean) {
  const app = new Asi({ development: false, queryCache });
  app.get("/search", (ctx) => ({ q: ctx.query.q, limit: ctx.query.limit }));
  app.compile();
  return app;
}

function createElysiaQueryApp() {
  return new Elysia().get("/search", ({ query }) => ({
    q: query.q,
    limit: query.limit,
  }));
}

function createHonoQueryApp() {
  const app = new Hono();
  app.get("/search", (c) => c.json({ q: c.req.query("q"), limit: c.req.query("limit") }));
  return app;
}

async function benchQueryCache() {
  // IMPORTANT: the query cache is a module-level singleton and
  // `queryCache: false` disables it GLOBALLY. Create the cached app first,
  // run hit/miss, and only then create the disabled app.
  const asiCached = createAsiQueryApp();
  const elysia = createElysiaQueryApp();
  const hono = createHonoQueryApp();

  const fixedReq: RequestFactory = () =>
    new Request(`http://localhost/search?${FIXED_QUERY}`);

  // --- Hit: the same query string every time (cache hit) ---
  const hit: BenchResult[] = [];
  hit.push(await runBench("AsiJS (cache on)", (r) => asiCached.handle(r), fixedReq));
  hit.push(await runBench("Elysia", (r) => elysia.handle(r), fixedReq));
  hit.push(await runBench("Hono", (r) => hono.fetch(r), fixedReq));
  printResults("Query Cache (repeated query — hit)", hit);

  // --- Miss: a unique query string per request (cache miss) ---
  let counter = 0;
  const uniqueReq: RequestFactory = () => {
    counter++;
    return new Request(
      `http://localhost/search?q=value${counter}&limit=10&page=1&sort=asc&status=active&category=books&price=gt:10&tags=a,b,c`,
    );
  };
  const miss: BenchResult[] = [];
  miss.push(await runBench("AsiJS (cache on)", (r) => asiCached.handle(r), uniqueReq));
  miss.push(await runBench("Elysia", (r) => elysia.handle(r), uniqueReq));
  miss.push(await runBench("Hono", (r) => hono.fetch(r), uniqueReq));
  printResults("Query Cache (unique query — miss)", miss);

  // --- Disabled: queryCache: false, repeated query (cache overhead) ---
  // Create AFTER hit/miss — disables the shared cache globally, but the
  // earlier benches are already done. resetDefaultQueryCache() restores it
  // for any later use in the same process.
  const asiNoCache = createAsiQueryApp(false);
  const disabled: BenchResult[] = [];
  disabled.push(await runBench("AsiJS (queryCache: false)", (r) => asiNoCache.handle(r), fixedReq));
  printResults("Query Cache (disabled — repeated query)", disabled);
  resetDefaultQueryCache();
}

// ========== 2. 404 Fast Path ==========

function createAsi404App() {
  const app = new Asi({ development: false });
  app.get("/exists", () => ({ ok: true }));
  app.compile();
  return app;
}

async function bench404() {
  const asiApp = createAsi404App();
  const elysia = new Elysia().get("/exists", () => ({ ok: true }));
  const hono = new Hono();
  hono.get("/exists", (c) => c.json({ ok: true }));

  const missingReq: RequestFactory = () =>
    new Request("http://localhost/definitely-missing-route");

  const results: BenchResult[] = [];
  results.push(await runBench("AsiJS", (r) => asiApp.handle(r), missingReq, ITERATIONS, 404));
  results.push(await runBench("Elysia", (r) => elysia.handle(r), missingReq, ITERATIONS, 404));
  results.push(await runBench("Hono", (r) => hono.fetch(r), missingReq, ITERATIONS, 404));
  printResults("404 Fast Path (no route match)", results);
}

// ========== 3. Error Path (handler throws) ==========

function createAsiErrorApp() {
  // silent: true — do not log the intentional throw during the bench
  const app = new Asi({ development: false, silent: true });
  app.get("/boom", () => {
    throw new Error("boom");
  });
  app.compile();
  return app;
}

async function benchErrorPath() {
  const asiApp = createAsiErrorApp();
  const elysia = new Elysia()
    .onError(({ error, set }: any) => {
      set.status = 500;
      return { error: String(error) };
    })
    .get("/boom", () => {
      throw new Error("boom");
    });
  const hono = new Hono();
  hono.onError((err, c) => c.json({ error: err.message }, 500));
  hono.get("/boom", () => {
    throw new Error("boom");
  });

  const boomReq: RequestFactory = () => new Request("http://localhost/boom");

  const results: BenchResult[] = [];
  results.push(await runBench("AsiJS", (r) => asiApp.handle(r), boomReq, ITERATIONS, 500));
  results.push(await runBench("Elysia", (r) => elysia.handle(r), boomReq, ITERATIONS, 500));
  results.push(await runBench("Hono", (r) => hono.fetch(r), boomReq, ITERATIONS, 500));
  printResults("Error Path (handler throws → 500)", results);
}

// ========== 4. Large JSON Bodies ==========

const itemSchema = Type.Object({
  id: Type.Number(),
  name: Type.String(),
  email: Type.String(),
  role: Type.String(),
  active: Type.Boolean(),
});
const itemsArraySchema = Type.Array(itemSchema);

/** Build a JSON body of roughly `targetBytes` from an array of objects. */
function buildLargeBody(targetBytes: number): string {
  const items: any[] = [];
  let size = 0;
  let i = 0;
  while (size < targetBytes) {
    const item = {
      id: i,
      name: `User ${i}`,
      email: `user${i}@example.com`,
      role: i % 3 === 0 ? "admin" : "member",
      active: i % 2 === 0,
    };
    size += JSON.stringify(item).length + 1;
    items.push(item);
    i++;
  }
  return JSON.stringify(items);
}

const BODY_10KB = buildLargeBody(10 * 1024);
const BODY_100KB = buildLargeBody(100 * 1024);

function createAsiBodyApp() {
  const app = new Asi({ development: false });
  app.post(
    "/data",
    (ctx: any) => ({ ok: true, count: ctx.body.length }),
    { schema: { body: itemsArraySchema } },
  );
  app.compile();
  return app;
}

function createElysiaBodyApp() {
  return new Elysia().post(
    "/data",
    ({ body }: any) => ({ ok: true, count: body.length }),
    {
      body: t.Array(
        t.Object({
          id: t.Number(),
          name: t.String(),
          email: t.String(),
          role: t.String(),
          active: t.Boolean(),
        }),
      ),
    },
  );
}

async function benchLargeBodies() {
  const asiApp = createAsiBodyApp();
  const elysiaApp = createElysiaBodyApp();

  for (const [label, body, iters] of [
    ["10KB", BODY_10KB, Math.max(1000, Math.floor(ITERATIONS / 2))],
    ["100KB", BODY_100KB, Math.max(200, Math.floor(ITERATIONS / 6))],
  ] as const) {
    const createReq: RequestFactory = () =>
      new Request("http://localhost/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
    const results: BenchResult[] = [];
    results.push(await runBench("AsiJS (compiled+val)", (r) => asiApp.handle(r), createReq, iters));
    results.push(await runBench("Elysia (+validation)", (r) => elysiaApp.handle(r), createReq, iters));
    printResults(`Large JSON Body (${label}, validated)`, results);
  }
}

// ========== Main ==========

async function main() {
  console.log("🏃 AsiJS P1 API-Case Benchmarks");
  console.log(`   Iterations: ${ITERATIONS.toLocaleString()}  Warmup: ${WARMUP.toLocaleString()}`);
  console.log("═".repeat(70));

  await benchQueryCache();
  await bench404();
  await benchErrorPath();
  await benchLargeBodies();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
