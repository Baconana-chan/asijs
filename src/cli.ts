#!/usr/bin/env bun
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
 */

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  statSync,
  readFileSync,
} from "fs";
import { join, resolve, basename } from "path";

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

// ===== Main =====
async function main() {
  const args = process.argv.slice(2);

  // Handle `bun create asijs my-app` (Bun passes project name directly)
  // or `bunx asijs create my-app`
  let command = args[0];
  let projectName: string | undefined;
  let template: TemplateName = "minimal";

  // Parse arguments
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
    console.log("asijs v1.0.0");
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

function printHelp() {
  console.log(`
${c.bold("AsiJS CLI")} - Create AsiJS projects

${c.bold("Usage:")}
  bunx asijs create <project-name> [options]
  bun create asijs <project-name> [options]

${c.bold("Options:")}
  -t, --template <name>  Use a specific template
  -h, --help             Show this help message
  -v, --version          Show version

${c.bold("Templates:")}
${Object.entries(TEMPLATES)
  .map(([key, val]) => `  ${c.cyan(key.padEnd(12))} ${val.description}`)
  .join("\n")}

${c.bold("Examples:")}
  bunx asijs create my-app
  bunx asijs create my-api -t api
  bun create asijs my-app --template fullstack
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
