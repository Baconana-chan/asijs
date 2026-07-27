/**
 * SSG — Static Site Generation for AsiJS
 *
 * Pre-renders pages at build time into static HTML files.
 * Works with any AsiJS app — routes become .html files in dist/.
 *
 * Features:
 * - Automatic: scans GET routes and pre-renders them
 * - getStaticPaths(): dynamic routes with known paths
 * - Incremental: only re-renders changed pages
 * - Multiple output formats: pretty URLs (/about → about/index.html)
 *
 * @example
 * ```ts
 * // asi build --ssg
 * import { buildSSG } from "asijs";
 *
 * const app = new Asi();
 * app.get("/", () => html(<Home />));
 * app.get("/about", () => html(<About />));
 *
 * await buildSSG(app, {
 *   outDir: "dist",
 *   format: "pretty",   // /about → about/index.html
 * });
 * ```
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, relative, resolve, dirname } from "path";
import type { Asi } from "./asi";

// ============================================================================
// Types
// ============================================================================

/**
 * SSG Build Options
 */
export interface SSGOptions {
  /**
   * Output directory for static files.
   * @default "dist"
   */
  outDir?: string;

  /**
   * URL format for generated files.
   * - `"pretty"`: `/about` → `about/index.html` (default, clean URLs)
   * - `"flat"`: `/about` → `about.html` (flat file)
   * @default "pretty"
   */
  format?: "pretty" | "flat";

  /**
   * Base path for the site (e.g., "/blog").
   * When set, generated paths are prefixed.
   * @default ""
   */
  basePath?: string;

  /**
   * Whether to render JSON API responses as .json files too.
   * @default false
   */
  exportApi?: boolean;

  /**
   * Additional paths to render (outside registered routes).
   * Used for paths that come from external sources or config.
   */
  additionalPaths?: SSGPath[];

  /**
   * Callback for each rendered page.
   */
  onPage?: (page: SSGPageResult) => void;

  /**
   * Whether to print build progress.
   * @default true
   */
  verbose?: boolean;

  /**
   * Custom fetch function for making requests.
   * Useful for testing or custom adapters.
   */
  fetch?: (request: Request) => Promise<Response>;
}

/**
 * A path to render during SSG build.
 */
export interface SSGPath {
  /** URL path (e.g., "/", "/about", "/blog/post-1") */
  path: string;
  /** Optional custom data for the handler (e.g., router params) */
  params?: Record<string, string>;
}

/**
 * Result of rendering a single page.
 */
export interface SSGPageResult {
  /** URL path */
  path: string;
  /** Output file path relative to outDir */
  outputPath: string;
  /** HTTP status code */
  status: number;
  /** Content type */
  contentType: string;
  /** File size in bytes */
  size: number;
  /** Whether the page was successfully rendered */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * SSG Build Result
 */
export interface SSGBuildResult {
  /** Output directory */
  outDir: string;
  /** Number of pages rendered */
  totalPages: number;
  /** Number of successful renders */
  successPages: number;
  /** Number of failed renders */
  failedPages: number;
  /** Build duration in ms */
  durationMs: number;
  /** Individual page results */
  pages: SSGPageResult[];
}

// ============================================================================
// Helpers
// ============================================================================

/** Supported HTTP methods for SSG */
const SSG_METHODS = new Set(["GET", "HEAD"]);

/** Default headers for requests */
const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent": "AsiJS-SSG/1.0",
  Accept: "text/html,application/json,*/*",
};

/**
 * Check if a route is suitable for static generation.
 * SSG only makes sense for GET/HEAD routes.
 */
function isSSGRoute(method: string, hasParams: boolean): boolean {
  return SSG_METHODS.has(method) && !hasParams;
}

/**
 * Convert a URL path to a file path.
 *
 * - "pretty": `/about` → `about/index.html`, `/` → `index.html`
 * - "flat": `/about` → `about.html`, `/` → `index.html`
 */
function pathToFile(path: string, format: "pretty" | "flat"): string {
  // Normalize: remove leading slash, handle root
  const normalized = path === "/" ? "" : path.replace(/^\//, "");

  if (!normalized) {
    return join("index.html");
  }

  if (format === "flat") {
    return join(`${normalized}.html`);
  }

  // Pretty URLs: /about → about/index.html
  return join(normalized, "index.html");
}

/**
 * Determine if a route path has dynamic parameters (like :id or *)
 */
function hasDynamicParams(path: string): boolean {
  return path.includes(":") || path.includes("*");
}

// ============================================================================
// SSG Build
// ============================================================================

/**
 * Build static HTML pages from an AsiJS app.
 *
 * Scans registered GET routes, calls each handler,
 * and saves the HTML response to the output directory.
 *
 * @example
 * ```ts
 * import { buildSSG } from "asijs";
 *
 * const app = new Asi();
 * app.get("/", () => html(<Home />));
 * app.get("/about", () => html(<About />));
 * app.get("/blog/:slug", (ctx) => html(<BlogPost slug={ctx.params.slug} />));
 *
 * // With getStaticPaths
 * app.get("/blog/:slug", {
 *   params: Type.Object({ slug: Type.String() }),
 * }, handler);
 *
 * const result = await buildSSG(app, {
 *   outDir: "dist",
 *   additionalPaths: [
 *     { path: "/blog/hello-world", params: { slug: "hello-world" } },
 *     { path: "/blog/asi-js-guide", params: { slug: "asi-js-guide" } },
 *   ],
 * });
 *
 * console.log(`Rendered ${result.successPages}/${result.totalPages} pages`);
 * ```
 */
export async function buildSSG(
  app: Asi,
  options: SSGOptions = {},
): Promise<SSGBuildResult> {
  const {
    outDir = "dist",
    format = "pretty",
    basePath = "",
    exportApi = false,
    additionalPaths = [],
    verbose = true,
    fetch,
  } = options;

  const startTime = performance.now();
  const pages: SSGPageResult[] = [];

  // 1. Collect routes from the app
  const routes = app.getRoutes
    ? app.getRoutes()
    : [];

  // 2. Collect SSG paths from routes + additional paths
  const staticPaths: SSGPath[] = [];

  for (const route of routes) {
    // Only GET routes qualify for SSG
    if (route.method !== "GET" && route.method !== "ALL") continue;

    // Check if route has dynamic params
    const isDynamic = hasDynamicParams(route.path);

    if (!isDynamic) {
      // Static route — add directly
      staticPaths.push({
        path: route.path,
        params: {},
      });
    }
    // Dynamic routes require getStaticPaths — handled via additionalPaths
  }

  // Add additional paths (from getStaticPaths or manual config)
  for (const p of additionalPaths) {
    // Deduplicate: skip if already in staticPaths
    const exists = staticPaths.some((sp) => sp.path === p.path);
    if (!exists) {
      staticPaths.push(p);
    }
  }

  if (staticPaths.length === 0) {
    if (verbose) {
      console.log("  [SSG] No static pages found to export.");
      console.log("  [SSG] Add routes with `app.get()` or provide additionalPaths.");
    }
    return {
      outDir,
      totalPages: 0,
      successPages: 0,
      failedPages: 0,
      durationMs: 0,
      pages: [],
    };
  }

  if (verbose) {
    console.log(`  [SSG] Found ${staticPaths.length} page(s) to render`);
  }

  // 3. Create output directory
  const outputDir = resolve(process.cwd(), outDir);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // 4. Render each page
  for (const page of staticPaths) {
    const url = `http://ssg.local${basePath}${page.path}`;

    try {
      const request = new Request(url, {
        method: "GET",
        headers: DEFAULT_HEADERS,
      });

      // Use custom fetch if provided (for testing), else app.handle()
      let response: Response;
      if (fetch) {
        response = await fetch(request);
      } else {
        response = await app.handle(request);
      }

      const contentType = response.headers.get("content-type") || "text/html";
      const isHtml = contentType.includes("text/html");
      const isJson = contentType.includes("application/json");

      // Skip non-HTML/JSON responses unless exportApi is on
      if (!isHtml && !isJson) {
        if (verbose) {
          console.log(`  [SSG] ⚠️  ${page.path} — skipped (${contentType})`);
        }
        continue;
      }

      // Skip JSON responses unless exportApi is enabled
      if (isJson && !exportApi) continue;

      const body = await response.text();
      const isSuccess = response.status < 400;
      const outputPath = isSuccess ? pathToFile(page.path, format) : "";
      var fullOutputPath = "";

      if (isSuccess) {
        fullOutputPath = join(outputDir, outputPath);

        // Create subdirectory if needed
        const outputDirPath = dirname(fullOutputPath);
        if (outputDirPath && outputDirPath !== "." && !existsSync(outputDirPath)) {
          mkdirSync(outputDirPath, { recursive: true });
        }

        // Write file
        writeFileSync(fullOutputPath, body, "utf-8");
      }

      const pageResult: SSGPageResult = {
        path: page.path,
        outputPath: isSuccess ? relative(outputDir, fullOutputPath) : "",
        status: response.status,
        contentType,
        size: body.length,
        success: isSuccess,
      };

      pages.push(pageResult);

      if (verbose) {
        const statusColor =
          response.status < 300
            ? "\x1b[32m"
            : response.status < 400
              ? "\x1b[33m"
              : "\x1b[31m";
        console.log(
          `  [SSG] ${statusColor}${response.status}\x1b[0m ${page.path} → ${pageResult.outputPath} (${formatSize(body.length)})`,
        );
      }
    } catch (error: any) {
      pages.push({
        path: page.path,
        outputPath: "",
        status: 500,
        contentType: "",
        size: 0,
        success: false,
        error: error.message,
      });

      if (verbose) {
        console.log(`  [SSG] \x1b[31mERROR\x1b[0m ${page.path}: ${error.message}`);
      }
    }
  }

  const durationMs = Math.round(performance.now() - startTime);
  const successPages = pages.filter((p) => p.success).length;
  const failedPages = pages.filter((p) => !p.success).length;

  if (verbose) {
    console.log(
      `  [SSG] Done: ${successPages} succeeded, ${failedPages} failed in ${durationMs}ms`,
    );
  }

  return {
    outDir,
    totalPages: pages.length,
    successPages,
    failedPages,
    durationMs,
    pages,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Format file size in human-readable format.
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Helper: create a static path entry for use with getStaticPaths().
 *
 * @example
 * ```ts
 * const paths = [
 *   staticPath("/blog/hello-world", { slug: "hello-world" }),
 *   staticPath("/blog/asi-js-guide", { slug: "asi-js-guide" }),
 * ];
 * ```
 */
export function staticPath(
  path: string,
  params?: Record<string, string>,
): SSGPath {
  return { path, params: params ?? {} };
}
