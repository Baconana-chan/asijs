/**
 * Template definitions for AsiJS projects.
 * Separated from template-explorer.ts to allow testing without vscode dependency.
 */

export interface TemplateFile {
  path: string;
  content: string;
  language?: string;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  order: number;
  files: TemplateFile[];
}

export const TEMPLATES: Template[] = [
  {
    id: "minimal",
    name: "Minimal",
    description: "Minimal setup with basic routing — perfect for APIs and microservices",
    category: "Core",
    icon: "⚡",
    order: 1,
    files: [
      {
        path: "src/index.ts",
        language: "typescript",
        content: `import { Asi } from "asijs";

const app = new Asi();

app.get("/", () => "Hello from AsiJS! 🚀");
app.get("/health", () => ({ status: "ok", timestamp: Date.now() }));

app.listen(3000, () => {
  console.log("🚀 Server running at http://localhost:3000");
});`,
      },
      {
        path: "package.json",
        language: "json",
        content: `{
  "name": "my-app",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "bun run --hot src/index.ts",
    "start": "bun run src/index.ts"
  },
  "dependencies": {
    "asijs": "latest"
  }
}`,
      },
      {
        path: "tsconfig.json",
        language: "json",
        content: `{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "types": ["bun-types"]
  },
  "include": ["src"]
}`,
      },
      {
        path: ".gitignore",
        language: "ignore",
        content: "node_modules\ndist\n.env\n*.log\n",
      },
    ],
  },
  {
    id: "api",
    name: "REST API",
    description: "REST API with validation, CORS, and OpenAPI documentation",
    category: "Core",
    icon: "🔌",
    order: 2,
    files: [
      {
        path: "src/index.ts",
        language: "typescript",
        content: `import { Asi, cors, openapi } from "asijs";
import { Type } from "@sinclair/typebox";

const app = new Asi();

app.plugin(cors());
app.plugin(openapi({ title: "My API", version: "1.0.0", path: "/docs" }));

const users: { id: number; name: string; email: string }[] = [];
let nextId = 1;

app.get("/users", () => users);

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

app.get("/users/:id", (ctx) => {
  const user = users.find(u => u.id === Number(ctx.params.id));
  if (!user) return ctx.status(404).jsonResponse({ error: "Not found" });
  return user;
});

app.listen(3000, () => {
  console.log("🚀 API running at http://localhost:3000");
  console.log("📚 Docs at http://localhost:3000/docs");
});`,
      },
      {
        path: "package.json",
        language: "json",
        content: `{
  "name": "my-api",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "bun run --hot src/index.ts",
    "start": "bun run src/index.ts",
    "test": "bun test"
  },
  "dependencies": {
    "asijs": "latest",
    "@sinclair/typebox": "^0.34.0"
  }
}`,
      },
      {
        path: "tsconfig.json",
        language: "json",
        content: `{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "types": ["bun-types"]
  },
  "include": ["src"]
}`,
      },
    ],
  },
  {
    id: "fullstack",
    name: "Fullstack",
    description: "API + JSX server-side rendering with components",
    category: "Core",
    icon: "🌐",
    order: 3,
    files: [
      {
        path: "src/index.tsx",
        language: "typescriptreact",
        content: `import { Asi, html, type FC } from "asijs";

const app = new Asi();

const Layout: FC<{ title: string; children: any }> = ({ title, children }) => (
  <html>
    <head>
      <meta charset="UTF-8" />
      <title>{title}</title>
    </head>
    <body>{children}</body>
  </html>
);

app.get("/", (ctx) => ctx.html(
  <Layout title="Home">
    <h1>Hello from AsiJS Fullstack!</h1>
  </Layout>
));

app.listen(3000, () => {
  console.log("🚀 App running at http://localhost:3000");
});`,
      },
      {
        path: "package.json",
        language: "json",
        content: `{
  "name": "my-app",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "bun run --hot src/index.tsx",
    "start": "bun run src/index.tsx"
  },
  "dependencies": {
    "asijs": "latest"
  }
}`,
      },
      {
        path: "tsconfig.json",
        language: "json",
        content: `{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "jsx": "react-jsx",
    "jsxImportSource": "asijs",
    "types": ["bun-types"]
  },
  "include": ["src"]
}`,
      },
    ],
  },
  {
    id: "auth",
    name: "Auth",
    description: "Authentication with JWT, password hashing, and protected routes",
    category: "Security",
    icon: "🔐",
    order: 4,
    files: [
      {
        path: "src/index.ts",
        language: "typescript",
        content: `import { Asi, cors, jwt, bearer } from "asijs";
import { Type } from "@sinclair/typebox";

const app = new Asi();
app.plugin(cors());

const jwtHelper = jwt({ secret: process.env.JWT_SECRET || "dev-secret" });

const users: { id: number; email: string; name: string }[] = [];

app.post("/register", {
  body: Type.Object({
    email: Type.String({ format: "email" }),
    password: Type.String({ minLength: 8 }),
    name: Type.String(),
  }),
}, async (ctx) => {
  const token = await jwtHelper.sign({ email: ctx.body.email });
  const user = { id: users.length + 1, email: ctx.body.email, name: ctx.body.name };
  users.push(user);
  return { user, token };
});

app.post("/login", {
  body: Type.Object({
    email: Type.String(),
    password: Type.String(),
  }),
}, async (ctx) => {
  const token = await jwtHelper.sign({ email: ctx.body.email });
  return { token };
});

app.get("/me", bearer({ verify: (t) => jwtHelper.verify(t) }), (ctx) => {
  return { user: (ctx as any).user };
});

app.listen(3000, () => {
  console.log("🚀 Auth API running at http://localhost:3000");
});`,
      },
      {
        path: "package.json",
        language: "json",
        content: `{
  "name": "my-auth",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "bun run --hot src/index.ts",
    "start": "bun run src/index.ts"
  },
  "dependencies": {
    "asijs": "latest",
    "@sinclair/typebox": "^0.34.0"
  }
}`,
      },
    ],
  },
  {
    id: "realtime",
    name: "Realtime",
    description: "WebSocket chat with real-time messaging and broadcasting",
    category: "Core",
    icon: "💬",
    order: 5,
    files: [
      {
        path: "src/index.ts",
        language: "typescript",
        content: `import { Asi, html, type FC } from "asijs";

const app = new Asi();
const clients = new Set<any>();

const ChatPage: FC = () => (
  <html>
    <head>
      <meta charset="UTF-8" />
      <title>AsiJS Chat</title>
      <style>{\`
        body { font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 2rem; }
        #messages { border: 1px solid #ddd; height: 400px; overflow-y: auto; padding: 1rem; }
        #form { display: flex; margin-top: 1rem; }
        #input { flex: 1; padding: 0.5rem; }
        button { padding: 0.5rem 1rem; }
      \`}</style>
    </head>
    <body>
      <h1>💬 Chat</h1>
      <div id="messages"></div>
      <form id="form">
        <input id="input" placeholder="Type a message..." />
        <button type="submit">Send</button>
      </form>
      <script>{\`
        const ws = new WebSocket('ws://' + location.host + '/ws');
        const messages = document.getElementById('messages');
        const form = document.getElementById('form');
        const input = document.getElementById('input');
        ws.onmessage = (e) => {
          messages.innerHTML += '<div>' + e.data + '</div>';
          messages.scrollTop = messages.scrollHeight;
        };
        form.onsubmit = (e) => {
          e.preventDefault();
          if (input.value.trim()) {
            ws.send(input.value);
            input.value = '';
          }
        };
      \`}</script>
    </body>
  </html>
);

app.get("/", (ctx) => ctx.html(<ChatPage />));

app.ws("/ws", {
  open(ws) { clients.add(ws); },
  message(ws, message) {
    for (const client of clients) {
      client.send(message.toString());
    }
  },
  close(ws) { clients.delete(ws); },
});

app.listen(3000, () => {
  console.log("🚀 Chat running at http://localhost:3000");
});`,
      },
    ],
  },
  {
    id: "cloudflare",
    name: "Cloudflare Workers",
    description: "Deploy on Cloudflare Workers with edge runtime and waitUntil",
    category: "Deployment",
    icon: "☁️",
    order: 6,
    files: [
      {
        path: "src/index.ts",
        language: "typescript",
        content: `import { Asi } from "asijs";
import { cloudflare } from "asijs/edge";

const app = new Asi();

app.get("/", () => ({
  message: "Hello from Cloudflare Workers!",
  runtime: "edge",
}));

app.get("/health", () => ({ status: "ok" }));

export default cloudflare(app);`,
      },
      {
        path: "wrangler.toml",
        language: "toml",
        content: `name = "my-worker"
main = "src/index.ts"
compatibility_date = "2025-01-01"
`,
      },
    ],
  },
  {
    id: "spa",
    name: "SPA + SSR",
    description: "Single Page App with SSR hydration and Islands architecture",
    category: "Core",
    icon: "🎨",
    order: 7,
    files: [
      {
        path: "src/index.ts",
        language: "typescript",
        content: `import { Asi, staticFiles } from "asijs";
import { spaFallbackHandler } from "asijs/spa";

const app = new Asi({
  spa: { clientEntry: "src/client.tsx", hmr: true },
});

app.get("/api/hello", () => ({ message: "Hello!" }));

app.use(staticFiles("./public"));
app.all("/*", spaFallbackHandler({
  publicPath: "/_asi/client",
  clientBundleName: "client.js",
}));

app.listen(3000, () => {
  console.log("🚀 Server running at http://localhost:3000");
});`,
      },
      {
        path: "src/app.tsx",
        language: "typescriptreact",
        content: `import { type FC } from "asijs";

export const App: FC<{ message?: string }> = ({ message }) => (
  <html>
    <head>
      <meta charset="UTF-8" />
      <title>AsiJS SPA</title>
    </head>
    <body>
      <div id="app">
        <h1>Hello from AsiJS!</h1>
        <p>{message || "Server-rendered content"}</p>
      </div>
    </body>
  </html>
);`,
      },
      {
        path: "src/client.tsx",
        language: "typescriptreact",
        content: `import { hydrate } from "asijs/spa-client";

hydrate(function(props, root) {
  console.log("[AsiJS] Hydrated with props:", props);
});`,
      },
    ],
  },
  {
    id: "deno",
    name: "Deno / Deno Deploy",
    description: "Deploy on Deno / Deno Deploy with native Deno.serve()",
    category: "Deployment",
    icon: "🦕",
    order: 8,
    files: [
      {
        path: "src/index.ts",
        language: "typescript",
        content: `import { Asi } from "asijs";
import { deno, denoServe } from "asijs/edge";

const app = new Asi();

app.get("/", () => ({
  message: "Hello from Deno!",
  runtime: "deno",
}));

app.get("/health", () => ({ status: "ok" }));

if (import.meta.main) {
  denoServe(app, { port: 3000 });
}

export default { fetch: deno(app) };`,
      },
      {
        path: "deno.json",
        language: "json",
        content: `{
  "tasks": {
    "dev": "deno run --allow-net --allow-env src/index.ts"
  },
  "imports": { "asijs": "npm:asijs" }
}`,
      },
    ],
  },
  {
    id: "workspace",
    name: "Workspace",
    description: "Monorepo with multiple sub-apps and selective hot-reload",
    category: "Advanced",
    icon: "🏗️",
    order: 9,
    files: [
      {
        path: "package.json",
        language: "json",
        content: `{
  "name": "my-workspace",
  "private": true,
  "type": "module",
  "workspaces": ["apps/*"],
  "scripts": { "dev": "asijs dev" },
  "devDependencies": { "asijs": "latest" }
}`,
      },
      {
        path: "apps/api/src/index.ts",
        language: "typescript",
        content: `import { Asi } from "asijs";

const app = new Asi({ development: true });

app.get("/", () => ({ service: "api", status: "ok" }));

app.listen(Number(process.env.PORT ?? 3001), () => {
  console.log("API sub-app on port", process.env.PORT ?? 3001);
});`,
      },
      {
        path: "apps/web/src/index.tsx",
        language: "typescriptreact",
        content: `import { Asi, html, type FC } from "asijs";

const app = new Asi({ development: true });

const Layout: FC<{ title: string; children: any }> = ({ title, children }) => (
  <html>
    <head><title>{title}</title></head>
    <body>{children}</body>
  </html>
);

app.get("/", (ctx) => ctx.html(
  <Layout title="Workspace">
    <h1>Web Sub-App</h1>
    <p>This runs independently.</p>
  </Layout>
));

app.listen(Number(process.env.PORT ?? 3002), () => {
  console.log("Web sub-app on port", process.env.PORT ?? 3002);
});`,
      },
    ],
  },
];
