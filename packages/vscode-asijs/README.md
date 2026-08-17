# vscode-asijs — AsiJS support for VS Code

Snippets, route explorer, templates, debugging and inline diagnostics for AsiJS projects — everything a Bun + TypeScript API developer needs, in the sidebar and right-click menu.

## Features

### 🧭 Route Explorer
A sidebar webview that parses the **active file** and lists every route (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `WS`, …) with colored method badges. Live-updates as you type or switch editors.

- Command: `AsiJS: Open Route Explorer` (also available via right-click on a folder)
- `AsiJS: Show Route Definition` — jumps to the route under the cursor

### ✨ Snippets
TypeScript/JavaScript/TSX snippets for AsiJS: app setup, routes, validation schemas, plugins, middleware, WebSockets, error handling and more.

### 📁 Project Templates
Create a new AsiJS project from built-in templates with a wizard: pick a template → name → folder → files are scaffolded → opens in a new window.

Built-in templates: **Minimal**, **REST API**, **Fullstack**, **Auth**, **Realtime**, **Cloudflare Workers**, **SPA + SSR**, **Deno / Deno Deploy**, **Workspace**.

- Command: `AsiJS: Create New Project...`
- `AsiJS: Open Template Explorer` — browse templates in the sidebar

### 🐞 Debugging
One-click debug launch for AsiJS apps on **Bun** with hot reload (`bun run --hot`). Adds a debug configuration type `asijs`:

```jsonc
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "AsiJS: Launch",
      "type": "asijs",
      "request": "launch",
      "runtimeExecutable": "bun",
      "runtimeArgs": ["run", "--hot"],
      "program": "${workspaceFolder}/src/index.ts",
      "cwd": "${workspaceFolder}"
    }
  ]
}
```

- Command: `AsiJS: Start Debugging` (also available from the editor title bar / editor context menu)

### ⚠️ Inline Diagnostics
Lints open AsiJS files for common issues as you type:

- `asijs` missing from `package.json` dependencies (`bun add asijs`)
- Missing default export / entry file conventions
- Common config mistakes in `.ts` / `.tsx` files

- Command: `AsiJS: Check File for Issues` (editor context menu)
- Toggle via setting `asijs.enableDiagnostics`

## Installation

From the [VS Code Marketplace](https://marketplace.visualstudio.com/) (search "AsiJS"), or package locally:

```bash
bun install
bun run package   # vsce package → .vsix
code --install-extension vscode-asijs-*.vsix
```

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `asijs.entryFile` | `src/index.ts` | Default entry file for AsiJS applications |
| `asijs.defaultPort` | `3000` | Default port for the AsiJS dev server |
| `asijs.enableDiagnostics` | `true` | Enable inline diagnostics for AsiJS files |

## Commands

| Command | ID |
|---------|-----|
| Open Route Explorer | `asijs.openRouteExplorer` |
| Show Route Definition | `asijs.showRoute` |
| Create New Project... | `asijs.createProject` |
| Start Debugging | `asijs.startDebugging` |
| Open Template Explorer | `asijs.openTemplateExplorer` |
| Check File for Issues | `asijs.checkDiagnostics` |

## Development

```bash
bun install
bun test              # unit tests (templates, diagnostics, parse-routes)
bun run build         # tsc → dist/
bun run watch         # tsc --watch for extension development
```
