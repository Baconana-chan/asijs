/**
 * P2 Feature Benchmarks
 *
 * Scenarios for features that had no micro-benchmarks at all:
 * 1. WebSocket Pub/Sub — broadcast throughput to N clients via RoomManager
 * 2. Cache Layer — MemoryCache ops, ETag/304 fast-path, response cache hit/miss
 * 3. Database Layer (2.3) — sqlite in-memory CRUD + transactions
 * 4. Allocations — heap growth per request (bare GET vs middleware chain)
 *
 * Run: bun run bench:p2
 * Output is parsed by bench/collect.ts (groups via 📊 headers).
 *
 * Units: throughput groups print `ops/s (Xms)`; allocation groups print
 * `bytes/req`. The collector regex accepts both.
 */

import { Asi, MemoryCache, etag, responseCacheMiddleware } from "../src";
import { Database } from "../src/db/database";
import { createRoomManager } from "../src/ws-pubsub";

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

/** Sequential throughput runner. Prints `ops/s (Xms)`. */
async function runBench(
  name: string,
  fn: (i: number) => Promise<unknown> | unknown,
  iterations: number = ITERATIONS,
): Promise<BenchResult> {
  let errors = 0;
  for (let i = 0; i < WARMUP; i++) {
    try {
      await fn(i);
    } catch {
      errors++;
    }
  }
  if (errors > 0) console.error(`⚠️  ${name}: ${errors}/${WARMUP} warmup failures`);
  errors = 0;
  if (typeof Bun !== "undefined" && Bun.gc) Bun.gc(true);

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    try {
      await fn(i);
    } catch {
      errors++;
    }
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

/** HTTP request runner (kept for the cache scenarios that go through Asi). */
async function runHttpBench(
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

/**
 * Allocation measurement — runs the scenario in an isolated subprocess so
 * RSS growth is not contaminated by earlier scenarios (Bun never returns
 * freed pages to the OS). Returns bytes/req as the `rps` field.
 */
function runAllocBench(name: string, scenario: string, iterations: number): BenchResult {
  // `bun run` can hang when spawned from inside another bun process —
  // invoke the file directly.
  const proc = Bun.spawnSync(["bun", "p2-alloc.ts"], {
    cwd: __dirname,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ALLOC_SCENARIO: scenario,
      ALLOC_ITERATIONS: String(iterations),
      ALLOC_WARMUP: String(Math.min(WARMUP, 2000)),
    },
  });
  if (!proc.success) {
    throw new Error(`alloc subprocess failed (${scenario}): ${proc.stderr.toString()}`);
  }
  const parsed = JSON.parse(proc.stdout.toString().trim().split("\n").pop()!);
  return {
    name,
    rps: parsed.bytesPerReq,
    avgMs: 0,
    totalMs: 0,
    errors: 0,
  };
}

function printResults(testName: string, results: BenchResult[], unit: "ops" | "bytes" = "ops") {
  console.log(`\n📊 ${testName}`);
  console.log("─".repeat(70));
  for (const r of results) {
    if (r.errors > 0) console.error(`   ⚠️  ${r.name}: ${r.errors} errors!`);
  }
  // For bytes/req lower is better — sort ascending; otherwise descending
  results.sort((a, b) => (unit === "bytes" ? a.rps - b.rps : b.rps - a.rps));
  const best = unit === "bytes" ? results[results.length - 1].rps : results[0].rps;
  for (const r of results) {
    const percent = ((r.rps / best) * 100).toFixed(1);
    const bar = "█".repeat(Math.round(Number(percent) / 5));
    const errMark = r.errors > 0 ? " ⚠️" : "";
    if (unit === "bytes") {
      console.log(
        `${r.name.padEnd(25)} ${r.rps.toLocaleString("en-US").padStart(10)} bytes/req ` +
          `(${r.avgMs.toFixed(4)}ms) ${bar} ${percent}%${errMark}`,
      );
    } else {
      console.log(
        `${r.name.padEnd(25)} ${r.rps.toLocaleString("en-US").padStart(10)} ops/s ` +
          `(${r.avgMs.toFixed(4)}ms) ${bar} ${percent}%${errMark}`,
      );
    }
  }
}

// ========== 1. WebSocket Pub/Sub (RoomManager) ==========

function makeMockWs() {
  return { readyState: 1, send: (_p: string) => {} };
}

async function benchWebSocket() {
  const manager = createRoomManager({ presence: false });

  // 1 client in a room — broadcast round-trip
  for (const clients of [1, 10, 100]) {
    const room = `room-${clients}`;
    const wss: any[] = [];
    for (let i = 0; i < clients; i++) {
      const ws = makeMockWs();
      manager.join(ws, room);
      wss.push(ws);
    }
    // Make broadcasts visible: count sends
    let sends = 0;
    for (const ws of wss) ws.send = () => sends++;

    const results: BenchResult[] = [];
    results.push(
      await runBench(
        `broadcast (${clients} clients)`,
        () => {
          manager.broadcast({ type: "msg", text: "hello" }, { rooms: [room] });
          return undefined;
        },
        ITERATIONS,
      ),
    );
    printResults(`WebSocket Pub/Sub — broadcast to ${clients} client(s)`, results);
  }
}

// ========== 2. Cache Layer ==========

async function benchCache() {
  // --- MemoryCache set/get/delete ---
  const cache = new MemoryCache();
  const key = "k";
  const val = { data: [1, 2, 3, 4, 5], ok: true };

  const setRes = await runBench("MemoryCache.set", () => {
    cache.set(key, val, "10m");
    return undefined;
  });
  const getRes = await runBench("MemoryCache.get", () => {
    const v = cache.get(key);
    if (!v) throw new Error("miss");
    return undefined;
  });
  printResults("MemoryCache — set/get ops", [setRes, getRes]);

  // --- ETag / 304 through an Asi app ---
  const app = new Asi({ development: false });
  app.use(etag());
  app.get("/data", () => ({ message: "Hello", list: [1, 2, 3] }));
  app.compile();

  // Get the real ETag once, then replay it (304 path)
  const first = await app.handle(new Request("http://localhost/data"));
  const etagValue = first.headers.get("ETag")!;

  const plainReq: RequestFactory = () => new Request("http://localhost/data");
  const notModifiedReq: RequestFactory = () =>
    new Request("http://localhost/data", {
      headers: { "If-None-Match": etagValue },
    });

  const etag200 = await runHttpBench("ETag gen (200)", (r) => app.handle(r), plainReq);
  const etag304 = await runHttpBench(
    "ETag match (304)",
    (r) => app.handle(r),
    notModifiedReq,
    ITERATIONS,
    304,
  );
  printResults("ETag middleware — 200 vs 304 fast-path", [etag200, etag304]);

  // --- Response cache: hit vs miss ---
  const hitApp = new Asi({ development: false });
  hitApp.use(responseCacheMiddleware({ ttl: "10m" }));
  hitApp.get("/data", () => ({ message: "Hello" }));
  hitApp.compile();
  // Prime the cache
  await hitApp.handle(new Request("http://localhost/data"));

  const sameReq: RequestFactory = () => new Request("http://localhost/data");
  const hitRes = await runHttpBench("response cache (HIT)", (r) => hitApp.handle(r), sameReq);

  // Miss path — unique URL each time (fresh store, no priming)
  const missApp = new Asi({ development: false });
  missApp.use(responseCacheMiddleware({ ttl: "10m" }));
  missApp.get("/data", () => ({ message: "Hello" }));
  missApp.compile();
  let counter = 0;
  const uniqueReq: RequestFactory = () =>
    new Request(`http://localhost/data?v=${counter++}`);
  const missRes = await runHttpBench("response cache (MISS)", (r) => missApp.handle(r), uniqueReq);
  printResults("Response cache middleware — HIT vs MISS", [hitRes, missRes]);
}

// ========== 3. Database Layer (2.3, sqlite in-memory) ==========

async function benchDatabase() {
  const db = new Database({ url: ":memory:" });
  db.exec(
    "CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT, age INTEGER)",
  );

  const insertRes = await runBench("insert (single row)", () => {
    db.execute("INSERT INTO users (name, email, age) VALUES (?, ?, ?)", [
      "Alice",
      "alice@example.com",
      30,
    ]);
    return undefined;
  });

  // Seed a row for reads/updates/deletes
  db.execute("INSERT INTO users (name, email, age) VALUES (?, ?, ?)", [
    "Bob",
    "bob@example.com",
    25,
  ]);

  const selectRes = await runBench("select by id", () => {
    const rows = db.query("SELECT * FROM users WHERE id = ?", [1]);
    if (rows.length === 0) throw new Error("no row");
    return undefined;
  });

  const updateRes = await runBench("update row", () => {
    db.execute("UPDATE users SET age = ? WHERE id = ?", [26, 1]);
    return undefined;
  });

  const transactionRes = await runBench("transaction (3 stmts)", () => {
    db.transaction(() => {
      db.execute("INSERT INTO users (name, email, age) VALUES (?, ?, ?)", ["C", "c@x.com", 1]);
      db.execute("UPDATE users SET age = ? WHERE id = 1", [27]);
      db.execute("DELETE FROM users WHERE name = ?", ["C"]);
    });
    return undefined;
  });

  const deleteRes = await runBench("delete row", () => {
    db.execute("DELETE FROM users WHERE id = ?", [1]);
    return undefined;
  });

  db.close();
  printResults("Database Layer (sqlite in-memory) — CRUD ops", [
    insertRes,
    selectRes,
    updateRes,
    deleteRes,
    transactionRes,
  ]);
}

// ========== 4. Allocations (heap growth per request) ==========

async function benchAllocations() {
  const iters = Math.max(5000, ITERATIONS);

  const results: BenchResult[] = [];
  results.push(runAllocBench("bare GET", "bare", iters));
  results.push(runAllocBench("GET + 2 middleware", "mw", iters));
  printResults("Allocations — RSS growth per request (lower = better)", results, "bytes");
}

// ========== Main ==========

async function main() {
  console.log("🏃 AsiJS P2 Feature Benchmarks");
  console.log(`   Iterations: ${ITERATIONS.toLocaleString()}  Warmup: ${WARMUP.toLocaleString()}`);
  console.log("═".repeat(70));

  await benchWebSocket();
  await benchCache();
  await benchDatabase();
  await benchAllocations();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
