import { describe, test, expect } from "bun:test";
import { Asi } from "../src/asi";
import {
  SecurityManager,
  parseSize,
  maxSecurity,
  apiSecurityCore,
  devSecurity,
  type SecurityConfig,
} from "../src/security-core";
import { buildSecurityHeaders, securityHeaders, strictSecurity } from "../src/security";

// ============================================================================
// parseSize
// ============================================================================

describe("parseSize()", () => {
  test("parses bytes", () => {
    expect(parseSize("500b")).toBe(500);
    expect(parseSize("0b")).toBe(0);
  });

  test("parses kilobytes", () => {
    expect(parseSize("1kb")).toBe(1024);
    expect(parseSize("256kb")).toBe(262144);
  });

  test("parses megabytes", () => {
    expect(parseSize("1mb")).toBe(1048576);
    expect(parseSize("10mb")).toBe(10485760);
  });

  test("parses gigabytes", () => {
    expect(parseSize("1gb")).toBe(1073741824);
  });

  test("handles numeric input", () => {
    expect(parseSize(5000)).toBe(5000);
    expect(parseSize(0)).toBe(0);
  });

  test("returns 0 for false (disabled)", () => {
    expect(parseSize(false)).toBe(0);
  });

  test("returns 0 for invalid strings", () => {
    expect(parseSize("invalid")).toBe(0);
    expect(parseSize("10xyz")).toBe(0);
  });

  test("is case-insensitive", () => {
    expect(parseSize("1MB")).toBe(1048576);
    expect(parseSize("10KB")).toBe(10240);
  });
});

// ============================================================================
// SecurityManager — constructor and getters
// ============================================================================

describe("SecurityManager", () => {
  test("applies defaults when config is true", () => {
    const mgr = new SecurityManager(true);
    const cfg = mgr.getConfig();

    expect(cfg.autoEscape).toBe(true);
    expect(cfg.maxBodySize).toBe("1mb");
    expect(cfg.autoNonce).toBe(true);
    expect(cfg.strictContentType).toBe("json-only");
    expect(cfg.headers).toBe(true);
    expect(cfg.warnInDev).toBe(true);
    expect(cfg.xssScan).toBe(true);
    expect(Array.isArray(cfg.skipPaths)).toBe(true);
  });

  test("merges custom config with defaults", () => {
    const mgr = new SecurityManager({ autoEscape: false, maxBodySize: "10mb" });
    const cfg = mgr.getConfig();

    expect(cfg.autoEscape).toBe(false);
    expect(cfg.maxBodySize).toBe("10mb");
    expect(cfg.autoNonce).toBe(true); // Default
    expect(cfg.strictContentType).toBe("json-only"); // Default
  });

  test("getMaxBodySize returns bytes", () => {
    const mgr = new SecurityManager({ maxBodySize: "2mb" });
    expect(mgr.getMaxBodySize()).toBe(2097152);
  });

  test("getMaxBodySize returns 0 when disabled", () => {
    const mgr = new SecurityManager({ maxBodySize: false });
    expect(mgr.getMaxBodySize()).toBe(0);
  });

  test("shouldSkip matches paths correctly", () => {
    const mgr = new SecurityManager({ skipPaths: ["/webhooks", "/health"] });

    expect(mgr.shouldSkip("/webhooks/stripe")).toBe(true);
    expect(mgr.shouldSkip("/health")).toBe(true);
    expect(mgr.shouldSkip("/api/users")).toBe(false);
    expect(mgr.shouldSkip("/")).toBe(false);
  });

  test("buildMiddleware returns middleware array", () => {
    const mgr = new SecurityManager(true);
    const mw = mgr.buildMiddleware({ development: true });

    expect(Array.isArray(mw)).toBe(true);
    expect(mw.length).toBeGreaterThanOrEqual(3); // At least body size, contentType, nonce, headers
  });

  test("buildMiddleware returns fewer middleware when features disabled", () => {
    const mgr = new SecurityManager({
      autoEscape: false,
      maxBodySize: false,
      autoNonce: false,
      strictContentType: false,
      headers: false,
      warnInDev: false,
      xssScan: false,
    });
    const mw = mgr.buildMiddleware();

    // No middleware at all — the skip wrapper NOOP is not added when there
    // are no skip paths (2.2.4 optimization: no no-op hops on the hot path)
    expect(mw.length).toBe(0);
  });
});

// ============================================================================
// Presets
// ============================================================================

describe("Security presets", () => {
  test("maxSecurity has strictest settings", () => {
    expect(maxSecurity.autoEscape).toBe(true);
    expect(maxSecurity.maxBodySize).toBe("256kb");
    expect(maxSecurity.autoNonce).toBe(true);
    expect(maxSecurity.strictContentType).toBe("strict");
    expect(maxSecurity.xssScan).toBe(true);
  });

  test("apiSecurityCore is optimized for APIs", () => {
    expect(apiSecurityCore.autoEscape).toBe(true);
    expect(apiSecurityCore.maxBodySize).toBe("10mb");
    expect(apiSecurityCore.autoNonce).toBe(false);
    expect(apiSecurityCore.strictContentType).toBe("json-only");
    expect(apiSecurityCore.xssScan).toBe(false);
  });

  test("devSecurity is relaxed", () => {
    expect(devSecurity.autoEscape).toBe(true);
    expect(devSecurity.maxBodySize).toBe("100mb");
    expect(devSecurity.autoNonce).toBe(false);
    expect(devSecurity.strictContentType).toBe("loose");
    expect(devSecurity.headers).toBe(false);
  });
});

// ============================================================================
// Integration with AsiConfig
// ============================================================================

describe("Integration with AsiConfig", () => {
  test("creates app with security: true", () => {
    const app = new Asi({ silent: true, security: true });
    app.get("/", () => "hello");
    expect(app).toBeDefined();
  });

  test("creates app with security config object", () => {
    const app = new Asi({
      silent: true,
      security: {
        autoEscape: true,
        maxBodySize: "5mb",
        autoNonce: false,
        strictContentType: "json-only",
      },
    });
    app.get("/test", () => "ok");
    expect(app).toBeDefined();
  });

  test("creates app with security: false (no security)", () => {
    const app = new Asi({ silent: true, security: false });
    app.get("/", () => "hello");
    expect(app).toBeDefined();
  });

  test("auto-escape escapes HTML in string responses when security is true", async () => {
    const app = new Asi({ silent: true, security: { autoEscape: true, maxBodySize: false, autoNonce: false, strictContentType: false, headers: false, warnInDev: false, xssScan: false, skipPaths: [] } });
    app.get("/xss", () => '<script>alert("xss")</script>');

    const res = await app.handle(new Request("http://localhost/xss"));
    const body = await res.text();

    expect(body).not.toContain("<script>");
    expect(body).toContain("&lt;script&gt;");
    expect(body).toContain("&quot;xss&quot;");
  });

  test("auto-escape escapes HTML in string responses with numbers/booleans", async () => {
    const app = new Asi({ silent: true, security: { autoEscape: true, maxBodySize: false, autoNonce: false, strictContentType: false, headers: false, warnInDev: false, xssScan: false, skipPaths: [] } });
    app.get("/number", () => 123 as unknown as string);
    app.get("/bool", () => true as unknown as string);

    const numRes = await app.handle(new Request("http://localhost/number"));
    expect(await numRes.text()).toBe("123");

    const boolRes = await app.handle(new Request("http://localhost/bool"));
    expect(await boolRes.text()).toBe("true");
  });

  test("auto-escape does not affect JSON responses", async () => {
    const app = new Asi({ silent: true, security: { autoEscape: true, maxBodySize: false, autoNonce: false, strictContentType: false, headers: false, warnInDev: false, xssScan: false, skipPaths: [] } });
    app.get("/json", () => ({ message: "<script>alert(1)</script>" }));

    const res = await app.handle(new Request("http://localhost/json"));
    const body = await res.json();

    // JSON should NOT be escaped
    expect(body.message).toBe("<script>alert(1)</script>");
  });

  test("auto-escape does not affect Response objects", async () => {
    const app = new Asi({ silent: true, security: { autoEscape: true, maxBodySize: false, autoNonce: false, strictContentType: false, headers: false, warnInDev: false, xssScan: false, skipPaths: [] } });
    app.get("/response", () => new Response("<b>bold</b>", {
      headers: { "Content-Type": "text/html" },
    }));

    const res = await app.handle(new Request("http://localhost/response"));
    const body = await res.text();

    // Response objects should not be escaped (they may be intentional HTML)
    expect(body).toBe("<b>bold</b>");
  });

  test("body size limit rejects large requests", async () => {
    const app = new Asi({ silent: true, security: { maxBodySize: "100b", autoEscape: false, autoNonce: false, strictContentType: false, headers: false, warnInDev: false, xssScan: false, skipPaths: [] } });
    app.post("/submit", async (ctx) => {
      const body = await ctx.json();
      return { received: true };
    });

    // Request with large body (Content-Length exceeds limit)
    const res = await app.handle(
      new Request("http://localhost/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": "500" },
        body: JSON.stringify({ data: "x".repeat(500) }),
      }),
    );

    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json.error).toBe("Request Entity Too Large");
  });

  test("body size limit allows valid requests", async () => {
    const app = new Asi({ silent: true, security: { maxBodySize: "10mb", autoEscape: false, autoNonce: false, strictContentType: false, headers: false, warnInDev: false, xssScan: false, skipPaths: [] } });
    app.post("/submit", async (ctx) => {
      const body = await ctx.json();
      return { received: body.name };
    });

    const res = await app.handle(
      new Request("http://localhost/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "test" }),
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe("test");
  });

  test("strictContentType rejects non-JSON on mutating methods", async () => {
    const app = new Asi({ silent: true, security: { strictContentType: "json-only", autoEscape: false, maxBodySize: false, autoNonce: false, headers: false, warnInDev: false, xssScan: false, skipPaths: [] } });
    app.post("/data", async (ctx) => ({ ok: true }));

    const res = await app.handle(
      new Request("http://localhost/data", {
        method: "POST",
        headers: { "Content-Type": "text/html" },
        body: "<html></html>",
      }),
    );

    expect(res.status).toBe(415);
    const json = await res.json();
    expect(json.error).toBe("Unsupported Media Type");
  });

  test("strictContentType allows GET/HEAD/DELETE without checking", async () => {
    const app = new Asi({ silent: true, security: { strictContentType: "json-only", autoEscape: false, maxBodySize: false, autoNonce: false, headers: false, warnInDev: false, xssScan: false, skipPaths: [] } });
    app.get("/items", () => [{ id: 1 }]);
    app.delete("/items/1", () => ({ deleted: true }));

    const getRes = await app.handle(
      new Request("http://localhost/items", {
        headers: { "Content-Type": "text/plain" },
      }),
    );
    expect(getRes.status).toBe(200);

    const delRes = await app.handle(
      new Request("http://localhost/items/1", {
        method: "DELETE",
        headers: { "Content-Type": "text/plain" },
      }),
    );
    expect(delRes.status).toBe(200);
  });

  test("strictContentType allows form data", async () => {
    const app = new Asi({ silent: true, security: { strictContentType: "json-only", autoEscape: false, maxBodySize: false, autoNonce: false, headers: false, warnInDev: false, xssScan: false, skipPaths: [] } });
    app.post("/form", async (ctx) => {
      const fd = await ctx.formData();
      return { name: fd.get("name") };
    });

    const formData = new FormData();
    formData.append("name", "test");

    const res = await app.handle(
      new Request("http://localhost/form", {
        method: "POST",
        body: formData,
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.name).toBe("test");
  });

  test("security headers are applied when headers: true", async () => {
    const app = new Asi({ silent: true, security: { headers: true, autoEscape: false, maxBodySize: false, autoNonce: false, strictContentType: false, warnInDev: false, xssScan: false, skipPaths: [] } });
    app.get("/", () => "hello");

    const res = await app.handle(new Request("http://localhost/"));
    const headers = res.headers;

    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-XSS-Protection")).toBe("0");
    expect(headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(headers.get("Content-Security-Policy")).toBeTruthy();
  });

  test("autoNonce adds cspNonce to ctx.store", async () => {
    const app = new Asi({ silent: true, security: { autoNonce: true, autoEscape: false, maxBodySize: false, strictContentType: false, headers: false, warnInDev: false, xssScan: false, skipPaths: [] } });
    app.get("/nonce", (ctx) => {
      return { nonce: (ctx.store as any).cspNonce };
    });

    const res = await app.handle(new Request("http://localhost/nonce"));
    const json = await res.json();

    expect(json.nonce).toBeTruthy();
    expect(typeof json.nonce).toBe("string");
    expect(json.nonce.length).toBeGreaterThan(10);
  });

  test("skipPaths bypasses security middleware", async () => {
    const app = new Asi({ silent: true, security: { strictContentType: "json-only", skipPaths: ["/webhooks"], autoEscape: false, maxBodySize: false, autoNonce: false, headers: false, warnInDev: false, xssScan: false } });
    app.post("/webhooks/stripe", async (ctx) => {
      return { received: true };
    });

    // Should NOT be rejected even though it's a POST without JSON content type
    const res = await app.handle(
      new Request("http://localhost/webhooks/stripe", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "raw data",
      }),
    );

    expect(res.status).toBe(200);
  });

  test("security: false disables all protections", async () => {
    const app = new Asi({ silent: true, security: false });
    app.get("/", () => "<script>alert(1)</script>");

    const res = await app.handle(new Request("http://localhost/"));
    const body = await res.text();

    // No auto-escape
    expect(body).toContain("<script>");
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("Edge cases", () => {
  test("presets are valid SecurityConfig objects", () => {
    const presets: SecurityConfig[] = [maxSecurity, apiSecurityCore, devSecurity];
    for (const preset of presets) {
      expect(preset).toBeDefined();
      expect(typeof preset).toBe("object");
    }
  });

  test("SecurityManager handles boolean true correctly", () => {
    const mgr = new SecurityManager(true);
    expect(mgr.getConfig().autoEscape).toBe(true);
    expect(mgr.getConfig().maxBodySize).toBe("1mb");
  });

  test("body size limit accepts requests without Content-Length", async () => {
    const app = new Asi({ silent: true, security: { maxBodySize: "1mb", autoEscape: false, autoNonce: false, strictContentType: false, headers: false, warnInDev: false, xssScan: false, skipPaths: [] } });
    app.get("/no-length", () => "ok");

    const res = await app.handle(new Request("http://localhost/no-length"));
    expect(res.status).toBe(200);
  });

  test("works with compiled routes", () => {
    const app = new Asi({ silent: true, security: true });
    app.get("/", () => "hello");
    app.compile();
    expect(app).toBeDefined();
  });
});

// ============================================================================
// 2.2.4 — Security Headers: Pre-built Response
// ============================================================================

describe("buildSecurityHeaders (pre-built static headers)", () => {
  test("returns a reusable header pairs array", () => {
    const { headers, hstsHeader } = buildSecurityHeaders(strictSecurity);
    expect(Array.isArray(headers)).toBe(true);
    expect(headers.length).toBeGreaterThan(5);
    expect(hstsHeader).toContain("max-age");

    // Pairs are [name, value]
    for (const [name, value] of headers) {
      expect(typeof name).toBe("string");
      expect(typeof value).toBe("string");
      expect(name.length).toBeGreaterThan(0);
    }
  });

  test("includes the CSP header from config", () => {
    const { headers } = buildSecurityHeaders(strictSecurity);
    const csp = headers.find(([n]) => n === "Content-Security-Policy");
    expect(csp).toBeDefined();
    expect(csp![1]).toContain("default-src");
  });

  test("returns empty array when all headers disabled", () => {
    const { headers } = buildSecurityHeaders({
      contentSecurityPolicy: false,
      noSniff: false,
      frameOptions: false,
      xssFilter: false,
      referrerPolicy: false,
      dnsPrefetchControl: false,
      ieNoOpen: false,
      crossDomainPolicy: false,
      originAgentCluster: false,
    });
    expect(headers.length).toBe(0);
  });

  test("hstsHeader is null when hsts disabled", () => {
    const { hstsHeader } = buildSecurityHeaders({ hsts: false });
    expect(hstsHeader).toBeNull();
  });
});

describe("securityHeaders middleware (2.2.4 optimizations)", () => {
  test("applies pre-built headers to the response", async () => {
    const app = new Asi({ silent: true } as any);
    app.use(securityHeaders(strictSecurity));
    app.get("/", () => "hello");

    const res = await app.handle(new Request("http://localhost/"));
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors");
  });

  test("does not allocate a URL for HSTS check on http", async () => {
    const app = new Asi({ silent: true } as any);
    app.use(securityHeaders(strictSecurity));
    app.get("/", () => "hello");

    const res = await app.handle(new Request("http://localhost/"));
    // HSTS only applied over https
    expect(res.headers.get("Strict-Transport-Security")).toBeNull();
  });

  test("applies HSTS over https", async () => {
    const app = new Asi({ silent: true } as any);
    app.use(securityHeaders(strictSecurity));
    app.get("/", () => "hello");

    const res = await app.handle(
      new Request("https://localhost/"),
    );
    expect(res.headers.get("Strict-Transport-Security")).toContain("max-age");
  });
});

describe("nonce path detection (2.2.4)", () => {
  const sec = {
    autoNonce: true,
    autoEscape: false,
    maxBodySize: false,
    strictContentType: false,
    headers: false,
    warnInDev: false,
    xssScan: false,
    skipPaths: [],
  };

  test("skips nonce generation for JSON-only Accept", async () => {
    const app = new Asi({ silent: true, security: sec } as any);
    app.get("/api", (ctx) => {
      return { nonce: (ctx.store as any).cspNonce ?? null };
    });

    const res = await app.handle(
      new Request("http://localhost/api", {
        headers: { accept: "application/json" },
      }),
    );
    const json = await res.json();
    // JSON client — no nonce generated (saves crypto per request)
    expect(json.nonce).toBeNull();
  });

  test("generates nonce for HTML-capable Accept", async () => {
    const app = new Asi({ silent: true, security: sec } as any);
    app.get("/page", (ctx) => {
      return { nonce: (ctx.store as any).cspNonce ?? null };
    });

    const res = await app.handle(
      new Request("http://localhost/page", {
        headers: { accept: "text/html" },
      }),
    );
    const json = await res.json();
    expect(json.nonce).toBeTruthy();
  });

  test("generates nonce when no Accept header sent", async () => {
    const app = new Asi({ silent: true, security: sec } as any);
    app.get("/bare", (ctx) => {
      return { nonce: (ctx.store as any).cspNonce ?? null };
    });

    const res = await app.handle(new Request("http://localhost/bare"));
    const json = await res.json();
    expect(json.nonce).toBeTruthy();
  });

  test("injects nonce into CSP only for HTML responses", async () => {
    const app = new Asi({
      silent: true,
      security: { ...sec, headers: strictSecurity },
    } as any);
    app.get("/page", () =>
      new Response("<html><body>hi</body></html>", {
        headers: { "Content-Type": "text/html" },
      }),
    );
    app.get("/json", () => ({ ok: true }));

    // HTML response → CSP gets the nonce
    const htmlRes = await app.handle(
      new Request("http://localhost/page", {
        headers: { accept: "text/html" },
      }),
    );
    const csp = htmlRes.headers.get("Content-Security-Policy");
    expect(csp).toContain("nonce-");

    // JSON response → CSP untouched (no nonce injected)
    const jsonRes = await app.handle(
      new Request("http://localhost/json", {
        headers: { accept: "application/json" },
      }),
    );
    const jsonCsp = jsonRes.headers.get("Content-Security-Policy");
    expect(jsonCsp).not.toContain("nonce-");
  });
});

describe("security middleware chain (2.2.4)", () => {
  test("does not add no-op middleware hops when features disabled", () => {
    const mgr = new SecurityManager({
      autoEscape: false,
      maxBodySize: false,
      autoNonce: false,
      strictContentType: false,
      headers: true,
      warnInDev: false,
      xssScan: true, // default patterns → passthrough, not added
      skipPaths: [],
    });
    const mw = mgr.buildMiddleware();
    // Only the headers middleware — no skip wrapper, no xssScan no-op
    expect(mw.length).toBe(1);
  });

  test("adds xssScan middleware when custom patterns supplied", () => {
    const mgr = new SecurityManager({
      autoEscape: false,
      maxBodySize: false,
      autoNonce: false,
      strictContentType: false,
      headers: false,
      warnInDev: false,
      xssScan: [/custom\s*=/i],
      skipPaths: [],
    });
    const mw = mgr.buildMiddleware();
    expect(mw.length).toBe(1);
  });

  test("adds skip wrapper when skipPaths configured", () => {
    const mgr = new SecurityManager({
      autoEscape: false,
      maxBodySize: false,
      autoNonce: false,
      strictContentType: false,
      headers: false,
      warnInDev: false,
      xssScan: false,
      skipPaths: ["/webhooks"],
    });
    const mw = mgr.buildMiddleware();
    expect(mw.length).toBe(1);
  });
});
