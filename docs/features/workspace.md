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

---

# Workspace V2 — Production Multi-App Server

Runs multiple AsiJS apps on a **single `Bun.serve()`** with host-based and
prefix-based routing, a **live monitoring dashboard**, a **shared state bus**
and graceful shutdown cascade.

```typescript
import { Workspace, EventBus } from "asijs";

const ws = new Workspace({
  verbose: true,
  bus: new EventBus({ name: "shared" }), // optional shared state bus
});

ws.app("api", {}, (app) => {
  app.get("/users", () => [{ id: 1 }]);
});

ws.appWith({
  name: "web",
  prefix: "/web",
  setup: (app) => {
    app.get("/", () => "Hello Web");
  },
});

ws.listen(3000);
```

## Dashboard v2 — Live Monitoring

Open `http://localhost:3000/__asi/workspace` (auto-refresh every 2s):

- **Process** — PID, uptime, RSS, heap, CPU
- **Per app** — request rate (req/s), error rate, avg duration, total requests, WebSocket connections
- **Per route** — count, errors, error %, avg duration
- **Circuit breakers** — state (OPEN / CLOSED / HALF_OPEN), success/failure counts
- **Shared bus** — topics, handlers, emitted events, Redis mode

JSON endpoint: `GET /__asi/metrics` (used by the dashboard itself).

```typescript
const ws = new Workspace({ metrics: true, metricsPath: "/__asi/metrics" });
// metrics: false disables collection and the endpoint
```

## Shared State Bus

`EventBus` provides pub/sub between sub-apps — in-memory by default, or across
processes/instances via Redis:

```typescript
import { EventBus, createRedisEventBus } from "asijs";

// In-memory
const bus = new EventBus();
bus.on("order.created", (order) => console.log("New order:", order.id));

// With Redis bridge (cross-instance)
const bus = await createRedisEventBus({ url: process.env.REDIS_URL! });

// Inside any sub-app:
const bus = app.getState<EventBus>("eventBus");
bus.emit("deploy", { app: "api", version: "1.4.0" });
```

## Graceful Shutdown Cascade

`ws.stop()` shuts down in the correct order:

1. Drain each sub-app's WebSocket connections (1001 close frames)
2. Run each sub-app's `lifecycle()` manager if attached
3. Stop the root `Bun.serve()` last

```typescript
await ws.stop(); // sub-apps → root
```
