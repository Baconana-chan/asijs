# Workspace Development

In a Bun monorepo with multiple sub-apps, `bun --hot` restarts the entire process. AsiJS Workspace Development spawns each sub-app as its own Bun process with `--hot`, so only the changed sub-app reloads.

```bash
bunx asijs dev
```

## Programmatic Usage

```typescript
import { asiDev, scanWorkspace, startWorkspaceDev } from "asijs";

// Option 1: Scan + start
const controller = await asiDev();

// Option 2: Manual config
const controller = await startWorkspaceDev([
  {
    name: "api",
    entryPoint: "./apps/api/src/index.ts",
    rootDir: "./apps/api",
  },
  {
    name: "web",
    entryPoint: "./apps/web/src/index.ts",
    rootDir: "./apps/web",
  },
], { basePort: 3000, verbose: true });

await controller.stop();
```

## Controller API

```typescript
controller.running;         // boolean
controller.apps;            // SubApp[]
await controller.stop();    // Stop all
await controller.restartApp("api");  // Restart specific
```

## Environment Variables

Each sub-app receives:

| Variable | Value |
|----------|-------|
| `PORT` | Auto-assigned (3000, 3001, ...) |
| `ASIJS_DEV` | `"1"` |
| `ASIJS_WORKSPACE` | `"1"` |
| `ASIJS_APP_NAME` | Sub-app name (tenant ID) |
| `ASIJS_RATE_LIMIT_MAX` | Per-tenant limit (if configured) |
