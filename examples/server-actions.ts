/**
 * Example: Server Functions / Server Actions
 * 
 * Demonstrates:
 * - Type-safe server actions (Next.js / Remix style)
 * - Input validation with TypeBox
 * - Action middleware (auth, rate limit, logging)
 * - Batch action calls
 * - Form actions
 * 
 * Run: bun run examples/server-actions.ts
 */

import { Type } from "@sinclair/typebox";
import {
  Asi,
  action,
  simpleAction,
  registerActions,
  registerBatchActions,
  formAction,
  ActionError,
  requireAuth,
  actionRateLimit,
  actionLogger,
  type ActionsClient,
} from "../src";

const app = new Asi({ development: true });

// ===== Mock Database =====

interface User {
  id: number;
  name: string;
  email: string;
  role: "user" | "admin";
}

interface Todo {
  id: number;
  userId: number;
  title: string;
  completed: boolean;
}

const users: User[] = [
  { id: 1, name: "Admin", email: "admin@example.com", role: "admin" },
  { id: 2, name: "John", email: "john@example.com", role: "user" },
];

const todos: Todo[] = [
  { id: 1, userId: 1, title: "Build AsiJS", completed: true },
  { id: 2, userId: 1, title: "Write docs", completed: false },
  { id: 3, userId: 2, title: "Learn AsiJS", completed: false },
];

let nextUserId = 3;
let nextTodoId = 4;

// ===== Mock Auth =====

function getUser(ctx: any): User | null {
  const authHeader = ctx.header("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  
  const userId = parseInt(authHeader.slice(7));
  return users.find(u => u.id === userId) || null;
}

// ===== Define Actions =====

const actions = {
  // Simple action - get all users
  getUsers: simpleAction(async () => {
    return users.map(u => ({ id: u.id, name: u.name, email: u.email }));
  }),

  // Action with validation
  createUser: action(
    Type.Object({
      name: Type.String({ minLength: 1, maxLength: 100 }),
      email: Type.String({ format: "email" }),
      role: Type.Optional(Type.Union([
        Type.Literal("user"),
        Type.Literal("admin"),
      ])),
    }),
    async (input) => {
      // Check if email exists
      if (users.find(u => u.email === input.email)) {
        throw new ActionError("Email already exists", "EMAIL_EXISTS", 400);
      }

      const user: User = {
        id: nextUserId++,
        name: input.name,
        email: input.email,
        role: input.role || "user",
      };

      users.push(user);
      return user;
    }
  ),

  // Action with middleware
  deleteUser: action(
    Type.Object({ id: Type.Number() }),
    async ({ id }, ctx) => {
      const currentUser = (ctx as any).user as User;
      
      // Only admins can delete
      if (currentUser.role !== "admin") {
        throw new ActionError("Only admins can delete users", "FORBIDDEN", 403);
      }

      const index = users.findIndex(u => u.id === id);
      if (index === -1) {
        throw new ActionError("User not found", "NOT_FOUND", 404);
      }

      users.splice(index, 1);
      return { success: true, deletedId: id };
    },
    {
      middleware: [requireAuth(getUser)],
    }
  ),

  // Todo actions with auth
  getTodos: action(
    Type.Object({
      userId: Type.Optional(Type.Number()),
      completed: Type.Optional(Type.Boolean()),
    }),
    async (input, ctx) => {
      let filtered = todos;

      if (input.userId !== undefined) {
        filtered = filtered.filter(t => t.userId === input.userId);
      }

      if (input.completed !== undefined) {
        filtered = filtered.filter(t => t.completed === input.completed);
      }

      return filtered;
    }
  ),

  createTodo: action(
    Type.Object({
      title: Type.String({ minLength: 1, maxLength: 200 }),
    }),
    async (input, ctx) => {
      const user = (ctx as any).user as User;

      const todo: Todo = {
        id: nextTodoId++,
        userId: user.id,
        title: input.title,
        completed: false,
      };

      todos.push(todo);
      return todo;
    },
    {
      middleware: [
        requireAuth(getUser),
        actionRateLimit(10, 60000), // 10 per minute
        actionLogger(),
      ],
    }
  ),

  toggleTodo: action(
    Type.Object({ id: Type.Number() }),
    async ({ id }, ctx) => {
      const user = (ctx as any).user as User;
      const todo = todos.find(t => t.id === id);

      if (!todo) {
        throw new ActionError("Todo not found", "NOT_FOUND", 404);
      }

      // Check ownership (admins can toggle any)
      if (todo.userId !== user.id && user.role !== "admin") {
        throw new ActionError("Not authorized", "FORBIDDEN", 403);
      }

      todo.completed = !todo.completed;
      return todo;
    },
    {
      middleware: [requireAuth(getUser)],
    }
  ),

  deleteTodo: action(
    Type.Object({ id: Type.Number() }),
    async ({ id }, ctx) => {
      const user = (ctx as any).user as User;
      const index = todos.findIndex(t => t.id === id);

      if (index === -1) {
        throw new ActionError("Todo not found", "NOT_FOUND", 404);
      }

      const todo = todos[index];
      if (todo.userId !== user.id && user.role !== "admin") {
        throw new ActionError("Not authorized", "FORBIDDEN", 403);
      }

      todos.splice(index, 1);
      return { success: true };
    },
    {
      middleware: [requireAuth(getUser)],
    }
  ),

  // Stats action
  getStats: simpleAction(async () => {
    return {
      totalUsers: users.length,
      totalTodos: todos.length,
      completedTodos: todos.filter(t => t.completed).length,
      pendingTodos: todos.filter(t => !t.completed).length,
    };
  }),
};

// ===== Register Actions =====

const client = registerActions(app, actions, {
  prefix: "/api/actions",
  onError: (error, actionName, ctx) => {
    console.error(`Action ${actionName} failed:`, error.message);
    
    if (error instanceof ActionError) {
      return ctx.status(error.status).jsonResponse(error.toJSON());
    }
    
    return ctx.status(500).jsonResponse({
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    });
  },
});

// Register batch endpoint
registerBatchActions(app, actions, { prefix: "/api/actions" });

// ===== Form Action Example =====

const contactForm = formAction(
  Type.Object({
    name: Type.String({ minLength: 1 }),
    email: Type.String({ format: "email" }),
    message: Type.String({ minLength: 10 }),
  }),
  async (input, ctx) => {
    console.log("Contact form submitted:", input);
    // In real app: send email, save to DB, etc.
    return { success: true };
  },
  {
    redirectOnSuccess: "/?message=sent",
    redirectOnError: "/?error=failed",
  }
);

app.post("/api/contact", contactForm.formHandler);

// ===== Demo Page =====

app.get("/", (ctx) => {
  return ctx.html(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Server Actions Demo</title>
      <style>
        body { font-family: system-ui; max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
        h1 { color: #333; }
        pre { background: #f5f5f5; padding: 1rem; border-radius: 8px; overflow-x: auto; }
        code { font-family: 'Fira Code', monospace; font-size: 14px; }
        .endpoint { background: #e3f2fd; padding: 0.5rem 1rem; margin: 0.5rem 0; border-radius: 4px; }
        .method { color: #1976d2; font-weight: bold; }
        button { padding: 0.5rem 1rem; margin: 0.25rem; cursor: pointer; }
      </style>
    </head>
    <body>
      <h1>🚀 Server Actions Demo</h1>
      
      <h2>Available Actions</h2>
      
      <div class="endpoint">
        <span class="method">POST</span> /api/actions/getUsers
      </div>
      <div class="endpoint">
        <span class="method">POST</span> /api/actions/createUser
      </div>
      <div class="endpoint">
        <span class="method">POST</span> /api/actions/deleteUser (requires auth)
      </div>
      <div class="endpoint">
        <span class="method">POST</span> /api/actions/getTodos
      </div>
      <div class="endpoint">
        <span class="method">POST</span> /api/actions/createTodo (requires auth)
      </div>
      <div class="endpoint">
        <span class="method">POST</span> /api/actions/toggleTodo (requires auth)
      </div>
      <div class="endpoint">
        <span class="method">POST</span> /api/actions/deleteTodo (requires auth)
      </div>
      <div class="endpoint">
        <span class="method">POST</span> /api/actions/getStats
      </div>
      <div class="endpoint">
        <span class="method">POST</span> /api/actions/__batch (batch multiple actions)
      </div>
      
      <h2>Try It Out</h2>
      
      <button onclick="getUsers()">Get Users</button>
      <button onclick="getStats()">Get Stats</button>
      <button onclick="createUser()">Create User</button>
      <button onclick="getTodos()">Get Todos</button>
      <button onclick="createTodo()">Create Todo (auth)</button>
      <button onclick="batchActions()">Batch Actions</button>
      
      <pre id="output"></pre>
      
      <h2>Example Code</h2>
      <pre><code>// Define actions
const actions = {
  createUser: action(
    Type.Object({
      name: Type.String(),
      email: Type.String({ format: "email" }),
    }),
    async (input) => {
      const user = await db.users.create(input);
      return user;
    }
  ),
};

// Register with app
const client = registerActions(app, actions);

// Call from client (type-safe!)
const user = await client.createUser({
  name: "John",
  email: "john@example.com",
});</code></pre>
      
      <script>
        const output = document.getElementById('output');
        
        async function callAction(name, input = {}, auth = null) {
          const headers = { 'Content-Type': 'application/json' };
          if (auth) headers['Authorization'] = 'Bearer ' + auth;
          
          const res = await fetch('/api/actions/' + name, {
            method: 'POST',
            headers,
            body: JSON.stringify(input),
          });
          
          const data = await res.json();
          output.textContent = JSON.stringify(data, null, 2);
          return data;
        }
        
        function getUsers() { callAction('getUsers'); }
        function getStats() { callAction('getStats'); }
        function createUser() { 
          const name = prompt('Name:', 'Test User');
          const email = prompt('Email:', 'test@example.com');
          if (name && email) callAction('createUser', { name, email }); 
        }
        function getTodos() { callAction('getTodos', {}); }
        function createTodo() {
          const title = prompt('Todo title:', 'My new todo');
          if (title) callAction('createTodo', { title }, '1');
        }
        
        async function batchActions() {
          const res = await fetch('/api/actions/__batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([
              { action: 'getUsers', input: {} },
              { action: 'getStats', input: {} },
              { action: 'getTodos', input: { completed: false } },
            ]),
          });
          const data = await res.json();
          output.textContent = JSON.stringify(data, null, 2);
        }
      </script>
    </body>
    </html>
  `);
});

// ===== Start Server =====

app.listen(3000, () => {
  console.log("\n🚀 Server Actions Example");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");
  console.log("📡 Demo: http://localhost:3000");
  console.log("");
  console.log("📚 Actions:");
  console.log("   POST /api/actions/getUsers");
  console.log("   POST /api/actions/createUser");
  console.log("   POST /api/actions/deleteUser  (auth: Bearer {userId})");
  console.log("   POST /api/actions/getTodos");
  console.log("   POST /api/actions/createTodo  (auth required)");
  console.log("   POST /api/actions/toggleTodo  (auth required)");
  console.log("   POST /api/actions/deleteTodo  (auth required)");
  console.log("   POST /api/actions/getStats");
  console.log("   POST /api/actions/__batch     (batch multiple)");
  console.log("");
  console.log("🔑 Auth header: Authorization: Bearer 1 (admin) or Bearer 2 (user)");
  console.log("");
  console.log("📝 Example calls:");
  console.log('   curl -X POST http://localhost:3000/api/actions/getUsers');
  console.log('   curl -X POST http://localhost:3000/api/actions/createUser \\');
  console.log('        -H "Content-Type: application/json" \\');
  console.log('        -d \'{"name":"Test","email":"test@test.com"}\'');
  console.log("");
});

// ===== Client Usage Example (for reference) =====

// This is how you would use the typed client:
async function clientExample() {
  // Get all users
  const users = await client.getUsers({});
  console.log("Users:", users);

  // Create a user
  const newUser = await client.createUser({
    name: "Jane",
    email: "jane@example.com",
  });
  console.log("Created:", newUser);

  // Get todos
  const todos = await client.getTodos({ completed: false });
  console.log("Pending todos:", todos);

  // Get stats
  const stats = await client.getStats({});
  console.log("Stats:", stats);
}
