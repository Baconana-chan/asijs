# vscode-asijs — AsiJS support for VS Code

Snippets, route explorer, project templates, one-click debugging and inline diagnostics for AsiJS — in the sidebar, editor title bar and context menus.

- Package: `vscode-asijs` (installed from the VS Code Marketplace, not npm)
- Current: 0.2.0

## Installation

From the VS Code Marketplace (search "AsiJS"), or package locally:

```bash
bun install
bun run package     # vsce package → .vsix
code --install-extension vscode-asijs-*.vsix
```

## Features

### 🧭 Route Explorer

A sidebar webview that parses the **active file** and lists every route (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `WS`, …) with colored method badges. It live-updates as you type or switch editors.

- Command: `AsiJS: Open Route Explorer` (also in the folder context menu)
- Command: `AsiJS: Show Route Definition` — jumps to the route under the cursor

### ✨ Snippets

TypeScript / JavaScript / TSX snippets: app setup, routes, validation schemas, plugins, middleware, WebSockets, error handling and more. Type `asi` to see the snippet list.

### 📁 Project Templates

Create a new AsiJS project from built-in templates with a wizard: pick a template → name → folder → files scaffolded → opens in a new window.

Built-in templates: **Minimal**, **REST API**, **Fullstack**, **Auth**, **Realtime**, **Cloudflare Workers**, **SPA + SSR**, **Deno / Deno Deploy**, **Workspace**.

- Command: `AsiJS: Create New Project...`
- Command: `AsiJS: Open Template Explorer` — browse templates in the sidebar

### 🐞 Debugging

One-click debug launch for AsiJS on **Bun** with hot reload (`bun run --hot`). Adds a debug configuration type `asijs`:

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

- Command: `AsiJS: Start Debugging` (also from the editor title bar / editor context menu)

### ⚠️ Inline Diagnostics

Lints open AsiJS files as you type:

- `asijs` missing from `package.json` dependencies (suggests `bun add asijs`)
- Missing default export / entry-file conventions
- Common config mistakes in `.ts` / `.tsx` files

- Command: `AsiJS: Check File for Issues` (editor context menu)
- Toggle via setting `asijs.enableDiagnostics`

## Settings

| Setting | Default | Description |
|---|---|---|
| `asijs.entryFile` | `src/index.ts` | Default entry file for AsiJS applications |
| `asijs.defaultPort` | `3000` | Default port for the AsiJS dev server |
| `asijs.enableDiagnostics` | `true` | Enable inline diagnostics for AsiJS files |

## Commands

| Command | ID |
|---|---|
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

### Running the extension locally (Extension Host)

1. `bun run watch` (or `bun run build`)
2. Press `F5` in VS Code — launches an Extension Development Host with the extension loaded
3. Open a folder with an AsiJS app to see diagnostics + the route explorer

## Troubleshooting

- **Route Explorer is empty** — the explorer parses the **active editor** file; make sure an AsiJS source file is focused. If you use file-based routing (`src/routes/*`), open the `routes` folder and use `Open Route Explorer` from the folder context menu.
- **Diagnostics don't appear** — check `asijs.enableDiagnostics` is `true` and the file is `.ts` / `.tsx` inside the workspace.
- **Debug launch fails** — ensure `bun` is on `PATH` (or set `runtimeExecutable` to the absolute path).
