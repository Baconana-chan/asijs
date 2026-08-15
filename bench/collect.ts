/**
 * Benchmark Collector
 *
 * Runs all benchmark scripts, captures their text output,
 * parses RPS/avgMs values, and saves structured JSON results.
 *
 * Usage: bun run bench:collect
 *        BENCH_ITERATIONS=10000 bun run bench:collect  (CI override)
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import type { SingleBenchResult, BenchTestGroup, BenchmarkSnapshot } from "./results";

// ===== Helpers =====

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, "results");

function getCommitInfo(): { commit: string; branch: string } {
  try {
    const { stdout: commit } = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"]);
    const { stdout: branch } = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"]);
    return {
      commit: commit.toString().trim() || "unknown",
      branch: branch.toString().trim() || "unknown",
    };
  } catch {
    return { commit: "unknown", branch: "unknown" };
  }
}

function parseBenchOutput(stdout: string): BenchTestGroup[] {
  const groups: BenchTestGroup[] = [];
  const lines = stdout.split("\n");

  let currentGroup: BenchTestGroup | null = null;

  for (const line of lines) {
    // Detect benchmark group header: 📊 Test Name
    const groupMatch = line.match(/📊\s+(.+)/);
    if (groupMatch) {
      if (currentGroup) groups.push(currentGroup);
      currentGroup = { name: groupMatch[1]!.trim(), results: [] } as BenchTestGroup;
      continue;
    }

    // Parse result line: "Name                    100,000 req/s (0.0100ms)"
    // or: "Name                    100000 req/s (0.01ms) ████████ 95.5%"
    // Strip ANSI codes first
    const clean = line.replace(/\x1b\[[0-9;]*m/g, "").trim();

    // Skip non-result lines
    if (!clean || clean.startsWith("─") || clean.startsWith("═") || clean.startsWith("⚠")) {
      continue;
    }

    // Allow locale-variant thousands separators (comma, space, narrow NBSP) —
    // toLocaleString() uses a space separator in some locales (e.g. ru), which
    // previously made most result lines unparseable on non-en machines.
    // Units: `req/s`, `ops/s`, `bytes/req` — the numeric value is stored as rps.
    const resultMatch = clean.match(
      /^(.+?)\s{2,}(\d[\d,\s\u202f]*)\s*(?:req|ops)\/s\s+\(([\d.]+)ms\)/,
    ) || clean.match(
      /^(.+?)\s{2,}(\d[\d,\s\u202f]*)\s*bytes\/req\s+\(([\d.]+)ms\)/,
    );
    if (resultMatch && currentGroup) {
      const name = resultMatch[1]!.trim();
      const rps = parseInt(resultMatch[2]!.replace(/[\s\u202f,]/g, ""), 10);
      const avgMs = parseFloat(resultMatch[3]!);
      const hasErrors = clean.includes("⚠");

      currentGroup.results.push({ name, rps, avgMs, errors: hasErrors ? 1 : 0 });
    }
  }

  if (currentGroup) groups.push(currentGroup);
  return groups;
}

// ===== Main =====

async function runBenchScript(script: string, label: string): Promise<BenchTestGroup[]> {
  console.log(`\n  🏃 Running ${label}...`);
  console.log(`  ${"─".repeat(40)}`);

  const start = Date.now();
  const proc = Bun.spawnSync(["bun", "run", script], {
    cwd: join(__dirname),
    env: {
      ...process.env,
      BENCH_ITERATIONS: process.env.BENCH_ITERATIONS || "10000",
      BENCH_WARMUP: process.env.BENCH_WARMUP || "1000",
    },
  });
  const duration = ((Date.now() - start) / 1000).toFixed(1);

  if (!proc.success) {
    console.error(`  ❌ ${label} failed:`);
    console.error(proc.stderr.toString());
    // Try to parse whatever output we got
  }

  const stdout = proc.stdout.toString();
  const groups = parseBenchOutput(stdout);

  // Print a small summary
  let totalBenchmarks = 0;
  for (const g of groups) totalBenchmarks += g.results.length;
  if (groups.length > 0) {
    const best = groups.flatMap((g) => g.results).sort((a, b) => b.rps - a.rps)[0];
    console.log(
      `  ✅ ${label}: ${groups.length} groups, ${totalBenchmarks} benchmarks` +
        `${best ? `, best: ${best.name} @ ${best.rps.toLocaleString()} req/s` : ""}` +
        ` (${duration}s)`,
    );
  } else {
    console.log(`  ⚠️  ${label}: No results parsed (${duration}s)`);
    // Fallback: show raw output tail
    const tail = stdout.split("\n").slice(-10).join("\n");
    console.log(`  Raw output tail:\n${tail}`);
  }

  return groups;
}

async function main() {
  console.log("\n📊 AsiJS Benchmark Collector");
  console.log("═".repeat(50));

  mkdirSync(RESULTS_DIR, { recursive: true });

  const { commit, branch } = getCommitInfo();

  // Run all benchmark suites
  const allGroups: BenchTestGroup[] = [];

  try {
    const indexGroups = await runBenchScript("index.ts", "Core Benchmarks");
    allGroups.push(...indexGroups);
  } catch (e) {
    console.error("  ❌ Core benchmarks failed:", e);
  }

  try {
    const prodGroups = await runBenchScript("production.ts", "Production Benchmarks");
    allGroups.push(...prodGroups);
  } catch (e) {
    console.error("  ❌ Production benchmarks failed:", e);
  }

  try {
    const fullstackGroups = await runBenchScript("fullstack.ts", "Fullstack Benchmarks");
    allGroups.push(...fullstackGroups);
  } catch (e) {
    console.error("  ❌ Fullstack benchmarks failed:", e);
  }

  try {
    const p0Groups = await runBenchScript("p0.ts", "P0 Hot-Path Benchmarks");
    allGroups.push(...p0Groups);
  } catch (e) {
    console.error("  ❌ P0 benchmarks failed:", e);
  }

  try {
    const p1Groups = await runBenchScript("p1.ts", "P1 API-Case Benchmarks");
    allGroups.push(...p1Groups);
  } catch (e) {
    console.error("  ❌ P1 benchmarks failed:", e);
  }

  try {
    const p2Groups = await runBenchScript("p2.ts", "P2 Feature Benchmarks");
    allGroups.push(...p2Groups);
  } catch (e) {
    console.error("  ❌ P2 benchmarks failed:", e);
  }

  // Build snapshot
  const snapshot: BenchmarkSnapshot = {
    timestamp: new Date().toISOString(),
    commit,
    branch,
    groups: allGroups,
  };

  // Save latest
  const latestPath = join(RESULTS_DIR, "latest.json");
  writeFileSync(latestPath, JSON.stringify(snapshot, null, 2));
  console.log(`\n  💾 Saved: latest.json (${JSON.stringify(snapshot).length} bytes)`);

  // Save history (append with timestamp filename)
  const historyPath = join(RESULTS_DIR, `${snapshot.timestamp.replace(/[:.]/g, "-")}.json`);
  writeFileSync(historyPath, JSON.stringify(snapshot, null, 2));
  console.log(`  💾 Saved: ${historyPath.split("/").pop()}`);

  // Also append to history.jsonl (one JSON object per line, newlines escaped)
  const historyLinePath = join(RESULTS_DIR, "history.jsonl");
  // For JSONL, use single-line JSON
  const jsonlLine = JSON.stringify(snapshot);
  writeFileSync(historyLinePath, jsonlLine + "\n", { flag: "a" });

  console.log(`  💾 Appended: history.jsonl`);

  // Summary
  const totalGroups = allGroups.length;
  const totalBenchmarks = allGroups.reduce((s, g) => s + g.results.length, 0);
  console.log(`\n  📈 Summary: ${totalGroups} test groups, ${totalBenchmarks} benchmark results`);
  console.log(`  📍 Results in: ${RESULTS_DIR}`);
  console.log("═".repeat(50));
  console.log();
}

main().catch(console.error);
