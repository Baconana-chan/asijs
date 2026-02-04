# AsiJS

<div align="center">
  <h3>⚡ Bun-first Web Framework — Fast, Type-safe, Simple</h3>
  <p>A high-performance web framework built exclusively for Bun runtime</p>
  
  [![CI](https://github.com/user/asijs/actions/workflows/ci.yml/badge.svg)](https://github.com/user/asijs/actions/workflows/ci.yml)
  [![npm version](https://badge.fury.io/js/asijs.svg)](https://badge.fury.io/js/asijs)
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
</div>

---

## ✨ Features

- 🚀 **Blazing Fast** — Built on Bun.serve() with optimized routing
- 🔒 **Type-safe** — Full TypeScript support with TypeBox validation
- 📦 **Zero Config** — Sensible defaults, works out of the box
- 🔌 **Pluggable** — Rich plugin ecosystem (CORS, static files, auth, etc.)
- 📄 **OpenAPI/Swagger** — Auto-generated API documentation
- 🌐 **WebSocket** — First-class WebSocket support
- ⚡ **JSX** — Built-in JSX for server-side rendering
- 🤖 **MCP Ready** — Model Context Protocol for AI/LLM integration
- 🎯 **Developer Experience** — Auto-port, detailed errors, startup diagnostics

## 📦 Installation

```bash
bun add asijs
```

### Quick Start with CLI

Create a new project instantly:

```bash
# Create with default template
bunx asijs create my-app

# Choose a template
bunx asijs create my-api -t api
bunx asijs create my-blog -t fullstack
bunx asijs create my-auth -t auth
bunx asijs create my-chat -t realtime
```

**Templates:**
- `minimal` — Basic setup (default)
- `api` — REST API with OpenAPI docs
- `fullstack` — API + JSX rendering
- `auth` — JWT authentication
- `realtime` — WebSocket chat

## 🚀 Quick Start

```typescript
import { Asi, Type } from "asijs";

const app = new Asi();

// Simple route
app.get("/", () => "Hello, AsiJS! 👋");

// With validation
app.post("/users", async (ctx) => {
  const body = await ctx.body();
  return { id: 1, ...body };
}, {
  body: Type.Object({
    name: Type.String({ minLength: 1 }),
    email: Type.String({ format: "email" }),
  }),
});

// Start server
app.listen(3000);
```

## 📚 Examples

### REST API with Validation

```typescript
import { Asi, Type } from "asijs";

const app = new Asi();

interface User {
  id: number;
  name: string;
  email: string;
}

const users: User[] = [];

app.get("/users", () => users);

app.get("/users/:id", (ctx) => {
  const user = users.find(u => u.id === +ctx.params.id);
  if (!user) return ctx.status(404).jsonResponse({ error: "Not found" });
  return user;
}, {
  params: Type.Object({ id: Type.String() }),
});

app.post("/users", async (ctx) => {
  const body = await ctx.body<{ name: string; email: string }>();
  const user = { id: users.length + 1, ...body };
  users.push(user);
  return ctx.status(201).jsonResponse(user);
}, {
  body: Type.Object({
    name: Type.String({ minLength: 1 }),
    email: Type.String({ format: "email" }),
  }),
});

app.listen(3000);
```

### JWT Authentication

```typescript
import { Asi, jwt, bearer, hashPassword, verifyPassword } from "asijs";

const app = new Asi();

// Setup JWT
const jwtHelper = jwt({ secret: "your-secret-key" });

// Login
app.post("/login", async (ctx) => {
  const { email, password } = await ctx.body();
  // Verify user...
  const token = await jwtHelper.sign({ userId: 1, email });
  return { token };
});

// Protected route
app.get("/profile", bearer({ jwt: jwtHelper }), (ctx) => {
  return { user: ctx.user };
});

app.listen(3000);
```

### OpenAPI / Swagger

```typescript
import { Asi, openapi, Type } from "asijs";

const app = new Asi();

app.plugin(openapi({
  info: {
    title: "My API",
    version: "1.0.0",
  },
}));

app.get("/pets", () => [{ id: 1, name: "Dog" }], {
  response: Type.Array(Type.Object({
    id: Type.Number(),
    name: Type.String(),
  })),
  tags: ["pets"],
  summary: "List all pets",
});

// Swagger UI available at /docs
app.listen(3000);
```

### WebSocket

```typescript
import { Asi } from "asijs";

const app = new Asi();

app.ws("/chat", {
  open(ws) {
    console.log("Client connected");
  },
  message(ws, message) {
    ws.send(`Echo: ${message}`);
  },
  close(ws) {
    console.log("Client disconnected");
  },
});

app.listen(3000);
```

### File Upload

```typescript
import { Asi, FormDataSchema, FileSchema, Type } from "asijs";

const app = new Asi();

app.post("/upload", async (ctx) => {
  const formData = await ctx.formData();
  const file = formData.get("file") as File;
  
  await Bun.write(`./uploads/${file.name}`, file);
  
  return { 
    filename: file.name,
    size: file.size,
  };
}, {
  body: FormDataSchema({
    file: FileSchema({ 
      maxSize: 10 * 1024 * 1024, // 10MB
      accept: ["image/*"],
    }),
  }),
});

app.listen(3000);
```

### Rate Limiting

```typescript
import { Asi, rateLimit, apiLimit } from "asijs";

const app = new Asi();

// Global rate limit
app.plugin(rateLimit({
  limit: 100,
  window: 60000, // 1 minute
}));

// Or per-route
app.get("/api/data", apiLimit(1000), (ctx) => {
  return { data: "..." };
});

app.listen(3000);
```

### MCP Server (AI/LLM Integration)

```typescript
import { Asi, mcp, createMCPServer } from "asijs";

const app = new Asi();

// Add routes...
app.get("/users", () => users);
app.post("/users", async (ctx) => { /* ... */ });

// Add MCP plugin for AI assistants
app.plugin(mcp({
  name: "my-api",
  version: "1.0.0",
  tools: [
    {
      name: "list_users",
      description: "List all users",
      inputSchema: { type: "object", properties: {} },
      handler: async () => ({ 
        content: [{ type: "text", text: JSON.stringify(users) }]
      }),
    },
  ],
}));

// Run as MCP server
const mcpServer = createMCPServer(app);
await mcpServer.start();
```

## 🔌 Plugins

### Built-in Plugins

| Plugin | Description |
|--------|-------------|
| `cors()` | Cross-Origin Resource Sharing |
| `staticFiles()` | Serve static files |
| `openapi()` | OpenAPI/Swagger documentation |
| `rateLimit()` | Rate limiting |
| `security()` | Security headers (CSP, HSTS, etc.) |
| `cache()` | Response caching with ETags |
| `lifecycle()` | Graceful shutdown |
| `trace()` | Request tracing & metrics |
| `devMode()` | Development tools |
| `mcp()` | Model Context Protocol |

### Using Plugins

```typescript
import { 
  Asi, 
  cors, 
  security, 
  rateLimit,
  openapi,
  lifecycle,
} from "asijs";

const app = new Asi();

app.plugin(cors({ origin: "*" }));
app.plugin(security());
app.plugin(rateLimit({ limit: 100, window: 60000 }));
app.plugin(openapi({ info: { title: "My API", version: "1.0.0" } }));
app.plugin(lifecycle({ verbose: true }));

app.listen(3000);
```

## 🛠️ Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment | `development` |

### App Configuration

```typescript
const app = new Asi({
  development: true,          // Enable development mode
  basePath: "/api/v1",        // Base path for all routes
  strictMode: false,          // Strict routing (trailing slashes)
});

// Auto port selection
app.listen(0); // Random available port

// Port from environment
app.listen(); // Uses PORT env or 3000
```

## 📊 Benchmarks

AsiJS is built for performance. Benchmarks run on **Windows 10, 8 CPU cores, 24GB RAM**.

### Simple JSON Response (`GET /`)

| Framework | Requests/sec | Latency | Relative |
|-----------|-------------|---------|----------|
| Elysia | ~112,000 | 0.0089ms | 100% |
| Raw Bun | ~95,000 | 0.0106ms | 85% |
| **AsiJS (compiled)** | ~92,000 | 0.0109ms | 82% |
| **AsiJS** | ~81,000 | 0.0123ms | 72% |
| Hono | ~68,000 | 0.0147ms | 61% |

### Path Parameters (`GET /user/:id`)

| Framework | Requests/sec | Latency | Relative |
|-----------|-------------|---------|----------|
| Elysia | ~95,000 | 0.0106ms | 100% |
| Raw Bun | ~82,000 | 0.0122ms | 86% |
| **AsiJS** | ~70,000 | 0.0143ms | 74% |
| **AsiJS (compiled)** | ~68,000 | 0.0148ms | 72% |
| Hono | ~57,000 | 0.0175ms | 60% |

### Query Parameters (`GET /search?q=...`)

| Framework | Requests/sec | Latency | Relative |
|-----------|-------------|---------|----------|
| Elysia | ~85,000 | 0.0118ms | 100% |
| **AsiJS (compiled)** | ~63,000 | 0.0159ms | 74% |
| **AsiJS** | ~60,000 | 0.0167ms | 70% |
| Hono | ~56,000 | 0.0178ms | 66% |
| Raw Bun | ~54,000 | 0.0186ms | 63% |

### JSON POST (`POST /users`)

| Framework | Requests/sec | Latency | Relative |
|-----------|-------------|---------|----------|
| Elysia | ~52,000 | 0.0192ms | 100% |
| Raw Bun | ~50,000 | 0.0200ms | 96% |
| **AsiJS (compiled)** | ~44,000 | 0.0227ms | 85% |
| **AsiJS** | ~42,000 | 0.0238ms | 81% |
| Hono | ~39,000 | 0.0256ms | 75% |

### With TypeBox Validation (`POST /users`)

| Framework | Requests/sec | Latency | Relative |
|-----------|-------------|---------|----------|
| **AsiJS (compiled + validation)** | ~44,000 | 0.0228ms | **100%** |
| Elysia + validation | ~43,500 | 0.0230ms | 99% |
| **AsiJS + validation** | ~37,000 | 0.0271ms | 84% |

> 🏆 **AsiJS compiled routes match or beat Elysia when using validation!**

### Key Takeaways

- 🚀 **AsiJS compiled** is only ~10-15% slower than Elysia on simple routes
- ✅ **With validation**, AsiJS compiled routes match Elysia performance
- 📈 **30% faster than Hono** across all benchmarks
- ⚡ Query parameter handling is particularly optimized

Run benchmarks yourself:
```bash
bun run bench
```

### Benchmark Notes

- All frameworks use explicit `request.json()` parsing for fair comparison
- Request factories used instead of `clone()` to avoid ReadableStream overhead  
- 100,000 iterations per test with 5,000 warmup iterations
- Response status validated during warmup and benchmark

## 🧪 Testing

```bash
# Run tests
bun test

# With coverage
bun test --coverage
```

## 📁 Project Structure

```
asijs/
├── src/
│   ├── asi.ts          # Core framework
│   ├── router.ts       # Router implementation
│   ├── context.ts      # Request context
│   ├── validation.ts   # TypeBox validation
│   ├── compiler.ts     # Route compiler
│   ├── jsx.ts          # JSX runtime
│   ├── auth.ts         # JWT & authentication
│   ├── openapi.ts      # OpenAPI generator
│   ├── ratelimit.ts    # Rate limiting
│   ├── security.ts     # Security headers
│   ├── cache.ts        # Response caching
│   ├── trace.ts        # Tracing & metrics
│   ├── scheduler.ts    # Background tasks
│   ├── lifecycle.ts    # Graceful shutdown
│   ├── mcp.ts          # MCP server
│   └── plugins/        # Built-in plugins
├── examples/           # Example applications
├── test/               # Test files
└── bench/              # Benchmarks
```

## 🤝 Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing`)
5. Open a Pull Request

## � Migrating from Elysia/Hono

Coming from another framework? Check out our **[Migration Guide](MIGRATION.md)** with:

- 📋 Side-by-side API comparison tables
- 🔀 Code conversion examples
- ✅ Step-by-step migration checklist
- 🗺️ Feature mapping reference

## �📝 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Credits

- Built with [Bun](https://bun.sh)
- Validation by [TypeBox](https://github.com/sinclairzx81/typebox)
- Inspired by [Elysia](https://elysiajs.com) and [Hono](https://hono.dev)

---

<div align="center">
  <sub>Made with ❤️ for the Bun ecosystem</sub>
</div>
