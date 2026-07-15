import { describe, expect, it } from "bun:test";
import { Asi, apiSecurity, generateNonce, security, securityHeaders } from "../src";

describe("security.ts", () => {
  it("security() applies default protection headers", async () => {
    const app = new Asi();
    await app.plugin(security());
    app.get("/", () => "ok");

    const response = await app.handle(new Request("http://localhost/"));

    expect(response.headers.get("Content-Security-Policy")).toContain(
      "default-src 'self'",
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
  });

  it("securityHeaders() can emit CSP, HSTS and COEP together", async () => {
    const app = new Asi();
    app.use(
      securityHeaders({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "https://cdn.example.com"],
          },
        },
        hsts: {
          maxAge: 31536000,
          includeSubDomains: true,
          preload: true,
        },
        crossOriginEmbedderPolicy: "require-corp",
      }),
    );
    app.get("/", () => "secure");

    const response = await app.handle(new Request("https://localhost/"));

    expect(response.headers.get("Content-Security-Policy")).toContain(
      "script-src 'self' https://cdn.example.com",
    );
    expect(response.headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains; preload",
    );
    expect(response.headers.get("Cross-Origin-Embedder-Policy")).toBe(
      "require-corp",
    );
  });

  it("apiSecurity preset disables CSP for API responses", async () => {
    const app = new Asi();
    await app.plugin(security(apiSecurity));
    app.get("/", () => ({ ok: true }));

    const response = await app.handle(new Request("https://localhost/"));

    expect(response.headers.get("Content-Security-Policy")).toBeNull();
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("generateNonce() returns unique base64 nonces", () => {
    const nonceA = generateNonce();
    const nonceB = generateNonce();

    expect(nonceA).not.toBe(nonceB);
    expect(nonceA.length).toBeGreaterThan(10);
    expect(nonceA).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});
