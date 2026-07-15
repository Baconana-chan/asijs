# Error Handling

## Custom Error Handler

```typescript
app.onError((error, ctx) => {
  console.error(`[${ctx.method} ${ctx.path}]`, error);

  if (error instanceof ValidationException) {
    return ctx.status(400).jsonResponse({
      error: "Validation Error",
      details: error.errors,
    });
  }

  return ctx.status(500).jsonResponse({
    error: "Internal Server Error",
    ...(ctx.app.config.development && { message: error.message }),
  });
});
```

## Custom 404 Handler

```typescript
app.onNotFound((ctx) => {
  return ctx.status(404).jsonResponse({
    error: "Not Found",
    path: ctx.path,
  });
});
```

## Error Pages

AsiJS can auto-render HTML error pages for browser requests:

```
src/pages/404.tsx     → Custom 404 page
src/pages/500.tsx     → Custom 500 page
src/errors/404.tsx    → Alternative location
src/errors/error.tsx  → Error page (any status)
```

The framework searches these directories automatically:
- `src/pages/`, `src/pages/errors/`
- `src/routes/`, `src/routes/errors/`
- `src/errors/`, `pages/`, `errors/`

### Example Custom 404 Page

```tsx
// src/pages/404.tsx
import { jsx } from "asijs";

export default function NotFoundPage({ path, method }) {
  return (
    <div style={{ textAlign: "center", padding: "4rem" }}>
      <h1>404 — Page Not Found</h1>
      <p>The page <code>{path}</code> was not found.</p>
      <small>{method} request</small>
      <a href="/">Go Home</a>
    </div>
  );
}
```

### Configuration

```typescript
const app = new Asi({
  errorPages: {
    rootDir: process.cwd(),
    autoDiscover: true,
  },
});
```
