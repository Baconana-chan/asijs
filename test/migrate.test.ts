import { describe, test, expect } from "bun:test";
import { Asi } from "../src/asi";

// ============================================================================
// Express Migration — Runtime Adapter
// ============================================================================

describe("expressPlugin — wrap middleware", () => {
  test("wraps simple Express middleware", async () => {
    const { expressPlugin } = await import("../src/migrate-express");

    const app = new Asi({ silent: true });
    app.get("/", () => "ok");

    expect(expressPlugin.wrap).toBeDefined();
    expect(typeof expressPlugin.wrap).toBe("function");
  });

  test("expressPlugin.handler works with res.json", async () => {
    const { expressPlugin } = await import("../src/migrate-express");

    const app = new Asi({ silent: true });
    app.get("/data", expressPlugin.handler((_req, res) => {
      res.json({ message: "hello" });
    }));

    const res = await app.handle(new Request("http://localhost/data"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe("hello");
  });

  test("expressPlugin.handler works with res.send", async () => {
    const { expressPlugin } = await import("../src/migrate-express");

    const app = new Asi({ silent: true });
    app.get("/text", expressPlugin.handler((_req, res) => {
      res.status(201).send("created");
    }));

    const res = await app.handle(new Request("http://localhost/text"));
    expect(res.status).toBe(201);
    const body = await res.text();
    expect(body).toBe("created");
  });

  test("expressPlugin.handler works with res.status + res.json", async () => {
    const { expressPlugin } = await import("../src/migrate-express");

    const app = new Asi({ silent: true });
    app.get("/api", expressPlugin.handler((_req, res) => {
      res.status(404).json({ error: "not found" });
    }));

    const res = await app.handle(new Request("http://localhost/api"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("not found");
  });

  test("expressPlugin.handler reads req.params and req.query", async () => {
    const { expressPlugin } = await import("../src/migrate-express");

    const app = new Asi({ silent: true });
    app.get("/user/:id", expressPlugin.handler((req, res) => {
      res.json({ id: req.params.id, q: req.query.q });
    }));

    const res = await app.handle(new Request("http://localhost/user/42?q=test"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("42");
    expect(body.q).toBe("test");
  });

  test("expressPlugin.handler handles redirect", async () => {
    const { expressPlugin } = await import("../src/migrate-express");

    const app = new Asi({ silent: true });
    app.get("/old", expressPlugin.handler((_req, res) => {
      res.redirect(301, "/new");
    }));

    const res = await app.handle(new Request("http://localhost/old"));
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("/new");
  });
});

// ============================================================================
// Express Migration — Codemod Transforms
// ============================================================================

describe("Express codemod rules", () => {
  test("EXPRESS_CODEMOD_RULES is defined", async () => {
    const { EXPRESS_CODEMOD_RULES } = await import("../src/migrate-express");
    expect(Array.isArray(EXPRESS_CODEMOD_RULES)).toBe(true);
    expect(EXPRESS_CODEMOD_RULES.length).toBeGreaterThan(20);
  });

  test("EXPRESS_DETECTORS detects Express code", async () => {
    const { EXPRESS_DETECTORS } = await import("../src/migrate-express");

    const expressCode = `import express from "express";
const app = express();
app.get("/", (req, res) => { res.send("ok"); });
next();`;
    const detected = EXPRESS_DETECTORS.some((p) => p.test(expressCode));
    expect(detected).toBe(true);
  });

  test("EXPRESS_DETECTORS does not detect non-Express code", async () => {
    const { EXPRESS_DETECTORS } = await import("../src/migrate-express");

    const nonExpressCode = `import { Asi } from "asijs";
const app = new Asi();
app.get("/", (ctx) => "ok");`;
    const detected = EXPRESS_DETECTORS.some((p) => p.test(nonExpressCode));
    expect(detected).toBe(false);
  });

  test("codemod transforms Express route handlers", async () => {
    const { transformSource } = await import("../src/codemod");
    const expressCode = `app.get("/user/:id", (req, res) => {
  const user = { id: req.params.id };
  res.json(user);
});`;

    const { result, applied } = transformSource(expressCode, "express", false);
    expect(applied.length).toBeGreaterThan(0);
    expect(result).toContain("ctx.params.id");
    expect(result).toContain("(ctx) =>");
  });

  test("codemod transforms Express res.json to return", async () => {
    const { transformSource } = await import("../src/codemod");
    const code = `app.get("/", (req, res) => {
  res.json({ message: "ok" });
});`;

    const { result, applied } = transformSource(code, "express", false);
    expect(applied.length).toBeGreaterThan(0);
    expect(result).toContain("return { message: \"ok\" }");
    expect(result).not.toContain("res.json");
  });

  test("codemod transforms Express res.status().send()", async () => {
    const { transformSource } = await import("../src/codemod");
    const code = `res.status(404).send("Not Found");`;

    const { result } = transformSource(code, "express", false);
    expect(result).toContain("ctx.status(404).jsonResponse(");
  });

  test("codemod transforms Express res.redirect()", async () => {
    const { transformSource } = await import("../src/codemod");
    const code = `res.redirect("/login");`;

    const { result } = transformSource(code, "express", false);
    expect(result).toContain("ctx.redirect(");
  });

  test("codemod transforms Express import", async () => {
    const { transformSource } = await import("../src/codemod");
    const code = `import express from "express";`;

    const { result } = transformSource(code, "express", false);
    expect(result).toContain("import { Asi } from \"asijs\"");
  });
});

// ============================================================================
// Koa Migration — Runtime Adapter
// ============================================================================

describe("koaPlugin — wrap middleware", () => {
  test("koaPlugin.wrap is defined", async () => {
    const { koaPlugin } = await import("../src/migrate-koa");

    expect(koaPlugin.wrap).toBeDefined();
    expect(typeof koaPlugin.wrap).toBe("function");
  });

  test("koaPlugin.handler works with ctx.body", async () => {
    const { koaPlugin } = await import("../src/migrate-koa");

    const app = new Asi({ silent: true });
    app.get("/", koaPlugin.handler((ctx) => {
      ctx.body = { message: "hello from koa" };
      ctx.status = 200;
    }));

    const res = await app.handle(new Request("http://localhost/"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe("hello from koa");
  });

  test("koaPlugin.handler works with string body", async () => {
    const { koaPlugin } = await import("../src/migrate-koa");

    const app = new Asi({ silent: true });
    app.get("/text", koaPlugin.handler((ctx) => {
      ctx.body = "hello world";
      ctx.type = "text/plain";
    }));

    const res = await app.handle(new Request("http://localhost/text"));
    const body = await res.text();
    expect(body).toBe("hello world");
  });

  test("koaPlugin.handler reads ctx.query and ctx.params", async () => {
    const { koaPlugin } = await import("../src/migrate-koa");

    const app = new Asi({ silent: true });
    app.get("/user/:id", koaPlugin.handler((ctx) => {
      ctx.body = { id: ctx.params.id, search: ctx.query.q };
    }));

    const res = await app.handle(new Request("http://localhost/user/99?q=test"));
    const body = await res.json();
    expect(body.id).toBe("99");
    expect(body.search).toBe("test");
  });

  test("koaPlugin.handler handles redirect", async () => {
    const { koaPlugin } = await import("../src/migrate-koa");

    const app = new Asi({ silent: true });
    app.get("/old", koaPlugin.handler((ctx) => {
      ctx.redirect("/new");
      ctx.status = 301;
    }));

    const res = await app.handle(new Request("http://localhost/old"));
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("/new");
  });
});

// ============================================================================
// Koa Migration — Codemod Transforms
// ============================================================================

describe("Koa codemod rules", () => {
  test("KOA_CODEMOD_RULES is defined", async () => {
    const { KOA_CODEMOD_RULES } = await import("../src/migrate-koa");
    expect(Array.isArray(KOA_CODEMOD_RULES)).toBe(true);
    expect(KOA_CODEMOD_RULES.length).toBeGreaterThan(20);
  });

  test("KOA_DETECTORS detects Koa code", async () => {
    const { KOA_DETECTORS } = await import("../src/migrate-koa");

    const koaCode = `const Koa = require("koa");
const app = new Koa();
app.use(async (ctx) => {
  ctx.body = { ok: true };
  ctx.status = 200;
});`;
    const detected = KOA_DETECTORS.some((p) => p.test(koaCode));
    expect(detected).toBe(true);
  });

  test("KOA_DETECTORS does not detect non-Koa code", async () => {
    const { KOA_DETECTORS } = await import("../src/migrate-koa");

    const nonKoaCode = `import { Asi } from "asijs";
const app = new Asi();
app.get("/", (ctx) => "ok");`;
    const detected = KOA_DETECTORS.some((p) => p.test(nonKoaCode));
    expect(detected).toBe(false);
  });

  test("codemod transforms Koa ctx.body assignment", async () => {
    const { transformSource } = await import("../src/codemod");
    const code = `app.use(async (ctx) => {
  ctx.body = { message: "ok" };
});`;

    const { result } = transformSource(code, "koa", false);
    expect(result).toContain("return { message: \"ok\" }");
  });

  test("codemod transforms Koa ctx.status = N", async () => {
    const { transformSource } = await import("../src/codemod");
    const code = `ctx.status = 404;
ctx.body = { error: "not found" };`;

    const { result } = transformSource(code, "koa", false);
    expect(result).toContain("ctx.status(404)");
    expect(result).toContain("return { error: \"not found\" }");
  });

  test("codemod transforms Koa ctx.throw()", async () => {
    const { transformSource } = await import("../src/codemod");
    const code = `ctx.throw(400, "bad request");`;

    const { result } = transformSource(code, "koa", false);
    expect(result).toContain("ctx.status(400).jsonResponse(");
  });

  test("codemod transforms Koa ctx.set()", async () => {
    const { transformSource } = await import("../src/codemod");
    const code = `ctx.set("X-Custom", "value");`;

    const { result } = transformSource(code, "koa", false);
    expect(result).toContain('ctx.setHeader("X-Custom", "value")');
  });

  test("codemod transforms Koa import", async () => {
    const { transformSource } = await import("../src/codemod");
    const code = `import Koa from "koa";`;

    const { result } = transformSource(code, "koa", false);
    expect(result).toContain("import { Asi } from \"asijs\"");
  });
});

// ============================================================================
// Integration — Codemod detects framework correctly
// ============================================================================

describe("Codemod framework detection", () => {
  test("detectFramework detects Express code", async () => {
    const { detectFramework } = await import("../src/codemod");
    const code = `import express from "express";`;
    expect(detectFramework(code)).toBe("express");
  });

  test("detectFramework detects Koa code", async () => {
    const { detectFramework } = await import("../src/codemod");
    const code = `import Koa from "koa";`;
    expect(detectFramework(code)).toBe("koa");
  });

  test("detectFramework returns null for unknown code", async () => {
    const { detectFramework } = await import("../src/codemod");
    const code = `import { something } from "somewhere";`;
    expect(detectFramework(code)).toBeNull();
  });
});
