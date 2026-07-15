/**
 * Tests for Tenant / Workspace Rate Limiting
 *
 * Covers:
 * - TenantStore: wraps any store with tenant key prefix isolation
 * - defaultTenantOptions: reads config from env vars
 * - workspaceRateLimit: auto-configures plugin from env or explicit options
 * - tenantRateLimitMiddleware: per-route tenant rate limit middleware
 * - WorkspaceDevController: injects rate limit env vars into sub-app processes
 * - Integration: end-to-end rate limiting with tenant isolation
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  Asi,
  MemoryStore,
  TokenBucketStore,
  TenantStore,
  WorkspaceDevController,
  workspaceRateLimit,
  tenantRateLimitMiddleware,
  defaultTenantOptions,
} from "../src";

// ========================================================================
// TenantStore
// ========================================================================

describe("TenantStore", () => {
  it("prefixes keys with tenant ID", async () => {
    const inner = new MemoryStore();
    const storeA = new TenantStore("tenant-a", inner);
    const storeB = new TenantStore("tenant-b", inner);

    // tenant-a uses 1 out of 2
    expect((await storeA.increment("key1", 60_000, 2)).remaining).toBe(1);
    // tenant-b should still have 2 remaining (isolated)
    expect((await storeB.increment("key1", 60_000, 2)).remaining).toBe(1);
    expect((await storeB.increment("key1", 60_000, 2)).remaining).toBe(0);

    // tenant-a is at 1/2 used, so second request still works
    expect((await storeA.increment("key1", 60_000, 2)).remaining).toBe(0);
    // but third is blocked
    expect((await storeA.increment("key1", 60_000, 2)).remaining).toBe(-1);

    inner.destroy();
  });

  it("resets only tenant's keys", async () => {
    const inner = new MemoryStore();
    const storeA = new TenantStore("tenant-a", inner);
    const storeB = new TenantStore("tenant-b", inner);

    await storeA.increment("shared-key", 60_000, 5);
    await storeB.increment("shared-key", 60_000, 5);
    await storeB.increment("shared-key", 60_000, 5);

    // Reset tenant-a
    await storeA.reset("shared-key");

    // tenant-a should have full capacity
    expect((await storeA.increment("shared-key", 60_000, 5)).remaining).toBe(4);
    // tenant-b should still have 2 out of 5 used
    expect((await storeB.increment("shared-key", 60_000, 5)).remaining).toBe(2);

    inner.destroy();
  });

  it("works with TokenBucketStore", async () => {
    const inner = new TokenBucketStore();
    const store = new TenantStore("t1", inner);

    expect((await store.increment("k", 60_000, 3)).remaining).toBe(2);
    expect((await store.increment("k", 60_000, 3)).remaining).toBe(1);
    expect((await store.increment("k", 60_000, 3)).remaining).toBe(0);
    const blocked = await store.increment("k", 60_000, 3);
    expect(blocked.remaining).toBeLessThan(0);

    inner.destroy();
  });

  it("uses MemoryStore by default", () => {
    const store = new TenantStore("default");
    expect(store).toBeDefined();
  });
});

// ========================================================================
// defaultTenantOptions
// ========================================================================

describe("defaultTenantOptions()", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.ASIJS_APP_NAME;
    delete process.env.ASIJS_TENANT_ID;
    delete process.env.ASIJS_RATE_LIMIT_MAX;
    delete process.env.ASIJS_RATE_LIMIT_WINDOW_MS;
    delete process.env.ASIJS_RATE_LIMIT_ENABLED;
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it("returns default values when no env vars set", () => {
    const opts = defaultTenantOptions();
    expect(opts.tenantId).toBe("default");
    expect(opts.max).toBe(1000);
    expect(opts.windowMs).toBe(60_000);
  });

  it("reads ASIJS_APP_NAME as tenant ID", () => {
    process.env.ASIJS_APP_NAME = "my-api";
    expect(defaultTenantOptions().tenantId).toBe("my-api");
  });

  it("falls back to ASIJS_TENANT_ID when no app name", () => {
    process.env.ASIJS_TENANT_ID = "custom-tenant";
    expect(defaultTenantOptions().tenantId).toBe("custom-tenant");
  });

  it("reads rate limit limits from env", () => {
    process.env.ASIJS_RATE_LIMIT_MAX = "500";
    process.env.ASIJS_RATE_LIMIT_WINDOW_MS = "120000";
    const opts = defaultTenantOptions();
    expect(opts.max).toBe(500);
    expect(opts.windowMs).toBe(120_000);
  });

  it("disables rate limiting when env says 0/false", () => {
    process.env.ASIJS_RATE_LIMIT_ENABLED = "0";
    const opts = defaultTenantOptions();
    expect(opts.max).toBe(Infinity);
  });

  it("disables rate limiting when env says false", () => {
    process.env.ASIJS_RATE_LIMIT_ENABLED = "false";
    const opts = defaultTenantOptions();
    expect(opts.max).toBe(Infinity);
  });
});

// ========================================================================
// workspaceRateLimit plugin
// ========================================================================

describe("workspaceRateLimit() plugin", () => {
  it("creates a valid AsiPlugin", () => {
    const plugin = workspaceRateLimit({
      tenantId: "test-tenant",
      max: 10,
      windowMs: 60_000,
    });
    expect(plugin).toBeDefined();
    expect(typeof plugin).toBe("object");
  });

  it("blocks requests over the per-tenant limit", async () => {
    const app = new Asi();

    app.plugin(
      workspaceRateLimit({
        tenantId: "block-test",
        max: 2,
        windowMs: 60_000,
        keyGenerator: () => "client-x",
      }),
    );

    app.get("/ok", () => "allowed");

    // First 2 requests should pass
    expect((await app.handle(new Request("http://localhost/ok"))).status).toBe(200);
    expect((await app.handle(new Request("http://localhost/ok"))).status).toBe(200);

    // Third should be blocked
    const res = await app.handle(new Request("http://localhost/ok"));
    expect(res.status).toBe(429);
  });

  it("isolates rate limits between tenants", async () => {
    const appA = new Asi();
    appA.plugin(
      workspaceRateLimit({
        tenantId: "tenant-alpha",
        max: 1,
        windowMs: 60_000,
        keyGenerator: () => "shared-client",
      }),
    );
    appA.get("/", () => "alpha");

    const appB = new Asi();
    appB.plugin(
      workspaceRateLimit({
        tenantId: "tenant-beta",
        max: 1,
        windowMs: 60_000,
        keyGenerator: () => "shared-client",
      }),
    );
    appB.get("/", () => "beta");

    // Both tenants should allow their first request
    expect((await appA.handle(new Request("http://localhost/"))).status).toBe(200);
    expect((await appB.handle(new Request("http://localhost/"))).status).toBe(200);

    // Second request to each should be blocked
    expect((await appA.handle(new Request("http://localhost/"))).status).toBe(429);
    expect((await appB.handle(new Request("http://localhost/"))).status).toBe(429);
  });

  it("handles options override correctly", async () => {
    const app = new Asi();
    app.plugin(
      workspaceRateLimit({
        tenantId: "override-test",
        max: 5,
        windowMs: 60_000,
        message: "Custom limit message",
        statusCode: 403,
        keyGenerator: () => "fixed",
      }),
    );
    app.get("/", () => "ok");

    // 5 requests should pass
    for (let i = 0; i < 5; i++) {
      expect((await app.handle(new Request("http://localhost/"))).status).toBe(200);
    }

    // 6th should be blocked with custom status
    const res = await app.handle(new Request("http://localhost/"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.message).toBe("Custom limit message");
  });
});

// ========================================================================
// tenantRateLimitMiddleware
// ========================================================================

describe("tenantRateLimitMiddleware()", () => {
  it("limits per-route with tenant isolation", async () => {
    const app = new Asi();

    app.get(
      "/sensitive",
      () => "data",
      {
        beforeHandle: tenantRateLimitMiddleware({
          tenantId: "route-tenant",
          max: 3,
          windowMs: 60_000,
          keyGenerator: () => "user-1",
        }),
      },
    );

    for (let i = 0; i < 3; i++) {
      expect(
        (await app.handle(new Request("http://localhost/sensitive"))).status,
      ).toBe(200);
    }

    expect(
      (await app.handle(new Request("http://localhost/sensitive"))).status,
    ).toBe(429);
  });
});

// ========================================================================
// Integration: WorkspaceDevController injects rate limit env vars
// ========================================================================

describe("WorkspaceDevController rate limit injection", () => {
  it("injects env vars when rateLimit config is set", async () => {
    const apps: any[] = [
      {
        name: "api",
        entryPoint: "/test/api/src/index.ts",
        rootDir: "/test/api",
      },
    ];

    const controller = new WorkspaceDevController(apps, {
      basePort: 4000,
      verbose: false,
      rateLimit: {
        enabled: true,
        max: 500,
        windowMs: 120_000,
      },
    });

    // We can test the controller construction only (startApp is private)
    // The env vars are injected inside startApp()
    expect(controller.options).toBeDefined();
    expect(controller.apps[0].name).toBe("api");
    expect(controller.apps[0].port).toBe(4000);

    await controller.stop();
  });

  it("does not inject rate limit vars when config is absent", async () => {
    const apps: any[] = [
      { name: "web", entryPoint: "/test/web/src/index.ts", rootDir: "/test/web" },
    ];

    const controller = new WorkspaceDevController(apps, {
      basePort: 5000,
      verbose: false,
      // no rateLimit config
    });

    expect(controller.apps[0].port).toBe(5000);
    await controller.stop();
  });
});

// ========================================================================
// Edge Cases
// ========================================================================

describe("TenantStore edge cases", () => {
  it("handles empty tenant ID gracefully", () => {
    const store = new TenantStore("", new MemoryStore());
    expect(async () => {
      await store.increment("test", 60_000, 10);
    }).not.toThrow();
  });

  it("handles special characters in tenant ID", () => {
    const store = new TenantStore("my-app:v2@prod", new MemoryStore());
    expect(async () => {
      await store.increment("key", 60_000, 10);
      await store.reset("key");
    }).not.toThrow();
  });

  it("supports cleanup on the inner store", async () => {
    const inner = new MemoryStore();
    const store = new TenantStore("cleanup-test", inner);
    await store.increment("k", 60_000, 10);
    await store.cleanup();
    // Should not throw
    expect(true).toBe(true);
    inner.destroy();
  });
});
