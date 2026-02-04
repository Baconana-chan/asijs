import { describe, test, expect } from "bun:test";
import {
  toFetchHandler,
  cloudflare,
  vercelEdge,
  deno,
  createStaticHandler,
  combineHandlers,
  withCORS,
} from "../src/edge";
import { Asi } from "../src/asi";

describe("Edge Adapters", () => {
  describe("toFetchHandler", () => {
    test("converts app to fetch handler", async () => {
      const app = new Asi();
      app.get("/", () => ({ message: "Hello from Edge!" }));

      const handler = toFetchHandler(app);
      const request = new Request("http://localhost/");
      const response = await handler(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.message).toBe("Hello from Edge!");
    });

    test("handles POST requests", async () => {
      const app = new Asi();
      app.post("/echo", async (ctx) => {
        const body = await ctx.json();
        return body;
      });

      const handler = toFetchHandler(app);
      const request = new Request("http://localhost/echo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: "test" }),
      });
      const response = await handler(request);

      const data = await response.json();
      expect(data.data).toBe("test");
    });

    test("applies basePath option", async () => {
      const app = new Asi();
      app.get("/hello", () => ({ message: "Hello" }));

      const handler = toFetchHandler(app, { basePath: "/api" });
      const request = new Request("http://localhost/api/hello");
      const response = await handler(request);

      expect(response.status).toBe(200);
    });

    test("applies beforeRequest hook", async () => {
      const app = new Asi();
      app.get("/test", (ctx) => ({
        header: ctx.header("X-Added"),
      }));

      const handler = toFetchHandler(app, {
        beforeRequest: (req) => {
          const headers = new Headers(req.headers);
          headers.set("X-Added", "value");
          return new Request(req.url, { ...req, headers });
        },
      });

      const request = new Request("http://localhost/test");
      const response = await handler(request);
      const data = await response.json();

      expect(data.header).toBe("value");
    });

    test("applies afterResponse hook", async () => {
      const app = new Asi();
      app.get("/test", () => ({ ok: true }));

      const handler = toFetchHandler(app, {
        afterResponse: (res) => {
          const headers = new Headers(res.headers);
          headers.set("X-Custom", "added");
          return new Response(res.body, { ...res, headers });
        },
      });

      const request = new Request("http://localhost/test");
      const response = await handler(request);

      expect(response.headers.get("X-Custom")).toBe("added");
    });

    test("handles errors gracefully", async () => {
      const app = new Asi();
      app.get("/error", () => {
        throw new Error("Test error");
      });

      const handler = toFetchHandler(app);
      const request = new Request("http://localhost/error");
      const response = await handler(request);

      expect(response.status).toBe(500);
    });

    test("custom error handler", async () => {
      const app = new Asi();
      // Use onError option from Asi itself
      app.onError((ctx, error) => {
        return new Response(
          JSON.stringify({ custom: (error as Error).message }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          },
        );
      });
      app.get("/error", () => {
        throw new Error("Test error");
      });

      const handler = toFetchHandler(app);

      const request = new Request("http://localhost/error");
      const response = await handler(request);
      const data = await response.json();

      expect(data.custom).toBe("Test error");
    });
  });

  describe("cloudflare adapter", () => {
    test("returns object with fetch handler", () => {
      const app = new Asi();
      app.get("/", () => "Hello");

      const worker = cloudflare(app);

      expect(worker.fetch).toBeDefined();
      expect(typeof worker.fetch).toBe("function");
    });

    test("fetch handler works", async () => {
      const app = new Asi();
      app.get("/", () => ({ worker: true }));

      const worker = cloudflare(app);
      const response = await worker.fetch(new Request("http://localhost/"));

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.worker).toBe(true);
    });
  });

  describe("vercelEdge adapter", () => {
    test("exports all HTTP methods", () => {
      const app = new Asi();
      app.get("/", () => "Hello");

      const edge = vercelEdge(app);

      expect(edge.GET).toBeDefined();
      expect(edge.POST).toBeDefined();
      expect(edge.PUT).toBeDefined();
      expect(edge.DELETE).toBeDefined();
      expect(edge.PATCH).toBeDefined();
      expect(edge.HEAD).toBeDefined();
      expect(edge.OPTIONS).toBeDefined();
    });

    test("handlers work correctly", async () => {
      const app = new Asi();
      app.get("/api", () => ({ vercel: true }));

      const { GET } = vercelEdge(app);
      const response = await GET(new Request("http://localhost/api"));

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.vercel).toBe(true);
    });
  });

  describe("deno adapter", () => {
    test("returns handler function", () => {
      const app = new Asi();
      app.get("/", () => "Hello");

      const handler = deno(app);

      expect(typeof handler).toBe("function");
    });

    test("handler works correctly", async () => {
      const app = new Asi();
      app.get("/", () => ({ deno: true }));

      const handler = deno(app);
      const response = await handler(new Request("http://localhost/"));

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.deno).toBe(true);
    });
  });

  describe("createStaticHandler", () => {
    test("serves static assets", async () => {
      const assets = new Map([
        [
          "/style.css",
          {
            content: new TextEncoder().encode("body { color: red; }"),
            contentType: "text/css",
          },
        ],
        [
          "/script.js",
          {
            content: new TextEncoder().encode("console.log('hello');"),
            contentType: "application/javascript",
          },
        ],
      ]);

      const handler = createStaticHandler(assets);

      const cssResponse = await handler(
        new Request("http://localhost/style.css"),
      );
      expect(cssResponse.status).toBe(200);
      expect(cssResponse.headers.get("Content-Type")).toBe("text/css");

      const jsResponse = await handler(
        new Request("http://localhost/script.js"),
      );
      expect(jsResponse.status).toBe(200);
    });

    test("returns 404 for missing assets", async () => {
      const assets = new Map();
      const handler = createStaticHandler(assets);

      const response = await handler(
        new Request("http://localhost/missing.txt"),
      );
      expect(response.status).toBe(404);
    });

    test("custom cache control", async () => {
      const assets = new Map([
        [
          "/file.txt",
          {
            content: new TextEncoder().encode("test"),
            contentType: "text/plain",
          },
        ],
      ]);

      const handler = createStaticHandler(assets, {
        cacheControl: "public, max-age=3600",
      });

      const response = await handler(new Request("http://localhost/file.txt"));
      expect(response.headers.get("Cache-Control")).toBe(
        "public, max-age=3600",
      );
    });
  });

  describe("combineHandlers", () => {
    test("routes to correct handler by string pattern", async () => {
      const apiHandler = async () =>
        new Response(JSON.stringify({ type: "api" }), {
          headers: { "Content-Type": "application/json" },
        });

      const staticHandler = async () =>
        new Response("static content", {
          headers: { "Content-Type": "text/plain" },
        });

      const combined = combineHandlers([
        { pattern: "/api", handler: apiHandler },
        { pattern: "/static", handler: staticHandler },
      ]);

      const apiResponse = await combined(
        new Request("http://localhost/api/users"),
      );
      expect(await apiResponse.json()).toEqual({ type: "api" });

      const staticResponse = await combined(
        new Request("http://localhost/static/file.txt"),
      );
      expect(await staticResponse.text()).toBe("static content");
    });

    test("routes to correct handler by regex pattern", async () => {
      const handler = async () => new Response("matched");

      const combined = combineHandlers([{ pattern: /^\/v\d+\//, handler }]);

      const response = await combined(new Request("http://localhost/v1/users"));
      expect(await response.text()).toBe("matched");
    });

    test("returns 404 for unmatched routes", async () => {
      const combined = combineHandlers([]);

      const response = await combined(new Request("http://localhost/unknown"));
      expect(response.status).toBe(404);
    });
  });

  describe("withCORS", () => {
    test("adds CORS headers to response", async () => {
      const handler = async () => new Response("OK");
      const corsHandler = withCORS(handler);

      const response = await corsHandler(new Request("http://localhost/"));

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });

    test("handles preflight requests", async () => {
      const handler = async () => new Response("OK");
      const corsHandler = withCORS(handler);

      const response = await corsHandler(
        new Request("http://localhost/", { method: "OPTIONS" }),
      );

      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(response.headers.get("Access-Control-Allow-Methods")).toContain(
        "GET",
      );
    });

    test("respects origin option (string)", async () => {
      const handler = async () => new Response("OK");
      const corsHandler = withCORS(handler, { origin: "https://example.com" });

      const response = await corsHandler(new Request("http://localhost/"));

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://example.com",
      );
    });

    test("respects origin option (array)", async () => {
      const handler = async () => new Response("OK");
      const corsHandler = withCORS(handler, {
        origin: ["https://a.com", "https://b.com"],
      });

      const response = await corsHandler(
        new Request("http://localhost/", {
          headers: { Origin: "https://b.com" },
        }),
      );

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://b.com",
      );
    });

    test("respects credentials option", async () => {
      const handler = async () => new Response("OK");
      const corsHandler = withCORS(handler, { credentials: true });

      const response = await corsHandler(new Request("http://localhost/"));

      expect(response.headers.get("Access-Control-Allow-Credentials")).toBe(
        "true",
      );
    });
  });
});
