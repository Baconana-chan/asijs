/**
 * Debug Configuration Provider for AsiJS.
 *
 * Registers a dynamic debug configuration provider that:
 * - Provides "AsiJS: Launch" and "AsiJS: Attach" configurations
 * - Uses VS Code's built-in JavaScript debugger with `bun --inspect`
 * - Configures source maps for correct handler-level breakpoints
 * - Sets up correct runtime args for AsiJS apps
 */

import * as vscode from "vscode";
import { existsSync } from "fs";
import { join } from "path";

/**
 * Debug configuration provider for AsiJS applications.
 */
export class AsiJSDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
  provideDebugConfigurations(
    _folder: vscode.WorkspaceFolder | undefined,
    _token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.DebugConfiguration[]> {
    return [
      {
        name: "AsiJS: Launch",
        type: "node",
        request: "launch",
        runtimeExecutable: "bun",
        runtimeArgs: ["run", "--hot"],
        program: "${workspaceFolder}/src/index.ts",
        cwd: "${workspaceFolder}",
        internalConsoleOptions: "openOnSessionStart",
        skipFiles: ["<node_internals>/**"],
        sourceMapPathOverrides: {
          "webpack:///./src/*": "${workspaceFolder}/src/*",
          "webpack:///src/*": "${workspaceFolder}/src/*",
        },
        resolveSourceMapLocations: [
          "${workspaceFolder}/**",
          "!**/node_modules/**",
        ],
        presentation: {
          group: "asijs",
          order: 1,
        },
      },
      {
        name: "AsiJS: Launch (with verbose)",
        type: "node",
        request: "launch",
        runtimeExecutable: "bun",
        runtimeArgs: ["run", "--hot"],
        program: "${workspaceFolder}/src/index.ts",
        cwd: "${workspaceFolder}",
        internalConsoleOptions: "openOnSessionStart",
        env: {
          DEBUG: "asijs:*",
          LOG_LEVEL: "debug",
        },
        skipFiles: ["<node_internals>/**"],
        resolveSourceMapLocations: [
          "${workspaceFolder}/**",
          "!**/node_modules/**",
        ],
        presentation: {
          group: "asijs",
          order: 2,
        },
      },
      {
        name: "AsiJS: Attach to running",
        type: "node",
        request: "attach",
        port: 9229,
        address: "localhost",
        localRoot: "${workspaceFolder}",
        remoteRoot: "${workspaceFolder}",
        skipFiles: ["<node_internals>/**"],
        presentation: {
          group: "asijs",
          order: 3,
        },
      },
      {
        name: "AsiJS: Launch Workspace",
        type: "node",
        request: "launch",
        runtimeExecutable: "bunx",
        runtimeArgs: ["asijs", "dev"],
        cwd: "${workspaceFolder}",
        internalConsoleOptions: "openOnSessionStart",
        skipFiles: ["<node_internals>/**"],
        resolveSourceMapLocations: [
          "${workspaceFolder}/**",
          "!**/node_modules/**",
        ],
        presentation: {
          group: "asijs",
          order: 4,
        },
      },
    ];
  }

  resolveDebugConfiguration(
    folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
    _token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.DebugConfiguration> {
    // If no debug config is provided, try to infer one
    if (!config.type && !config.request && !config.name) {
      const workspaceFolder = folder?.uri.fsPath;
      if (!workspaceFolder) return null;

      // Look for entry files
      const entryPoints = ["src/index.ts", "src/index.tsx", "src/app.ts", "index.ts"];
      for (const entry of entryPoints) {
        const entryPath = join(workspaceFolder, entry);
        if (existsSync(entryPath)) {
          return {
            name: "AsiJS: Launch",
            type: "node",
            request: "launch",
            runtimeExecutable: "bun",
            runtimeArgs: ["run", "--hot"],
            program: entryPath,
            cwd: workspaceFolder,
            skipFiles: ["<node_internals>/**"],
          };
        }
      }

      // Check for workspace (asi.config.ts or asi.json)
      const configFiles = ["asi.config.ts", "asi.config.js", "asi.json"];
      for (const cfg of configFiles) {
        if (existsSync(join(workspaceFolder, cfg))) {
          return {
            name: "AsiJS: Launch Workspace",
            type: "node",
            request: "launch",
            runtimeExecutable: "bunx",
            runtimeArgs: ["asijs", "dev"],
            cwd: workspaceFolder,
            skipFiles: ["<node_internals>/**"],
          };
        }
      }

      return null;
    }

    // If the user has a partial config, fill in defaults
    if (config.type === "asijs") {
      config.type = "node";
    }

    if (config.request === "launch" && !config.runtimeExecutable) {
      config.runtimeExecutable = "bun";
    }

    return config;
  }

  resolveDebugConfigurationWithSubstitutedVariables(
    _folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
    _token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.DebugConfiguration> {
    return config;
  }
}

/**
 * Activate debug configuration features.
 */
export function activateDebugConfig(context: vscode.ExtensionContext): void {
  const provider = new AsiJSDebugConfigurationProvider();

  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider("asijs", provider),
    vscode.debug.registerDebugConfigurationProvider("node", provider),
  );

  // Track debug sessions for telemetry
  context.subscriptions.push(
    vscode.debug.onDidStartDebugSession((session) => {
      if (session.configuration.presentation?.group === "asijs") {
        console.log(`[AsiJS] Debug session started: ${session.name}`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.debug.onDidTerminateDebugSession((session) => {
      if (session.configuration.presentation?.group === "asijs") {
        console.log(`[AsiJS] Debug session terminated: ${session.name}`);
      }
    }),
  );

  // Register "Start Debugging" command
  context.subscriptions.push(
    vscode.commands.registerCommand("asijs.startDebugging", async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        vscode.window.showErrorMessage("No workspace folder open");
        return;
      }

      // Try to start debugging with the first AsiJS config
      const configs = await provider.provideDebugConfigurations(folder, undefined as any);
      if (configs && Array.isArray(configs) && configs.length > 0) {
        await vscode.debug.startDebugging(folder, configs[0]);
      } else {
        vscode.window.showErrorMessage("No AsiJS debug configuration available");
      }
    }),
  );
}
