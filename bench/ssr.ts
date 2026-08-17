/**
 * SSR benchmarks — AsiJS vs Node-first SSR frameworks with Bun adapters.
 *
 * Methodology: **production servers on local ports**, hammered with concurrent
 * fetch (C=32). This is the realistic way SSR frameworks are compared — full
 * HTTP stack, real network sockets, production builds only.
 *
 * Framework apps live in `bench/frameworks/*` and must be built once:
 *   bun run bench:ssr:build
 *
 * Frameworks (all Bun-runnable):
 *   - AsiJS      — string template + JSX (renderToString), served via Bun.serve
 *   - Hono       — string template, served via Bun.serve
 *   - Astro      — @astrojs/node standalone (`dist/server/entry.mjs`)
 *   - SvelteKit  — @sveltejs/adapter-node (`build/index.js`)
 *   - Nuxt       — nitro `bun` preset (`.output/server/index.mjs`)
 *
 * Run:  bun run bench:ssr
 *       BENCH_ITERATIONS=20000 bun run bench:ssr
 *
 * NOTE: Next.js / Remix need a Node build toolchain (`next build` / `remix
 * build` don't run under Bun) — they're a follow-up (TODO.md).
 */

import { Asi, jsx, renderToString } from "../src";
import { Hono } from "hono";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRAMEWORKS_DIR = join(__dirname, "frameworks");

const ITERATIONS = parseInt(process.env.BENCH_ITERATIONS || "10000", 10);
const WARMUP = parseInt(process.env.BENCH_WARMUP || "500", 10);
const CONCURRENCY = parseInt(process.env.BENCH_CONCURRENCY || "32", 10);

// Local ports for each framework server (41xx range)
const PORTS = {
  asiString: 4101,
  asiJsx: 4102,
  hono: 4103,
  astro: 4104,
  sveltekit: 4105,
  nuxt: 4106,
};

interface BenchResult {
  name: string;
  rps: number;
  avgMs: number;
  totalMs: number;
  errors: number;
}

// ============================================================================
// Shared workload: 100-row product table (same data as production.ts bench 5)
// ============================================================================

interface Item {
  id: number;
  name: string;
  description: string;
  price: number;
  inStock: boolean;
}

const ITEMS: Item[] = Array.from({ length: 100 }, (_, i) => ({
  id: i + 1,
  name: `Product ${i + 1}`,
  description: `This is the description for product ${i + 1}`,
  price: Math.round(Math.random() * 10000) / 100,
  inStock: Math.random() > 0.3,
}));

function ProductTable({ items }: { items: Item[] }) {
  return jsx(
    "html",
    null,
    jsx("head", null, jsx("title", null, "Products")),
    jsx(
      "body",
      null,
      jsx("h1", null, "Product List"),
      jsx(
        "table",
        { border: "1" },
        jsx(
          "thead",
          null,
          jsx(
            "tr",
            null,
            jsx("th", null, "ID"),
            jsx("th", null, "Name"),
            jsx("th", null, "Description"),
            jsx("th", null, "Price"),
            jsx("th", null, "In Stock"),
          ),
        ),
        jsx(
          "tbody",
          null,
          ...items.map((item) =>
            jsx(
              "tr",
              { key: item.id },
              jsx("td", null, String(item.id)),
              jsx("td", null, item.name),
              jsx("td", null, item.description),
              jsx("td", null, `$${item.price.toFixed(2)}`),
              jsx("td", null, item.inStock ? "Yes" : "No"),
            ),
          ),
        ),
      ),
    ),
  );
}

function renderStringTable(items: Item[]): string {
  const rows = items
    .map(
      (item) => `<tr>
        <td>${item.id}</td>
        <td>${item.name}</td>
        <td>${item.description}</td>
        <td>$${item.price.toFixed(2)}</td>
        <td>${item.inStock ? "Yes" : "No"}</td>
      </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head><title>Products</title></head>
<body>
  <h1>Product List</h1>
  <table border="1">
    <thead>
      <tr><th>ID</th><th>Name</th><th>Description</th><th>Price</th><th>In Stock</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}

// ============================================================================
// AsiJS + Hono apps (in-repo, always available)
// ============================================================================

function createStringTemplateAsiApp() {
  const app = new Asi({ development: false });
  app.get("/products", () =>
    new Response(renderStringTable(ITEMS), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }),
  );
  app.compile();
  return app;
}

function createJsxAsiApp() {
  const app = new Asi({ development: false });
  app.get("/products", () => {
    const html = renderToString(ProductTable({ items: ITEMS }));
    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  });
  app.compile();
  return app;
}

function createHonoApp() {
  const app = new Hono();
  app.get("/products", (c) => c.html(renderStringTable(ITEMS)));
  return app;
}

// ============================================================================
// Server management
// ============================================================================

interface RunningServer {
  /** Bun.serve server (has .stop) or Bun.spawn proc (has .kill) */
  proc: { stop?: (force?: boolean) => void; kill?: () => void };
  port: number;
}

function startBunServer(
  port: number,
  fetch: (req: Request) => Promise<Response> | Response,
): RunningServer {
  const server = Bun.serve({ port, hostname: "127.0.0.1", fetch });
  return { proc: server as unknown as RunningServer["proc"], port };
}

function startServer(cwd: string, cmd: string[], port: number): RunningServer {
  const proc = Bun.spawn(cmd, {
    cwd,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", NITRO_PORT: "", NITRO_HOST: "" },
    stdout: "ignore",
    stderr: "ignore",
  });
  return { proc, port };
}

async function waitReady(port: number, timeoutMs = 20000): Promise<boolean> {
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/products`);
      if (res.status === 200) return true;
    } catch {
      // not up yet
    }
    await Bun.sleep(200);
  }
  return false;
}

// ============================================================================
// Port benchmark — concurrent fetch
// ============================================================================

async function benchPort(
  name: string,
  port: number,
  iterations: number,
  concurrency: number,
): Promise<BenchResult> {
  const url = `http://127.0.0.1:${port}/products`;
  let errors = 0;

  const run = async (n: number) => {
    for (let i = 0; i < n; i++) {
      try {
        const res = await fetch(url);
        if (res.status >= 400) errors++;
      } catch {
        errors++;
      }
    }
  };

  // Warmup
  await run(Math.min(concurrency * 5, 300));

  if (typeof Bun !== "undefined" && Bun.gc) Bun.gc(true);

  const per = Math.max(1, Math.floor(iterations / concurrency));
  const start = performance.now();
  await Promise.all(Array.from({ length: concurrency }, () => run(per)));
  const totalMs = performance.now() - start;

  const actual = per * concurrency;
  const avgMs = totalMs / actual;
  const rps = Math.round(actual / (totalMs / 1000));

  return { name, rps, avgMs, totalMs, errors };
}

function printResults(testName: string, results: BenchResult[]) {
  console.log(`\n📊 ${testName}`);
  console.log("─".repeat(75));

  for (const r of results) {
    if (r.errors > 0) {
      console.error(`   ⚠️  ${r.name}: ${r.errors} errors!`);
    }
  }

  results.sort((a, b) => b.rps - a.rps);
  const best = results[0].rps;

  for (const r of results) {
    const percent = ((r.rps / best) * 100).toFixed(1);
    const bar = "█".repeat(Math.round(Number(percent) / 5));
    const errMark = r.errors > 0 ? " ⚠️" : "";
    console.log(
      `${r.name.padEnd(28)} ${r.rps.toLocaleString("en-US").padStart(10)} req/s ` +
        `(${r.avgMs.toFixed(4)}ms) ${bar} ${percent}%${errMark}`,
    );
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const servers: RunningServer[] = [];

  // AsiJS + Hono — always available
  servers.push(startBunServer(PORTS.asiString, (r) => createStringTemplateAsiApp().handle(r)));
  servers.push(startBunServer(PORTS.asiJsx, (r) => createJsxAsiApp().handle(r)));
  servers.push(startBunServer(PORTS.hono, (r) => createHonoApp().fetch(r)));

  // Node-first SSR frameworks — need production builds
  const frameworks: Array<{ name: string; port: number; cwd: string; cmd: string[]; buildCheck: string }> = [
    {
      name: "Astro (standalone)",
      port: PORTS.astro,
      cwd: join(FRAMEWORKS_DIR, "astro"),
      cmd: ["bun", "dist/server/entry.mjs"],
      buildCheck: "dist/server/entry.mjs",
    },
    {
      name: "SvelteKit (adapter-node)",
      port: PORTS.sveltekit,
      cwd: join(FRAMEWORKS_DIR, "sveltekit"),
      cmd: ["bun", "build/index.js"],
      buildCheck: "build/index.js",
    },
    {
      name: "Nuxt (nitro bun)",
      port: PORTS.nuxt,
      cwd: join(FRAMEWORKS_DIR, "nuxt"),
      cmd: ["bun", ".output/server/index.mjs"],
      buildCheck: ".output/server/index.mjs",
    },
  ];

  const all: Array<{ name: string; port: number }> = [
    { name: "AsiJS (string template)", port: PORTS.asiString },
    { name: "AsiJS (JSX + renderToString)", port: PORTS.asiJsx },
    { name: "Hono (string template)", port: PORTS.hono },
  ];

  for (const f of frameworks) {
    if (!existsSync(join(f.cwd, f.buildCheck))) {
      console.log(`   ⚠️  ${f.name}: build not found — run "bun run bench:ssr:build" first`);
      continue;
    }
    servers.push(startServer(f.cwd, f.cmd, f.port));
    all.push({ name: f.name, port: f.port });
  }

  // Wait for all servers to become ready
  const ready: Array<{ name: string; port: number }> = [];
  for (const s of all) {
    const ok = await waitReady(s.port);
    if (ok) {
      ready.push(s);
    } else {
      console.log(`   ⚠️  ${s.name}: server did not become ready on port ${s.port} — skipping`);
    }
  }

  if (ready.length === 0) {
    console.error("❌ No SSR servers became ready — aborting");
    process.exit(1);
  }

  // Cleanup: stop Bun.serve servers + kill spawned procs
  const cleanup = () => {
    for (const s of servers) {
      try {
        if (s.proc.stop) s.proc.stop(true);
        if (s.proc.kill) s.proc.kill();
      } catch {
        // ignore
      }
    }
  };

  // Bench
  const results: BenchResult[] = [];
  for (const s of ready) {
    results.push(await benchPort(s.name, s.port, ITERATIONS, CONCURRENCY));
  }

  printResults(`SSR — 100-row table (production server, C=${CONCURRENCY})`, results);

  cleanup();
  console.log("\n  SSR benchmarks complete.");
}

await main();
