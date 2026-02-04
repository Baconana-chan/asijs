/**
 * Пример использования AsiJS с Type-Safe валидацией
 */
import { Asi, Type } from "./src";

const app = new Asi({ development: true });

// === Глобальные хуки ===

// Логгирование всех запросов
app.onBeforeHandle((ctx) => {
  ctx.store.startTime = performance.now();
});

app.onAfterHandle((ctx, response) => {
  const duration = (performance.now() - (ctx.store.startTime as number)).toFixed(2);
  console.log(`${ctx.method} ${ctx.path} - ${response.status} - ${duration}ms`);
  return response;
});

// Кастомный 404
app.onNotFound((ctx) => {
  return ctx.status(404).jsonResponse({
    error: "Page Not Found",
    path: ctx.path,
    hint: "Check the API documentation",
  });
});

// === Простые роуты ===

app.get("/", () => "🚀 Welcome to AsiJS!");

app.get("/json", () => ({ 
  message: "Hello, JSON!",
  timestamp: Date.now() 
}));

// === Type-Safe роуты с валидацией ===

// GET с валидацией query параметров
app.get("/search", (ctx) => {
  // ctx.query типизирован как { q: string, limit: number, offset: number }
  return {
    query: ctx.query.q,
    limit: ctx.query.limit,
    offset: ctx.query.offset,
    results: [`Result for "${ctx.query.q}"`],
  };
}, {
  schema: {
    query: Type.Object({
      q: Type.String({ minLength: 1 }),
      limit: Type.Number({ default: 10, minimum: 1, maximum: 100 }),
      offset: Type.Number({ default: 0, minimum: 0 }),
    }),
  },
});

// POST с валидацией body
app.post("/users", (ctx) => {
  // ctx.body типизирован как { name: string, email: string, age?: number }
  const user = {
    id: Math.random().toString(36).slice(2),
    name: ctx.body.name,
    email: ctx.body.email,
    age: ctx.body.age,
    createdAt: new Date().toISOString(),
  };
  return ctx.status(201).jsonResponse(user);
}, {
  schema: {
    body: Type.Object({
      name: Type.String({ minLength: 2 }),
      email: Type.String({ format: "email" }),
      age: Type.Optional(Type.Number({ minimum: 0, maximum: 150 })),
    }),
  },
});

// PUT с валидацией params + body
app.put("/users/:id", (ctx) => {
  // ctx.params.id типизирован как number (автоматически сконвертирован)
  // ctx.body типизирован
  return {
    message: "User updated",
    id: ctx.params.id,
    updates: ctx.body,
  };
}, {
  schema: {
    params: Type.Object({
      id: Type.Number(),
    }),
    body: Type.Object({
      name: Type.Optional(Type.String()),
      email: Type.Optional(Type.String()),
    }),
  },
});

// === API группа ===

app.group("/api", (api) => {
  api.get("/status", () => ({ status: "ok", uptime: process.uptime() }));
  
  // v1 API
  api.group("/v1", (v1) => {
    v1.get("/users", () => ({
      version: 1,
      users: [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ],
    }));
    
    v1.get("/users/:id", (ctx) => ({
      version: 1,
      user: { id: ctx.params.id, name: "User " + ctx.params.id },
    }));
  });

  // v2 API
  api.group("/v2", (v2) => {
    v2.get("/users", () => ({
      version: 2,
      data: {
        users: [
          { id: 1, name: "Alice", email: "alice@example.com" },
          { id: 2, name: "Bob", email: "bob@example.com" },
        ],
        total: 2,
      },
    }));
  });
});

// === Роут с beforeHandle ===

app.get("/admin", (ctx) => {
  return { admin: true, secret: "data" };
}, {
  beforeHandle: (ctx) => {
    const token = ctx.query.token;
    if (token !== "secret123") {
      return ctx.status(401).jsonResponse({ error: "Unauthorized" });
    }
  }
});

// === HTML ===

app.get("/html", (ctx) => {
  return ctx.html(`
    <!DOCTYPE html>
    <html>
      <head><title>AsiJS</title></head>
      <body>
        <h1>Hello from AsiJS!</h1>
        <p>Type-Safe Bun Framework</p>
        <h2>Try these endpoints:</h2>
        <ul>
          <li><a href="/search?q=hello">/search?q=hello</a> (with validation)</li>
          <li><a href="/api/status">/api/status</a></li>
          <li><a href="/api/v1/users">/api/v1/users</a></li>
          <li><a href="/admin?token=secret123">/admin (with token)</a></li>
        </ul>
        <h2>POST /users example:</h2>
        <pre>curl -X POST http://localhost:3000/users \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Alice", "email": "alice@test.com"}'</pre>
      </body>
    </html>
  `);
});

// === Запуск ===

app.listen(3000);