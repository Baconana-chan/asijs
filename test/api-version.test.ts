import { describe, expect, it } from "bun:test";
import { Asi, apiVersion, apiVersionPlugin, versionPath } from "../src";

describe("apiVersion middleware", () => {
  // ===== URL-based versioning =====
  describe("URL-based version parsing", () => {
    it("extracts version from /v1/... path prefix", async () => {
      const app = new Asi();
      app.use(apiVersion({ supportedVersions: ["1.0", "2.0"] }));

      let capturedVersion: string | undefined;
      app.get("/v1/hello", (ctx: any) => {
        capturedVersion = ctx.apiVersion?.version;
        return { ok: true };
      });

      const res = await app.handle(new Request("http://localhost/v1/hello"));
      expect(res.status).toBe(200);
      expect(capturedVersion).toBe("1.0");
      expect(res.headers.get("X-API-Version")).toBe("1.0");
    });

    it("extracts version 2.0 from /v2 path prefix", async () => {
      const app = new Asi();
      app.use(apiVersion({ supportedVersions: ["1.0", "2.0"] }));

      let capturedVersion: string | undefined;
      app.get("/v2/hello", (ctx: any) => {
        capturedVersion = ctx.apiVersion?.version;
        return { ok: true };
      });

      await app.handle(new Request("http://localhost/v2/hello"));
      expect(capturedVersion).toBe("2.0");
    });

    it("uses default version when route has no version prefix", async () => {
      const app = new Asi();
      app.use(apiVersion({ defaultVersion: "2.0", supportedVersions: ["1.0", "2.0"] }));

      let capturedVersion: string | undefined;
      app.get("/health", (ctx: any) => {
        capturedVersion = ctx.apiVersion?.version;
        return { ok: true };
      });

      await app.handle(new Request("http://localhost/health"));
      expect(capturedVersion).toBe("2.0");
    });

    it("works with explicit versionPath helper", async () => {
      const app = new Asi();
      app.use(apiVersion({ supportedVersions: ["1.0"] }));

      let capturedVersion: string | undefined;
      app.get(versionPath("1.0", "/users"), (ctx: any) => {
        capturedVersion = ctx.apiVersion?.version;
        return { ok: true };
      });

      await app.handle(new Request("http://localhost/v1/users"));
      expect(capturedVersion).toBe("1.0");
    });

    it("handles multi-segment /v1/users/:id/posts pattern", async () => {
      const app = new Asi();
      app.use(apiVersion({ supportedVersions: ["1.0"] }));

      let capturedVersion: string | undefined;
      app.get("/v1/users/:id/posts", (ctx: any) => {
        capturedVersion = ctx.apiVersion?.version;
        return { ok: true };
      });

      await app.handle(new Request("http://localhost/v1/users/42/posts"));
      expect(capturedVersion).toBe("1.0");
    });
  });

  // ===== Header-based versioning =====
  describe("header-based versioning", () => {
    it("resolves version from Accept-Version header", async () => {
      const app = new Asi();
      app.use(apiVersion({
        strategy: "header",
        supportedVersions: ["1.0", "2.0"],
      }));

      let capturedVersion: string | undefined;
      app.get("/hello", (ctx: any) => {
        capturedVersion = ctx.apiVersion?.version;
        return { ok: true };
      });

      const res = await app.handle(new Request("http://localhost/hello", {
        headers: { "Accept-Version": "2.0" },
      }));
      expect(res.status).toBe(200);
      expect(capturedVersion).toBe("2.0");
      expect(res.headers.get("X-API-Version")).toBe("2.0");
    });

    it("uses default version when no header is present", async () => {
      const app = new Asi();
      app.use(apiVersion({
        strategy: "header",
        defaultVersion: "2.0",
        supportedVersions: ["1.0", "2.0"],
      }));

      let capturedVersion: string | undefined;
      app.get("/hello", (ctx: any) => {
        capturedVersion = ctx.apiVersion?.version;
        return { ok: true };
      });

      await app.handle(new Request("http://localhost/hello"));
      expect(capturedVersion).toBe("2.0");
    });

    it("supports custom header name", async () => {
      const app = new Asi();
      app.use(apiVersion({
        strategy: "header",
        headerName: "X-API-Version",
        supportedVersions: ["1.0"],
      }));

      let capturedVersion: string | undefined;
      app.get("/hello", (ctx: any) => {
        capturedVersion = ctx.apiVersion?.version;
        return { ok: true };
      });

      await app.handle(new Request("http://localhost/hello", {
        headers: { "X-API-Version": "1.0" },
      }));
      expect(capturedVersion).toBe("1.0");
    });
  });

  // ===== Combined strategy =====
  describe("combined strategy", () => {
    it("prefers URL over header when both are present", async () => {
      const app = new Asi();
      app.use(apiVersion({
        strategy: "both",
        supportedVersions: ["1.0", "2.0"],
      }));

      let capturedVersion: string | undefined;
      app.get("/v2/hello", (ctx: any) => {
        capturedVersion = ctx.apiVersion?.version;
        return { ok: true };
      });

      await app.handle(new Request("http://localhost/v2/hello", {
        headers: { "Accept-Version": "1.0" },
      }));
      expect(capturedVersion).toBe("2.0");
    });

    it("falls back to header when no URL version", async () => {
      const app = new Asi();
      app.use(apiVersion({
        strategy: "both",
        supportedVersions: ["1.0", "2.0"],
      }));

      let capturedVersion: string | undefined;
      app.get("/hello", (ctx: any) => {
        capturedVersion = ctx.apiVersion?.version;
        return { ok: true };
      });

      await app.handle(new Request("http://localhost/hello", {
        headers: { "Accept-Version": "2.0" },
      }));
      expect(capturedVersion).toBe("2.0");
    });
  });

  // ===== Fallback strategies =====
  describe("fallback strategies", () => {
    it("falls back to latest version for unsupported versions", async () => {
      const app = new Asi();
      app.use(apiVersion({
        supportedVersions: ["1.0", "2.0"],
        fallback: "latest",
        validateVersion: true,
      }));

      let capturedVersion: string | undefined;
      app.get("/v5/hello", (ctx: any) => {
        capturedVersion = ctx.apiVersion?.version;
        return { ok: true };
      });

      await app.handle(new Request("http://localhost/v5/hello"));
      expect(capturedVersion).toBe("2.0");
    });

    it("falls back to stable (latest non-deprecated) for unsupported version", async () => {
      const app = new Asi();
      app.use(apiVersion({
        supportedVersions: [
          { version: "1.0", deprecated: true },
          { version: "2.0" },
        ],
        fallback: "stable",
        validateVersion: true,
      }));

      let capturedVersion: string | undefined;
      app.get("/v3/hello", (ctx: any) => {
        capturedVersion = ctx.apiVersion?.version;
        return { ok: true };
      });

      await app.handle(new Request("http://localhost/v3/hello"));
      expect(capturedVersion).toBe("2.0");
    });

    it("returns error for unsupported version in header with error fallback", async () => {
      const app = new Asi();
      app.use(apiVersion({
        strategy: "header",
        supportedVersions: ["1.0", "2.0"],
        fallback: "error",
        validateVersion: true,
      }));

      app.get("/hello", () => ({ ok: true }));

      const res = await app.handle(new Request("http://localhost/hello", {
        headers: { "Accept-Version": "5.0" },
      }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Unsupported");
      expect(body.supportedVersions).toContain("1.0");
    });
  });

  // ===== Deprecation headers =====
  describe("deprecation headers", () => {
    it("adds Deprecation header for deprecated versions", async () => {
      const app = new Asi();
      app.use(apiVersion({
        supportedVersions: [
          { version: "1.0", deprecated: true, sunset: "2026-12-31" },
          { version: "2.0" },
        ],
      }));

      app.get("/v1/hello", () => ({ ok: true }));

      const res = await app.handle(new Request("http://localhost/v1/hello"));
      expect(res.status).toBe(200);
      const deprecation = res.headers.get("Deprecation");
      expect(deprecation).toBeTruthy();
      expect(deprecation).toContain("true");
      expect(res.headers.get("Sunset")).toBe("2026-12-31");
    });

    it("does NOT add deprecation headers for active versions", async () => {
      const app = new Asi();
      app.use(apiVersion({
        supportedVersions: [
          { version: "1.0", deprecated: true },
          { version: "2.0" },
        ],
      }));

      app.get("/v2/hello", () => ({ ok: true }));

      const res = await app.handle(new Request("http://localhost/v2/hello"));
      expect(res.status).toBe(200);
      expect(res.headers.get("Deprecation")).toBeNull();
      expect(res.headers.get("Sunset")).toBeNull();
    });

    it("can disable deprecation headers", async () => {
      const app = new Asi();
      app.use(apiVersion({
        supportedVersions: [{ version: "1.0", deprecated: true }],
        deprecationHeaders: false,
      }));

      app.get("/v1/hello", () => ({ ok: true }));

      const res = await app.handle(new Request("http://localhost/v1/hello"));
      expect(res.status).toBe(200);
      expect(res.headers.get("Deprecation")).toBeNull();
    });

    it("can disable X-API-Version header", async () => {
      const app = new Asi();
      app.use(apiVersion({
        supportedVersions: ["1.0"],
        versionHeader: false,
      }));

      app.get("/v1/hello", () => ({ ok: true }));

      const res = await app.handle(new Request("http://localhost/v1/hello"));
      expect(res.status).toBe(200);
      expect(res.headers.get("X-API-Version")).toBeNull();
    });
  });

  // ===== versionPath helper =====
  describe("versionPath helper", () => {
    it("generates /v1/users path without prefix", () => {
      expect(versionPath("1.0", "/users")).toBe("/v1/users");
      expect(versionPath("2.0", "/users")).toBe("/v2/users");
    });

    it("generates /api/v1/users path with prefix", () => {
      expect(versionPath("1.0", "/users", "api")).toBe("/api/v1/users");
      expect(versionPath("2.0", "/users", "api")).toBe("/api/v2/users");
    });

    it("handles path without leading slash", () => {
      expect(versionPath("1.0", "users")).toBe("/v1/users");
    });
  });

  // ===== Plugin =====
  describe("apiVersionPlugin", () => {
    it("registers as a plugin", async () => {
      const app = new Asi();
      app.plugin(apiVersionPlugin({
        supportedVersions: ["1.0", "2.0"],
      }));

      const plugins = app.getPlugins();
      expect(plugins).toContain("api-version");
    });

    it("versioning still works via plugin", async () => {
      const app = new Asi();
      app.plugin(apiVersionPlugin({
        supportedVersions: ["1.0", "2.0"],
      }));

      let capturedVersion: string | undefined;
      app.get("/v2/hello", (ctx: any) => {
        capturedVersion = ctx.apiVersion?.version;
        return { ok: true };
      });

      const res = await app.handle(new Request("http://localhost/v2/hello"));
      expect(res.status).toBe(200);
      expect(capturedVersion).toBe("2.0");
    });
  });
});
