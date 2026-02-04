/**
 * Example: OpenAPI Documentation + Rate Limiting
 * 
 * Demonstrates:
 * - OpenAPI/Swagger auto-generation
 * - Swagger UI at /docs
 * - Rate limiting
 * - Security headers
 * 
 * Run: bun run examples/openapi-ratelimit.ts
 */

import { 
  Asi, 
  Type, 
  openapi, 
  rateLimit,
  security,
  cors,
  standardLimit,
} from "../src";

const app = new Asi({ development: true });

// ===== Plugins =====

// CORS
app.plugin(cors());

// Security headers
app.plugin(security());

// OpenAPI documentation at /docs
app.plugin(openapi({
  title: "Pet Store API",
  version: "1.0.0",
  description: "A sample Pet Store API with OpenAPI documentation",
  contact: {
    name: "API Support",
    email: "support@example.com",
  },
}));

// Rate limiting (100 requests per minute)
app.plugin(rateLimit(standardLimit));

// ===== Data =====

interface Pet {
  id: number;
  name: string;
  species: "dog" | "cat" | "bird" | "fish";
  age: number;
}

const pets: Map<number, Pet> = new Map([
  [1, { id: 1, name: "Buddy", species: "dog", age: 3 }],
  [2, { id: 2, name: "Whiskers", species: "cat", age: 5 }],
  [3, { id: 3, name: "Tweety", species: "bird", age: 1 }],
]);
let nextId = 4;

// ===== Routes =====

// Health check
app.get("/health", () => ({ status: "ok", timestamp: new Date().toISOString() }));

// List all pets
app.get("/pets", (ctx) => {
  const { species, limit } = ctx.validatedQuery as { species?: string; limit?: number };
  
  let result = Array.from(pets.values());
  
  if (species) {
    result = result.filter(p => p.species === species);
  }
  
  if (limit) {
    result = result.slice(0, limit);
  }
  
  return { data: result, total: result.length };
}, {
  query: Type.Object({
    species: Type.Optional(Type.Union([
      Type.Literal("dog"),
      Type.Literal("cat"),
      Type.Literal("bird"),
      Type.Literal("fish"),
    ])),
    limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
  }),
});

// Get pet by ID
app.get("/pets/:id", (ctx) => {
  const id = ctx.validatedParams.id as number;
  const pet = pets.get(id);
  
  if (!pet) {
    return ctx.status(404).jsonResponse({ error: "Pet not found" });
  }
  
  return pet;
}, {
  params: Type.Object({
    id: Type.Number(),
  }),
});

// Create pet
app.post("/pets", async (ctx) => {
  const body = ctx.validatedBody as Omit<Pet, "id">;
  
  const pet: Pet = {
    id: nextId++,
    ...body,
  };
  
  pets.set(pet.id, pet);
  
  return ctx.status(201).jsonResponse(pet);
}, {
  body: Type.Object({
    name: Type.String({ minLength: 1, maxLength: 50 }),
    species: Type.Union([
      Type.Literal("dog"),
      Type.Literal("cat"),
      Type.Literal("bird"),
      Type.Literal("fish"),
    ]),
    age: Type.Number({ minimum: 0, maximum: 100 }),
  }),
});

// Update pet
app.put("/pets/:id", async (ctx) => {
  const id = ctx.validatedParams.id as number;
  const pet = pets.get(id);
  
  if (!pet) {
    return ctx.status(404).jsonResponse({ error: "Pet not found" });
  }
  
  const body = ctx.validatedBody as Omit<Pet, "id">;
  const updated = { ...pet, ...body };
  pets.set(id, updated);
  
  return updated;
}, {
  params: Type.Object({
    id: Type.Number(),
  }),
  body: Type.Object({
    name: Type.String({ minLength: 1, maxLength: 50 }),
    species: Type.Union([
      Type.Literal("dog"),
      Type.Literal("cat"),
      Type.Literal("bird"),
      Type.Literal("fish"),
    ]),
    age: Type.Number({ minimum: 0, maximum: 100 }),
  }),
});

// Delete pet
app.delete("/pets/:id", (ctx) => {
  const id = ctx.validatedParams.id as number;
  
  if (!pets.has(id)) {
    return ctx.status(404).jsonResponse({ error: "Pet not found" });
  }
  
  pets.delete(id);
  return ctx.status(204).jsonResponse(null);
}, {
  params: Type.Object({
    id: Type.Number(),
  }),
});

// ===== Start Server =====

app.listen(3000, () => {
  console.log("\n📚 Features:");
  console.log("  🔗 Swagger UI: http://localhost:3000/docs");
  console.log("  🔒 Rate limiting: 100 requests/minute");
  console.log("  🛡️  Security headers enabled");
  console.log("");
  console.log("📚 Try these commands:");
  console.log("  curl http://localhost:3000/pets");
  console.log("  curl http://localhost:3000/pets/1");
  console.log('  curl -X POST http://localhost:3000/pets -H "Content-Type: application/json" -d \'{"name":"Rex","species":"dog","age":2}\'');
  console.log("");
});
