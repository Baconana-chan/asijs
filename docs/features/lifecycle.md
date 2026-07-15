# Graceful Shutdown

```typescript
import { lifecycle, healthCheck, LifecycleManager } from "asijs";

app.plugin(lifecycle({
  timeout: 30_000,    // 30s max for shutdown
  verbose: true,
  handleSignals: true, // Handle SIGINT/SIGTERM
}));

// Health check endpoints
app.plugin(healthCheck({
  checks: {
    db: async () => { await db.ping(); return true; },
    redis: async () => { await redis.ping(); return true; },
  },
}));
```

## Manual Lifecycle Manager

```typescript
const manager = new LifecycleManager({ handleSignals: false });

manager.onShutdown(async () => {
  await db.close();
  await cache.flush();
  console.log("Cleanup complete");
});

await manager.shutdown();
```

## Health Endpoints

The `healthCheck()` plugin adds:
- `GET /health` → `{ status: "healthy", checks: {...} }`
- `GET /live` → `{ alive: true }`
- `GET /ready` → `{ ready: true }`

**Note:** The `notFound()` method was renamed to `onNotFound()` in v1.1.
