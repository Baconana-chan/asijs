/**
 * Serverless Cold Start Optimization for AsiJS
 *
 * Minimises cold-start latency on serverless platforms (Cloudflare Workers,
 * Lambda@Edge, Deno Deploy, Vercel Edge) through four strategies:
 *
 * 1. **Minimal bundle** — tree-shake unused modules, target-specific builds
 * 2. **Lazy plugin loading** — defer imports until plugin.setup() is called
 * 3. **Warm start emulation** — precompile routes, preload schema validators,
 *    flatten middleware chains at build time (or on first request)
 * 4. **Best practices** — documented patterns for each platform
 *
 * @example
 * ```ts
 * import { Asi, serverless } from "asijs";
 *
 * // Apply all serverless optimisations
 * const app = new Asi();
 * serverless.warmUp(app);
 *
 * // Use lazy imports for heavy plugins
 * const db = () => serverless.lazyImport(() => import("./db"));
 *
 * // Build for Cloudflare Workers
 * // $ asi build --target cloudflare
 * ```
 */

import type { Asi } from "./asi";
import type { Middleware } from "./types";
import type { Context } from "./context";

// ============================================================================
// Types
// ============================================================================

/** Supported serverless platforms */
export type ServerlessTarget = "cloudflare" | "lambda-edge" | "deno-deploy" | "vercel-edge" | "netlify-edge" | "bun";

/** Bundle configuration for a serverless target */
export interface ServerlessBundleConfig {
  /** Target platform */
  target: ServerlessTarget;
  /** Entry file path */
  entry: string;
  /** Output directory */
  outDir: string;
  /** Whether to minify */
  minify: boolean;
  /** Whether to treeshake unused exports */
  treeshake: boolean;
  /** External packages (not bundled) */
  externals: string[];
  /** Whether to inline asiijs core (or keep as external) */
  inlineAsiJS: boolean;
  /** Generate sourcemap */
  sourcemap: boolean;
  /** Additional build flags */
  flags: string[];
}

/** Options for serverless warm-up */
export interface WarmUpOptions {
  /** Whether to precompile all routes (default: true) */
  precompile?: boolean;
  /** Whether to preload schema validator cache (default: true) */
  preloadSchemaCache?: boolean;
  /** Whether to flatten middleware chains (default: true) */
  flattenMiddleware?: boolean;
  /** Whether to disable logging for cold-start noise (default: true) */
  silent?: boolean;
  /** Whether to eager-load lazy plugins during warm-up (default: true) */
  eagerPlugins?: boolean;
}

/** Serverless platform info for documentation */
export interface ServerlessPlatformInfo {
  /** Platform name */
  name: string;
  /** Bundle target */
  target: ServerlessTarget;
  /** Adapter function */
  adapter: string;
  /** Runtime */
  runtime: string;
  /** Max execution time */
  maxDuration: string;
  /** Memory limit */
  memoryLimit: string;
  /** Bundle size limit */
  bundleSizeLimit: string;
  /** Cold start typical */
  coldStartTypical: string;
  /** Best practices specific to this platform */
  bestPractices: string[];
}

// ============================================================================
// Default Bundle Configs by Target
// ============================================================================

const DEFAULT_CONFIGS: Record<ServerlessTarget, Omit<ServerlessBundleConfig, "entry">> = {
  "cloudflare": {
    target: "cloudflare",
    outDir: "dist/cloudflare",
    minify: true,
    treeshake: true,
    externals: [],
    inlineAsiJS: true,
    sourcemap: false,
    flags: ["--target=bun"],
  },
  "lambda-edge": {
    target: "lambda-edge",
    outDir: "dist/lambda",
    minify: true,
    treeshake: true,
    externals: ["aws-sdk"],
    inlineAsiJS: true,
    sourcemap: false,
    flags: ["--target=node"],
  },
  "deno-deploy": {
    target: "deno-deploy",
    outDir: "dist/deno",
    minify: true,
    treeshake: true,
    externals: [],
    inlineAsiJS: true,
    sourcemap: false,
    flags: ["--target=bun"],
  },
  "vercel-edge": {
    target: "vercel-edge",
    outDir: "dist/vercel",
    minify: true,
    treeshake: true,
    externals: [],
    inlineAsiJS: true,
    sourcemap: false,
    flags: ["--target=bun"],
  },
  "netlify-edge": {
    target: "netlify-edge",
    outDir: "dist/netlify",
    minify: true,
    treeshake: true,
    externals: [],
    inlineAsiJS: true,
    sourcemap: false,
    flags: ["--target=bun"],
  },
  "bun": {
    target: "bun",
    outDir: "dist",
    minify: false,
    treeshake: true,
    externals: [],
    inlineAsiJS: false,
    sourcemap: true,
    flags: ["--target=bun"],
  },
};

// ============================================================================
// ServerlessOptimizer
// ============================================================================

/**
 * Serverless optimisation toolkit.
 *
 * Provides methods for warm-start emulation, lazy imports, and bundle
 * configuration for various serverless platforms.
 */
export class ServerlessOptimizer {
  private _warmedUp = false;
  private _warmUpTime = 0;

  /**
   * Pre-compile routes, preload schema validators, and flatten middleware
   * chains so the first request doesn't pay the compilation cost.
   *
   * Call right after registering all routes/plugins, before export.
   *
   * **Note:** When `eagerPlugins` is true, this method may perform
   * asynchronous work (plugin initialization). The returned promise
   * resolves once warm-up is complete. In synchronous contexts,
   * you can still call it without awaiting — the essential
   * compilation steps are synchronous.
   *
   * @example
   * ```ts
   * const app = new Asi({ silent: true });
   * app.get("/", () => "Hello!");
   * await serverless.warmUp(app);
   * export default app;
   * ```
   */
  async warmUp(app: Asi, options: WarmUpOptions = {}): Promise<this> {
    const {
      precompile = true,
      preloadSchemaCache = true,
      flattenMiddleware = true,
      silent = true,
      eagerPlugins = true,
    } = options;

    const start = performance.now();

    // Step 1: Initialise all pending plugins
    if (eagerPlugins && typeof (app as any).initPlugins === "function") {
      try {
        await (app as any).initPlugins();
      } catch {
        // Plugin init failed — continue with warm-up anyway
      }
    }

    // Step 2: Precompile all routes (calls compile() which precomputes
    // validators and builds the static router)
    if (precompile) {
      if (typeof (app as any).compile === "function") {
        (app as any).compile();
      }
    }

    // Step 3: Set config flags for optimal runtime
    if (preloadSchemaCache && typeof (app as any).config !== "undefined") {
      const cfg = (app as any).config;
      // Enable LRU schema cache to prevent unbounded memory growth
      if (cfg.lruSchemaCache === undefined || cfg.lruSchemaCache === false) {
        cfg.lruSchemaCache = true;
      }
      // Enable middleware chain flattener for fewer per-request closures
      if (flattenMiddleware && (cfg.flattenMiddleware === undefined || cfg.flattenMiddleware === false)) {
        cfg.flattenMiddleware = true;
      }
    }

    if (silent) {
      if (typeof (app as any).config !== "undefined") {
        (app as any).config.silent = true;
      }
    }

    this._warmedUp = true;
    this._warmUpTime = performance.now() - start;
    return this;
  }

  /**
   * Check if the app has been warmed up.
   */
  get isWarmedUp(): boolean {
    return this._warmedUp;
  }

  /**
   * Get the time taken for the last warm-up (ms).
   */
  get warmUpTime(): number {
    return this._warmUpTime;
  }

  /**
   * Build configuration for a specific serverless target.
   *
   * Returns a bundle config object suitable for `asi build` or `bun build`.
   *
   * @example
   * ```ts
   * const config = serverless.bundleConfig("cloudflare", "src/index.ts");
   * // Use config.flags to pass to bun build
   * ```
   */
  bundleConfig(target: ServerlessTarget, entry: string, overrides?: Partial<ServerlessBundleConfig>): ServerlessBundleConfig {
    const defaults = DEFAULT_CONFIGS[target];
    if (!defaults) {
      throw new Error(`Unsupported serverless target: "${target}"`);
    }
    return {
      ...defaults,
      entry,
      ...overrides,
    };
  }

  /**
   * Build the app for production (generates CLI command).
   * Returns the shell command to execute.
   *
   * @example
   * ```ts
   * const cmd = serverless.buildCommand("cloudflare", "src/index.ts");
   * // Returns: "bun build src/index.ts --outdir dist/cloudflare --target bun --minify"
   * ```
   */
  buildCommand(targetOrConfig: ServerlessTarget | ServerlessBundleConfig, entry?: string): string {
    const config: ServerlessBundleConfig = typeof targetOrConfig === "string"
      ? this.bundleConfig(targetOrConfig, entry ?? "src/index.ts")
      : targetOrConfig;

    const parts: string[] = ["bun", "build", config.entry];

    if (config.outDir) {
      parts.push("--outdir", config.outDir);
    }
    if (config.minify) {
      parts.push("--minify");
    }
    if (config.sourcemap) {
      parts.push("--sourcemap");
    }
    if (config.treeshake) {
      parts.push("--treeshaking");
    }
    for (const ext of config.externals) {
      parts.push("--external", ext);
    }
    for (const flag of config.flags) {
      parts.push(flag);
    }

    return parts.join(" ");
  }
}

// ============================================================================
// Lazy Import Helper
// ============================================================================

/**
 * Create a lazy import wrapper.
 *
 * The factory function is NOT called until the first `.get()` access.
 * Useful for heavy dependencies (database drivers, template engines, etc.)
 * that should only load when actually used.
 *
 * @example
 * ```ts
 * // Instead of:
 * import { heavyLib } from "heavy-lib";
 *
 * // Do:
 * const heavyLib = lazyImport(() => import("heavy-lib"));
 *
 * // Use anywhere:
 * const lib = await heavyLib.get();
 * lib.doSomething();
 * ```
 */
export function lazyImport<T>(factory: () => Promise<T>): { get(): Promise<T>; loaded(): boolean } {
  let instance: T | null = null;
  let promise: Promise<T> | null = null;
  let loaded = false;

  return {
    /**
     * Get the lazily-loaded module.
     * First call triggers the import, subsequent calls return cached instance.
     */
    async get(): Promise<T> {
      if (instance) return instance;
      if (!promise) {
        promise = factory().then((mod) => {
          instance = mod;
          loaded = true;
          return mod;
        });
      }
      return promise;
    },

    /** Check if the module has been loaded */
    loaded(): boolean {
      return loaded;
    },
  };
}

// ============================================================================
// Singleton instance
// ============================================================================

/** Global singleton serverless optimizer instance */
export const serverless = new ServerlessOptimizer();

// ============================================================================
// Platform-Specific Information & Best Practices
// ============================================================================

/**
 * Platform information and best practices for each serverless target.
 */
export const SERVERLESS_PLATFORMS: Record<ServerlessTarget, ServerlessPlatformInfo> = {
  "cloudflare": {
    name: "Cloudflare Workers",
    target: "cloudflare",
    adapter: "cloudflare(app)",
    runtime: "V8 Isolates (Service Workers API)",
    maxDuration: "30s (CPU), 30s (wall clock)",
    memoryLimit: "128 MB",
    bundleSizeLimit: "1 MB (free) / 10 MB (paid)",
    coldStartTypical: "< 5ms (V8 isolates are near-zero cold start)",
    bestPractices: [
      "Use `serverless.warmUp(app)` before export to precompile routes outside the request path",
      "Keep bundle under 1 MB for free tier — use `asi build --target cloudflare --minify`",
      "Avoid Node.js built-in modules (fs, net, crypto) — use Web Crypto API instead",
      "Use `withWaitUntil()` for background tasks (analytics, logging) without blocking the response",
      "Cache external API responses with the `deduplicate()` middleware + XFetch to reduce Worker CPU time",
      "Use `Cache-Control` headers for static content — Cloudflare caches at the edge automatically",
      "Avoid heavy npm dependencies that increase cold-start bundle size",
      "Use `lazyImport()` for database drivers and ORMs that you only need on specific routes",
      "Set `ASIJS_ENV=production` to disable dev-mode error pages (saves ~20KB in the bundle)",
      "Set `development: false` in Asi config to skip dev-mode features",
    ],
  },
  "lambda-edge": {
    name: "Lambda@Edge (CloudFront)",
    target: "lambda-edge",
    adapter: "lambdaEdge(app)",
    runtime: "Node.js 18+",
    maxDuration: "5s (viewer-request/response) / 30s (origin-request/response)",
    memoryLimit: "128 MB – 10,240 MB (in 1 MB increments)",
    bundleSizeLimit: "50 MB (zipped, including layers)",
    coldStartTypical: "50ms–500ms (V8 snapshot + Lambda sandbox)",
    bestPractices: [
      "Use `asi build --target lambda-edge` to produce a Node.js-compatible bundle",
      "Precompile routes with `serverless.warmUp(app)` to move compilation out of the request path",
      "Keep dependencies minimal — each npm package adds ~50-200ms to cold start",
      "Use `lazyImport()` for heavy modules (ORM, template engines) that aren't needed on every request",
      "Enable `lruSchemaCache` to prevent schema validator memory growth across invocations",
      "Use environment variables for configuration instead of runtime config files",
      "Consider using Lambda SnapStart for sub-100ms cold starts (requires Java runtime, but Node.js support is in preview)",
      "Avoid storing state in global variables across invocations — use external cache (Redis/Memcached) or DynamoDB",
      "Set `development: false` and `silent: true` in Asi config to skip dev overhead",
    ],
  },
  "deno-deploy": {
    name: "Deno Deploy",
    target: "deno-deploy",
    adapter: "deno(app)",
    runtime: "Deno / V8 Isolates",
    maxDuration: "30s (wall clock)",
    memoryLimit: "128 MB",
    bundleSizeLimit: "10 MB",
    coldStartTypical: "< 10ms (V8 isolates, similar to Cloudflare)",
    bestPractices: [
      "Use `deno(app)` adapter to export a fetch handler compatible with Deno Deploy",
      "Precompile with `serverless.warmUp(app)` and enable `flattenMiddleware` for fewer closures at runtime",
      "Deno Deploy supports most Web APIs — prefer native `fetch`, `WebSocket`, `crypto` over Node.js polyfills",
      "Avoid `fs` and `net` modules — Deno Deploy doesn't support file system or raw TCP access",
      "Use `lazyImport()` for npm packages via the `npm:` specifier (they have higher cold-start overhead)",
      "Cache async imports with `lazyImport()` to avoid repeated dynamic import costs",
      "Use `Cache-Control` headers and `deduplicate()` middleware to reduce CPU usage",
    ],
  },
  "vercel-edge": {
    name: "Vercel Edge Functions",
    target: "vercel-edge",
    adapter: "toFetchHandler(app)",
    runtime: "V8 Isolates (similar to Cloudflare Workers)",
    maxDuration: "30s (Hobby) / 60s (Pro) / 900s (Enterprise)",
    memoryLimit: "128 MB",
    bundleSizeLimit: "1 MB (free) / 4 MB (pro)",
    coldStartTypical: "< 10ms",
    bestPractices: [
      "Use `asi build --target vercel-edge` for a Vercel-compatible bundle",
      "Export the fetch handler: `export default toFetchHandler(app)`",
      "Vercel Edge supports Edge Middleware — use `toFetchHandler(app)` for middleware functions",
      "Keep bundle under 1 MB — Vercel enforces strict size limits for Edge Functions",
      "Avoid Node.js APIs (fs, net, crypto) — use Web APIs instead",
      "Use `serverless.warmUp(app)` to precompile routes before the first request",
      "Consider splitting into Serverless Functions (Node.js) for heavy computation and Edge Functions for routing/auth",
    ],
  },
  "netlify-edge": {
    name: "Netlify Edge Functions",
    target: "netlify-edge",
    adapter: "netlifyEdge(app)",
    runtime: "Deno-based (similar to Deno Deploy)",
    maxDuration: "10s (free) / 50s (pro)",
    memoryLimit: "128 MB",
    bundleSizeLimit: "50 MB",
    coldStartTypical: "< 50ms",
    bestPractices: [
      "Use `asi build --target netlify-edge` for a Netlify-compatible bundle",
      "Export from `netlify/edge-functions/`: `export default netlifyEdge(app)`",
      "Netlify Edge Functions run on Deno — prefer Web APIs over Node.js APIs",
      "Use `serverless.warmUp(app)` to precompile routes",
      "Netlify supports Edge+Serverless hybrid — use Edge Functions for auth/redirects, Serverless for APIs",
      "Cache external API calls aggressively with `deduplicate()` middleware to reduce edge execution time",
    ],
  },
  "bun": {
    name: "Bun (Node.js compat)",
    target: "bun",
    adapter: "app.listen() / app.handle()",
    runtime: "JavaScriptCore (Bun)",
    maxDuration: "N/A (long-running server)",
    memoryLimit: "Depends on host",
    bundleSizeLimit: "N/A",
    coldStartTypical: "N/A (long-running process)",
    bestPractices: [
      "Bun is the primary target — no special cold-start optimisations needed for long-running servers",
      "Use `asi build --target bun` for production deployment on Bun servers",
      "Enable `compile()` for ~2x faster route matching",
      "Use `flattenMiddleware: true` for fewer per-request closures",
      "Set `development: false` in production to disable dev error pages",
    ],
  },
};

// ============================================================================
// Helper: create a minimal middleware that logs cold-start duration
// ============================================================================

/**
 * Middleware that logs the cold-start duration on the first request.
 * Useful for monitoring and optimisation.
 *
 * @example
 * ```ts
 * app.use(serverlessColdStartLogger());
 * ```
 */
export function serverlessColdStartLogger(): Middleware {
  let isColdStart = true;
  const startedAt = Date.now();

  return async (ctx: Context, next: () => Promise<Response>): Promise<Response> => {
    if (isColdStart) {
      isColdStart = false;
      const coldStartMs = Date.now() - startedAt;
      // Set response header for debugging
      const response = await next();
      response.headers.set("X-Cold-Start", "true");
      response.headers.set("X-Cold-Start-Duration", `${coldStartMs}ms`);
      return response;
    }

    const response = await next();
    response.headers.set("X-Cold-Start", "false");
    return response;
  };
}

// ============================================================================
// Helper: bundle size analysis
// ============================================================================

/**
 * Estimate bundle size for a given entry point and target.
 * Returns a string summary.
 *
 * @example
 * ```ts
 * const size = await serverless.estimateBundleSize("src/index.ts", "cloudflare");
 * console.log(size); // "Estimated bundle: 245 KB (Cloudflare Workers)"
 * ```
 */
export async function estimateBundleSize(entry: string, target: ServerlessTarget): Promise<string> {
  try {
    const config = DEFAULT_CONFIGS[target];
    const outDir = config?.outDir ?? "dist";

    // Use Bun's build API to estimate size
    const result = await Bun.build({
      entrypoints: [entry],
      outdir: outDir,
      target: "bun",
      minify: true,
    });

    const totalBytes = result.outputs.reduce((sum, output) => sum + output.size, 0);
    const sizeKB = (totalBytes / 1024).toFixed(1);
    const limit = SERVERLESS_PLATFORMS[target]?.bundleSizeLimit ?? "N/A";
    return `Estimated bundle: ${sizeKB} KB — (${SERVERLESS_PLATFORMS[target]?.name ?? target}) [limit: ${limit}]`;
  } catch (err) {
    return `Bundle estimation failed: ${(err as Error).message}`;
  }
}
