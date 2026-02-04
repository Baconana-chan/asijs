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

AsiJS is built for performance. Benchmarks below are **averages from 6 GitHub Actions runs**.

### Simple JSON Response (`GET /`)

| Framework | Requests/sec | Latency | Relative |
|-----------|-------------|---------|----------|
| Elysia | ~616,000 | 0.0016ms | 100% |
| Raw Bun | ~572,000 | 0.0017ms | 93% |
| **AsiJS** | ~443,000 | 0.0023ms | 72% |
| **AsiJS (compiled)** | ~438,000 | 0.0023ms | 71% |
| Hono | ~296,000 | 0.0034ms | 48% |

### Path Parameters (`GET /user/:id`)

| Framework | Requests/sec | Latency | Relative |
|-----------|-------------|---------|----------|
| Elysia | ~498,000 | 0.0020ms | 100% |
| Raw Bun | ~488,000 | 0.0020ms | 98% |
| **AsiJS (compiled)** | ~391,000 | 0.0026ms | 79% |
| **AsiJS** | ~378,000 | 0.0026ms | 76% |
| Hono | ~220,000 | 0.0046ms | 44% |

### Query Parameters (`GET /search?q=...`)

| Framework | Requests/sec | Latency | Relative |
|-----------|-------------|---------|----------|
| Elysia | ~431,000 | 0.0023ms | 100% |
| Raw Bun | ~319,000 | 0.0031ms | 74% |
| **AsiJS (compiled)** | ~316,000 | 0.0031ms | 73% |
| **AsiJS** | ~305,000 | 0.0033ms | 71% |
| Hono | ~217,000 | 0.0046ms | 50% |

### JSON POST (`POST /users`)

| Framework | Requests/sec | Latency | Relative |
|-----------|-------------|---------|----------|
| Elysia | ~270,000 | 0.0037ms | 100% |
| Raw Bun | ~286,000 | 0.0035ms | 106% |
| **AsiJS (compiled)** | ~229,000 | 0.0044ms | 85% |
| **AsiJS** | ~215,000 | 0.0047ms | 80% |
| Hono | ~164,000 | 0.0061ms | 61% |

### With TypeBox Validation (`POST /users`)

| Framework | Requests/sec | Latency | Relative |
|-----------|-------------|---------|----------|
| **AsiJS (compiled + validation)** | ~244,000 | 0.0041ms | **100%** |
| Elysia + validation | ~214,000 | 0.0047ms | 88% |
| **AsiJS + validation** | ~169,000 | 0.0059ms | 69% |

> 🏆 **AsiJS compiled routes match or beat Elysia when using validation!**

### Key Takeaways

- 🚀 **AsiJS compiled** is ~71–79% of Elysia on GET routes
- ✅ **With validation**, AsiJS compiled is ~12% faster than Elysia on these runs
- 📈 **30–55% faster than Hono** across all benchmarks
- ⚡ Query parameter handling is consistently strong (~73% of Elysia)

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
