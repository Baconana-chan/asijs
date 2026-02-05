# AsiJS

<div align="center">
  <h3>⚡ Bun-first Web Framework — Fast, Type-safe, Simple</h3>
  <p>A high-performance web framework built exclusively for Bun runtime</p>

  [![CI](https://github.com/user/asijs/actions/workflows/ci.yml/badge.svg)](https://github.com/user/asijs/actions/workflows/ci.yml)
  [![npm version](https://badge.fury.io/js/asijs.svg)](https://badge.fury.io/js/asijs)
  [![JSR](https://jsr.io/badges/@baconana/asijs)](https://jsr.io/@baconana/asijs)
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

**npm:**
```bash
npm install asijs
```

**Bun:**
```bash
bun add asijs
```

**JSR (Deno/Bun):**
```bash
# Deno
deno add @baconana/asijs

# Bun
bunx jsr add @baconana/asijs
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

AsiJS is built for performance. Benchmarks below are **averages from 4 production runs** (`bun run bench/production.ts`).

### Middleware Overhead (5 middleware chain)

| Framework | Requests/sec | Latency | Relative |
|-----------|-------------|---------|----------|
| Elysia (5 derive) | ~414,824 | 0.0025ms | 100% |
| **AsiJS (5 middleware)** | ~188,980 | 0.0054ms | 45.6% |
| Hono (5 middleware) | ~114,589 | 0.0088ms | 27.6% |

### Complex Validation (4-level nested object)

| Framework | Requests/sec | Latency | Relative |
|-----------|-------------|---------|----------|
| **AsiJS (complex validation)** | ~107,069 | 0.0094ms | **100%** |
| Elysia (complex validation) | ~104,290 | 0.0096ms | 97.4% |

### File Upload (1MB multipart)

| Framework | Requests/sec | Latency | Relative |
|-----------|-------------|---------|----------|
| Elysia (1MB) | ~4,890 | 0.2046ms | 100% |
| Hono (1MB) | ~4,682 | 0.2140ms | 95.8% |
| **AsiJS (1MB)** | ~4,651 | 0.2152ms | 95.1% |

### File Upload (5MB multipart)

| Framework | Requests/sec | Latency | Relative |
|-----------|-------------|---------|----------|
| Elysia (5MB) | ~964 | 1.0412ms | 100% |
| Hono (5MB) | ~954 | 1.0533ms | 99.0% |
| **AsiJS (5MB)** | ~822 | 1.2239ms | 85.2% |

### Static File Serving (small file)

| Framework | Requests/sec | Latency | Relative |
|-----------|-------------|---------|----------|
| Hono (small) | ~157,329 | 0.0064ms | 100% |
| **AsiJS (small)** | ~101,996 | 0.0099ms | 64.8% |

### Static File Serving (2MB file)

| Framework | Requests/sec | Latency | Relative |
|-----------|-------------|---------|----------|
| Hono (2MB) | ~157,367 | 0.0065ms | 100% |
| **AsiJS (2MB)** | ~136,043 | 0.0074ms | 86.5% |

### JSX / HTML Rendering (100-row table)

| Framework | Requests/sec | Latency | Relative |
|-----------|-------------|---------|----------|
| **AsiJS (JSX + renderToString)** | ~54,878 | 0.0183ms | **100%** |
| AsiJS (string template) | ~31,811 | 0.0315ms | 58.0% |
| Hono (string template) | ~19,582 | 0.0512ms | 35.7% |

### Blog API - GET /posts (list + pagination)

| Framework | Requests/sec | Latency | Relative |
|-----------|-------------|---------|----------|
| Elysia (GET /posts) | ~152,197 | 0.0066ms | 100% |
| **AsiJS (GET /posts)** | ~151,805 | 0.0066ms | 99.7% |
| Hono (GET /posts) | ~124,925 | 0.0081ms | 82.1% |

### Blog API - GET /posts/:id (single post)

| Framework | Requests/sec | Latency | Relative |
|-----------|-------------|---------|----------|
| Elysia (GET /posts/:id) | ~320,098 | 0.0032ms | 100% |
| **AsiJS (GET /posts/:id)** | ~273,989 | 0.0038ms | 85.6% |
| Hono (GET /posts/:id) | ~195,105 | 0.0052ms | 61.0% |

### Blog API - POST /posts (auth + validation)

| Framework | Requests/sec | Latency | Relative |
|-----------|-------------|---------|----------|
| **AsiJS (POST /posts)** | ~161,090 | 0.0063ms | **100%** |
| Elysia (POST /posts) | ~137,068 | 0.0074ms | 85.1% |
| Hono (POST /posts) | ~109,381 | 0.0092ms | 67.9% |

### Key Takeaways

- 🚀 **Middleware chains** land at ~46% of Elysia while staying ahead of Hono
- ✅ **Complex validation** is effectively on par with Elysia in production
- 📦 **Static files** reach ~65% (small) and ~86% (2MB) of Hono
- ⚡ **JSX rendering** leads the field; string templates stay competitive
- 🧪 **Blog API** shows AsiJS leading on POST and near-parity on GET list

Run benchmarks yourself:
```bash
bun run bench:production
```

### Benchmark Notes

- All frameworks use explicit `request.json()` parsing for fair comparison
- Request factories used instead of `clone()` to avoid ReadableStream overhead
- 10,000 iterations per test with 1,000 warmup iterations
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
