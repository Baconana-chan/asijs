# Rate Limiting

## Global Rate Limit

```typescript
import { rateLimit, standardLimit, strictLimit, apiLimit, authLimit } from "asijs";

app.plugin(rateLimit({
  max: 100,           // requests
  windowMs: 60_000,   // per minute
  message: "Too many requests",
}));

// Built-in presets
app.plugin(rateLimit(standardLimit));  // 100 req/min
app.plugin(rateLimit(strictLimit));    // 20 req/min
app.plugin(rateLimit(apiLimit));       // 1000 req/min
app.plugin(rateLimit(authLimit));      // 5 req/min
```

## Per-Route Rate Limit

```typescript
app.post("/auth/login", handler, {
  beforeHandle: rateLimitMiddleware({
    max: 5,
    windowMs: 60_000,
    keyGenerator: (ctx) => ctx.header("X-Forwarded-For") ?? ctx.ip,
  }),
});
```

## Custom Store

```typescript
import { MemoryStore, TokenBucketStore } from "asijs";

app.plugin(rateLimit({
  store: new TokenBucketStore({ capacity: 100, refillRate: 10 }),
}));
```

## Tenant Rate Limiting (Workspace)

```typescript
import { workspaceRateLimit, TenantStore } from "asijs";

// Auto-reads from env: ASIJS_APP_NAME, ASIJS_RATE_LIMIT_MAX, etc.
app.plugin(workspaceRateLimit());

// Or explicitly:
app.plugin(workspaceRateLimit({
  tenantId: "my-api",
  max: 1000,
  windowMs: 60_000,
  store: new TenantStore("my-api"),
}));
```
