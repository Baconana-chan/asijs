/**
 * Load Test Orchestrator
 *
 * Starts the AsiJS test app, runs k6 scenarios via Docker,
 * collects results, and prints a summary to stdout.
 *
 * Usage:
 *   bun run bench:load                          # quick smoke test (10 VUs, 30s)
 *   K6_VUS=100 bun run bench:load               # 100 VUs
 *   K6_DURATION=5m bun run bench:load           # 5 minute test
 *   SCENARIO=auth bun run bench:load            # single scenario
 *   SKIP_DOCKER_CHECK=1 bun run bench:load      # skip docker check
 *
 * Results are saved to bench/results/load-*.json for the dashboard.
 */

import { mkdirSync, writeFileSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { Asi } from "../../src/index";
import type { Context } from "../../src/context";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, "..", "results");

// ===== Configuration =====

const SCENARIOS: Array<{ name: string; file: string; description: string }> = [
  { name: "auth",      file: "auth-flow.js",     description: "Auth flow (register → login → profile)" },
  { name: "crud",      file: "crud.js",           description: "CRUD operations (create/list/get/update/delete)" },
  { name: "websocket", file: "websocket.js",      description: "WebSocket connections & messaging" },
  { name: "upload",    file: "file-upload.js",    description: "File upload (small, large, list, delete)" },
];

const PORT = parseInt(process.env.LOAD_TEST_PORT || "3099", 10);
const K6_VUS = parseInt(process.env.K6_VUS || "10", 10);
const K6_DURATION = process.env.K6_DURATION || "30s";
const SCENARIO_FILTER = process.env.SCENARIO;
const SKIP_DOCKER = process.env.SKIP_DOCKER_CHECK === "1";

// ===== Load Test App =====

interface LoadTestItem {
  id: string;
  name: string;
  description: string;
  value: number;
  createdAt: string;
}

interface UploadedFile {
  id: string;
  name: string;
  description?: string;
  tags?: string;
  size: number;
  createdAt: string;
}

interface ChatMessage {
  type: string;
  room?: string;
  text?: string;
  userId?: string;
  timestamp: number;
}

function createLoadTestApp() {
  const app = new Asi({ development: false, silent: true });
  const items = new Map<string, LoadTestItem>();
  const files = new Map<string, UploadedFile>();
  const tokens = new Set<string>();

  // Health
  app.get("/health", () => ({ status: "ok" }));

  // Auth routes
  app.post("/api/auth/register", async (ctx: Context) => {
    const { email, password, name } = await ctx.json() as any;
    if (!email || !password) {
      return new Response(JSON.stringify({ error: "email and password required" }), { status: 400 });
    }
    const token = `jwt_${Math.random().toString(36).slice(2)}_${email}`;
    tokens.add(token);
    return Response.json({ token, user: { email, name } }, { status: 201 });
  });

  app.post("/api/auth/login", async (ctx: Context) => {
    const { email, password } = await ctx.json() as any;
    if (!email || !password) {
      return new Response(JSON.stringify({ error: "email and password required" }), { status: 400 });
    }
    const token = `jwt_${Math.random().toString(36).slice(2)}_${email}`;
    tokens.add(token);
    return Response.json({ token, user: { email, name: "LoadTest User" } });
  });

  app.get("/api/auth/profile", (ctx: Context) => {
    const auth = ctx.request.headers.get("Authorization");
    if (!auth || !auth.startsWith("Bearer ") || !tokens.has(auth.slice(7))) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }
    return { email: "user@example.com", name: "LoadTest User" };
  });

  // CRUD routes
  app.post("/api/items", async (ctx: Context) => {
    const body = await ctx.json() as any;
    const id = `item_${Math.random().toString(36).slice(2)}`;
    const item: LoadTestItem = {
      id,
      name: body.name || "unnamed",
      description: body.description || "",
      value: body.value || 0,
      createdAt: new Date().toISOString(),
    };
    items.set(id, item);
    return Response.json(item, { status: 201 });
  });

  app.get("/api/items", (ctx: Context) => {
    const limit = parseInt(ctx.query.limit || "20", 10);
    const offset = parseInt(ctx.query.offset || "0", 10);
    const allItems = Array.from(items.values());
    return Response.json(allItems.slice(offset, offset + limit));
  });

  app.get("/api/items/:id", (ctx: Context) => {
    const item = items.get(ctx.params.id);
    if (!item) return new Response("Not found", { status: 404 });
    return Response.json(item);
  });

  app.put("/api/items/:id", async (ctx: Context) => {
    const existing = items.get(ctx.params.id);
    if (!existing) return new Response("Not found", { status: 404 });
    const body = await ctx.json() as any;
    const updated = { ...existing, ...body };
    items.set(ctx.params.id, updated);
    return Response.json(updated);
  });

  app.delete("/api/items/:id", (ctx: Context) => {
    if (!items.has(ctx.params.id)) return new Response("Not found", { status: 404 });
    items.delete(ctx.params.id);
    return new Response(null, { status: 204 });
  });

  // File upload routes
  app.post("/api/upload", async (ctx: Context) => {
    const formData = await ctx.request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return new Response(JSON.stringify({ error: "no file" }), { status: 400 });

    const id = `file_${Math.random().toString(36).slice(2)}`;
    const uploaded: UploadedFile = {
      id,
      name: file.name,
      description: (formData.get("description") as string) || "",
      tags: (formData.get("tags") as string) || "",
      size: file.size,
      createdAt: new Date().toISOString(),
    };
    files.set(id, uploaded);
    return Response.json(uploaded, { status: 201 });
  });

  app.get("/api/upload", (ctx: Context) => {
    const limit = parseInt(ctx.query.limit || "20", 10);
    const allFiles = Array.from(files.values());
    return Response.json(allFiles.slice(0, limit));
  });

  app.delete("/api/upload/:id", (ctx: Context) => {
    if (!files.has(ctx.params.id)) return new Response("Not found", { status: 404 });
    files.delete(ctx.params.id);
    return new Response(null, { status: 204 });
  });

  // WebSocket routes
  app.ws("/ws/chat", {
    open(ws) {
      ws.data = { rooms: new Set<string>() };
    },
    message(ws, rawMessage) {
      try {
        const msg: ChatMessage = JSON.parse(rawMessage.toString());
        switch (msg.type) {
          case "join":
            if (msg.room) ws.data.rooms.add(msg.room);
            ws.send(JSON.stringify({ type: "joined", room: msg.room }));
            break;
          case "leave":
            if (msg.room) ws.data.rooms.delete(msg.room);
            break;
          case "message":
            // Broadcast to room
            const broadcast = {
              type: "broadcast",
              room: msg.room,
              text: msg.text,
              userId: msg.userId,
              timestamp: Date.now(),
            };
            ws.send(JSON.stringify(broadcast));
            break;
          default:
            ws.send(JSON.stringify({ type: "error", message: "unknown type" }));
        }
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "invalid JSON" }));
      }
    },
    close(ws) {
      ws.data.rooms.clear();
    },
  });

  return app;
}

// ===== k6 Runner =====

interface K6Result {
  scenario: string;
  metrics: {
    http_req_duration: K6MetricSummary;
    http_req_failed: K6MetricRate;
    http_reqs: K6MetricCount;
    iterations: K6MetricCount;
    vus: K6MetricCount;
  };
  checks: Record<string, { passes: number; fails: number }>;
  thresholds: Record<string, { ok: boolean; passed: number; failed: number }>;
}

interface K6MetricSummary {
  avg: number;
  min: number;
  med: number;
  max: number;
  "p(50)": number;
  "p(90)": number;
  "p(95)": number;
  "p(99)": number;
}

interface K6MetricRate {
  rate: number;
  passes: number;
  fails: number;
}

interface K6MetricCount {
  count: number;
  rate: number;
}

async function checkDocker(): Promise<boolean> {
  try {
    const proc = Bun.spawnSync(["docker", "info", "--format", "{{.ServerVersion}}"]);
    return proc.success;
  } catch {
    return false;
  }
}

async function runK6Scenario(
  scenarioName: string,
  scenarioFile: string,
  port: number,
): Promise<{ success: boolean; result?: K6Result; error?: string }> {
  const filePath = join(__dirname, scenarioFile);
  if (!filePath) {
    return { success: false, error: `Scenario file not found: ${scenarioFile}` };
  }

  try {
    const fileContent = readFileSync(filePath, "utf-8");
    if (!fileContent) {
      return { success: false, error: `Could not read scenario file: ${scenarioFile}` };
    }

    const proc = Bun.spawnSync(
      [
        "docker", "run", "--rm", "-i", "--pull", "always",
        "--add-host", "host.docker.internal:host-gateway",
        "-e", `BASE_URL=http://host.docker.internal:${port}`,
        "-e", `K6_VUS=${K6_VUS}`,
        "-e", `K6_DURATION=${K6_DURATION}`,
        "-e", "K6_OUT=json",
        "grafana/k6",
        "run", "--summary-trend-stats", "avg,min,med,max,p(50),p(90),p(95),p(99)",
        "-",
      ],
      {
        stdin: fileContent,
        env: { ...process.env },
      },
    );

    if (!proc.success) {
      const stderr = proc.stderr.toString();
      // Try to parse partial results if any
      const stdout = proc.stdout.toString();
      const result = tryParseK6JSON(stdout);
      if (result) {
        return { success: true, result };
      }
      return { success: false, error: stderr.slice(0, 500) };
    }

    const stdout = proc.stdout.toString();
    const result = tryParseK6JSON(stdout);

    if (result) {
      return { success: true, result };
    }

    return { success: true, result: extractMetricsFromOutput(stdout) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function tryParseK6JSON(output: string): K6Result | null {
  // k6 outputs JSON if K6_OUTPUT=json, but by default it outputs text.
  // Try to find embedded JSON in the output
  try {
    // Look for JSON object starting with {
    const jsonStart = output.indexOf("{");
    if (jsonStart >= 0) {
      // Try to extract just the JSON part
      const jsonStr = output.slice(jsonStart);
      const parsed = JSON.parse(jsonStr);
      if (parsed && parsed.metrics) {
        return parsed as K6Result;
      }
    }
  } catch {
    // Not JSON, that's fine
  }
  return null;
}

export function extractMetricsFromOutput(output: string): K6Result {
  const lines = output.split("\n");
  const metrics: any = {
    http_req_duration: { avg: 0, min: 0, med: 0, max: 0, "p(50)": 0, "p(90)": 0, "p(95)": 0, "p(99)": 0 },
    http_req_failed: { rate: 0, passes: 0, fails: 0 },
    http_reqs: { count: 0, rate: 0 },
    iterations: { count: 0, rate: 0 },
    vus: { count: 0 },
  };

  for (const line of lines) {
    const clean = line.replace(/\x1b\[[0-9;]*m/g, "").trim();

    // Parse: http_req_duration..............: avg=12.34ms min=5ms med=10ms max=100ms p(90)=20ms p(95)=30ms p(99)=50ms
    const durMatch = clean.match(/http_req_duration[^:]*:\s*avg=([\d.]+)(ms|s)/);
    if (durMatch) {
      const mult = durMatch[2] === "s" ? 1000 : 1;
      metrics.http_req_duration.avg = parseFloat(durMatch[1]) * mult;

      // Parse individual percentiles from the same line
      const p50Match = clean.match(/med=([\d.]+)ms/);
      if (p50Match) metrics.http_req_duration["p(50)"] = metrics.http_req_duration.med = parseFloat(p50Match[1]);

      const p90Match = clean.match(/p\(90\)=([\d.]+)(ms|s)/);
      if (p90Match) metrics.http_req_duration["p(90)"] = parseFloat(p90Match[1]) * (p90Match[2] === "s" ? 1000 : 1);

      const p95Match = clean.match(/p\(95\)=([\d.]+)(ms|s)/);
      if (p95Match) metrics.http_req_duration["p(95)"] = parseFloat(p95Match[1]) * (p95Match[2] === "s" ? 1000 : 1);

      const p99Match = clean.match(/p\(99\)=([\d.]+)(ms|s)/);
      if (p99Match) metrics.http_req_duration["p(99)"] = parseFloat(p99Match[1]) * (p99Match[2] === "s" ? 1000 : 1);

      const minMatch = clean.match(/min=([\d.]+)(ms|s)/);
      if (minMatch) metrics.http_req_duration.min = parseFloat(minMatch[1]) * (minMatch[2] === "s" ? 1000 : 1);

      const maxMatch = clean.match(/max=([\d.]+)(ms|s)/);
      if (maxMatch) metrics.http_req_duration.max = parseFloat(maxMatch[1]) * (maxMatch[2] === "s" ? 1000 : 1);
    }

    // Parse: http_req_failed...............: 0.00%  ✓ 0 ✗ 0
    const failMatch = clean.match(/http_req_failed[^:]*:\s*([\d.]+)%/);
    if (failMatch) {
      metrics.http_req_failed.rate = parseFloat(failMatch[1]) / 100;
      const passMatch = clean.match(/✓\s*(\d+)/);
      const failCountMatch = clean.match(/✗\s*(\d+)/);
      if (passMatch) metrics.http_req_failed.passes = parseInt(passMatch[1], 10);
      if (failCountMatch) metrics.http_req_failed.fails = parseInt(failCountMatch[1], 10);
    }

    // Parse: http_reqs......................: 12345 456.789/s
    const reqsMatch = clean.match(/http_reqs[^:]*:\s*(\d+)\s+([\d.]+)\/s/);
    if (reqsMatch) {
      metrics.http_reqs.count = parseInt(reqsMatch[1], 10);
      metrics.http_reqs.rate = parseFloat(reqsMatch[2]);
    }

    // Parse: iterations.....................: 12345 456.789/s
    const iterMatch = clean.match(/iterations[^:]*:\s*(\d+)\s+([\d.]+)\/s/);
    if (iterMatch) {
      metrics.iterations.count = parseInt(iterMatch[1], 10);
      metrics.iterations.rate = parseFloat(iterMatch[2]);
    }
  }

  return { scenario: "", metrics, checks: {}, thresholds: {} };
}

function printResults(results: Array<{ name: string; success: boolean; result?: K6Result; error?: string }>) {
  const passCount = results.filter((r) => r.success).length;
  console.log("\n📊 Load Test Results");
  console.log("═".repeat(70));
  console.log(`   VUs: ${K6_VUS} · Duration: ${K6_DURATION} · ${passCount}/${results.length} passed`);
  console.log("");

  for (const r of results) {
    if (r.success && r.result) {
      const m = r.result.metrics;
      console.log(`  ✅ ${r.name}`);
      console.log(`     Requests:   ${m.http_reqs.count.toLocaleString()} (${m.http_reqs.rate.toFixed(1)}/s)`);
      console.log(`     Duration:   avg=${m.http_req_duration.avg.toFixed(2)}ms · p50=${(m.http_req_duration["p(50)"] || m.http_req_duration.med || 0).toFixed(2)}ms · p95=${(m.http_req_duration["p(95)"] || 0).toFixed(2)}ms · p99=${(m.http_req_duration["p(99)"] || 0).toFixed(2)}ms`);
      console.log(`     Errors:     ${(m.http_req_failed.rate * 100).toFixed(2)}% (${m.http_req_failed.fails}/${m.http_req_failed.passes + m.http_req_failed.fails})`);
      console.log(`     Iterations: ${m.iterations.count.toLocaleString()}`);
    } else {
      console.log(`  ❌ ${r.name} — ${r.error || "unknown error"}`);
    }
    console.log("");
  }
}

// ===== Main =====

async function main() {
  console.log("\n🏋️  AsiJS Load Test Suite");
  console.log("═".repeat(70));

  // Check Docker
  if (!SKIP_DOCKER) {
    const hasDocker = await checkDocker();
    if (!hasDocker) {
      console.error("\n  ❌ Docker is required but not found.");
      console.error("     Install Docker Desktop from https://www.docker.com/products/docker-desktop/");
      console.error("     Or set SKIP_DOCKER_CHECK=1 to skip this check.\n");
      process.exit(1);
    }
    console.log("  ✅ Docker found\n");
  }

  // Prepare results directory
  mkdirSync(RESULTS_DIR, { recursive: true });

  // Create and start the AsiJS load test app
  const app = createLoadTestApp();
  console.log(`  🚀 Starting AsiJS load test app on port ${PORT}...`);

  await app.listen({ port: PORT });

  // Determine which scenarios to run
  const scenarios = SCENARIO_FILTER
    ? SCENARIOS.filter((s) => s.name === SCENARIO_FILTER || s.file.includes(SCENARIO_FILTER))
    : SCENARIOS;

  if (scenarios.length === 0) {
    console.error(`  ❌ No scenarios match filter: "${SCENARIO_FILTER}"`);
    console.error(`     Available: ${SCENARIOS.map((s) => s.name).join(", ")}`);
    await app.stop();
    process.exit(1);
  }

  console.log(`  📋 Running ${scenarios.length} scenario(s): ${scenarios.map((s) => s.name).join(", ")}`);
  console.log(`  🔧 VUs=${K6_VUS} · Duration=${K6_DURATION}`);
  console.log("");

  const results: Array<{ name: string; success: boolean; result?: K6Result; error?: string }> = [];

  for (const scenario of scenarios) {
    console.log(`  🏃 ${scenario.name}: ${scenario.description}`);
    const result = await runK6Scenario(scenario.name, scenario.file, PORT);
    results.push({ name: scenario.name, ...result });

    if (result.success) {
      const m = result.result?.metrics;
      if (m) {
        console.log(`     ✅ Done: ${m.http_reqs.count.toLocaleString()} requests, ${m.http_reqs.rate.toFixed(1)}/s, p95=${(m.http_req_duration["p(95)"] || 0).toFixed(0)}ms`);
      } else {
        console.log(`     ✅ Done (no metrics parsed)`);
      }
    } else {
      console.log(`     ❌ Failed: ${result.error}`);
    }
    console.log("");
  }

  // Save results
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const resultPath = join(RESULTS_DIR, `load-${timestamp}.json`);
  const summaryData = {
    timestamp: new Date().toISOString(),
    config: { vus: K6_VUS, duration: K6_DURATION },
    results: results.map((r) => ({
      scenario: r.name,
      success: r.success,
      metrics: r.result?.metrics || null,
      checks: r.result?.checks || null,
      error: r.error || null,
    })),
  };
  writeFileSync(resultPath, JSON.stringify(summaryData, null, 2));
  console.log(`  💾 Results saved: ${resultPath}`);

  // Stop the app
  await app.stop();

  // Final summary
  printResults(results);

  const allOk = results.every((r) => r.success);
  console.log(`\n  ${allOk ? "✅ All scenarios passed!" : "⚠️  Some scenarios failed — check details above."}`);
  console.log("═".repeat(70));
  console.log();

  if (!allOk) {
    process.exit(1);
  }
}

// Run only when executed directly (not when imported for testing)
// Bun.main returns the absolute path of the entry file
const isMain = import.meta.url === Bun.main;
if (isMain) {
  main().catch((err) => {
    console.error("\n  ❌ Load test orchestrator failed:", err);
    process.exit(1);
  });
}
