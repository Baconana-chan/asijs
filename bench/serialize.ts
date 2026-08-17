/**
 * JSON Schema Response Serialization benchmark (3.2)
 *
 * compileSerializer (codegen) vs JSON.stringify vs Response.json for:
 * 1. Flat object (3 fields)
 * 2. Nested object (user + meta + tags)
 * 3. Array of 100 objects
 * 4. Large object (20 fields)
 * 5. V8.serialize reference — binary-only, informational (NOT HTTP JSON)
 *
 * Run: bun run bench:serialize
 * Output is parsed by bench/collect.ts (groups via 📊 headers).
 */

import { Type } from "@sinclair/typebox";
import { compileSerializer, serializeForCache } from "../src";

const ITERATIONS = parseInt(process.env.BENCH_ITERATIONS || "200000", 10);
const WARMUP = parseInt(process.env.BENCH_WARMUP || "5000", 10);

interface BenchResult {
  name: string;
  rps: number;
  avgMs: number;
  totalMs: number;
  errors: number;
}

async function runBench(
  name: string,
  fn: (i: number) => unknown,
  iterations: number = ITERATIONS,
): Promise<BenchResult> {
  let errors = 0;
  for (let i = 0; i < WARMUP; i++) {
    try {
      fn(i);
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
      fn(i);
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

/** End-to-end through a real AsiJS app (handler + serialization + Response). */
async function runHttpBench(
  name: string,
  handler: (req: Request) => Promise<Response>,
  createRequest: () => Request,
  iterations: number = ITERATIONS,
): Promise<BenchResult> {
  let errors = 0;
  for (let i = 0; i < WARMUP; i++) {
    const r = await handler(createRequest());
    if (!r.ok) errors++;
  }
  if (errors > 0) console.error(`⚠️  ${name}: ${errors}/${WARMUP} warmup failures`);
  errors = 0;
  if (typeof Bun !== "undefined" && Bun.gc) Bun.gc(true);

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const r = await handler(createRequest());
    if (!r.ok) errors++;
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

function printResults(testName: string, results: BenchResult[]): void {
  console.log(`\n📊 ${testName}`);
  const best = Math.max(...results.map((r) => r.rps));
  for (const r of results) {
    const vs = best > 0 ? `${((r.rps / best) * 100).toFixed(1)}%` : "—";
    const err = r.errors > 0 ? ` ⚠️ ${r.errors}` : "";
    console.log(
      `  ${r.name.padEnd(48)} ${String(r.rps).padStart(9)} ops/s  ${r.avgMs.toFixed(4)}ms  vsBest ${vs.padStart(6)}${err}`,
    );
  }
}

// ============================================================================
// Schemas + data
// ============================================================================

const FlatSchema = Type.Object({
  id: Type.Integer(),
  name: Type.String(),
  active: Type.Boolean(),
});

const NestedSchema = Type.Object({
  id: Type.Integer(),
  name: Type.String(),
  email: Type.Optional(Type.String()),
  meta: Type.Object({
    score: Type.Number(),
    ok: Type.Boolean(),
    tags: Type.Array(Type.String()),
  }),
  created: Type.String(),
});

const LargeSchema = Type.Object(
  Object.fromEntries(
    Array.from({ length: 20 }, (_, i) => [
      `field${i}`,
      i % 3 === 0 ? Type.Integer() : Type.String(),
    ]),
  ),
);

const flatData = () => ({ id: 1, name: "Ada Lovelace", active: true });
const nestedData = () => ({
  id: 42,
  name: "Grace Hopper",
  email: "grace@navy.mil",
  meta: { score: 99.5, ok: true, tags: ["compiler", "COBOL", "debug"] },
  created: "2026-08-17T00:00:00.000Z",
});
const arrayData = () =>
  Array.from({ length: 100 }, (_, i) => ({
    id: i,
    name: `user-${i}`,
    active: i % 2 === 0,
  }));
const largeData = () =>
  Object.fromEntries(Array.from({ length: 20 }, (_, i) => [i % 3 === 0 ? `field${i}` : `field${i}`, i % 3 === 0 ? i : `v${i}`]));

async function main(): Promise<void> {
  const flatSer = compileSerializer(FlatSchema);
  const nestedSer = compileSerializer(NestedSchema);
  const arraySer = compileSerializer(Type.Array(FlatSchema));
  const largeSer = compileSerializer(LargeSchema);

  // Sanity: outputs must be byte-identical to JSON.stringify
  const check = (name: string, ser: (v: unknown) => string, data: unknown): boolean => {
    const ok = ser(data) === JSON.stringify(data);
    if (!ok) console.error(`❌ ${name}: serializer mismatch with JSON.stringify`);
    return ok;
  };
  check("flat", flatSer, flatData());
  check("nested", nestedSer, nestedData());
  check("array", arraySer, arrayData());
  check("large", largeSer, largeData());

  // 1. Flat object
  let results: BenchResult[] = [];
  results.push(await runBench("flat — compileSerializer", () => flatSer(flatData())));
  results.push(await runBench("flat — JSON.stringify", () => JSON.stringify(flatData())));
  results.push(await runBench("flat — Response.json", () => Response.json(flatData())));
  printResults("JSON Serialization — flat object (3 fields)", results);

  // 2. Nested object
  results = [];
  results.push(await runBench("nested — compileSerializer", () => nestedSer(nestedData())));
  results.push(await runBench("nested — JSON.stringify", () => JSON.stringify(nestedData())));
  results.push(await runBench("nested — Response.json", () => Response.json(nestedData())));
  printResults("JSON Serialization — nested object", results);

  // 3. Array of 100 objects
  results = [];
  results.push(await runBench("array(100) — compileSerializer", () => arraySer(arrayData())));
  results.push(await runBench("array(100) — JSON.stringify", () => JSON.stringify(arrayData())));
  results.push(await runBench("array(100) — Response.json", () => Response.json(arrayData())));
  printResults("JSON Serialization — array of 100 objects", results);

  // 4. Large object (20 fields)
  results = [];
  results.push(await runBench("large(20) — compileSerializer", () => largeSer(largeData())));
  results.push(await runBench("large(20) — JSON.stringify", () => JSON.stringify(largeData())));
  printResults("JSON Serialization — large object (20 fields)", results);

  // 5. V8.serialize reference (binary — informational, not HTTP JSON)
  results = [];
  results.push(await runBench("large(20) — V8.serialize (binary)", () => serializeForCache(largeData())));
  printResults("V8.serialize reference (binary-only, for internal caches)", results);

  // 6. End-to-end through AsiJS: schema-serialized route vs plain JSON route
  const { Asi } = await import("../src");
  const app = new Asi({ silent: true } as never);
  app.get(
    "/plain",
    () => flatData(),
    { schema: { response: FlatSchema } } as never,
  );
  app.get("/schema", () => flatData());
  app.compile();
  const req = () => new Request("http://localhost/schema");
  const reqPlain = () => new Request("http://localhost/plain");
  results = [];
  results.push(
    await runHttpBench("e2e — AsiJS route (schema serializer)", (r) => app.handle(r), req),
  );
  results.push(
    await runHttpBench("e2e — AsiJS route (plain JSON)", (r) => app.handle(r), reqPlain),
  );
  printResults("E2E — AsiJS route with response schema vs plain JSON", results);
}

await main();
