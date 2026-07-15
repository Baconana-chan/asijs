/**
 * Tests for Codemod — Automatic Migration from Elysia / Hono / Fastify
 *
 * Tests cover:
 * - Detection: framework auto-detection from source code
 * - Elysia → AsiJS transformations (imports, routes, plugins, schema)
 * - Hono → AsiJS transformations (c.* → ctx.*, imports, schema)
 * - Fastify → AsiJS transformations (reply.* → ctx.*, imports, schema)
 * - Migration pipeline: runCodemod on files and directories
 * - Edge cases: no changes needed, mixed frameworks, invalid input
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";

import {
  detectFramework,
  detectProjectFramework,
  transformSource,
  migrateFile,
  runCodemod,
  printSummary,
  type SourceFramework,
  type CodemodOptions,
} from "../src/codemod";

// ========================================================================
// Helpers
// ========================================================================

const TMP_ROOT = join(tmpdir(), "asijs-codemod-test");

function tmpPath(...parts: string[]) {
  return join(TMP_ROOT, ...parts);
}

function writeTestFile(relPath: string, content: string) {
  const fullPath = tmpPath(relPath);
  const dir = dirname(fullPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(fullPath, content, "utf-8");
}

function readTestFile(relPath: string): string {
  return readFileSync(tmpPath(relPath), "utf-8");
}

// ========================================================================
// Framework Detection
// ========================================================================

describe("detectFramework()", () => {
  it("detects Elysia from import", () => {
    expect(detectFramework(`import { Elysia } from "elysia"`)).toBe("elysia");
  });

  it("detects Elysia from Elysia + t import", () => {
    expect(detectFramework(`import { Elysia, t } from "elysia"`)).toBe("elysia");
  });

  it("detects Elysia from plugin import", () => {
    expect(detectFramework(`import { cors } from "@elysiajs/cors"`)).toBe("elysia");
  });

  it("detects Elysia from rate-limit", () => {
    expect(detectFramework(`import { rateLimit } from "elysia-rate-limit"`)).toBe("elysia");
  });

  it("detects Hono from import", () => {
    expect(detectFramework(`import { Hono } from "hono"`)).toBe("hono");
  });

  it("detects Hono from sub-import", () => {
    expect(detectFramework(`import { cors } from "hono/cors"`)).toBe("hono");
  });

  it("detects Hono from @hono/* import", () => {
    expect(detectFramework(`import { swaggerUI } from "@hono/swagger-ui"`)).toBe("hono");
  });

  it("detects Fastify from import", () => {
    expect(detectFramework(`import fastify from "fastify"`)).toBe("fastify");
  });

  it("detects Fastify from require", () => {
    expect(detectFramework(`const fastify = require("fastify")`)).toBe("fastify");
  });

  it("returns null for AsiJS source", () => {
    expect(detectFramework(`import { Asi } from "asijs"`)).toBeNull();
  });

  it("returns null for plain TypeScript", () => {
    expect(detectFramework(`const x = 42;`)).toBeNull();
  });
});

describe("detectProjectFramework()", () => {
  beforeEach(() => {
    if (!existsSync(TMP_ROOT)) mkdirSync(TMP_ROOT, { recursive: true });
  });

  afterEach(() => {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  it("detects Elysia from src/index.ts", () => {
    writeTestFile("elysia-project/src/index.ts", `import { Elysia, t } from "elysia";`);
    expect(detectProjectFramework(tmpPath("elysia-project"))).toBe("elysia");
  });

  it("detects Hono from package.json sibling", () => {
    writeTestFile("hono-project/index.ts", `import { Hono } from "hono";`);
    expect(detectProjectFramework(tmpPath("hono-project"))).toBe("hono");
  });

  it("detects Fastify from src/app.ts", () => {
    writeTestFile("fastify-project/src/app.ts", `import fastify from "fastify";`);
    expect(detectProjectFramework(tmpPath("fastify-project"))).toBe("fastify");
  });

  it("detects Fastify from require pattern", () => {
    writeTestFile("fastify-req/src/index.js", `const fastify = require("fastify");`);
    expect(detectProjectFramework(tmpPath("fastify-req"))).toBe("fastify");
  });

  it("returns null for non-framework project", () => {
    writeTestFile("plain/src/index.ts", `console.log("hello");`);
    expect(detectProjectFramework(tmpPath("plain"))).toBeNull();
  });

  it("returns null for empty directory", () => {
    mkdirSync(tmpPath("empty", "src"), { recursive: true });
    expect(detectProjectFramework(tmpPath("empty"))).toBeNull();
  });
});

// ========================================================================
// Elysia → AsiJS
// ========================================================================

describe("transformSource() — Elysia → AsiJS", () => {
  it("updates Elysia import to Asi + TypeBox", () => {
    const { result, applied } = transformSource(
      `import { Elysia, t } from "elysia";`,
      "elysia",
    );
    expect(result).toContain(`import { Asi } from "asijs"`);
    expect(result).toContain(`import { Type } from "@sinclair/typebox"`);
    expect(applied.length).toBeGreaterThan(0);
  });

  it("transforms new Elysia() to new Asi()", () => {
    const { result } = transformSource(`const app = new Elysia();`, "elysia");
    expect(result).toContain(`new Asi()`);
  });

  it("splits chained method calls", () => {
    const source = `app.get("/", () => "ok")\n  .post("/data", (ctx) => ctx.body)\n  .listen(3000);`;
    const { result } = transformSource(source, "elysia");
    expect(result).toContain(`app.get`);
    expect(result).toContain(`app.post`);
    expect(result).toContain(`app.listen`);
    expect(result.split("app.").length - 1).toBeGreaterThanOrEqual(3);
  });

  it("transforms t.* to Type.*", () => {
    const { result } = transformSource(
      `t.Object({ name: t.String(), age: t.Number(), active: t.Boolean() })`,
      "elysia",
    );
    expect(result).toContain(`Type.Object`);
    expect(result).toContain(`Type.String`);
    expect(result).toContain(`Type.Number`);
    expect(result).toContain(`Type.Boolean`);
    expect(result).not.toContain(`t.Object`);
    expect(result).not.toContain(`t.String`);
  });

  it("transforms Elysia plugin imports", () => {
    const source = [
      `import { cors } from "@elysiajs/cors";`,
      `import { jwt } from "@elysiajs/jwt";`,
      `import { swagger } from "@elysiajs/swagger";`,
      `import { bearer } from "@elysiajs/bearer";`,
      `import { rateLimit } from "elysia-rate-limit";`,
    ].join("\n");
    const { result } = transformSource(source, "elysia");
    expect(result).toContain(`import { cors } from "asijs"`);
    expect(result).toContain(`import { jwt } from "asijs"`);
    expect(result).toContain(`import { openapi } from "asijs"`);
    expect(result).toContain(`import { bearer } from "asijs"`);
    expect(result).toContain(`import { rateLimit } from "asijs"`);
  });

  it("transforms .use() to .plugin()", () => {
    const { result } = transformSource(`app.use(cors())`, "elysia");
    expect(result).toContain(`app.plugin(cors())`);
  });

  it("transforms .derive() to .before()", () => {
    const { result } = transformSource(`app.derive((ctx) => {})`, "elysia");
    expect(result).toContain(`app.before((ctx) => {})`);
  });

  it("transforms .onError()", () => {
    const { result } = transformSource(`app.onError((ctx) => {})`, "elysia");
    expect(result).toContain(`app.onError((ctx) => {})`);
  });

  it("transforms destructured context params", () => {
    const source = `app.get("/", ({ body, params, set }) => { set.status = 200; })`;
    const { result } = transformSource(source, "elysia");
    expect(result).toContain(`(ctx, next)`);
  });

  it("transforms set.status = N to ctx.status(N)", () => {
    const { result } = transformSource(`set.status = 404;`, "elysia");
    expect(result).toContain(`ctx.status(404)`);
  });

  it("processes a complete Elysia file", () => {
    const source = `import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";

const app = new Elysia();

app.use(cors());
app.use(swagger());

app.get("/", () => "Hello");
app.get("/users/:id", ({ params: { id } }) => ({ id, name: "Test" }), {
  params: t.Object({ id: t.String() }),
});

app.listen(3000);`;

    const { result, applied } = transformSource(source, "elysia");
    expect(result).toContain(`import { Asi } from "asijs"`);
    expect(result).toContain(`import { Type } from "@sinclair/typebox"`);
    expect(result).toContain(`import { cors } from "asijs"`);
    expect(result).toContain(`import { openapi } from "asijs"`);
    expect(result).toContain(`new Asi()`);
    expect(result).toContain(`app.plugin(cors())`);
    expect(result).toContain(`app.plugin(openapi())`);
    expect(result).toContain(`app.listen(3000)`);
    expect(applied.length).toBeGreaterThanOrEqual(5);
  });
});

// ========================================================================
// Hono → AsiJS
// ========================================================================

describe("transformSource() — Hono → AsiJS", () => {
  it("updates Hono import to Asi", () => {
    const { result } = transformSource(`import { Hono } from "hono"`, "hono");
    expect(result).toContain(`import { Asi } from "asijs"`);
  });

  it("transforms new Hono() to new Asi()", () => {
    const { result } = transformSource(`const app = new Hono();`, "hono");
    expect(result).toContain(`new Asi()`);
  });

  it("transforms c.text() to return string", () => {
    const { result } = transformSource(`c.text("Hello World")`, "hono");
    expect(result).not.toContain(`c.text("Hello World")`);
  });

  it("transforms c.json() to return object", () => {
    const { result } = transformSource(`c.json({ ok: true })`, "hono");
    expect(result).not.toContain(`c.json({ ok: true })`);
  });

  it("transforms c.html() to ctx.html()", () => {
    const { result } = transformSource(`c.html(<h1>Hi</h1>)`, "hono");
    expect(result).toContain(`ctx.html(`);
  });

  it("transforms c.redirect() to ctx.redirect()", () => {
    const { result } = transformSource(`c.redirect("/login")`, "hono");
    expect(result).toContain(`ctx.redirect(`);
  });

  it("transforms c.req.param() to ctx.params", () => {
    const { result } = transformSource(`c.req.param("id")`, "hono");
    expect(result).toContain(`ctx.params.id`);
  });

  it("transforms c.req.query() to ctx.query", () => {
    const { result } = transformSource(`c.req.query("page")`, "hono");
    expect(result).toContain(`ctx.query.page`);
  });

  it("transforms c.req.header() to ctx.header()", () => {
    const { result } = transformSource(`c.req.header("authorization")`, "hono");
    expect(result).toContain(`ctx.header(`);
  });

  it("transforms await c.req.json() to await ctx.body()", () => {
    const { result } = transformSource(`const data = await c.req.json();`, "hono");
    expect(result).toContain(`await ctx.body()`);
  });

  it("transforms c.status() to ctx.status()", () => {
    const { result } = transformSource(`c.status(200)`, "hono");
    expect(result).toContain(`ctx.status(`);
  });

  it("transforms c.header() to ctx.setHeader()", () => {
    const { result } = transformSource(`c.header("X-Custom", "val")`, "hono");
    expect(result).toContain(`ctx.setHeader(`);
  });

  it("transforms c.get() and c.set()", () => {
    const { result } = transformSource(
      `c.set("user", user); const u = c.get("user");`,
      "hono",
    );
    expect(result).toContain(`(ctx as any).user = user`);
    expect(result).toContain(`(ctx as any).user`);
  });

  it("transforms Hono plugin imports", () => {
    const source = [
      `import { cors } from "hono/cors";`,
      `import { jwt } from "hono/jwt";`,
      `import { logger } from "hono/logger";`,
      `import { etag } from "hono/etag";`,
      `import { bearerAuth } from "hono/bearer-auth";`,
    ].join("\n");
    const { result } = transformSource(source, "hono");
    expect(result).toContain(`import { cors } from "asijs"`);
    expect(result).toContain(`import { jwt } from "asijs"`);
    expect(result).toContain(`import { devMode } from "asijs"`);
    expect(result).toContain(`import { etag } from "asijs"`);
    expect(result).toContain(`import { bearer } from "asijs"`);
  });

  it("transforms export default app to app.listen() comment", () => {
    const { result } = transformSource(`app.get("/", () => "ok");\nexport default app;`, "hono");
    expect(result).not.toContain(`export default app;`);
    expect(result).toContain(`app.listen(3000)`);
  });

  it("transforms Zod validators to TypeBox", () => {
    const { result } = transformSource(
      `z.object({ name: z.string(), age: z.number() })`,
      "hono",
    );
    expect(result).toContain(`Type.Object`);
    expect(result).toContain(`Type.String`);
    expect(result).toContain(`Type.Number`);
  });

  it("processes a complete Hono file", () => {
    const source = `import { Hono } from "hono";
import { cors } from "hono/cors";

const app = new Hono();

app.use("/*", cors());

app.get("/", (c) => {
  return c.text("Hello");
});

app.get("/api", (c) => {
  return c.json({ status: "ok" });
});

export default app;`;

    const { result, applied } = transformSource(source, "hono");
    expect(result).toContain(`import { Asi } from "asijs"`);
    expect(result).toContain(`import { cors } from "asijs"`);
    expect(result).toContain(`new Asi()`);
    expect(result).toContain(`app.listen(3000)`);
    expect(applied.length).toBeGreaterThanOrEqual(4);
  });
});

// ========================================================================
// Fastify → AsiJS
// ========================================================================

describe("transformSource() — Fastify → AsiJS", () => {
  it("updates Fastify import to Asi", () => {
    const { result } = transformSource(`import fastify from "fastify";`, "fastify");
    expect(result).toContain(`import { Asi } from "asijs"`);
  });

  it("transforms fastify() to new Asi()", () => {
    const { result } = transformSource(`const app = fastify({ logger: true });`, "fastify");
    expect(result).toContain(`new Asi()`);
  });

  it("transforms reply.code() to ctx.status()", () => {
    const { result } = transformSource(`reply.code(200)`, "fastify");
    expect(result).toContain(`ctx.status(`);
  });

  it("transforms reply.status() to ctx.status()", () => {
    const { result } = transformSource(`reply.status(500)`, "fastify");
    expect(result).toContain(`ctx.status(`);
  });

  it("transforms reply.send() to return", () => {
    const { result } = transformSource(`reply.send({ data })`, "fastify");
    expect(result).toContain(`return { data }`);
  });

  it("transforms reply.header() to ctx.setHeader()", () => {
    const { result } = transformSource(`reply.header("X-Custom", "val")`, "fastify");
    expect(result).toContain(`ctx.setHeader(`);
  });

  it("transforms reply.redirect() to ctx.redirect()", () => {
    const { result } = transformSource(`reply.redirect("/login")`, "fastify");
    expect(result).toContain(`ctx.redirect(`);
  });

  it("transforms reply.type() to Content-Type header", () => {
    const { result } = transformSource(`reply.type("application/json")`, "fastify");
    expect(result).toContain(`ctx.setHeader("Content-Type", "application/json")`);
  });

  it("transforms request.params to ctx.params", () => {
    const { result } = transformSource(`const id = request.params.id;`, "fastify");
    expect(result).toContain(`ctx.params.id`);
  });

  it("transforms req.params to ctx.params", () => {
    const { result } = transformSource(`const id = req.params.id;`, "fastify");
    expect(result).toContain(`ctx.params.id`);
  });

  it("transforms request.body to ctx.body()", () => {
    const { result } = transformSource(`const data = request.body;`, "fastify");
    expect(result).toContain(`ctx.body()`);
  });

  it("transforms app.register() to app.plugin()", () => {
    const { result } = transformSource(`app.register(cors());`, "fastify");
    expect(result).toContain(`app.plugin(cors())`);
  });

  it("transforms app.listen({ port: N }) to app.listen(N)", () => {
    const { result } = transformSource(`app.listen({ port: 3000, host: "0.0.0.0" });`, "fastify");
    expect(result).toContain(`app.listen(3000)`);
  });

  it("removes app.ready() calls", () => {
    const { result } = transformSource(`await app.ready();\napp.listen(3000);`, "fastify");
    expect(result).toContain(`app.ready()`); // commented out
    expect(result).toContain(`app.listen(3000)`);
  });

  it("transforms request.log to console", () => {
    const { result } = transformSource(`request.log.info("hello");`, "fastify");
    expect(result).toContain(`console.info("hello")`);
  });

  it("transforms req.log.error to console.error", () => {
    const { result } = transformSource(`req.log.error("failed");`, "fastify");
    expect(result).toContain(`console.error("failed")`);
  });

  it("processes a complete Fastify file", () => {
    const source = `import fastify from "fastify";

const app = fastify({ logger: true });

app.get("/", async (request, reply) => {
  reply.header("Content-Type", "application/json");
  return reply.send({ hello: "world" });
});

app.get("/users/:id", async (request, reply) => {
  const id = request.params.id;
  reply.code(200);
  return reply.send({ id, name: "Test" });
});

app.listen({ port: 3000 });`;

    const { result, applied } = transformSource(source, "fastify");
    expect(result).toContain(`import { Asi } from "asijs"`);
    expect(result).toContain(`new Asi()`);
    expect(result).toContain(`app.get`);
    expect(result).toContain(`ctx.setHeader("Content-Type"`);
    expect(result).toContain(`ctx.params.id`);
    expect(result).toContain(`app.listen(3000)`);
    // reply.send → return transformations
    expect(result).toContain(`return { hello: "world" }`);
    expect(applied.length).toBeGreaterThanOrEqual(6);
  });
});

// ========================================================================
// runCodemod — File & Directory Processing
// ========================================================================

describe("runCodemod()", () => {
  const testDir = tmpPath("run-codemod-test");

  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("processes a single file with Elysia code", () => {
    writeTestFile("run-codemod-test/app.ts", `import { Elysia } from "elysia";\nconst app = new Elysia();\napp.get("/", () => "ok");\napp.listen(3000);`);

    const result = runCodemod(tmpPath("run-codemod-test/app.ts"), {
      from: "elysia",
      verbose: false,
    });

    expect(result.total).toBe(1);
    expect(result.changed).toBe(1);
    expect(result.errors).toHaveLength(0);

    const content = readTestFile("run-codemod-test/app.ts");
    expect(content).toContain(`import { Asi } from "asijs"`);
    expect(content).toContain(`new Asi()`);
  });

  it("processes multiple files in a directory", () => {
    writeTestFile("run-codemod-test/src/index.ts", `import { Elysia } from "elysia";\nconst app = new Elysia();\napp.get("/", () => "ok");\napp.listen(3000);`);
    writeTestFile("run-codemod-test/src/users.ts", `import { Elysia } from "elysia";\nconst router = new Elysia();\nrouter.get("/users", () => []);`);

    const result = runCodemod(tmpPath("run-codemod-test"), {
      from: "elysia",
      verbose: false,
    });

    expect(result.total).toBe(2);
    expect(result.changed).toBe(2);
  });

  it("skips files that don't contain framework code", () => {
    writeTestFile("run-codemod-test/src/utils.ts", `export const add = (a: number, b: number) => a + b;`);
    writeTestFile("run-codemod-test/src/index.ts", `import { Elysia } from "elysia";\nconst app = new Elysia();`);

    const result = runCodemod(tmpPath("run-codemod-test"), {
      from: "elysia",
      verbose: false,
    });

    expect(result.total).toBe(2);
    expect(result.changed).toBe(1);
  });

  it("does not modify files in dry-run mode", () => {
    const original = `import { Elysia } from "elysia";\nconst app = new Elysia();\napp.listen(3000);`;
    writeTestFile("run-codemod-test/app.ts", original);

    const result = runCodemod(tmpPath("run-codemod-test/app.ts"), {
      from: "elysia",
      dryRun: true,
    });

    expect(result.changed).toBe(1);

    // File should be unchanged
    const content = readTestFile("run-codemod-test/app.ts");
    expect(content).toBe(original);
    expect(content).not.toContain(`import { Asi } from "asijs"`);
  });

  it("reports migration errors gracefully", () => {
    // Non-existent file
    const result = runCodemod(tmpPath("nonexistent.ts"), {
      from: "elysia",
    });

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.changed).toBe(0);
  });

  it("handles Hono migration on a directory", () => {
    writeTestFile("run-codemod-test/src/index.ts", `import { Hono } from "hono";\nconst app = new Hono();\napp.get("/", (c) => c.text("Hi"));\napp.listen(3000);`);

    const result = runCodemod(tmpPath("run-codemod-test"), {
      from: "hono",
      verbose: false,
    });

    expect(result.changed).toBe(1);
    expect(result.errors).toHaveLength(0);

    const content = readTestFile("run-codemod-test/src/index.ts");
    expect(content).toContain(`import { Asi } from "asijs"`);
    expect(content).toContain(`new Asi()`);
  });

  it("handles Fastify migration on a directory", () => {
    writeTestFile("run-codemod-test/src/index.js", `const fastify = require("fastify");\nconst app = fastify();\napp.get("/", async (req, reply) => { reply.send({ ok: true }); });\napp.listen({ port: 3000 });`);

    const result = runCodemod(tmpPath("run-codemod-test"), {
      from: "fastify",
      verbose: false,
    });

    expect(result.changed).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it("skips node_modules, dist, .git directories", () => {
    writeTestFile("run-codemod-test/node_modules/elysia/index.ts", `import { Elysia } from "elysia";`);
    writeTestFile("run-codemod-test/dist/index.ts", `import { Elysia } from "elysia";`);
    writeTestFile("run-codemod-test/.git/index.ts", `import { Elysia } from "elysia";`);
    writeTestFile("run-codemod-test/src/index.ts", `import { Elysia } from "elysia";\nconst app = new Elysia();`);

    const result = runCodemod(tmpPath("run-codemod-test"), {
      from: "elysia",
    });

    expect(result.total).toBe(1);
    expect(result.changed).toBe(1);
  });
});

// ========================================================================
// printSummary
// ========================================================================

describe("printSummary()", () => {
  it("does not throw", () => {
    const result = {
      files: [
        {
          path: "/test/app.ts",
          original: "old",
          transformed: "new",
          applied: ["Update import", "Rename app"],
        },
      ],
      total: 5,
      changed: 1,
      errors: [],
    };

    expect(() => printSummary(result, false)).not.toThrow();
    expect(() => printSummary(result, true)).not.toThrow();
  });

  it("prints errors when present", () => {
    const result = {
      files: [],
      total: 3,
      changed: 0,
      errors: [{ file: "/bad.ts", message: "ENOENT" }],
    };

    expect(() => printSummary(result, false)).not.toThrow();
  });
});

// ========================================================================
// Edge Cases
// ========================================================================

describe("transformSource() — Edge Cases", () => {
  it("returns empty applied list for AsiJS source (no changes)", () => {
    const { result, applied } = transformSource(
      `import { Asi } from "asijs";\nconst app = new Asi();\napp.get("/", () => "ok");\napp.listen(3000);`,
      "elysia",
    );
    expect(applied).toHaveLength(0);
    expect(result).toBe(
      `import { Asi } from "asijs";\nconst app = new Asi();\napp.get("/", () => "ok");\napp.listen(3000);`,
    );
  });

  it("applies multiple rules to a single source line", () => {
    const source = `import { Elysia, t } from "elysia";\nconst app = new Elysia();\napp.get("/", ({ body, params }) => body, { schema: t.Object({}) });\napp.listen(3000);`;
    const { applied, result } = transformSource(source, "elysia");
    expect(applied.length).toBeGreaterThanOrEqual(3);
    expect(result).toContain(`import { Asi } from "asijs"`);
    expect(result).toContain(`new Asi()`);
  });

  it("handles empty source gracefully", () => {
    const { applied, result } = transformSource("", "elysia");
    expect(applied).toHaveLength(0);
    expect(result).toBe("");
  });
});
