/**
 * File-based routing for AsiJS
 *
 * Converts a directory of route files into registered routes:
 *
 * ```
 * src/routes/
 *   users.ts           → export function get/post/put/delete/patch
 *   users/[id].ts      → GET /users/:id
 *   users/[id].get.ts  → GET /users/:id  (method suffix)
 *   users/index.ts     → GET /users  (index = dir root)
 *   (auth)/login.ts    → /login  ((group) ignored in path)
 *   _helpers.ts        → skipped  (_private files ignored)
 * ```
 */

import path from "path";
import fs from "fs";
import type { Asi } from "./asi";
import type { Handler, RouteMethod, RouteOptions } from "./types";

// ===== Types =====

/** A parsed route from a file */
export interface FileRoute {
  method: RouteMethod;
  path: string;
  handler: Handler;
  options?: RouteOptions;
}

/** Options for file-based routing */
export interface FileRoutesOptions {
  /** Directory to scan for route files (default: "src/routes") */
  dir?: string;
  /** Base path prefix added to all discovered routes (default: "/") */
  prefix?: string;
  /** Ignore pattern for files/dirs (default: /^_/) */
  ignore?: RegExp;
  /** Log discovered routes to console */
  verbose?: boolean;
}

// ===== Helpers =====

const SUPPORTED_METHODS = [
  "get",
  "post",
  "put",
  "delete",
  "patch",
  "head",
  "options",
  "all",
] as const;

/** Extract HTTP method suffix from a filename, e.g. users.get.ts → { method: "GET", baseName: "users" } */
function parseMethodSuffix(
  filename: string,
): { method?: RouteMethod; baseName: string } {
  for (const m of SUPPORTED_METHODS) {
    const suffix = `.${m}`;
    if (filename.toLowerCase().endsWith(suffix + ".ts") ||
        filename.toLowerCase().endsWith(suffix + ".tsx") ||
        filename.toLowerCase().endsWith(suffix + ".js") ||
        filename.toLowerCase().endsWith(suffix + ".jsx")) {
      const ext = filename.slice(filename.lastIndexOf("."));
      return {
        method: m.toUpperCase() as RouteMethod,
        baseName: filename.slice(0, -(suffix.length + ext.length)),
      };
    }
  }
  return { baseName: filename.replace(/\.(ts|tsx|js|jsx)$/, "") };
}

/** Convert a relative file path to a route path segment */
function filePathToRoutePath(relativePath: string): string {
  // Normalize to forward slashes
  let route = relativePath.replace(/\\/g, "/");

  // Remove extension
  route = route.replace(/\.(ts|tsx|js|jsx)$/, "");

  // Remove index from end
  if (route.endsWith("/index")) {
    route = route.slice(0, -6);
  }

  // Convert [param] → :param
  route = route.replace(/\[([^\]]+)\]/g, ":$1");

  // Remove (group) segments — handle both leading and mid-path groups
  route = route.replace(/(^|\/)\([^)]+\)\/?/g, "$1");

  // If it's just "index" at the root → "/"
  if (route === "" || route === "index") {
    return "/";
  }

  // Ensure leading slash
  if (!route.startsWith("/")) {
    route = "/" + route;
  }

  return route;
}

/** Check if a name should be ignored (starts with _) */
function isIgnored(name: string, ignore: RegExp): boolean {
  const base = name.replace(/\.(ts|tsx|js|jsx)$/, "");
  return ignore.test(name) || ignore.test(base);
}

// ===== Module type =====

/** Shape expected from a route file module */
export interface RouteModule {
  get?: Handler | ((ctx: any) => any);
  post?: Handler | ((ctx: any) => any);
  put?: Handler | ((ctx: any) => any);
  delete?: Handler | ((ctx: any) => any);
  patch?: Handler | ((ctx: any) => any);
  head?: Handler | ((ctx: any) => any);
  options?: Handler | ((ctx: any) => any);
  all?: Handler | ((ctx: any) => any);
  default?: Record<string, Handler | ((ctx: any) => any)>;
  /** Per-method schema/options */
  schemas?: Partial<Record<RouteMethod, RouteOptions>>;
  /** Schema shared across all methods in this file */
  schema?: RouteOptions;
}

// ===== Scan =====

/**
 * Scan a directory for route files and return parsed routes.
 *
 * @param dir - Directory to scan (default: "src/routes")
 * @param options - Scan options
 * @returns Array of parsed routes
 *
 * @example
 * ```ts
 * const routes = await scanRoutes("src/routes");
 * for (const r of routes) {
 *   app.route(r.method, r.path, r.handler, r.options);
 * }
 * ```
 */
export async function scanRoutes(
  dir: string = "src/routes",
  options: FileRoutesOptions = {},
): Promise<FileRoute[]> {
  const { ignore = /^_/, verbose = false, prefix = "" } = options;
  const routes: FileRoute[] = [];

  if (!fs.existsSync(dir)) {
    if (verbose) {
      console.warn(`[Asi] Routes directory not found: ${dir}`);
    }
    return routes;
  }

  /** Collect all matching files recursively */
  const files: string[] = [];

  function collectFiles(currentDir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (!isIgnored(entry.name, ignore)) {
          collectFiles(fullPath);
        }
        continue;
      }

      // Only process supported extensions
      if (!/\.(ts|tsx|js|jsx)$/i.test(entry.name)) continue;
      if (isIgnored(entry.name, ignore)) continue;

      files.push(fullPath);
    }
  }

  collectFiles(dir);

  // Process all collected files
  for (const fullPath of files) {
    // Compute route path from file structure
    const relativePath = path.relative(dir, fullPath);

    // Parse method from suffix (e.g., users.get.ts)
    const { method: suffixMethod, baseName: cleanBaseName } =
      parseMethodSuffix(path.basename(fullPath));
    const dirName = path.dirname(fullPath);

    // Rebuild path for route conversion — replace original filename with cleaned name
    const cleanExt = path.extname(fullPath);
    const cleanFilePath =
      cleanBaseName === path.basename(fullPath).replace(/\.(ts|tsx|js|jsx)$/, "")
        ? fullPath
        : path.join(dirName, cleanBaseName + cleanExt);

    const cleanRelative = path.relative(dir, cleanFilePath);
    let routePath = filePathToRoutePath(cleanRelative);

    // Add prefix
    if (prefix) {
      const p = prefix.startsWith("/") ? prefix : "/" + prefix;
      routePath = routePath === "/" ? p : p + routePath;
    }

    // Dynamic import
    try {
      const mod: RouteModule = await import(fullPath);

      // Determine which methods this file exports
      let methods: RouteMethod[] = [];

      if (suffixMethod) {
        // Method suffix — single method
        methods = [suffixMethod];

        // Determine handler:
        // 1. Default export is a function → use it directly
        // 2. Default export is an object with method key → use that
        // 3. Named export matching the method → use it
        let handler: unknown;
        if (typeof mod.default === "function") {
          handler = mod.default;
        } else if (mod.default && typeof mod.default === "object") {
          handler = (mod.default as any)[suffixMethod.toLowerCase()];
        } else {
          handler = (mod as any)[suffixMethod.toLowerCase()];
        }

        if (!handler) {
          if (verbose) {
            console.warn(
              `[Asi] Method suffix "${suffixMethod}" in ${fullPath} but no matching handler found`,
            );
          }
          continue;
        }
        routes.push({
          method: suffixMethod,
          path: routePath,
          handler: handler as Handler,
          options: mod.schemas?.[suffixMethod] || mod.schema || undefined,
        });
      } else {
        // Check named exports for method handlers
        for (const m of SUPPORTED_METHODS) {
          const handler = (mod as any)[m];
          if (typeof handler === "function") {
            methods.push(m.toUpperCase() as RouteMethod);
          }
        }

        // Fallback: check default export object
        if (methods.length === 0 && mod.default && typeof mod.default === "object") {
          for (const m of SUPPORTED_METHODS) {
            const handler = (mod.default as any)[m];
            if (typeof handler === "function") {
              methods.push(m.toUpperCase() as RouteMethod);
            }
          }
        }

        for (const method of methods) {
          const ml = method.toLowerCase();
          const handler =
            (mod as any)[ml] ?? (mod.default as any)?.[ml];

          routes.push({
            method,
            path: routePath,
            handler: handler as Handler,
            options: mod.schemas?.[method] || mod.schema || undefined,
          });
        }
      }
    } catch (err) {
      console.error(`[Asi] Failed to load route file ${fullPath}:`, err);
    }
  }

  if (verbose) {
    for (const r of routes) {
      console.log(`  ${r.method.padEnd(6)} ${r.path}`);
    }
  }

  return routes;
}

// ===== Asi method extension (called from Asi class) =====

/**
 * Register all routes from a file-based routing directory on an Asi instance.
 *
 * @param app - The Asi instance to register routes on
 * @param options - Scan and registration options
 *
 * @example
 * ```ts
 * import { Asi, registerFileRoutes } from "asijs";
 *
 * const app = new Asi();
 * await registerFileRoutes(app);
 * app.listen(3000);
 * ```
 */
export async function registerFileRoutes(
  app: Asi,
  options: FileRoutesOptions = {},
): Promise<void> {
  const dir = options.dir ?? "src/routes";
  const routes = await scanRoutes(dir, options);

  for (const r of routes) {
    app.route(r.method, r.path, r.handler, r.options);
  }
}
