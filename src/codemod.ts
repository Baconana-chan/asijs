/**
 * Codemods — Automatic Migration from Elysia / Hono / Fastify to AsiJS
 *
 * Transforms source files by applying pattern-based replacements to convert
 * framework-specific code to equivalent AsiJS code.
 *
 * Supports:
 *   - Elysia → AsiJS
 *   - Hono → AsiJS
 *   - Fastify → AsiJS (including Fastify v4/v5)
 *   - Express → AsiJS (with runtime adapter via asijs/migrate-express)
 *   - Koa → AsiJS (with runtime adapter via asijs/migrate-koa)
 *
 * @example CLI
 * ```bash
 * bunx asijs migrate ./src --from elysia
 * bunx asijs migrate ./app.ts --from hono
 * bunx asijs migrate ./src --from fastify --dry-run
 * bunx asijs migrate ./src --from express
 * bunx asijs migrate ./src --from koa
 * ```
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, resolve, relative, extname } from "path";

// ========================================================================
// Types
// ========================================================================

export type SourceFramework = "elysia" | "hono" | "fastify" | "express" | "koa";

export interface CodemodOptions {
  /** Source framework to migrate from */
  from: SourceFramework;
  /** If true, show diff without writing changes */
  dryRun?: boolean;
  /** Show detailed transformation logs */
  verbose?: boolean;
}

export interface CodemodFile {
  path: string;
  original: string;
  transformed: string;
  applied: string[];
}

export interface CodemodResult {
  files: CodemodFile[];
  total: number;
  changed: number;
  errors: { file: string; message: string }[];
}

// ========================================================================
// Transformation Rules
// ========================================================================

interface TransformRule {
  description: string;
  pattern: RegExp;
  replacement: string | ((match: RegExpExecArray) => string);
}

// ── Elysia → AsiJS ──

const ELYSIA_RULES: TransformRule[] = [
  // 1. Import: Elysia + t → Asi + Type
  {
    description: "Update Elysia imports",
    pattern: /import\s*\{\s*Elysia\s*(?:,\s*t\s*)?\}\s*from\s*["']elysia["']/g,
    replacement:
      `import { Asi } from "asijs";\nimport { Type } from "@sinclair/typebox"`,
  },
  // 1b. Import: just Elysia (no t)
  {
    description: "Update Elysia-only import",
    pattern: /import\s*\{\s*Elysia\s*\}\s*from\s*["']elysia["']/g,
    replacement: `import { Asi } from "asijs"`,
  },
  // 1c. Import: just t (no Elysia)
  {
    description: "Update TypeBox import (Elysia t → TypeBox Type)",
    pattern: /import\s*\{\s*t\s*\}\s*from\s*["']elysia["']/g,
    replacement: `import { Type } from "@sinclair/typebox"`,
  },
  // 2. Plugin imports: @elysiajs/* → asijs
  {
    description: "Update Elysia CORS plugin import",
    pattern: /import\s*\{\s*cors\s*\}\s*from\s*["']@elysiajs\/cors["']/g,
    replacement: `import { cors } from "asijs"`,
  },
  {
    description: "Update Elysia JWT plugin import",
    pattern: /import\s*\{\s*jwt\s*\}\s*from\s*["']@elysiajs\/jwt["']/g,
    replacement: `import { jwt } from "asijs"`,
  },
  {
    description: "Update Elysia Swagger plugin import",
    pattern: /import\s*\{\s*swagger\s*\}\s*from\s*["']@elysiajs\/swagger["']/g,
    replacement: `import { openapi } from "asijs"`,
  },
  {
    description: "Update Elysia Bearer plugin import",
    pattern: /import\s*\{\s*bearer\s*\}\s*from\s*["']@elysiajs\/bearer["']/g,
    replacement: `import { bearer } from "asijs"`,
  },
  {
    description: "Update Elysia Static plugin import",
    pattern: /import\s*\{\s*static\s*\}\s*from\s*["']@elysiajs\/static["']/g,
    replacement: `import { staticFiles } from "asijs"`,
  },
  {
    description: "Update Elysia rate-limit plugin import",
    pattern: /import\s*\{\s*rateLimit\s*\}\s*from\s*["']elysia-rate-limit["']/g,
    replacement: `import { rateLimit } from "asijs"`,
  },
  // 3. App creation
  {
    description: "Replace new Elysia() with new Asi()",
    pattern: /new\s+Elysia\s*\(([^)]*)\)/g,
    replacement: () => `new Asi()`,
  },
  // 4. Chained method calls → individual calls
  // Remove leading dots and add semicolons after each .method() chain
  {
    description: "Split Elysia chained .get()/.post() etc.",
    pattern: /\n\s+\.(get|post|put|patch|delete|head|options|all)\(/g,
    replacement: `;\napp.$1(`,
  },
  // 5. Plugin .use() → app.plugin()
  {
    description: "Replace Elysia .use() with app.plugin()",
    pattern: /\.use\(/g,
    replacement: `.plugin(`,
  },
  {
    description: "Rename swagger() call to openapi()",
    pattern: /\bswagger\s*\(/g,
    replacement: `openapi(`,
  },
  // 6. .guard() → app.group() with middleware
  {
    description: "Transform .guard() wrapper",
    pattern: /\.guard\s*\(/g,
    replacement: `\n// [codemod] Guard → group with middleware\napp.group(`,
  },
  // 7. .derive() → app.before()
  {
    description: "Transform .derive() to app.before()",
    pattern: /\.derive\s*\(/g,
    replacement: `;\napp.before(`,
  },
  // 8. .onError() → app.onError()
  {
    description: "Transform .onError() to app.onError()",
    pattern: /\.onError\s*\(/g,
    replacement: `;\napp.onError(`,
  },
  // 9. t.Object → Type.Object
  {
    description: "Rename t.Object to Type.Object",
    pattern: /\bt\.Object\b/g,
    replacement: `Type.Object`,
  },
  {
    description: "Rename t.String to Type.String",
    pattern: /\bt\.String\b/g,
    replacement: `Type.String`,
  },
  {
    description: "Rename t.Number to Type.Number",
    pattern: /\bt\.Number\b/g,
    replacement: `Type.Number`,
  },
  {
    description: "Rename t.Boolean to Type.Boolean",
    pattern: /\bt\.Boolean\b/g,
    replacement: `Type.Boolean`,
  },
  {
    description: "Rename t.Array to Type.Array",
    pattern: /\bt\.Array\b/g,
    replacement: `Type.Array`,
  },
  {
    description: "Rename t.Optional to Type.Optional",
    pattern: /\bt\.Optional\b/g,
    replacement: `Type.Optional`,
  },
  {
    description: "Rename t.Union to Type.Union",
    pattern: /\bt\.Union\b/g,
    replacement: `Type.Union`,
  },
  {
    description: "Rename t.Literal to Type.Literal",
    pattern: /\bt\.Literal\b/g,
    replacement: `Type.Literal`,
  },
  {
    description: "Rename t.Null to Type.Null",
    pattern: /\bt\.Null\b/g,
    replacement: `Type.Null`,
  },
  {
    description: "Rename t.Any to Type.Any",
    pattern: /\bt\.Any\b/g,
    replacement: `Type.Any`,
  },
  {
    description: "Rename t.Record to Type.Record",
    pattern: /\bt\.Record\b/g,
    replacement: `Type.Record`,
  },
  {
    description: "Convert t.Enum to Type.Enum",
    pattern: /\bt\.Enum\b/g,
    replacement: `Type.Enum`,
  },
  {
    description: "Convert t.Integer to Type.Integer",
    pattern: /\bt\.Integer\b/g,
    replacement: `Type.Integer`,
  },
  {
    description: "Convert t.Union to Type.Union",
    pattern: /\bt\.Union\b/g,
    replacement: `Type.Union`,
  },
  {
    description: "Convert t.Pick to Type.Pick",
    pattern: /\bt\.Pick\b/g,
    replacement: `Type.Pick`,
  },
  {
    description: "Convert t.Omit to Type.Omit",
    pattern: /\bt\.Omit\b/g,
    replacement: `Type.Omit`,
  },
  {
    description: "Convert t.Partial to Type.Partial",
    pattern: /\bt\.Partial\b/g,
    replacement: `Type.Partial`,
  },
  // 10. Destructured context: ({ body, params, query, set, ... }) → ctx
  {
    description: "Transform destructured context params",
    pattern: /\((?:\{\s*(?:body|params|query|set|headers|cookie|request|store|error|redirect)\s*(?::\s*[^,}]*)?\s*(?:,\s*(?:body|params|query|set|headers|cookie|request|store|error|redirect)\s*(?::\s*[^,}]*)?)*\s*\})\s*(?:,\s*next\s*)?\)/g,
    replacement: `(ctx, next)`,
  },
  // 11. set.status = N → ctx.status(N)
  {
    description: "Transform set.status = N to ctx.status(N).jsonResponse()",
    pattern: /set\.status\s*=\s*(\d+)/g,
    replacement: `// [codemod] set.status → ctx.status()\n    ctx.status($1)`,
  },
  // 12. set.headers['X-Key'] = val → ctx.setHeader('X-Key', val)
  {
    description: "Transform set.headers to ctx.setHeader",
    pattern: /set\.headers\s*\[\s*["']([^"']+)["']\s*\]\s*=\s*([^;]+)/g,
    replacement: `ctx.setHeader("$1", $2)`,
  },
  // 13. .listen(port) → app.listen(port)
  {
    description: "Transform final .listen() to app.listen()",
    pattern: /\n\s+\.listen\s*\(/g,
    replacement: `;\napp.listen(`,
  },
  // 14. headers.authorization → ctx.header("authorization")
  {
    description: "Transform headers.authorization to ctx.header()",
    pattern: /headers\.authorization/gi,
    replacement: `ctx.header("authorization")`,
  },
];

// ── Hono → AsiJS ──

const HONO_RULES: TransformRule[] = [
  // 1. Import
  {
    description: "Update Hono import",
    pattern: /import\s*\{\s*Hono\s*\}\s*from\s*["']hono["']/g,
    replacement: `import { Asi } from "asijs"`,
  },
  // 2. Plugin imports
  {
    description: "Update Hono cors import",
    pattern: /import\s*\{\s*cors\s*\}\s*from\s*["']hono\/cors["']/g,
    replacement: `import { cors } from "asijs"`,
  },
  {
    description: "Update Hono jwt import",
    pattern: /import\s*\{\s*jwt\s*\}\s*from\s*["']hono\/jwt["']/g,
    replacement: `import { jwt } from "asijs"`,
  },
  {
    description: "Update Hono logger import",
    pattern: /import\s*\{\s*logger\s*\}\s*from\s*["']hono\/logger["']/g,
    replacement: `import { devMode } from "asijs"`,
  },
  {
    description: "Update Hono secure-headers import",
    pattern: /import\s*\{\s*secureHeaders\s*\}\s*from\s*["']hono\/secure-headers["']/g,
    replacement: `import { security } from "asijs"`,
  },
  {
    description: "Update Hono etag import",
    pattern: /import\s*\{\s*etag\s*\}\s*from\s*["']hono\/etag["']/g,
    replacement: `import { etag } from "asijs"`,
  },
  {
    description: "Update Hono bearer-auth import",
    pattern: /import\s*\{\s*bearerAuth\s*\}\s*from\s*["']hono\/bearer-auth["']/g,
    replacement: `import { bearer } from "asijs"`,
  },
  // 3. App creation
  {
    description: "Replace new Hono() with new Asi()",
    pattern: /new\s+Hono\s*\(\)/g,
    replacement: `new Asi()`,
  },
  // 4. c.text() → return string or ctx.text()
  {
    description: "Transform c.text() to return string",
    pattern: /c\.text\s*\(([^)]+)\)/g,
    replacement: `$1 // [codemod] → return string`,
  },
  // 5. c.json() → return { ... }
  {
    description: "Transform c.json() to return object",
    pattern: /c\.json\s*\(([^)]+)\)/g,
    replacement: `$1 // [codemod] → return object`,
  },
  // 6. c.html() → ctx.html()
  {
    description: "Transform c.html() to ctx.html()",
    pattern: /c\.html\s*\(/g,
    replacement: `ctx.html(`,
  },
  // 7. c.redirect() → ctx.redirect()
  {
    description: "Transform c.redirect() to ctx.redirect()",
    pattern: /c\.redirect\s*\(/g,
    replacement: `ctx.redirect(`,
  },
  // 8. c.req.param("name") → ctx.params.name
  {
    description: "Transform c.req.param() to ctx.params",
    pattern: /c\.req\.param\s*\(\s*["']([^"']+)["']\s*\)/g,
    replacement: `ctx.params.$1`,
  },
  // 9. c.req.query("name") → ctx.query.name
  {
    description: "Transform c.req.query() to ctx.query",
    pattern: /c\.req\.query\s*\(\s*["']([^"']+)["']\s*\)/g,
    replacement: `ctx.query.$1`,
  },
  // 10. c.req.header("name") → ctx.header("name")
  {
    description: "Transform c.req.header() to ctx.header()",
    pattern: /c\.req\.header\s*\(/g,
    replacement: `ctx.header(`,
  },
  // 11. await c.req.json() → await ctx.body()
  {
    description: "Transform await c.req.json() to await ctx.body()",
    pattern: /await\s+c\.req\.json\s*\(\)/g,
    replacement: `await ctx.body()`,
  },
  // 12. c.status(N) → ctx.status(N)
  {
    description: "Transform c.status() to ctx.status()",
    pattern: /c\.status\s*\(/g,
    replacement: `ctx.status(`,
  },
  // 13. c.header("key", "val") → ctx.setHeader("key", "val")
  {
    description: "Transform c.header() to ctx.setHeader()",
    pattern: /c\.header\s*\(/g,
    replacement: `ctx.setHeader(`,
  },
  // 14. c.get("key") → ctx[key] or store access
  {
    description: "Transform c.get() to ctx.store access",
    pattern: /c\.get\s*\(\s*["']([^"']+)["']\s*\)/g,
    replacement: `(ctx as any).$1`,
  },
  // 15. c.set("key", val) → ctx.store.key = val or decorator
  {
    description: "Transform c.set() to ctx.store",
    pattern: /c\.set\s*\(\s*["']([^"']+)["']\s*,\s*([^)]+)\s*\)/g,
    replacement: `(ctx as any).$1 = $2`,
  },
  // 16. c.notFound() → ctx.status(404).jsonResponse()
  {
    description: "Transform c.notFound() to ctx.status(404)",
    pattern: /c\.notFound\s*\(\)/g,
    replacement: `ctx.status(404).jsonResponse({ error: "Not Found" })`,
  },
  // 17. app.use("*", ...) → app.use(...) or app.plugin(...)
  {
    description: "Transform Hono app.use('*', ...) to app.use()",
    pattern: /app\.use\s*\(\s*["']\*["']\s*,/g,
    replacement: `app.use(`,
  },
  // 18. app.route("/prefix", subApp) → app.group("/prefix", (g) => { ... })
  {
    description: "Transform Hono app.route() hint",
    pattern: /app\.route\s*\(\s*["']([^"']+)["']\s*,\s*([^)]+)\s*\)/g,
    replacement: (_match: RegExpExecArray) => {
      const prefix = _match[1];
      const subApp = _match[2].trim();
      return `// [codemod] app.route("${prefix}", ${subApp}) → app.group()\n// The sub-app "${subApp}" was mounted at "${prefix}".\n// Manually move its route definitions into the group callback:\napp.group("${prefix}", (g) => {\n  // TODO: copy routes from ${subApp} here\n})`;
    },
  },
  // 19. export default app → app.listen()
  {
    description: "Transform export default app to app.listen()",
    pattern: /export\s+default\s+app\s*;?\s*$/gm,
    replacement: `app.listen(3000);\n// [codemod] export default replaced with app.listen()`,
  },
  // 20. (c) => handler → (ctx) => handler
  {
    description: "Rename handler param c to ctx",
    pattern: /(?:async\s+)?\(c\)\s*=>\s*{/g,
    replacement: (_match: RegExpExecArray) => _match[0].replace("(c)", "(ctx)"),
  },
  // 21. Hono Zod validator import
  {
    description: "Update Hono zValidator import hint",
    pattern: /import\s*\{\s*zValidator\s*\}\s*from\s*["']@hono\/zod-validator["']/g,
    replacement: `// [codemod] zValidator → TypeBox schema in route options\nimport { Type } from "@sinclair/typebox"`,
  },
  // 22. z.object → Type.Object (after zValidator removal)
  {
    description: "Transform z.object to Type.Object",
    pattern: /\bz\.object\b/g,
    replacement: `Type.Object`,
  },
  {
    description: "Transform z.string to Type.String",
    pattern: /\bz\.string\b/g,
    replacement: `Type.String`,
  },
  {
    description: "Transform z.number to Type.Number",
    pattern: /\bz\.number\b/g,
    replacement: `Type.Number`,
  },
  {
    description: "Transform z.boolean to Type.Boolean",
    pattern: /\bz\.boolean\b/g,
    replacement: `Type.Boolean`,
  },
  {
    description: "Transform z.array to Type.Array",
    pattern: /\bz\.array\b/g,
    replacement: `Type.Array`,
  },
  {
    description: "Transform z.enum to Type.Enum or Type.Union",
    pattern: /\bz\.enum\b/g,
    replacement: `Type.Union`,
  },
  {
    description: "Transform z.optional to Type.Optional",
    pattern: /\bz\.optional\b/g,
    replacement: `Type.Optional`,
  },
  {
    description: "Transform z.nullable to Type.Optional",
    pattern: /\bz\.nullable\b/g,
    replacement: `Type.Optional`,
  },
  // 23. Wrapping .json() responses in return
  {
    description: "Add return to c.json() expressions",
    pattern: /return\s+c\.json\s*\(/g,
    replacement: `return `,
  },
  // 24. .email() → { format: "email" }
  {
    description: "Transform z.string().email() to Type.String format",
    pattern: /Type\.String\s*\(\)\s*\.\s*email\s*\(\)/g,
    replacement: `Type.String({ format: "email" })`,
  },
  // 25. .min(number) → { minLength: number }
  {
    description: "Transform .min() to minLength",
    pattern: /Type\.String\s*\(\)\s*\.\s*min\s*\((\d+)\)/g,
    replacement: `Type.String({ minLength: $1 })`,
  },
  {
    description: "Transform .max() to maxLength",
    pattern: /Type\.String\s*\(\)\s*\.\s*max\s*\((\d+)\)/g,
    replacement: `Type.String({ maxLength: $1 })`,
  },
];

// ── Fastify → AsiJS ──

const FASTIFY_RULES: TransformRule[] = [
  // 1. Import
  {
    description: "Update Fastify import",
    pattern: /import\s+(fastify|Fastify)\s*(?:,\s*\{\s*.*?\s*\})?\s*from\s*["']fastify["']/g,
    replacement: `import { Asi } from "asijs"`,
  },
  {
    description: "Update Fastify require",
    pattern: /const\s+(fastify|app)\s*=\s*require\s*\(\s*["']fastify["']\s*\)/g,
    replacement: `import { Asi } from "asijs"\nconst app = new Asi()`,
  },
  // 2. App creation
  {
    description: "Replace fastify() with new Asi()",
    pattern: /\bfastify\s*\(\s*([^)]*)\)/g,
    replacement: `new Asi()`,
  },
  // 3. app.get/post/... with URL + options pattern
  {
    description: "Add ctx param to Fastify route handlers",
    pattern: /app\.(get|post|put|patch|delete|head|options)\(\s*["']([^"']+)["']\s*,\s*(async\s*)?\(\s*request\s*(?:,\s*reply\s*)?\)/g,
    replacement: `app.$1("$2", $3(ctx)`,
  },
  {
    description: "Fastify handler with req, reply",
    pattern: /app\.(get|post|put|patch|delete|head|options)\(\s*["']([^"']+)["']\s*,\s*(async\s*)?\(\s*req\s*(?:,\s*reply\s*)?\)/g,
    replacement: `app.$1("$2", $3(ctx)`,
  },
  // 4. request.params → ctx.params
  {
    description: "Transform request.params to ctx.params",
    pattern: /\brequest\.params\b/g,
    replacement: `ctx.params`,
  },
  {
    description: "Transform req.params to ctx.params",
    pattern: /\breq\.params\b/g,
    replacement: `ctx.params`,
  },
  // 5. request.query → ctx.query
  {
    description: "Transform request.query to ctx.query",
    pattern: /\brequest\.query\b/g,
    replacement: `ctx.query`,
  },
  {
    description: "Transform req.query to ctx.query",
    pattern: /\breq\.query\b/g,
    replacement: `ctx.query`,
  },
  // 6. request.body → ctx.body (awaited)
  {
    description: "Transform request.body to ctx.body()",
    pattern: /\brequest\.body\b/g,
    replacement: `ctx.body()`,
  },
  {
    description: "Transform req.body to ctx.body()",
    pattern: /\breq\.body\b/g,
    replacement: `ctx.body()`,
  },
  // 7. await request.json() → await ctx.body()
  {
    description: "Transform request.json() to ctx.body()",
    pattern: /\b(?:request|req)\.json\s*\(\)/g,
    replacement: `ctx.body()`,
  },
  // 8. reply.code(N) → ctx.status(N)
  {
    description: "Transform reply.code() to ctx.status()",
    pattern: /\breply\.code\s*\(/g,
    replacement: `ctx.status(`,
  },
  // 9. reply.send() → return
  {
    description: "Transform reply.send() to return",
    pattern: /\breply\.send\s*\(/g,
    replacement: `return `,
  },
  // 10. reply.header() → ctx.setHeader()
  {
    description: "Transform reply.header() to ctx.setHeader()",
    pattern: /\breply\.header\s*\(/g,
    replacement: `ctx.setHeader(`,
  },
  // 11. reply.redirect() → ctx.redirect()
  {
    description: "Transform reply.redirect() to ctx.redirect()",
    pattern: /\breply\.redirect\s*\(/g,
    replacement: `ctx.redirect(`,
  },
  // 12. reply.type() → ctx.setHeader("Content-Type",...)
  {
    description: "Transform reply.type() to Content-Type header",
    pattern: /\breply\.type\s*\(\s*["']([^"']+)["']\s*\)/g,
    replacement: `ctx.setHeader("Content-Type", "$1")`,
  },
  // 13. reply.status(N) → ctx.status(N)
  {
    description: "Transform reply.status() to ctx.status()",
    pattern: /\breply\.status\s*\(/g,
    replacement: `ctx.status(`,
  },
  // 14. app.register(plugin) → app.plugin() or app.use()
  {
    description: "Transform app.register() to app.plugin()",
    pattern: /app\.register\s*\(/g,
    replacement: `app.plugin(`,
  },
  // 15. Fastify schema → TypeBox schema
  {
    description: "Transform Fastify schema body annotation",
    pattern: /schema\s*:\s*\{\s*body\s*:/g,
    replacement: `schema: { body:`,
  },
  // 16. app.listen({ port: N }) → app.listen(N)
  {
    description: "Transform Fastify app.listen({ port: N })",
    pattern: /app\.listen\s*\(\s*\{\s*port\s*:\s*(\d+)[^}]*\}\s*\)/g,
    replacement: `app.listen($1)`,
  },
  // 17. app.ready() → remove (not needed)
  {
    description: "Remove app.ready() calls",
    pattern: /\n\s*await\s+app\.ready\s*\(\)\s*;?/g,
    replacement: `\n// [codemod] app.ready() → removed (AsiJS doesn't need it)`,
  },
  // 18. app.after() → app.after() (keep as is)
  {
    description: "Keep app.after() — but note it's different",
    pattern: /app\.after\s*\(/g,
    replacement: `// [codemod] Fastify after → AsiJS after\napp.after(`,
  },
  // 19. request.log → console (Fastify logger)
  {
    description: "Transform request.log to console",
    pattern: /\b(request|req)\.log\.(info|warn|error|debug)\s*\(/g,
    replacement: `console.$2(`,
  },
  // 20. reply.view() → ctx.html() or manual render
  {
    description: "Transform reply.view() hint",
    pattern: /\breply\.view\s*\(/g,
    replacement: `ctx.html( // [codemod] reply.view() → ctx.html()\n    `,
  },
];

// ========================================================================
// Rule Registry
// ========================================================================

const RULES: Record<SourceFramework, TransformRule[]> = {
  elysia: ELYSIA_RULES,
  hono: HONO_RULES,
  fastify: FASTIFY_RULES,
  express: [],
  koa: [],
};

// Import Express and Koa rules dynamically (they're in separate modules)
let _expressRulesLoaded = false;
let _koaRulesLoaded = false;

function ensureExpressRules() {
  if (_expressRulesLoaded) return;
  try {
    const { EXPRESS_CODEMOD_RULES } = require("./migrate-express") as typeof import("./migrate-express");
    RULES.express = EXPRESS_CODEMOD_RULES;
    _expressRulesLoaded = true;
  } catch {}
}

function ensureKoaRules() {
  if (_koaRulesLoaded) return;
  try {
    const { KOA_CODEMOD_RULES } = require("./migrate-koa") as typeof import("./migrate-koa");
    RULES.koa = KOA_CODEMOD_RULES;
    _koaRulesLoaded = true;
  } catch {}
}

// Lazy load rules when needed
function getRules(framework: SourceFramework): TransformRule[] {
  if (framework === "express") ensureExpressRules();
  if (framework === "koa") ensureKoaRules();
  return RULES[framework] || [];
}

// ========================================================================
// Detection
// ========================================================================

const FRAMEWORK_DETECTORS: Record<string, RegExp[]> = {
  elysia: [
    /from\s+["']elysia["']/,
    /from\s+["']@elysiajs\//,
    /from\s+["']elysia-rate-limit["']/,
  ],
  hono: [
    /from\s+["']hono["']/,
    /from\s+["']hono\//,
    /from\s+["']@hono\//,
    /from\s+["']hono-rate-limiter["']/,
  ],
  fastify: [
    /from\s+["']fastify["']/,
    /require\s*\(\s*["']fastify["']\s*\)/,
    /app\.register\(/,
    /reply\.(send|code|redirect)\(/,
  ],
  express: [
    /from\s+["']express["']/,
    /require\s*\(\s*["']express["']\s*\)/,
    /express\s*\(\s*\)/,
    /\.Router\s*\(\s*\)/,
    /\b(?:res|response)\.(send|json|redirect|status)\(/,
    /\bnext\s*\(\)/,
  ],
  koa: [
    /from\s+["']koa["']/,
    /require\s*\(\s*["']koa["']\s*\)/,
    /new\s+Koa\s*\(\s*\)/,
    /\bctx\.body\s*=/,
    /\bctx\.status\s*=\s*\d+/,
    /\bctx\.throw\s*\(/,
    /\bctx\.cookies\b/,
  ],
};

/**
 * Detect which framework a source file uses.
 * Returns the framework name if confidently detected, null otherwise.
 */
export function detectFramework(source: string): SourceFramework | null {
  for (const [framework, patterns] of Object.entries(FRAMEWORK_DETECTORS)) {
    for (const pattern of patterns) {
      if (pattern.test(source)) {
        return framework as SourceFramework;
      }
    }
  }
  return null;
}

/**
 * Auto-detect framework in a directory by scanning entry files.
 */
export function detectProjectFramework(
  rootDir: string,
): SourceFramework | null {
  const candidates = [
    "src/index.ts",
    "src/index.js",
    "src/app.ts",
    "src/app.js",
    "index.ts",
    "index.js",
    "app.ts",
    "app.js",
  ];

  for (const file of candidates) {
    const filePath = join(rootDir, file);
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, "utf-8");
      const detected = detectFramework(content);
      if (detected) return detected;
    }
  }

  // Try scanning first level of src/
  const srcDir = join(rootDir, "src");
  if (existsSync(srcDir)) {
    const entries = readdirSync(srcDir);
    for (const entry of entries) {
      const filePath = join(srcDir, entry);
      if (statSync(filePath).isFile() && /\.(ts|js|tsx|jsx)$/i.test(entry)) {
        const content = readFileSync(filePath, "utf-8");
        const detected = detectFramework(content);
        if (detected) return detected;
      }
    }
  }

  return null;
}

// ========================================================================
// Transformation Engine
// ========================================================================

/**
 * Apply codemod rules to transform source code from one framework to AsiJS.
 */
export function transformSource(
  source: string,
  framework: SourceFramework,
  verbose = false,
): { result: string; applied: string[] } {
  const rules = getRules(framework);
  const applied: string[] = [];
  let result = source;

  for (const rule of rules) {
    let newResult: string;

    if (typeof rule.replacement === "function") {
      // Function callback: build RegExpExecArray from .replace() args
      newResult = result.replace(rule.pattern, ((...args: any[]) => {
        const match = args[0];
        const execArray = { 0: match } as unknown as RegExpExecArray;
        for (let i = 1; i < args.length - 2; i++) {
          (execArray as any)[i] = args[i];
        }
        return (rule.replacement as (match: RegExpExecArray) => string)(execArray);
      }) as any);
    } else {
      // String replacement: use built-in $1, $2 backreference support
      newResult = result.replace(rule.pattern, rule.replacement);
    }

    if (newResult !== result) {
      applied.push(rule.description);
      if (verbose) {
        console.log(`  ✓ ${rule.description}`);
      }
      result = newResult;
    }
  }

  return { result, applied };
}

/**
 * Migrate a single file from one framework to AsiJS.
 */
export function migrateFile(
  filePath: string,
  options: CodemodOptions,
): CodemodFile | null {
  const source = readFileSync(filePath, "utf-8");

  // Auto-detect if framework not specified and file doesn't match
  const framework = options.from;
  const { result, applied } = transformSource(source, framework, options.verbose);

  if (applied.length === 0) {
    return null; // No changes
  }

  return {
    path: filePath,
    original: source,
    transformed: result,
    applied,
  };
}

/**
 * Find all source files in a directory that likely contain framework code.
 */
function findSourceFiles(dir: string): string[] {
  const files: string[] = [];
  const extensions = [".ts", ".js", ".tsx", ".jsx"];

  function walk(current: string) {
    if (!existsSync(current)) return;

    const entries = readdirSync(current);
    for (const entry of entries) {
      const fullPath = join(current, entry);
      if (statSync(fullPath).isDirectory()) {
        // Skip node_modules, dist, .git
        if (!["node_modules", "dist", ".git", ".cache", "build"].includes(entry)) {
          walk(fullPath);
        }
      } else if (extensions.includes(extname(entry))) {
        files.push(fullPath);
      }
    }
  }

  walk(dir);
  return files;
}

/**
 * Run codemod on a file path or directory.
 * - If path is a file: transform just that file
 * - If path is a directory: scan for source files and transform matching ones
 */
export function runCodemod(
  targetPath: string,
  options: CodemodOptions,
): CodemodResult {
  const result: CodemodResult = {
    files: [],
    total: 0,
    changed: 0,
    errors: [],
  };

  const absolutePath = resolve(targetPath);
  let filesToProcess: string[];

  if (!existsSync(absolutePath)) {
    result.errors.push({
      file: absolutePath,
      message: "File or directory not found",
    });
    return result;
  }

  if (statSync(absolutePath).isFile()) {
    filesToProcess = [absolutePath];
  } else {
    filesToProcess = findSourceFiles(absolutePath);
  }

  result.total = filesToProcess.length;

  for (const filePath of filesToProcess) {
    try {
      const content = readFileSync(filePath, "utf-8");

      // Skip files that don't use the source framework
      const detected = detectFramework(content);
      if (detected !== options.from && detected !== null) {
        // Different framework — skip
        continue;
      }

      const codemodFile = migrateFile(filePath, options);
      if (codemodFile) {
        result.files.push(codemodFile);
        result.changed++;

        if (options.verbose) {
          console.log(`\n  ${filePath}:`);
          for (const change of codemodFile.applied) {
            console.log(`    ✓ ${change}`);
          }
        }

        if (!options.dryRun) {
          writeFileSync(filePath, codemodFile.transformed, "utf-8");
        }
      }
    } catch (error) {
      result.errors.push({
        file: filePath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

/**
 * Print migration result summary.
 */
export function printSummary(result: CodemodResult, dryRun: boolean): void {
  const mode = dryRun ? "DRY RUN" : "MIGRATED";
  console.log(`\n${"=".repeat(50)}`);
  console.log(`  ${mode} — Summary`);
  console.log(`${"=".repeat(50)}`);
  console.log(`  Files scanned:    ${result.total}`);
  console.log(`  Files changed:    ${result.changed}`);
  console.log(`  Transformations:  ${result.files.reduce((s, f) => s + f.applied.length, 0)}`);
  console.log(`  Errors:           ${result.errors.length}`);

  if (result.errors.length > 0) {
    console.log(`\n  Errors:`);
    for (const err of result.errors) {
      console.log(`    ✗ ${err.file}: ${err.message}`);
    }
  }

  if (result.changed > 0) {
    console.log(`\n  Changed files:`);
    for (const file of result.files) {
      console.log(`    ${dryRun ? "📝" : "✓"} ${file.path}`);
      for (const change of file.applied) {
        console.log(`      • ${change}`);
      }
    }
  }

  if (dryRun && result.changed > 0) {
    console.log(`\n  ⚠️  Dry run — no files were modified.`);
    console.log(`  Run without --dry-run to apply changes.`);
  }

  console.log(`\n  📖 Review the MIGRATION.md guide for manual adjustments.`);
  console.log();
}
