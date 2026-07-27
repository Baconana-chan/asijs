import { describe, test, expect } from "bun:test";
import {
  ServerlessOptimizer,
  serverless,
  lazyImport,
  serverlessColdStartLogger,
  SERVERLESS_PLATFORMS,
  type ServerlessTarget,
  type ServerlessBundleConfig,
} from "../src/serverless";
import { Asi } from "../src/asi";

// ============================================================================
// ServerlessOptimizer — WarmUp
// ============================================================================

describe("ServerlessOptimizer — warmUp()", () => {
  test("should warm up an app and set isWarmedUp", async () => {
    const app = new Asi({ silent: true });
    app.get("/", () => "hello");

    const opt = new ServerlessOptimizer();
    await opt.warmUp(app);

    expect(opt.isWarmedUp).toBe(true);
    expect(opt.warmUpTime).toBeGreaterThanOrEqual(0);
  });

  test("should warm up with custom options", async () => {
    const app = new Asi({ silent: true });
    app.get("/test", () => "ok");

    const opt = new ServerlessOptimizer();
    await opt.warmUp(app, {
      precompile: true,
      preloadSchemaCache: true,
      flattenMiddleware: true,
      silent: true,
      eagerPlugins: false,
    });

    expect(opt.isWarmedUp).toBe(true);
  });

  test("should handle multiple warm-up calls", async () => {
    const app = new Asi({ silent: true });
    app.get("/a", () => "a");
    app.get("/b", () => "b");

    const opt = new ServerlessOptimizer();
    await opt.warmUp(app);
    const time1 = opt.warmUpTime;

    await opt.warmUp(app);
    const time2 = opt.warmUpTime;

    expect(opt.isWarmedUp).toBe(true);
    // Second warm-up may be faster (cached), but should still work
    expect(time2).toBeGreaterThanOrEqual(0);
  });

  test("should work on empty app", async () => {
    const app = new Asi({ silent: true });

    const opt = new ServerlessOptimizer();
    await opt.warmUp(app);

    expect(opt.isWarmedUp).toBe(true);
  });

  test("should handle warm-up with plugins", async () => {
    const app = new Asi({ silent: true });
    // Add a middleware as a plugin
    app.use(async (ctx, next) => {
      return next();
    });
    app.get("/", () => "hello");

    const opt = new ServerlessOptimizer();
    await opt.warmUp(app);

    expect(opt.isWarmedUp).toBe(true);
  });
});

// ============================================================================
// ServerlessOptimizer — bundleConfig
// ============================================================================

describe("ServerlessOptimizer — bundleConfig()", () => {
  const opt = new ServerlessOptimizer();

  test("should return config for cloudflare target", () => {
    const config = opt.bundleConfig("cloudflare", "src/index.ts");

    expect(config.target).toBe("cloudflare");
    expect(config.entry).toBe("src/index.ts");
    expect(config.outDir).toBe("dist/cloudflare");
    expect(config.minify).toBe(true);
    expect(config.inlineAsiJS).toBe(true);
  });

  test("should return config for lambda-edge target", () => {
    const config = opt.bundleConfig("lambda-edge", "src/index.ts");

    expect(config.target).toBe("lambda-edge");
    expect(config.outDir).toBe("dist/lambda");
    expect(config.externals).toContain("aws-sdk");
  });

  test("should return config for deno-deploy target", () => {
    const config = opt.bundleConfig("deno-deploy", "src/index.ts");

    expect(config.target).toBe("deno-deploy");
    expect(config.outDir).toBe("dist/deno");
    expect(config.inlineAsiJS).toBe(true);
  });

  test("should return config for vercel-edge target", () => {
    const config = opt.bundleConfig("vercel-edge", "src/index.ts");

    expect(config.target).toBe("vercel-edge");
    expect(config.outDir).toBe("dist/vercel");
  });

  test("should return config for netlify-edge target", () => {
    const config = opt.bundleConfig("netlify-edge", "index.ts");

    expect(config.target).toBe("netlify-edge");
    expect(config.outDir).toBe("dist/netlify");
    expect(config.entry).toBe("index.ts");
  });

  test("should return config for bun target", () => {
    const config = opt.bundleConfig("bun", "src/index.ts");

    expect(config.target).toBe("bun");
    expect(config.minify).toBe(false);
    expect(config.sourcemap).toBe(true);
    expect(config.inlineAsiJS).toBe(false);
  });

  test("should apply overrides", () => {
    const config = opt.bundleConfig("cloudflare", "src/index.ts", {
      outDir: "custom-out",
      minify: false,
      sourcemap: true,
    });

    expect(config.outDir).toBe("custom-out");
    expect(config.minify).toBe(false);
    expect(config.sourcemap).toBe(true);
  });

  test("should throw for unknown target", () => {
    expect(() => {
      opt.bundleConfig("nonexistent" as any, "src/index.ts");
    }).toThrow(/unsupported/i);
  });
});

// ============================================================================
// ServerlessOptimizer — buildCommand
// ============================================================================

describe("ServerlessOptimizer — buildCommand()", () => {
  const opt = new ServerlessOptimizer();

  test("should generate cloudflare build command", () => {
    const cmd = opt.buildCommand("cloudflare", "src/index.ts");

    expect(cmd).toContain("bun build");
    expect(cmd).toContain("src/index.ts");
    expect(cmd).toContain("dist/cloudflare");
    expect(cmd).toContain("--minify");
    expect(cmd).toContain("--target=bun");
  });

  test("should generate lambda-edge build command", () => {
    const cmd = opt.buildCommand("lambda-edge", "src/index.ts");

    expect(cmd).toContain("--external");
    expect(cmd).toContain("aws-sdk");
    expect(cmd).toContain("dist/lambda");
  });

  test("should generate deno-deploy build command", () => {
    const cmd = opt.buildCommand("deno-deploy", "src/index.ts");

    expect(cmd).toContain("dist/deno");
    expect(cmd).toContain("--target=bun");
  });

  test("should generate bun build command (no minify, sourcemap)", () => {
    const cmd = opt.buildCommand("bun", "src/index.ts");

    expect(cmd).toContain("dist");
    expect(cmd).not.toContain("--minify");
    expect(cmd).toContain("--sourcemap");
  });

  test("should accept config object directly", () => {
    const config: ServerlessBundleConfig = {
      target: "cloudflare",
      entry: "custom-entry.ts",
      outDir: "custom-dist",
      minify: false,
      treeshake: false,
      externals: ["my-dep"],
      inlineAsiJS: false,
      sourcemap: true,
      flags: ["--target=node"],
    };

    const cmd = opt.buildCommand(config);

    expect(cmd).toContain("custom-entry.ts");
    expect(cmd).toContain("custom-dist");
    expect(cmd).not.toContain("--minify");
    expect(cmd).toContain("--external my-dep");
    expect(cmd).toContain("--target=node");
  });
});

// ============================================================================
// lazyImport
// ============================================================================

describe("lazyImport()", () => {
  test("should not call factory until get() is called", async () => {
    let factoryCalled = false;

    const lazy = lazyImport(async () => {
      factoryCalled = true;
      return { value: 42 };
    });

    expect(factoryCalled).toBe(false);
    expect(lazy.loaded()).toBe(false);
  });

  test("should return the module", async () => {
    const lazy = lazyImport(async () => ({ value: 42 }));
    const mod = await lazy.get();

    expect(mod).toEqual({ value: 42 });
    expect(lazy.loaded()).toBe(true);
  });

  test("should cache the result on subsequent calls", async () => {
    let callCount = 0;

    const lazy = lazyImport(async () => {
      callCount++;
      return { value: callCount };
    });

    const mod1 = await lazy.get();
    expect(mod1).toEqual({ value: 1 });
    expect(callCount).toBe(1);

    const mod2 = await lazy.get();
    expect(mod2).toEqual({ value: 1 }); // Same cached value
    expect(callCount).toBe(1); // Factory not called again
  });

  test("should handle concurrent get() calls", async () => {
    let callCount = 0;

    const lazy = lazyImport(async () => {
      callCount++;
      // Simulate async work
      await new Promise((r) => setTimeout(r, 10));
      return { value: 42 };
    });

    const [result1, result2] = await Promise.all([lazy.get(), lazy.get()]);

    expect(result1).toEqual({ value: 42 });
    expect(result2).toEqual({ value: 42 });
    expect(callCount).toBe(1); // Factory called only once
    expect(lazy.loaded()).toBe(true);
  });

  test("should handle factory rejection", async () => {
    const lazy = lazyImport(async () => {
      throw new Error("import failed");
    });

    await expect(lazy.get()).rejects.toThrow("import failed");
    expect(lazy.loaded()).toBe(false);
  });

  test("loaded() should return false before get() and true after", async () => {
    const lazy = lazyImport(async () => ({ ok: true }));

    expect(lazy.loaded()).toBe(false);

    await lazy.get();

    expect(lazy.loaded()).toBe(true);
  });
});

// ============================================================================
// serverlessColdStartLogger
// ============================================================================

describe("serverlessColdStartLogger()", () => {
  test("should add X-Cold-Start headers on first request", async () => {
    const middleware = serverlessColdStartLogger();

    const mockCtx = {
      headers: new Headers(),
    } as any;

    const mockNext = async () => new Response("ok");

    const response = await middleware(mockCtx, mockNext);

    expect(response.headers.get("X-Cold-Start")).toBe("true");
    expect(response.headers.get("X-Cold-Start-Duration")).toMatch(/^\d+ms$/);
  });

  test("should set X-Cold-Start to false on subsequent requests", async () => {
    const middleware = serverlessColdStartLogger();

    const mockCtx = {} as any;
    const mockNext = async () => new Response("ok");

    // First request
    await middleware(mockCtx, mockNext);

    // Second request
    const response = await middleware(mockCtx, mockNext);

    expect(response.headers.get("X-Cold-Start")).toBe("false");
    expect(response.headers.get("X-Cold-Start-Duration")).toBeNull();
  });
});

// ============================================================================
// SERVERLESS_PLATFORMS
// ============================================================================

describe("SERVERLESS_PLATFORMS", () => {
  test("should have all 6 platforms", () => {
    const targets = Object.keys(SERVERLESS_PLATFORMS);
    expect(targets).toContain("cloudflare");
    expect(targets).toContain("lambda-edge");
    expect(targets).toContain("deno-deploy");
    expect(targets).toContain("vercel-edge");
    expect(targets).toContain("netlify-edge");
    expect(targets).toContain("bun");
  });

  test("each platform should have required fields", () => {
    for (const [key, platform] of Object.entries(SERVERLESS_PLATFORMS)) {
      expect(platform.name).toBeTruthy();
      expect(platform.target).toBe(key);
      expect(platform.adapter).toBeTruthy();
      expect(platform.runtime).toBeTruthy();
      expect(platform.maxDuration).toBeTruthy();
      expect(platform.memoryLimit).toBeTruthy();
      expect(platform.bundleSizeLimit).toBeTruthy();
      expect(platform.coldStartTypical).toBeTruthy();
      expect(Array.isArray(platform.bestPractices)).toBe(true);
      expect(platform.bestPractices.length).toBeGreaterThan(0);
    }
  });

  test("cloudflare should have relevant best practices", () => {
    const cf = SERVERLESS_PLATFORMS.cloudflare;
    expect(cf.bestPractices.some((bp) => bp.includes("bundle"))).toBe(true);
    expect(cf.bestPractices.some((bp) => bp.includes("Node.js"))).toBe(true);
    expect(cf.bestPractices.some((bp) => bp.includes("Cache"))).toBe(true);
  });

  test("lambda-edge should mention cold start mitigation", () => {
    const le = SERVERLESS_PLATFORMS["lambda-edge"];
    expect(le.bestPractices.some((bp) => bp.includes("lazyImport") || bp.includes("lruSchemaCache"))).toBe(true);
  });
});

// ============================================================================
// Global Singleton
// ============================================================================

describe("global serverless singleton", () => {
  test("should be an instance of ServerlessOptimizer", () => {
    expect(serverless).toBeInstanceOf(ServerlessOptimizer);
  });

  test("should be warmed up after warmUp call", async () => {
    const app = new Asi({ silent: true });
    app.get("/", () => "hello");

    // Use a fresh optimizer to avoid cross-test pollution
    const opt = new ServerlessOptimizer();
    await opt.warmUp(app);

    expect(opt.isWarmedUp).toBe(true);
  });
});

// ============================================================================
// Integration: ServerlessOptimizer + lazyImport
// ============================================================================

describe("ServerlessOptimizer integration", () => {
  test("warmUp should not break route handling", async () => {
    const app = new Asi({ silent: true });
    app.get("/hello", () => new Response("world"));

    const opt = new ServerlessOptimizer();
    await opt.warmUp(app);

    // Create a test request
    const req = new Request("http://localhost/hello");
    const response = await app.handle(req);

    expect(response).toBeTruthy();
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe("world");
  });

  test("lazyImport can be combined with warmUp", async () => {
    const app = new Asi({ silent: true });
    app.get("/", () => "hello");

    const lazyDb = lazyImport(async () => ({ query: "SELECT 1" }));

    expect(lazyDb.loaded()).toBe(false);

    const opt = new ServerlessOptimizer();
    await opt.warmUp(app);

    // lazyImport should not be triggered by warmUp
    expect(lazyDb.loaded()).toBe(false);

    // Load on demand
    const db = await lazyDb.get();
    expect(db.query).toBe("SELECT 1");
    expect(lazyDb.loaded()).toBe(true);
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("Edge cases", () => {
  test("bundleConfig should preserve entry for all targets", () => {
    const opt = new ServerlessOptimizer();
    const targets: ServerlessTarget[] = [
      "cloudflare",
      "lambda-edge",
      "deno-deploy",
      "vercel-edge",
      "netlify-edge",
      "bun",
    ];

    for (const target of targets) {
      const config = opt.bundleConfig(target, "src/app.ts");
      expect(config.entry).toBe("src/app.ts");
      expect(config.target).toBe(target);
    }
  });

  test("buildCommand should handle edge cases gracefully", () => {
    const opt = new ServerlessOptimizer();

    // Config with no flags
    const config: ServerlessBundleConfig = {
      target: "cloudflare",
      entry: "app.ts",
      outDir: ".output",
      minify: false,
      treeshake: false,
      externals: [],
      inlineAsiJS: true,
      sourcemap: false,
      flags: [],
    };

    const cmd = opt.buildCommand(config);
    expect(cmd).toContain("bun build app.ts");
    expect(cmd).toContain("--outdir .output");
    expect(cmd).not.toContain("--minify");
    expect(cmd).not.toContain("--sourcemap");
  });

  test("coldStartLogger should work with custom response", async () => {
    const middleware = serverlessColdStartLogger();

    // Simulate a custom response
    const response = await middleware({} as any, async () => {
      return new Response("custom", { status: 201 });
    });

    expect(response.status).toBe(201);
    expect(response.headers.get("X-Cold-Start")).toBe("true");
  });
});
