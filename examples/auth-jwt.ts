/**
 * Example: JWT Authentication
 * 
 * Demonstrates:
 * - User registration with password hashing
 * - Login with JWT token generation
 * - Protected routes with bearer middleware
 * - Token refresh
 * 
 * Run: bun run examples/auth-jwt.ts
 */

import { 
  Asi, 
  Type, 
  jwt, 
  bearer, 
  hashPassword, 
  verifyPassword,
  generateToken,
} from "../src";

const app = new Asi({ development: true });

// Secret key for JWT (in production, use environment variable!)
const JWT_SECRET = "your-super-secret-key-change-in-production";

// In-memory user storage
interface User {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
}

const users: Map<string, User> = new Map();

// JWT helper
const jwtHelper = jwt({ secret: JWT_SECRET, expiresIn: "1h" });

// ===== Public Routes =====

app.get("/", () => ({
  message: "Auth API with JWT",
  endpoints: {
    public: [
      "POST /register - Create account",
      "POST /login - Get JWT token",
    ],
    protected: [
      "GET /me - Get current user",
      "POST /refresh - Refresh token",
    ],
  },
}));

// Register new user
app.post("/register", async (ctx) => {
  const { email, password, name } = ctx.validatedBody as {
    email: string;
    password: string;
    name: string;
  };
  
  // Check if user exists
  if (users.has(email)) {
    return ctx.status(400).jsonResponse({
      error: "User already exists",
    });
  }
  
  // Hash password using Bun.password
  const passwordHash = await hashPassword(password);
  
  // Create user
  const user: User = {
    id: generateToken(16),
    email,
    passwordHash,
    name,
  };
  
  users.set(email, user);
  
  // Generate token
  const token = await jwtHelper.sign({ 
    sub: user.id, 
    email: user.email,
  });
  
  return ctx.status(201).jsonResponse({
    message: "User created successfully",
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
    token,
  });
}, {
  body: Type.Object({
    email: Type.String({ format: "email" }),
    password: Type.String({ minLength: 8 }),
    name: Type.String({ minLength: 1 }),
  }),
});

// Login
app.post("/login", async (ctx) => {
  const { email, password } = ctx.validatedBody as {
    email: string;
    password: string;
  };
  
  // Find user
  const user = users.get(email);
  if (!user) {
    return ctx.status(401).jsonResponse({
      error: "Invalid credentials",
    });
  }
  
  // Verify password
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return ctx.status(401).jsonResponse({
      error: "Invalid credentials",
    });
  }
  
  // Generate token
  const token = await jwtHelper.sign({
    sub: user.id,
    email: user.email,
  });
  
  return {
    message: "Login successful",
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
  };
}, {
  body: Type.Object({
    email: Type.String({ format: "email" }),
    password: Type.String(),
  }),
});

// ===== Protected Routes =====

// Apply bearer middleware to /me and /refresh
const authMiddleware = bearer({
  secret: JWT_SECRET,
  onError: (ctx) => {
    return ctx.status(401).jsonResponse({
      error: "Unauthorized",
      message: "Valid JWT token required",
    });
  },
});

// Get current user
app.get("/me", async (ctx) => {
  // Token is verified, get payload
  const authHeader = ctx.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");
  
  if (!token) {
    return ctx.status(401).jsonResponse({ error: "No token" });
  }
  
  const payload = await jwtHelper.verify(token);
  const user = Array.from(users.values()).find(u => u.id === payload.sub);
  
  if (!user) {
    return ctx.status(404).jsonResponse({ error: "User not found" });
  }
  
  return {
    id: user.id,
    email: user.email,
    name: user.name,
  };
}, {
  beforeHandle: authMiddleware,
});

// Refresh token
app.post("/refresh", async (ctx) => {
  const authHeader = ctx.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");
  
  if (!token) {
    return ctx.status(401).jsonResponse({ error: "No token" });
  }
  
  try {
    const payload = await jwtHelper.verify(token);
    
    // Generate new token
    const newToken = await jwtHelper.sign({
      sub: payload.sub,
      email: payload.email,
    });
    
    return {
      message: "Token refreshed",
      token: newToken,
    };
  } catch {
    return ctx.status(401).jsonResponse({ error: "Invalid token" });
  }
}, {
  beforeHandle: authMiddleware,
});

// ===== Start Server =====

app.listen(3000, () => {
  console.log("\n📚 Try these commands:");
  console.log('  # Register');
  console.log('  curl -X POST http://localhost:3000/register -H "Content-Type: application/json" -d \'{"email":"test@example.com","password":"password123","name":"Test User"}\'');
  console.log("");
  console.log('  # Login');
  console.log('  curl -X POST http://localhost:3000/login -H "Content-Type: application/json" -d \'{"email":"test@example.com","password":"password123"}\'');
  console.log("");
  console.log('  # Get current user (replace TOKEN)');
  console.log('  curl http://localhost:3000/me -H "Authorization: Bearer TOKEN"');
  console.log("");
});
