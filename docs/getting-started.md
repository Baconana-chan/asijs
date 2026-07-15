# Getting Started

## Installation

```bash
# Create a new AsiJS project
bun create asijs my-app

# Or install in existing project
bun add asijs
```

AsiJS requires **Bun >= 1.0.0** and **TypeScript >= 5.0**.

## Quick Start

Create a file `index.ts`:

```typescript
import { Asi } from "asijs";

const app = new Asi();

app.get("/", () => "Hello, World!");
app.get("/json", () => ({ message: "Hello" }));
app.get("/user/:id", (ctx) => `User ${ctx.params.id}`);

app.listen(3000);
```

Run with Bun:

```bash
bun run index.ts
```

## CLI

AsiJS includes a powerful CLI:

```bash
# Create a new project
bunx asijs create my-app

# Create with template
bunx asijs create my-app -t fullstack
bunx asijs create my-app -t auth
bunx asijs create my-app -t realtime
bunx asijs create my-app -t workspace

# Development server (standalone hot-reload)
bunx asijs dev

# Migration from other frameworks
bunx asijs migrate ./src --from elysia
bunx asijs migrate ./src --from hono
bunx asijs migrate ./app.ts --from fastify
```

## Configuration

```typescript
const app = new Asi({
  port: 3000,
  hostname: "0.0.0.0",
  development: true,
  silent: false,         // Suppress logs (for tests)
  startupBanner: true,   // Show startup info
  autoPort: true,        // Auto-find port if busy
  decodeQuery: false,     // Decode URI components in query
});
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `BUN_ENV` / `NODE_ENV` | Environment mode | `development` |
| `ASIJS_APP_NAME` | Tenant ID for workspace | `default` |
| `ASIJS_RATE_LIMIT_MAX` | Max requests per window | `1000` |
| `ASIJS_RATE_LIMIT_WINDOW_MS` | Time window in ms | `60000` |

## First Application

```typescript
import { Asi, Type } from "asijs";

const app = new Asi();

// Simple routes
app.get("/", () => ({ name: "AsiJS", version: "1.0.0" }));

// Route with parameters
app.get("/hello/:name", (ctx) => ({
  message: `Hello, ${ctx.params.name}!`,
}));

// POST with TypeBox validation
app.post(
  "/users",
  (ctx) => {
    // ctx.body is typed as { name: string; email: string }
    return { success: true, user: ctx.body };
  },
  {
    body: Type.Object({
      name: Type.String({ minLength: 1 }),
      email: Type.String({ format: "email" }),
    }),
  },
);

// Route groups
app.group("/api", (api) => {
  api.get("/users", () => [{ id: 1, name: "Alice" }]);
  api.get("/users/:id", (ctx) => ({ id: ctx.params.id }));
});

app.listen(3000);
```
