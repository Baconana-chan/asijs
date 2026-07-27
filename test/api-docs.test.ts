/**
 * Tests for API Documentation Portal (src/api-docs.ts)
 */

import { describe, test, expect } from "bun:test";

// ========================================================================
// Code Sample Generation
// ========================================================================

describe("generateCodeSamples", () => {
  test("generates curl sample for GET endpoint", async () => {
    const { generateCodeSamples } = await import("../src/api-docs");

    const samples = generateCodeSamples(
      { method: "GET", path: "/users", summary: "List users" },
      "http://localhost:3000",
    );

    const curl = samples.find((s: any) => s.lang === "bash");
    expect(curl).toBeDefined();
    expect(curl!.code).toContain("curl -X GET");
    expect(curl!.code).toContain("http://localhost:3000/users");
    expect(curl!.code).toContain("Content-Type: application/json");
  });

  test("generates curl sample with auth token", async () => {
    const { generateCodeSamples } = await import("../src/api-docs");

    const samples = generateCodeSamples(
      { method: "GET", path: "/users" },
      "http://localhost:3000",
      "my-token-123",
    );

    const curl = samples.find((s: any) => s.lang === "bash");
    expect(curl!.code).toContain("Bearer my-token-123");
  });

  test("generates curl sample with request body", async () => {
    const { generateCodeSamples } = await import("../src/api-docs");

    const samples = generateCodeSamples(
      {
        method: "POST",
        path: "/users",
        requestBody: { required: true, schema: { type: "object", properties: { name: { type: "string" } } } },
      },
      "http://localhost:3000",
    );

    const curl = samples.find((s: any) => s.lang === "bash");
    expect(curl!.code).toContain("-d '");
    expect(curl!.code).toContain("POST");
  });

  test("generates JavaScript sample", async () => {
    const { generateCodeSamples } = await import("../src/api-docs");

    const samples = generateCodeSamples(
      { method: "GET", path: "/api/data" },
      "https://api.example.com",
    );

    const js = samples.find((s: any) => s.lang === "javascript");
    expect(js).toBeDefined();
    expect(js!.code).toContain("fetch(");
    expect(js!.code).toContain("https://api.example.com/api/data");
  });

  test("generates Python sample", async () => {
    const { generateCodeSamples } = await import("../src/api-docs");

    const samples = generateCodeSamples(
      { method: "POST", path: "/items" },
      "http://localhost:3000",
    );

    const py = samples.find((s: any) => s.lang === "python");
    expect(py).toBeDefined();
    expect(py!.code).toContain("import requests");
    expect(py!.code).toContain("requests.post");
  });

  test("generates Go sample", async () => {
    const { generateCodeSamples } = await import("../src/api-docs");

    const samples = generateCodeSamples(
      { method: "DELETE", path: "/users/:id" },
      "http://localhost:3000",
    );

    const go = samples.find((s: any) => s.lang === "go");
    expect(go).toBeDefined();
    expect(go!.code).toContain("net/http");
    expect(go!.code).toContain("DELETE");
  });

  test("generates samples with body example from schema", async () => {
    const { generateCodeSamples } = await import("../src/api-docs");

    const samples = generateCodeSamples(
      {
        method: "PUT",
        path: "/users/:id",
        requestBody: {
          schema: {
            type: "object",
            properties: {
              name: { type: "string" },
              age: { type: "number" },
              active: { type: "boolean" },
            },
          },
        },
      },
      "http://localhost:3000",
    );

    // All samples should have a body
    for (const sample of samples) {
      if (sample.lang !== "bash") {
        expect(sample.code).not.toContain("undefined");
      }
    }
  });
});

// ========================================================================
// Export: Markdown
// ========================================================================

describe("exportToMarkdown", () => {
  test("generates markdown from OpenAPI spec", async () => {
    const { exportToMarkdown } = await import("../src/api-docs");

    const spec: any = {
      openapi: "3.0.3",
      info: {
        title: "Test API",
        version: "1.0.0",
        description: "A test API",
      },
      servers: [{ url: "http://localhost:3000" }],
      paths: {
        "/users": {
          get: {
            summary: "List users",
            parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }],
            responses: { "200": { description: "OK" } },
          },
        },
      },
    };

    const md = exportToMarkdown(spec);
    expect(md).toContain("# Test API");
    expect(md).toContain("1.0.0");
    expect(md).toContain("GET");
    expect(md).toContain("/users");
    expect(md).toContain("List users");
    expect(md).toContain("limit");
  });

  test("handles empty paths", async () => {
    const { exportToMarkdown } = await import("../src/api-docs");

    const spec: any = {
      openapi: "3.0.3",
      info: { title: "Empty", version: "0.0.1" },
      paths: {},
    };

    const md = exportToMarkdown(spec);
    expect(md).toContain("Empty");
  });

  test("includes request body in markdown", async () => {
    const { exportToMarkdown } = await import("../src/api-docs");

    const spec: any = {
      openapi: "3.0.3",
      info: { title: "API", version: "1.0.0" },
      paths: {
        "/items": {
          post: {
            summary: "Create item",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: { type: "object", properties: { name: { type: "string" } } },
                },
              },
            },
            responses: { "201": { description: "Created" } },
          },
        },
      },
    };

    const md = exportToMarkdown(spec);
    expect(md).toContain("Request Body");
    expect(md).toContain("name");
  });
});

// ========================================================================
// Export: HTML
// ========================================================================

describe("exportToHTML", () => {
  test("generates HTML from OpenAPI spec", async () => {
    const { exportToHTML } = await import("../src/api-docs");

    const spec: any = {
      openapi: "3.0.3",
      info: { title: "Test API", version: "2.0.0" },
      paths: {
        "/test": {
          get: { summary: "Test endpoint", responses: { "200": { description: "OK" } } },
        },
      },
    };

    const html = exportToHTML(spec);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Test API");
    expect(html).toContain("2.0.0");
    expect(html).toContain("</html>");
  });

  test("applies custom theme", async () => {
    const { exportToHTML } = await import("../src/api-docs");

    const spec: any = {
      openapi: "3.0.3",
      info: { title: "Theme Test", version: "1.0.0" },
      paths: {},
    };

    const html = exportToHTML(spec, { theme: "dark" });
    expect(html).toContain('data-theme="dark"');
  });
});

// ========================================================================
// Changelog / Version Diff
// ========================================================================

describe("ApiChangelog", () => {
  test("creates and retrieves snapshots", async () => {
    const { ApiChangelog } = await import("../src/api-docs");

    const cl = new ApiChangelog();
    const snap = cl.snapshot("1.0.0", [
      { method: "GET", path: "/users", summary: "List" },
    ]);

    expect(snap.version).toBe("1.0.0");
    expect(snap.endpoints.length).toBe(1);
    expect(snap.endpoints[0].path).toBe("/users");

    const retrieved = cl.getSnapshot("1.0.0");
    expect(retrieved).toBeDefined();
    expect(retrieved!.version).toBe("1.0.0");
  });

  test("diff detects added endpoints", async () => {
    const { ApiChangelog } = await import("../src/api-docs");

    const cl = new ApiChangelog();
    cl.snapshot("1.0.0", [{ method: "GET", path: "/users" }]);
    cl.snapshot("2.0.0", [
      { method: "GET", path: "/users" },
      { method: "POST", path: "/users" },
    ]);

    const diff = cl.diff("1.0.0", "2.0.0");
    expect(diff).not.toBeNull();
    expect(diff!.added.length).toBe(1);
    expect(diff!.added[0].path).toBe("/users");
    expect(diff!.added[0].method).toBe("POST");
    expect(diff!.removed.length).toBe(0);
  });

  test("diff detects removed endpoints", async () => {
    const { ApiChangelog } = await import("../src/api-docs");

    const cl = new ApiChangelog();
    cl.snapshot("1.0.0", [
      { method: "GET", path: "/users" },
      { method: "DELETE", path: "/users/:id" },
    ]);
    cl.snapshot("2.0.0", [{ method: "GET", path: "/users" }]);

    const diff = cl.diff("1.0.0", "2.0.0");
    expect(diff).not.toBeNull();
    expect(diff!.removed.length).toBe(1);
    expect(diff!.removed[0].path).toBe("/users/:id");
  });

  test("diff detects changed endpoints", async () => {
    const { ApiChangelog } = await import("../src/api-docs");

    const cl = new ApiChangelog();
    cl.snapshot("1.0.0", [{ method: "GET", path: "/users", summary: "Old summary" }]);
    cl.snapshot("2.0.0", [{ method: "GET", path: "/users", summary: "New summary" }]);

    const diff = cl.diff("1.0.0", "2.0.0");
    expect(diff).not.toBeNull();
    expect(diff!.changed.length).toBe(1);
    expect(diff!.changed[0].changes.length).toBeGreaterThan(0);
  });

  test("toChangelogMarkdown generates output", async () => {
    const { ApiChangelog } = await import("../src/api-docs");

    const cl = new ApiChangelog();
    cl.snapshot("1.0.0", [{ method: "GET", path: "/health" }]);
    cl.snapshot("1.1.0", [
      { method: "GET", path: "/health" },
      { method: "GET", path: "/users" },
    ]);

    const md = cl.toChangelogMarkdown();
    expect(md).toContain("# API Changelog");
    expect(md).toContain("1.0.0");
    expect(md).toContain("1.1.0");
    expect(md).toContain("Added");
  });

  test("returns null for missing versions", async () => {
    const { ApiChangelog } = await import("../src/api-docs");

    const cl = new ApiChangelog();
    cl.snapshot("1.0.0", []);
    const diff = cl.diff("1.0.0", "2.0.0");
    expect(diff).toBeNull();
  });
});

// ========================================================================
// Portal HTML Generation
// ========================================================================

describe("generatePortalHTML", () => {
  test("generates valid HTML", async () => {
    const { generatePortalHTML } = await import("../src/api-docs");

    const html = generatePortalHTML({
      title: "My API",
      version: "1.0.0",
      description: "My API description",
      specPath: "/openapi.json",
      proxyPath: "/docs/_proxy",
    });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("My API");
    expect(html).toContain("1.0.0");
    expect(html).toContain("/openapi.json");
    expect(html).toContain("</html>");
  });

  test("includes tags and endpoint count", async () => {
    const { generatePortalHTML } = await import("../src/api-docs");

    const html = generatePortalHTML({
      title: "Service API",
      version: "2.0.0",
      specPath: "/spec.json",
      proxyPath: "/docs/proxy",
      tags: [{ name: "users", description: "User operations" }],
      endpointCount: 5,
    });

    expect(html).toContain("5 endpoints");
  });

  test("applies dark theme", async () => {
    const { generatePortalHTML } = await import("../src/api-docs");

    const html = generatePortalHTML({
      title: "API",
      version: "1.0.0",
      specPath: "/oas.json",
      proxyPath: "/docs/proxy",
      theme: "dark",
    });

    expect(html).toContain('data-theme="dark"');
  });

  test("includes custom CSS", async () => {
    const { generatePortalHTML } = await import("../src/api-docs");

    const html = generatePortalHTML({
      title: "API",
      version: "1.0.0",
      specPath: "/oas.json",
      proxyPath: "/docs/proxy",
      customCSS: "body { background: red; }",
    });

    expect(html).toContain("background: red");
  });
});

// ========================================================================
// Plugin Interface
// ========================================================================

describe("apiDocsPlugin", () => {
  test("creates plugin with correct structure", async () => {
    const { apiDocsPlugin } = await import("../src/api-docs");

    const plugin = apiDocsPlugin({
      title: "Test API",
      version: "1.0.0",
    });

    expect(plugin.name).toBe("api-docs");
    expect(plugin.config).toBeDefined();
    expect(plugin.config.name).toBe("api-docs");
    expect(typeof plugin.config.setup).toBe("function");
  });

  test("plugin sets up routes via mock app", async () => {
    const { apiDocsPlugin } = await import("../src/api-docs");

    const plugin = apiDocsPlugin({
      title: "Test",
      version: "1.0.0",
    });

    const routes: Array<{ method: string; path: string }> = [];
    const mockApp = {
      setState: () => {},
      get: (path: string) => { routes.push({ method: "GET", path }); return mockApp; },
      post: (path: string) => { routes.push({ method: "POST", path }); return mockApp; },
    } as any;

    await plugin.config.setup!(mockApp);
    expect(routes.length).toBeGreaterThanOrEqual(2);
    expect(routes.some((r) => r.path === "/docs")).toBe(true);
    expect(routes.some((r) => r.path === "/docs/_proxy")).toBe(true);
  });
});

// ========================================================================
// Type exports
// ========================================================================

describe("type exports", () => {
  test("module exports all types", async () => {
    const mod = await import("../src/api-docs");
    expect(mod.apiDocsPlugin).toBeDefined();
    expect(mod.generatePortalHTML).toBeDefined();
    expect(mod.generateCodeSamples).toBeDefined();
    expect(mod.exportToMarkdown).toBeDefined();
    expect(mod.exportToHTML).toBeDefined();
    expect(mod.ApiChangelog).toBeDefined();
  });
});
