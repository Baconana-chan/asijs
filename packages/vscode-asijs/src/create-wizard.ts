/**
 * Create AsiJS Project Wizard.
 *
 * Provides a QuickPick-based interactive wizard for creating new AsiJS projects:
 * 1. Select a template
 * 2. Enter project name
 * 3. Choose a directory
 * 4. Create the project files
 */

import * as vscode from "vscode";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { TEMPLATES, type Template } from "./templates";

/**
 * Create the QuickPick-based project creation wizard.
 */
async function showTemplatePicker(): Promise<Template | undefined> {
  const categories = [...new Set(TEMPLATES.map((t) => t.category))];
  const items: (vscode.QuickPickItem & { template?: Template; isCategory?: boolean })[] = [];

  for (const cat of categories) {
    items.push({
      label: cat,
      kind: vscode.QuickPickItemKind.Separator,
      isCategory: true,
    });
    const catTemplates = TEMPLATES.filter((t) => t.category === cat).sort((a, b) => a.order - b.order);
    for (const t of catTemplates) {
      items.push({
        label: `${t.icon}  ${t.name}`,
        description: t.description,
        detail: `${t.files.length} files`,
        template: t,
      });
    }
  }

  const picked = await vscode.window.showQuickPick(items, {
    title: "AsiJS: Create New Project",
    placeHolder: "Select a project template",
    matchOnDescription: true,
    matchOnDetail: true,
  });

  return picked?.template;
}

/**
 * Show a QuickPick to get the project name.
 */
async function showProjectNameInput(defaultName: string): Promise<string | undefined> {
  const name = await vscode.window.showInputBox({
    title: "AsiJS: Create New Project",
    prompt: "Enter a project name",
    value: defaultName,
    validateInput: (value: string) => {
      if (!value || value.trim().length === 0) {
        return "Project name is required";
      }
      if (!/^[a-z0-9-_]+$/i.test(value.trim())) {
        return "Project name can only contain letters, numbers, hyphens, and underscores";
      }
      return null;
    },
  });

  return name?.trim();
}

/**
 * Show a folder picker to select the project directory.
 */
async function showFolderPicker(defaultName: string): Promise<string | undefined> {
  const options: vscode.OpenDialogOptions = {
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    title: "AsiJS: Select project directory",
    openLabel: "Create project here",
    defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
  };

  const result = await vscode.window.showOpenDialog(options);
  if (!result || result.length === 0) return undefined;

  const projectPath = join(result[0].fsPath, defaultName);

  if (existsSync(projectPath)) {
    const overwrite = await vscode.window.showWarningMessage(
      `Directory "${projectPath}" already exists. Overwrite?`,
      { modal: true },
      "Overwrite",
      "Cancel",
    );
    if (overwrite !== "Overwrite") return undefined;
  }

  return projectPath;
}

/**
 * Create the project files from the template.
 */
async function createProjectFiles(
  template: Template,
  projectPath: string,
  projectName: string,
): Promise<void> {
  const progressOptions: vscode.ProgressOptions = {
    location: vscode.ProgressLocation.Notification,
    title: "Creating AsiJS project...",
    cancellable: false,
  };

  await vscode.window.withProgress(progressOptions, async (progress) => {
    mkdirSync(projectPath, { recursive: true });

    const files = template.files;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const filePath = join(projectPath, file.path);
      const dirPath = resolve(filePath, "..");

      if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true });
      }

      // Replace placeholder project names
      let content = file.content;
      content = content.replace(/my-app/g, projectName);
      content = content.replace(/my-api/g, projectName);
      content = content.replace(/my-worker/g, projectName);
      content = content.replace(/my-auth/g, projectName);
      content = content.replace(/my-workspace/g, projectName);

      writeFileSync(filePath, content);

      progress.report({
        message: `Creating ${file.path}...`,
        increment: (100 / files.length),
      });
    }

    // Create .gitignore if not included
    const gitignorePath = join(projectPath, ".gitignore");
    if (!existsSync(gitignorePath)) {
      writeFileSync(gitignorePath, "node_modules\ndist\n.env\n*.log\n");
    }
  });
}

/**
 * Open the project in VS Code after creation.
 */
async function openProject(projectPath: string, openInNewWindow: boolean): Promise<void> {
  const uri = vscode.Uri.file(projectPath);

  if (openInNewWindow) {
    await vscode.commands.executeCommand("vscode.openFolder", uri, { forceNewWindow: true });
  } else {
    // Add folder to workspace
    vscode.workspace.updateWorkspaceFolders(
      vscode.workspace.workspaceFolders?.length ?? 0,
      0,
      { uri },
    );

    // Open the main file
    const mainFile = join(projectPath, "src", "index.ts");
    if (existsSync(mainFile)) {
      const doc = await vscode.workspace.openTextDocument(mainFile);
      vscode.window.showTextDocument(doc);
    } else {
      const indexPath = join(projectPath, "src", "index.tsx");
      if (existsSync(indexPath)) {
        const doc = await vscode.workspace.openTextDocument(indexPath);
        vscode.window.showTextDocument(doc);
      }
    }
  }
}

// ============================================================================
// Activation
// ============================================================================

export function activateCreateWizard(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("asijs.createProject", async (templateId?: string) => {
      try {
        // Step 1: Select template
        let template: Template | undefined;
        if (templateId) {
          template = TEMPLATES.find((t) => t.id === templateId);
          if (!template) {
            vscode.window.showErrorMessage(`Template "${templateId}" not found`);
            return;
          }
        } else {
          template = await showTemplatePicker();
          if (!template) return; // User cancelled
        }

        // Step 2: Enter project name
        const projectName = await showProjectNameInput(template.name.toLowerCase().replace(/\s+/g, "-"));
        if (!projectName) return; // User cancelled

        // Step 3: Choose directory
        const projectPath = await showFolderPicker(projectName);
        if (!projectPath) return; // User cancelled

        // Step 4: Create files
        await createProjectFiles(template, projectPath, projectName);

        vscode.window.showInformationMessage(
          `✅ AsiJS project "${projectName}" created successfully!`,
          "Open in new window",
          "Add to workspace",
        ).then(async (selection) => {
          if (selection === "Open in new window") {
            await openProject(projectPath, true);
          } else if (selection === "Add to workspace") {
            await openProject(projectPath, false);
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to create project: ${message}`);
      }
    }),
  );
}
