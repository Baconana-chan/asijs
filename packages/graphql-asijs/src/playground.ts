/**
 * A tiny zero-dependency GraphiQL-like playground page (vanilla JS).
 * Sends POST JSON queries to the endpoint; supports variables JSON.
 */

export interface PlaygroundOptions {
  /** GraphQL endpoint (default "/graphql"). */
  endpoint?: string;
  /** WebSocket endpoint for subscriptions (default "/graphql/ws"). */
  wsEndpoint?: string;
  /** Page title (default "GraphQL Playground"). */
  title?: string;
}

export function renderPlaygroundHTML(options: PlaygroundOptions = {}): string {
  const endpoint = options.endpoint ?? "/graphql";
  const wsEndpoint = options.wsEndpoint ?? "/graphql/ws";
  const title = options.title ?? "GraphQL Playground";
  const endpointJson = JSON.stringify(endpoint);

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; background: #0f1117; color: #e6e6e6; }
  header { display: flex; align-items: center; gap: 12px; padding: 10px 16px; background: #161a23; border-bottom: 1px solid #232a38; }
  header h1 { font-size: 14px; margin: 0; font-weight: 600; }
  button { background: #7c9cff; color: #0b0e14; border: 0; border-radius: 6px; padding: 7px 14px; font: 600 13px ui-monospace, monospace; cursor: pointer; }
  button:hover { background: #93adff; }
  main { display: grid; grid-template-columns: 1fr 1fr; gap: 0; height: calc(100vh - 48px); }
  section { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  section + section { border-left: 1px solid #232a38; }
  textarea, pre { flex: 1; margin: 0; border: 1px solid #232a38; border-radius: 6px; background: #131720; color: #e6e6e6; padding: 10px; overflow: auto; white-space: pre-wrap; word-break: break-word; }
  textarea { resize: none; }
  label { font-size: 12px; color: #8b94a7; }
  .row { display: flex; gap: 8px; }
  .row input { flex: 1; background: #131720; border: 1px solid #232a38; border-radius: 6px; color: #e6e6e6; padding: 6px 8px; font: 13px ui-monospace, monospace; }
  .badge { font-size: 11px; color: #8b94a7; }
</style>
</head>
<body>
<header>
  <h1>${title}</h1>
  <span class="badge" id="badge"></span>
  <span style="flex:1"></span>
  <button id="run">Run ▶</button>
</header>
<main>
  <section>
    <label>Query</label>
    <textarea id="query" spellcheck="false">{ __typename }</textarea>
    <label>Variables (JSON, optional)</label>
    <div class="row"><input id="variables" placeholder='{"id": "1"}'/></div>
  </section>
  <section>
    <label>Response</label>
    <pre id="response">Press Run to execute.</pre>
  </section>
</main>
<script>
(function () {
  const endpoint = ${endpointJson};
  const q = document.getElementById("query");
  const vars = document.getElementById("variables");
  const out = document.getElementById("response");
  const badge = document.getElementById("badge");
  async function run() {
    let variables;
    const rawVars = vars.value.trim();
    if (rawVars) {
      try { variables = JSON.parse(rawVars); }
      catch (e) { out.textContent = "Invalid variables JSON: " + e.message; return; }
    }
    const started = performance.now();
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q.value, variables }),
      });
      const ms = Math.round(performance.now() - started);
      badge.textContent = res.status + " · " + ms + "ms";
      out.textContent = await res.text();
    } catch (e) {
      badge.textContent = "error";
      out.textContent = "Request failed: " + e.message;
    }
  }
  document.getElementById("run").addEventListener("click", run);
  q.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") run();
  });
  run();
})();
</script>
</body>
</html>`;
}
