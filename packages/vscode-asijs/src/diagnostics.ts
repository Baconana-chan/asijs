/**
 * Diagnostics — Inline error highlighting for AsiJS projects.
 *
 * Provides:
 * - Diagnostics for common AsiJS config issues
 * - Missing exports checks
 * - Validation in .ts/.tsx files
 * - Automatic refresh on save
 */

import * as vscode from "vscode";
import { existsSync } from "fs";
import { join, relative, dirname } from "path";

// ============================================================================
// Diagnostic Collection
// ============================================================================

const asiDiagnostics = vscode.languages.createDiagnosticCollection("asijs");

/**
 * Refresh diagnostics for all open AsiJS documents.
 */
async function refreshDiagnostics(document: vscode.TextDocument): Promise<void> {
  if (document.languageId !== "typescript" && document.languageId !== "typescriptreact") {
    return;
  }

  const diagnostics: vscode.Diagnostic[] = [];
  const text = document.getText();
  const fileName = document.fileName;
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  const relativePath = workspaceFolder ? relative(workspaceFolder.uri.fsPath, fileName) : fileName;

  // 1. Check for package.json in the project root
  if (workspaceFolder) {
    const pkgPath = join(workspaceFolder.uri.fsPath, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkgContent = JSON.parse(
          (await vscode.workspace.openTextDocument(pkgPath)).getText(),
        );
        const hasAsiDep = pkgContent.dependencies?.asijs || pkgContent.devDependencies?.asijs;
        if (!hasAsiDep) {
          // Warn about missing asi dependency somewhere in the file
          const lineCount = document.lineCount;
          if (isEntryFile(relativePath, document)) {
            diagnostics.push(
              createDiagnostic(
                document,
                0,
                "Missing 'asijs' in dependencies. Add it with: bun add asijs",
                vscode.DiagnosticSeverity.Warning,
                "asijs",
              ),
            );
          }
        }
      } catch { /* ignore parse errors */ }
    }
  }

  // 2. Check for common AsiJS patterns
  const importLines = text.match(/import.*from\s+["']asijs["']/g);
  const hasAsiImport = importLines && importLines.length > 0;
  const hasAppUsage = /new\s+Asi\s*\(/.test(text);

  if (hasAsiImport && !hasAppUsage) {
    // Suggest creating an app instance
    const line = text.split("\n").findIndex((l) => /import.*from\s+["']asijs["']/.test(l));
    if (line >= 0) {
      diagnostics.push(
        createDiagnostic(
          document,
          line,
          "Import 'Asi' from 'asijs' and create an app instance: const app = new Asi();",
          vscode.DiagnosticSeverity.Information,
          "asijs",
        ),
      );
    }
  }

  // 3. Check for missing .listen() in entry files
  if (isEntryFile(relativePath, document) && hasAsiImport) {
    const hasListen = /\.listen\s*\(/.test(text);
    if (!hasListen) {
      const line = text.split("\n").length - 1;
      diagnostics.push(
        createDiagnostic(
          document,
          line,
          "Entry file should call app.listen(port) to start the server",
          vscode.DiagnosticSeverity.Warning,
          "asijs",
        ),
      );
    }

    // Check for missing export for edge/cloudflare deployments
    const isEdgeTarget = /cloudflare|deno|vercel/i.test(relativePath) || text.includes("asijs/edge");
    if (isEdgeTarget && !text.includes("export default") && !text.includes("export {") && !text.includes("export default cloudflare")) {
      const lastLine = text.split("\n").length - 1;
      diagnostics.push(
        createDiagnostic(
          document,
          lastLine,
          "Edge deployments need a default export: export default cloudflare(app)",
          vscode.DiagnosticSeverity.Hint,
          "asijs",
        ),
      );
    }
  }

  // 4. Check for missing typebox imports when using validation
  const hasTypeBoxUsage = /Type\.(Object|String|Number|Boolean|Array|Optional|Union|Intersect)\s*\(/.test(text);
  const hasTypeBoxImport = /@sinclair\/typebox/.test(text);
  if (hasTypeBoxUsage && !hasTypeBoxImport) {
    for (const match of text.matchAll(/Type\.\w+\s*\(/g)) {
      if (match.index !== undefined) {
        const line = text.slice(0, match.index).split("\n").length - 1;
        diagnostics.push(
          createDiagnostic(
            document,
            line,
            "Using TypeBox types requires: import { Type } from '@sinclair/typebox'",
            vscode.DiagnosticSeverity.Error,
            "asijs",
          ),
        );
        break; // Only show once
      }
    }
  }

  // 5. Suggest using async for handlers with await
  if (!/\basync\b/.test(text)) {
    const awaitMatches = text.matchAll(/\bawait\b/g);
    for (const match of awaitMatches) {
      if (match.index !== undefined) {
        const line = text.slice(0, match.index).split("\n").length - 1;
        diagnostics.push(
          createDiagnostic(
            document,
            line,
            "Using 'await' requires an async handler",
            vscode.DiagnosticSeverity.Warning,
            "asijs",
          ),
        );
        break;
      }
    }
  }

  // 6. Check for TODO/FIXME comments
  const todoPattern = /\/\/\s*(TODO|FIXME|HACK|XXX)\b/gi;
  for (const match of text.matchAll(todoPattern)) {
    if (match.index !== undefined) {
      const line = text.slice(0, match.index).split("\n").length - 1;
      diagnostics.push(
        createDiagnostic(
          document,
          line,
          match[0].trim(),
          vscode.DiagnosticSeverity.Information,
          "asijs",
        ),
      );
    }
  }

  asiDiagnostics.set(document.uri, diagnostics);
}

/**
 * Check if a file is a likely entry file.
 */
function isEntryFile(relativePath: string, document: vscode.TextDocument): boolean {
  const fileName = document.fileName;
  const entryPatterns = ["src/index.ts", "src/index.tsx", "src/app.ts", "index.ts", "index.tsx"];
  const baseName = relativePath.replace(/\\/g, "/");
  return entryPatterns.some((p) => baseName.endsWith(p));
}

/**
 * Create a VS Code Diagnostic with AsiJS source.
 */
function createDiagnostic(
  document: vscode.TextDocument,
  line: number,
  message: string,
  severity: vscode.DiagnosticSeverity,
  source: string,
): vscode.Diagnostic {
  const lineText = document.lineAt(Math.min(line, document.lineCount - 1));
  const range = new vscode.Range(line, 0, line, lineText.text.length);
  const diagnostic = new vscode.Diagnostic(range, message, severity);
  diagnostic.source = source;
  return diagnostic;
}

/**
 * Subscribe to document open/change/save events.
 */
function subscribeToDocumentEvents(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(refreshDiagnostics),
    vscode.workspace.onDidChangeTextDocument((e) => refreshDiagnostics(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => asiDiagnostics.delete(doc.uri)),
  );

  // Refresh for all visible editors on activation
  vscode.window.visibleTextEditors.forEach((editor) => {
    refreshDiagnostics(editor.document);
  });
}

// ============================================================================
// Code Actions Provider
// ============================================================================

class AsiCodeActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    _context: vscode.CodeActionContext,
    _token: vscode.CancellationToken,
  ): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
    const actions: vscode.CodeAction[] = [];
    const text = document.getText();

    // Fix missing TypeBox import
    if (text.includes("Type.") && !text.includes("@sinclair/typebox")) {
      const fix = new vscode.CodeAction(
        "Add TypeBox import",
        vscode.CodeActionKind.QuickFix,
      );
      fix.edit = new vscode.WorkspaceEdit();
      const firstLine = document.lineAt(0);
      fix.edit.insert(document.uri, firstLine.range.start, `import { Type } from "@sinclair/typebox";\n`);
      actions.push(fix);
    }

    // Fix missing async keyword
    if (/\bawait\b/.test(text)) {
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes("await") && !line.includes("async")) {
          // Check if we can add async before the function
          const arrowMatch = line.match(/(\()\s*\w+\s*\)\s*=>/);
          if (arrowMatch) {
            const fix = new vscode.CodeAction(
              `Make handler async (line ${i + 1})`,
              vscode.CodeActionKind.QuickFix,
            );
            fix.edit = new vscode.WorkspaceEdit();
            const handlerStart = line.indexOf(arrowMatch[1]);
            const pos = new vscode.Position(i, handlerStart);
            fix.edit.insert(document.uri, pos, "async ");
            actions.push(fix);
          }
          break;
        }
      }
    }

    return actions;
  }
}

// ============================================================================
// Activation
// ============================================================================

export function activateDiagnostics(context: vscode.ExtensionContext): void {
  // Register diagnostic collection
  context.subscriptions.push(asiDiagnostics);

  // Subscribe to document events
  subscribeToDocumentEvents(context);

  // Register code actions
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      ["typescript", "typescriptreact"],
      new AsiCodeActionProvider(),
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
  );

  // Register "Check AsiJS Config" command
  context.subscriptions.push(
    vscode.commands.registerCommand("asijs.checkDiagnostics", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage("Open an AsiJS file to check for issues");
        return;
      }

      await refreshDiagnostics(editor.document);
      const uri = editor.document.uri;
      const diags = asiDiagnostics.get(uri);

      if (!diags || diags.length === 0) {
        vscode.window.showInformationMessage("✅ No issues found in this file");
      } else {
        const errors = diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Error).length;
        const warnings = diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Warning).length;
        const info = diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Information).length;
        vscode.window.showInformationMessage(
          `Found ${diags.length} issue(s): ${errors} error(s), ${warnings} warning(s), ${info} info`,
        );
      }
    }),
  );
}
