#!/usr/bin/env node
/**
 * AsiJS CLI
 *
 * Usage:
 *   bunx asijs create my-app          # Create new project
 *   bunx asijs create my-app -t api   # Create with template
 *   bun create asijs my-app           # Alternative syntax
 *
 * Templates:
 *   minimal   - Minimal setup (default)
 *   api       - REST API with validation
 *   fullstack - API + JSX rendering
 *   auth      - Authentication with JWT
 *   realtime  - WebSocket chat example
 *   cloudflare - Cloudflare Workers deployment
 *   deno      - Deno / Deno Deploy
 *   spa       - SPA + SSR with hydration
 */

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  statSync,
  readFileSync,
  rmSync,
} from "fs";
import { join, resolve, basename } from "path";
import { scanWorkspace, startWorkspaceDev, startStandaloneDev, findStandaloneEntry, type WorkspaceDevController } from "./workspace";
import {
  runCodemod,
  detectProjectFramework,
  printSummary,
  type CodemodOptions,
  type SourceFramework,
} from "./codemod";

// Serverless platform info for build targets
import { SERVERLESS_PLATFORMS } from "./serverless";

// Plugin Registry
import { PluginRegistry, installPlugin, scaffoldPlugin, listInstalledPlugins, uninstallPlugin } from "./plugin-registry";

// ===== Colors =====
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

const c = {
  bold: (s: string) => `${colors.bold}${s}${colors.reset}`,
  dim: (s: string) => `${colors.dim}${s}${colors.reset}`,
  red: (s: string) => `${colors.red}${s}${colors.reset}`,
  green: (s: string) => `${colors.green}${s}${colors.reset}`,
  yellow: (s: string) => `${colors.yellow}${s}${colors.reset}`,
  blue: (s: string) => `${colors.blue}${s}${colors.reset}`,
  magenta: (s: string) => `${colors.magenta}${s}${colors.reset}`,
  cyan: (s: string) => `${colors.cyan}${s}${colors.reset}`,
};

// ===== Templates =====
const TEMPLATES = {
  minimal: {
    name: "Minimal",
    description: "Minimal setup with basic routing",
    files: {
      "src/index.ts": `import { Asi } from "asijs";

const app = new Asi();

app.get("/", () => "Hello from AsiJS! 🚀");

app.get("/health", () => ({ status: "ok", timestamp: Date.now() }));

app.listen(3000, () => {
  console.log("🚀 Server running at http://localhost:3000");
});
`,
      "package.json": (name: string) =>
        JSON.stringify(
          {
            name,
            version: "0.1.0",
            type: "module",
            scripts: {
              dev: "bun run --hot src/index.ts",
              start: "bun run src/index.ts",
              build: "bun build src/index.ts --outdir dist --target bun",
            },
            dependencies: {
              asijs: "latest",
            },
            devDependencies: {
              "@types/bun": "latest",
              typescript: "^5",
            },
          },
          null,
          2,
        ),
      "tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            target: "ESNext",
            module: "ESNext",
            moduleResolution: "bundler",
            strict: true,
            skipLibCheck: true,
            types: ["bun-types"],
          },
          include: ["src"],
        },
        null,
        2,
      ),
      ".gitignore": `node_modules
dist
.env
*.log
`,
      "README.md": (name: string) => `# ${name}

Built with [AsiJS](https://github.com/Baconana-chan/asijs) — Bun-first web framework.

## Getting Started

\`\`\`bash
bun install
bun run dev
\`\`\`

Open http://localhost:3000
`,
    },
  },

  api: {
    name: "REST API",
    description: "REST API with validation, CORS, and OpenAPI",
    files: {
      "src/index.ts": `import { Asi, cors, openapi } from "asijs";
import { Type } from "@sinclair/typebox";

const app = new Asi();

// Plugins
app.plugin(cors());
app.plugin(openapi({
  title: "My API",
  version: "1.0.0",
  path: "/docs",
}));

// In-memory database
const users: { id: number; name: string; email: string }[] = [];
let nextId = 1;

// Routes
app.get("/", () => ({ message: "Welcome to the API", docs: "/docs" }));

app.get("/users", () => users);

app.get("/users/:id", {
  params: Type.Object({ id: Type.Number() }),
}, (ctx) => {
  const user = users.find(u => u.id === ctx.params.id);
  if (!user) return ctx.status(404).jsonResponse({ error: "User not found" });
  return user;
});

app.post("/users", {
  body: Type.Object({
    name: Type.String({ minLength: 1 }),
    email: Type.String({ format: "email" }),
  }),
}, (ctx) => {
  const user = { id: nextId++, ...ctx.body };
  users.push(user);
  return ctx.status(201).jsonResponse(user);
});

app.delete("/users/:id", {
  params: Type.Object({ id: Type.Number() }),
}, (ctx) => {
  const index = users.findIndex(u => u.id === ctx.params.id);
  if (index === -1) return ctx.status(404).jsonResponse({ error: "User not found" });
  users.splice(index, 1);
  return { success: true };
});

app.listen(3000, () => {
  console.log("🚀 API running at http://localhost:3000");
  console.log("📚 Docs at http://localhost:3000/docs");
});
`,
      "package.json": (name: string) =>
        JSON.stringify(
          {
            name,
            version: "0.1.0",
            type: "module",
            scripts: {
              dev: "bun run --hot src/index.ts",
              start: "bun run src/index.ts",
              test: "bun test",
              build: "bun build src/index.ts --outdir dist --target bun",
            },
            dependencies: {
              asijs: "latest",
              "@sinclair/typebox": "^0.34.0",
            },
            devDependencies: {
              "@types/bun": "latest",
              typescript: "^5",
            },
          },
          null,
          2,
        ),
      "tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            target: "ESNext",
            module: "ESNext",
            moduleResolution: "bundler",
            strict: true,
            skipLibCheck: true,
            types: ["bun-types"],
          },
          include: ["src"],
        },
        null,
        2,
      ),
      ".gitignore": `node_modules
dist
.env
*.log
`,
      "README.md": (name: string) => `# ${name}

REST API built with [AsiJS](https://github.com/Baconana-chan/asijs).

## Features

- ✅ TypeBox validation
- ✅ CORS support
- ✅ OpenAPI/Swagger docs at /docs
- ✅ CRUD operations

## Getting Started

\`\`\`bash
bun install
bun run dev
\`\`\`

- API: http://localhost:3000
- Docs: http://localhost:3000/docs
`,
    },
  },

  fullstack: {
    name: "Fullstack",
    description: "API + JSX server-side rendering",
    files: {
      "src/index.tsx": `import { Asi, cors, html, type FC } from "asijs";
import { Type } from "@sinclair/typebox";

const app = new Asi();
app.plugin(cors());

// Data
const todos: { id: number; text: string; done: boolean }[] = [
  { id: 1, text: "Learn AsiJS", done: true },
  { id: 2, text: "Build something awesome", done: false },
];
let nextId = 3;

// Components
const Layout: FC<{ title: string; children: any }> = ({ title, children }) => (
  <html>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>{title}</title>
      <style>{\`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 2rem; }
        h1 { margin-bottom: 1rem; color: #333; }
        .todo { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem; border-bottom: 1px solid #eee; }
        .todo.done { text-decoration: line-through; opacity: 0.6; }
        form { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
        input { flex: 1; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; }
        button { padding: 0.5rem 1rem; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; }
        button:hover { background: #0056b3; }
      \`}</style>
    </head>
    <body>{children}</body>
  </html>
);

const TodoItem: FC<{ todo: typeof todos[0] }> = ({ todo }) => (
  <div class={\`todo \${todo.done ? "done" : ""}\`}>
    <input type="checkbox" checked={todo.done} disabled />
    <span>{todo.text}</span>
  </div>
);

// Routes
app.get("/", (ctx) => {
  return ctx.html(
    <Layout title="Todo App">
      <h1>📝 Todo App</h1>
      <form action="/todos" method="POST">
        <input type="text" name="text" placeholder="What needs to be done?" required />
        <button type="submit">Add</button>
      </form>
      <div>
        {todos.map(todo => <TodoItem todo={todo} />)}
      </div>
    </Layout>
  );
});

app.post("/todos", {
  body: Type.Object({ text: Type.String({ minLength: 1 }) }),
}, (ctx) => {
  todos.push({ id: nextId++, text: ctx.body.text, done: false });
  return ctx.redirect("/");
});

// API
app.get("/api/todos", () => todos);

app.listen(3000, () => {
  console.log("🚀 App running at http://localhost:3000");
});
`,
      "package.json": (name: string) =>
        JSON.stringify(
          {
            name,
            version: "0.1.0",
            type: "module",
            scripts: {
              dev: "bun run --hot src/index.tsx",
              start: "bun run src/index.tsx",
              build: "bun build src/index.tsx --outdir dist --target bun",
            },
            dependencies: {
              asijs: "latest",
              "@sinclair/typebox": "^0.34.0",
            },
            devDependencies: {
              "@types/bun": "latest",
              typescript: "^5",
            },
          },
          null,
          2,
        ),
      "tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            target: "ESNext",
            module: "ESNext",
            moduleResolution: "bundler",
            strict: true,
            skipLibCheck: true,
            types: ["bun-types"],
            jsx: "react-jsx",
            jsxImportSource: "asijs",
          },
          include: ["src"],
        },
        null,
        2,
      ),
      ".gitignore": `node_modules
dist
.env
*.log
`,
      "README.md": (name: string) => `# ${name}

Fullstack app built with [AsiJS](https://github.com/Baconana-chan/asijs).

## Features

- ✅ JSX server-side rendering
- ✅ Form handling
- ✅ API endpoints
- ✅ TypeBox validation

## Getting Started

\`\`\`bash
bun install
bun run dev
\`\`\`

Open http://localhost:3000
`,
    },
  },

  auth: {
    name: "Auth",
    description: "Authentication with JWT and protected routes",
    files: {
      "src/index.ts": `import { Asi, cors, jwt, bearer, hashPassword, verifyPassword, generateToken } from "asijs";
import { Type } from "@sinclair/typebox";

const app = new Asi();
app.plugin(cors());

// JWT configuration
const jwtHelper = jwt({ secret: process.env.JWT_SECRET || "your-secret-key-change-in-production" });

// In-memory users
const users: { id: number; email: string; passwordHash: string; name: string }[] = [];
let nextId = 1;

// Public routes
app.get("/", () => ({
  message: "Auth API",
  endpoints: {
    register: "POST /register",
    login: "POST /login",
    me: "GET /me (protected)",
  },
}));

app.post("/register", {
  body: Type.Object({
    email: Type.String({ format: "email" }),
    password: Type.String({ minLength: 8 }),
    name: Type.String({ minLength: 1 }),
  }),
}, async (ctx) => {
  const { email, password, name } = ctx.body;
  
  // Check if user exists
  if (users.find(u => u.email === email)) {
    return ctx.status(400).jsonResponse({ error: "Email already registered" });
  }
  
  // Create user
  const passwordHash = await hashPassword(password);
  const user = { id: nextId++, email, passwordHash, name };
  users.push(user);
  
  // Generate token
  const token = await jwtHelper.sign({ sub: user.id, email: user.email });
  
  return ctx.status(201).jsonResponse({
    user: { id: user.id, email: user.email, name: user.name },
    token,
  });
});

app.post("/login", {
  body: Type.Object({
    email: Type.String({ format: "email" }),
    password: Type.String(),
  }),
}, async (ctx) => {
  const { email, password } = ctx.body;
  
  const user = users.find(u => u.email === email);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return ctx.status(401).jsonResponse({ error: "Invalid credentials" });
  }
  
  const token = await jwtHelper.sign({ sub: user.id, email: user.email });
  
  return {
    user: { id: user.id, email: user.email, name: user.name },
    token,
  };
});

// Protected routes
app.get("/me", 
  bearer({
    verify: async (token) => {
      try {
        const payload = await jwtHelper.verify(token);
        const user = users.find(u => u.id === payload.sub);
        return user ? { id: user.id, email: user.email, name: user.name } : null;
      } catch {
        return null;
      }
    },
  }),
  (ctx) => {
    return { user: (ctx as any).user };
  }
);

app.get("/protected", 
  bearer({
    verify: async (token) => {
      try {
        return await jwtHelper.verify(token);
      } catch {
        return null;
      }
    },
  }),
  () => ({ secret: "This is protected data! 🔒" })
);

app.listen(3000, () => {
  console.log("🚀 Auth API running at http://localhost:3000");
});
`,
      ".env.example": `JWT_SECRET=your-super-secret-key-change-this
`,
      "package.json": (name: string) =>
        JSON.stringify(
          {
            name,
            version: "0.1.0",
            type: "module",
            scripts: {
              dev: "bun run --hot src/index.ts",
              start: "bun run src/index.ts",
              build: "bun build src/index.ts --outdir dist --target bun",
            },
            dependencies: {
              asijs: "latest",
              "@sinclair/typebox": "^0.34.0",
            },
            devDependencies: {
              "@types/bun": "latest",
              typescript: "^5",
            },
          },
          null,
          2,
        ),
      "tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            target: "ESNext",
            module: "ESNext",
            moduleResolution: "bundler",
            strict: true,
            skipLibCheck: true,
            types: ["bun-types"],
          },
          include: ["src"],
        },
        null,
        2,
      ),
      ".gitignore": `node_modules
dist
.env
*.log
`,
      "README.md": (name: string) => `# ${name}

Authentication API built with [AsiJS](https://github.com/Baconana-chan/asijs).

## Features

- ✅ JWT authentication
- ✅ Password hashing (Argon2)
- ✅ Protected routes with bearer middleware
- ✅ Registration & Login

## Getting Started

\`\`\`bash
cp .env.example .env
bun install
bun run dev
\`\`\`

## Usage

\`\`\`bash
# Register
curl -X POST http://localhost:3000/register \\
  -H "Content-Type: application/json" \\
  -d '{"email":"test@example.com","password":"password123","name":"Test User"}'

# Login
curl -X POST http://localhost:3000/login \\
  -H "Content-Type: application/json" \\
  -d '{"email":"test@example.com","password":"password123"}'

# Access protected route
curl http://localhost:3000/me \\
  -H "Authorization: Bearer <token>"
\`\`\`
`,
    },
  },

  workspace: {
    name: "Workspace",
    description: "Monorepo with multiple sub-apps + selective hot-reload",
    files: {
      "package.json": (name: string) =>
        JSON.stringify(
          {
            name,
            private: true,
            type: "module",
            workspaces: ["apps/*"],
            scripts: {
              dev: "asijs dev",
              build: "cd apps/api && bun run build",
            },
            devDependencies: {
              asijs: "latest",
              "@types/bun": "latest",
              typescript: "^5",
            },
          },
          null,
          2,
        ),
      "tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            target: "ESNext",
            module: "ESNext",
            moduleResolution: "bundler",
            strict: true,
            skipLibCheck: true,
            types: ["bun-types"],
          },
        },
        null,
        2,
      ),
      ".gitignore": `node_modules\ndist\n.env\n*.log\n`,
      "apps/api/package.json": (name: string) =>
        JSON.stringify(
          {
            name: `${name}-api`,
            version: "0.1.0",
            type: "module",
            scripts: {
              dev: "bun run --hot src/index.ts",
              start: "bun run src/index.ts",
              build: "bun build src/index.ts --outdir dist --target bun",
            },
            dependencies: {
              asijs: "latest",
              "@sinclair/typebox": "^0.34.0",
            },
          },
          null,
          2,
        ),
      "apps/api/tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            target: "ESNext",
            module: "ESNext",
            moduleResolution: "bundler",
            strict: true,
            skipLibCheck: true,
            types: ["bun-types"],
          },
          include: ["src"],
        },
        null,
        2,
      ),
      "apps/api/src/index.ts": `import { Asi } from "asijs";
import { Type } from "@sinclair/typebox";

const app = new Asi({ development: true });

app.get("/", () => ({ service: "api", status: "ok" }));

app.get("/users", () => [
  { id: 1, name: "Alice" },
  { id: 2, name: "Bob" },
]);

app.listen(Number(process.env.PORT ?? 3001), () => {
  console.log("API sub-app running on port " + (process.env.PORT ?? 3001));
});
`,
      "apps/web/package.json": (name: string) =>
        JSON.stringify(
          {
            name: `${name}-web`,
            version: "0.1.0",
            type: "module",
            scripts: {
              dev: "bun run --hot src/index.tsx",
              start: "bun run src/index.tsx",
            },
            dependencies: {
              asijs: "latest",
            },
          },
          null,
          2,
        ),
      "apps/web/tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            target: "ESNext",
            module: "ESNext",
            moduleResolution: "bundler",
            strict: true,
            skipLibCheck: true,
            types: ["bun-types"],
            jsx: "react-jsx",
            jsxImportSource: "asijs",
          },
          include: ["src"],
        },
        null,
        2,
      ),
      "apps/web/src/index.tsx": `import { Asi, html, type FC } from "asijs";

const app = new Asi({ development: true });

const Layout: FC<{ title: string; children: any }> = ({ title, children }) => (
  <html>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>{title}</title>
    </head>
    <body>{children}</body>
  </html>
);

app.get("/", (ctx) =>
  ctx.html(
    <Layout title="Workspace">
      <h1>Workspace Sub-App: Web</h1>
      <p>This runs independently on its own port.</p>
      <p>Changes here only reload THIS app.</p>
    </Layout>,
  ),
);

app.listen(Number(process.env.PORT ?? 3002), () => {
  console.log("Web sub-app running on port " + (process.env.PORT ?? 3002));
});
`,
      "apps/shared/package.json": (name: string) =>
        JSON.stringify(
          {
            name: `${name}-shared`,
            version: "0.1.0",
            type: "module",
            main: "src/index.ts",
            types: "src/index.ts",
          },
          null,
          2,
        ),
      "apps/shared/src/index.ts": `// Shared types for workspace

export interface User {
  id: number;
  name: string;
  email: string;
}

export function createUser(name: string, email: string): User {
  return { id: Date.now(), name, email };
}
`,
      "README.md": (name: string) => `# ${name}

AsiJS Workspace with independent hot-reload for each sub-app.

## Structure

\`\`\`
apps/
  api/     -- REST API sub-app (port 3001)
  web/     -- Web sub-app (port 3002)
  shared/  -- Shared types
\`\`\`

## Development

\`\`\`bash
bun install
bun run dev
\`\`\`

Each sub-app runs as its own \`bun --hot\` process.
Changes in one app only reload that app.
`,
    },
  },

  cloudflare: {
    name: "Cloudflare Workers",
    description: "Edge deployment on Cloudflare Workers",
    files: {
      "src/index.ts": `import { Asi } from "asijs";
import { cloudflare, withWaitUntil } from "asijs/edge";

const app = new Asi();

app.get("/", () => ({
  message: "Hello from Cloudflare Workers!",
  runtime: "edge",
}));

app.get("/health", () => ({ status: "ok" }));

// Background task via waitUntil
app.use(withWaitUntil(async (ctx) => {
  // This runs after the response is sent
  // e.g., analytics, logging, etc.
  console.log("Background task completed");
}));

export default cloudflare(app);
`,
      "wrangler.toml": (name: string) => `name = "${name}"
main = "src/index.ts"
compatibility_date = "2025-01-01"

[env.production]
name = "${name}-prod"
`,
      "package.json": (name: string) =>
        JSON.stringify(
          {
            name,
            version: "0.1.0",
            type: "module",
            scripts: {
              dev: "wrangler dev",
              deploy: "wrangler deploy",
              build: "bun build src/index.ts --outdir dist --target bun",
            },
            dependencies: {
              asijs: "latest",
            },
            devDependencies: {
              wrangler: "latest",
            },
          },
          null,
          2,
        ),
      "tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            target: "ESNext",
            module: "ESNext",
            moduleResolution: "bundler",
            strict: true,
            skipLibCheck: true,
            types: ["@cloudflare/workers-types"],
          },
          include: ["src"],
        },
        null,
        2,
      ),
      ".gitignore": `node_modules\ndist\n.env\n*.log\n.wrangler\n`,
      ".env.example": `# Cloudflare API token (optional for wrangler deploy)
CLOUDFLARE_API_TOKEN=
`,
      "README.md": (name: string) => `# ${name}

Cloudflare Workers app built with [AsiJS](https://github.com/Baconana-chan/asijs).

## Features

- ✅ Edge deployment on Cloudflare Workers
- ✅ waitUntil for background tasks
- ✅ Edge caching (Cache-Control)
- ✅ Zero cold-start with edge runtime

## Getting Started

\`\`\`bash
bun install
bun run dev        # wrangler dev
bun run deploy     # wrangler deploy
\`\`\`

Open http://localhost:8787
`,
    },
  },

  spa: {
    name: "SPA + SSR",
    description: "Single Page App with SSR hydration and Islands",
    files: {
      "src/index.ts": `import { Asi, staticFiles } from "asijs";
import { spaFallbackHandler } from "asijs/spa";
import { App } from "./app";

const app = new Asi({
  spa: {
    clientEntry: "src/client.tsx",
    hmr: true,
  },
});

// API routes
app.get("/api/hello", () => ({ message: "Hello from AsiJS!" }));

// Static files
app.use(staticFiles("./public"));

// SPA fallback — serve index.html for all other routes
app.all("/*", spaFallbackHandler({
  publicPath: "/_asi/client",
  clientBundleName: "client.js",
}));

app.listen(3000, () => {
  console.log("🚀 Server running at http://localhost:3000");
});
`,
      "src/app.tsx": `import { type FC } from "asijs";

export interface AppProps {
  message?: string;
}

export const App: FC<AppProps> = ({ message }) => (
  <html>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>AsiJS SPA</title>
      <link rel="stylesheet" href="/styles.css" />
    </head>
    <body>
      <div id="app">
        <h1>Hello from AsiJS!</h1>
        <p>{message || "Server-rendered content"}</p>
        <div id="counter">
          <button id="decrement">-</button>
          <span id="count">0</span>
          <button id="increment">+</button>
        </div>
      </div>
    </body>
  </html>
);
`,
      "src/client.tsx": `import { hydrate } from "asijs/spa-client";
import { App } from "./app";

// Hydrate the server-rendered HTML with client-side interactivity
hydrate(function(props, root) {
  console.log("[AsiJS] Hydrated with props:", props);

  // Set up counter interactivity
  var countEl = document.getElementById("count");
  var decBtn = document.getElementById("decrement");
  var incBtn = document.getElementById("increment");

  if (countEl && decBtn && incBtn) {
    var count = 0;
    decBtn.onclick = function() { count--; countEl!.textContent = String(count); };
    incBtn.onclick = function() { count++; countEl!.textContent = String(count); };
  }
});
`,
      "public/styles.css": `* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: system-ui, -apple-system, sans-serif;
  max-width: 600px;
  margin: 0 auto;
  padding: 2rem;
  background: #0d1117;
  color: #c9d1d9;
}

h1 {
  color: #58a6ff;
  margin-bottom: 1rem;
}

p {
  margin-bottom: 2rem;
  color: #8b949e;
}

#counter {
  display: flex;
  align-items: center;
  gap: 1rem;
}

#counter button {
  padding: 0.5rem 1rem;
  border: 1px solid #30363d;
  border-radius: 6px;
  background: #21262d;
  color: #c9d1d9;
  cursor: pointer;
  font-size: 1.2rem;
}

#counter button:hover {
  background: #30363d;
}

#count {
  font-size: 1.5rem;
  font-weight: bold;
  min-width: 2rem;
  text-align: center;
}
`,
      "package.json": (name: string) =>
        JSON.stringify(
          {
            name,
            version: "0.1.0",
            type: "module",
            scripts: {
              dev: "bun run --hot src/index.ts",
              start: "bun run src/index.ts",
              build: "asi build",
            },
            dependencies: {
              asijs: "latest",
            },
            devDependencies: {
              "@types/bun": "latest",
              typescript: "^5",
            },
          },
          null,
          2,
        ),
      "tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            target: "ESNext",
            module: "ESNext",
            moduleResolution: "bundler",
            strict: true,
            skipLibCheck: true,
            types: ["bun-types"],
            jsx: "react-jsx",
            jsxImportSource: "asijs",
          },
          include: ["src"],
        },
        null,
        2,
      ),
      ".gitignore": `node_modules\ndist\n.env\n*.log\n`,
      "README.md": (name: string) => `# ${name}

SPA + SSR app built with [AsiJS](https://github.com/Baconana-chan/asijs).

## Features

- ✅ Server-side rendering (SSR)
- ✅ Client-side hydration
- ✅ SPA fallback routing
- ✅ Hot Module Replacement (HMR) in dev
- ✅ Production build via \`asi build\`

## Getting Started

\`\`\`bash
bun install
bun run dev
\`\`\`

Open http://localhost:3000

## Production Build

\`\`\`bash
bun run build   # or: asi build
\`\`\`

This creates client + server bundles in dist/.
`,
    },
  },

  deno: {
    name: "Deno",
    description: "Deploy on Deno / Deno Deploy",
    files: {
      "src/index.ts": `import { Asi } from "asijs";
import { deno, denoServe } from "asijs/edge";

const app = new Asi();

app.get("/", () => ({
  message: "Hello from Deno!",
  runtime: "deno",
}));

app.get("/health", () => ({ status: "ok", timestamp: Date.now() }));

// Option 1: Use denoServe() which auto-detects Deno/Bun/Node
if (import.meta.main) {
  denoServe(app, { port: 3000 });
}

// Option 2: Export fetch handler for Deno Deploy
export default {
  fetch: deno(app),
};
`,
      "deno.json": JSON.stringify(
        {
          tasks: {
            dev: "deno run --allow-net --allow-env --allow-read src/index.ts",
            start: "deno run --allow-net --allow-env --allow-read src/index.ts",
          },
          imports: {
            asijs: "npm:asijs",
          },
          compilerOptions: {
            strict: true,
          },
        },
        null,
        2,
      ),
      "package.json": (name: string) =>
        JSON.stringify(
          {
            name,
            version: "0.1.0",
            type: "module",
            scripts: {
              dev: "deno task dev",
              start: "deno task start",
            },
            dependencies: {
              asijs: "latest",
            },
          },
          null,
          2,
        ),
      ".gitignore": `node_modules\ndist\n.env\n*.log\n`,
      "README.md": (name: string) => `# ${name}

Deno app built with [AsiJS](https://github.com/Baconana-chan/asijs).

## Features

- ✅ Runs on Deno / Deno Deploy
- ✅ Native Deno.serve() via denoServe()
- ✅ Fetch handler export for Deno Deploy
- ✅ Compatible with npm specifier

## Getting Started

\`\`\`bash
bun install          # Install deps
bun run dev          # With Bun
# OR
deno task dev        # With Deno
\`\`\`

Open http://localhost:3000
`,
    },
  },

  realtime: {
    name: "Realtime",
    description: "WebSocket chat application",
    files: {
      "src/index.ts": `import { Asi, html, type FC } from "asijs";

const app = new Asi();

// Store connected clients
const clients = new Set<any>();

// Chat page
const ChatPage: FC = () => (
  <html>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>AsiJS Chat</title>
      <style>{\`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: system-ui, sans-serif; height: 100vh; display: flex; flex-direction: column; }
        #messages { flex: 1; overflow-y: auto; padding: 1rem; background: #f5f5f5; }
        .message { padding: 0.5rem 1rem; margin: 0.25rem 0; background: white; border-radius: 8px; max-width: 80%; }
        .message.self { background: #007bff; color: white; margin-left: auto; }
        .message .meta { font-size: 0.75rem; opacity: 0.7; margin-bottom: 0.25rem; }
        #form { display: flex; padding: 1rem; background: white; border-top: 1px solid #ddd; }
        #input { flex: 1; padding: 0.75rem; border: 1px solid #ddd; border-radius: 4px; font-size: 1rem; }
        button { padding: 0.75rem 1.5rem; background: #007bff; color: white; border: none; border-radius: 4px; margin-left: 0.5rem; cursor: pointer; }
        button:hover { background: #0056b3; }
        #status { padding: 0.5rem 1rem; background: #333; color: white; font-size: 0.875rem; }
        .online { color: #4caf50; }
        .offline { color: #f44336; }
      \`}</style>
    </head>
    <body>
      <div id="status">Status: <span id="connection" class="offline">Connecting...</span></div>
      <div id="messages"></div>
      <form id="form">
        <input id="input" placeholder="Type a message..." autocomplete="off" />
        <button type="submit">Send</button>
      </form>
      <script>{\`
        const messages = document.getElementById('messages');
        const form = document.getElementById('form');
        const input = document.getElementById('input');
        const status = document.getElementById('connection');
        
        const username = 'User' + Math.floor(Math.random() * 1000);
        
        const ws = new WebSocket('ws://' + location.host + '/ws');
        
        ws.onopen = () => {
          status.textContent = 'Connected';
          status.className = 'online';
          ws.send(JSON.stringify({ type: 'join', username }));
        };
        
        ws.onclose = () => {
          status.textContent = 'Disconnected';
          status.className = 'offline';
        };
        
        ws.onmessage = (event) => {
          const data = JSON.parse(event.data);
          const div = document.createElement('div');
          div.className = 'message' + (data.username === username ? ' self' : '');
          div.innerHTML = '<div class="meta">' + data.username + ' • ' + new Date(data.timestamp).toLocaleTimeString() + '</div>' + data.message;
          messages.appendChild(div);
          messages.scrollTop = messages.scrollHeight;
        };
        
        form.onsubmit = (e) => {
          e.preventDefault();
          if (input.value.trim()) {
            ws.send(JSON.stringify({ type: 'message', message: input.value }));
            input.value = '';
          }
        };
      \`}</script>
    </body>
  </html>
);

// Routes
app.get("/", (ctx) => ctx.html(<ChatPage />));

// WebSocket
app.ws("/ws", {
  open(ws) {
    clients.add(ws);
    console.log(\`Client connected. Total: \${clients.size}\`);
  },
  message(ws, message) {
    try {
      const data = JSON.parse(message.toString());
      
      if (data.type === "join") {
        (ws as any).username = data.username;
        broadcast({
          username: "System",
          message: \`\${data.username} joined the chat\`,
          timestamp: Date.now(),
        });
      } else if (data.type === "message") {
        broadcast({
          username: (ws as any).username || "Anonymous",
          message: data.message,
          timestamp: Date.now(),
        });
      }
    } catch (e) {
      console.error("Invalid message:", e);
    }
  },
  close(ws) {
    clients.delete(ws);
    const username = (ws as any).username;
    if (username) {
      broadcast({
        username: "System",
        message: \`\${username} left the chat\`,
        timestamp: Date.now(),
      });
    }
    console.log(\`Client disconnected. Total: \${clients.size}\`);
  },
});

function broadcast(data: object) {
  const message = JSON.stringify(data);
  for (const client of clients) {
    client.send(message);
  }
}

app.listen(3000, () => {
  console.log("🚀 Chat running at http://localhost:3000");
});
`,
      "package.json": (name: string) =>
        JSON.stringify(
          {
            name,
            version: "0.1.0",
            type: "module",
            scripts: {
              dev: "bun run --hot src/index.ts",
              start: "bun run src/index.ts",
              build: "bun build src/index.ts --outdir dist --target bun",
            },
            dependencies: {
              asijs: "latest",
            },
            devDependencies: {
              "@types/bun": "latest",
              typescript: "^5",
            },
          },
          null,
          2,
        ),
      "tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            target: "ESNext",
            module: "ESNext",
            moduleResolution: "bundler",
            strict: true,
            skipLibCheck: true,
            types: ["bun-types"],
            jsx: "react-jsx",
            jsxImportSource: "asijs",
          },
          include: ["src"],
        },
        null,
        2,
      ),
      ".gitignore": `node_modules
dist
.env
*.log
`,
      "README.md": (name: string) => `# ${name}

Real-time chat built with [AsiJS](https://github.com/Baconana-chan/asijs).

## Features

- ✅ WebSocket support
- ✅ Real-time messaging
- ✅ JSX server-side rendering
- ✅ Auto-reconnect

## Getting Started

\`\`\`bash
bun install
bun run dev
\`\`\`

Open http://localhost:3000 in multiple tabs to chat!
`,
    },
  },
};

type TemplateName = keyof typeof TEMPLATES;

// ===== Dev Mode =====

async function startDevMode(args: string[]) {
  let basePort = 3000;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" || args[i] === "-p") {
      basePort = parseInt(args[i + 1], 10) || 3000;
      i++;
    }
  }

  let controller: WorkspaceDevController | undefined;

  const cleanup = async () => {
    if (controller) {
      await controller.stop();
    }
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // 1. Try workspace mode
  console.log(c.bold("🏗️  AsiJS Dev"));
  console.log("   Scanning for apps...");
  console.log();

  const apps = scanWorkspace({ cwd: process.cwd() });

  if (apps.length > 0) {
    console.log(`   ${c.bold("Workspace mode")} — found ${c.bold(String(apps.length))} sub-app(s)`);
    console.log();

    try {
      controller = await startWorkspaceDev(apps, {
        basePort,
        verbose: true,
      });
    } catch (error) {
      console.error(c.red("Error starting workspace:"), error);
      process.exit(1);
    }
    return;
  }

  // 2. Try standalone mode
  const entry = findStandaloneEntry();
  if (entry) {
    console.log(`   ${c.green("Standalone mode")} — found ${c.cyan(entry)}`);
    console.log();

    try {
      controller = await startStandaloneDev({
        basePort,
        verbose: true,
      });
    } catch (error) {
      console.error(c.red("Error starting app:"), error);
      process.exit(1);
    }
    return;
  }

  // 3. Nothing found
  console.log(c.yellow("⚠️  No AsiJS apps found."));
  console.log();
  console.log(`  Create a new project:`);
  console.log(`    ${c.cyan("bunx asijs create my-app")}`);
  console.log();
  console.log(`  Or run an existing app directly:`);
  console.log(`    ${c.dim("bun run --hot src/index.ts")}`);
  console.log();
}

// ===== Main =====
async function main() {
  const args = process.argv.slice(2);

  // Handle `bun create asijs my-app` (Bun passes project name directly)
  // or `bunx asijs create my-app`
  let command = args[0];
  let projectName: string | undefined;
  let template: TemplateName = "minimal";

  // Handle `asijs dev` — start workspace dev mode
  if (command === "dev") {
    await startDevMode(args.slice(1));
    return;
  }

  // Handle `asijs build` — production build (SPA/SSR)
  if (command === "build") {
    await handleBuild(args.slice(1));
    return;
  }

  // Handle `asijs inspect` — inspect project
  if (command === "inspect") {
    await handleInspect(args.slice(1));
    return;
  }

  // Handle `asijs generate <type> [name]` — codegen
  if (command === "generate" || command === "g") {
    await handleGenerate(args.slice(1));
    return;
  }

  // Handle `asijs migrate <path> [options]` — codemod
  if (command === "migrate") {
    await handleMigrate(args.slice(1));
    return;
  }

  // Handle `asijs integrate <path> [options]` — auto-detect & migrate
  if (command === "integrate") {
    await handleIntegrate(args.slice(1));
    return;
  }

  // Handle `asijs repl` — interactive REPL
  if (command === "repl") {
    await startRepl(args.slice(1));
    return;
  }

  // Handle `asijs plugin <action> [name]` — plugin registry
  if (command === "plugin") {
    await handlePlugin(args.slice(1));
    return;
  }

  // Parse arguments for create
  if (command === "create" || command === "init" || command === "new") {
    projectName = args[1];

    // Parse flags
    for (let i = 2; i < args.length; i++) {
      if (args[i] === "-t" || args[i] === "--template") {
        const t = args[i + 1] as TemplateName;
        if (t && TEMPLATES[t]) {
          template = t;
        }
        i++;
      }
    }
  } else if (command === "--help" || command === "-h") {
    printHelp();
    return;
  } else if (command === "--version" || command === "-v") {
    console.log("asijs v1.2.0");
    return;
  } else if (command && !command.startsWith("-")) {
    // Direct project name (bun create asijs my-app)
    projectName = command;

    // Parse flags
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "-t" || args[i] === "--template") {
        const t = args[i + 1] as TemplateName;
        if (t && TEMPLATES[t]) {
          template = t;
        }
        i++;
      }
    }
  } else {
    // Interactive mode
    projectName = await prompt("Project name: ");
    if (!projectName) {
      console.error(c.red("Error: Project name is required"));
      process.exit(1);
    }

    console.log("\nAvailable templates:");
    Object.entries(TEMPLATES).forEach(([key, val]) => {
      console.log(`  ${c.cyan(key.padEnd(12))} ${val.description}`);
    });

    const templateChoice =
      (await prompt(`\nTemplate (${Object.keys(TEMPLATES).join("/")}): `)) ||
      "minimal";
    if (TEMPLATES[templateChoice as TemplateName]) {
      template = templateChoice as TemplateName;
    }
  }

  if (!projectName) {
    printHelp();
    process.exit(1);
  }

  // Validate project name
  if (!/^[a-z0-9-_]+$/i.test(projectName)) {
    console.error(
      c.red(
        "Error: Project name can only contain letters, numbers, hyphens, and underscores",
      ),
    );
    process.exit(1);
  }

  // Create project
  await createProject(projectName, template);
}

async function createProject(name: string, templateName: TemplateName) {
  const projectPath = resolve(process.cwd(), name);
  const template = TEMPLATES[templateName];

  console.log();
  console.log(c.bold("🚀 Creating AsiJS project..."));
  console.log();
  console.log(`  ${c.dim("Project:")}  ${c.cyan(name)}`);
  console.log(`  ${c.dim("Template:")} ${c.cyan(template.name)}`);
  console.log(`  ${c.dim("Path:")}     ${c.dim(projectPath)}`);
  console.log();

  // Check if directory exists
  if (existsSync(projectPath)) {
    console.error(c.red(`Error: Directory "${name}" already exists`));
    process.exit(1);
  }

  // Create directory
  mkdirSync(projectPath, { recursive: true });

  // Create files
  for (const [filePath, content] of Object.entries(template.files)) {
    const fullPath = join(projectPath, filePath);
    const dir = join(projectPath, filePath.split("/").slice(0, -1).join("/"));

    if (dir && dir !== projectPath) {
      mkdirSync(dir, { recursive: true });
    }

    const fileContent = typeof content === "function" ? content(name) : content;
    writeFileSync(fullPath, fileContent);
    console.log(`  ${c.green("✓")} ${filePath}`);
  }

  console.log();
  console.log(c.green("✓ Project created successfully!"));
  console.log();
  console.log("Next steps:");
  console.log();
  console.log(`  ${c.cyan("cd")} ${name}`);
  console.log(`  ${c.cyan("bun install")}`);
  console.log(`  ${c.cyan("bun run dev")}`);
  console.log();
  console.log(c.dim("Happy coding! 🎉"));
}

// ===== Inspect =====

interface InspectRoute {
  method: string;
  path: string;
  handler: string;
  hasValidation: boolean;
  isAsync: boolean;
  line: number;
}

interface InspectResult {
  routes: InspectRoute[];
  plugins: string[];
  wsRoutes: string[];
  globalMiddleware: number;
  pathMiddleware: number;
  compilationEnabled: boolean;
  port: number;
  configPath: string | null;
  entryFile: string | null;
}

async function handleInspect(args: string[]) {
  let showVerbose = false;
  let showSize = false;
  let showRoutes = false;
  let showPlugins = false;

  for (const arg of args) {
    if (arg === "--verbose" || arg === "-v") showVerbose = true;
    if (arg === "--routes" || arg === "-r") showRoutes = true;
    if (arg === "--plugins" || arg === "-p") showPlugins = true;
    if (arg === "--size" || arg === "-s") showSize = true;
  }

  // Default: show all unless specific flags given
  const showAll = !showRoutes && !showPlugins && !showSize;

  console.log(c.bold("🔍 AsiJS Inspect"));
  console.log();

  const result = await inspectProject();

  // === Routes ===
  if (showAll || showRoutes) {
    printRoutes(result, showVerbose);
  }

  // === Plugins ===
  if (showAll || showPlugins) {
    printPlugins(result);
  }

  // === Size ===
  if (showSize) {
    await printBundleSize();
  }

  // === Summary (always) ===
  if (showAll) {
    printSummaryLine(result);
  }

  console.log();
}

async function inspectProject(): Promise<InspectResult> {
  const cwd = process.cwd();

  // Find entry file
  const entryFile = findStandaloneEntry(cwd);
  let sourceCode = "";

  if (entryFile) {
    try {
      sourceCode = readFileSync(entryFile, "utf-8");
    } catch {
      sourceCode = "";
    }
  } else {
    // Try common entry points
    for (const entry of ["src/index.ts", "src/index.tsx", "src/app.ts", "index.ts"]) {
      const fullPath = join(cwd, entry);
      if (existsSync(fullPath)) {
        sourceCode = readFileSync(fullPath, "utf-8");
        break;
      }
    }
  }

  // Parse routes from source code
  const routes = parseRoutes(sourceCode);

  // Parse plugin registrations
  const plugins = parsePlugins(sourceCode);

  // Parse WebSocket routes
  const wsRoutes = parseWsRoutes(sourceCode);

  // Parse global middleware (app.use() calls with function args)
  const globalMw = countMiddleware(sourceCode);

  // Check for compile() call
  const hasCompilation = /app\.compile\(\)/.test(sourceCode);

  // Detect port
  const portMatch = sourceCode.match(/\.listen\((\d+)\)/);
  const port = portMatch ? parseInt(portMatch[1]!, 10) : 3000;

  // Detect config path
  let configPath: string | null = null;
  if (existsSync(join(cwd, "asi.config.ts"))) configPath = "asi.config.ts";
  else if (existsSync(join(cwd, "asi.config.js"))) configPath = "asi.config.js";

  return {
    routes,
    plugins,
    wsRoutes,
    globalMiddleware: globalMw.global,
    pathMiddleware: globalMw.pathBased,
    compilationEnabled: hasCompilation,
    port,
    configPath,
    entryFile: entryFile ? relativePath(entryFile) : null,
  };
}

function parseRoutes(source: string): InspectRoute[] {
  // Match app.get(), app.post(), app.put(), app.delete(), app.patch(), app.all()
  const routePattern = /app\.(get|post|put|delete|patch|all|head|options)\(\s*["'`]([^"'`]+)["'`]/g;
  const routes: InspectRoute[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = routePattern.exec(source)) !== null) {
    const method = match[1]!.toUpperCase();
    const path = match[2]!;
    const key = `${method} ${path}`;

    if (seen.has(key)) continue;
    seen.add(key);

    // Check for schema/validation options after the path
    const remaining = source.slice(match.index + match[0].length, match.index + match[0].length + 200);
    const hasValidation = /schema\s*:|Type\.Object\s*\(/.test(remaining) || /Type\.String|Type\.Number|Type\.Boolean|Type\.Array/.test(remaining);

    // Check if handler is async
    const isAsync = /async\s*\w/.test(remaining) || /async\s*\(/.test(remaining);

    // Extract handler name / signature
    const handlerMatch = remaining.match(/(?:=>\s*|:\s*|,\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(|([a-zA-Z_$][a-zA-Z0-9_$]*)\(/);
    const handler = handlerMatch
      ? (handlerMatch[1] || handlerMatch[2] || "inline")
      : "inline";

    // Get line number
    const line = source.slice(0, match.index).split("\n").length;

    routes.push({ method, path, handler, hasValidation, isAsync, line });
  }

  return routes;
}

function parsePlugins(source: string): string[] {
  // Match app.plugin(something) or app.use(cors()/etc)
  const pluginPattern = /app\.(?:plugin|use)\(\s*([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
  const plugins: string[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = pluginPattern.exec(source)) !== null) {
    const name = match[1]!;
    if (!seen.has(name)) {
      seen.add(name);
      plugins.push(name);
    }
  }

  return plugins;
}

function parseWsRoutes(source: string): string[] {
  const wsPattern = /app\.ws\(\s*["'`]([^"'`]+)["'`]/g;
  const routes: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = wsPattern.exec(source)) !== null) {
    routes.push(match[1]!);
  }

  return routes;
}

function countMiddleware(source: string): { global: number; pathBased: number } {
  // app.use(middlewareFn) — global middleware (function call, not string path)
  const globalPattern = /app\.use\(\s*[a-zA-Z_$]/g;
  const globalMatches = (source.match(globalPattern) || []).length;

  // app.use('/path', middleware) — path-based middleware
  const pathPattern = /app\.use\(\s*['"`\/]/g;
  const pathMatches = (source.match(pathPattern) || []).length;

  return { global: globalMatches, pathBased: pathMatches };
}

function relativePath(filePath: string): string {
  const cwd = process.cwd();
  if (filePath.startsWith(cwd)) {
    return "." + filePath.slice(cwd.length).replace(/\\/g, "/");
  }
  return filePath;
}

function printRoutes(result: InspectResult, verbose: boolean) {
  console.log(c.bold(c.cyan("  Routes:")));
  console.log();

  if (result.routes.length === 0) {
    if (result.entryFile) {
      console.log(`    ${c.dim("No routes found in " + result.entryFile)}`);
    } else {
      console.log(`    ${c.dim("No entry file found. Run from an AsiJS project directory.")}`);
    }
    console.log();
    return;
  }

  // Display as table
  const methodColors: Record<string, (s: string) => string> = {
    GET: c.green,
    POST: c.blue,
    PUT: c.yellow,
    DELETE: c.red,
    PATCH: c.magenta,
    ALL: c.cyan,
    HEAD: c.dim,
    OPTIONS: c.dim,
  };

  // Calculate column widths
  let maxMethod = 8;
  let maxPath = 20;
  for (const r of result.routes) {
    if (r.method.length > maxMethod) maxMethod = r.method.length;
    if (r.path.length > maxPath) maxPath = Math.min(r.path.length, 60);
  }

  // Header (plain text for sizing, colored for display)
  const plainHeader = `    METHOD${' '.repeat(maxMethod - 4)}  PATH${' '.repeat(maxPath - 4)}  VALIDATION${verbose ? '  HANDLER           LINE' : ''}`;
  console.log(
    `    ${c.dim("METHOD".padEnd(maxMethod + 2))}` +
    `${c.dim("PATH".padEnd(maxPath + 2))}` +
    `${c.dim("VALIDATION".padEnd(14))}` +
    `${verbose ? c.dim("HANDLER".padEnd(18)) + c.dim("LINE") : ""}`,
  );
  console.log(c.dim("    " + "─".repeat(plainHeader.length - 4)));

  for (const r of result.routes) {
    const colorMethod = methodColors[r.method] || c.dim;
    const validation = r.hasValidation
      ? c.green("✓".padEnd(14))
      : c.dim("—".padEnd(14));

    const line =
      `    ${colorMethod(r.method.padEnd(maxMethod + 2))}` +
      `${c.bold(r.path.padEnd(maxPath + 2))}` +
      `${validation}` +
      `${verbose ? c.dim(r.handler.padEnd(18)) + c.dim(String(r.line)) : ""}`;

    console.log(line);
  }

  // WebSocket routes
  if (result.wsRoutes.length > 0) {
    console.log();
    for (const wsPath of result.wsRoutes) {
      console.log(`    ${c.magenta("WS".padEnd(maxMethod + 2))}${c.bold(wsPath)} ${c.dim("(WebSocket)")}`);
    }
  }

  console.log();
}

function printPlugins(result: InspectResult) {
  console.log(c.bold(c.cyan("  Plugins & Middleware:")));
  console.log();

  if (result.plugins.length === 0 && result.globalMiddleware === 0) {
    console.log(`    ${c.dim("No plugins or middleware registered")}`);
    console.log();
    return;
  }

  if (result.plugins.length > 0) {
    // Try to detect dependency relationships from source
    const deps = parsePluginDepsFromSource();

    for (const plugin of result.plugins) {
      const pluginType = detectPluginType(plugin);
      const depChain = deps[plugin];
      const depStr = depChain && depChain.length > 0
        ? c.dim(" depends on: " + depChain.join(", "))
        : "";
      console.log(`    ${c.green("■")} ${c.bold(plugin)}${pluginType ? c.dim(" — " + pluginType) : ""}${depStr}`);
    }
  }

  console.log(
    `    ${c.dim("Global middleware:")} ${result.globalMiddleware}`,
  );
  console.log(
    `    ${c.dim("Path-based middleware:")} ${result.pathMiddleware}`,
  );
  console.log();
}

function parsePluginDepsFromSource(): Record<string, string[]> {
  const cwd = process.cwd();
  const deps: Record<string, string[]> = {};

  // Try to read the entry file and find .dependsOn() calls
  const entryFile = findStandaloneEntry(cwd);
  if (!entryFile) return deps;

  try {
    const source = readFileSync(entryFile, "utf-8");
    // Match patterns like: .dependsOn(["sessions", "cors"])
    // Find the plugin name before .dependsOn
    const depPattern = /(\.plugin\(\s*([a-zA-Z_$][\w]*)\s*\)\s*\.\s*dependsOn\s*\(\s*\[([^\]]*)\]\s*\))|(\.dependsOn\s*\(\s*\[([^\]]*)\]\s*\))/g;
    let match: RegExpExecArray | null;
    while ((match = depPattern.exec(source)) !== null) {
      const pluginName = match[2];
      const depList = (match[3] || match[5] || "");
      const parsedDeps = depList.split(",")
        .map(s => s.trim().replace(/["'`]/g, ""))
        .filter(Boolean);
      if (pluginName && parsedDeps.length > 0) {
        deps[pluginName] = parsedDeps;
      }
    }
  } catch {
    // Silently ignore — inspection should not crash
  }

  return deps;
}

function detectPluginType(name: string): string | null {
  const pluginMap: Record<string, string> = {
    cors: "CORS headers",
    openapi: "OpenAPI / Swagger",
    jwt: "JWT auth",
    bearer: "Bearer token",
    rateLimit: "Rate limiting",
    rateLimitMiddleware: "Rate limiting",
    workspaceRateLimit: "Rate limiting",
    lifecycle: "Graceful shutdown",
    session: "Sessions",
    sessions: "Sessions",
    scheduler: "Cron / scheduling",
    devMode: "Dev dashboard",
    mcp: "MCP / AI",
    healthCheck: "Healthchecks",
    staticFiles: "Static files",
    compression: "Response compression",
    requestLogger: "Request logging",
    sse: "Server-Sent Events",
  };
  return pluginMap[name] ?? null;
}

function printSummaryLine(result: InspectResult) {
  const routeTypes = new Set(result.routes.map((r) => r.method));
  const typeStr = Array.from(routeTypes).join("/");
  const wsCount = result.wsRoutes.length;

  console.log(
    `${c.dim("  Summary:")}`,
  );
  console.log(
    `    ${c.bold(String(result.routes.length))} routes (${c.green(typeStr)}${result.compilationEnabled ? c.dim(", compiled") : ""})` +
    `${wsCount > 0 ? ` · ${c.magenta(String(wsCount))} WebSocket` : ""}` +
    ` · ${c.bold(String(result.plugins.length))} plugins` +
    ` · ${result.globalMiddleware + result.pathMiddleware} middleware` +
    ` · port ${c.cyan(String(result.port))}`,
  );
  if (result.entryFile) {
    console.log(`    ${c.dim("Entry:")} ${c.cyan(result.entryFile)}`);
  }
}

async function printBundleSize() {
  console.log(c.bold(c.cyan("  Bundle Size:")));
  console.log();

  // Find entry point
  const entry = findStandaloneEntry() || "src/index.ts";
  if (!existsSync(entry)) {
    console.log(`    ${c.yellow("No entry file found at " + entry)}`);
    console.log();
    return;
  }

  // Build to temp directory using bun build
  const tmpDir = join(process.cwd(), ".asijs-inspect-tmp");
  try {
    // Remove previous temp dir
    try {
      rmSync(tmpDir, { recursive: true });
    } catch {}
    mkdirSync(tmpDir, { recursive: true });

    const outFile = join(tmpDir, "bundle.js");

    console.log(`    ${c.dim("Building...")}`);

    // Spawn bun build
    const bunPath = process.argv[0];
    const buildProcess = Bun.spawnSync([
      bunPath,
      "build",
      entry,
      "--outdir",
      tmpDir,
      "--target",
      "bun",
      "--minify",
    ]);

    if (!buildProcess.success) {
      console.log(`    ${c.yellow("Build failed:")} ${buildProcess.stderr.toString().trim()}`);
      console.log();
      return;
    }

    // Read output files
    const files = readdirSync(tmpDir);
    let totalSize = 0;

    for (const file of files) {
      const filePath = join(tmpDir, file);
      if (statSync(filePath).isFile()) {
        const size = statSync(filePath).size;
        totalSize += size;
        console.log(`    ${c.dim("  " + file.padEnd(30))} ${formatSize(size)}`);
      }
    }

    console.log(`    ${c.dim("  " + "─".repeat(30))} ${c.bold("───")}`);
    console.log(`    ${c.dim("  Total".padEnd(30))} ${c.bold(formatSize(totalSize))}`);
    console.log();

    // Cleanup
    try {
      rmSync(tmpDir, { recursive: true });
    } catch {}
  } catch (error) {
    console.log(`    ${c.yellow("Size analysis failed:")} ${(error as Error).message}`);
    console.log();
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function handleBuild(args: string[]) {
  var clientEntry = "src/client.tsx";
  var serverEntry = "src/index.ts";
  var outDir = "dist";
  var noMinify = false;
  var ssgMode = false;
  var exportApi = false;
  var ssgFormat = "pretty";
  var target: string | null = null;

  for (var i = 0; i < args.length; i++) {
    if (args[i] === "--client") {
      clientEntry = args[++i];
    } else if (args[i] === "--server") {
      serverEntry = args[++i];
    } else if (args[i] === "--outdir") {
      outDir = args[++i];
    } else if (args[i] === "--no-minify") {
      noMinify = true;
    } else if (args[i] === "--ssg") {
      ssgMode = true;
    } else if (args[i] === "--export-api") {
      exportApi = true;
    } else if (args[i] === "--flat") {
      ssgFormat = "flat";
    } else if (args[i] === "--target" || args[i] === "-t") {
      target = args[++i];
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(`
${c.bold("AsiJS Build")} — Production build

${c.bold("Usage:")}
  asi build [options]

${c.bold("Options:")}
  --client <path>      Client entry point (default: src/client.tsx)
  --server <path>      Server entry point (default: src/index.ts)
  --outdir <path>      Output directory (default: dist)
  --no-minify          Skip minification
  --target, -t <name>  Serverless target: cloudflare, lambda-edge, deno-deploy,
                       vercel-edge, netlify-edge, bun (default: bun)
  -h, --help           Show this help

${c.bold("SSG Options:")}
  --ssg                Enable Static Site Generation
  --flat               Flat file output (/about -> about.html)
  --export-api         Export JSON API responses

${c.bold("Examples:")}
  asi build
  asi build --target cloudflare
  asi build --target lambda-edge --outdir build
  asi build --ssg
  asi build --ssg --outdir build --flat
  asi build --ssg --export-api
`);
      return;
    }
  }

  // If a serverless target is specified, use serverless build command
  if (target && target !== "bun") {
    console.log(c.bold("🏗️  AsiJS Serverless Build"));
    console.log();

    var validTargets = ["cloudflare", "lambda-edge", "deno-deploy", "vercel-edge", "netlify-edge"];
    if (!validTargets.includes(target)) {
      console.log(c.red("Error: Unknown target " + target));
      console.log("  Valid targets: " + validTargets.join(", "));
      console.log();
      return;
    }

    var { serverless } = await import("./serverless");
    var serverlessConfig = serverless.bundleConfig(target as any, serverEntry, { outDir });
    var buildArgs = ["build", serverlessConfig.entry, "--outdir", serverlessConfig.outDir];
    if (serverlessConfig.minify) buildArgs.push("--minify");
    if (serverlessConfig.sourcemap) buildArgs.push("--sourcemap");
    if (serverlessConfig.treeshake) buildArgs.push("--treeshaking");
    for (var ext of serverlessConfig.externals) {
      buildArgs.push("--external", ext);
    }
    for (var flag of serverlessConfig.flags) {
      buildArgs.push(flag);
    }

    console.log(c.dim("  Target: ") + c.cyan(target));
    console.log(c.dim("  Entry:  ") + c.cyan(serverlessConfig.entry));
    console.log(c.dim("  Out:    ") + c.cyan(serverlessConfig.outDir));
    console.log();
    console.log(c.dim("  Running: bun " + buildArgs.join(" ")));
    console.log();

    try {
      var bunPath = process.argv[0];
      var serverlessResult = Bun.spawnSync([bunPath, ...buildArgs], {
        cwd: process.cwd(),
        stdio: ["inherit", "inherit", "pipe"],
      });

      if (!serverlessResult.success) {
        console.log(c.red("Build failed."));
        console.log(serverlessResult.stderr.toString());
      } else {
        console.log(c.green("✓ Build complete!"));
        console.log();
        var platform = SERVERLESS_PLATFORMS[target as keyof typeof SERVERLESS_PLATFORMS];
        if (platform) {
          console.log(c.dim("  Next steps for " + platform.name + ":"));
          for (var bp of platform.bestPractices.slice(0, 3)) {
            console.log(c.dim("  • " + bp));
          }
          console.log();
        }
      }
    } catch (buildErr: any) {
      console.log(c.red("Build error: " + buildErr.message));
      console.log();
    }
    return;
  }

  console.log(c.bold("🏗️  AsiJS Build"));
  console.log();

  try {
    if (ssgMode) {
      console.log(c.dim("Mode: Static Site Generation"));
      console.log();

      var { buildSSG } = await import("./ssg");
      var { Asi } = await import("./asi");        var entryPath = resolve(process.cwd(), serverEntry);
        var userModule;
        try {
          userModule = await import(entryPath);
        } catch (importErr: any) {
          console.log(c.yellow("Could not import entry file: " + importErr.message));
        console.log(c.dim("Make sure your entry file exports `app` (the Asi instance)."));
        console.log();
        return;
      }

      var userApp = userModule.app || userModule.default?.app;
      if (!userApp) {
        console.log(c.yellow("Entry file does not export `app`. Using fresh Asi instance."));
        userApp = new Asi();
      }

      var ssgResult = await buildSSG(userApp, {
        outDir,
        format: ssgFormat as "pretty" | "flat",
        exportApi,
        verbose: true,
      });

      console.log();
      if (ssgResult.failedPages > 0) {
        console.log(c.yellow("SSG complete: " + ssgResult.successPages + " pages, " + ssgResult.failedPages + " failed, " + ssgResult.durationMs + "ms"));
      } else {
        console.log(c.green("SSG complete: " + ssgResult.successPages + " pages in " + ssgResult.durationMs + "ms"));
      }
      console.log(c.dim("Output: ") + c.cyan(ssgResult.outDir));
    } else {
      var { buildProject } = await import("./spa");

      var result = await buildProject({
        clientEntry,
        serverEntry,
        outDir,
        minify: !noMinify,
        silent: false,
      });

      console.log();
      console.log(c.green("Build complete!"));
      console.log(c.dim("Client: ") + c.cyan(result.clientBundle));
      console.log(c.dim("Server: ") + c.cyan(result.serverBundle));
      console.log(c.dim("Duration: ") + result.durationMs + "ms");
      console.log();

      console.log(c.dim("Next steps:"));
      console.log(c.cyan("bun run dist/server/index.js") + c.dim("  # Start production server"));
      console.log();
    }
  } catch (error) {
    console.error(c.red("Build failed:"), (error as Error).message);
    process.exit(1);
  }
}

// ===== Generate =====

async function handleGenerate(args: string[]) {
  const type = args[0];
  const name = args[1];

  if (!type || type === "--help" || type === "-h") {
    console.log(`\n${c.bold("AsiJS Generate")} — Code generation scaffold\n\n${c.bold("Usage:")}\n  asi generate <type> <name>\n\n${c.bold("Types:")}\n  route  <path>  Generate a new route file\n  action <name>  Generate a server action\n  plugin <name>  Generate a plugin scaffold\n  app    <name>  Generate a sub-app\n`);
    return;
  }

  const cwd = process.cwd();

  switch (type) {
    case "route": {
      const routePath = name || "new-route";
      const filePath = join(cwd, "src", "routes", `${routePath}.ts`);
      mkdirSync(join(cwd, "src", "routes"), { recursive: true });
      writeFileSync(filePath, `import { Asi, type Context } from "asijs";

export function get(ctx: Context) {
  return { message: "Hello from ${routePath}!" };
}
`);
      console.log(`  ${c.green("✓")} Created ${c.cyan(filePath)}`);
      break;
    }
    case "action": {
      const actionName = name || "myAction";
      const filePath = join(cwd, "src", "actions", `${actionName}.ts`);
      mkdirSync(join(cwd, "src", "actions"), { recursive: true });
      writeFileSync(filePath, `import { serverAction, rpc } from "asijs";
import { Type } from "@sinclair/typebox";

export const ${actionName} = serverAction(
  Type.Object({
    // Add input fields here
    name: Type.String(),
  }),
  async ({ name }) => {
    return { message: \`Hello, \${name}!\` };
  },
);
`);
      console.log(`  ${c.green("✓")} Created ${c.cyan(filePath)}`);
      break;
    }
    case "plugin": {
      const pluginName = name || "myPlugin";
      const filePath = join(cwd, "src", "plugins", `${pluginName}.ts`);
      mkdirSync(join(cwd, "src", "plugins"), { recursive: true });
      writeFileSync(filePath, `import { createPlugin } from "asijs";

export const ${pluginName} = createPlugin({
  name: "${pluginName}",
  setup(app) {
    app.get("/${pluginName}", () => ({ plugin: "${pluginName}" }));
  },
});
`);
      console.log(`  ${c.green("✓")} Created ${c.cyan(filePath)}`);
      break;
    }
    case "app": {
      const appName = name || "my-app";
      const appDir = join(cwd, "apps", appName);
      mkdirSync(join(appDir, "src"), { recursive: true });
      writeFileSync(join(appDir, "src", "index.ts"), `import { Asi } from "asijs";

const app = new Asi();

app.get("/", () => ({ service: "${appName}", status: "ok" }));

app.listen(Number(process.env.PORT ?? 3001));
`);
      writeFileSync(join(appDir, "package.json"), JSON.stringify({
        name: appName,
        version: "0.1.0",
        type: "module",
        scripts: { dev: "bun run --hot src/index.ts", start: "bun run src/index.ts" },
        dependencies: { asijs: "latest" },
      }, null, 2));
      console.log(`  ${c.green("✓")} Created sub-app in ${c.cyan(appDir)}`);
      break;
    }
    default:
      console.log(c.red(`Unknown generate type: "${type}"`));
      console.log(`  Use: asi generate route|action|plugin|app <name>`);
  }
}

async function handleMigrate(args: string[]) {
  let targetPath = ".";
  let from: SourceFramework | undefined;
  let dryRun = false;
  let verbose = false;

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--from" || args[i] === "-f") {
      from = args[i + 1] as SourceFramework;
      i++;
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    } else if (args[i] === "--verbose" || args[i] === "-v") {
      verbose = true;
    } else if (!args[i].startsWith("-")) {
      targetPath = args[i];
    }
  }

  console.log(c.bold("🔄 AsiJS Codemod — Auto Migration"));
  console.log();

  // Auto-detect framework if not specified
  if (!from) {
    console.log(c.dim("  Detecting source framework..."));
    const detected = detectProjectFramework(resolve(targetPath));
    if (detected) {
      from = detected;
      console.log(`  ${c.green("✓")} Detected: ${c.cyan(detected)}`);
    } else {
      console.error(c.red("✗ Could not detect source framework."));
      console.log();
      console.log(c.dim("  Specify it with --from flag:"));
      console.log(c.dim("    bunx asijs migrate ./src --from elysia"));
      console.log(c.dim("    bunx asijs migrate ./src --from hono"));
      console.log(c.dim("    bunx asijs migrate ./src --from fastify"));
      process.exit(1);
    }
  }

  console.log(`  ${c.dim("Target:")}   ${resolve(targetPath)}`);
  console.log(`  ${c.dim("From:")}     ${c.cyan(from)}`);
  console.log(`  ${c.dim("Mode:")}     ${dryRun ? c.yellow("Dry Run") : c.green("Write")}`);
  console.log();

  try {
    const result = runCodemod(targetPath, {
      from,
      dryRun,
      verbose,
    });

    printSummary(result, dryRun);
  } catch (error) {
    console.error(c.red("\n✗ Migration failed:"), error);
    process.exit(1);
  }
}

/**
 * `asi integrate <path>` — auto-detect framework and migrate to AsiJS.
 * Uses the codemod engine to transform Express/Koa/Elysia/Hono/Fastify code.
 */
async function handleIntegrate(args: string[]) {
  let targetPath = ".";
  let dryRun = false;
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") {
      dryRun = true;
    } else if (args[i] === "--verbose" || args[i] === "-v") {
      verbose = true;
    } else if (!args[i].startsWith("-")) {
      targetPath = args[i];
    }
  }

  console.log(c.bold("🔄 AsiJS Integrate — Auto-Detect & Migrate"));
  console.log();

  console.log(c.dim("  Detecting source framework..."));
  const detected = detectProjectFramework(resolve(targetPath));
  
  if (!detected) {
    console.error(c.red("✗ Could not detect source framework."));
    console.log();
    console.log(c.dim("  No Elysia, Hono, Fastify, Express, or Koa code found."));
    console.log(c.dim("  Use the explicit command if you know the framework:"));
    console.log(c.dim("    bunx asijs migrate ./src --from express"));
    console.log(c.dim("    bunx asijs migrate ./src --from koa"));
    process.exit(1);
  }

  console.log(`  ${c.green("✓")} Detected: ${c.cyan(detected)}`);
  console.log();
  console.log(`  ${c.dim("Target:")}   ${resolve(targetPath)}`);
  console.log(`  ${c.dim("From:")}     ${c.cyan(detected)}`);
  console.log(`  ${c.dim("Mode:")}     ${dryRun ? c.yellow("Dry Run") : c.green("Write")}`);
  console.log();

  // Print framework-specific advice
  console.log(c.dim("  Migration advice:"));
  switch (detected) {
    case "express":
      console.log(c.dim("    • For gradual migration, wrap Express middleware with expressPlugin.wrap()"));
      console.log(c.dim("      import { expressPlugin } from 'asijs/migrate-express'"));
      console.log(c.dim("    • The codemod will transform app.get/post/put/delete to AsiJS syntax"));
      break;
    case "koa":
      console.log(c.dim("    • For gradual migration, wrap Koa middleware with koaPlugin.wrap()"));
      console.log(c.dim("      import { koaPlugin } from 'asijs/migrate-koa'"));
      console.log(c.dim("    • The codemod will transform ctx.body, ctx.status, ctx.throw to AsiJS"));
      break;
    case "elysia":
      console.log(c.dim("    • Most Elysia syntax maps directly to AsiJS"));
      break;
    case "hono":
      console.log(c.dim("    • c.json() → return object, c.text() → return string"));
      break;
    case "fastify":
      console.log(c.dim("    • reply.send() → return, app.listen({ port }) → app.listen(port)"));
      break;
  }
  console.log();

  try {
    const result = runCodemod(targetPath, {
      from: detected,
      dryRun,
      verbose,
    });

    printSummary(result, dryRun);
  } catch (error) {
    console.error(c.red("\n✗ Migration failed:"), error);
    process.exit(1);
  }
}

async function handlePlugin(args: string[]) {
  const action = args[0];
  const name = args[1];

  if (!action || action === "--help" || action === "-h") {
    console.log(`
${c.bold("Plugin Registry")} — Search, install, and create AsiJS plugins

${c.bold("Usage:")}
  asi plugin search [query]   Search plugins in the registry
  asi plugin install <name>   Install a plugin from npm
  asi plugin remove <name>    Remove a plugin
  asi plugin list             List installed plugins
  asi plugin create <name>    Scaffold a new plugin project
  asi plugin awesome          Show all available plugins
  asi plugin --help           Show this help

${c.bold("Examples:")}
  asi plugin search cors
  asi plugin install cors
  asi plugin create my-plugin --with-tests
`);
    return;
  }

  switch (action) {
    case "search": {
      const registry = new PluginRegistry();
      const query = name || "";
      const results = registry.search(query);

      console.log(c.bold(`\n🔍 Plugin search: ${query || "all"}`));
      console.log(c.dim(`   ${results.length} plugin(s) found\n`));

      if (results.length === 0) {
        console.log(`   ${c.yellow("No plugins found for query:")} "${query}"`);
        console.log();
        return;
      }

      // Group by category
      const grouped = new Map<string, typeof results>();
      for (const p of results) {
        const cat = p.category || "other";
        if (!grouped.has(cat)) grouped.set(cat, []);
        grouped.get(cat)!.push(p);
      }

      for (const [cat, plugins] of grouped) {
        console.log(`  ${c.bold(c.cyan(cat.charAt(0).toUpperCase() + cat.slice(1)))}`);
        for (const p of plugins) {
          const tags = (p.tags || []).map((t) => c.dim(t)).join(", ");
          console.log(`    ${c.green("■")} ${c.bold(p.name.padEnd(20))} ${p.description}`);
          console.log(`     ${c.dim("npm:")} ${c.cyan(p.npmPackage)}${p.version ? ` ${c.dim("v" + p.version)}` : ""} ${tags}`);
        }
        console.log();
      }
      break;
    }

    case "install": {
      if (!name) {
        console.error(c.red("Error: Plugin name is required"));
        console.log(`  ${c.dim("Usage: asi plugin install <name>")}`);
        return;
      }

      console.log(c.bold(`\n📦 Installing plugin: ${name}\n`));

      const result = await installPlugin(name);

      if (result.success) {
        console.log(`  ${c.green("✓")} ${result.message}`);
      } else {
        console.log(`  ${c.red("✗")} ${result.message}`);
      }
      console.log();
      break;
    }

    case "remove":
    case "uninstall": {
      if (!name) {
        console.error(c.red("Error: Plugin name is required"));
        console.log(`  ${c.dim("Usage: asi plugin remove <name>")}`);
        return;
      }

      console.log(c.bold(`\n🗑️  Removing plugin: ${name}\n`));

      const result = await uninstallPlugin(name);

      if (result.success) {
        console.log(`  ${c.green("✓")} ${result.message}`);
      } else {
        console.log(`  ${c.red("✗")} ${result.message}`);
      }
      console.log();
      break;
    }

    case "list": {
      console.log(c.bold("\n📋 Installed Plugins\n"));

      const installed = listInstalledPlugins();

      if (installed.length === 0) {
        console.log(`  ${c.dim("No AsiJS-related plugins found in package.json")}`);
        console.log();
        return;
      }

      for (const p of installed) {
        const type = p.isLocal ? c.yellow("local") : c.green("npm");
        console.log(`  ${c.green("■")} ${c.bold(p.name.padEnd(25))} ${type} ${c.dim("v" + p.version)}`);
      }
      console.log();
      break;
    }

    case "create": {
      if (!name) {
        console.error(c.red("Error: Plugin name is required"));
        console.log(`  ${c.dim("Usage: asi plugin create <name>")}`);
        return;
      }

      const withTests = args.includes("--with-tests") || args.includes("-t");
      const descIndex = args.indexOf("--desc");
      const description = descIndex >= 0 ? args[descIndex + 1] : undefined;

      console.log(c.bold(`\n🛠️  Scaffolding plugin: ${name}\n`));

      const result = scaffoldPlugin({
        name,
        description,
        withTests,
        withExample: true,
      });

      if (result.success) {
        console.log(`  ${c.green("✓")} ${result.message}`);
        console.log();
        console.log(`  ${c.dim("Next steps:")}`);
        console.log(`    ${c.cyan("cd")} ${name}`);
        console.log(`    ${c.cyan("bun install")}`);
        console.log(`    ${c.cyan("bun run dev")}`);
      } else {
        console.log(`  ${c.red("✗")} ${result.message}`);
      }
      console.log();
      break;
    }

    case "awesome": {
      const registry = new PluginRegistry();
      console.log(c.bold("\n🌟 Awesome AsiJS Plugins\n"));
      console.log(registry.generateAwesomeMarkdown());
      console.log();
      break;
    }

    default:
      console.error(c.red(`Unknown plugin action: "${action}"`));
      console.log(`  ${c.dim("Available: search, install, remove, list, create, awesome")}`);
  }
}

/**
 * Start the AsiJS interactive REPL.
 */
async function startRepl(args: string[]) {
  let port = 3001;
  let silent = false;
  const preload: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" || args[i] === "-p") {
      port = parseInt(args[i + 1]!, 10) || 3001;
      i++;
    } else if (args[i] === "--silent" || args[i] === "-s") {
      silent = true;
    } else if (args[i] === "--preload" || args[i] === "-l") {
      preload.push(args[i + 1]!);
      i++;
    }
  }

  const { AsiRepl } = await import("./repl");
  const repl = new AsiRepl({ port, silent, preload });

  process.on("SIGINT", () => {
    repl.stop();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    repl.stop();
    process.exit(0);
  });

  await repl.start();
}

function printHelp() {
  console.log(`
${c.bold("AsiJS CLI")} — Create & migrate AsiJS projects

${c.bold("Usage:")}
  bunx asijs create <project-name> [options]
  bun create asijs <project-name> [options]
  bunx asijs migrate <path> [options]
  bunx asijs build [options]
  bunx asijs plugin <action> [name] [options]
  bunx asijs repl [options]

${c.bold("Commands:")}
  create   Create a new AsiJS project
  build    Production build for SPA/SSR apps (client + server bundles)
  migrate  Migrate existing project from Elysia / Hono / Fastify
  dev      Start workspace dev mode with hot-reload
  inspect  Inspect project: routes, plugins, middleware, bundle size
  plugin   Manage plugins: search, install, create, list
  repl     Interactive REPL — create routes, test requests, inspect state

${c.bold("Plugin Actions:")}
  search [query]   Search plugins in the official registry
  install <name>   Install a plugin from npm
  remove <name>    Remove a plugin
  list             List installed plugins
  create <name>    Scaffold a new plugin project
  awesome          Show all available plugins

${c.bold("REPL Options:")}
  -p, --port <port>      Start test server on port (default: 3001)
  -s, --silent           Less verbose output
  -l, --preload <file>   Preload a source file

${c.bold("Build Options:")}
  --client <path>      Client entry point (default: src/client.tsx)
  --server <path>      Server entry point (default: src/index.ts)
  --outdir <path>      Output directory (default: dist)
  --no-minify          Skip minification

${c.bold("Inspect Options:")}
  -r, --routes            Show routes table
  -p, --plugins           Show plugins and middleware
  -s, --size              Show bundle size analysis
  -v, --verbose           Detailed route info (handler, line number)

${c.bold("Migrate Options:")}
  -f, --from <framework>  Source framework (elysia|hono|fastify)
  --dry-run               Show changes without writing
  -v, --verbose           Detailed transformation logs

${c.bold("Create Options:")}
  -t, --template <name>   Use a specific template
  -h, --help              Show this help message
  -v, --version           Show version

${c.bold("Plugin Create Options:")}
  --with-tests, -t        Include test file template
  --desc <text>           Plugin description

${c.bold("Templates:")}
${Object.entries(TEMPLATES)
  .map(([key, val]) => `  ${c.cyan(key.padEnd(12))} ${val.description}`)
  .join("\n")}

${c.bold("Examples:")}
  bunx asijs create my-app
  bunx asijs create my-api -t api
  bunx asijs inspect
  bunx asijs inspect --routes --verbose
  bunx asijs inspect --plugins
  bunx asijs inspect --size
  bunx asijs build
  bunx asijs build --client src/client.tsx --outdir build
  bunx asijs migrate ./src --from elysia
  bunx asijs migrate ./app.ts --from hono --dry-run -v
  bunx asijs migrate . --from fastify
  bunx asijs repl
  bunx asijs repl --port 8080
  bunx asijs plugin search cors
  bunx asijs plugin install cors
  bunx asijs plugin create my-plugin --with-tests
  bunx asijs plugin list
  bunx asijs plugin awesome
`);
}

async function prompt(message: string): Promise<string> {
  process.stdout.write(message);

  const buf = new Uint8Array(1024);
  const n = await (Bun.stdin as any).read(buf);

  if (n === null) return "";
  return new TextDecoder().decode(buf.subarray(0, n)).trim();
}

main().catch(console.error);
