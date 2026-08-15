/**
 * Benchmark Dashboard Generator
 *
 * Reads benchmark results from bench/results/ and generates
 * a static HTML dashboard with interactive Chart.js charts.
 *
 * Usage: bun run bench:dashboard
 *        bun run bench:dashboard --serve  (start local HTTP server)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { BenchmarkSnapshot } from "./results";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, "results");
const DASHBOARD_DIR = join(__dirname, "..", "docs", "public", "benchmarks");

// ===== Data Loading =====

function loadLatestSnapshot(): BenchmarkSnapshot | null {
  const latestPath = join(RESULTS_DIR, "latest.json");
  if (!existsSync(latestPath)) return null;
  return JSON.parse(readFileSync(latestPath, "utf-8"));
}

function loadHistorySnapshots(): BenchmarkSnapshot[] {
  const historyPath = join(RESULTS_DIR, "history.jsonl");
  if (!existsSync(historyPath)) return [];

  const lines = readFileSync(historyPath, "utf-8").split("\n").filter(Boolean);
  return lines.map((line) => JSON.parse(line));
}

// ===== HTML Generation =====

function generateDashboard(
  latest: BenchmarkSnapshot | null,
  history: BenchmarkSnapshot[],
): string {
  const latestJson = latest ? JSON.stringify(latest) : "null";
  const historyJson = JSON.stringify(history);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AsiJS Benchmarks</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
  <style>
    :root {
      --bg: #0d1117;
      --card: #161b22;
      --border: #30363d;
      --text: #e6edf3;
      --muted: #8b949e;
      --accent: #58a6ff;
      --green: #3fb950;
      --orange: #d29922;
      --red: #f85149;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      padding: 2rem;
      max-width: 1200px;
      margin: 0 auto;
    }
    h1 {
      font-size: 1.8rem;
      margin-bottom: 0.5rem;
    }
    h2 {
      font-size: 1.2rem;
      color: var(--accent);
      margin: 1.5rem 0 1rem;
    }
    .subtitle {
      color: var(--muted);
      font-size: 0.9rem;
      margin-bottom: 2rem;
    }
    .meta {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
      margin-bottom: 1.5rem;
    }
    .meta-item {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.5rem 1rem;
      font-size: 0.85rem;
    }
    .meta-item .label { color: var(--muted); }
    .meta-item .value { color: var(--text); font-weight: 600; }
    .charts-grid {
      display: grid;
      gap: 1.5rem;
      margin-bottom: 2rem;
    }
    .chart-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.5rem;
    }
    .chart-card h3 {
      font-size: 1rem;
      margin-bottom: 1rem;
      color: var(--text);
    }
    .chart-card .chart-container {
      position: relative;
      height: 300px;
    }
    .legend-row {
      display: flex;
      gap: 1.5rem;
      flex-wrap: wrap;
      margin-bottom: 0.75rem;
    }
    .legend-row span {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.8rem;
      color: var(--muted);
    }
    .legend-row .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      display: inline-block;
    }
    .table-wrap {
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }
    th {
      text-align: left;
      padding: 0.5rem 0.75rem;
      background: var(--bg);
      color: var(--muted);
      border-bottom: 1px solid var(--border);
      font-weight: 600;
      white-space: nowrap;
    }
    td {
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid var(--border);
    }
    td:first-child { font-weight: 500; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .rps-bar {
      display: inline-block;
      height: 16px;
      border-radius: 3px;
      min-width: 4px;
      vertical-align: middle;
      margin-right: 0.5rem;
    }
    .badge {
      display: inline-block;
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .badge-green { background: rgba(63, 185, 80, 0.15); color: var(--green); }
    .badge-yellow { background: rgba(210, 153, 34, 0.15); color: var(--orange); }
    .badge-red { background: rgba(248, 81, 73, 0.15); color: var(--red); }
    .trend-up { color: var(--green); }
    .trend-down { color: var(--red); }
    .footer {
      margin-top: 3rem;
      padding-top: 1rem;
      border-top: 1px solid var(--border);
      color: var(--muted);
      font-size: 0.8rem;
      text-align: center;
    }
    @media (max-width: 768px) {
      body { padding: 1rem; }
      .meta { flex-direction: column; }
    }
  </style>
</head>
<body>
  <h1>⚡ AsiJS Benchmark Dashboard</h1>
  <p class="subtitle">Real-time performance tracking across commits</p>

  <div id="meta" class="meta"></div>

  <div id="charts" class="charts-grid"></div>

  <h2>📋 Detailed Results — Latest Run</h2>
  <div id="table" class="table-wrap"></div>

  <h2>📈 Historical Trends</h2>
  <div class="chart-card">
    <h3>Avg Score vs Best — all categories (%)</h3>
    <div class="chart-container">
      <canvas id="trendChart"></canvas>
    </div>
  </div>
  <div class="chart-card">
    <h3>RPS by Category
      <select id="trendGroupSelect"
        style="background:#161b22;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:4px 8px;margin-left:8px;font-size:13px;"></select>
    </h3>
    <div class="chart-container">
      <canvas id="groupTrendChart"></canvas>
    </div>
  </div>

  <div class="footer">
    Generated by AsiJS Benchmark Dashboard —
    <span id="footerTime"></span>
  </div>

  <script>
    const LATEST = ${latestJson};
    const HISTORY = ${historyJson};

    const COLORS = [
      '#58a6ff', '#3fb950', '#d29922', '#f85149', '#bc8cff',
      '#79c0ff', '#56d364', '#e3b341', '#ff7b72', '#d2a8ff',
      '#7ee787', '#c69026', '#ffa198', '#c9d1d9',
    ];
    const COLOR_MAP = {};

    function getColor(name) {
      if (!COLOR_MAP[name]) {
        COLOR_MAP[name] = COLORS[Object.keys(COLOR_MAP).length % COLORS.length];
      }
      return COLOR_MAP[name];
    }

    function fmt(num) {
      return num.toLocaleString();
    }

    function fmtTime(iso) {
      const d = new Date(iso);
      return d.toLocaleString();
    }

    function scoreClass(pct) {
      if (pct >= 90) return 'badge-green';
      if (pct >= 70) return 'badge-yellow';
      return 'badge-red';
    }

    // Metadata
    if (LATEST) {
      const meta = document.getElementById('meta');
      meta.innerHTML = [
        '<div class="meta-item"><span class="label">Commit </span><span class="value">' + LATEST.commit + '</span></div>',
        '<div class="meta-item"><span class="label">Branch </span><span class="value">' + LATEST.branch + '</span></div>',
        '<div class="meta-item"><span class="label">Run </span><span class="value">' + fmtTime(LATEST.timestamp) + '</span></div>',
        '<div class="meta-item"><span class="label">Groups </span><span class="value">' + LATEST.groups.length + '</span></div>',
      ].join('');
    }

    // Charts
    if (LATEST) {
      const chartsContainer = document.getElementById('charts');

      LATEST.groups.forEach(function(group, gi) {
        const sorted = [...group.results].sort(function(a, b) { return b.rps - a.rps });
        const best = sorted[0] ? sorted[0].rps : 1;

        const card = document.createElement('div');
        card.className = 'chart-card';
        card.innerHTML =
          '<h3>' + group.name + '</h3>' +
          '<div class="chart-container"><canvas id="chart-' + gi + '"></canvas></div>';

        chartsContainer.appendChild(card);

        const ctx = document.getElementById('chart-' + gi).getContext('2d');
        new Chart(ctx, {
          type: 'bar',
          data: {
            labels: sorted.map(function(r) { return r.name }),
            datasets: [{
              label: 'Requests/sec',
              data: sorted.map(function(r) { return r.rps }),
              backgroundColor: sorted.map(function(r) { return getColor(r.name) }),
              borderRadius: 4,
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: function(ctx) {
                    const r = sorted[ctx.dataIndex];
                    return ' ' + fmt(r.rps) + ' req/s  (' + r.avgMs.toFixed(4) + 'ms)';
                  }
                }
              }
            },
            scales: {
              y: {
                beginAtZero: true,
                ticks: { callback: function(v) { return fmt(v) } },
                grid: { color: '#21262d' }
              },
              x: {
                grid: { display: false },
                ticks: { maxRotation: 30 }
              }
            }
          }
        });
      });
    }

    // Table
    if (LATEST) {
      const tableContainer = document.getElementById('table');
      let html = '<table><thead><tr>' +
        '<th>Group</th><th>Framework</th><th class="num">RPS</th><th class="num">Avg (ms)</th>' +
        '<th class="num">vs Best</th><th>Errors</th></tr></thead><tbody>';

      LATEST.groups.forEach(function(group) {
        const sorted = [...group.results].sort(function(a, b) { return b.rps - a.rps });
        const best = sorted[0] ? sorted[0].rps : 1;

        sorted.forEach(function(r, i) {
          const pct = (r.rps / best * 100).toFixed(1);
          const barW = Math.max(4, (r.rps / best * 100));
          html += '<tr>' +
            '<td>' + (i === 0 ? group.name : '') + '</td>' +
            '<td><span class="rps-bar" style="width:' + barW + 'px;background:' + getColor(r.name) + '"></span>' + r.name + '</td>' +
            '<td class="num">' + fmt(r.rps) + '</td>' +
            '<td class="num">' + r.avgMs.toFixed(4) + '</td>' +
            '<td class="num"><span class="badge ' + scoreClass(Number(pct)) + '">' + pct + '%</span></td>' +
            '<td class="num">' + (r.errors > 0 ? '⚠️ ' + r.errors : '—') + '</td>' +
            '</tr>';
        });
      });

      html += '</tbody></table>';
      tableContainer.innerHTML = html;
    }

    // Trend helpers
    // Allocation groups measure bytes/req — lower is better
    function isLowerBetter(groupName) {
      return /alloc/i.test(groupName);
    }

    /**
     * Normalized score for a framework in one snapshot:
     * average of (rps / groupBest * 100) across ALL groups the framework
     * appears in. For lower-is-better groups (allocations) the ratio is
     * inverted (groupBest / rps), so 100% always means "best in category".
     * Returns null when the framework is absent from every group.
     */
    function frameworkScore(snap, name) {
      let sum = 0, count = 0;
      snap.groups.forEach(function(g) {
        if (g.results.length < 2) return; // need a best to compare against
        const found = g.results.find(function(r) { return r.name === name });
        if (!found || found.rps <= 0) return;
        const best = g.results.reduce(function(acc, r) {
          if (r.rps <= 0) return acc;
          return isLowerBetter(g.name)
            ? Math.min(acc, r.rps)
            : Math.max(acc, r.rps);
        }, isLowerBetter(g.name) ? Infinity : -Infinity);
        if (best === Infinity || best === -Infinity || best <= 0) return;
        const ratio = isLowerBetter(g.name)
          ? best / found.rps
          : found.rps / best;
        sum += ratio * 100;
        count++;
      });
      return count > 0 ? { score: sum / count, categories: count } : null;
    }

    // Trend chart
    if (HISTORY.length > 1) {
      // Collect top framework names across history
      const frameworkNames = new Set();
      HISTORY.forEach(function(snap) {
        snap.groups.forEach(function(g) {
          g.results.forEach(function(r) { frameworkNames.add(r.name); });
        });
      });

      // Pick the top 5 most frequent
      const nameCounts = {};
      HISTORY.forEach(function(snap) {
        snap.groups.forEach(function(g) {
          g.results.forEach(function(r) {
            nameCounts[r.name] = (nameCounts[r.name] || 0) + 1;
          });
        });
      });
      const topNames = Object.entries(nameCounts)
        .sort(function(a, b) { return b[1] - a[1] })
        .slice(0, 5)
        .map(function(e) { return e[0] });

      const labels = HISTORY.map(function(snap) {
        return snap.commit.slice(0, 7);
      });

      // Dataset 1: normalized score over time (all categories)
      const scoreDatasets = topNames.map(function(name) {
        const data = HISTORY.map(function(snap) {
          const s = frameworkScore(snap, name);
          return s ? +s.score.toFixed(1) : null;
        });
        return {
          label: name,
          data: data,
          borderColor: getColor(name),
          backgroundColor: getColor(name) + '33',
          tension: 0.3,
          fill: false,
          pointRadius: 3,
        };
      });

      const trendCtx = document.getElementById('trendChart').getContext('2d');
      new Chart(trendCtx, {
        type: 'line',
        data: { labels: labels, datasets: scoreDatasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { intersect: false, mode: 'nearest' },
          plugins: {
            legend: {
              position: 'bottom',
              labels: { color: '#8b949e', padding: 16 }
            },
            tooltip: {
              callbacks: {
                title: function(items) {
                  const snap = HISTORY[items[0].dataIndex];
                  return snap.commit.slice(0, 7) + ' — ' + fmtTime(snap.timestamp);
                },
                label: function(item) {
                  const name = item.dataset.label;
                  const snap = HISTORY[item.dataIndex];
                  const s = frameworkScore(snap, name);
                  if (!s) return ' ' + name + ': n/a';
                  return ' ' + name + ': ' + s.score.toFixed(1) + '%' +
                    ' (avg of ' + s.categories + ' groups)';
                }
              }
            }
          },
          scales: {
            y: {
              min: 0,
              max: 100,
              ticks: { callback: function(v) { return fmt(v) }, color: '#8b949e' },
              grid: { color: '#21262d' }
            },
            x: {
              ticks: { color: '#8b949e' },
              grid: { display: false }
            }
          }
        }
      });

      // Dataset 2: raw RPS for a user-selected category
      // Collect all group names seen across history for the dropdown
      const allGroupNames = [];
      const seenGroups = new Set();
      HISTORY.forEach(function(snap) {
        snap.groups.forEach(function(g) {
          if (!seenGroups.has(g.name)) {
            seenGroups.add(g.name);
            allGroupNames.push(g.name);
          }
        });
      });

      // Prefer the simple GET group as the default selection
      const defaultGroup =
        allGroupNames.find(function(n) { return n.indexOf('GET / (simple') === 0 }) ||
        allGroupNames[0] || '';

      const select = document.getElementById('trendGroupSelect');
      if (select) {
        allGroupNames.forEach(function(gn) {
          const opt = document.createElement('option');
          opt.value = gn;
          opt.textContent = gn;
          select.appendChild(opt);
        });
        select.value = defaultGroup;
      }

      function buildGroupTrend(groupName) {
        return topNames.map(function(name) {
          const data = HISTORY.map(function(snap) {
            // Only results within the selected group, not the first match anywhere
            for (const g of snap.groups) {
              if (g.name !== groupName) continue;
              const found = g.results.find(function(r) { return r.name === name });
              return found ? found.rps : null;
            }
            return null;
          });
          return {
            label: name,
            data: data,
            borderColor: getColor(name),
            backgroundColor: getColor(name) + '33',
            tension: 0.3,
            fill: false,
            pointRadius: 3,
          };
        });
      }

      let groupChart = null;
      function renderGroupTrend() {
        const groupName = select ? select.value : defaultGroup;
        const gCtx = document.getElementById('groupTrendChart').getContext('2d');
        if (groupChart) groupChart.destroy();
        groupChart = new Chart(gCtx, {
          type: 'line',
          data: { labels: labels, datasets: buildGroupTrend(groupName) },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'nearest' },
            plugins: {
              legend: {
                position: 'bottom',
                labels: { color: '#8b949e', padding: 16 }
              },
              tooltip: {
                callbacks: {
                  title: function(items) {
                    const snap = HISTORY[items[0].dataIndex];
                    return snap.commit.slice(0, 7) + ' — ' + fmtTime(snap.timestamp);
                  },
                  label: function(item) {
                    const name = item.dataset.label;
                    if (item.raw === null) return ' ' + name + ': n/a';
                    return ' ' + name + ': ' + fmt(item.raw) + ' req/s';
                  }
                }
              }
            },
            scales: {
              y: {
                beginAtZero: true,
                ticks: { callback: function(v) { return fmt(v) }, color: '#8b949e' },
                grid: { color: '#21262d' }
              },
              x: {
                ticks: { color: '#8b949e' },
                grid: { display: false }
              }
            }
          }
        });
      }

      renderGroupTrend();
      if (select) select.addEventListener('change', renderGroupTrend);
    } else {
      document.getElementById('trendChart').parentElement.innerHTML =
        '<p style="color:var(--muted);text-align:center;padding:3rem">' +
        'Need at least 2 benchmark runs to show trends. ' +
        'Run <code>bun run bench:collect</code> again after making changes.</p>';
      document.getElementById('groupTrendChart').parentElement.innerHTML =
        '<p style="color:var(--muted);text-align:center;padding:3rem">' +
        'Need at least 2 benchmark runs to show trends.</p>';
    }

    document.getElementById('footerTime').textContent = new Date().toLocaleString();
  </script>
</body>
</html>`;
}

// ===== Main =====

function main() {
  mkdirSync(DASHBOARD_DIR, { recursive: true });

  const latest = loadLatestSnapshot();
  const history = loadHistorySnapshots();

  const html = generateDashboard(latest, history);
  const outPath = join(DASHBOARD_DIR, "index.html");
  writeFileSync(outPath, html);

  console.log(`\n  📊 Dashboard generated:`);
  console.log(`     ${outPath} (${html.length.toLocaleString()} bytes)`);
  console.log();

  if (latest) {
    console.log(`  📈 Latest: ${latest.groups.length} groups, ${latest.commit} @ ${latest.timestamp}`);
    console.log(`  📚 History: ${history.length} snapshots`);
  } else {
    console.log(`  ⚠️  No benchmark data found. Run "bun run bench:collect" first.`);
  }

  console.log();

  // Start local server if --serve flag
  if (process.argv.includes("--serve")) {
    const port = 3333;
    console.log(`  🌐 Starting server at http://localhost:${port}/benchmarks/\n`);
    Bun.serve({
      port,
      fetch(req) {
        const url = new URL(req.url);
        let filePath = join(__dirname, "..", "docs", url.pathname);
        if (url.pathname === "/" || url.pathname === "/benchmarks") {
          filePath = join(DASHBOARD_DIR, "index.html");
        }
        if (!existsSync(filePath)) {
          return new Response("Not Found", { status: 404 });
        }
        const ext = filePath.split(".").pop();
        const mimeTypes: Record<string, string> = {
          html: "text/html",
          js: "application/javascript",
          css: "text/css",
          json: "application/json",
          png: "image/png",
          svg: "image/svg+xml",
        };
        return new Response(readFileSync(filePath), {
          headers: { "Content-Type": mimeTypes[ext || ""] || "text/plain" },
        });
      },
    });
  }
}

main();
