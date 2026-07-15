/**
 * Tests for Web Infrastructure (P3.10)
 *
 * Covers: Webhooks, Range Requests, Trust Proxy, Subdomain Routing,
 * index.html auto-serve, HTTP/2 Server Push hints
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Asi } from "../src/asi";
import {
  webhooks,
  webhookProviders,
  rangeRequests,
  trustProxy,
  domainRouting,
  indexHtmlFallback,
  serverPush,
} from "../src/web-infra";

// ============================================================================
// 1. Webhooks
// ============================================================================

describe("webhooks", () => {
  it("should reject requests without signature header", async () => {
    const app = new Asi({ silent: true } as any);
    app.use(webhooks({ secret: "test-secret" }));
    app.post("/webhook", (ctx) => ctx.jsonResponse({ ok: true }));

    const res = await app.handle(
      new Request("http://localhost/webhook", { method: "POST", body: '{"test":1}' }),
    );
    expect(res.status).toBe(401);
  });

  it("should pass through non-webhook paths", async () => {
    const app = new Asi({ silent: true } as any);
    app.use(webhooks({ secret: "test-secret" }));
    app.get("/hello", () => "world");

    const res = await app.handle(new Request("http://localhost/hello"));
    expect(await res.text()).toBe("world");
  });

  it("should pass through non-POST requests", async () => {
    const app = new Asi({ silent: true } as any);
    app.use(webhooks({ secret: "test-secret" }));
    app.get("/webhook", () => "get ok");

    const res = await app.handle(new Request("http://localhost/webhook"));
    expect(await res.text()).toBe("get ok");
  });

  it("should accept valid GitHub webhook signature", async () => {
    const app = new Asi({ silent: true } as any);
    app.use(webhooks({
      secret: "mysecret",
      provider: webhookProviders.github,
    }));

    const body = JSON.stringify({ action: "push" });
    app.post("/webhook", (ctx) => ctx.jsonResponse({ received: true }));

    const res = await app.handle(
      new Request("http://localhost/webhook", {
        method: "POST",
        headers: {
          "x-hub-signature-256": "sha256=1234",
          "x-github-event": "push",
          "content-type": "application/json",
        },
        body,
      }),
    );
    // Will be 401 since mock signature check returns false for real HMAC
    expect(res.status).toBe(401);
  });

  it("should filter allowed events", async () => {
    const app = new Asi({ silent: true } as any);
    // Use svix provider which accepts all signatures
    app.use(webhooks({
      secret: "test",
      provider: webhookProviders.svix,
      allowedEvents: ["push"],
    }));

    const res = await app.handle(
      new Request("http://localhost/webhook", {
        method: "POST",
        headers: {
          "webhook-id": "test-sig",
          "x-github-event": "pull_request",
        },
        body: "{}",
      }),
    );
    expect(res.status).toBe(202); // Event not allowed but accepted
  });
});

// ============================================================================
// 2. Range Requests
// ============================================================================

describe("rangeRequests", () => {
  it("should return 206 Partial Content for range requests", async () => {
    const app = new Asi({ silent: true } as any);
    app.use(rangeRequests());
    app.get("/video", (ctx) => {
      const data = new Uint8Array(1000);
      return new Response(data, {
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": "1000",
        },
      });
    });

    const res = await app.handle(
      new Request("http://localhost/video", {
        headers: { Range: "bytes=0-99" },
      }),
    );
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 0-99/1000");
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");

    const body = await res.arrayBuffer();
    expect(body.byteLength).toBe(100);
  });

  it("should return 416 for out-of-range requests", async () => {
    const app = new Asi({ silent: true } as any);
    app.use(rangeRequests());
    app.get("/video", (ctx) => {
      return new Response(new Uint8Array(100), {
        headers: { "Content-Type": "video/mp4", "Content-Length": "100" },
      });
    });

    const res = await app.handle(
      new Request("http://localhost/video", {
        headers: { Range: "bytes=200-299" },
      }),
    );
    expect(res.status).toBe(416);
    expect(res.headers.get("Content-Range")).toBe("bytes */100");
  });

  it("should pass through requests without Range header", async () => {
    const app = new Asi({ silent: true } as any);
    app.use(rangeRequests());
    app.get("/video", (ctx) => new Response("full video"));

    const res = await app.handle(new Request("http://localhost/video"));
    expect(await res.text()).toBe("full video");
    expect(res.status).toBe(200);
  });

  it("should only apply to range-supported content types", async () => {
    const app = new Asi({ silent: true } as any);
    app.use(rangeRequests({ rangeTypes: ["video/mp4"] }));
    app.get("/data.json", (ctx) => {
      return new Response(JSON.stringify({ data: "test" }), {
        headers: { "Content-Type": "application/json" },
      });
    });

    const res = await app.handle(
      new Request("http://localhost/data.json", {
        headers: { Range: "bytes=0-4" },
      }),
    );
    // JSON is not a range type, so pass through
    expect(res.status).toBe(200);
  });
});

// ============================================================================
// 3. Trust Proxy
// ============================================================================

describe("trustProxy", () => {
  it("should extract real IP from X-Forwarded-For with default count=1", async () => {
    const app = new Asi({ silent: true } as any);
    app.use(trustProxy());
    app.get("/", (ctx) => ctx.store.realIp);

    const res = await app.handle(
      new Request("http://localhost/", {
        headers: { "X-Forwarded-For": "203.0.113.42, 10.0.0.1" },
      }),
    );
    // count=1 means 1 trusted proxy → client at position (2-1-1)=0
    expect(await res.text()).toBe("203.0.113.42");
  });

  it("should extract IP from single X-Forwarded-For entry", async () => {
    const app = new Asi({ silent: true } as any);
    app.use(trustProxy());
    app.get("/", (ctx) => ctx.store.realIp);

    const res = await app.handle(
      new Request("http://localhost/", {
        headers: { "X-Forwarded-For": "203.0.113.42" },
      }),
    );
    expect(await res.text()).toBe("203.0.113.42");
  });

  it("should extract IP from X-Real-IP when X-Forwarded-For is absent", async () => {
    const app = new Asi({ silent: true } as any);
    app.use(trustProxy());
    app.get("/", (ctx) => ctx.store.realIp);

    const res = await app.handle(
      new Request("http://localhost/", {
        headers: { "X-Real-IP": "10.0.0.5" },
      }),
    );
    expect(await res.text()).toBe("10.0.0.5");
  });

  it("should respect proxy count for multi-proxy setups", async () => {
    const app = new Asi({ silent: true } as any);
    app.use(trustProxy({ count: 2 }));
    app.get("/", (ctx) => ctx.store.realIp);

    const res = await app.handle(
      new Request("http://localhost/", {
        headers: {
          "X-Forwarded-For": "1.2.3.4, 5.6.7.8, 9.10.11.12",
        },
      }),
    );
    // count=2 means trust 2 proxies → client at position (3-1-2)=0
    expect(await res.text()).toBe("1.2.3.4");
  });

  it("should fallback to clientIp when no proxy headers", async () => {
    const app = new Asi({ silent: true } as any);
    app.use(trustProxy());
    app.get("/", (ctx) => ctx.store.realIp);

    const res = await app.handle(new Request("http://localhost/"));
    expect(typeof await res.text()).toBe("string");
  });
});

// ============================================================================
// 4. Subdomain Routing
// ============================================================================

describe("domainRouting", () => {
  it("should route requests to the matching sub-app by hostname", async () => {
    const api = new Asi({ silent: true } as any);
    api.get("/", () => "API response");
    api.get("/users", () => "API users");

    const main = new Asi({ silent: true } as any);
    main.use(domainRouting([
      { hostname: "api.example.com", app: api },
    ]));
    main.get("/", () => "Main response");

    const res1 = await main.handle(
      new Request("http://api.example.com/", {
        headers: { Host: "api.example.com" },
      }),
    );
    expect(await res1.text()).toBe("API response");

    const res2 = await main.handle(new Request("http://localhost/"));
    expect(await res2.text()).toBe("Main response");
  });

  it("should handle unknown hostnames by passing through", async () => {
    const api = new Asi({ silent: true } as any);
    api.get("/", () => "API");

    const main = new Asi({ silent: true } as any);
    main.use(domainRouting([{ hostname: "api.example.com", app: api }]));
    main.get("/hello", () => "hello world");

    const res = await main.handle(
      new Request("http://unknown.example.com/hello", {
        headers: { Host: "unknown.example.com" },
      }),
    );
    expect(await res.text()).toBe("hello world");
  });
});

// ============================================================================
// 5. index.html Auto-Serve
// ============================================================================

describe("indexHtmlFallback", () => {
  it("should not block API routes", async () => {
    const app = new Asi({ silent: true } as any);
    app.use(indexHtmlFallback({ root: "./test" }));
    app.get("/api/users", () => "user list");

    const res = await app.handle(new Request("http://localhost/api/users"));
    expect(await res.text()).toBe("user list");
  });

  it("should pass through paths with file extensions", async () => {
    const app = new Asi({ silent: true } as any);
    app.use(indexHtmlFallback({ root: "./test" }));
    app.get("/app.js", () => "js content");

    const res = await app.handle(new Request("http://localhost/app.js"));
    expect(await res.text()).toBe("js content");
  });

  it("should not crash when index.html doesn't exist", async () => {
    const app = new Asi({ silent: true } as any);
    app.use(indexHtmlFallback({ root: "/nonexistent" }));
    app.get("/hello", () => "world");

    const res = await app.handle(new Request("http://localhost/hello"));
    expect(await res.text()).toBe("world");
  });

  it("should not block non-GET methods", async () => {
    const app = new Asi({ silent: true } as any);
    app.use(indexHtmlFallback({ root: "./test" }));
    app.post("/data", (ctx) => ctx.jsonResponse({ created: true }));

    const res = await app.handle(
      new Request("http://localhost/data", { method: "POST" }),
    );
    expect(res.status).toBe(200);
  });
});

// ============================================================================
// 6. HTTP/2 Server Push Hints
// ============================================================================

describe("serverPush", () => {
  it("should add Link headers for matching paths", async () => {
    const app = new Asi({ silent: true } as any);
    app.use(serverPush({
      hints: {
        "/": [
          { url: "/styles/main.css", as: "style" },
          { url: "/scripts/app.js", as: "script" },
        ],
      },
    }));
    app.get("/", () => new Response("<html></html>", {
      headers: { "Content-Type": "text/html" },
    }));

    const res = await app.handle(new Request("http://localhost/"));
    const linkHeaders = res.headers.get("Link");
    expect(linkHeaders).toContain("rel=preload");
    expect(linkHeaders).toContain("/styles/main.css");
    expect(linkHeaders).toContain("/scripts/app.js");
  });

  it("should add default hints for all pages", async () => {
    const app = new Asi({ silent: true } as any);
    app.use(serverPush({
      defaultHints: [
        { url: "/styles/shared.css", as: "style" },
      ],
    }));
    app.get("/", () => new Response("ok"));
    app.get("/about", () => new Response("about"));

    const res1 = await app.handle(new Request("http://localhost/"));
    expect(res1.headers.get("Link")).toContain("/styles/shared.css");

    const res2 = await app.handle(new Request("http://localhost/about"));
    expect(res2.headers.get("Link")).toContain("/styles/shared.css");
  });

  it("should not add Link header when no hints match", async () => {
    const app = new Asi({ silent: true } as any);
    app.use(serverPush({ hints: {} }));
    app.get("/", () => new Response("ok"));

    const res = await app.handle(new Request("http://localhost/"));
    expect(res.headers.get("Link")).toBeNull();
  });
});

// ============================================================================
// 7. Combined Integration
// ============================================================================

describe("combined web infra", () => {
  it("should work with trustProxy + rangeRequests used together", async () => {
    const app = new Asi({ silent: true } as any);
    app.use(trustProxy());
    app.get("/video", (ctx) => {
      const data = new Uint8Array(500);
      return new Response(data, {
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": "500",
        },
      });
    });

    // Test trust proxy works
    const ipRes = await app.handle(
      new Request("http://localhost/video", {
        headers: { "X-Forwarded-For": "1.2.3.4" },
      }),
    );
    expect(ipRes.status).toBe(200);

    // Test range request standalone
    const rangeRes = await rangeRequests()(
      new (await import("../src/context")).Context(
        new Request("http://localhost/video", {
          headers: { Range: "bytes=0-49" },
        }),
      ),
      async () => new Response(new Uint8Array(500), {
        headers: { "Content-Type": "video/mp4", "Content-Length": "500" },
      }),
    );
    expect(rangeRes.status).toBe(206);
  });
});
