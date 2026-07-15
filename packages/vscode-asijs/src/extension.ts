import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

/**
 * Parse AsiJS routes from TypeScript source code.
 */
interface RouteInfo {
  method: string;
  path: string;
  line: number;
  hasValidation: boolean;
  isWebSocket: boolean;
}

function parseRoutes(source: string): RouteInfo[] {
  const routes: RouteInfo[] = [];
  const routePattern = /app\.(get|post|put|delete|patch|all|head|options|ws)\(\s*['"`]([^'"`]+)['"`]/g;

  let match: RegExpExecArray | null;
  while ((match = routePattern.exec(source)) !== null) {
    const method = match[1]!.toUpperCase();
    const routePath = match[2]!;
    const line = source.slice(0, match.index).split("\n").length;

    // Check for validation
    const remaining = source.slice(match.index, match.index + 300);
    const hasValidation = /schema\s*:|Type\.Object\s*\(/.test(remaining);

    routes.push({
      method: method === "WS" ? "WS" : method,
      path: routePath,
      line,
      hasValidation,
      isWebSocket: method === "ws",
    });
  }

  return routes;
}

// ============================================================================
// Route Explorer Webview
// ============================================================================

class RouteExplorerProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "asijs.routeExplorer";

  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtml();
    this._refresh();

    // Watch for text editor changes
    vscode.window.onDidChangeActiveTextEditor(() => this._refresh());
    vscode.workspace.onDidChangeTextDocument(() => this._refresh());
  }

  private _refresh(): void {
    const routes = this._getRoutesFromActiveEditor();
    if (routes.length === 0) {
      this._view?.webview.postMessage({
        type: "update",
        routes: [],
        message: "No routes found in the active file. Open an AsiJS route file to see routes here.",
      });
      return;
    }
    this._view?.webview.postMessage({ type: "update", routes, message: "" });
  }

  private _getRoutesFromActiveEditor(): RouteInfo[] {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return [];
    const source = editor.document.getText();
    return parseRoutes(source);
  }

  private _getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: var(--vscode-font-family); font-size: 13px; padding: 0; margin: 0; }
    .header { padding: 8px 12px; background: var(--vscode-sideBarSectionHeader-background); border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border); display: flex; justify-content: space-between; align-items: center; }
    .header h3 { margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    .count { font-size: 11px; opacity: 0.7; }
    .route { display: flex; align-items: center; padding: 4px 12px; cursor: pointer; border-bottom: 1px solid var(--vscode-list-hoverBackground); }
    .route:hover { background: var(--vscode-list-hoverBackground); }
    .method { font-size: 11px; font-weight: 600; padding: 1px 6px; border-radius: 3px; margin-right: 8px; min-width: 36px; text-align: center; color: white; }
    .method.get { background: #2ea043; }
    .method.post { background: #1f6feb; }
    .method.put { background: #d29922; }
    .method.delete { background: #da3633; }
    .method.patch { background: #a371f7; }
    .method.all { background: #8b949e; }
    .method.ws { background: #8250df; }
    .method.head { background: #6e7681; }
    .path { flex: 1; font-size: 13px; }
    .badge { font-size: 10px; padding: 1px 4px; border-radius: 3px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); margin-left: 4px; }
    .empty { padding: 24px 12px; text-align: center; opacity: 0.6; }
  </style>
</head>
<body>
  <div class="header">
    <h3>Routes</h3>
    <span class="count" id="routeCount">0</span>
  </div>
  <div id="routes"></div>
  <script>
    (function() {
      const vscode = acquireVsCodeApi();
      const routesEl = document.getElementById('routes');
      const countEl = document.getElementById('routeCount');

      window.addEventListener('message', event => {
        const { type, routes, message } = event.data;
        if (type !== 'update') return;

        countEl.textContent = String(routes.length);

        if (routes.length === 0) {
          routesEl.innerHTML = '<div class="empty">' + (message || 'No routes found') + '</div>';
          return;
        }

        routesEl.innerHTML = routes.map(r => {
          const methodClass = r.method.toLowerCase();
          return '<div class="route" data-line="' + r.line + '">' +
            '<span class="method ' + methodClass + '">' + r.method + '</span>' +
            '<span class="path">' + r.path + '</span>' +
            (r.hasValidation ? '<span class="badge">✓</span>' : '') +
            (r.isWebSocket ? '<span class="badge">WS</span>' : '') +
            '</div>';
        }).join('');

        // Click handler — go to line
        routesEl.querySelectorAll('.route').forEach(el => {
          el.addEventListener('click', function() {
            vscode.postMessage({ type: 'goto', line: parseInt(this.dataset.line) });
          });
        });
      });

      // Initial load
      vscode.postMessage({ type: 'ready' });
    })();
  </script>
</body>
</html>`;
  }
}

// ============================================================================
// Activation
// ============================================================================

export function activate(context: vscode.ExtensionContext) {
  // Register route explorer
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      RouteExplorerProvider.viewType,
      new RouteExplorerProvider(context.extensionUri),
    ),
  );

  // Command: Open Route Explorer
  context.subscriptions.push(
    vscode.commands.registerCommand("asijs.openRouteExplorer", () => {
      vscode.commands.executeCommand("workbench.view.extension.asijs-routeExplorer");
    }),
  );

  // Command: Show Route Definition
  context.subscriptions.push(
    vscode.commands.registerCommand("asijs.showRoute", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const selection = editor.selection;
      const line = selection.active.line;
      const source = editor.document.getText();
      const routes = parseRoutes(source);

      // Find route closest to cursor
      const closest = routes.reduce((prev, curr) => {
        return Math.abs(curr.line - line) < Math.abs(prev.line - line) ? curr : prev;
      }, routes[0]);

      if (closest) {
        vscode.window.showInformationMessage(
          `${closest.method} ${closest.path} (line ${closest.line})`,
        );
      }
    }),
  );

  // Provide hover info (simplified)
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      ["typescript", "javascript"],
      {
        provideHover(document, position) {
          const range = document.getWordRangeAtPosition(position, /app\.\w+/);
          if (!range) return null;

          const word = document.getText(range);
          if (!word.startsWith("app.")) return null;

          const lineText = document.lineAt(position.line).text;
          const routeMatch = lineText.match(/app\.(get|post|put|delete|patch|all|ws)\(\s*['"`]([^'"`]+)['"`]/);
          if (!routeMatch) return null;

          return new vscode.Hover(
            `**AsiJS Route**: \`${routeMatch[1].toUpperCase()} ${routeMatch[2]}\``,
            range,
          );
        },
      },
    ),
  );

  console.log("AsiJS extension activated");
}

export function deactivate() {
  // Cleanup
}
