/**
 * Tests for Phase 4 features: Cookies, CORS, Static Files
 */

import { describe, test, expect } from "bun:test";
import { Asi, cors } from "../src";

describe("Phase 4 Features", () => {
  describe("Cookies", () => {
    test("should parse cookies from request", async () => {
      const app = new Asi();

      app.get("/", (ctx) => ({
        session: ctx.cookie("session"),
        user: ctx.cookie("user"),
        all: ctx.cookies,
      }));

      const req = new Request("http://localhost/", {
        headers: {
          Cookie: "session=abc123; user=john",
        },
      });

      const res = await app.handle(req);
      const data = await res.json();

      expect(data.session).toBe("abc123");
      expect(data.user).toBe("john");
      expect(data.all).toEqual({ session: "abc123", user: "john" });
    });

    test("should handle URL-encoded cookie values", async () => {
      const app = new Asi();

      app.get("/", (ctx) => ({
        data: ctx.cookie("data"),
      }));

      const req = new Request("http://localhost/", {
        headers: {
          Cookie: "data=hello%20world",
        },
      });

      const res = await app.handle(req);
      const data = await res.json();

      expect(data.data).toBe("hello world");
    });

    test("should set cookies in response", async () => {
      const app = new Asi();

      app.get("/login", (ctx) => {
        ctx.setCookie("session", "xyz789", {
          httpOnly: true,
          secure: true,
          maxAge: 3600,
          path: "/",
        });
        return { success: true };
      });

      const req = new Request("http://localhost/login");
      const res = await app.handle(req);

      const setCookie = res.headers.get("Set-Cookie");
      expect(setCookie).toContain("session=xyz789");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("Secure");
      expect(setCookie).toContain("Max-Age=3600");
      expect(setCookie).toContain("Path=/");
    });

    test("should delete cookies", async () => {
      const app = new Asi();

      app.get("/logout", (ctx) => {
        ctx.deleteCookie("session");
        return { success: true };
      });

      const req = new Request("http://localhost/logout");
      const res = await app.handle(req);

      const setCookie = res.headers.get("Set-Cookie");
      expect(setCookie).toContain("session=");
      expect(setCookie).toContain("Max-Age=0");
    });

    test("should set cookie with SameSite", async () => {
      const app = new Asi();

      app.get("/", (ctx) => {
        ctx.setCookie("token", "abc", { sameSite: "Strict" });
        return ctx.jsonResponse({ ok: true });
      });

      const req = new Request("http://localhost/");
      const res = await app.handle(req);

      const setCookie = res.headers.get("Set-Cookie");
      expect(setCookie).toContain("SameSite=Strict");
    });
  });

  describe("CORS Plugin", () => {
    test("should handle preflight request (OPTIONS)", async () => {
      const app = new Asi();
      app.use(cors());
      app.get("/api", () => ({ data: "test" }));

      const req = new Request("http://localhost/api", {
        method: "OPTIONS",
        headers: {
          Origin: "https://example.com",
          "Access-Control-Request-Method": "POST",
        },
      });

      const res = await app.handle(req);

      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://example.com",
      );
      expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
      expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    });

    test("should add CORS headers to regular request", async () => {
      const app = new Asi();
      app.use(cors());
      app.get("/api", () => ({ data: "test" }));

      const req = new Request("http://localhost/api", {
        headers: { Origin: "https://example.com" },
      });

      const res = await app.handle(req);

      expect(res.status).toBe(200);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://example.com",
      );
      expect(res.headers.get("Vary")).toContain("Origin");
    });

    test("should respect origin whitelist", async () => {
      const app = new Asi();
      app.use(
        cors({
          origin: ["https://allowed.com", "https://other.com"],
        }),
      );
      app.get("/api", () => ({ data: "test" }));

      // Allowed origin
      const res1 = await app.handle(
        new Request("http://localhost/api", {
          headers: { Origin: "https://allowed.com" },
        }),
      );
      expect(res1.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://allowed.com",
      );

      // Not allowed origin
      const res2 = await app.handle(
        new Request("http://localhost/api", {
          headers: { Origin: "https://blocked.com" },
        }),
      );
      expect(res2.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });

    test("should handle credentials option", async () => {
      const app = new Asi();
      app.use(cors({ credentials: true }));
      app.get("/api", () => ({ data: "test" }));

      const req = new Request("http://localhost/api", {
        headers: { Origin: "https://example.com" },
      });

      const res = await app.handle(req);
      expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    });

    test("should reflect Access-Control-Request-Headers", async () => {
      const app = new Asi();
      app.use(cors());
      app.get("/api", () => ({ data: "test" }));

      const req = new Request("http://localhost/api", {
        method: "OPTIONS",
        headers: {
          Origin: "https://example.com",
          "Access-Control-Request-Headers": "X-Custom-Header, Authorization",
        },
      });

      const res = await app.handle(req);
      expect(res.headers.get("Access-Control-Allow-Headers")).toBe(
        "X-Custom-Header, Authorization",
      );
    });

    test("should use configured allowedHeaders", async () => {
      const app = new Asi();
      app.use(
        cors({
          allowedHeaders: ["Content-Type", "X-Token"],
        }),
      );
      app.get("/api", () => ({ data: "test" }));

      const req = new Request("http://localhost/api", {
        method: "OPTIONS",
        headers: { Origin: "https://example.com" },
      });

      const res = await app.handle(req);
      expect(res.headers.get("Access-Control-Allow-Headers")).toBe(
        "Content-Type, X-Token",
      );
    });

    test("should set exposed headers", async () => {
      const app = new Asi();
      app.use(
        cors({
          exposedHeaders: ["X-Request-Id", "X-Total-Count"],
        }),
      );
      app.get("/api", () => ({ data: "test" }));

      const req = new Request("http://localhost/api", {
        headers: { Origin: "https://example.com" },
      });

      const res = await app.handle(req);
      expect(res.headers.get("Access-Control-Expose-Headers")).toBe(
        "X-Request-Id, X-Total-Count",
      );
    });

    test("should use origin check function", async () => {
      const app = new Asi();
      app.use(
        cors({
          origin: (origin) => origin.endsWith(".myapp.com"),
        }),
      );
      app.get("/api", () => ({ data: "test" }));

      // Allowed
      const res1 = await app.handle(
        new Request("http://localhost/api", {
          headers: { Origin: "https://sub.myapp.com" },
        }),
      );
      expect(res1.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://sub.myapp.com",
      );

      // Not allowed
      const res2 = await app.handle(
        new Request("http://localhost/api", {
          headers: { Origin: "https://other.com" },
        }),
      );
      expect(res2.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });
  });
});
