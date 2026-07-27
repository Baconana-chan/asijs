/**
 * API Documentation Portal — полноценный портал документации API
 *
 * Включает:
 * - Интерактивный веб-портал с поиском, группировкой по тегам, тёмной/светлой темой
 * - Code samples для curl, Python, JavaScript, Go
 * - Try-it-out: выполнение реальных запросов к серверу
 * - Экспорт в Markdown / HTML для CI/CD пайплайнов
 * - Changelog и version diff между версиями API
 *
 * @example
 * ```ts
 * import { Asi, apiDocsPlugin } from "asijs";
 *
 * const app = new Asi();
 * app.get("/users", () => [{ id: 1, name: "Alice" }]);
 *
 * app.plugin(apiDocsPlugin({
 *   title: "My API",
 *   version: "1.2.0",
 *   description: "REST API for MyApp",
 * }));
 *
 * // Portal at /docs
 * // OpenAPI spec at /openapi.json
 * // Try-it-out proxy at /docs/_proxy
 * app.listen(3000);
 * ```
 */

import { createPlugin, type AsiPlugin } from "./plugin";
import type { Context } from "./context";
import type { RouteMethod } from "./types";
import type { TSchema } from "@sinclair/typebox";
import type { RouteInfo, MiddlewareInfo, AppConfigInfo } from "./asi";
import type { OpenAPIOptions, OpenAPIDocument, OpenAPIParameter } from "./openapi";
import { OpenAPIGenerator, type DocumentedRoute, type RouteDocumentation } from "./openapi";

// ========================================================================
// Types
// ========================================================================

/** API Documentation Portal configuration */
export interface ApiDocsOptions {
  /** API title */
  title: string;
  /** API version */
  version: string;
  /** API description */
  description?: string;
  /** Portal base path (default: /docs) */
  path?: string;
  /** OpenAPI spec path (default: /openapi.json) */
  specPath?: string;
  /** API base URL for try-it-out (default: inferred from request) */
  apiBaseUrl?: string;
  /** Enable try-it-out feature (default: true) */
  tryItOut?: boolean;
  /** Enable changelog (default: true) */
  changelog?: boolean;
  /** Tags/groups for organizing endpoints */
  tags?: Array<{ name: string; description?: string }>;
  /** Custom code samples per route */
  customSamples?: Record<string, Array<{ lang: string; label: string; code: string }>>;
  /** Security schemes for code samples */
  securitySchemes?: Record<string, { type: string; in?: string; name?: string; scheme?: string }>;
  /** Auth token for try-it-out (default: none) */
  authToken?: string;
  /** Theme: "dark" | "light" | "auto" (default: "auto") */
  theme?: "dark" | "light" | "auto";
  /** Custom CSS to inject into portal page */
  customCSS?: string;
  /** Custom logo/header HTML */
  logo?: string;
  /** Server URL for code samples (default: inferred) */
  serverUrl?: string;
  /** Contact email */
  contactEmail?: string;
  /** Repository URL */
  repoUrl?: string;
  /** License info */
  license?: { name: string; url?: string };
  /** Enable verbose logging */
  verbose?: boolean;
}

/** Code sample in a specific language */
export interface CodeSample {
  label: string;
  lang: string;
  code: string;
}

/** A single API endpoint documented */
export interface ApiEndpoint {
  method: RouteMethod;
  path: string;
  summary?: string;
  description?: string;
  tags?: string[];
  deprecated?: boolean;
  parameters?: Array<{
    name: string;
    in: "path" | "query" | "header";
    required?: boolean;
    schema: { type?: string; description?: string };
  }>;
  requestBody?: {
    required?: boolean;
    schema?: unknown;
  };
  responses?: Record<string, { description: string; schema?: unknown }>;
}

/** Snapshot of API for changelog / diff */
export interface ApiSnapshot {
  version: string;
  timestamp: number;
  endpoints: ApiEndpoint[];
  tags?: Array<{ name: string; description?: string }>;
}

/** Diff result between two API versions */
export interface ApiDiff {
  added: ApiEndpoint[];
  removed: ApiEndpoint[];
  changed: Array<{
    endpoint: ApiEndpoint;
    changes: string[];
  }>;
  fromVersion: string;
  toVersion: string;
}

// ========================================================================
// Code Sample Generators
// ========================================================================

/**
 * Generate code samples for an API endpoint.
 */
export function generateCodeSamples(
  endpoint: ApiEndpoint,
  baseUrl: string,
  authToken?: string,
  bodyExample?: unknown,
): CodeSample[] {
  const method = endpoint.method.toLowerCase();
  const fullUrl = `${baseUrl}${endpoint.path}`;
  const hasBody = ["post", "put", "patch"].includes(method) && !!endpoint.requestBody;
  const jsonBody = bodyExample ?? guessExampleBody(endpoint);

  return [
    generateCurlSample(method, fullUrl, authToken, jsonBody, hasBody),
    generateJsSample(method, fullUrl, authToken, jsonBody, hasBody),
    generatePythonSample(method, fullUrl, authToken, jsonBody, hasBody),
    generateGoSample(method, fullUrl, authToken, jsonBody, hasBody),
  ];
}

function generateCurlSample(
  method: string,
  url: string,
  auth?: string,
  body?: unknown,
  hasBody?: boolean,
): CodeSample {
  const parts = [`curl -X ${method.toUpperCase()}`, `  "${url}"`];

  if (auth) {
    parts.push(`  -H "Authorization: Bearer ${auth}"`);
  }
  parts.push(`  -H "Content-Type: application/json"`);

  if (hasBody && body !== undefined) {
    parts.push(`  -d '${JSON.stringify(body, null, 2).replace(/'/g, "\\'")}'`);
  }

  return { label: "curl", lang: "bash", code: parts.join(" \\\n") };
}

function generateJsSample(
  method: string,
  url: string,
  auth?: string,
  body?: unknown,
  hasBody?: boolean,
): CodeSample {
  const lines: string[] = [];

  if (hasBody) {
    lines.push(`const data = ${JSON.stringify(body, null, 2)};`);
    lines.push("");
  }

  lines.push(`const response = await fetch("${url}", {`);
  lines.push(`  method: "${method.toUpperCase()}",`);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) headers["Authorization"] = `Bearer ${auth}`;

  lines.push(`  headers: ${JSON.stringify(headers, null, 4)}`);
  if (hasBody) lines.push(`  body: JSON.stringify(data)`);
  lines.push(`});`);
  lines.push(``);
  lines.push(`const result = await response.json();`);
  lines.push(`console.log(result);`);

  return { label: "JavaScript", lang: "javascript", code: lines.join("\n") };
}

function generatePythonSample(
  method: string,
  url: string,
  auth?: string,
  body?: unknown,
  hasBody?: boolean,
): CodeSample {
  const lines: string[] = [];

  lines.push(`import requests`);
  lines.push(``);

  if (hasBody) {
    lines.push(`data = ${JSON.stringify(body, null, 2).replace(/\n/g, "\n")}`);
    lines.push(``);
  }

  lines.push(`headers = {`);
  lines.push(`    "Content-Type": "application/json",`);
  if (auth) lines.push(`    "Authorization": "Bearer ${auth}",`);
  lines.push(`}`);
  lines.push(``);

  if (hasBody) {
    lines.push(`response = requests.${method}("${url}", json=data, headers=headers)`);
  } else {
    lines.push(`response = requests.${method}("${url}", headers=headers)`);
  }
  lines.push(`print(response.json())`);

  return { label: "Python", lang: "python", code: lines.join("\n") };
}

function generateGoSample(
  method: string,
  url: string,
  auth?: string,
  body?: unknown,
  hasBody?: boolean,
): CodeSample {
  const lines: string[] = [];
  const varName = hasBody ? "payload" : "req";

  if (hasBody) {
    lines.push(`import (`);
    lines.push(`    "bytes"`);
    lines.push(`    "encoding/json"`);
    lines.push(`    "fmt"`);
    lines.push(`    "net/http"`);
    lines.push(`)`);
    lines.push(``);
    lines.push(`data := ${JSON.stringify(body)}`);
    lines.push(`${varName} := bytes.NewBuffer(data)`);
    lines.push(``);
  } else {
    lines.push(`import (`);
    lines.push(`    "fmt"`);
    lines.push(`    "net/http"`);
    lines.push(`)`);
    lines.push(``);
    lines.push(`${varName}, _ := http.NewRequest("${method.toUpperCase()}", "${url}", nil)`);
  }

  if (!hasBody) {
    lines.push(``);
  }
  if (auth) {
    lines.push(`${varName}.Header.Set("Authorization", "Bearer ${auth}")`);
  }
  lines.push(`${varName}.Header.Set("Content-Type", "application/json")`);

  lines.push(``);
  lines.push(`client := &http.Client{}`);
  if (hasBody) {
    lines.push(`req, _ := http.NewRequest("${method.toUpperCase()}", "${url}", ${varName})`);
    lines.push(`req.Header.Set("Content-Type", "application/json")`);
    if (auth) lines.push(`req.Header.Set("Authorization", "Bearer ${auth}")`);
  }
  lines.push(`resp, err := client.Do(${varName})`);
  lines.push(`if err != nil {`);
  lines.push(`    panic(err)`);
  lines.push(`}`);
  lines.push(`defer resp.Body.Close()`);
  lines.push(``);
  lines.push(`fmt.Println(resp.Status)`);

  return { label: "Go", lang: "go", code: lines.join("\n") };
}

function guessExampleBody(endpoint: ApiEndpoint): unknown {
  if (!endpoint.requestBody?.schema) return { key: "value" };

  const schema = endpoint.requestBody.schema as Record<string, unknown>;
  if (schema.properties) {
    const example: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(schema.properties as Record<string, unknown>)) {
      const p = prop as Record<string, unknown>;
      if (p.type === "string") example[key] = "string";
      else if (p.type === "number" || p.type === "integer") example[key] = 0;
      else if (p.type === "boolean") example[key] = true;
      else if (p.type === "object") example[key] = {};
      else if (p.type === "array") example[key] = [];
      else example[key] = null;
    }
    return Object.keys(example).length > 0 ? example : { key: "value" };
  }

  return { key: "value" };
}

// ========================================================================
// Portal HTML Generator
// ========================================================================

/**
 * Generate the full HTML for the documentation portal.
 */
export function generatePortalHTML(options: {
  title: string;
  version: string;
  description?: string;
  theme?: "dark" | "light" | "auto";
  specPath: string;
  proxyPath: string;
  tags?: Array<{ name: string; description?: string }>;
  customCSS?: string;
  logo?: string;
  contactEmail?: string;
  repoUrl?: string;
  license?: { name: string; url?: string };
  endpointCount?: number;
}): string {
  const theme = options.theme ?? "auto";

  // Guard: if PROXY_PATH is empty, disable try-it-out button in static exports
  const disableTryItOut = !options.proxyPath;

  return `<!DOCTYPE html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(options.title)} v${escapeHtml(options.version)} — API Docs</title>
<style>
  :root {
    --bg: #ffffff; --bg2: #f8f9fa; --bg3: #e9ecef;
    --text: #212529; --text2: #495057; --text3: #868e96;
    --border: #dee2e6;
    --primary: #4263eb; --primary-hover: #3b5bdb;
    --get: #2b8a3e; --post: #e67700; --put: #4263eb;
    --patch: #e67700; --delete: #c92a2a; --head: #868e96; --options: #5c7cba;
    --code-bg: #1e1e2e; --code-text: #cdd6f4;
    --success: #2b8a3e; --error: #c92a2a;
    --shadow: 0 1px 3px rgba(0,0,0,0.12);
    --radius: 8px; --radius-sm: 4px;
    --font: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    --font-mono: 'SF Mono','Fira Code','Cascadia Code',monospace;
    --sidebar-width: 300px;
  }
  [data-theme="dark"] {
    --bg: #1a1b26; --bg2: #1e2030; --bg3: #24253a;
    --text: #cdd6f4; --text2: #a6adc8; --text3: #6c7086;
    --border: #363a4f;
    --shadow: 0 1px 3px rgba(0,0,0,0.4);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--font); background: var(--bg); color: var(--text); line-height: 1.6; }
  /* Layout */
  .layout { display: flex; min-height: 100vh; }
  .sidebar { width: var(--sidebar-width); background: var(--bg2); border-right: 1px solid var(--border); overflow-y: auto; position: fixed; top: 0; left: 0; bottom: 0; z-index: 10; }
  .sidebar-header { padding: 20px; border-bottom: 1px solid var(--border); }
  .sidebar-header h1 { font-size: 1.1rem; font-weight: 700; }
  .sidebar-header .version { font-size: 0.8rem; color: var(--text3); margin-top: 4px; }
  .sidebar-header .desc { font-size: 0.85rem; color: var(--text2); margin-top: 8px; line-height: 1.4; }
  .sidebar-search { padding: 12px 16px; border-bottom: 1px solid var(--border); }
  .sidebar-search input { width: 100%; padding: 8px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); color: var(--text); font-size: 0.85rem; outline: none; transition: border-color 0.2s; }
  .sidebar-search input:focus { border-color: var(--primary); }
  .sidebar-tags { padding: 12px 16px; }
  .tag-count { font-size: 0.75rem; color: var(--text3); margin-left: 8px; font-weight: 400; }
  .sidebar-nav { list-style: none; padding: 0 0 20px; }
  .sidebar-nav li { border-bottom: 1px solid var(--border); cursor: pointer; transition: background 0.15s; }
  .sidebar-nav li:hover { background: var(--bg3); }
  .sidebar-nav li.active { background: var(--bg3); border-left: 3px solid var(--primary); }
  .sidebar-nav a { display: flex; align-items: center; gap: 8px; padding: 10px 16px; text-decoration: none; color: var(--text); font-size: 0.85rem; }
  .method-badge { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 0.7rem; font-weight: 700; color: #fff; text-transform: uppercase; min-width: 52px; text-align: center; font-family: var(--font-mono); }
  .method-get { background: var(--get); }
  .method-post { background: var(--post); }
  .method-put { background: var(--put); }
  .method-patch { background: var(--patch); }
  .method-delete { background: var(--delete); }
  .method-head { background: var(--head); }
  .method-options { background: var(--options); }
  .endpoint-path { font-family: var(--font-mono); font-size: 0.8rem; color: var(--text2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* Main content */
  .main { margin-left: var(--sidebar-width); flex: 1; padding: 0; }
  .hero { padding: 40px 48px 24px; border-bottom: 1px solid var(--border); background: var(--bg2); }
  .hero h1 { font-size: 1.8rem; font-weight: 800; }
  .hero p { color: var(--text2); margin-top: 8px; max-width: 640px; }
  .hero-meta { display: flex; gap: 24px; margin-top: 16px; font-size: 0.85rem; color: var(--text3); }
  .hero-meta a { color: var(--primary); text-decoration: none; }
  .hero-meta a:hover { text-decoration: underline; }
  .content { padding: 24px 48px 80px; }
  /* Endpoint card */
  .endpoint { margin-bottom: 16px; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; transition: box-shadow 0.2s; }
  .endpoint:hover { box-shadow: var(--shadow); }
  .endpoint-header { display: flex; align-items: center; gap: 12px; padding: 14px 20px; background: var(--bg2); cursor: pointer; user-select: none; }
  .endpoint-header:hover { background: var(--bg3); }
  .endpoint-header .arrow { margin-left: auto; transition: transform 0.2s; color: var(--text3); }
  .endpoint-header .arrow.open { transform: rotate(90deg); }
  .endpoint-path-full { font-family: var(--font-mono); font-size: 0.9rem; }
  .endpoint-summary { font-size: 0.85rem; color: var(--text2); margin-left: 8px; }
  .endpoint-deprecated { font-size: 0.7rem; background: var(--error); color: #fff; padding: 2px 6px; border-radius: 3px; text-transform: uppercase; margin-left: 8px; }
  .endpoint-body { padding: 0 20px 20px; display: none; }
  .endpoint-body.open { display: block; }
  .endpoint-desc { padding: 12px 0; font-size: 0.9rem; color: var(--text2); line-height: 1.5; }
  /* Params tables */
  .params-table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 0.85rem; }
  .params-table th { text-align: left; padding: 8px 12px; background: var(--bg2); border-bottom: 2px solid var(--border); font-weight: 600; color: var(--text2); }
  .params-table td { padding: 8px 12px; border-bottom: 1px solid var(--border); }
  .params-table .required { display: inline-block; width: 6px; height: 6px; background: var(--error); border-radius: 50%; margin-right: 6px; }
  .param-type { font-family: var(--font-mono); font-size: 0.8rem; color: var(--text3); }
  /* Code samples */
  .code-tabs { display: flex; gap: 2px; margin: 12px 0; }
  .code-tab { padding: 6px 14px; background: var(--bg2); border: 1px solid var(--border); border-bottom: none; border-radius: var(--radius-sm) var(--radius-sm) 0 0; cursor: pointer; font-size: 0.8rem; color: var(--text2); transition: all 0.15s; }
  .code-tab:hover { background: var(--bg3); }
  .code-tab.active { background: var(--code-bg); color: var(--code-text); border-color: var(--code-bg); }
  .code-block { background: var(--code-bg); color: var(--code-text); border-radius: 0 var(--radius-sm) var(--radius-sm); padding: 16px; overflow-x: auto; font-family: var(--font-mono); font-size: 0.8rem; line-height: 1.5; margin: 0 0 16px; }
  .code-block pre { margin: 0; }
  .code-block code { white-space: pre; }
  .copy-btn { float: right; padding: 4px 10px; background: var(--bg3); border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: pointer; font-size: 0.75rem; color: var(--text2); transition: all 0.15s; }
  .copy-btn:hover { background: var(--primary); color: #fff; border-color: var(--primary); }
  /* Try-it-out */
  .try-section { margin: 16px 0; padding: 16px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg2); }
  .try-section h4 { font-size: 0.85rem; margin-bottom: 12px; color: var(--text2); }
  .try-body textarea { width: 100%; min-height: 80px; padding: 10px; font-family: var(--font-mono); font-size: 0.8rem; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: var(--radius-sm); resize: vertical; }
  .try-send { padding: 8px 20px; background: var(--primary); color: #fff; border: none; border-radius: var(--radius-sm); font-size: 0.85rem; cursor: pointer; transition: background 0.15s; margin-top: 8px; }
  .try-send:hover { background: var(--primary-hover); }
  .try-result { margin-top: 12px; padding: 12px; background: var(--code-bg); color: var(--code-text); border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: 0.8rem; white-space: pre-wrap; display: none; max-height: 300px; overflow-y: auto; }
  .try-result.show { display: block; }
  .try-status { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 0.75rem; font-weight: 600; margin-bottom: 8px; }
  .try-status.success { background: var(--success); color: #fff; }
  .try-status.error { background: var(--error); color: #fff; }
  /* Scrollbar */
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--text3); border-radius: 3px; }
  /* Responsive */
  @media (max-width: 900px) { .sidebar { width: 100%; position: relative; max-height: 40vh; border-right: none; border-bottom: 1px solid var(--border); } .main { margin-left: 0; } .content { padding: 16px; } .hero { padding: 24px; } }
</style>
${options.customCSS ? `<style>${options.customCSS}</style>` : ""}
</head>
<body>
<div class="layout">
  <aside class="sidebar" id="sidebar">
    <div class="sidebar-header">
      <h1>${options.logo ? options.logo : escapeHtml(options.title)}</h1>
      <div class="version">v${escapeHtml(options.version)}${options.endpointCount ? ` · ${options.endpointCount} endpoints` : ""}</div>
      ${options.description ? `<div class="desc">${escapeHtml(options.description)}</div>` : ""}
    </div>
    <div class="sidebar-search"><input type="text" id="search" placeholder="Search endpoints..." oninput="filterEndpoints(this.value)"></div>
    <div class="sidebar-tags" id="tagFilter"></div>
    <ul class="sidebar-nav" id="endpointList"></ul>
  </aside>
  <main class="main">
    <div class="hero">
      <h1>${options.logo ? options.logo : escapeHtml(options.title)}</h1>
      <p>${options.description ? escapeHtml(options.description) : "API Documentation"}</p>
      <div class="hero-meta">
        <span>v${escapeHtml(options.version)}</span>
        <span>${options.endpointCount ?? 0} endpoints</span>
        ${options.contactEmail ? `<span>Contact: <a href="mailto:${escapeHtml(options.contactEmail)}">${escapeHtml(options.contactEmail)}</a></span>` : ""}
        ${options.repoUrl ? `<span><a href="${escapeHtml(options.repoUrl)}" target="_blank">Repository</a></span>` : ""}
        ${options.license ? `<span>License: ${options.license.url ? `<a href="${escapeHtml(options.license.url)}" target="_blank">` : ""}${escapeHtml(options.license.name)}${options.license.url ? "</a>" : ""}</span>` : ""}
      </div>
    </div>
    <div class="content" id="content">
      <p style="color:var(--text3);text-align:center;padding:40px">Loading API documentation…</p>
    </div>
  </main>
</div>
<script>
const SPEC_PATH = ${JSON.stringify(options.specPath)};
const PROXY_PATH = ${JSON.stringify(options.proxyPath)};
const AUTH_TOKEN = "";
let endpoints = [];
let filteredEndpoints = [];

async function init() {
  try {
    const res = await fetch(SPEC_PATH);
    const spec = await res.json();
    endpoints = flattenSpec(spec);
    renderSidebar(endpoints, spec.tags || []);
    renderEndpoints(endpoints);
  } catch(e) {
    document.getElementById('content').innerHTML = '<p style="color:var(--error);text-align:center;padding:40px">Failed to load API spec.</p>';
  }
}

function flattenSpec(spec) {
  const eps = [];
  for (const [path, methods] of Object.entries(spec.paths || {})) {
    for (const [method, op] of Object.entries(methods)) {
      eps.push({ path, method, ...op, _key: method.toUpperCase() + ' ' + path });
    }
  }
  return eps;
}

function renderSidebar(eps, tags) {
  const list = document.getElementById('endpointList');
  list.innerHTML = '';
  filteredEndpoints = eps;
  eps.forEach((ep, i) => {
    const li = document.createElement('li');
    li.dataset.index = i;
    li.innerHTML = '<a href="#" onclick="scrollToEndpoint('+i+');return false"><span class="method-badge method-'+ep.method+'">'+ep.method.toUpperCase()+'</span><span class="endpoint-path">'+escapeHtml(ep.path)+'</span></a>';
    list.appendChild(li);
  });
  // Tag filter
  const tagDiv = document.getElementById('tagFilter');
  if (tags.length > 1) {
    let html = '<button class="code-tab active" onclick="filterByTag(null)">All</button>';
    tags.forEach(t => { html += '<button class="code-tab" onclick="filterByTag(\\''+t.name+'\\')">'+escapeHtml(t.name)+'</button>'; });
    tagDiv.innerHTML = html;
  }
}

function filterByTag(tag) {
  document.querySelectorAll('#tagFilter .code-tab').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  filteredEndpoints = tag ? endpoints.filter(e => (e.tags||[]).includes(tag)) : endpoints;
  const list = document.getElementById('endpointList');
  list.innerHTML = '';
  filteredEndpoints.forEach((ep, i) => {
    const li = document.createElement('li');
    li.dataset.index = i;
    li.innerHTML = '<a href="#" onclick="scrollToEndpoint('+i+');return false"><span class="method-badge method-'+ep.method+'">'+ep.method.toUpperCase()+'</span><span class="endpoint-path">'+escapeHtml(ep.path)+'</span></a>';
    list.appendChild(li);
  });
}

function filterEndpoints(query) {
  const q = query.toLowerCase();
  const eps = endpoints.filter(e => e.path.toLowerCase().includes(q) || (e.summary||'').toLowerCase().includes(q) || (e.tags||[]).some(t => t.toLowerCase().includes(q)));
  filteredEndpoints = eps;
  const list = document.getElementById('endpointList');
  list.innerHTML = '';
  eps.forEach((ep, i) => {
    const li = document.createElement('li');
    li.innerHTML = '<a href="#" onclick="scrollToEndpoint('+i+');return false"><span class="method-badge method-'+ep.method+'">'+ep.method.toUpperCase()+'</span><span class="endpoint-path">'+escapeHtml(ep.path)+'</span></a>';
    list.appendChild(li);
  });
}

function scrollToEndpoint(index) {
  const ep = filteredEndpoints[index];
  const id = 'ep-' + index;
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  document.querySelectorAll('.sidebar-nav li').forEach(l => l.classList.remove('active'));
  event?.target?.closest('li')?.classList.add('active');
}

function renderEndpoints(eps) {
  const container = document.getElementById('content');
  if (!eps.length) { container.innerHTML = '<p style="color:var(--text3);text-align:center;padding:40px">No endpoints found.</p>'; return; }
  let html = '';
  eps.forEach((ep, i) => {
    const id = 'ep-' + i;
    html += '<div class="endpoint" id="'+id+'">';
    html += '<div class="endpoint-header" onclick="toggleBody(this)"><span class="method-badge method-'+ep.method+'">'+ep.method.toUpperCase()+'</span><span class="endpoint-path-full">'+escapeHtml(ep.path)+'</span>'+(ep.summary?'<span class="endpoint-summary">'+escapeHtml(ep.summary)+'</span>':'')+(ep.deprecated?'<span class="endpoint-deprecated">deprecated</span>':'')+'<span class="arrow">›</span></div>';
    html += '<div class="endpoint-body">';
    if(ep.description) html += '<div class="endpoint-desc">'+escapeHtml(ep.description)+'</div>';
    // Parameters
    if(ep.parameters && ep.parameters.length) {
      html += '<h4 style="font-size:0.85rem;margin:12px 0 8px;color:var(--text2)">Parameters</h4><table class="params-table"><thead><tr><th>Name</th><th>In</th><th>Type</th><th>Description</th></tr></thead><tbody>';
      ep.parameters.forEach(p => {
        html += '<tr><td>'+(p.required?'<span class="required"></span>':'')+escapeHtml(p.name)+'</td><td>'+p.in+'</td><td><span class="param-type">'+(p.schema?.type||'string')+'</span></td><td>'+(p.description?escapeHtml(p.description):'')+'</td></tr>';
      });
      html += '</tbody></table>';
    }
    // Request body
    if(ep.requestBody) {
      html += '<h4 style="font-size:0.85rem;margin:12px 0 8px;color:var(--text2)">Request Body</h4>';
      html += '<div class="code-block"><pre><code>'+escapeHtml(JSON.stringify(ep.requestBody.schema||{},null,2))+'</code></pre></div>';
    }
    // Responses
    if(ep.responses) {
      html += '<h4 style="font-size:0.85rem;margin:12px 0 8px;color:var(--text2)">Responses</h4><table class="params-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>';
      Object.entries(ep.responses).forEach(([status, resp]) => {
        html += '<tr><td><strong>'+status+'</strong></td><td>'+escapeHtml(resp.description||'')+'</td></tr>';
        if(resp.content?.['application/json']?.schema) {
          html += '<tr><td></td><td><div class="code-block" style="margin:4px 0"><pre><code>'+escapeHtml(JSON.stringify(resp.content['application/json'].schema,null,2))+'</code></pre></div></td></tr>';
        }
      });
      html += '</tbody></table>';
    }
    // Code samples + Try-it-out
    html += '<div id="samples-'+i+'"></div>';
    html += '<div class="try-section" id="try-'+i+'"><h4>Try it out</h4><div class="try-body"><textarea id="try-body-'+i+'" placeholder="Request body (JSON)"></textarea><button class="try-send" onclick="tryEndpoint('+i+')">Send Request</button><div class="try-result" id="try-result-'+i+'"></div></div></div>';
    html += '</div></div>';
  });
  container.innerHTML = html;
  // Load code samples for each endpoint
  eps.forEach((ep, i) => {
    loadSamples(i, ep);
  });
}

async function loadSamples(index, ep) {
  try {
    // Generate samples client-side from the spec
    const samples = generateSamples(ep);
    const container = document.getElementById('samples-'+index);
    if (!container) return;
    let html = '<div class="code-tabs">';
    samples.forEach((s, si) => { html += '<button class="code-tab'+(si===0?' active':'')+'" onclick="switchSample('+index+','+si+')">'+s.label+'</button>'; });
    html += '</div>';
    samples.forEach((s, si) => {
      html += '<div class="code-block" id="sample-'+index+'-'+si+'"'+(si===0?'':' style="display:none"')+'><button class="copy-btn" onclick="copyCode(this)">Copy</button><pre><code>'+escapeHtml(s.code)+'</code></pre></div>';
    });
    container.innerHTML = html;
  } catch(e) {
    console.warn('[API Docs] Failed to load samples:', e);
  }
}

function switchSample(idx, si) {
  document.querySelectorAll('#samples-'+idx+' .code-tab').forEach((t,i) => t.classList.toggle('active', i===si));
  document.querySelectorAll('#samples-'+idx+' .code-block').forEach((b,i) => b.style.display = i===si ? 'block' : 'none');
}

function toggleBody(header) {
  header.classList.toggle('open');
  const body = header.nextElementSibling;
  body.classList.toggle('open');
  header.querySelector('.arrow')?.classList.toggle('open');
}

async function tryEndpoint(index) {
  if (!PROXY_PATH) return;
  const ep = filteredEndpoints[index] || endpoints[index];
  const btn = document.querySelector('#try-'+index+' .try-send');
  const result = document.getElementById('try-result-'+index);
  const bodyInput = document.getElementById('try-body-'+index);
  btn.disabled = true; btn.textContent = 'Sending...';
  result.classList.remove('show'); result.innerHTML = '';
  try {
    const hasBody = ['post','put','patch'].includes(ep.method);
    const res = await fetch(PROXY_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: ep.method.toUpperCase(), path: ep.path, body: hasBody && bodyInput.value ? JSON.parse(bodyInput.value) : undefined })
    });
    const text = await res.text();
    let pretty = text;
    try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch(e) {}
    result.innerHTML = '<div class="try-status '+(res.ok?'success':'error')+'">HTTP ' + res.status + ' ' + res.statusText + '</div>' + escapeHtml(pretty);
    result.classList.add('show');
  } catch(e) {
    result.innerHTML = '<div class="try-status error">Error: '+escapeHtml(e.message)+'</div>';
    result.classList.add('show');
  } finally { btn.disabled = false; btn.textContent = 'Send Request'; }
}

function copyCode(btn) {
  const code = btn.parentElement.querySelector('code').textContent;
  navigator.clipboard.writeText(code).then(() => { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy'; }, 2000); });
}

function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function generateSamples(ep) {
  const method = ep.method.toUpperCase();
  const url = window.location.origin + ep.path;
  const hasBody = ['POST','PUT','PATCH'].includes(method) && ep.requestBody;
  const body = hasBody ? (ep.requestBody?.schema ? JSON.parse(JSON.stringify(ep.requestBody.schema)) : { key: 'value' }) : undefined;
  const samples = [];
  // curl
  let curlParts = ['curl -X '+method,'  "'+url+'"','  -H "Content-Type: application/json"'];
  if (hasBody && body) curlParts.push("  -d '" + JSON.stringify(body).replace(/'/g,"'\\''") + "'");
  samples.push({ label: 'curl', code: curlParts.join(' \\\\\n') });
  // JS
  let jsLines = hasBody ? ['const data = '+JSON.stringify(body,null,2)+';',''] : [];
  jsLines.push('const response = await fetch("'+url+'", {');
  jsLines.push('  method: "'+method+'",');
  jsLines.push('  headers: { "Content-Type": "application/json" },');
  if(hasBody) jsLines.push('  body: JSON.stringify(data)');
  jsLines.push('});','const result = await response.json();','console.log(result);');
  samples.push({ label: 'JavaScript', code: jsLines.join('\n') });
  // Python
  let pyLines = ['import requests',''];
  if(hasBody && body) pyLines.push('data = '+JSON.stringify(body,null,2),'');
  pyLines.push('headers = { "Content-Type": "application/json" }');
  pyLines.push('response = requests.'+ep.method+'("'+url+'", '+(hasBody?'json=data, ':'')+'headers=headers)');
  pyLines.push('print(response.json())');
  samples.push({ label: 'Python', code: pyLines.join('\n') });
  // Go
  let goLines = ['import (','    "fmt"','    "net/http"',')','','req, _ := http.NewRequest("'+method+'","'+url+'", nil)'];
  goLines.push('req.Header.Set("Content-Type","application/json")');
  goLines.push('client := &http.Client{}');
  goLines.push('resp, err := client.Do(req)');
  goLines.push('if err != nil { panic(err) }','defer resp.Body.Close()','fmt.Println(resp.Status)');
  samples.push({ label: 'Go', code: goLines.join('\n') });
  return samples;
}

init();
</script>
</body>
</html>`;
}

// ========================================================================
// Export: Markdown
// ========================================================================

/**
 * Export API documentation in Markdown format.
 * Useful for CI/CD: commit generated markdown to docs/ for a static site.
 */
export function exportToMarkdown(spec: OpenAPIDocument): string {
  const lines: string[] = [];
  const info = spec.info;

  lines.push(`# ${info.title} API Reference`);
  lines.push("");
  lines.push(`**Version:** ${info.version}`);
  if (info.description) lines.push(`\n${info.description}\n`);
  if (spec.servers?.length) {
    lines.push(`**Base URL:** \`${spec.servers[0].url}\``);
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(methods)) {
      const opData = op as any;
      lines.push(`## ${method.toUpperCase()} \`${path}\``);
      lines.push("");
      if (opData.summary) lines.push(`**${opData.summary}**\n`);
      if (opData.description) lines.push(`${opData.description}\n`);
      if (opData.deprecated) lines.push("> ⚠️ **Deprecated**\n");

      // Parameters
      if (opData.parameters?.length) {
        lines.push("### Parameters");
        lines.push("");
        lines.push("| Name | In | Type | Required | Description |");
        lines.push("|------|-----|------|----------|-------------|");
        for (const param of opData.parameters) {
          const req = param.required ? "✓" : ""; const type = param.schema?.type ?? "string";
          lines.push(`| \`${param.name}\` | ${param.in} | \`${type}\` | ${req} | ${param.description ?? ""} |`);
        }
        lines.push("");
      }

      // Request Body
      if (opData.requestBody) {
        lines.push("### Request Body");
        lines.push("");
        lines.push("```json");
        const requestSchema = opData.requestBody.content?.["application/json"]?.schema ?? opData.requestBody.schema ?? {};
        lines.push(JSON.stringify(requestSchema, null, 2));
        lines.push("```");
        lines.push("");
      }

      // Responses
      lines.push("### Responses");
      lines.push("");
      for (const [status, resp] of Object.entries(opData.responses ?? {})) {
        const r = resp as any;
        lines.push(`- **${status}**: ${r.description ?? ""}`);
        if (r.content?.["application/json"]?.schema) {
          lines.push("  ```json");
          const schemaStr = JSON.stringify(r.content["application/json"].schema, null, 4);
          for (const line of schemaStr.split("\n")) {
            lines.push(`  ${line}`);
          }
          lines.push("  ```");
        }
      }

      lines.push("");
      lines.push("---");
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Export API documentation as a standalone HTML page (full theme).
 */
export function exportToHTML(spec: OpenAPIDocument, options?: {
  title?: string;
  theme?: "dark" | "light" | "auto";
}): string {
  const title = options?.title ?? spec.info.title;
  return generatePortalHTML({
    title,
    version: spec.info.version,
    description: spec.info.description,
    theme: options?.theme ?? "auto",
    specPath: "./openapi.json",
    proxyPath: "",
    tags: [],
    endpointCount: countEndpoints(spec),
  });
}

function countEndpoints(spec: OpenAPIDocument): number {
  let count = 0;
  for (const methods of Object.values(spec.paths ?? {})) {
    count += Object.keys(methods).length;
  }
  return count;
}

// ========================================================================
// Changelog / Version Diff
// ========================================================================

/**
 * Track API changes across versions.
 */
export class ApiChangelog {
  private snapshots: Map<string, ApiSnapshot> = new Map();

  /**
   * Take a snapshot of the current API state.
   */
  snapshot(version: string, endpoints: ApiEndpoint[], tags?: Array<{ name: string; description?: string }>): ApiSnapshot {
    const snap: ApiSnapshot = {
      version,
      timestamp: Date.now(),
      endpoints: [...endpoints],
      tags: tags ? [...tags] : undefined,
    };
    this.snapshots.set(version, snap);
    return snap;
  }

  /**
   * Get a snapshot by version.
   */
  getSnapshot(version: string): ApiSnapshot | undefined {
    return this.snapshots.get(version);
  }

  /**
   * Get all snapshots sorted by timestamp.
   */
  getAllSnapshots(): ApiSnapshot[] {
    return Array.from(this.snapshots.values()).sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Compute diff between two versions.
   */
  diff(fromVersion: string, toVersion: string): ApiDiff | null {
    const from = this.snapshots.get(fromVersion);
    const to = this.snapshots.get(toVersion);
    if (!from || !to) return null;

    const fromMap = new Map(from.endpoints.map((e) => [`${e.method}:${e.path}`, e]));
    const toMap = new Map(to.endpoints.map((e) => [`${e.method}:${e.path}`, e]));

    const added: ApiEndpoint[] = [];
    const removed: ApiEndpoint[] = [];
    const changed: Array<{ endpoint: ApiEndpoint; changes: string[] }> = [];

    for (const [key, endpoint] of toMap) {
      if (!fromMap.has(key)) {
        added.push(endpoint);
      } else {
        const oldEndpoint = fromMap.get(key)!;
        const changes = this._diffEndpoint(oldEndpoint, endpoint);
        if (changes.length > 0) {
          changed.push({ endpoint, changes });
        }
      }
    }

    for (const [key, endpoint] of fromMap) {
      if (!toMap.has(key)) {
        removed.push(endpoint);
      }
    }

    return { added, removed, changed, fromVersion, toVersion };
  }

  /**
   * Generate markdown changelog from all snapshots.
   */
  toChangelogMarkdown(): string {
    const lines: string[] = [];
    lines.push("# API Changelog");
    lines.push("");
    lines.push("| Version | Date | Endpoints | Tags |");
    lines.push("|---------|------|-----------|------|");

    const allSnapshots = this.getAllSnapshots();
    for (const snap of allSnapshots) {
      const date = new Date(snap.timestamp).toISOString().split("T")[0];
      const tagStr = snap.tags?.map((t) => t.name).join(", ") ?? "";
      lines.push(`| ${snap.version} | ${date} | ${snap.endpoints.length} | ${tagStr} |`);
    }

    lines.push("");

    // Diff between consecutive versions
    for (let i = 1; i < allSnapshots.length; i++) {
      const prev = allSnapshots[i - 1];
      const curr = allSnapshots[i];
      const diff = this.diff(prev.version, curr.version);
      if (!diff) continue;

      lines.push(`## ${prev.version} → ${curr.version}`);
      lines.push("");

      if (diff.added.length > 0) {
        lines.push("### ➕ Added");
        for (const ep of diff.added) {
          lines.push(`- **${ep.method.toUpperCase()}** \`${ep.path}\`${ep.summary ? ` — ${ep.summary}` : ""}`);
        }
        lines.push("");
      }

      if (diff.removed.length > 0) {
        lines.push("### ➖ Removed");
        for (const ep of diff.removed) {
          lines.push(`- **${ep.method.toUpperCase()}** \`${ep.path}\`${ep.summary ? ` — ${ep.summary}` : ""}`);
        }
        lines.push("");
      }

      if (diff.changed.length > 0) {
        lines.push("### 🔄 Changed");
        for (const change of diff.changed) {
          lines.push(`- **${change.endpoint.method.toUpperCase()}** \`${change.endpoint.path}\``);
          for (const c of change.changes) {
            lines.push(`  - ${c}`);
          }
        }
        lines.push("");
      }
    }

    return lines.join("\n");
  }

  private _diffEndpoint(oldEp: ApiEndpoint, newEp: ApiEndpoint): string[] {
    const changes: string[] = [];

    if (oldEp.summary !== newEp.summary) changes.push(`Summary: "${oldEp.summary ?? ""}" → "${newEp.summary ?? ""}"`);
    if (oldEp.description !== newEp.description) changes.push(`Description updated`);

    const oldParams = oldEp.parameters ?? [];
    const newParams = newEp.parameters ?? [];
    if (oldParams.length !== newParams.length) changes.push(`Parameters: ${oldParams.length} → ${newParams.length}`);

    const oldParamNames = oldParams.map((p) => p.name).sort().join(",");
    const newParamNames = newParams.map((p) => p.name).sort().join(",");
    if (oldParamNames !== newParamNames) changes.push(`Parameter names changed`);

    const oldResponses = Object.keys(oldEp.responses ?? {}).sort().join(",");
    const newResponses = Object.keys(newEp.responses ?? {}).sort().join(",");
    if (oldResponses !== newResponses) changes.push(`Response status codes: [${oldResponses}] → [${newResponses}]`);

    if (oldEp.deprecated !== newEp.deprecated && newEp.deprecated) changes.push(`Marked as deprecated`);

    return changes;
  }
}

// ========================================================================
// Plugin
// ========================================================================

/**
 * Create the API Documentation Portal plugin.
 *
 * @example
 * ```ts
 * import { Asi, apiDocsPlugin } from "asijs";
 *
 * const app = new Asi();
 * app.get("/users", () => [{ id: 1 }]);
 *
 * app.plugin(apiDocsPlugin({
 *   title: "My API",
 *   version: "1.0.0",
 * }));
 *
 * await app.listen(3000);
 * // Portal at http://localhost:3000/docs
 * // OpenAPI spec at http://localhost:3000/openapi.json
 * ```
 */
export function apiDocsPlugin(options: ApiDocsOptions): AsiPlugin {
  const path = options.path ?? "/docs";
  const specPath = options.specPath ?? "/openapi.json";
  const proxyPath = `${path}/_proxy`;

  return createPlugin({
    name: "api-docs",

    setup(app) {
      // Collect endpoints from the app
      const changelog = new ApiChangelog();
      if (options.changelog !== false) {
        app.setState("api-docs:changelog", changelog);
      }

      // Auto-collect routes from app.getRoutes() and store as documented routes
      // This gives the portal actual route data without manual setup
      const documentedRoutes: DocumentedRoute[] = [];
      try {
        // Try to use getRoutes if available (through PluginHost state)
        const rawRoutes = app.getState<RouteInfo[]>("asi:routes");
        if (rawRoutes) {
          for (const r of rawRoutes) {
            documentedRoutes.push({
              method: r.method,
              path: r.path,
              schemas: r.hasValidation ? {} : undefined,
              docs: r.hasValidation ? { summary: `${r.method} ${r.path}` } : undefined,
            });
          }
        }
      } catch (e) {
        /* routes may not be set yet */
        if (options.verbose) console.warn('[api-docs] Could not collect routes:', e);
      }
      app.setState("openapi:routes", documentedRoutes);

      // Serve the portal HTML
      app.get(path, (ctx: Context) => {
        // Determine base URL
        const baseUrl = options.serverUrl ?? `${ctx.url.protocol}//${ctx.url.host}`;

        // Get endpoint count from our documented routes
        const routes = app.getState<DocumentedRoute[]>("openapi:routes") ?? [];
        const filteredRoutes = routes.filter(
          (r) => r.path !== path && r.path !== specPath && r.path !== proxyPath,
        );
        const endpointCount = filteredRoutes.length;

        const html = generatePortalHTML({
          title: options.title,
          version: options.version,
          description: options.description,
          theme: options.theme,
          specPath,
          proxyPath,
          tags: options.tags,
          customCSS: options.customCSS,
          logo: options.logo,
          contactEmail: options.contactEmail,
          repoUrl: options.repoUrl,
          license: options.license,
          endpointCount,
        });

        return ctx.html(html);
      });

      // Serve the try-it-out proxy endpoint (SSRF-safe)
      if (options.tryItOut !== false) {
        app.post(proxyPath, async (ctx: Context) => {
          const body = (await ctx.json()) as {
            method: string;
            path: string;
            body?: unknown;
            headers?: Record<string, string>;
          };

          const method = body.method?.toUpperCase() ?? "GET";
          let targetPath = body.path ?? "/";

          // SSRF protection: validate the path
          if (!targetPath.startsWith("/")) {
            return new Response(
              JSON.stringify({ error: "Invalid path — must start with /" }),
              { status: 400, headers: { "Content-Type": "application/json" } },
            );
          }
          // Block path traversal
          if (targetPath.includes("..") || targetPath.includes("@")) {
            return new Response(
              JSON.stringify({ error: "Path traversal blocked" }),
              { status: 400, headers: { "Content-Type": "application/json" } },
            );
          }
          // Skip internal portal routes
          if (targetPath === path || targetPath === specPath || targetPath === proxyPath) {
            return new Response(
              JSON.stringify({ error: "Cannot proxy to portal routes" }),
              { status: 400, headers: { "Content-Type": "application/json" } },
            );
          }

          const baseUrl = options.apiBaseUrl ?? `${ctx.url.protocol}//${ctx.url.host}`;
          const targetUrl = `${baseUrl}${targetPath}`;

          const fetchOptions: RequestInit = {
            method,
            headers: {
              "Content-Type": "application/json",
              ...(options.authToken
                ? { Authorization: `Bearer ${options.authToken}` }
                : {}),
              ...body.headers,
            },
          };

          if (body.body !== undefined && ["POST", "PUT", "PATCH"].includes(method)) {
            fetchOptions.body = JSON.stringify(body.body);
          }

          try {
            const response = await fetch(targetUrl, fetchOptions);
            const text = await response.text();

            return new Response(text, {
              status: response.status,
              statusText: response.statusText,
              headers: {
                "Content-Type": response.headers.get("content-type") ?? "application/json",
                "Access-Control-Allow-Origin": "*",
              },
            });
          } catch (error) {
            return new Response(
              JSON.stringify({
                error: "Request failed",
                message: error instanceof Error ? error.message : String(error),
              }),
              {
                status: 502,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
        });
      }

      // Register route metadata collection hook
      if (options.changelog !== false) {
        app.setState("api-docs:snapshot-taken", false);
      }
    },
  });
}

// ========================================================================
// Helpers
// ========================================================================

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
