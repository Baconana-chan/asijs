# Async Error Boundary — Structured Error Handling

Structured error handling for AsiJS: classify errors, catch them with a
boundary, report through a pipeline, and retry idempotent operations.

```typescript
import { Asi, errorBoundary } from "asijs";

const app = new Asi();
app.plugin(errorBoundary());
```

## Error Classification

| Category | Status | Retryable | Meaning |
|----------|--------|-----------|---------|
| `business` | 4xx | no | Client-side problem — not a server fault |
| `system` | 5xx | yes | Server-side fault |
| `fatal` | 500 | no | Process-level crash — must not be swallowed |
| `validation` | 400 | no | Validation engine errors |

Structured response body:

```json
{
  "error": "No such user",
  "code": "USER_MISSING",
  "category": "business",
  "requestId": "dd9e377b-..."
}
```

## Error Classes

```typescript
import {
  HttpError, BusinessError, NotFoundError, UnauthorizedError,
  ForbiddenError, ConflictError, SystemError, FatalError,
  classifyError,
} from "asijs";

// Throw business errors in handlers:
app.get("/users/:id", async (ctx) => {
  const user = await db.find(ctx.params.id);
  if (!user) throw new NotFoundError("User not found");
  return user;
});

// Classify any value programmatically:
const classified = classifyError(error);
console.log(classified.category, classified.status, classified.code);
```

## ctx.errorBoundary

Catch errors inside a handler and return a fallback or structured response:

```typescript
app.get("/risky", async (ctx) => {
  const result = await ctx.errorBoundary(
    () => riskyCall(),
    { fallback: { ok: false } },              // value on error
  );
  return result;
});

app.get("/metric", async (ctx) => {
  return ctx.errorBoundary(
    () => fetchMetric(),
    {
      onError: (classified) => {
        // classified: { category, status, code, message, retryable }
        return { error: classified.code ?? "UNKNOWN", ok: false };
      },
    },
  );
});
```

Options: `fallback`, `onError(classified)`, `rethrow`, `report`.

## Reporting Pipeline

`errorBoundary()` accepts reporter hooks — Sentry, structured logger, metrics:

```typescript
app.plugin(errorBoundary({
  reporters: [
    (report) => sentry.captureException(report.error, {
      extra: { path: report.ctx.path, code: report.classified.code },
    }),
    (report) => metrics.increment(`errors.${report.classified.category}`),
  ],
  minCategory: "system",        // skip business/validation in reports
  logToConsole: true,
}));
```

The plugin also:
- Attaches `ctx.store.requestId` (correlation id) and echoes it in error bodies
- Registers a global `onError` handler returning structured JSON
- Provides `tryCatch(fn)` → `{ ok, value } | { ok: false, error: ClassifiedError }`

## Retry Policies

```typescript
import { retry, computeBackoff } from "asijs";

const data = await retry(
  () => fetch("https://api.example.com/data").then((r) => r.json()),
  {
    attempts: 3,
    backoff: "exponential",     // fixed | linear | exponential
    delayMs: 50,
    maxDelayMs: 1000,
    jitter: 0.2,                // randomize delay to avoid thundering herd
  },
);
```

- Default `shouldRetry`: retryable 5xx `HttpError`s and network errors
  (`fetch failed`, `ECONNREFUSED`, `ENOTFOUND`, `ETIMEDOUT`, `EAI_AGAIN`)
- `onRetry(error, attempt)` callback between attempts
- `computeBackoff(attempt, opts)` exported for custom schedulers
