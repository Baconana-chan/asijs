/**
 * Template Explorer — Webview that displays AsiJS project templates with file preview.
 *
 * Shows template categories, allows browsing files within each template,
 * and provides a "Create Project" action.
 */

import * as vscode from "vscode";
import { TEMPLATES } from "./templates";

// ============================================================================
// Template Explorer Webview
// ============================================================================

export class TemplateExplorerProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "asijs.templateExplorer";

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

    webviewView.webview.onDidReceiveMessage((message) => {
      switch (message.type) {
        case "createProject":
          vscode.commands.executeCommand("asijs.createProject", message.templateId);
          break;
        case "previewFile":
          vscode.commands.executeCommand("asijs.previewTemplateFile", message.templateId, message.filePath);
          break;
      }
    });
  }

  private _getHtml(): string {
    const categories = [...new Set(TEMPLATES.map((t) => t.category))];
    const templatesByCategory = categories.map((cat) => ({
      category: cat,
      templates: TEMPLATES.filter((t) => t.category === cat).sort((a, b) => a.order - b.order),
    }));

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { font-family: var(--vscode-font-family); font-size: 13px; padding: 0; margin: 0; color: var(--vscode-foreground); }
    .header { padding: 10px 12px; background: var(--vscode-sideBarSectionHeader-background); border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border); }
    .header h3 { margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--vscode-foreground); }
    .search { padding: 8px 12px; }
    .search input { width: 100%; padding: 4px 8px; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); color: var(--vscode-input-foreground); border-radius: 2px; box-sizing: border-box; }
    .category { margin-bottom: 4px; }
    .category-title { padding: 6px 12px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.7; border-bottom: 1px solid var(--vscode-list-hoverBackground); }
    .template { display: flex; align-items: flex-start; padding: 8px 12px; cursor: pointer; border-bottom: 1px solid var(--vscode-list-hoverBackground); transition: background 0.15s; }
    .template:hover { background: var(--vscode-list-hoverBackground); }
    .template-icon { font-size: 18px; margin-right: 10px; line-height: 1.2; }
    .template-info { flex: 1; min-width: 0; }
    .template-name { font-weight: 600; font-size: 13px; margin-bottom: 2px; }
    .template-desc { font-size: 11px; opacity: 0.7; line-height: 1.3; }
    .template-actions { margin-top: 4px; }
    .template-action { font-size: 11px; padding: 2px 6px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 2px; cursor: pointer; margin-right: 4px; }
    .template-action:hover { background: var(--vscode-button-hoverBackground); }
    .template-action.secondary { background: transparent; color: var(--vscode-textLink-foreground); border: 1px solid var(--vscode-textLink-foreground); }
    .template-action.secondary:hover { background: var(--vscode-textLink-activeForeground); color: var(--vscode-button-foreground); }
    .template-files { margin-top: 6px; padding-left: 4px; }
    .template-file { font-size: 11px; padding: 2px 6px; color: var(--vscode-textLink-foreground); cursor: pointer; display: inline-block; margin-right: 4px; margin-bottom: 2px; border: 1px solid transparent; border-radius: 2px; }
    .template-file:hover { border-color: var(--vscode-textLink-foreground); }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="header">
    <h3>📦 Project Templates</h3>
  </div>
  <div class="search">
    <input type="text" id="search" placeholder="Search templates..." oninput="filterTemplates()" />
  </div>
  <div id="templates">
    ${templatesByCategory
      .map(
        ({ category, templates }) => `
      <div class="category">
        <div class="category-title">${category}</div>
        ${templates
          .map(
            (t) => `
          <div class="template" data-name="${t.name.toLowerCase()}" data-desc="${t.description.toLowerCase()}">
            <div class="template-icon">${t.icon}</div>
            <div class="template-info">
              <div class="template-name">${t.name}</div>
              <div class="template-desc">${t.description}</div>
              <div class="template-actions">
                <button class="template-action" onclick="createProject('${t.id}')">Create Project</button>
                <button class="template-action secondary" onclick="toggleFiles('${t.id}')">Preview Files</button>
              </div>
              <div class="template-files hidden" id="files-${t.id}">
                ${t.files
                  .map(
                    (f) => `
                  <span class="template-file" onclick="previewFile('${t.id}', '${f.path}')">📄 ${f.path}</span>
                `,
                  )
                  .join("")}
              </div>
            </div>
          </div>
        `,
          )
          .join("")}
      </div>
    `,
      )
      .join("")}
  </div>
  <script>
    const vscode = acquireVsCodeApi();

    function createProject(templateId) {
      vscode.postMessage({ type: 'createProject', templateId });
    }

    function toggleFiles(templateId) {
      const el = document.getElementById('files-' + templateId);
      el.classList.toggle('hidden');
    }

    function previewFile(templateId, filePath) {
      vscode.postMessage({ type: 'previewFile', templateId, filePath });
    }

    function filterTemplates() {
      const q = document.getElementById('search').value.toLowerCase();
      document.querySelectorAll('.template').forEach(el => {
        const name = el.dataset.name;
        const desc = el.dataset.desc;
        el.style.display = (!q || name.includes(q) || desc.includes(q)) ? '' : 'none';
      });
    }
  </script>
</body>
</html>`;
  }

  public refresh(): void {
    if (this._view) {
      this._view.webview.html = this._getHtml();
    }
  }
}

// ============================================================================
// Activation
// ============================================================================

export function activateTemplateExplorer(context: vscode.ExtensionContext): void {
  const provider = new TemplateExplorerProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      TemplateExplorerProvider.viewType,
      provider,
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("asijs.openTemplateExplorer", () => {
      vscode.commands.executeCommand("workbench.view.extension.asijs-sidebar");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("asijs.previewTemplateFile", async (templateId: string, filePath: string) => {
      const template = TEMPLATES.find((t) => t.id === templateId);
      if (!template) return;

      const file = template.files.find((f) => f.path === filePath);
      if (!file) return;

      const doc = await vscode.workspace.openTextDocument({
        content: file.content,
        language: file.language || "plaintext",
      });
      vscode.window.showTextDocument(doc, { preview: true });
    }),
  );
}
