/**
 * Fullstack Benchmarks for AsiJS
 *
 * Unlike production.ts which compares bare frameworks,
 * this benchmark loads each framework with real-world plugins
 * that a production app would actually use:
 *
 *   - CORS
 *   - Security Headers (Helmet)
 *   - JWT Authentication
 *   - Rate Limiting
 *   - ETag / Caching
 *   - Validation
 *   - OpenAPI / Swagger docs generation
 *
 * AsiJS has ALL of these built-in.
 * Elysia needs: @elysiajs/cors, @elysiajs/jwt, @elysiajs/bearer,
 *               @elysiajs/swagger, elysia-rate-limit
 * Hono needs:   hono/cors, hono/jwt, hono/bearer-auth,
 *               hono/secure-headers, hono/etag, hono-rate-limiter
 *
 * Run: bun run bench:fullstack
 */

import { Asi, Type, Context } from "../src";
import {
  cors,
  securityHeaders,
  rateLimitMiddlewareFunc,
  jwt as asiJwt,
  etag as asiEtag,
  cacheMiddleware,
  openapi,
} from "../src";
import { cors as honoCors } from "hono/cors";
import { jwt as honoJwtMiddleware, sign as honoSign, verify as honoVerify } from "hono/jwt";
import { secureHeaders } from "hono/secure-headers";
import { etag as honoEtag } from "hono/etag";
import { rateLimiter as honoRateLimiter } from "hono-rate-limiter";
import { Elysia, t } from "elysia";
import { cors as elysiaCors } from "@elysiajs/cors";
import { jwt as elysiaJwt } from "@elysiajs/jwt";
import { bearer as elysiaBearer } from "@elysiajs/bearer";
import { swagger } from "@elysiajs/swagger";
import { rateLimit as elysiaRateLimit } from "elysia-rate-limit";
import { Hono } from "hono";

// CI-aware iteration counts (override with BENCH_ITERATIONS / BENCH_WARMUP)
const ITERATIONS = getEnvNumber(
  "BENCH_ITERATIONS",
  process.env.CI ? 10_000 : 10_000,
);
const WARMUP = getEnvNumber("BENCH_WARMUP", process.env.CI ? 1000 : 1_000);

const JWT_SECRET = "benchmark-secret-key-for-testing-only";

interface BenchResult {
  name: string;
  rps: number;
  avgMs: number;
  totalMs: number;
  errors: number;
}

type RequestFactory = () => Request;

const FIXED_DATE = "2025-01-01T00:00:00.000Z";
const PRODUCT_SEED = 1337;

function getEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

interface ProductStore {
  products: Map<number, any>;
  nextProductId: number;
  seed: number;
}

function createProductStore(seed: number = PRODUCT_SEED): ProductStore {
  return { products: new Map<number, any>(), nextProductId: 1, seed };
}

function seedProducts(store: ProductStore) {
  store.products.clear();
  store.nextProductId = 1;
  const rng = createRng(store.seed);

  for (let i = 0; i < 50; i++) {
    const id = store.nextProductId++;
    store.products.set(id, {
      id,
      name: `Product ${id}`,
      price: +(rng() * 100).toFixed(2),
      category: ["electronics", "books", "clothing"][i % 3],
      inStock: i % 5 !== 0,
      rating: +(1 + rng() * 4).toFixed(1),
    });
  }
}

// ========== Benchmark Runner ==========

async function runBench(
  name: string,
  handler: (req: Request) => Promise<Response>,
  createRequest: RequestFactory,
  iterations: number = ITERATIONS,
): Promise<BenchResult> {
  let errors = 0;

  // Warmup + validation
  for (let i = 0; i < WARMUP; i++) {
    const response = await handler(createRequest());
    if (response.status >= 400) {
      errors++;
      if (errors === 1) {
        const text = await response.text();
        console.error(
          `❌ ${name}: First error - status ${response.status}: ${text.slice(0, 200)}`,
        );
      }
    }
  }

  if (errors > WARMUP / 10) {
    console.error(`⚠️  ${name}: ${errors}/${WARMUP} errors during warmup`);
  }

  errors = 0;

  // Force GC
  if (typeof Bun !== "undefined" && Bun.gc) {
    Bun.gc(true);
  }

  const start = performance.now();

  for (let i = 0; i < iterations; i++) {
    const response = await handler(createRequest());
    if (response.status >= 400) {
      errors++;
    }
  }

  const totalMs = performance.now() - start;
  const avgMs = totalMs / iterations;
  const rps = Math.round(iterations / (totalMs / 1000));

  return { name, rps, avgMs, totalMs, errors };
}

function printResults(testName: string, results: BenchResult[]) {
  console.log(`\n📊 ${testName}`);
  console.log("─".repeat(75));

  for (const r of results) {
    if (r.errors > 0) {
      console.error(`   ⚠️  ${r.name}: ${r.errors} errors!`);
    }
  }

  results.sort((a, b) => b.rps - a.rps);
  const best = results[0].rps;

  for (const r of results) {
    const percent = ((r.rps / best) * 100).toFixed(1);
    const bar = "█".repeat(Math.round(Number(percent) / 5));
    const errMark = r.errors > 0 ? " ⚠️" : "";
    console.log(
      `${r.name.padEnd(32)} ${r.rps.toLocaleString().padStart(10)} req/s ` +
        `(${r.avgMs.toFixed(4)}ms) ${bar} ${percent}%${errMark}`,
    );
  }
}

// ============================================================================
// Pre-sign JWT tokens for benchmarks
// ============================================================================

let asiJwtToken: string;
let elysiaJwtToken: string;
let honoJwtToken: string;

async function setupTokens() {
  // AsiJS JWT — use this as the baseline token
  const asiHelper = asiJwt({ secret: JWT_SECRET });
  asiJwtToken = await asiHelper.sign({ sub: "user123", role: "admin" });

  // Elysia JWT — same HS256 + same secret = compatible token
  elysiaJwtToken = asiJwtToken;

  // Hono JWT — sign with hono's own API for its own verify
  honoJwtToken = await honoSign(
    { sub: "user123", role: "admin", exp: Math.floor(Date.now() / 1000) + 86400 },
    JWT_SECRET,
    "HS256",
  );
}

// ============================================================================
// Benchmark 1: Fully-Loaded GET (CORS + Security + ETag + Rate Limit)
// All middleware active on a simple JSON endpoint
// ============================================================================

function createFullGetAsiApp() {
  const app = new Asi({ development: false });

  // All built-in middleware
  app.use(cors());
  app.use(securityHeaders());
  app.use(asiEtag());
  app.use(cacheMiddleware({ ttl: "5m" }));
  app.use(
    rateLimitMiddlewareFunc({
      max: 100_000,
      windowMs: 60_000,
    }),
  );

  app.get("/api/data", () => ({
    id: 1,
    name: "Test Item",
    tags: ["benchmark", "fullstack"],
    createdAt: "2025-01-01T00:00:00Z",
  }));

  app.compile();
  return app;
}

function createFullGetElysiaApp() {
  return new Elysia()
    .use(elysiaCors())
    .use(
      elysiaRateLimit({
        duration: 60_000,
        max: 100_000,
        generator: () => "global",
      }),
    )
    .get("/api/data", () => ({
      id: 1,
      name: "Test Item",
      tags: ["benchmark", "fullstack"],
      createdAt: "2025-01-01T00:00:00Z",
    }));
}

function createFullGetHonoApp() {
  const app = new Hono();

  app.use("*", honoCors());
  app.use("*", secureHeaders());
  app.use("*", honoEtag());
  app.use(
    "*",
    honoRateLimiter({
      windowMs: 60_000,
      limit: 100_000,
      keyGenerator: () => "global",
    }),
  );

  app.get("/api/data", (c) =>
    c.json({
      id: 1,
      name: "Test Item",
      tags: ["benchmark", "fullstack"],
      createdAt: "2025-01-01T00:00:00Z",
    }),
  );

  return app;
}

async function benchFullGet() {
  const asiApp = createFullGetAsiApp();
  const elysiaApp = createFullGetElysiaApp();
  const honoApp = createFullGetHonoApp();

  const createReq: RequestFactory = () => new Request("http://localhost/api/data");

  const results: BenchResult[] = [];
  results.push(await runBench("AsiJS (all middleware)", (r) => asiApp.handle(r), createReq));
  results.push(await runBench("Elysia (cors+rateLimit)", (r) => elysiaApp.handle(r), createReq));
  results.push(
    await runBench("Hono (cors+sec+etag+rl)", (r) => honoApp.fetch(r), createReq),
  );

  printResults("1. Fully-Loaded GET /api/data", results);
}

// ============================================================================
// Benchmark 2: Authenticated POST with JWT Verify + Validation + CORS
// Simulates a typical protected API write endpoint
// ============================================================================

function createAuthPostAsiApp() {
  const app = new Asi({ development: false });
  const jwtHelper = asiJwt({ secret: JWT_SECRET });

  app.use(cors());
  app.use(securityHeaders());

  // Auth guard as beforeHandle
  const authGuard = async (ctx: Context) => {
    const auth = ctx.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return ctx.status(401).jsonResponse({ error: "Unauthorized" });
    }
    try {
      const payload = await jwtHelper.verify(auth.slice(7));
      ctx.store.user = payload;
    } catch {
      return ctx.status(401).jsonResponse({ error: "Invalid token" });
    }
  };

  app.post(
    "/api/posts",
    (ctx) => {
      const body = ctx.body as { title: string; content: string; tags: string[] };
      return ctx.status(201).jsonResponse({
        id: 42,
        ...body,
        authorId: (ctx.store.user as any)?.sub,
        createdAt: FIXED_DATE,
      });
    },
    {
      beforeHandle: authGuard,
      schema: {
        body: Type.Object({
          title: Type.String({ minLength: 1, maxLength: 200 }),
          content: Type.String({ minLength: 1, maxLength: 10000 }),
          tags: Type.Array(Type.String(), { minItems: 1, maxItems: 10 }),
        }),
      },
    },
  );

  app.compile();
  return app;
}

function createAuthPostElysiaApp() {
  return new Elysia()
    .use(elysiaCors())
    .use(
      elysiaJwt({
        name: "jwt",
        secret: JWT_SECRET,
      }),
    )
    .use(elysiaBearer())
    .post(
      "/api/posts",
      async ({ jwt, bearer, body }) => {
        if (!bearer) {
          throw new Error("Unauthorized");
        }
        const payload = await jwt.verify(bearer);
        if (!payload) {
          throw new Error("Invalid token");
        }
        return {
          id: 42,
          ...body,
          authorId: payload.sub,
          createdAt: FIXED_DATE,
        };
      },
      {
        body: t.Object({
          title: t.String({ minLength: 1, maxLength: 200 }),
          content: t.String({ minLength: 1, maxLength: 10000 }),
          tags: t.Array(t.String(), { minItems: 1, maxItems: 10 }),
        }),
      },
    );
}

function createAuthPostHonoApp() {
  const app = new Hono();

  app.use("*", honoCors());
  app.use("*", secureHeaders());

  app.post("/api/posts", async (c) => {
    // Manual JWT verification (hono/jwt middleware sets jwtPayload)
    const auth = c.req.header("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    try {
      const payload = await honoVerify(auth.slice(7), JWT_SECRET, "HS256");

      const body = await c.req.json();

      // Manual validation
      if (
        !body.title ||
        typeof body.title !== "string" ||
        body.title.length > 200 ||
        !body.content ||
        typeof body.content !== "string" ||
        !Array.isArray(body.tags) ||
        body.tags.length === 0
      ) {
        return c.json({ error: "Validation failed" }, 400);
      }

      return c.json(
        {
          id: 42,
          ...body,
          authorId: payload.sub,
          createdAt: FIXED_DATE,
        },
        201,
      );
    } catch {
      return c.json({ error: "Invalid token" }, 401);
    }
  });

  return app;
}

async function benchAuthPost() {
  const asiApp = createAuthPostAsiApp();
  const elysiaApp = createAuthPostElysiaApp();
  const honoApp = createAuthPostHonoApp();

  const postBody = JSON.stringify({
    title: "Benchmark Results",
    content: "Testing all frameworks with full middleware stack loaded...",
    tags: ["benchmark", "comparison", "fullstack"],
  });

  const createReqAsi: RequestFactory = () =>
    new Request("http://localhost/api/posts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${asiJwtToken}`,
      },
      body: postBody,
    });

  const createReqElysia: RequestFactory = () =>
    new Request("http://localhost/api/posts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${elysiaJwtToken}`,
      },
      body: postBody,
    });

  const createReqHono: RequestFactory = () =>
    new Request("http://localhost/api/posts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${honoJwtToken}`,
      },
      body: postBody,
    });

  const results: BenchResult[] = [];
  results.push(
    await runBench("AsiJS (cors+sec+jwt+val)", (r) => asiApp.handle(r), createReqAsi),
  );
  results.push(
    await runBench("Elysia (cors+jwt+bearer+val)", (r) => elysiaApp.handle(r), createReqElysia),
  );
  results.push(
    await runBench("Hono (cors+sec+jwt+val)", (r) => honoApp.fetch(r), createReqHono),
  );

  printResults("2. Auth POST /api/posts (JWT + Validation + CORS + Security)", results);
}

// ============================================================================
// Benchmark 3: API Gateway Pattern
// CORS + Security + Rate Limit + JWT + ETag + Validation on GET
// Maximum middleware stack that a real API would use
// ============================================================================

function createGatewayAsiApp() {
  const app = new Asi({ development: false });
  const jwtHelper = asiJwt({ secret: JWT_SECRET });

  // Full middleware stack (7 layers)
  app.use(cors({ origin: ["https://app.example.com"], credentials: true }));
  app.use(securityHeaders());
  app.use(rateLimitMiddlewareFunc({ max: 100_000, windowMs: 60_000 }));
  app.use(asiEtag());
  app.use(cacheMiddleware({ ttl: "1m" }));

  const authGuard = async (ctx: Context) => {
    const auth = ctx.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return ctx.status(401).jsonResponse({ error: "Unauthorized" });
    }
    try {
      ctx.store.user = await jwtHelper.verify(auth.slice(7));
    } catch {
      return ctx.status(401).jsonResponse({ error: "Invalid token" });
    }
  };

  app.get(
    "/api/users/:id/profile",
    (ctx) => {
      const userId = ctx.params.id;
      return {
        id: userId,
        name: "John Doe",
        email: "john@example.com",
        role: (ctx.store.user as any)?.role || "user",
        preferences: {
          theme: "dark",
          language: "en",
          notifications: { email: true, push: false, sms: false },
        },
        stats: { posts: 42, followers: 1337, following: 256 },
      };
    },
    {
      beforeHandle: authGuard,
      schema: {
        params: Type.Object({ id: Type.String() }),
      },
    },
  );

  app.compile();
  return app;
}

function createGatewayElysiaApp() {
  return new Elysia()
    .use(elysiaCors({ origin: "https://app.example.com", credentials: true }))
    .use(elysiaRateLimit({ duration: 60_000, max: 100_000, generator: () => "global" }))
    .use(elysiaJwt({ name: "jwt", secret: JWT_SECRET }))
    .use(elysiaBearer())
    .get(
      "/api/users/:id/profile",
      async ({ jwt, bearer, params }) => {
        if (!bearer) throw new Error("Unauthorized");
        const payload = await jwt.verify(bearer);
        if (!payload) throw new Error("Invalid token");

        return {
          id: params.id,
          name: "John Doe",
          email: "john@example.com",
          role: payload.role || "user",
          preferences: {
            theme: "dark",
            language: "en",
            notifications: { email: true, push: false, sms: false },
          },
          stats: { posts: 42, followers: 1337, following: 256 },
        };
      },
      {
        params: t.Object({ id: t.String() }),
      },
    );
}

function createGatewayHonoApp() {
  const app = new Hono();

  app.use("*", honoCors({ origin: "https://app.example.com", credentials: true }));
  app.use("*", secureHeaders());
  app.use(
    "*",
    honoRateLimiter({
      windowMs: 60_000,
      limit: 100_000,
      keyGenerator: () => "global",
    }),
  );
  app.use("*", honoEtag());

  app.get("/api/users/:id/profile", async (c) => {
    const auth = c.req.header("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    try {
      const payload = await honoVerify(auth.slice(7), JWT_SECRET, "HS256");
      const id = c.req.param("id");

      return c.json({
        id,
        name: "John Doe",
        email: "john@example.com",
        role: (payload as any).role || "user",
        preferences: {
          theme: "dark",
          language: "en",
          notifications: { email: true, push: false, sms: false },
        },
        stats: { posts: 42, followers: 1337, following: 256 },
      });
    } catch {
      return c.json({ error: "Invalid token" }, 401);
    }
  });

  return app;
}

async function benchGateway() {
  const asiApp = createGatewayAsiApp();
  const elysiaApp = createGatewayElysiaApp();
  const honoApp = createGatewayHonoApp();

  const createReqAsi: RequestFactory = () =>
    new Request("http://localhost/api/users/42/profile", {
      headers: {
        Authorization: `Bearer ${asiJwtToken}`,
        Origin: "https://app.example.com",
      },
    });

  const createReqElysia: RequestFactory = () =>
    new Request("http://localhost/api/users/42/profile", {
      headers: {
        Authorization: `Bearer ${elysiaJwtToken}`,
        Origin: "https://app.example.com",
      },
    });

  const createReqHono: RequestFactory = () =>
    new Request("http://localhost/api/users/42/profile", {
      headers: {
        Authorization: `Bearer ${honoJwtToken}`,
        Origin: "https://app.example.com",
      },
    });

  const results: BenchResult[] = [];
  results.push(
    await runBench("AsiJS (7-layer stack)", (r) => asiApp.handle(r), createReqAsi),
  );
  results.push(
    await runBench("Elysia (5-plugin stack)", (r) => elysiaApp.handle(r), createReqElysia),
  );
  results.push(
    await runBench("Hono (6-layer stack)", (r) => honoApp.fetch(r), createReqHono),
  );

  printResults("3. API Gateway GET /api/users/:id/profile (max middleware)", results);
}

// ============================================================================
// Benchmark 4: CRUD API with OpenAPI Docs
// Full REST API with validation + JWT + CORS + auto-generated docs
// ============================================================================



function createCrudAsiApp(store: ProductStore) {
  const app = new Asi({ development: false });
  const jwtHelper = asiJwt({ secret: JWT_SECRET });

  app.use(cors());
  app.use(securityHeaders());

  // OpenAPI docs
  app.plugin(
    openapi({
      title: "Product API",
      version: "1.0.0",
      description: "Fullstack benchmark API",
    }),
  );

  const authGuard = async (ctx: Context) => {
    const auth = ctx.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return ctx.status(401).jsonResponse({ error: "Unauthorized" });
    }
    try {
      ctx.store.user = await jwtHelper.verify(auth.slice(7));
    } catch {
      return ctx.status(401).jsonResponse({ error: "Invalid token" });
    }
  };

  // List products with filtering
  app.get(
    "/api/products",
    (ctx) => {
      const category = ctx.query.category;
      const page = parseInt(ctx.query.page || "1", 10);
      const limit = parseInt(ctx.query.limit || "10", 10);
      const offset = (page - 1) * limit;

      let items = Array.from(store.products.values());
      if (category) {
        items = items.filter((p) => p.category === category);
      }
      const paginated = items.slice(offset, offset + limit);

      return {
        products: paginated,
        pagination: { page, limit, total: items.length },
      };
    },
    {
      schema: {
        query: Type.Object({
          category: Type.Optional(Type.String()),
          page: Type.Optional(Type.String()),
          limit: Type.Optional(Type.String()),
        }),
      },
    },
  );

  // Get single product
  app.get(
    "/api/products/:id",
    (ctx) => {
      const product = store.products.get(parseInt(ctx.params.id, 10));
      if (!product) return ctx.status(404).jsonResponse({ error: "Not found" });
      return product;
    },
    {
      schema: { params: Type.Object({ id: Type.String() }) },
    },
  );

  // Create product (auth required)
  app.post(
    "/api/products",
    (ctx) => {
      const body = ctx.body as any;
      const id = store.nextProductId++;
      const product = { id, ...body, rating: 0 };
      store.products.set(id, product);
      return ctx.status(201).jsonResponse(product);
    },
    {
      beforeHandle: authGuard,
      schema: {
        body: Type.Object({
          name: Type.String({ minLength: 1, maxLength: 100 }),
          price: Type.Number({ minimum: 0 }),
          category: Type.String(),
          inStock: Type.Boolean(),
        }),
      },
    },
  );

  // Update product (auth required)
  app.put(
    "/api/products/:id",
    (ctx) => {
      const id = parseInt(ctx.params.id, 10);
      const existing = store.products.get(id);
      if (!existing) return ctx.status(404).jsonResponse({ error: "Not found" });
      const body = ctx.body as any;
      const updated = { ...existing, ...body };
      store.products.set(id, updated);
      return updated;
    },
    {
      beforeHandle: authGuard,
      schema: {
        params: Type.Object({ id: Type.String() }),
        body: Type.Object({
          name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
          price: Type.Optional(Type.Number({ minimum: 0 })),
          category: Type.Optional(Type.String()),
          inStock: Type.Optional(Type.Boolean()),
        }),
      },
    },
  );

  // Delete product (auth required)
  app.delete(
    "/api/products/:id",
    (ctx) => {
      const id = parseInt(ctx.params.id, 10);
      if (!store.products.delete(id)) {
        return ctx.status(404).jsonResponse({ error: "Not found" });
      }
      return { deleted: true };
    },
    {
      beforeHandle: authGuard,
      schema: { params: Type.Object({ id: Type.String() }) },
    },
  );

  app.compile();
  return app;
}

function createCrudElysiaApp(store: ProductStore) {
  return new Elysia()
    .use(elysiaCors())
    .use(elysiaJwt({ name: "jwt", secret: JWT_SECRET }))
    .use(elysiaBearer())
    .use(
      swagger({
        path: "/docs",
        documentation: { info: { title: "Product API", version: "1.0.0" } },
      }),
    )
    .get(
      "/api/products",
      ({ query }) => {
        const page = parseInt(query.page || "1", 10);
        const limit = parseInt(query.limit || "10", 10);
        const offset = (page - 1) * limit;

        let items = Array.from(store.products.values());
        if (query.category) {
          items = items.filter((p: any) => p.category === query.category);
        }
        const paginated = items.slice(offset, offset + limit);
        return { products: paginated, pagination: { page, limit, total: items.length } };
      },
      {
        query: t.Object({
          category: t.Optional(t.String()),
          page: t.Optional(t.String()),
          limit: t.Optional(t.String()),
        }),
      },
    )
    .get(
      "/api/products/:id",
      ({ params }) => {
        const product = store.products.get(parseInt(params.id, 10));
        if (!product) throw new Error("Not found");
        return product;
      },
      { params: t.Object({ id: t.String() }) },
    )
    .post(
      "/api/products",
      async ({ jwt, bearer, body, set }) => {
        if (!bearer) throw new Error("Unauthorized");
        const payload = await jwt.verify(bearer);
        if (!payload) throw new Error("Invalid token");

        const id = store.nextProductId++;
        const product = { id, ...body, rating: 0 };
        store.products.set(id, product);
        set.status = 201;
        return product;
      },
      {
        body: t.Object({
          name: t.String({ minLength: 1, maxLength: 100 }),
          price: t.Number({ minimum: 0 }),
          category: t.String(),
          inStock: t.Boolean(),
        }),
      },
    )
    .put(
      "/api/products/:id",
      async ({ jwt, bearer, params, body }) => {
        if (!bearer) throw new Error("Unauthorized");
        const payload = await jwt.verify(bearer);
        if (!payload) throw new Error("Invalid token");

        const id = parseInt(params.id, 10);
        const existing = store.products.get(id);
        if (!existing) throw new Error("Not found");
        const updated = { ...existing, ...body };
        store.products.set(id, updated);
        return updated;
      },
      {
        params: t.Object({ id: t.String() }),
        body: t.Object({
          name: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
          price: t.Optional(t.Number({ minimum: 0 })),
          category: t.Optional(t.String()),
          inStock: t.Optional(t.Boolean()),
        }),
      },
    )
    .delete(
      "/api/products/:id",
      async ({ jwt, bearer, params }) => {
        if (!bearer) throw new Error("Unauthorized");
        const payload = await jwt.verify(bearer);
        if (!payload) throw new Error("Invalid token");

        const id = parseInt(params.id, 10);
        if (!store.products.delete(id)) throw new Error("Not found");
        return { deleted: true };
      },
      { params: t.Object({ id: t.String() }) },
    );
}

function createCrudHonoApp(store: ProductStore) {
  const app = new Hono();

  app.use("*", honoCors());
  app.use("*", secureHeaders());
  app.use("*", honoEtag());

  // Helper for JWT auth
  const requireAuth = async (c: any): Promise<any | null> => {
    const auth = c.req.header("Authorization");
    if (!auth?.startsWith("Bearer ")) return null;
    try {
      return await honoVerify(auth.slice(7), JWT_SECRET, "HS256");
    } catch {
      return null;
    }
  };

  app.get("/api/products", (c) => {
    const category = c.req.query("category");
    const page = parseInt(c.req.query("page") || "1", 10);
    const limit = parseInt(c.req.query("limit") || "10", 10);
    const offset = (page - 1) * limit;

    let items = Array.from(store.products.values());
    if (category) items = items.filter((p: any) => p.category === category);
    const paginated = items.slice(offset, offset + limit);
    return c.json({ products: paginated, pagination: { page, limit, total: items.length } });
  });

  app.get("/api/products/:id", (c) => {
    const product = store.products.get(parseInt(c.req.param("id"), 10));
    if (!product) return c.json({ error: "Not found" }, 404);
    return c.json(product);
  });

  app.post("/api/products", async (c) => {
    const user = await requireAuth(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    if (!body.name || typeof body.price !== "number" || typeof body.inStock !== "boolean") {
      return c.json({ error: "Validation failed" }, 400);
    }

    const id = store.nextProductId++;
    const product = { id, ...body, rating: 0 };
    store.products.set(id, product);
    return c.json(product, 201);
  });

  app.put("/api/products/:id", async (c) => {
    const user = await requireAuth(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const id = parseInt(c.req.param("id"), 10);
    const existing = store.products.get(id);
    if (!existing) return c.json({ error: "Not found" }, 404);

    const body = await c.req.json();
    const updated = { ...existing, ...body };
    store.products.set(id, updated);
    return c.json(updated);
  });

  app.delete("/api/products/:id", async (c) => {
    const user = await requireAuth(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const id = parseInt(c.req.param("id"), 10);
    if (!store.products.delete(id)) return c.json({ error: "Not found" }, 404);
    return c.json({ deleted: true });
  });

  return app;
}

async function benchCrud() {
  const asiStore = createProductStore();
  const elysiaStore = createProductStore();
  const honoStore = createProductStore();

  const asiApp = createCrudAsiApp(asiStore);
  const elysiaApp = createCrudElysiaApp(elysiaStore);
  const honoApp = createCrudHonoApp(honoStore);

  const resetStores = () => {
    seedProducts(asiStore);
    seedProducts(elysiaStore);
    seedProducts(honoStore);
  };

  // 4a: GET list (no auth needed)
  const createListReq: RequestFactory = () =>
    new Request("http://localhost/api/products?page=2&limit=10&category=electronics");

  resetStores();
  const listResults: BenchResult[] = [];
  listResults.push(
    await runBench("AsiJS (GET list)", (r) => asiApp.handle(r), createListReq),
  );
  listResults.push(
    await runBench("Elysia (GET list)", (r) => elysiaApp.handle(r), createListReq),
  );
  listResults.push(
    await runBench("Hono (GET list)", (r) => honoApp.fetch(r), createListReq),
  );

  printResults("4a. CRUD API - GET /api/products (list + filter + pagination)", listResults);

  // 4b: GET single
  const createGetReq: RequestFactory = () =>
    new Request("http://localhost/api/products/25");

  resetStores();
  const getResults: BenchResult[] = [];
  getResults.push(
    await runBench("AsiJS (GET single)", (r) => asiApp.handle(r), createGetReq),
  );
  getResults.push(
    await runBench("Elysia (GET single)", (r) => elysiaApp.handle(r), createGetReq),
  );
  getResults.push(
    await runBench("Hono (GET single)", (r) => honoApp.fetch(r), createGetReq),
  );

  printResults("4b. CRUD API - GET /api/products/:id", getResults);

  // 4c: POST create (auth required)
  const createPostBody = JSON.stringify({
    name: "New Widget",
    price: 29.99,
    category: "electronics",
    inStock: true,
  });

  const createPostReqAsi: RequestFactory = () =>
    new Request("http://localhost/api/products", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${asiJwtToken}`,
      },
      body: createPostBody,
    });

  const createPostReqElysia: RequestFactory = () =>
    new Request("http://localhost/api/products", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${elysiaJwtToken}`,
      },
      body: createPostBody,
    });

  const createPostReqHono: RequestFactory = () =>
    new Request("http://localhost/api/products", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${honoJwtToken}`,
      },
      body: createPostBody,
    });

  resetStores();
  const postResults: BenchResult[] = [];
  postResults.push(
    await runBench("AsiJS (POST create)", (r) => asiApp.handle(r), createPostReqAsi),
  );
  postResults.push(
    await runBench("Elysia (POST create)", (r) => elysiaApp.handle(r), createPostReqElysia),
  );
  postResults.push(
    await runBench("Hono (POST create)", (r) => honoApp.fetch(r), createPostReqHono),
  );

  printResults("4c. CRUD API - POST /api/products (auth + validation)", postResults);

  // 4d: PUT update (auth required)
  const updateBody = JSON.stringify({
    name: "Updated Widget",
    price: 39.99,
  });

  const createPutReqAsi: RequestFactory = () =>
    new Request("http://localhost/api/products/10", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${asiJwtToken}`,
      },
      body: updateBody,
    });

  const createPutReqElysia: RequestFactory = () =>
    new Request("http://localhost/api/products/10", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${elysiaJwtToken}`,
      },
      body: updateBody,
    });

  const createPutReqHono: RequestFactory = () =>
    new Request("http://localhost/api/products/10", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${honoJwtToken}`,
      },
      body: updateBody,
    });

  resetStores();
  const putResults: BenchResult[] = [];
  putResults.push(
    await runBench("AsiJS (PUT update)", (r) => asiApp.handle(r), createPutReqAsi),
  );
  putResults.push(
    await runBench("Elysia (PUT update)", (r) => elysiaApp.handle(r), createPutReqElysia),
  );
  putResults.push(
    await runBench("Hono (PUT update)", (r) => honoApp.fetch(r), createPutReqHono),
  );

  printResults("4d. CRUD API - PUT /api/products/:id (auth + partial update)", putResults);
}

// ============================================================================
// Benchmark 5: CORS Preflight (OPTIONS)
// Tests how fast frameworks handle preflight requests with full config
// ============================================================================

async function benchPreflight() {
  const asiApp = createFullGetAsiApp();
  const elysiaApp = createFullGetElysiaApp();
  const honoApp = createFullGetHonoApp();

  const createReq: RequestFactory = () =>
    new Request("http://localhost/api/data", {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.example.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type, Authorization",
      },
    });

  const results: BenchResult[] = [];
  results.push(await runBench("AsiJS (preflight)", (r) => asiApp.handle(r), createReq));
  results.push(await runBench("Elysia (preflight)", (r) => elysiaApp.handle(r), createReq));
  results.push(await runBench("Hono (preflight)", (r) => honoApp.fetch(r), createReq));

  printResults("5. CORS Preflight OPTIONS /api/data", results);
}

// ============================================================================
// Benchmark 6: Security Headers Overhead
// Compares the cost of adding comprehensive security headers
// ============================================================================

function createSecurityOnlyAsiApp() {
  const app = new Asi({ development: false });
  app.use(securityHeaders());
  app.get("/api/ping", () => ({ pong: true }));
  app.compile();
  return app;
}

function createSecurityOnlyHonoApp() {
  const app = new Hono();
  app.use("*", secureHeaders());
  app.get("/api/ping", (c) => c.json({ pong: true }));
  return app;
}

function createBareAsiApp() {
  const app = new Asi({ development: false });
  app.get("/api/ping", () => ({ pong: true }));
  app.compile();
  return app;
}

function createBareElysiaApp() {
  return new Elysia().get("/api/ping", () => ({ pong: true }));
}

function createBareHonoApp() {
  const app = new Hono();
  app.get("/api/ping", (c) => c.json({ pong: true }));
  return app;
}

async function benchSecurityHeaders() {
  // Bare vs with security headers
  const bareAsi = createBareAsiApp();
  const secAsi = createSecurityOnlyAsiApp();
  const bareElysia = createBareElysiaApp();
  const secHono = createSecurityOnlyHonoApp();
  const bareHono = createBareHonoApp();

  const createReq: RequestFactory = () => new Request("http://localhost/api/ping");

  const results: BenchResult[] = [];
  results.push(await runBench("AsiJS (bare)", (r) => bareAsi.handle(r), createReq));
  results.push(await runBench("AsiJS + securityHeaders", (r) => secAsi.handle(r), createReq));
  results.push(await runBench("Elysia (bare, no helmet)", (r) => bareElysia.handle(r), createReq));
  results.push(await runBench("Hono (bare)", (r) => bareHono.fetch(r), createReq));
  results.push(await runBench("Hono + secureHeaders", (r) => secHono.fetch(r), createReq));

  printResults("6. Security Headers Overhead (bare vs helmet)", results);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log("🏭 AsiJS Fullstack Benchmarks");
  console.log(`   Iterations: ${ITERATIONS.toLocaleString()}`);
  console.log(`   Warmup: ${WARMUP.toLocaleString()}`);
  console.log("   Each framework loaded with real-world plugins (CORS, JWT, Rate Limit, etc.)");
  console.log("═".repeat(75));

  await setupTokens();

  await benchFullGet();
  await benchAuthPost();
  await benchGateway();
  await benchCrud();
  await benchPreflight();
  await benchSecurityHeaders();

  console.log(`\n✅ Fullstack Benchmarks complete!\n`);
  console.log("📝 Notes:");
  console.log("   - AsiJS: ALL features built-in (zero external dependencies)");
  console.log("   - Elysia: @elysiajs/cors, @elysiajs/jwt, @elysiajs/bearer,");
  console.log("             @elysiajs/swagger, elysia-rate-limit");
  console.log("   - Hono:   hono/cors, hono/jwt, hono/secure-headers,");
  console.log("             hono/etag, hono-rate-limiter");
  console.log("   - Each framework configured with equivalent middleware stacks");
  console.log("   - JWT tokens pre-signed to isolate request handling performance");
}

main()
  .then(() => {
    if (typeof process !== "undefined" && process.exit) {
      process.exit(0);
    }
  })
  .catch((error) => {
    console.error(error);
    if (typeof process !== "undefined" && process.exit) {
      process.exit(1);
    }
  });
