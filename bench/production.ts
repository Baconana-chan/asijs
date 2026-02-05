/**
 * Production-Oriented Benchmarks for AsiJS
 * 
 * These benchmarks test real-world scenarios:
 * 1. Middleware Overhead - 5 middleware chain
 * 2. Complex Validation - deeply nested objects
 * 3. File Upload / Multipart Parsing - 1MB and 5MB files
 * 4. Static File Serving - large files
 * 5. JSX / HTML Rendering - 100 element list
 * 6. Scenario Benchmark - "Blog API"
 * 
 * Run: bun run bench:production
 */

import { Asi, Type, Context } from "../src";
import { jsx, renderToString } from "../src/jsx";
import { staticFiles } from "../src/plugins/static";
import { Elysia, t } from "elysia";
import { Hono } from "hono";
import { writeFileSync, mkdirSync, existsSync, rmSync } from "fs";

const ITERATIONS = 10_000;
const WARMUP = 1_000;

interface BenchResult {
  name: string;
  rps: number;
  avgMs: number;
  totalMs: number;
  errors: number;
}

type RequestFactory = () => Request;

// ========== Benchmark Runner ==========

async function runBench(
  name: string,
  handler: (req: Request) => Promise<Response>,
  createRequest: RequestFactory,
  iterations: number = ITERATIONS
): Promise<BenchResult> {
  let errors = 0;

  // Warmup + validation
  for (let i = 0; i < WARMUP; i++) {
    const response = await handler(createRequest());
    if (response.status >= 400) {
      errors++;
      if (errors === 1) {
        const text = await response.text();
        console.error(`❌ ${name}: First error - status ${response.status}: ${text.slice(0, 100)}`);
      }
    }
  }

  if (errors > WARMUP / 10) {
    console.error(`⚠️  ${name}: ${errors}/${WARMUP} errors during warmup`);
  }

  errors = 0;

  // Force GC before benchmark
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
      `${r.name.padEnd(28)} ${r.rps.toLocaleString().padStart(10)} req/s ` +
        `(${r.avgMs.toFixed(4)}ms) ${bar} ${percent}%${errMark}`
    );
  }
}

// ============================================================================
// Benchmark 1: Middleware Overhead
// ============================================================================

function createMiddlewareAsiApp() {
  const app = new Asi({ development: false });

  // Use app.use() for global middleware chain
  app.use(async (ctx, next) => {
    ctx.store.mw1 = true;
    return next();
  });
  app.use(async (ctx, next) => {
    ctx.store.mw2 = true;
    return next();
  });
  app.use(async (ctx, next) => {
    ctx.store.mw3 = true;
    return next();
  });
  app.use(async (ctx, next) => {
    ctx.store.mw4 = true;
    return next();
  });
  app.use(async (ctx, next) => {
    ctx.store.mw5 = true;
    return next();
  });

  app.get("/", (ctx) => ({
    message: "Hello",
    mw: [ctx.store.mw1, ctx.store.mw2, ctx.store.mw3, ctx.store.mw4, ctx.store.mw5],
  }));

  app.compile();
  return app;
}

function createMiddlewareElysiaApp() {
  const app = new Elysia()
    .derive(() => ({ mw1: true }))
    .derive(() => ({ mw2: true }))
    .derive(() => ({ mw3: true }))
    .derive(() => ({ mw4: true }))
    .derive(() => ({ mw5: true }))
    .get("/", ({ mw1, mw2, mw3, mw4, mw5 }) => ({
      message: "Hello",
      mw: [mw1, mw2, mw3, mw4, mw5],
    }));
  return app;
}

function createMiddlewareHonoApp() {
  const app = new Hono();

  app.use("*", async (c, next) => {
    c.set("mw1", true);
    await next();
  });
  app.use("*", async (c, next) => {
    c.set("mw2", true);
    await next();
  });
  app.use("*", async (c, next) => {
    c.set("mw3", true);
    await next();
  });
  app.use("*", async (c, next) => {
    c.set("mw4", true);
    await next();
  });
  app.use("*", async (c, next) => {
    c.set("mw5", true);
    await next();
  });

  app.get("/", (c) =>
    c.json({
      message: "Hello",
      mw: [c.get("mw1"), c.get("mw2"), c.get("mw3"), c.get("mw4"), c.get("mw5")],
    })
  );

  return app;
}

async function benchMiddleware() {
  const asiApp = createMiddlewareAsiApp();
  const elysiaApp = createMiddlewareElysiaApp();
  const honoApp = createMiddlewareHonoApp();

  const createReq: RequestFactory = () => new Request("http://localhost/");

  const results: BenchResult[] = [];
  results.push(await runBench("AsiJS (5 middleware)", (r) => asiApp.handle(r), createReq));
  results.push(await runBench("Elysia (5 derive)", (r) => elysiaApp.handle(r), createReq));
  results.push(await runBench("Hono (5 middleware)", (r) => honoApp.fetch(r), createReq));

  printResults("1. Middleware Overhead (5 middleware chain)", results);
}

// ============================================================================
// Benchmark 2: Complex Validation
// ============================================================================

const COMPLEX_BODY = JSON.stringify({
  user: {
    name: "John Doe",
    email: "john@example.com",
    profile: {
      age: 30,
      address: {
        street: "123 Main St",
        city: "New York",
        country: "USA",
        zipCode: "10001",
      },
      preferences: {
        theme: "dark",
        notifications: true,
        language: "en",
      },
    },
  },
  posts: [
    { title: "First Post", content: "Hello World", tags: ["intro", "hello"] },
    { title: "Second Post", content: "More content", tags: ["update"] },
    { title: "Third Post", content: "Even more", tags: ["news", "tech", "ai"] },
  ],
  metadata: {
    createdAt: "2026-02-05T12:00:00Z",
    updatedAt: "2026-02-05T12:00:00Z",
    version: 1,
  },
});

function createComplexValidationAsiApp() {
  const app = new Asi({ development: false });

  const schema = Type.Object({
    user: Type.Object({
      name: Type.String(),
      email: Type.String({ format: "email" }),
      profile: Type.Object({
        age: Type.Number({ minimum: 0, maximum: 150 }),
        address: Type.Object({
          street: Type.String(),
          city: Type.String(),
          country: Type.String(),
          zipCode: Type.String(),
        }),
        preferences: Type.Object({
          theme: Type.Union([Type.Literal("dark"), Type.Literal("light")]),
          notifications: Type.Boolean(),
          language: Type.String(),
        }),
      }),
    }),
    posts: Type.Array(
      Type.Object({
        title: Type.String(),
        content: Type.String(),
        tags: Type.Array(Type.String()),
      })
    ),
    metadata: Type.Object({
      createdAt: Type.String(),
      updatedAt: Type.String(),
      version: Type.Number(),
    }),
  });

  app.post("/entity", (ctx) => ({ success: true, data: ctx.body }), {
    schema: { body: schema },
  });

  app.compile();
  return app;
}

function createComplexValidationElysiaApp() {
  const app = new Elysia().post(
    "/entity",
    ({ body }) => ({ success: true, data: body }),
    {
      body: t.Object({
        user: t.Object({
          name: t.String(),
          email: t.String({ format: "email" }),
          profile: t.Object({
            age: t.Number({ minimum: 0, maximum: 150 }),
            address: t.Object({
              street: t.String(),
              city: t.String(),
              country: t.String(),
              zipCode: t.String(),
            }),
            preferences: t.Object({
              theme: t.Union([t.Literal("dark"), t.Literal("light")]),
              notifications: t.Boolean(),
              language: t.String(),
            }),
          }),
        }),
        posts: t.Array(
          t.Object({
            title: t.String(),
            content: t.String(),
            tags: t.Array(t.String()),
          })
        ),
        metadata: t.Object({
          createdAt: t.String(),
          updatedAt: t.String(),
          version: t.Number(),
        }),
      }),
    }
  );
  return app;
}

async function benchComplexValidation() {
  const asiApp = createComplexValidationAsiApp();
  const elysiaApp = createComplexValidationElysiaApp();

  const createReq: RequestFactory = () =>
    new Request("http://localhost/entity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: COMPLEX_BODY,
    });

  const results: BenchResult[] = [];
  results.push(
    await runBench("AsiJS (complex validation)", (r) => asiApp.handle(r), createReq, ITERATIONS / 2)
  );
  results.push(
    await runBench("Elysia (complex validation)", (r) => elysiaApp.handle(r), createReq, ITERATIONS / 2)
  );

  printResults("2. Complex Validation (4-level nested object)", results);
}

// ============================================================================
// Benchmark 3: File Upload / Multipart Parsing
// ============================================================================

function createFileUploadAsiApp() {
  const app = new Asi({ development: false });

  app.post("/upload", async (ctx) => {
    const formData = await ctx.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return ctx.status(400).jsonResponse({ error: "No file" });
    }
    return {
      success: true,
      name: file.name,
      size: file.size,
      type: file.type,
    };
  });

  app.compile();
  return app;
}

function createFileUploadHonoApp() {
  const app = new Hono();

  app.post("/upload", async (c) => {
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return c.json({ error: "No file" }, 400);
    }
    return c.json({
      success: true,
      name: file.name,
      size: file.size,
      type: file.type,
    });
  });

  return app;
}

function createFileUploadElysiaApp() {
  const app = new Elysia().post("/upload", async ({ request }) => {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return { error: "No file" };
    }
    return {
      success: true,
      name: file.name,
      size: file.size,
      type: file.type,
    };
  });
  return app;
}

function createFormData(sizeBytes: number): FormData {
  // Create random content
  const content = new Uint8Array(sizeBytes);
  for (let i = 0; i < sizeBytes; i++) {
    content[i] = Math.floor(Math.random() * 256);
  }

  const file = new File([content], "test-file.bin", {
    type: "application/octet-stream",
  });

  const formData = new FormData();
  formData.append("file", file);
  return formData;
}

async function benchFileUpload() {
  const asiApp = createFileUploadAsiApp();
  const elysiaApp = createFileUploadElysiaApp();
  const honoApp = createFileUploadHonoApp();

  // Cache FormData for each size
  const formData1MB = createFormData(1024 * 1024);
  const formData5MB = createFormData(5 * 1024 * 1024);

  // 1MB file
  const createReq1MB: RequestFactory = () =>
    new Request("http://localhost/upload", {
      method: "POST",
      body: formData1MB,
    });

  // Reduced iterations for large files
  const fileIterations = 1000;

  const results1MB: BenchResult[] = [];
  results1MB.push(
    await runBench("AsiJS (1MB)", (r) => asiApp.handle(r), createReq1MB, fileIterations)
  );
  results1MB.push(
    await runBench("Elysia (1MB)", (r) => elysiaApp.handle(r), createReq1MB, fileIterations)
  );
  results1MB.push(
    await runBench("Hono (1MB)", (r) => honoApp.fetch(r), createReq1MB, fileIterations)
  );

  printResults("3a. File Upload (1MB multipart)", results1MB);

  // 5MB file
  const createReq5MB: RequestFactory = () =>
    new Request("http://localhost/upload", {
      method: "POST",
      body: formData5MB,
    });

  const results5MB: BenchResult[] = [];
  results5MB.push(
    await runBench("AsiJS (5MB)", (r) => asiApp.handle(r), createReq5MB, fileIterations / 5)
  );
  results5MB.push(
    await runBench("Elysia (5MB)", (r) => elysiaApp.handle(r), createReq5MB, fileIterations / 5)
  );
  results5MB.push(
    await runBench("Hono (5MB)", (r) => honoApp.fetch(r), createReq5MB, fileIterations / 5)
  );

  printResults("3b. File Upload (5MB multipart)", results5MB);
}

// ============================================================================
// Benchmark 4: Static File Serving
// ============================================================================

const STATIC_DIR = "./bench/.static-test";

function setupStaticFiles() {
  // Create test directory
  if (!existsSync(STATIC_DIR)) {
    mkdirSync(STATIC_DIR, { recursive: true });
  }

  // Create 2MB file
  const content2MB = new Uint8Array(2 * 1024 * 1024);
  for (let i = 0; i < content2MB.length; i++) {
    content2MB[i] = Math.floor(Math.random() * 256);
  }
  writeFileSync(`${STATIC_DIR}/large-file.bin`, content2MB);

  // Create small file
  writeFileSync(`${STATIC_DIR}/small.txt`, "Hello World!");
}

function cleanupStaticFiles() {
  if (existsSync(STATIC_DIR)) {
    rmSync(STATIC_DIR, { recursive: true, force: true });
  }
}

function createStaticAsiApp() {
  const app = new Asi({ development: false });
  app.use(staticFiles(STATIC_DIR, { prefix: "/static" }));
  app.compile();
  return app;
}

function createStaticHonoApp() {
  const app = new Hono();
  // Hono doesn't have built-in static file serving in fetch mode
  // We'll use a manual implementation
  app.get("/static/*", async (c) => {
    const path = c.req.path.replace("/static/", "");
    const file = Bun.file(`${STATIC_DIR}/${path}`);
    if (await file.exists()) {
      return new Response(file);
    }
    return c.notFound();
  });
  return app;
}

async function benchStaticFiles() {
  setupStaticFiles();

  try {
    const asiApp = createStaticAsiApp();
    const honoApp = createStaticHonoApp();

    // Small file
    const createSmallReq: RequestFactory = () =>
      new Request("http://localhost/static/small.txt");

    const resultsSmall: BenchResult[] = [];
    resultsSmall.push(
      await runBench("AsiJS (small)", (r) => asiApp.handle(r), createSmallReq)
    );
    resultsSmall.push(
      await runBench("Hono (small)", (r) => honoApp.fetch(r), createSmallReq)
    );

    printResults("4a. Static File Serving (small file)", resultsSmall);

    // Large file
    const createLargeReq: RequestFactory = () =>
      new Request("http://localhost/static/large-file.bin");

    const resultsLarge: BenchResult[] = [];
    resultsLarge.push(
      await runBench("AsiJS (2MB)", (r) => asiApp.handle(r), createLargeReq, 1000)
    );
    resultsLarge.push(
      await runBench("Hono (2MB)", (r) => honoApp.fetch(r), createLargeReq, 1000)
    );

    printResults("4b. Static File Serving (2MB file)", resultsLarge);
  } finally {
    cleanupStaticFiles();
  }
}

// ============================================================================
// Benchmark 5: JSX / HTML Rendering
// ============================================================================

interface Item {
  id: number;
  name: string;
  description: string;
  price: number;
  inStock: boolean;
}

const ITEMS: Item[] = Array.from({ length: 100 }, (_, i) => ({
  id: i + 1,
  name: `Product ${i + 1}`,
  description: `This is the description for product ${i + 1}`,
  price: Math.round(Math.random() * 10000) / 100,
  inStock: Math.random() > 0.3,
}));

// AsiJS JSX Component
function ProductTable({ items }: { items: Item[] }) {
  return jsx(
    "html",
    null,
    jsx(
      "head",
      null,
      jsx("title", null, "Products")
    ),
    jsx(
      "body",
      null,
      jsx("h1", null, "Product List"),
      jsx(
        "table",
        { border: "1" },
        jsx(
          "thead",
          null,
          jsx(
            "tr",
            null,
            jsx("th", null, "ID"),
            jsx("th", null, "Name"),
            jsx("th", null, "Description"),
            jsx("th", null, "Price"),
            jsx("th", null, "In Stock")
          )
        ),
        jsx(
          "tbody",
          null,
          ...items.map((item) =>
            jsx(
              "tr",
              { key: item.id },
              jsx("td", null, String(item.id)),
              jsx("td", null, item.name),
              jsx("td", null, item.description),
              jsx("td", null, `$${item.price.toFixed(2)}`),
              jsx("td", null, item.inStock ? "Yes" : "No")
            )
          )
        )
      )
    )
  );
}

function createJsxAsiApp() {
  const app = new Asi({ development: false });

  app.get("/products", () => {
    const vdom = ProductTable({ items: ITEMS });
    const html = renderToString(vdom);
    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  });

  app.compile();
  return app;
}

// Manual HTML for comparison (string template)
function createStringTemplateAsiApp() {
  const app = new Asi({ development: false });

  app.get("/products", () => {
    const rows = ITEMS.map(
      (item) => `<tr>
        <td>${item.id}</td>
        <td>${item.name}</td>
        <td>${item.description}</td>
        <td>$${item.price.toFixed(2)}</td>
        <td>${item.inStock ? "Yes" : "No"}</td>
      </tr>`
    ).join("");

    const html = `<!DOCTYPE html>
<html>
<head><title>Products</title></head>
<body>
  <h1>Product List</h1>
  <table border="1">
    <thead>
      <tr><th>ID</th><th>Name</th><th>Description</th><th>Price</th><th>In Stock</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;

    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  });

  app.compile();
  return app;
}

function createJsxHonoApp() {
  const app = new Hono();

  app.get("/products", (c) => {
    // Hono has its own JSX but let's use string for fair comparison
    const rows = ITEMS.map(
      (item) => `<tr>
        <td>${item.id}</td>
        <td>${item.name}</td>
        <td>${item.description}</td>
        <td>$${item.price.toFixed(2)}</td>
        <td>${item.inStock ? "Yes" : "No"}</td>
      </tr>`
    ).join("");

    const html = `<!DOCTYPE html>
<html>
<head><title>Products</title></head>
<body>
  <h1>Product List</h1>
  <table border="1">
    <thead>
      <tr><th>ID</th><th>Name</th><th>Description</th><th>Price</th><th>In Stock</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;

    return c.html(html);
  });

  return app;
}

async function benchJsxRendering() {
  const asiJsxApp = createJsxAsiApp();
  const asiStringApp = createStringTemplateAsiApp();
  const honoApp = createJsxHonoApp();

  const createReq: RequestFactory = () =>
    new Request("http://localhost/products");

  const results: BenchResult[] = [];
  results.push(
    await runBench("AsiJS (JSX + renderToString)", (r) => asiJsxApp.handle(r), createReq)
  );
  results.push(
    await runBench("AsiJS (string template)", (r) => asiStringApp.handle(r), createReq)
  );
  results.push(
    await runBench("Hono (string template)", (r) => honoApp.fetch(r), createReq)
  );

  printResults("5. JSX / HTML Rendering (100-row table)", results);
}

// ============================================================================
// Benchmark 6: Scenario Benchmark - Blog API
// ============================================================================

// Simulated database
const posts = new Map<number, { id: number; title: string; content: string; authorId: number }>();
let nextPostId = 1;

// Initialize some posts
for (let i = 1; i <= 100; i++) {
  posts.set(i, {
    id: i,
    title: `Post Title ${i}`,
    content: `This is the content of post ${i}. Lorem ipsum dolor sit amet.`,
    authorId: (i % 10) + 1,
  });
  nextPostId = i + 1;
}

function createBlogAsiApp() {
  const app = new Asi({ development: false });

  // Auth guard (for beforeHandle)
  const authGuard = async (ctx: Context) => {
    const auth = ctx.headers.get("Authorization");
    if (!auth || !auth.startsWith("Bearer ")) {
      return ctx.status(401).jsonResponse({ error: "Unauthorized" });
    }
    ctx.store.userId = 1; // Simulated user
    // Return undefined to continue - don't call next()
  };

  // GET /posts with pagination
  app.get(
    "/posts",
    (ctx) => {
      const page = parseInt(ctx.query.page || "1", 10);
      const limit = parseInt(ctx.query.limit || "10", 10);
      const offset = (page - 1) * limit;

      const allPosts = Array.from(posts.values());
      const paginated = allPosts.slice(offset, offset + limit);

      return {
        posts: paginated,
        pagination: {
          page,
          limit,
          total: allPosts.length,
          totalPages: Math.ceil(allPosts.length / limit),
        },
      };
    },
    {
      schema: {
        query: Type.Object({
          page: Type.Optional(Type.String()),
          limit: Type.Optional(Type.String()),
        }),
      },
    }
  );

  // GET /posts/:id
  app.get(
    "/posts/:id",
    (ctx) => {
      const id = parseInt(ctx.params.id, 10);
      const post = posts.get(id);

      if (!post) {
        return ctx.status(404).jsonResponse({ error: "Post not found" });
      }

      return post;
    },
    {
      schema: {
        params: Type.Object({ id: Type.String() }),
      },
    }
  );

  // POST /posts (with auth + validation)
  app.post(
    "/posts",
    (ctx) => {
      const body = ctx.body as { title: string; content: string };
      const id = nextPostId++;

      const post = {
        id,
        title: body.title,
        content: body.content,
        authorId: ctx.store.userId as number,
      };

      posts.set(id, post);

      return ctx.status(201).jsonResponse(post);
    },
    {
      beforeHandle: authGuard,
      schema: {
        body: Type.Object({
          title: Type.String({ minLength: 1, maxLength: 200 }),
          content: Type.String({ minLength: 1 }),
        }),
      },
    }
  );

  app.compile();
  return app;
}

function createBlogElysiaApp() {
  const app = new Elysia()
    .get(
      "/posts",
      ({ query }) => {
        const page = parseInt(query.page || "1", 10);
        const limit = parseInt(query.limit || "10", 10);
        const offset = (page - 1) * limit;

        const allPosts = Array.from(posts.values());
        const paginated = allPosts.slice(offset, offset + limit);

        return {
          posts: paginated,
          pagination: {
            page,
            limit,
            total: allPosts.length,
            totalPages: Math.ceil(allPosts.length / limit),
          },
        };
      },
      {
        query: t.Object({
          page: t.Optional(t.String()),
          limit: t.Optional(t.String()),
        }),
      }
    )
    .get(
      "/posts/:id",
      ({ params, error }) => {
        const id = parseInt(params.id, 10);
        const post = posts.get(id);

        if (!post) {
          return error(404, { error: "Post not found" });
        }

        return post;
      },
      {
        params: t.Object({ id: t.String() }),
      }
    )
    .post(
      "/posts",
      ({ body, headers, error }) => {
        const auth = headers.authorization;
        if (!auth || !auth.startsWith("Bearer ")) {
          return error(401, { error: "Unauthorized" });
        }

        const id = nextPostId++;
        const post = {
          id,
          title: body.title,
          content: body.content,
          authorId: 1,
        };

        posts.set(id, post);
        return post;
      },
      {
        body: t.Object({
          title: t.String({ minLength: 1, maxLength: 200 }),
          content: t.String({ minLength: 1 }),
        }),
      }
    );

  return app;
}

function createBlogHonoApp() {
  const app = new Hono();

  app.get("/posts", (c) => {
    const page = parseInt(c.req.query("page") || "1", 10);
    const limit = parseInt(c.req.query("limit") || "10", 10);
    const offset = (page - 1) * limit;

    const allPosts = Array.from(posts.values());
    const paginated = allPosts.slice(offset, offset + limit);

    return c.json({
      posts: paginated,
      pagination: {
        page,
        limit,
        total: allPosts.length,
        totalPages: Math.ceil(allPosts.length / limit),
      },
    });
  });

  app.get("/posts/:id", (c) => {
    const id = parseInt(c.req.param("id"), 10);
    const post = posts.get(id);

    if (!post) {
      return c.json({ error: "Post not found" }, 404);
    }

    return c.json(post);
  });

  app.post("/posts", async (c) => {
    const auth = c.req.header("Authorization");
    if (!auth || !auth.startsWith("Bearer ")) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const body = (await c.req.json()) as { title: string; content: string };
    const id = nextPostId++;

    const post = {
      id,
      title: body.title,
      content: body.content,
      authorId: 1,
    };

    posts.set(id, post);
    return c.json(post, 201);
  });

  return app;
}

async function benchBlogApi() {
  const asiApp = createBlogAsiApp();
  const elysiaApp = createBlogElysiaApp();
  const honoApp = createBlogHonoApp();

  // GET /posts (list with pagination)
  const createListReq: RequestFactory = () =>
    new Request("http://localhost/posts?page=1&limit=10");

  const resultsList: BenchResult[] = [];
  resultsList.push(
    await runBench("AsiJS (GET /posts)", (r) => asiApp.handle(r), createListReq)
  );
  resultsList.push(
    await runBench("Elysia (GET /posts)", (r) => elysiaApp.handle(r), createListReq)
  );
  resultsList.push(
    await runBench("Hono (GET /posts)", (r) => honoApp.fetch(r), createListReq)
  );

  printResults("6a. Blog API - GET /posts (list + pagination)", resultsList);

  // GET /posts/:id
  const createDetailReq: RequestFactory = () =>
    new Request("http://localhost/posts/42");

  const resultsDetail: BenchResult[] = [];
  resultsDetail.push(
    await runBench("AsiJS (GET /posts/:id)", (r) => asiApp.handle(r), createDetailReq)
  );
  resultsDetail.push(
    await runBench("Elysia (GET /posts/:id)", (r) => elysiaApp.handle(r), createDetailReq)
  );
  resultsDetail.push(
    await runBench("Hono (GET /posts/:id)", (r) => honoApp.fetch(r), createDetailReq)
  );

  printResults("6b. Blog API - GET /posts/:id (single post)", resultsDetail);

  // POST /posts (with auth + validation)
  const createPostReq: RequestFactory = () =>
    new Request("http://localhost/posts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
      body: JSON.stringify({
        title: "New Post Title",
        content: "This is the content of the new post.",
      }),
    });

  const resultsCreate: BenchResult[] = [];
  resultsCreate.push(
    await runBench("AsiJS (POST /posts)", (r) => asiApp.handle(r), createPostReq)
  );
  resultsCreate.push(
    await runBench("Elysia (POST /posts)", (r) => elysiaApp.handle(r), createPostReq)
  );
  resultsCreate.push(
    await runBench("Hono (POST /posts)", (r) => honoApp.fetch(r), createPostReq)
  );

  printResults("6c. Blog API - POST /posts (auth + validation)", resultsCreate);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log("🏭 AsiJS Production Benchmarks");
  console.log(`   Iterations: ${ITERATIONS.toLocaleString()}`);
  console.log(`   Warmup: ${WARMUP.toLocaleString()}`);
  console.log("═".repeat(75));

  await benchMiddleware();
  await benchComplexValidation();
  await benchFileUpload();
  await benchStaticFiles();
  await benchJsxRendering();
  await benchBlogApi();

  console.log("\n✅ Production Benchmarks complete!");
  console.log("\n📝 Notes:");
  console.log("   - Middleware test: 5 middleware chain passing context");
  console.log("   - Validation test: 4-level nested object with arrays");
  console.log("   - File upload: FormData parsing (1MB and 5MB)");
  console.log("   - Static files: Small and large file serving");
  console.log("   - JSX: 100-row table rendering (JSX vs string template)");
  console.log("   - Blog API: Real-world CRUD with auth and validation");
}

main().catch(console.error);
