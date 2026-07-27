/**
 * AsiJS Web Playground
 *
 * Provides an interactive web-based IDE for experimenting with AsiJS:
 * - Side-by-side code editor and live preview
 * - Real-time AsiJS app execution
 * - API request testing panel
 * - Pre-loaded examples
 *
 * Usage:
 *   import { playgroundPlugin } from "asijs";
 *   app.plugin(playgroundPlugin({ path: "/play" }));
 */

import { createPlugin, type AsiPlugin } from "./plugin";
import type { Context } from "./context";
import { Asi } from "./asi";

// ============================================================================
// Playground Options
// ============================================================================

export interface PlaygroundOptions {
  /** Path to mount the playground (default: /play) */
  path?: string;
  /** Whether to allow code execution (default: true) */
  allowExecution?: boolean;
  /** Pre-loaded code examples */
  examples?: PlaygroundExample[];
  /** Max execution timeout in ms (default: 5000) */
  timeout?: number;
}

export interface PlaygroundExample {
  name: string;
  description: string;
  code: string;
}

const DEFAULT_EXAMPLES: PlaygroundExample[] = [
  {
    name: "Hello World",
    description: "Basic GET route",
    code: `import { Asi } from "asijs";
import { playgroundPlugin } from ".";

const app = new Asi({ development: true });

app.get("/", () => "Hello from AsiJS! 🚀");
app.get("/health", () => ({ status: "ok", uptime: process.uptime() }));

// This plugin adds this playground itself
app.plugin(playgroundPlugin({ path: "/play" }));

app.listen(3000, () => {
  console.log("🚀 Playground running at http://localhost:3000/play");
});`,
  },
  {
    name: "REST API",
    description: "CRUD with validation",
    code: `import { Asi } from "asijs";
import { Type } from "@sinclair/typebox";

const app = new Asi({ development: true });

interface User { id: number; name: string; email: string; }
let users: User[] = [];
let nextId = 1;

app.get("/users", () => users);

app.post("/users", {
  body: Type.Object({
    name: Type.String({ minLength: 1 }),
    email: Type.String({ format: "email" }),
  }),
}, (ctx) => {
  const user = { id: nextId++, ...ctx.body };
  users.push(user);
  return ctx.status(201).jsonResponse(user);
});

app.get("/users/:id", (ctx) => {
  const user = users.find(u => u.id === Number(ctx.params.id));
  if (!user) return ctx.status(404).jsonResponse({ error: "Not found" });
  return user;
});

app.listen(3000);`,
  },
  {
    name: "JSX SSR",
    description: "Server-side rendering with JSX",
    code: `import { Asi, html, type FC } from "asijs";

const app = new Asi({ development: true });

const Layout: FC<{ title: string; children: any }> = ({ title, children }) => (
  <html>
    <head><meta charset="UTF-8" /><title>{title}</title></head>
    <body>{children}</body>
  </html>
);

app.get("/", (ctx) => ctx.html(
  <Layout title="AsiJS Playground">
    <h1>⚡ Hello from AsiJS!</h1>
    <p>Server-rendered with JSX</p>
  </Layout>
));

app.listen(3000);`,
  },
  {
    name: "WebSocket Echo",
    description: "WebSocket echo server",
    code: `import { Asi, html, type FC } from "asijs";

const app = new Asi({ development: true });

app.ws("/ws", {
  open(ws) { console.log("Client connected"); },
  message(ws, message) { ws.send("Echo: " + message); },
  close(ws) { console.log("Client disconnected"); },
});

app.get("/", (ctx) => ctx.html(
  <html>
    <head><title>WS Echo</title></head>
    <body>
      <h1>WebSocket Echo</h1>
      <input id="msg" placeholder="Type a message" />
      <button onclick="send()">Send</button>
      <div id="log"></div>
      <script>{\`
        const ws = new WebSocket('ws://' + location.host + '/ws');
        document.getElementById('log').innerHTML = 'Connected!';
        ws.onmessage = (e) => {
          document.getElementById('log').innerHTML += '<br>' + e.data;
        };
        function send() {
          const input = document.getElementById('msg');
          ws.send(input.value);
          input.value = '';
        }
      \`}</script>
    </body>
  </html>
));

app.listen(3000);`,
  },
  {
    name: "Auth JWT",
    description: "JWT authentication",
    code: `import { Asi, jwt, bearer } from "asijs";
import { Type } from "@sinclair/typebox";

const app = new Asi({ development: true });
const jwtHelper = jwt({ secret: "playground-secret" });

app.post("/login", {
  body: Type.Object({
    username: Type.String(),
    password: Type.String(),
  }),
}, async (ctx) => {
  const token = await jwtHelper.sign({ user: ctx.body.username });
  return { token };
});

app.get("/me", bearer({ verify: (t) => jwtHelper.verify(t) }), (ctx) => {
  return { user: (ctx as any).user };
});

app.listen(3000);`,
  },
];

// ============================================================================
// Playground Plugin
// ============================================================================

/**
 * Simple in-memory rate limiter for playground _execute endpoint.
 */
function createRateLimiter(maxRequests: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return {
    check(key: string): boolean {
      const now = Date.now();
      const entry = hits.get(key);
      if (!entry || now > entry.resetAt) {
        hits.set(key, { count: 1, resetAt: now + windowMs });
        return true;
      }
      if (entry.count >= maxRequests) {
        return false;
      }
      entry.count++;
      return true;
    },
  };
}

/**
 * Create the AsiJS Playground plugin.
 * Mounts a full IDE at the specified path.
 */
export function playgroundPlugin(options: PlaygroundOptions = {}): AsiPlugin {
  const playPath = options.path || "/play";
  const allowExecution = options.allowExecution !== false;
  const examples = options.examples || DEFAULT_EXAMPLES;
  const timeout = options.timeout || 5000;

  // Rate limiter: max 10 requests per minute per IP
  const executeLimiter = createRateLimiter(10, 60_000);

  // Store the app reference for code execution
  let appRef: Asi | null = null;

  return createPlugin({
    name: "playground",

    setup(app: any) {
      appRef = app;

      // Main playground page
      app.get(playPath, () => {
        return new Response(renderPlaygroundPage(playPath, examples), {
          headers: { "Content-Type": "text/html" },
        });
      });

      // API endpoint for code execution
      if (allowExecution) {
        app.post(playPath + "/_execute", async (ctx: Context) => {
          // Rate limit by IP
          const ip = ctx.request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            || ctx.request.headers.get("x-real-ip")
            || "unknown";
          if (!executeLimiter.check(ip)) {
            return ctx.status(429).jsonResponse({
              error: "Too many execution requests. Please wait before trying again.",
              retryAfter: "60 seconds",
            });
          }

          const body = await ctx.json();
          const code = (body as any).code || "";

          if (!code.trim()) {
            return ctx.status(400).jsonResponse({ error: "No code provided" });
          }

          try {
            const result = await executeCode(code, timeout);
            return { success: true, result };
          } catch (error) {
            return {
              success: false,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        });
      }          // API endpoint to get route info
      app.get(playPath + "/_api/routes", () => {
        try {
          const routes = (app as any).getRoutes?.() || [];
          const routeList = Array.isArray(routes)
            ? routes.map((r: any) => ({
                method: r.method || "ANY",
                path: r.path || "/",
                hasValidation: !!r.schema,
              }))
            : [];
          return { routes: routeList };
        } catch {
          return { routes: [] };
        }
      });

      // API endpoint to get examples
      app.get(playPath + "/_api/examples", () => ({ examples }));

      // Static assets
      app.get(playPath + "/_api/health", () => ({ status: "ok" }));

      console.log(`🎮 Playground mounted at ${playPath}`);
    },
  });
}

/**
 * Execute AsiJS code in a sandboxed environment.
 * Provides Asi and console to the sandbox so user code can
 * create apps, define routes, and test requests.
 */
async function executeCode(code: string, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Execution timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    (async () => {
      try {
        // Create a sandbox for execution with AsiJS context available.
        // We strip import statements since new AsyncFunction doesn't support them.
        // Asi is provided as a global variable to the sandbox.
        const cleanCode = code
          .split("\n")
          .filter((line) => !line.trim().startsWith("import "))
          .join("\n");

        const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
        const wrappedCode = `
          (async () => {
            try {
              ${cleanCode}
              // Return app status for display
              const routesList = [];
              try {
                const routes = app.getRoutes?.() || [];
                if (Array.isArray(routes)) {
                  for (const route of routes) {
                    routesList.push({ method: route.method || "ANY", path: route.path || "/" });
                  }
                }
              } catch (e) {
                // Debug logging for silent catch
                console.error('[Playground] route fetch error:', e);
              }
              return { status: 'ok', routes: routesList };
            } catch (e) {
              return { status: 'error', error: e.message || String(e) };
            }
          })()
        `;

        // Sandbox: pass safe values as params to shadow dangerous globals.
        // By passing `process: undefined`, `require: undefined` etc. as local
        // variables, they shadow the global versions inside the AsyncFunction.
        const sandbox = {
          console: console,
          Asi: Asi,
          app: new Asi({ development: false, silent: true }),
          process: undefined as unknown,
          require: undefined as unknown,
          global: undefined as unknown,
          globalThis: undefined as unknown,
          fetch: undefined as unknown,
        };
        const sandboxKeys = Object.keys(sandbox);
        const sandboxValues = Object.values(sandbox);

        const fn = new AsyncFunction(...sandboxKeys, wrappedCode);
        const result = await fn(...sandboxValues);
        clearTimeout(timer);
        resolve(result);
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    })();
  });
}

// ============================================================================
// HTML Generation
// ============================================================================

function renderPlaygroundPage(path: string, examples: PlaygroundExample[]): string {
  const exampleJson = JSON.stringify(examples);
  const execUrl = `${path}/_execute`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AsiJS Playground</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0d1117;
      --surface: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --text-dim: #8b949e;
      --accent: #58a6ff;
      --accent-hover: #79c0ff;
      --green: #3fb950;
      --red: #f85149;
      --yellow: #d29922;
      --font: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      --radius: 6px;
    }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); height: 100vh; display: flex; flex-direction: column; }
    .toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 16px; background: var(--surface); border-bottom: 1px solid var(--border); }
    .toolbar h1 { font-size: 14px; font-weight: 600; margin-right: auto; }
    .toolbar h1 span { color: var(--accent); }
    .toolbar select, .toolbar button { padding: 4px 10px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg); color: var(--text); font-size: 12px; cursor: pointer; }
    .toolbar select:hover, .toolbar button:hover { border-color: var(--accent); }
    .toolbar button.primary { background: var(--accent); color: #fff; border-color: var(--accent); font-weight: 600; }
    .toolbar button.primary:hover { background: var(--accent-hover); }
    .toolbar button:disabled { opacity: 0.5; cursor: not-allowed; }
    .main { display: flex; flex: 1; overflow: hidden; }
    .panel { flex: 1; display: flex; flex-direction: column; border-right: 1px solid var(--border); min-width: 0; }
    .panel:last-child { border-right: none; }
    .panel-header { display: flex; align-items: center; padding: 6px 12px; background: var(--surface); border-bottom: 1px solid var(--border); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-dim); }
    .panel-header span { margin-right: auto; }
    .panel-body { flex: 1; overflow: auto; padding: 0; position: relative; }
    .code-editor { width: 100%; height: 100%; border: none; background: var(--bg); color: var(--text); font-family: var(--font); font-size: 13px; line-height: 1.6; padding: 16px; resize: none; outline: none; tab-size: 2; }
    .code-editor::placeholder { color: var(--text-dim); }
    .result-panel { display: flex; flex-direction: column; height: 100%; }
    .result-output { flex: 1; padding: 12px 16px; font-family: var(--font); font-size: 13px; line-height: 1.5; overflow: auto; white-space: pre-wrap; }
    .result-output .success { color: var(--green); }
    .result-output .error { color: var(--red); }
    .result-output .info { color: var(--text-dim); }
    .result-output .json { color: var(--yellow); }
    .request-bar { display: flex; align-items: center; gap: 4px; padding: 8px 12px; background: var(--surface); border-top: 1px solid var(--border); }
    .request-bar select, .request-bar input, .request-bar button { padding: 4px 8px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg); color: var(--text); font-size: 12px; }
    .request-bar input { flex: 1; }
    .request-bar button { background: var(--accent); color: #fff; border-color: var(--accent); cursor: pointer; }
    .request-bar button:hover { background: var(--accent-hover); }
    .status-bar { display: flex; align-items: center; gap: 16px; padding: 4px 16px; background: var(--surface); border-top: 1px solid var(--border); font-size: 11px; color: var(--text-dim); }
    .status-bar .indicator { width: 8px; height: 8px; border-radius: 50%; background: var(--green); }
    .tabs { display: flex; gap: 0; background: var(--surface); border-bottom: 1px solid var(--border); }
    .tab { padding: 6px 16px; font-size: 12px; cursor: pointer; border-bottom: 2px solid transparent; color: var(--text-dim); }
    .tab.active { border-bottom-color: var(--accent); color: var(--text); }
    .tab:hover { color: var(--text); }
    @media (max-width: 768px) { .main { flex-direction: column; } .panel { border-right: none; border-bottom: 1px solid var(--border); } }
  </style>
</head>
<body>
  <div class="toolbar">
    <h1>⚡ <span>AsiJS</span> Playground</h1>
    <select id="exampleSelect" onchange="loadExample()">
      <option value="">— Load Example —</option>
    </select>
    <button onclick="runCode()" id="runBtn" class="primary">▶ Run</button>
    <button onclick="resetCode()">↺ Reset</button>
  </div>
  <div class="main">
    <div class="panel">
      <div class="panel-header">
        <span>Code Editor</span>
        <span id="statusText">Ready</span>
      </div>
      <div class="panel-body">
        <textarea class="code-editor" id="codeEditor" spellcheck="false"
          placeholder="// Write AsiJS code here..."
          onkeydown="handleTab(event)">// Welcome to AsiJS Playground!
// Type AsiJS expressions and click Run to see results.

app.get("/hello", () => "Hello from AsiJS!");
app.get("/health", () => ({ status: "ok" }));

// Type .routes below to list routes, or use the request bar to test.</textarea>
      </div>
    </div>
    <div class="panel">
      <div class="result-panel">
        <div class="tabs">
          <div class="tab active" onclick="switchTab('output', this)">Output</div>
          <div class="tab" onclick="switchTab('routes', this)">Routes</div>
        </div>
        <div class="panel-body" id="outputPanel">
          <div class="result-output" id="resultOutput">
            <span class="info">// Click "Run" or press Ctrl+Enter to execute code</span>
          </div>
          <div class="result-output" id="routesPanel" style="display:none">
            <span class="info">Run code to see routes</span>
          </div>
        </div>
        <div class="request-bar">
          <select id="methodSelect">
            <option>GET</option>
            <option>POST</option>
            <option>PUT</option>
            <option>DELETE</option>
            <option>PATCH</option>
          </select>
          <input type="text" id="requestPath" placeholder="/hello" value="/hello" />
          <button onclick="sendRequest()">Send</button>
        </div>
      </div>
    </div>
  </div>
  <div class="status-bar">
    <span class="indicator" id="statusIndicator"></span>
    <span id="statusMsg">Playground ready</span>
  </div>
  <script>
    const examples = ${exampleJson};
    const execUrl = "${execUrl}";
    const codeEditor = document.getElementById('codeEditor');
    const resultOutput = document.getElementById('resultOutput');
    const routesPanel = document.getElementById('routesPanel');
    const exampleSelect = document.getElementById('exampleSelect');
    const statusMsg = document.getElementById('statusMsg');
    const statusIndicator = document.getElementById('statusIndicator');
    const runBtn = document.getElementById('runBtn');

    // Populate examples
    examples.forEach((ex, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = ex.name + ' — ' + ex.description;
      exampleSelect.appendChild(opt);
    });

    function loadExample() {
      const idx = exampleSelect.value;
      if (idx === '') return;
      const example = examples[parseInt(idx)];
      if (example) {
        codeEditor.value = example.code;
        statusMsg.textContent = 'Loaded: ' + example.name;
      }
    }

    function handleTab(e) {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = codeEditor.selectionStart;
        const end = codeEditor.selectionEnd;
        codeEditor.value = codeEditor.value.substring(0, start) + '  ' + codeEditor.value.substring(end);
        codeEditor.selectionStart = codeEditor.selectionEnd = start + 2;
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        runCode();
      }
    }

    async function runCode() {
      const code = codeEditor.value;
      runBtn.disabled = true;
      runBtn.textContent = '⏳ Running...';
      statusMsg.textContent = 'Executing code...';
      statusIndicator.style.background = 'var(--yellow)';
      resultOutput.innerHTML = '<span class="info">// Executing...</span>';

      try {
        const res = await fetch(execUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        const data = await res.json();
        if (data.success) {
          resultOutput.innerHTML = '<span class="success">✓ Code executed successfully</span>';
          if (data.result && data.result.routes) {
            routesPanel.innerHTML = '<span class="info">Routes (' + data.result.routes.length + '):</span>\\n' +
              data.result.routes.map(r => '<span class="json">' + r.method + ' ' + r.path + '</span>').join('\\n');
          } else {
            routesPanel.innerHTML = '<span class="info">' + JSON.stringify(data.result, null, 2) + '</span>';
          }
          statusMsg.textContent = 'Code executed';
          statusIndicator.style.background = 'var(--green)';
        } else {
          resultOutput.innerHTML = '<span class="error">✗ ' + (data.error || 'Execution failed') + '</span>';
          statusMsg.textContent = 'Error';
          statusIndicator.style.background = 'var(--red)';
        }
      } catch (err) {
        resultOutput.innerHTML = '<span class="error">✗ Network error: ' + err.message + '</span>';
        statusMsg.textContent = 'Network error';
        statusIndicator.style.background = 'var(--red)';
      } finally {
        runBtn.disabled = false;
        runBtn.textContent = '▶ Run';
      }
    }

    function switchTab(name, el) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      el.classList.add('active');
      document.getElementById('outputPanel').style.display = name === 'output' ? '' : 'none';
      document.getElementById('routesPanel').style.display = name === 'routes' ? '' : 'none';
    }

    async function sendRequest() {
      const method = document.getElementById('methodSelect').value;
      const path = document.getElementById('requestPath').value;

      try {
        const res = await fetch(path, { method });
        const text = await res.text();
        let pretty;
        try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { pretty = text; }
        resultOutput.innerHTML = '<span class="success">' + method + ' ' + path + ' → ' + res.status + '</span>\\n' +
          '<span class="json">' + (pretty || '(empty)') + '</span>';
        statusMsg.textContent = res.status + ' ' + res.statusText;
      } catch (err) {
        resultOutput.innerHTML = '<span class="error">✗ ' + err.message + '</span>';
        statusMsg.textContent = 'Request failed';
      }
    }

    function resetCode() {
      codeEditor.value = '// Welcome to AsiJS Playground!\\n// Type AsiJS code and click Run.\\n\\napp.get("/hello", () => "Hello from AsiJS!");\\napp.get("/health", () => ({ status: "ok" }));';
      resultOutput.innerHTML = '<span class="info">Code reset</span>';
      statusMsg.textContent = 'Code reset';
    }
  </script>
</body>
</html>`;
}
