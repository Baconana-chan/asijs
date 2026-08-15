/**
 * Db Studio (2.3) — embedded GUI for browsing and querying the database,
 * an analog of Prisma Studio.
 *
 * - Table list + row browser (paginated)
 * - Schema info per table
 * - SQL query runner
 *
 * Usage:
 * ```ts
 * import { Database, serveDbStudio } from "asijs";
 *
 * const db = new Database({ url: "file:./app.db" });
 * const server = serveDbStudio(db, { port: 5500 });
 * // open http://localhost:5500
 * ```
 */

import { Database } from "./database";

export interface DbStudioOptions {
  port?: number;
  hostname?: string;
  rowsPerPage?: number;
  silent?: boolean;
}

export interface StudioApiResponse {
  ok: boolean;
  tables?: string[];
  rows?: unknown[];
  columns?: string[];
  total?: number;
  page?: number;
  error?: string;
  executionMs?: number;
}

/**
 * Fetch handler for the studio — can be mounted into an Asi app:
 * ```ts
 * app.get("/__studio/*", studioHandler(db));
 * ```
 */
export function studioHandler(db: Database) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    // API routes
    if (url.pathname.endsWith("/api/tables")) {
      return json(await apiTables(db));
    }
    if (url.pathname.endsWith("/api/table")) {
      const table = url.searchParams.get("name") ?? "";
      const page = parseInt(url.searchParams.get("page") ?? "1", 10) || 1;
      return json(await apiTable(db, table, page));
    }
    if (url.pathname.endsWith("/api/query") && req.method === "POST") {
      const body = await req.json().catch(() => ({ sql: "" }));
      return json(await apiQuery(db, String(body.sql ?? "")));
    }

    // HTML page
    return new Response(renderStudioHTML(), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  };
}

function json(data: StudioApiResponse): Response {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function apiTables(db: Database): StudioApiResponse {
  try {
    return { ok: true, tables: db.listTables() };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function apiTable(db: Database, table: string, page: number): StudioApiResponse {
  try {
    if (!table) return { ok: false, error: "table name required" };
    const columns = db
      .tableInfo(table)
      .map((c) => ({ name: c.name, type: c.type, pk: c.pk === 1 }));
    const totalRow = db.first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${quoteIdent(table)}`,
    );
    const total = Number(totalRow?.n ?? 0);
    const perPage = 50;
    const offset = (page - 1) * perPage;
    const rows = db.query(
      `SELECT * FROM ${quoteIdent(table)} LIMIT ${perPage} OFFSET ${offset}`,
    );
    return {
      ok: true,
      rows,
      columns: columns.map((c) => c.name),
      total,
      page,
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function apiQuery(db: Database, sql: string): StudioApiResponse {
  if (!sql.trim()) return { ok: false, error: "empty query" };
  const start = performance.now();
  try {
    const rows = db.query(sql);
    return {
      ok: true,
      rows,
      executionMs: Math.round((performance.now() - start) * 10) / 10,
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Start a standalone studio HTTP server (used by `asi db studio`).
 */
export function serveDbStudio(db: Database, options: DbStudioOptions = {}) {
  const port = options.port ?? 5500;
  const hostname = options.hostname ?? "127.0.0.1";

  const server = (Bun as any).serve({
    port,
    hostname,
    fetch: (req: Request) => studioHandler(db)(req),
  });

  if (!options.silent) {
    console.log(`\n  🗄️  Db Studio: http://${hostname}:${server.port ?? port}\n`);
  }

  return server;
}

function renderStudioHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>🗄️ Db Studio — AsiJS</title>
<style>
  :root { color-scheme: light dark; --border: #444; --accent: #4f9cf9; }
  * { box-sizing: border-box; }
  body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: 0; background: #111; color: #ddd; }
  header { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--border); background: #1a1a1a; }
  header h1 { font-size: 15px; margin: 0; }
  .layout { display: grid; grid-template-columns: 220px 1fr; gap: 0; min-height: calc(100vh - 46px); }
  aside { border-right: 1px solid var(--border); padding: 12px; background: #161616; }
  aside h2 { font-size: 11px; text-transform: uppercase; color: #888; margin: 0 0 8px; }
  .table-item { padding: 6px 8px; border-radius: 4px; cursor: pointer; }
  .table-item:hover { background: #222; }
  .table-item.active { background: #2a3f5c; color: #fff; }
  main { padding: 16px; overflow: auto; }
  .toolbar { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
  input, textarea, select, button { background: #222; color: #ddd; border: 1px solid var(--border); border-radius: 4px; padding: 6px 10px; font: inherit; }
  button { cursor: pointer; }
  button:hover { border-color: var(--accent); }
  textarea { width: 100%; min-height: 90px; resize: vertical; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid var(--border); padding: 6px 10px; text-align: left; font-size: 13px; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  th { background: #1f1f1f; position: sticky; top: 0; }
  tr:nth-child(even) { background: #181818; }
  .meta { color: #888; font-size: 12px; margin: 4px 0 12px; }
  .error { color: #ff6b6b; }
  .ok { color: #6bff9f; }
  .pager { margin-top: 10px; display: flex; gap: 8px; align-items: center; }
  .json-val { color: #8ab4f8; }
</style>
</head>
<body>
<header>
  <h1>🗄️ Db Studio</h1>
  <span class="meta" id="dbmeta"></span>
</header>
<div class="layout">
  <aside>
    <h2>Tables</h2>
    <div id="tables"></div>
  </aside>
  <main>
    <div class="toolbar">
      <select id="tableSelect"></select>
      <input id="pageInput" type="number" min="1" value="1" style="width:70px" title="Page">
      <button onclick="loadTable()">Go</button>
      <span class="meta" id="tableMeta"></span>
    </div>
    <div id="tableContent"><div class="meta">Select a table on the left, or run a query below.</div></div>
    <h2 style="font-size:12px;color:#888;text-transform:uppercase">SQL Query</h2>
    <textarea id="sqlInput" placeholder="SELECT * FROM users LIMIT 50"></textarea>
    <div class="toolbar" style="margin-top:8px">
      <button onclick="runQuery()">▶ Run</button>
      <button onclick="clearQuery()">Clear</button>
      <span id="queryMeta" class="meta"></span>
    </div>
    <div id="queryResult"></div>
  </main>
</div>
<script>
let currentTable = null;
let page = 1;

async function j(url, opts) {
  const res = await fetch(url, opts);
  return res.json();
}

async function loadTables() {
  const data = await j('/api/tables');
  if (!data.ok) return;
  const box = document.getElementById('tables');
  const sel = document.getElementById('tableSelect');
  box.innerHTML = '';
  sel.innerHTML = '<option value="">— table —</option>';
  for (const t of data.tables || []) {
    const el = document.createElement('div');
    el.className = 'table-item' + (t === currentTable ? ' active' : '');
    el.textContent = t;
    el.onclick = () => { currentTable = t; page = 1; document.getElementById('pageInput').value = 1; loadTables(); loadTable(); };
    box.appendChild(el);
    const opt = document.createElement('option');
    opt.value = t; opt.textContent = t;
    if (t === currentTable) opt.selected = true;
    sel.appendChild(opt);
  }
}

async function loadTable() {
  const sel = document.getElementById('tableSelect');
  const table = currentTable || sel.value;
  if (!table) return;
  currentTable = table;
  page = parseInt(document.getElementById('pageInput').value, 10) || 1;
  const data = await j('/api/table?name=' + encodeURIComponent(table) + '&page=' + page);
  const content = document.getElementById('tableContent');
  const meta = document.getElementById('tableMeta');
  if (!data.ok) { content.innerHTML = '<div class="error">' + esc(data.error) + '</div>'; return; }
  const totalPages = Math.max(1, Math.ceil((data.total || 0) / 50));
  meta.textContent = 'total: ' + data.total + ' · page ' + data.page + ' / ' + totalPages;
  content.innerHTML = renderTable(data.rows || [], data.columns || []);
}

function renderTable(rows, cols) {
  if (!rows.length) return '<div class="meta">0 rows</div>';
  let h = '<table><thead><tr>' + cols.map(c => '<th>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>';
  for (const r of rows) {
    h += '<tr>' + cols.map(c => '<td class="json-val">' + esc(format(r[c])) + '</td>').join('') + '</tr>';
  }
  return h + '</tbody></table>';
}

function format(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

async function runQuery() {
  const sql = document.getElementById('sqlInput').value;
  const meta = document.getElementById('queryMeta');
  const res = document.getElementById('queryResult');
  meta.textContent = 'running…';
  const data = await j('/api/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  });
  if (!data.ok) {
    meta.textContent = '';
    res.innerHTML = '<div class="error">' + esc(data.error) + '</div>';
    return;
  }
  meta.innerHTML = '<span class="ok">ok</span> · ' + (data.executionMs ?? 0) + 'ms · ' + (data.rows?.length ?? 0) + ' rows';
  const rows = data.rows || [];
  if (!rows.length) { res.innerHTML = '<div class="meta">0 rows</div>'; return; }
  const cols = Object.keys(rows[0]);
  res.innerHTML = renderTable(rows, cols);
}

function clearQuery() {
  document.getElementById('sqlInput').value = '';
  document.getElementById('queryResult').innerHTML = '';
  document.getElementById('queryMeta').textContent = '';
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

loadTables();
</script>
</body>
</html>`;
}
