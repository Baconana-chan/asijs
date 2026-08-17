/**
 * asijs-vite — Vite 8 / Rolldown dev server for AsiJS
 *
 * Runs an AsiJS backend **inside** a Vite dev server: one port serves both
 * the Vite frontend (HMR, transforms) and the AsiJS API routes. AsiJS
 * handles requests that match the API prefix; everything else falls through
 * to Vite.
 *
 * - `createVitePlugin(app)` — Vite plugin: AsiJS API middleware + HMR bridge
 * - `createViteHandler(app)` — plain `(request) => Response` (middleware mode)
 * - `createHmrBridge()` — forward AsiJS HMR events to Vite's WebSocket
 * - `ssrBuild()` — Rolldown SSR bundle (lazy, falls back to Bun.build)
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from "vite";
 * import { Asi } from "asijs";
 * import { createVitePlugin } from "asijs-vite";
 *
 * const app = new Asi();
 * app.get("/api/hello", () => ({ message: "Hello from AsiJS!" }));
 *
 * export default defineConfig({
 *   plugins: [createVitePlugin(app, { apiPrefix: "/api", hmrBridge: true })],
 * });
 * ```
 */

// ============================================================================
// Types
// ============================================================================

/** Minimal AsiJS app shape (structural — no hard asijs import needed). */
export interface AsijsAppLike {
  handle(request: Request): Promise<Response>;
  [key: string]: unknown;
}


/** Options for the Vite plugin / handler / middleware. */
export interface AsijsViteOptions {
  /**
   * Path prefix(es) handled by AsiJS (default `"/api"`). Requests whose
   * pathname starts with a prefix go to AsiJS; everything else falls
   * through to Vite. Use `["/api", "/__dev"]` to also expose AsiJS dev
   * routes (dashboard, OpenAPI, playground) through Vite.
   */
  apiPrefix?: string | string[];
  /**
   * Strip the prefix before handing the request to AsiJS (default `false`).
   * When `true`, a request to `/api/users` reaches AsiJS as `/users`.
   */
  stripPrefix?: boolean;
  /** Enable verbose request logging. */
  verbose?: boolean;
  /** Forward AsiJS hot-reload events to Vite's WebSocket. */
  hmrBridge?: boolean;
  /** Directories to watch for backend changes when hmrBridge is on (default ["src"]). */
  watchDirs?: string[];
  /** Custom error handler (default: 500 JSON). */
  onError?: (error: Error) => Response;
}

/** Node-style middleware signature used by Vite (Connect). */
export type ViteMiddleware = (
  req: NodeIncomingMessage,
  res: NodeServerResponse,
  next: (err?: unknown) => void,
) => void;

// Minimal structural types — avoids a hard dependency on @types/node/vite.
interface NodeIncomingMessage {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  on?: (event: string, cb: (...args: unknown[]) => void) => unknown;
  [key: string]: unknown;
}
interface NodeServerResponse {
  statusCode: number;
  setHeader(name: string, value: string | number | string[]): unknown;
  getHeader(name: string): unknown;
  end(chunk?: unknown): unknown;
  writeHead?(status: number, headers?: Record<string, string | number | string[]>): unknown;
  [key: string]: unknown;
}

/** Minimal Vite dev server shape used by the HMR bridge. */
export interface ViteDevServerLike {
  ws?: {
    send(payload: unknown): void;
  };
  config?: { server?: { hmr?: boolean | object } };
}

// ============================================================================
// Helpers
// ============================================================================

function normalizePrefixes(prefix?: string | string[]): string[] {
  const raw = prefix ?? "/api";
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((p) => (p.startsWith("/") ? p : `/${p}`));
}

/** Extract the pathname from a Node req.url (path or absolute URL). */
function pathnameOf(raw: string): string {
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    try {
      return new URL(raw).pathname;
    } catch {
      // fall through
    }
  }
  return raw.split("?")[0];
}

function matchesPrefix(raw: string, prefixes: string[]): boolean {
  const pathname = pathnameOf(raw);
  return prefixes.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`));
}

/** Read the request body as raw bytes (Node stream or pre-parsed). */
async function readBody(req: NodeIncomingMessage): Promise<Uint8Array | undefined> {
  // Bun / connect already buffered it
  if (req.body instanceof Uint8Array) return req.body;
  if (req.body !== undefined && req.body !== null) {
    return new TextEncoder().encode(String(req.body));
  }
  const on = req.on;
  if (typeof on !== "function") return undefined;
  return new Promise<Uint8Array | undefined>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (chunks.length === 0) resolve(undefined);
      else resolve(new Uint8Array(Buffer.concat(chunks)));
    };
    on.call(req, "data", (chunk: unknown) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    });
    on.call(req, "end", finish);
    // Some bodies are pre-buffered and never emit — resolve after a tick
    // with whatever arrived (empty means no body).
    setTimeout(finish, 0);
    // Keep the promise from hanging forever on an unread stream
    // (the caller awaits; Vite calls next() if we already responded).
    on.call(req, "error", reject);
  });
}

/** Convert a standard Response back into a Node-style response. */
async function writeResponse(
  res: NodeServerResponse,
  response: Response,
): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  const body = await response.arrayBuffer();
  if (body.byteLength > 0) {
    res.end(new Uint8Array(body));
  } else {
    res.end();
  }
}

function toRequest(
  req: NodeIncomingMessage,
  body: Uint8Array | undefined,
  options: Required<Pick<AsijsViteOptions, "stripPrefix">>,
): Request | null {
  const raw = req.url ?? "/";
  const method = (req.method ?? "GET").toUpperCase();
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }
  let pathname = pathnameOf(raw);
  if (options.stripPrefix) {
    for (const prefix of normalizePrefixes()) {
      if (pathname === prefix) {
        pathname = "/";
        break;
      }
      if (pathname.startsWith(`${prefix}/`)) {
        pathname = pathname.slice(prefix.length);
        break;
      }
    }
  }
  const suffix = raw.includes("?") ? raw.slice(raw.indexOf("?")) : "";
  const target = `http://localhost${pathname}${suffix}`;
  const init: RequestInit = {
    method,
    headers,
    body: ["GET", "HEAD"].includes(method) ? undefined : (body as BodyInit),
  };
  return new Request(target, init);
}

// ============================================================================
// Handler
// ============================================================================

/**
 * Create a plain request handler for an AsiJS app — the adapter core used
 * by both the middleware and the plugin. Returns a `Response` for every
 * request; callers (Vite middleware, framework handlers) map it back.
 */
export function createViteHandler(
  app: AsijsAppLike,
  options: AsijsViteOptions = {},
): (request: Request) => Promise<Response> {
  const { verbose = false, onError } = options;
  return async (request: Request): Promise<Response> => {
    try {
      if (verbose) {
        const url = new URL(request.url);
        console.log(`[asijs-vite] ${request.method} ${url.pathname}`);
      }
      return await app.handle(request);
    } catch (error) {
      if (verbose) {
        console.error(`[asijs-vite] Error:`, error);
      }
      if (onError) {
        return onError(error instanceof Error ? error : new Error(String(error)));
      }
      return new Response(
        JSON.stringify({ error: "Internal Server Error" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  };
}

// ============================================================================
// Connect-style middleware (used by the Vite plugin)
// ============================================================================

/**
 * Create a Connect-style middleware that routes API requests to AsiJS and
 * lets everything else fall through to Vite. Use it with
 * `server.middlewares.use(createViteMiddleware(app))` when you want to wire
 * the middleware manually instead of using `createVitePlugin`.
 */
export function createViteMiddleware(
  app: AsijsAppLike,
  options: AsijsViteOptions = {},
): ViteMiddleware {
  const prefixes = normalizePrefixes(options.apiPrefix);
  const handler = createViteHandler(app, options);
  const stripPrefix = options.stripPrefix ?? false;

  return (req, res, next) => {
    if (!matchesPrefix(req.url ?? "/", prefixes)) {
      next();
      return;
    }
    void (async () => {
      let body: Uint8Array | undefined;
      try {
        body = await readBody(req);
      } catch {
        body = undefined;
      }
      // If a previous middleware already ended the response, bail out
      if ((res as { writableEnded?: boolean }).writableEnded) return;
      const request = toRequest(req, body, { stripPrefix });
      if (!request) {
        next();
        return;
      }
      const response = await handler(request);
      if ((res as { writableEnded?: boolean }).writableEnded) return;
      await writeResponse(res, response);
    })().catch((error) => {
      if (options.verbose) console.error("[asijs-vite] middleware error:", error);
      next(error);
    });
  };
}

// ============================================================================
// Vite plugin
// ============================================================================

/**
 * Create a Vite plugin that runs AsiJS inside the Vite dev server.
 *
 * One port serves both: requests under `apiPrefix` are handled by AsiJS,
 * everything else (HTML, modules, assets) by Vite with its HMR.
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { Asi } from "asijs";
 * import { createVitePlugin } from "asijs-vite";
 *
 * const app = new Asi();
 * app.get("/api/hello", () => ({ message: "Hello!" }));
 *
 * export default defineConfig({ plugins: [createVitePlugin(app)] });
 * ```
 */
export function createVitePlugin(app: AsijsAppLike, options: AsijsViteOptions = {}) {
  const middleware = createViteMiddleware(app, options);

  return {
    name: "asijs-vite",
    enforce: "pre" as const,
    configureServer(server: ViteDevServerLike & {
      middlewares: { use(fn: ViteMiddleware): void };
      ws?: { send(payload: unknown): void };
    }) {
      server.middlewares.use(middleware);

      // Forward AsiJS hot-reload events to Vite's WebSocket so the browser
      // reloads when backend handlers/routes change.
      if (options.hmrBridge) {
        attachHmrBridge(server, app, options);
      }

      return () => {
        // Post-hook: make sure AsiJS stays first (after vite-internal stuff).
      };
    },
    configurePreviewServer(server: ViteDevServerLike & {
      middlewares: { use(fn: ViteMiddleware): void };
    }) {
      server.middlewares.use(middleware);
    },
  };
}

// ============================================================================
// HMR bridge
// ============================================================================

/**
 * Attach an HMR bridge: watch the AsiJS app's source dir with AsiJS's own
 * HotReloader and forward full-reload/component/style events to Vite's
 * WebSocket. Uses AsiJS's `HotReloader` when available; the reload handler
 * sends Vite-protocol payloads so the browser reacts without a manual
 * refresh.
 */
/** Minimal HotReloader constructor shape (avoids a hard asijs import). */
type HotReloaderLike = new (options: {
  rootDir: string;
  watchDirs: string[];
  verbose: boolean;
  onReload: (event: { needsFullReload?: boolean; changes?: { category?: string }[] }) => void;
}) => { start(): void; stop(): void };

/**
 * Attach an HMR bridge: watch the AsiJS app's source dir and forward
 * full-reload events to Vite's WebSocket so the browser reloads when
 * backend handlers/routes change. Uses AsiJS's `HotReloader`; pass the
 * class via `options.hotReloader` or import it from "asijs" — the bridge
 * falls back to a no-op (with a warning) when neither is available.
 */
export function attachHmrBridge(
  server: ViteDevServerLike,
  app: AsijsAppLike,
  options: AsijsViteOptions & { hotReloader?: HotReloaderLike } = {},
): () => void {
  let HotReloader: HotReloaderLike | undefined = options.hotReloader;
  if (!HotReloader) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require("asijs") as { HotReloader?: HotReloaderLike };
      HotReloader = mod.HotReloader;
    } catch {
      HotReloader = undefined;
    }
  }
  if (!HotReloader || !server.ws?.send) {
    if (options.verbose) {
      console.warn("[asijs-vite] HMR bridge skipped (HotReloader or Vite ws unavailable)");
    }
    return () => {};
  }

  const rootDir = process.cwd();
  const reloader = new HotReloader({
    rootDir,
    watchDirs: options.watchDirs ?? ["src"],
    verbose: options.verbose ?? false,
    onReload: (event) => {
      const ws = server.ws;
      if (!ws) return;
      if (event.needsFullReload) {
        ws.send({ type: "full-reload", path: "*" });
        return;
      }
      const files = (event.changes ?? []).map((c) => c.category).filter(Boolean);
      if (files.length > 0) {
        ws.send({ type: "full-reload", path: "*" });
      }
    },
  });
  reloader.start();

  return () => {
    try {
      reloader.stop();
    } catch {
      // already stopped
    }
  };
}

// ============================================================================
// Rolldown SSR build
// ============================================================================

/** Options for `ssrBuild`. */
export interface SsrBuildOptions {
  /** Entry file (SSR server bundle, e.g. "src/ssr.tsx"). */
  entry: string;
  /** Output directory (default "dist-ssr"). */
  outDir?: string;
  /** Output file name (default "index.js"). */
  outFile?: string;
  /** External packages to leave as imports (default ["asijs", "vite"]). */
  external?: string[];
  /** Force Bun.build even when Rolldown is installed. */
  forceBun?: boolean;
  /** Minify output (Rolldown: boolean | "esbuild" — Bun: boolean). */
  minify?: boolean;
}

/** Result of `ssrBuild`. */
export interface SsrBuildResult {
  ok: boolean;
  /** Which engine actually built: "rolldown" | "bun". */
  engine: "rolldown" | "bun";
  /** Path of the produced bundle (when ok). */
  outputPath?: string;
  error?: string;
}

/**
 * Build an AsiJS SSR bundle with Rolldown (Vite 8's bundler) when it is
 * installed; otherwise falls back to `Bun.build`. Rolldown is loaded lazily
 * so the package works without it.
 *
 * @example
 * ```ts
 * const res = await ssrBuild({ entry: "src/ssr.tsx", outDir: "dist-ssr" });
 * if (res.ok) console.log("SSR bundle at", res.outputPath);
 * ```
 */
export async function ssrBuild(options: SsrBuildOptions): Promise<SsrBuildResult> {
  const outDir = options.outDir ?? "dist-ssr";
  const outFile = options.outFile ?? "index.js";
  const external = options.external ?? ["asijs", "vite"];

  // 1. Rolldown (preferred — Vite 8 uses it by default)
  if (!options.forceBun) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require("rolldown") as {
        rolldown?: (opts: Record<string, unknown>) => Promise<{
          write: (opts: Record<string, unknown>) => Promise<unknown>;
        }>;
        default?: { rolldown?: typeof mod.rolldown };
      };
      const rolldown = mod.rolldown ?? mod.default?.rolldown;
      if (typeof rolldown === "function") {
        const bundle = await rolldown({
          input: options.entry,
          platform: "node",
          external,
        });
        await bundle.write({
          dir: outDir,
          entryFileNames: outFile,
          format: "esm",
          sourcemap: false,
          minify: options.minify ?? false,
        });
        return {
          ok: true,
          engine: "rolldown",
          outputPath: `${outDir}/${outFile}`,
        };
      }
    } catch (e) {
      // rolldown not installed or failed — fall through to Bun
      if (options.forceBun === false && process.env.ASIJS_VITE_VERBOSE) {
        console.warn("[asijs-vite] Rolldown unavailable, falling back to Bun.build:", (e as Error).message);
      }
    }
  }

  // 2. Bun.build fallback
  try {
    const res = await Bun.build({
      entrypoints: [options.entry],
      outdir: outDir,
      naming: outFile,
      target: "bun",
      external,
      minify: options.minify ?? false,
    });
    if (!res.success) {
      return { ok: false, engine: "bun", error: res.logs.map(String).join("\n") };
    }
    return { ok: true, engine: "bun", outputPath: `${outDir}/${outFile}` };
  } catch (e) {
    return {
      ok: false,
      engine: "bun",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
