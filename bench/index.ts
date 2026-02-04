/**
 * Comprehensive benchmarks for AsiJS
 * Compare with raw Bun, Elysia, and Hono
 * 
 * Run: bun run bench
 * 
 * Fixes applied:
 * 1. Same iteration count for all tests (no ITERATIONS / 2)
 * 2. Fair body parsing: Elysia without schema also parses JSON explicitly
 * 3. Request factories instead of clone() to avoid ReadableStream overhead
 * 4. Response validation to ensure handlers work correctly
 */

import { Asi, Type } from "../src";
import { Elysia, t } from "elysia";
import { Hono } from "hono";

const ITERATIONS = 100_000;
const WARMUP = 5_000;

interface BenchResult {
  name: string;
  rps: number;
  avgMs: number;
  totalMs: number;
  errors: number;
}

// ========== Request Factories (avoid clone() overhead) ==========

const POST_BODY = JSON.stringify({ name: "Alice", age: 25 });

/** Factory: создаёт новый Request без clone() */
type RequestFactory = () => Request;

const createSimpleGetReq: RequestFactory = () => 
  new Request("http://localhost/");

const createParamGetReq: RequestFactory = () => 
  new Request("http://localhost/user/123");

const createQueryGetReq: RequestFactory = () => 
  new Request("http://localhost/search?q=hello&limit=10");

const createPostReq: RequestFactory = () => 
  new Request("http://localhost/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: POST_BODY,
  });

// ========== Frameworks Setup ==========

// --- AsiJS ---
function createAsiApp(compile = false) {
  const app = new Asi({ development: false });
  app.get("/", () => ({ message: "Hello" }));
  app.get("/user/:id", (ctx) => ({ id: ctx.params.id }));
  app.get("/search", (ctx) => ({ q: ctx.query.q, limit: ctx.query.limit }));
  app.post("/users", async (ctx) => {
    const body = await ctx.json();  // Явный парсинг
    return { created: true, user: body };
  });
  if (compile) app.compile();
  return app;
}

// --- AsiJS with validation ---
function createAsiValidatedApp(compile = false) {
  const app = new Asi({ development: false });
  app.get("/", () => ({ message: "Hello" }));
  app.get("/user/:id", (ctx) => ({ id: ctx.params.id }), {
    schema: { params: Type.Object({ id: Type.String() }) }
  });
  app.get("/search", (ctx) => ({ q: ctx.query.q, limit: ctx.query.limit }), {
    schema: {
      query: Type.Object({
        q: Type.String(),
        limit: Type.Number({ default: 10 }),
      })
    }
  });
  app.post("/users", (ctx) => ({ created: true, user: ctx.body }), {
    schema: {
      body: Type.Object({
        name: Type.String(),
        age: Type.Number(),
      })
    }
  });
  if (compile) app.compile();
  return app;
}

// --- Elysia (fair: explicit JSON parsing without schema) ---
function createElysiaApp() {
  const app = new Elysia()
    .get("/", () => ({ message: "Hello" }))
    .get("/user/:id", ({ params }) => ({ id: params.id }))
    .get("/search", ({ query }) => ({ q: query.q, limit: query.limit }))
    // ВАЖНО: без схемы Elysia не парсит body автоматически
    // Для честного сравнения используем явный парсинг
    .post("/users", async ({ request }) => {
      const body = await request.json();  // Явный парсинг как в AsiJS
      return { created: true, user: body };
    });
  return app;
}

// --- Elysia with validation (uses optimized internal parser) ---
function createElysiaValidatedApp() {
  const app = new Elysia()
    .get("/", () => ({ message: "Hello" }))
    .get("/user/:id", ({ params }) => ({ id: params.id }), {
      params: t.Object({ id: t.String() })
    })
    .get("/search", ({ query }) => ({ q: query.q, limit: query.limit }), {
      query: t.Object({
        q: t.String(),
        limit: t.Optional(t.Number({ default: 10 })),
      })
    })
    .post("/users", ({ body }) => ({ created: true, user: body }), {
      body: t.Object({
        name: t.String(),
        age: t.Number(),
      })
    });
  return app;
}

// --- Hono ---
function createHonoApp() {
  const app = new Hono();
  app.get("/", (c) => c.json({ message: "Hello" }));
  app.get("/user/:id", (c) => c.json({ id: c.req.param("id") }));
  app.get("/search", (c) => c.json({ q: c.req.query("q"), limit: c.req.query("limit") }));
  app.post("/users", async (c) => {
    const body = await c.req.json();  // Явный парсинг
    return c.json({ created: true, user: body });
  });
  return app;
}

// --- Raw Bun ---
function createRawBunHandler() {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/" && request.method === "GET") {
      return Response.json({ message: "Hello" });
    }
    
    if (path.startsWith("/user/") && request.method === "GET") {
      const id = path.split("/")[2];
      return Response.json({ id });
    }
    
    if (path === "/search" && request.method === "GET") {
      return Response.json({ 
        q: url.searchParams.get("q"), 
        limit: url.searchParams.get("limit") 
      });
    }
    
    if (path === "/users" && request.method === "POST") {
      const body = await request.json();  // Явный парсинг
      return Response.json({ created: true, user: body });
    }
    
    return new Response("Not Found", { status: 404 });
  };
}

// ========== Benchmark Runner ==========

async function runBench(
  name: string,
  handler: (req: Request) => Promise<Response>,
  createRequest: RequestFactory,
  iterations: number = ITERATIONS
): Promise<BenchResult> {
  let errors = 0;
  
  // Warmup + validation
  for (let i = 0; i < WARMUP; i++) {
    const response = await handler(createRequest());
    if (response.status !== 200) {
      errors++;
      if (errors === 1) {
        console.error(`❌ ${name}: First error - status ${response.status}`);
      }
    }
  }
  
  if (errors > 0) {
    console.error(`⚠️  ${name}: ${errors}/${WARMUP} errors during warmup`);
  }
  
  // Reset errors for actual benchmark
  errors = 0;
  
  // Force GC before benchmark (if available)
  if (typeof Bun !== "undefined" && Bun.gc) {
    Bun.gc(true);
  }
  
  // Benchmark
  const start = performance.now();
  
  for (let i = 0; i < iterations; i++) {
    const response = await handler(createRequest());
    if (response.status !== 200) {
      errors++;
    }
  }
  
  const totalMs = performance.now() - start;
  const avgMs = totalMs / iterations;
  const rps = Math.round(iterations / (totalMs / 1000));
  
  return { name, rps, avgMs, totalMs, errors };
}

function printResults(testName: string, results: BenchResult[]) {
  console.log(`\n📊 ${testName}`);
  console.log("─".repeat(70));
  
  // Check for errors
  for (const r of results) {
    if (r.errors > 0) {
      console.error(`   ⚠️  ${r.name}: ${r.errors} errors!`);
    }
  }
  
  // Sort by RPS descending
  results.sort((a, b) => b.rps - a.rps);
  const best = results[0].rps;
  
  for (const r of results) {
    const percent = ((r.rps / best) * 100).toFixed(1);
    const bar = "█".repeat(Math.round(Number(percent) / 5));
    const errMark = r.errors > 0 ? " ⚠️" : "";
    console.log(
      `${r.name.padEnd(25)} ${r.rps.toLocaleString().padStart(10)} req/s ` +
      `(${r.avgMs.toFixed(4)}ms) ${bar} ${percent}%${errMark}`
    );
  }
}

// ========== Main ==========

async function main() {
  console.log("🏃 AsiJS Benchmarks (Fair Edition)");
  console.log(`   Iterations: ${ITERATIONS.toLocaleString()}`);
  console.log(`   Warmup: ${WARMUP.toLocaleString()}`);
  console.log("═".repeat(70));

  // Create apps
  const asiApp = createAsiApp(false);
  const asiCompiledApp = createAsiApp(true);
  const asiValidatedApp = createAsiValidatedApp(false);
  const asiValidatedCompiledApp = createAsiValidatedApp(true);
  const elysiaApp = createElysiaApp();
  const elysiaValidatedApp = createElysiaValidatedApp();
  const honoApp = createHonoApp();
  const rawBunHandler = createRawBunHandler();

  // Test 1: Simple GET /
  {
    const results: BenchResult[] = [];
    results.push(await runBench("Raw Bun", rawBunHandler, createSimpleGetReq));
    results.push(await runBench("AsiJS", (r) => asiApp.handle(r), createSimpleGetReq));
    results.push(await runBench("AsiJS (compiled)", (r) => asiCompiledApp.handle(r), createSimpleGetReq));
    results.push(await runBench("Elysia", (r) => elysiaApp.handle(r), createSimpleGetReq));
    results.push(await runBench("Hono", (r) => honoApp.fetch(r), createSimpleGetReq));
    printResults("GET / (simple JSON)", results);
  }

  // Test 2: GET /user/:id (path params)
  {
    const results: BenchResult[] = [];
    results.push(await runBench("Raw Bun", rawBunHandler, createParamGetReq));
    results.push(await runBench("AsiJS", (r) => asiApp.handle(r), createParamGetReq));
    results.push(await runBench("AsiJS (compiled)", (r) => asiCompiledApp.handle(r), createParamGetReq));
    results.push(await runBench("Elysia", (r) => elysiaApp.handle(r), createParamGetReq));
    results.push(await runBench("Hono", (r) => honoApp.fetch(r), createParamGetReq));
    printResults("GET /user/:id (path params)", results);
  }

  // Test 3: GET /search?q=... (query params)
  {
    const results: BenchResult[] = [];
    results.push(await runBench("Raw Bun", rawBunHandler, createQueryGetReq));
    results.push(await runBench("AsiJS", (r) => asiApp.handle(r), createQueryGetReq));
    results.push(await runBench("AsiJS (compiled)", (r) => asiCompiledApp.handle(r), createQueryGetReq));
    results.push(await runBench("Elysia", (r) => elysiaApp.handle(r), createQueryGetReq));
    results.push(await runBench("Hono", (r) => honoApp.fetch(r), createQueryGetReq));
    printResults("GET /search?q=... (query params)", results);
  }

  // Test 4: POST /users (JSON body) - same iterations as GET
  {
    const results: BenchResult[] = [];
    results.push(await runBench("Raw Bun", rawBunHandler, createPostReq));
    results.push(await runBench("AsiJS", (r) => asiApp.handle(r), createPostReq));
    results.push(await runBench("AsiJS (compiled)", (r) => asiCompiledApp.handle(r), createPostReq));
    results.push(await runBench("Elysia", (r) => elysiaApp.handle(r), createPostReq));
    results.push(await runBench("Hono", (r) => honoApp.fetch(r), createPostReq));
    printResults("POST /users (JSON body, explicit parsing)", results);
  }

  // Test 5: With validation
  {
    console.log("\n" + "═".repeat(70));
    console.log("📋 WITH VALIDATION");
    console.log("═".repeat(70));
    
    const results: BenchResult[] = [];
    results.push(await runBench("AsiJS + validation", (r) => asiValidatedApp.handle(r), createPostReq));
    results.push(await runBench("AsiJS compiled + val", (r) => asiValidatedCompiledApp.handle(r), createPostReq));
    results.push(await runBench("Elysia + validation", (r) => elysiaValidatedApp.handle(r), createPostReq));
    printResults("POST /users (with validation)", results);
  }

  console.log("\n✅ Benchmarks complete!");
  console.log("\n📝 Notes:");
  console.log("   - All frameworks use explicit JSON parsing for fair comparison");
  console.log("   - Request factories used instead of clone() to avoid ReadableStream overhead");
  console.log("   - Same iteration count for all tests");
  console.log("   - Response status validated during warmup and benchmark");
}

main().catch(console.error);
