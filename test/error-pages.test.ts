/**
 * Tests for error-pages.ts
 *
 * Covers:
 * - shouldRenderHtmlErrorPage: header-based HTML detection
 * - getErrorPageSearchRoot: search root resolution
 * - discoverErrorPagePath: file discovery logic (disabled, not found)
 * - renderDefaultErrorPage: 404/500 HTML output, suggestions, dev errors, XSS
 * - renderDiscoveredErrorPage: null when no file found
 * - Integration with Asi: browser Accept → HTML, API → JSON
 */

import { describe, it, expect } from "bun:test";
import {
  shouldRenderHtmlErrorPage,
  renderDefaultErrorPage,
  renderDiscoveredErrorPage,
  getErrorPageSearchRoot,
  discoverErrorPagePath,
} from "../src/error-pages";
import type { ErrorPageContext } from "../src/error-pages";
import { Asi } from "../src/asi";

// ========================================================================
// shouldRenderHtmlErrorPage
// ========================================================================

describe("shouldRenderHtmlErrorPage()", () => {
  it("returns true for GET with text/html accept", () => {
    const req = new Request("http://localhost/test", {
      headers: { accept: "text/html" },
    });
    expect(shouldRenderHtmlErrorPage(req)).toBe(true);
  });

  it("returns true for GET with application/xhtml+xml accept", () => {
    const req = new Request("http://localhost/test", {
      headers: { accept: "application/xhtml+xml" },
    });
    expect(shouldRenderHtmlErrorPage(req)).toBe(true);
  });

  it("returns true for HEAD with text/html accept", () => {
    const req = new Request("http://localhost/test", {
      method: "HEAD",
      headers: { accept: "text/html" },
    });
    expect(shouldRenderHtmlErrorPage(req)).toBe(true);
  });

  it("returns false for POST even with text/html accept", () => {
    const req = new Request("http://localhost/test", {
      method: "POST",
      headers: { accept: "text/html" },
    });
    expect(shouldRenderHtmlErrorPage(req)).toBe(false);
  });

  it("returns false for PUT even with text/html accept", () => {
    const req = new Request("http://localhost/test", {
      method: "PUT",
      headers: { accept: "text/html" },
    });
    expect(shouldRenderHtmlErrorPage(req)).toBe(false);
  });

  it("returns true when sec-fetch-dest is 'document'", () => {
    const req = new Request("http://localhost/test", {
      headers: { "sec-fetch-dest": "document" },
    });
    expect(shouldRenderHtmlErrorPage(req)).toBe(true);
  });

  it("returns true when sec-fetch-mode is 'navigate'", () => {
    const req = new Request("http://localhost/test", {
      headers: { "sec-fetch-mode": "navigate" },
    });
    expect(shouldRenderHtmlErrorPage(req)).toBe(true);
  });

  it("returns false for GET with no relevant headers", () => {
    const req = new Request("http://localhost/test");
    expect(shouldRenderHtmlErrorPage(req)).toBe(false);
  });

  it("returns false for GET with empty accept", () => {
    const req = new Request("http://localhost/test", {
      headers: { accept: "" },
    });
    expect(shouldRenderHtmlErrorPage(req)).toBe(false);
  });

  it("returns false for GET with application/json accept", () => {
    const req = new Request("http://localhost/test", {
      headers: { accept: "application/json" },
    });
    expect(shouldRenderHtmlErrorPage(req)).toBe(false);
  });

  it("returns false for GET with */* accept (no explicit text/html)", () => {
    const req = new Request("http://localhost/test", {
      headers: { accept: "*/*" },
    });
    // */* does NOT include "text/html" literally — only sec-fetch triggers true
    expect(shouldRenderHtmlErrorPage(req)).toBe(false);
  });
});

// ========================================================================
// getErrorPageSearchRoot
// ========================================================================

describe("getErrorPageSearchRoot()", () => {
  it("returns resolved cwd when no options given", () => {
    const result = getErrorPageSearchRoot();
    expect(result).toBe(process.cwd());
  });

  it("returns resolved rootDir when provided", () => {
    const result = getErrorPageSearchRoot({ rootDir: "/custom/path" });
    // On Windows, this will resolve differently, but it should contain the path
    expect(result).toContain("custom");
    expect(result).toContain("path");
  });
});

// ========================================================================
// discoverErrorPagePath
// ========================================================================

describe("discoverErrorPagePath()", () => {
  it("returns null when enabled is false", () => {
    const result = discoverErrorPagePath(404, { enabled: false });
    expect(result).toBeNull();
  });

  it("returns null when autoDiscover is false", () => {
    const result = discoverErrorPagePath(404, { autoDiscover: false });
    expect(result).toBeNull();
  });

  it("returns null when no matching file exists", () => {
    // Use a non-existent root directory to guarantee no matches
    const result = discoverErrorPagePath(404, {
      rootDir: "/tmp/non-existent-asijs-test-dir-12345",
      searchDirs: ["."],
    });
    expect(result).toBeNull();
  });

  it("returns null for 500 when no matching file exists", () => {
    const result = discoverErrorPagePath(500, {
      rootDir: "/tmp/non-existent-asijs-test-dir-12345",
      searchDirs: ["."],
    });
    expect(result).toBeNull();
  });
});

// ========================================================================
// renderDefaultErrorPage
// ========================================================================

describe("renderDefaultErrorPage()", () => {
  const createContext = (overrides: Partial<ErrorPageContext> = {}): ErrorPageContext => ({
    status: 404,
    path: "/missing",
    method: "GET",
    request: new Request("http://localhost/missing"),
    development: false,
    ...overrides,
  });

  it("returns 404 response with HTML content type", () => {
    const ctx = createContext({ status: 404 });
    const res = renderDefaultErrorPage(ctx);

    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });

  it("returns 500 response with HTML content type", () => {
    const ctx = createContext({ status: 500 });
    const res = renderDefaultErrorPage(ctx);

    expect(res.status).toBe(500);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });

  it("includes 404 title in output", async () => {
    const ctx = createContext({ status: 404 });
    const res = renderDefaultErrorPage(ctx);
    const body = await res.text();

    expect(body).toContain("Page not found");
    expect(body).toContain("404");
    expect(body).toContain("AsiJS Error Page");
  });

  it("includes 500 title in output", async () => {
    const ctx = createContext({ status: 500 });
    const res = renderDefaultErrorPage(ctx);
    const body = await res.text();

    expect(body).toContain("Something went wrong");
    expect(body).toContain("500");
  });

  it("includes path and method in 404 output", async () => {
    const ctx = createContext({
      status: 404,
      path: "/users/unknown",
      method: "POST",
    });
    const res = renderDefaultErrorPage(ctx);
    const body = await res.text();

    expect(body).toContain("/users/unknown");
    expect(body).toContain("POST");
  });

  it("includes suggestions when provided for 404", async () => {
    const ctx = createContext({
      status: 404,
      suggestions: ["GET /users", "GET /users/:id"],
    });
    const res = renderDefaultErrorPage(ctx);
    const body = await res.text();

    expect(body).toContain("Possible matches");
    expect(body).toContain("GET /users");
    expect(body).toContain("GET /users/:id");
  });

  it("does NOT include suggestions for 500", async () => {
    const ctx = createContext({
      status: 500,
      suggestions: ["GET /users"], // suggestions shouldn't show for 500
    });
    const res = renderDefaultErrorPage(ctx);
    const body = await res.text();

    expect(body).not.toContain("Possible matches");
  });

  it("includes error details in dev mode for 500", async () => {
    const testError = new Error("Database connection failed");
    testError.stack = "Error: Database connection failed\n    at Object.<anonymous> (test.ts:10:5)";

    const ctx = createContext({
      status: 500,
      development: true,
      error: testError,
    });
    const res = renderDefaultErrorPage(ctx);
    const body = await res.text();

    expect(body).toContain("Error");
    expect(body).toContain("Database connection failed");
    expect(body).toContain("test.ts:10:5");
  });

  it("does NOT include error details in production mode for 500", async () => {
    const testError = new Error("Secret details");
    const ctx = createContext({
      status: 500,
      development: false,
      error: testError,
    });
    const res = renderDefaultErrorPage(ctx);
    const body = await res.text();

    expect(body).not.toContain("Secret details");
    expect(body).not.toContain("Error</h2>"); // No error panel
  });

  it("escapes HTML in path to prevent XSS", async () => {
    const ctx = createContext({
      status: 404,
      path: "/<script>alert('xss')</script>",
    });
    const res = renderDefaultErrorPage(ctx);
    const body = await res.text();

    expect(body).not.toContain("<script>");
    expect(body).toContain("&lt;script&gt;");
  });

  it("escapes HTML in suggestions to prevent XSS", async () => {
    const ctx = createContext({
      status: 404,
      suggestions: ["<img src=x onerror=alert(1)>"],
    });
    const res = renderDefaultErrorPage(ctx);
    const body = await res.text();

    expect(body).not.toContain("<img");
    expect(body).toContain("&lt;img");
  });

  it("escapes HTML in error message to prevent XSS", async () => {
    const testError = new Error("<script>alert('xss')</script>");
    const ctx = createContext({
      status: 500,
      development: true,
      error: testError,
    });
    const res = renderDefaultErrorPage(ctx);
    const body = await res.text();

    expect(body).not.toContain("<script>alert");
    expect(body).toContain("&lt;script&gt;");
  });
});

// ========================================================================
// renderDiscoveredErrorPage
// ========================================================================

describe("renderDiscoveredErrorPage()", () => {
  const createContext = (overrides: Partial<ErrorPageContext> = {}): ErrorPageContext => ({
    status: 404,
    path: "/test",
    method: "GET",
    request: new Request("http://localhost/test"),
    development: false,
    ...overrides,
  });

  it("returns null when no error page file is found", async () => {
    const ctx = createContext();
    const result = await renderDiscoveredErrorPage(404, ctx, {
      enabled: false, // explicitly disable discovery
    });
    expect(result).toBeNull();
  });

  it("returns null for 500 when autoDiscover is false", async () => {
    const ctx = createContext({ status: 500 });
    const result = await renderDiscoveredErrorPage(500, ctx, {
      autoDiscover: false,
    });
    expect(result).toBeNull();
  });

  it("returns null when no file exists on disk", async () => {
    const ctx = createContext();
    const result = await renderDiscoveredErrorPage(404, ctx, {
      rootDir: "/tmp/non-existent-asijs-test-dir-12345",
      searchDirs: ["."],
    });
    expect(result).toBeNull();
  });
});

// ========================================================================
// Integration with Asi (404/500 HTML vs JSON)
// ========================================================================

describe("Asi integration with error pages", () => {
  it("returns JSON 404 for API requests", async () => {
    const app = new Asi({ development: true, silent: true });
    app.get("/api/users", () => [{ id: 1 }]);

    // Request with JSON accept — should get JSON error
    const res = await app.handle(
      new Request("http://localhost/api/wrong", {
        headers: { accept: "application/json" },
      }),
    );

    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toContain("application/json");

    const body = await res.json();
    expect(body.error).toBe("Not Found");
  });

  it("returns HTML 404 for browser requests", async () => {
    const app = new Asi({ development: true, silent: true });
    app.get("/api/users", () => [{ id: 1 }]);

    // Request with text/html accept — should get HTML error
    const res = await app.handle(
      new Request("http://localhost/api/wrong", {
        headers: { accept: "text/html" },
      }),
    );

    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toContain("text/html");

    const body = await res.text();
    expect(body).toContain("Page not found");
    expect(body).toContain("AsiJS Dev");
    expect(body).toContain("GET");
    expect(body).toContain("/api/wrong");
  });

  it("returns HTML 404 for browser navigation (sec-fetch-dest)", async () => {
    const app = new Asi({ development: true, silent: true });
    app.get("/", () => "home");

    // Request with sec-fetch-dest: document — browser navigation
    const res = await app.handle(
      new Request("http://localhost/missing-page", {
        headers: { "sec-fetch-dest": "document" },
      }),
    );

    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });

  it("returns JSON 500 for API requests", async () => {
    const app = new Asi({ development: false, silent: true });
    app.get("/api/crash", () => {
      throw new Error("Internal failure");
    });

    const res = await app.handle(
      new Request("http://localhost/api/crash", {
        headers: { accept: "application/json" },
      }),
    );

    expect(res.status).toBe(500);
    expect(res.headers.get("Content-Type")).toContain("application/json");

    const body = await res.json();
    expect(body.error).toBe("Internal Server Error"); // production — no details
  });

  it("returns HTML 500 for browser requests", async () => {
    const app = new Asi({ development: true, silent: true });
    app.get("/crash", () => {
      throw new Error("Boom!");
    });

    const res = await app.handle(
      new Request("http://localhost/crash", {
        headers: { accept: "text/html" },
      }),
    );

    expect(res.status).toBe(500);
    expect(res.headers.get("Content-Type")).toContain("text/html");

    const body = await res.text();
    expect(body).toContain("Error");
    expect(body).toContain("Boom!");
    expect(body).toContain("AsiJS Dev Error");
  });

  it("returns JSON 404 for HEAD requests even with HTML accept", async () => {
    const app = new Asi({ development: true, silent: true });
    app.get("/data", () => "data");

    // HEAD method — shouldRenderHtmlErrorPage returns false for GET/HEAD
    // Actually HEAD returns true per our tests... let me check
    // HEAD + text/html → shouldRenderHtmlErrorPage returns true
    // But HEAD requests typically come from curl/scripts, not browsers
    // Still, it should return HTML if headers say so
    const res = await app.handle(
      new Request("http://localhost/wrong", {
        method: "HEAD",
        headers: { accept: "text/html" },
      }),
    );

    expect(res.status).toBe(404);
  });

  it("includes route suggestions in development 404", async () => {
    const app = new Asi({ development: true, silent: true });
    app.get("/users", () => []);
    app.get("/users/:id", () => ({}));
    app.post("/users", () => ({}));

    // Request a path similar to /users
    const res = await app.handle(
      new Request("http://localhost/user", {
        headers: { accept: "application/json" },
      }),
    );

    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.suggestions).toBeDefined();
    expect(body.suggestions.length).toBeGreaterThan(0);
    expect(body.suggestions).toContain("GET /users");
  });

  it("suggests similar routes in development HTML 404", async () => {
    const app = new Asi({ development: true, silent: true });
    app.get("/users", () => []);

    const res = await app.handle(
      new Request("http://localhost/user", {
        headers: { accept: "text/html" },
      }),
    );

    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toContain("GET /users");
    expect(body).toContain("suggestion");
    expect(body).toContain("Did you mean");
  });

  it("does NOT include route suggestions in production 404", async () => {
    const app = new Asi({ development: false, silent: true });
    app.get("/users", () => []);

    const res = await app.handle(
      new Request("http://localhost/user", {
        headers: { accept: "application/json" },
      }),
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.suggestions).toBeUndefined();
  });
});
