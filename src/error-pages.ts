/**
 * Error pages — automatic HTML 404/500 pages for browser requests.
 *
 * Detects HTML-capable requests (Accept / Sec-Fetch-Dest), discovers custom
 * error-page files (404.tsx / error.tsx / not-found.tsx …) and falls back to
 * a built-in XSS-safe page with route suggestions and dev-mode error details.
 */

import { existsSync } from "fs";
import { join, resolve } from "path";
import { pathToFileURL } from "url";
import { html, type JSXNode } from "./jsx";

/** Status codes that can have a dedicated error page. */
export type ErrorPageKind = 404 | 500;

/** Context passed to error-page renderers (custom files and the built-in page). */
export interface ErrorPageContext {
  status: ErrorPageKind;
  path: string;
  method: string;
  request: Request;
  development: boolean;
  suggestions?: string[];
  error?: unknown;
}

/** Options for error-page discovery and rendering. */
export interface ErrorPagesOptions {
  enabled?: boolean;
  autoDiscover?: boolean;
  rootDir?: string;
  searchDirs?: string[];
  notFoundFileNames?: string[];
  errorFileNames?: string[];
}

type ErrorPageModule =
  | ((ctx: ErrorPageContext) => unknown | Promise<unknown>)
  | {
      default?: (ctx: ErrorPageContext) => unknown | Promise<unknown>;
      Page?: (ctx: ErrorPageContext) => unknown | Promise<unknown>;
      ErrorPage?: (ctx: ErrorPageContext) => unknown | Promise<unknown>;
      NotFoundPage?: (ctx: ErrorPageContext) => unknown | Promise<unknown>;
      InternalServerErrorPage?: (
        ctx: ErrorPageContext,
      ) => unknown | Promise<unknown>;
      render?: (ctx: ErrorPageContext) => unknown | Promise<unknown>;
      render404?: (ctx: ErrorPageContext) => unknown | Promise<unknown>;
      render500?: (ctx: ErrorPageContext) => unknown | Promise<unknown>;
    };

const DEFAULT_SEARCH_DIRS = [
  ".",
  "src/pages",
  "src/pages/errors",
  "src/routes",
  "src/routes/errors",
  "src/errors",
  "pages",
  "pages/errors",
  "routes",
  "routes/errors",
  "errors",
  "app",
  "app/errors",
  "src/app",
  "src/app/errors",
] as const;

const DEFAULT_NOT_FOUND_NAMES = [
  "404",
  "_404",
  "not-found",
  "notfound",
  "404.page",
] as const;

const DEFAULT_ERROR_NAMES = [
  "500",
  "_error",
  "error",
  "server-error",
  "internal-error",
  "500.page",
] as const;

const SUPPORTED_EXTENSIONS = [
  ".tsx",
  ".jsx",
  ".ts",
  ".js",
  ".mts",
  ".mjs",
] as const;

const moduleCache = new Map<string, Promise<ErrorPageModule>>();

function isJsxElementLike(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      "type" in (value as Record<string, unknown>) &&
      "props" in (value as Record<string, unknown>),
  );
}

/**
 * Whether a request should receive an HTML error page — GET/HEAD from an
 * HTML-accepting client (Accept header or Sec-Fetch-Dest: document).
 */
export function shouldRenderHtmlErrorPage(request: Request): boolean {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return false;
  }

  const accept = request.headers.get("accept")?.toLowerCase() ?? "";
  const secFetchDest = request.headers.get("sec-fetch-dest")?.toLowerCase();
  const secFetchMode = request.headers.get("sec-fetch-mode")?.toLowerCase();

  if (secFetchDest === "document" || secFetchMode === "navigate") {
    return true;
  }

  return (
    accept.includes("text/html") || accept.includes("application/xhtml+xml")
  );
}

/** Resolve the directory that error-page files are searched from (rootDir or cwd). */
export function getErrorPageSearchRoot(options?: ErrorPagesOptions): string {
  return resolve(options?.rootDir ?? process.cwd());
}

/** Find the first matching error-page file for the kind, or null when disabled/none found. */
export function discoverErrorPagePath(
  kind: ErrorPageKind,
  options?: ErrorPagesOptions,
): string | null {
  if (options?.enabled === false || options?.autoDiscover === false) {
    return null;
  }

  const rootDir = getErrorPageSearchRoot(options);
  const searchDirs = options?.searchDirs ?? [...DEFAULT_SEARCH_DIRS];
  const fileNames =
    kind === 404
      ? (options?.notFoundFileNames ?? [...DEFAULT_NOT_FOUND_NAMES])
      : (options?.errorFileNames ?? [...DEFAULT_ERROR_NAMES]);

  for (const dir of searchDirs) {
    for (const name of fileNames) {
      for (const ext of SUPPORTED_EXTENSIONS) {
        const filePath = resolve(rootDir, join(dir, `${name}${ext}`));
        if (existsSync(filePath)) {
          return filePath;
        }
      }
    }
  }

  return null;
}

async function importErrorPageModule(filePath: string): Promise<ErrorPageModule> {
  const cached = moduleCache.get(filePath);
  if (cached) {
    return cached;
  }

  const promise = import(pathToFileURL(filePath).href) as Promise<ErrorPageModule>;
  moduleCache.set(filePath, promise);
  return promise;
}

function resolveErrorPageRenderer(
  mod: ErrorPageModule,
  kind: ErrorPageKind,
): ((ctx: ErrorPageContext) => unknown | Promise<unknown>) | null {
  if (typeof mod === "function") {
    return mod;
  }

  if (kind === 404) {
    return (
      mod.render404 ??
      mod.NotFoundPage ??
      mod.render ??
      mod.ErrorPage ??
      mod.Page ??
      mod.default ??
      null
    );
  }

  return (
    mod.render500 ??
    mod.InternalServerErrorPage ??
    mod.render ??
    mod.ErrorPage ??
    mod.Page ??
    mod.default ??
    null
  );
}

function toHtmlResponse(body: string, status: number): Response {
  const document = body.startsWith("<!DOCTYPE html>") ? body : `<!DOCTYPE html>${body}`;
  return new Response(document, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

async function renderModuleResult(
  result: unknown,
  status: ErrorPageKind,
): Promise<Response> {
  if (result instanceof Response) {
    return result;
  }

  if (
    typeof result === "string" ||
    typeof result === "number" ||
    Array.isArray(result) ||
    isJsxElementLike(result)
  ) {
    if (typeof result === "string") {
      return toHtmlResponse(result, status);
    }

    return html(result as JSXNode, status);
  }

  return toHtmlResponse(
    `<html><body><pre>${String(result ?? "")}</pre></body></html>`,
    status,
  );
}

/** Import + render a discovered error-page module into a Response, or null. */
export async function renderDiscoveredErrorPage(
  kind: ErrorPageKind,
  ctx: ErrorPageContext,
  options?: ErrorPagesOptions,
): Promise<Response | null> {
  const filePath = discoverErrorPagePath(kind, options);
  if (!filePath) {
    return null;
  }

  const mod = await importErrorPageModule(filePath);
  const renderer = resolveErrorPageRenderer(mod, kind);
  if (!renderer) {
    return null;
  }

  const result = await renderer(ctx);
  return renderModuleResult(result, kind);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Render the built-in XSS-safe HTML error page (with suggestions and dev error details). */
export function renderDefaultErrorPage(ctx: ErrorPageContext): Response {
  const title =
    ctx.status === 404 ? "Page not found" : "Something went wrong";
  const subtitle =
    ctx.status === 404
      ? "AsiJS could not find a matching route for this request."
      : "AsiJS caught an unhandled error while processing this request.";

  const details =
    ctx.status === 404
      ? `<div class="meta"><span>${escapeHtml(ctx.method)}</span><span>${escapeHtml(ctx.path)}</span></div>`
      : `<div class="meta"><span>${escapeHtml(ctx.method)}</span><span>${escapeHtml(ctx.path)}</span></div>`;

  const suggestions =
    ctx.status === 404 && ctx.suggestions && ctx.suggestions.length > 0
      ? `<div class="panel"><h2>Possible matches</h2><ul>${ctx.suggestions.map((item) => `<li><code>${escapeHtml(item)}</code></li>`).join("")}</ul></div>`
      : "";

  const devError =
    ctx.status === 500 && ctx.development && ctx.error instanceof Error
      ? `<div class="panel"><h2>Error</h2><pre>${escapeHtml(ctx.error.message)}${ctx.error.stack ? `\n\n${escapeHtml(ctx.error.stack)}` : ""}</pre></div>`
      : "";

  return toHtmlResponse(
    `<html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${ctx.status} ${escapeHtml(title)}</title>
        <style>
          :root {
            color-scheme: dark;
            --bg: #07111f;
            --surface: rgba(15, 26, 44, 0.88);
            --border: rgba(157, 181, 219, 0.2);
            --text: #edf3ff;
            --text-2: #b7c3d9;
            --accent: #7c9cff;
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            padding: 24px;
            font-family: Inter, Segoe UI, sans-serif;
            background:
              radial-gradient(circle at top, rgba(124, 156, 255, 0.18), transparent 28%),
              linear-gradient(180deg, #081120 0%, #050b15 100%);
            color: var(--text);
          }
          .shell {
            width: min(760px, 100%);
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 24px;
            padding: 32px;
            box-shadow: 0 24px 80px rgba(0, 0, 0, 0.42);
          }
          .badge {
            display: inline-flex;
            padding: 8px 12px;
            border-radius: 999px;
            background: rgba(124, 156, 255, 0.12);
            border: 1px solid var(--border);
            color: var(--accent);
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }
          h1 {
            margin: 18px 0 10px;
            font-size: clamp(2rem, 6vw, 3.6rem);
            line-height: 1;
            letter-spacing: -0.05em;
          }
          p {
            margin: 0 0 20px;
            color: var(--text-2);
            line-height: 1.7;
          }
          .meta {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-bottom: 18px;
          }
          .meta span, code {
            font-family: "JetBrains Mono", monospace;
            font-size: 0.86rem;
          }
          .meta span {
            display: inline-flex;
            padding: 10px 12px;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid var(--border);
          }
          .panel {
            margin-top: 18px;
            padding: 18px;
            border-radius: 18px;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid var(--border);
          }
          .panel h2 {
            margin: 0 0 12px;
            font-size: 1rem;
          }
          ul {
            margin: 0;
            padding-left: 18px;
          }
          li + li {
            margin-top: 8px;
          }
          pre {
            margin: 0;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
            color: var(--text-2);
          }
        </style>
      </head>
      <body>
        <main class="shell">
          <span class="badge">AsiJS Error Page</span>
          <h1>${ctx.status}</h1>
          <p><strong>${escapeHtml(title)}</strong><br />${escapeHtml(subtitle)}</p>
          ${details}
          ${suggestions}
          ${devError}
        </main>
      </body>
    </html>`,
    ctx.status,
  );
}
