# AsiJS Plugin Development Guide

> **Version**: 1.2.0 · **Updated**: July 2026

This guide covers everything you need to know to create, test, and publish AsiJS plugins.

## Table of Contents

- [Quick Start](#quick-start)
- [Plugin Anatomy](#plugin-anatomy)
- [Adding Routes](#adding-routes)
- [Adding Middleware](#adding-middleware)
- [Plugin Configuration](#plugin-configuration)
- [Plugin Dependencies](#plugin-dependencies)
- [Hooks & Lifecycle](#hooks--lifecycle)
- [Testing](#testing)
- [Publishing](#publishing)
- [Examples](#examples)

## Quick Start

The fastest way to create a plugin:

```bash
bunx asijs plugin create my-plugin --with-tests
cd my-plugin
bun install
```

This scaffolds a complete plugin project with:
- `src/index.ts` — Plugin entry point
- `test/plugin.test.ts` — Test file
- `examples/basic.ts` — Usage example
- `package.json`, `tsconfig.json`, `README.md`

## Plugin Anatomy

An AsiJS plugin is created with `createPlugin()`:

```typescript
import { createPlugin, type AsiPlugin, type Context } from "asijs";

export interface MyPluginOptions {
  /** API key for external service */
  apiKey?: string;
}

export function myPlugin(options: MyPluginOptions = {}): AsiPlugin {
  return createPlugin({
    name: "my-plugin",

    setup(app) {
      // Add middleware
      app.use(async (ctx: Context, next: () => Promise<Response>) => {
        const start = Date.now();
        const response = await next();
        const duration = Date.now() - start;
        console.log(`[my-plugin] ${ctx.request.method} ${ctx.path} ${duration}ms`);
        return response;
      });

      // Add routes
      app.get("/my-plugin/health", () => ({
        status: "ok",
        plugin: "my-plugin",
      }));
    },
  });
}
```

## Adding Routes

Plugins can add any routes:

```typescript
setup(app) {
  // REST endpoints
  app.get("/plugin/resource", () => ({ data: "..." }));
  app.post("/plugin/resource", async (ctx) => ctx.json());
  app.put("/plugin/resource/:id", async (ctx) => ctx.json());
  app.delete("/plugin/resource/:id", () => new Response(null, { status: 204 }));

  // With validation
  app.get("/plugin/search", {
    schema: {
      query: Type.Object({
        q: Type.String(),
        limit: Type.Optional(Type.Number({ default: 20 })),
      }),
    },
  }, (ctx) => {
    return { query: ctx.query.q, limit: ctx.query.limit };
  });

  // WebSocket
  app.ws("/plugin/ws", {
    open(ws) { console.log("WS connected"); },
    message(ws, msg) { ws.send(msg); },
  });
}
```

## Adding Middleware

### Global Middleware

Runs on every request:

```typescript
setup(app) {
  app.use(async (ctx, next) => {
    // Before handler
    ctx.store.set("startTime", Date.now());

    const response = await next();

    // After handler
    console.log(`Duration: ${Date.now() - ctx.store.get("startTime")}ms`);
    return response;
  });
}
```

### Path-Based Middleware

Runs only on matching paths:

```typescript
setup(app) {
  app.use("/api/protected", async (ctx, next) => {
    const token = ctx.request.headers.get("Authorization");
    if (!token) {
      return new Response("Unauthorized", { status: 401 });
    }
    return next();
  });
}
```

## Plugin Configuration

Use the options pattern:

```typescript
export interface CachePluginOptions {
  ttl?: number;           // Cache TTL in seconds
  store?: "memory" | "redis";
  prefix?: string;        // Cache key prefix
  exclude?: string[];     // Paths to exclude from caching
}

export function cachePlugin(options: CachePluginOptions = {}): AsiPlugin {
  const ttl = options.ttl ?? 60;
  const store = options.store ?? "memory";
  const prefix = options.prefix ?? "asi:cache:";
  const exclude = options.exclude ?? ["/health", "/metrics"];

  return createPlugin({
    name: "cache",
    setup(app) {
      app.use(async (ctx, next) => {
        if (exclude.some(p => ctx.path.startsWith(p))) {
          return next();
        }

        const cacheKey = `${prefix}${ctx.request.method}:${ctx.path}`;
        // Cache logic...
        const response = await next();
        // Store response in cache...
        return response;
      });
    },
  });
}
```

## Plugin Dependencies

If your plugin depends on other plugins, declare them:

```typescript
import { createPlugin } from "asijs";
import { myPlugin } from "./my-plugin";

export function dependentPlugin(): AsiPlugin {
  return createPlugin({
    name: "dependent-plugin",
    dependencies: ["sessions", "cors"], // Will be initialized before this plugin

    setup(app) {
      // Sessions and cors are guaranteed to be ready
      app.get("/profile", async (ctx) => {
        // const user = ctx.session.get("user");
        return { message: "Profile" };
      });
    },
  });
}
```

## Hooks & Lifecycle

Use lifecycle hooks for advanced control:

```typescript
export function lifecyclePlugin(): AsiPlugin {
  return createPlugin({
    name: "lifecycle",

    setup(app) {
      // onBeforeInit — before the app starts
      app.onBeforeInit(async () => {
        console.log("Initializing...");
      });

      // onAfterInit — after the app is ready
      app.onAfterInit(async () => {
        console.log("App is ready!");
      });

      // onBeforeRoute — before each request is routed
      app.use(async (ctx, next) => {
        // Pre-routing logic
        return next();
      });
    },
  });
}
```

## Testing

Use `bun:test` and AsiJS test utilities:

```typescript
import { describe, test, expect } from "bun:test";
import { Asi } from "asijs";
import { myPlugin } from "../src/index";

describe("myPlugin", () => {
  test("plugin has correct name", () => {
    const plugin = myPlugin();
    expect(plugin.name).toBe("my-plugin");
  });

  test("plugin registers routes", async () => {
    const app = new Asi({ silent: true });
    app.plugin(myPlugin({ apiKey: "test" }));

    const res = await app.handle(
      new Request("http://localhost/my-plugin/health"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  test("middleware executes on every request", async () => {
    const app = new Asi({ silent: true });
    app.plugin(myPlugin());

    const res = await app.handle(new Request("http://localhost/"));
    expect(res.status).toBe(404); // Route doesn't exist, but middleware ran
  });
});
```

## Publishing

### 1. Prepare your plugin

```bash
bun run build
bun run typecheck
bun test
```

### 2. Publish to npm

```bash
npm publish
# or
bun publish
```

### 3. Add to awesome-asijs

Open a PR on [github.com/Baconana-chan/asijs](https://github.com/Baconana-chan/asijs) adding your plugin to the `AWESOME_PLUGINS` array in `src/plugin-registry.ts`.

### 4. Tag your release

```bash
git tag my-plugin-v1.0.0
git push --tags
```

## Examples

### Simple Utility Plugin

```typescript
export function requestTimer(): AsiPlugin {
  return createPlugin({
    name: "request-timer",
    setup(app) {
      app.use(async (ctx, next) => {
        const start = performance.now();
        const res = await next();
        res.headers.set("X-Response-Time", `${performance.now() - start}ms`);
        return res;
      });
    },
  });
}
```

### Plugin with Storage

```typescript
export function visitCounter(): AsiPlugin {
  const visits = new Map<string, number>();

  return createPlugin({
    name: "visit-counter",
    setup(app) {
      app.get("/visits", () => ({
        total: Array.from(visits.values()).reduce((a, b) => a + b, 0),
        unique: visits.size,
      }));

      app.use(async (ctx, next) => {
        const ip = ctx.request.headers.get("X-Forwarded-For") || "unknown";
        visits.set(ip, (visits.get(ip) || 0) + 1);
        return next();
      });
    },
  });
}
```

## Best Practices

1. **Prefix your routes** — Use `/your-plugin-name/...` to avoid conflicts
2. **Use options pattern** — Always provide defaults for every option
3. **Export types** — Export your options interface for autocompletion
4. **Handle errors gracefully** — Never throw from middleware
5. **Be async-safe** — Always `await next()` in middleware
6. **Clean up resources** — Use lifecycle hooks if needed
7. **Test edge cases** — Test with missing options, invalid config, etc.
8. **Document** — Every exported function needs JSDoc

## Need Help?

- Open an issue on [GitHub](https://github.com/Baconana-chan/asijs)
- Use `asi plugin search` to find existing plugins as reference
- Check the [API Reference](https://baconana-chan.github.io/asijs/api-reference.html)
