/**
 * Example: Basic REST API with AsiJS
 * 
 * Demonstrates:
 * - Basic routing (GET, POST, PUT, DELETE)
 * - Route parameters
 * - Query parameters
 * - JSON responses
 * - TypeBox validation
 * 
 * Run: bun run examples/basic-api.ts
 */

import { Asi, Type } from "../src";

const app = new Asi({ development: true });

// In-memory "database"
interface User {
  id: number;
  name: string;
  email: string;
  createdAt: Date;
}

const users: Map<number, User> = new Map();
let nextId = 1;

// ===== Routes =====

// GET / - Welcome message
app.get("/", () => ({
  message: "Welcome to AsiJS Basic API",
  version: "1.0.0",
  endpoints: [
    "GET /users - List all users",
    "GET /users/:id - Get user by ID",
    "POST /users - Create user",
    "PUT /users/:id - Update user",
    "DELETE /users/:id - Delete user",
  ],
}));

// GET /users - List all users with optional filtering
app.get("/users", (ctx) => {
  const { limit, offset, search } = ctx.query;
  
  let result = Array.from(users.values());
  
  // Search by name
  if (search) {
    result = result.filter(u => 
      u.name.toLowerCase().includes(search.toLowerCase())
    );
  }
  
  // Pagination
  const start = offset ? parseInt(offset) : 0;
  const end = limit ? start + parseInt(limit) : result.length;
  
  return {
    data: result.slice(start, end),
    total: result.length,
    limit: limit ? parseInt(limit) : null,
    offset: start,
  };
}, {
  query: Type.Object({
    limit: Type.Optional(Type.String()),
    offset: Type.Optional(Type.String()),
    search: Type.Optional(Type.String()),
  }),
});

// GET /users/:id - Get user by ID
app.get("/users/:id", (ctx) => {
  const id = parseInt(ctx.params.id);
  const user = users.get(id);
  
  if (!user) {
    return ctx.status(404).jsonResponse({
      error: "User not found",
      id,
    });
  }
  
  return user;
}, {
  params: Type.Object({
    id: Type.String(),
  }),
});

// POST /users - Create new user
app.post("/users", async (ctx) => {
  const body = ctx.validatedBody as { name: string; email: string };
  
  // Check for duplicate email
  const existing = Array.from(users.values()).find(u => u.email === body.email);
  if (existing) {
    return ctx.status(400).jsonResponse({
      error: "Email already exists",
    });
  }
  
  const user: User = {
    id: nextId++,
    name: body.name,
    email: body.email,
    createdAt: new Date(),
  };
  
  users.set(user.id, user);
  
  return ctx.status(201).jsonResponse(user);
}, {
  body: Type.Object({
    name: Type.String({ minLength: 1, maxLength: 100 }),
    email: Type.String({ format: "email" }),
  }),
});

// PUT /users/:id - Update user
app.put("/users/:id", async (ctx) => {
  const id = parseInt(ctx.params.id);
  const user = users.get(id);
  
  if (!user) {
    return ctx.status(404).jsonResponse({
      error: "User not found",
    });
  }
  
  const body = ctx.validatedBody as { name: string; email: string };
  
  user.name = body.name;
  user.email = body.email;
  
  return user;
}, {
  params: Type.Object({
    id: Type.String(),
  }),
  body: Type.Object({
    name: Type.String({ minLength: 1, maxLength: 100 }),
    email: Type.String({ format: "email" }),
  }),
});

// DELETE /users/:id - Delete user
app.delete("/users/:id", (ctx) => {
  const id = parseInt(ctx.params.id);
  const user = users.get(id);
  
  if (!user) {
    return ctx.status(404).jsonResponse({
      error: "User not found",
    });
  }
  
  users.delete(id);
  
  return ctx.status(204).jsonResponse(null);
}, {
  params: Type.Object({
    id: Type.String(),
  }),
});

// ===== Start Server =====

app.listen(3000, () => {
  console.log("\n📚 Try these commands:");
  console.log("  curl http://localhost:3000/");
  console.log("  curl http://localhost:3000/users");
  console.log('  curl -X POST http://localhost:3000/users -H "Content-Type: application/json" -d \'{"name":"John","email":"john@example.com"}\'');
  console.log("  curl http://localhost:3000/users/1");
  console.log("");
});
