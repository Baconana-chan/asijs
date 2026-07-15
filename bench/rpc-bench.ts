/**
 * RPC / Server Actions Benchmarks — AsiJS vs Elysia vs Hono
 *
 * Compares how each framework handles type-safe RPC-style patterns:
 *   1. POST /action — single action endpoint with validation
 *   2. Batch — multiple actions in sequence
 *   3. Direct server call — AsiJS unique (no HTTP overhead)
 *   4. Client proxy — createRPCClient() proxy overhead
 *   5. Complex RPC — large payload with nested validation
 *
 * Run: bun --cwd bench run rpc-bench.ts
 */

import { Asi, Type, serverAction, rpc, createRPCClient } from "../src";
import { Elysia, t } from "elysia";
import { Hono } from "hono";
import type { RPCClient } from "../src/rpc";

const ITERATIONS = 50_000;
const WARMUP = 2_000;

interface BenchResult {
  name: string;
  rps: number;
  avgMs: number;
  totalMs: number;
  errors: number;
}

type RequestFactory = () => Request;

/** Factory helpers */
const POST_JSON = (path: string, body: unknown): RequestFactory =>
  () => new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// ========================================================================
// Benchmark Runner
// ========================================================================

async function runBench(
  name: string,
  handler: (req: Request) => Promise<Response>,
  createRequest: RequestFactory,
  iterations: number = ITERATIONS,
): Promise<BenchResult> {
  let errors = 0;

  for (let i = 0; i < WARMUP; i++) {
    const response = await handler(createRequest());
    if (response.status >= 400) {
      errors++;
      if (errors === 1) {
        const text = await response.text();
        console.error(`❌ ${name}: status ${response.status}: ${text.slice(0, 100)}`);
      }
    }
  }

  if (errors > WARMUP / 10) {
    console.error(`⚠️  ${name}: ${errors}/${WARMUP} errors during warmup`);
  }

  errors = 0;

  if (typeof Bun !== "undefined" && Bun.gc) Bun.gc(true);

  const start = performance.now();

  for (let i = 0; i < iterations; i++) {
    const response = await handler(createRequest());
    if (response.status >= 400) errors++;
  }

  const totalMs = performance.now() - start;
  const avgMs = totalMs / iterations;
  const rps = Math.round(iterations / (totalMs / 1000));

  return { name, rps, avgMs, totalMs, errors };
}

function printResults(testName: string, results: BenchResult[]) {
  console.log(`\n📊 ${testName}`);
  console.log("─".repeat(80));

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
      `${r.name.padEnd(35)} ${r.rps.toLocaleString().padStart(10)} req/s ` +
      `(${r.avgMs.toFixed(4)}ms) ${bar} ${percent}%${errMark}`,
    );
  }
}

// ========================================================================
// Benchmark 1: POST /greet — Simple RPC action (string input, string output)
// ========================================================================

function createRpcAsiApp() {
  const app = new Asi({ development: false });
  rpc(app, {
    greet: serverAction(
      Type.Object({ name: Type.String() }),
      async ({ name }) => ({ message: `Hello, ${name}!` }),
    ),
  });
  return app;
}

function createElysiaRpcApp() {
  return new Elysia().post("/rpc/greet", ({ body }) => ({
    success: true,
    data: { message: `Hello, ${body.name}!` },
  }), {
    body: t.Object({ name: t.String() }),
  });
}

function createHonoRpcApp() {
  const app = new Hono();
  app.post("/rpc/greet", async (c) => {
    const body = await c.req.json<{ name: string }>();
    if (!body.name || typeof body.name !== "string") {
      return c.json({ error: "Validation failed" }, 400);
    }
    return c.json({ success: true, data: { message: `Hello, ${body.name}!` } });
  });
  return app;
}

async function benchSimpleRpc() {
  const asiApp = createRpcAsiApp();
  const elysiaApp = createElysiaRpcApp();
  const honoApp = createHonoRpcApp();

  const createReq = POST_JSON("/rpc/greet", { name: "World" });

  const results: BenchResult[] = [];
  results.push(await runBench("AsiJS RPC (serverAction+rpc)", (r) => asiApp.handle(r), createReq));
  results.push(await runBench("Elysia POST + t.Object", (r) => elysiaApp.handle(r), createReq));
  results.push(await runBench("Hono POST + manual val", (r) => honoApp.fetch(r), createReq));

  printResults("1. POST /rpc/greet (simple RPC action)", results);
}

// ========================================================================
// Benchmark 2: Direct Server-Side Call — AsiJS unique (no HTTP)
// ========================================================================

async function benchDirectCall() {
  const app = new Asi({ development: false });

  const api = rpc(app, {
    greet: serverAction(
      Type.Object({ name: Type.String() }),
      async ({ name }) => ({ message: `Hello, ${name}!` }),
    ),
    add: serverAction(
      Type.Object({ a: Type.Number(), b: Type.Number() }),
      async ({ a, b }) => ({ result: a + b }),
    ),
  });

  // Warmup
  for (let i = 0; i < WARMUP; i++) {
    await api.greet({ name: "Warmup" });
    await api.add({ a: 1, b: 2 });
  }

  if (typeof Bun !== "undefined" && Bun.gc) Bun.gc(true);

  // Benchmark greet
  {
    let errors = 0;
    const start = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      try {
        await api.greet({ name: "World" });
      } catch { errors++; }
    }
    const totalMs = performance.now() - start;
    const avgMs = totalMs / ITERATIONS;
    const rps = Math.round(ITERATIONS / (totalMs / 1000));

    const results: BenchResult[] = [
      { name: "AsiJS direct call (no HTTP)", rps, avgMs, totalMs, errors },
    ];

    // Compare with equivalent HTTP POST
    const httpApp = new Asi({ development: false });
    rpc(httpApp, {
      greet: serverAction(
        Type.Object({ name: Type.String() }),
        async ({ name }) => ({ message: `Hello, ${name}!` }),
      ),
    });

    const resultHttp = await runBench(
      "AsiJS HTTP POST",
      (r) => httpApp.handle(r),
      POST_JSON("/rpc/greet", { name: "World" }),
      10_000,
    );

    results.push(resultHttp);
    printResults("2. Direct Server Call vs HTTP (AsiJS only)", results);
  }

  // Benchmark add (two number inputs)
  {
    let errors = 0;
    const start = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      try {
        await api.add({ a: i, b: i * 2 });
      } catch { errors++; }
    }
    const totalMs = performance.now() - start;
    const avgMs = totalMs / ITERATIONS;
    const rps = Math.round(ITERATIONS / (totalMs / 1000));

    printResults("2b. Direct Call - /add (num inputs)", [
      { name: "AsiJS direct call (no HTTP)", rps, avgMs, totalMs, errors },
    ]);
  }
}

// ========================================================================
// Benchmark 3: createRPCClient Proxy Overhead
// ========================================================================

async function benchClientProxy() {
  const app = new Asi({ development: false });

  rpc(app, {
    greet: serverAction(
      Type.Object({ name: Type.String() }),
      async ({ name }) => ({ message: `Hello, ${name}!` }),
    ),
  });

  // Client with custom fetch that bypasses network
  const client = createRPCClient("http://localhost", {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      return app.handle(new Request(input, init));
    },
  });
  const typedClient = client as unknown as RPCClient<{
    greet: { _input: { name: string }; _output: { message: string } };
  }>;

  // Warmup
  for (let i = 0; i < WARMUP; i++) {
    await typedClient.greet({ name: "Warmup" });
  }

  // Also warmup HTTP path
  const reqFactory = POST_JSON("/rpc/greet", { name: "World" });
  for (let i = 0; i < WARMUP; i++) {
    await app.handle(reqFactory());
  }

  if (typeof Bun !== "undefined" && Bun.gc) Bun.gc(true);

  const PROXY_ITERS = Math.min(ITERATIONS, 20_000);

  // Benchmark proxy client
  let proxyErrors = 0;
  const proxyStart = performance.now();
  for (let i = 0; i < PROXY_ITERS; i++) {
    try {
      await typedClient.greet({ name: "World" });
    } catch { proxyErrors++; }
  }
  const proxyTotal = performance.now() - proxyStart;
  const proxyRps = Math.round(PROXY_ITERS / (proxyTotal / 1000));

  // Benchmark same path via direct HTTP
  let httpErrors = 0;
  const httpStart = performance.now();
  for (let i = 0; i < PROXY_ITERS; i++) {
    const res = await app.handle(reqFactory());
    if (res.status >= 400) httpErrors++;
  }
  const httpTotal = performance.now() - httpStart;
  const httpRps = Math.round(PROXY_ITERS / (httpTotal / 1000));

  const results: BenchResult[] = [
    { name: "AsiJS createRPCClient (proxy→fetch→handler)", rps: proxyRps, avgMs: proxyTotal / PROXY_ITERS, totalMs: proxyTotal, errors: proxyErrors },
    { name: "AsiJS HTTP POST (direct fetch, no proxy)", rps: httpRps, avgMs: httpTotal / PROXY_ITERS, totalMs: httpTotal, errors: httpErrors },
  ];

  printResults("3. createRPCClient Proxy (full round-trip)", results);
}

// ========================================================================
// Benchmark 4: Complex RPC — Large payload with nested validation
// ========================================================================

function createComplexRpcAsiApp() {
  const app = new Asi({ development: false });

  rpc(app, {
    createUser: serverAction(
      Type.Object({
        name: Type.String({ minLength: 1, maxLength: 100 }),
        email: Type.String({ format: "email" }),
        age: Type.Number({ minimum: 0, maximum: 150 }),
        address: Type.Object({
          street: Type.String(),
          city: Type.String(),
          zip: Type.String(),
          country: Type.String(),
        }),
        tags: Type.Array(Type.String()),
        metadata: Type.Record(Type.String(), Type.Any()),
      }),
      async (input) => ({
        id: Date.now(),
        ...input,
        createdAt: new Date().toISOString(),
      }),
    ),
  });

  return app;
}

function createComplexElysiaApp() {
  return new Elysia().post("/rpc/createUser", ({ body }) => ({
    success: true,
    data: {
      id: Date.now(),
      ...body,
      createdAt: new Date().toISOString(),
    },
  }), {
    body: t.Object({
      name: t.String({ minLength: 1, maxLength: 100 }),
      email: t.String({ format: "email" }),
      age: t.Number({ minimum: 0, maximum: 150 }),
      address: t.Object({
        street: t.String(),
        city: t.String(),
        zip: t.String(),
        country: t.String(),
      }),
      tags: t.Array(t.String()),
      metadata: t.Record(t.String(), t.Any()),
    }),
  });
}

const COMPLEX_USER_PAYLOAD = {
  name: "John Doe",
  email: "john@example.com",
  age: 30,
  address: {
    street: "123 Main St",
    city: "New York",
    zip: "10001",
    country: "USA",
  },
  tags: ["developer", "typescript", "bun"],
  metadata: { source: "benchmark", version: 1, active: true },
};

async function benchComplexRpc() {
  const asiApp = createComplexRpcAsiApp();
  const elysiaApp = createComplexElysiaApp();

  const createReq = POST_JSON("/rpc/createUser", COMPLEX_USER_PAYLOAD);

  const results: BenchResult[] = [];
  results.push(await runBench("AsiJS RPC complex", (r) => asiApp.handle(r), createReq));
  results.push(await runBench("Elysia complex", (r) => elysiaApp.handle(r), createReq));

  printResults("4. Complex RPC (nested validation, 6+ fields)", results);
}

// ========================================================================
// Benchmark 5: RPC vs REST — POST with auth + validation
// ========================================================================

function createRpcWithAuthAsiApp() {
  const app = new Asi({ development: false });

  rpc(app, {
    createPost: serverAction(
      Type.Object({
        title: Type.String({ minLength: 1, maxLength: 200 }),
        content: Type.String({ minLength: 1 }),
        tags: Type.Array(Type.String()),
        published: Type.Boolean(),
      }),
      async (input) => ({
        id: Date.now(),
        ...input,
        authorId: "user_123",
        createdAt: new Date().toISOString(),
      }),
    ),
  });

  return app;
}

function createRestAsiApp() {
  const app = new Asi({ development: false });

  app.post("/api/posts", (ctx) => {
    const body = ctx.body as any;
    return {
      id: Date.now(),
      ...body,
      authorId: "user_123",
      createdAt: new Date().toISOString(),
    };
  }, {
    schema: {
      body: Type.Object({
        title: Type.String({ minLength: 1, maxLength: 200 }),
        content: Type.String({ minLength: 1 }),
        tags: Type.Array(Type.String()),
        published: Type.Boolean(),
      }),
    },
  });

  app.compile();
  return app;
}

const POST_PAYLOAD = {
  title: "Benchmark Results",
  content: "Comparing RPC vs REST performance...",
  tags: ["benchmark", "rpc", "rest"],
  published: true,
};

async function benchRpcVsRest() {
  const rpcApp = createRpcWithAuthAsiApp();
  const restApp = createRestAsiApp();

  const createRpcReq = POST_JSON("/rpc/createPost", POST_PAYLOAD);
  const createRestReq = POST_JSON("/api/posts", POST_PAYLOAD);

  const results: BenchResult[] = [];
  results.push(await runBench("AsiJS RPC (serverAction+rpc)", (r) => rpcApp.handle(r), createRpcReq));
  results.push(await runBench("AsiJS REST (app.post+schema)", (r) => restApp.handle(r), createRestReq));

  printResults("5. RPC vs REST (same validation, same response)", results);
}

// ========================================================================
// Main
// ========================================================================

async function main() {
  console.log("🏭 AsiJS RPC Benchmarks");
  console.log(`   Iterations: ${ITERATIONS.toLocaleString()}`);
  console.log(`   Warmup: ${WARMUP.toLocaleString()}`);
  console.log("═".repeat(80));

  await benchSimpleRpc();
  await benchDirectCall();
  await benchClientProxy();
  await benchComplexRpc();
  await benchRpcVsRest();

  console.log(`\n✅ RPC Benchmarks complete!\n`);
  console.log("📝 Notes:");
  console.log("   - AsiJS RPC: serverAction() + rpc() with compiled TypeBox validation");
  console.log("   - Elysia: post() + t.Object schema validation");
  console.log("   - Hono: post() + manual JSON validation");
  console.log("   - Direct calls skip HTTP entirely (unique to AsiJS)");
  console.log("   - createRPCClient uses Proxy → fetch → handler pipeline");
}

main()
  .then(() => { if (typeof process !== "undefined" && process.exit) process.exit(0); })
  .catch((error) => { console.error(error); process.exit(1); });
