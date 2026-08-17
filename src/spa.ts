/**
 * SPA + SSR + Hybrid Rendering for AsiJS
 *
 * Provides:
 * - `spa: true` mode — serves client bundle, injects hydration scripts
 * - SSR + hydration — server renders JSX, client hydrates
 * - Islands architecture — partial hydration per component
 * - `asi build` — production build pipeline (client + server bundles)
 */

import type { Middleware } from "./types";
import type { Context } from "./context";
import { existsSync, mkdirSync, readdirSync, copyFileSync } from "fs";
import { join } from "path";
import { renderToString, escapeHtml } from "./jsx";
import type { JSXElement } from "./jsx";

// ============================================================================
// Types
// ============================================================================

/** Options for the SPA plugin (static root, fallback, asset caching). */
export interface SPAOptions {
  /** Client entry point (relative to project root) */
  clientEntry?: string;
  /** Output directory for builds */
  outDir?: string;
  /** Base path for client assets in production */
  publicPath?: string;
  /** Enable development HMR */
  hmr?: boolean;
  /** HMR WebSocket port (default: same as app port) */
  hmrPort?: number;
  /** Island components (name → module path) */
  islands?: Record<string, string>;
}

/** A hydration island (client component mounted by id). */
export interface IslandDefinition {
  /** Component name/identifier */
  name: string;
  /** Module path for the island component */
  modulePath: string;
  /** Props serialized as JSON */
  props: Record<string, unknown>;
  /** Unique client-side ID */
  id: string;
}

/** Result of the SPA/SSG build (pages, assets, timings). */
export interface BuildResult {
  /** Output directory */
  outDir: string;
  /** Client bundle path */
  clientBundle: string;
  /** Server bundle path */
  serverBundle: string;
  /** Island bundles (name → path) */
  islandBundles: Record<string, string>;
  /** Build duration in ms */
  durationMs: number;
}

// ============================================================================
// Serialization
// ============================================================================

/**
 * Serialize props for client-side hydration.
 * Injects a <script> tag with JSON data.
 */
export function serializeProps(
  props: Record<string, unknown>,
  id: string = "__ASIJS_PROPS__",
): string {
  var json = JSON.stringify(props)
    .replace(/</g, "\u003c")
    .replace(/>/g, "\u003e")
    .replace(/&/g, "\u0026");
  return (
    '<script id="' +
    id +
    '" type="application/json">' +
    json +
    "</script>"
  );
}

/**
 * Create an island placeholder HTML.
 * On the client, this element is found by id and hydrated.
 */
export function createIslandHTML(
  island: IslandDefinition,
  serverContent: string,
): string {
  var attrs =
    'data-island="' +
    escapeHtml(island.name) +
    '" data-island-id="' +
    escapeHtml(island.id) +
    '" data-module="' +
    escapeHtml(island.modulePath) +
    '"';
  return (
    '<div ' +
    attrs +
    ">" +
    serverContent +
    '<script type="application/json" data-island-props="' +
    escapeHtml(island.id) +
    '">' +
    JSON.stringify(island.props)
      .replace(/</g, "\u003c")
      .replace(/>/g, "\u003e") +
    "</script></div>"
  );
}

/**
 * Build the HTML page wrapper with SPA/SSR support.
 * Injects: serialized props, client script, island scripts, HMR client.
 */
export function buildSSRPage(options: {
  body: string;
  title?: string;
  headTags?: string;
  props?: Record<string, unknown>;
  clientScript?: string;
  islands?: IslandDefinition[];
  enableHMR?: boolean;
  hmrPort?: number;
  publicPath?: string;
}): string {
  var lines: string[] = [];
  lines.push("<!DOCTYPE html>");
  lines.push('<html lang="en">');
  lines.push("<head>");
  lines.push('<meta charset="UTF-8" />');
  lines.push(
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
  );
  if (options.title) {
    lines.push("<title>" + escapeHtml(options.title) + "</title>");
  }
  if (options.headTags) {
    lines.push(options.headTags);
  }
  lines.push("</head>");
  lines.push("<body>");

  // SSR body content
  if (options.props) {
    lines.push(
      '<div id="app">' + options.body + "</div>",
    );
    lines.push(serializeProps(options.props));
  } else {
    lines.push(
      '<div id="app">' + options.body + "</div>",
    );
  }

  // Client-side script
  if (options.clientScript) {
    var pp = options.publicPath || "/_asi/client";
    lines.push(
      '<script type="module" src="' +
        pp +
        "/" +
        options.clientScript +
        '"></script>',
    );
  }

  // HMR client
  if (options.enableHMR) {
    var hmrPort = options.hmrPort || 3000;
    lines.push(
      '<script>' +
        'new WebSocket("ws://localhost:' +
        hmrPort +
        '/__asi_hmr").onmessage=function(e){' +
        'if(e.data==="reload")location.reload();' +
        "};" +
        "</script>",
    );
  }

  lines.push("</body>");
  lines.push("</html>");
  return lines.join("\n");
}

// ============================================================================
// SPA Middleware / Plugin
// ============================================================================

/**
 * Create the SPA middleware.
 *
 * In SPA mode, all non-API routes serve the SPA's index.html.
 * The middleware also injects HMR script in dev mode.
 */
export function spaMiddleware(
  options: SPAOptions & {
    isDev?: boolean;
    clientBundleName?: string;
  } = {},
): Middleware {
  var isDev = options.isDev ?? true;

  return async function(ctx: Context, next: () => Promise<Response>) {
    var response = await next();

    // Only intercept HTML responses
    var contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      return response;
    }

    // Read the body as text
    var body = await response.text();

    // Inject HMR client if in dev mode
    if (isDev && options.hmr) {
      var hmrPort = options.hmrPort || 3000;
      var hmrScript =
        '<script>new WebSocket("ws://localhost:' +
        hmrPort +
        '/__asi_hmr").onmessage=function(e){if(e.data==="reload")location.reload()};</script>';
      body = body.replace("</body>", hmrScript + "</body>");
    }

    return new Response(body, {
      status: response.status,
      headers: response.headers,
    });
  };
}

/**
 * Create the SPA fallback handler.
 * This serves index.html for any unmatched route in SPA mode.
 * On the client, the router handles the actual route.
 */
export function spaFallbackHandler(
  options: {
    publicPath?: string;
    clientBundleName?: string;
  } = {},
): () => Response {
  var pp = options.publicPath || "/_asi/client";
  var bundleName = options.clientBundleName || "client.js";

  return function() {
    var html = buildSSRPage({
      body: '<div id="app"></div>',
      title: "AsiJS App",
      clientScript: bundleName,
      publicPath: pp,
    });

    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  };
}

// ============================================================================
// Build Pipeline
// ============================================================================

/**
 * Run the production build: client bundle + server bundle + island chunks.
 *
 * Uses `bun build` under the hood.
 * Returns build results with paths and stats.
 */
export async function buildProject(
  options: {
    clientEntry?: string;
    serverEntry?: string;
    outDir?: string;
    islands?: Record<string, string>;
    minify?: boolean;
    silent?: boolean;
  } = {},
): Promise<BuildResult> {
  var clientEntry = options.clientEntry || "src/client.tsx";
  var serverEntry = options.serverEntry || "src/index.ts";
  var outDir = options.outDir || "dist";
  var minify = options.minify ?? true;

  var clientOutDir = outDir + "/client";
  var serverOutDir = outDir + "/server";
  var islandBundles: Record<string, string> = {};

  var startTime = performance.now();

  // Ensure we're running in Bun
  if (typeof Bun === "undefined") {
    throw new Error(
      "AsiJS build requires Bun. Please run `asi build` with Bun.",
    );
  }

  // 1. Build server bundle
  var serverArgs = [
    "build",
    serverEntry,
    "--outdir",
    serverOutDir,
    "--target",
    "bun",
    "--external",
    "@sinclair/typebox",
    "--splitting",
  ];
  if (minify) serverArgs.push("--minify");

  if (!options.silent) {
    console.log("  [AsiJS] Building server bundle...");
  }

  var serverResult = Bun.spawnSync(["bun"].concat(serverArgs as any), {
    env: { ...process.env, NODE_ENV: "production" },
  });

  if (!serverResult.success) {
    throw new Error(
      "Server build failed:\n" + serverResult.stderr.toString(),
    );
  }

  // 2. Build client bundle
  var clientArgs = [
    "build",
    clientEntry,
    "--outdir",
    clientOutDir,
    "--target",
    "browser",
  ];
  if (minify) clientArgs.push("--minify");

  if (!options.silent) {
    console.log("  [AsiJS] Building client bundle...");
  }

  var clientResult = Bun.spawnSync(["bun"].concat(clientArgs as any), {
    env: { ...process.env, NODE_ENV: "production" },
  });

  if (!clientResult.success) {
    throw new Error(
      "Client build failed:\n" + clientResult.stderr.toString(),
    );
  }

  // 3. Build island bundles (if any)
  var islandNames = Object.keys(options.islands || {});
  if (islandNames.length > 0) {
    if (!options.silent) {
      console.log("  [AsiJS] Building island chunks (" + islandNames.length + ")...");
    }

    for (var i = 0; i < islandNames.length; i++) {
      var islandName = islandNames[i];
      var islandEntry = (options.islands || {})[islandName];

      var islandArgs = [
        "build",
        islandEntry,
        "--outdir",
        clientOutDir + "/islands",
        "--target",
        "browser",
        "--splitting",
      ];
      if (minify) islandArgs.push("--minify");

      var islandResult = Bun.spawnSync(["bun"].concat(islandArgs as any), {
        env: { ...process.env, NODE_ENV: "production" },
      });

      if (islandResult.success) {
        islandBundles[islandName] = "islands/" + islandName + ".js";
      } else {
        console.warn(
          "  [AsiJS] Warning: Island '" +
            islandName +
            "' build failed:\n" +
            islandResult.stderr.toString(),
        );
      }
    }
  }

  // 4. Copy public/ static assets to output directory
  var publicDir = "public";
  var publicOutDir = outDir + "/public";
  if (existsSync(publicDir)) {
    if (!options.silent) {
      console.log("  [AsiJS] Copying static assets from public/...");
    }
    copyDirSync(publicDir, publicOutDir);
  }

  var durationMs = Math.round(performance.now() - startTime);

  if (!options.silent) {
    console.log(
      "  [AsiJS] Build complete in " + durationMs + "ms",
    );
    console.log(
      "  [AsiJS]   Server: " + serverOutDir,
    );
    console.log(
      "  [AsiJS]   Client: " + clientOutDir,
    );
    if (islandNames.length > 0) {
      console.log(
        "  [AsiJS]   Islands: " + islandNames.length,
      );
    }
  }

  return {
    outDir: outDir,
    clientBundle: clientOutDir + "/client.js",
    serverBundle: serverOutDir + "/index.js",
    islandBundles: islandBundles,
    durationMs: durationMs,
  };
}

// ============================================================================
// Island Component Wrapper
// ============================================================================

/**
 * Create an island component.
 *
 * An island is a component that hydrates independently on the client.
 * During SSR, it renders its server content inside a container div.
 * On the client, the framework finds the container and hydrates only that component.
 *
 * @example
 * ```tsx
 * // counter.tsx
 * export default createIsland(async (props: { initial: number }) => {
 *   return <div>{props.initial}</div>;
 * }, "Counter");
 * ```
 */
export function createIsland(
  renderFn: (props: Record<string, unknown>) => JSXElement | Promise<JSXElement>,
  name: string,
): (props: Record<string, unknown>) => Promise<string> {
  return async function islandRenderer(
    props: Record<string, unknown>,
  ): Promise<string> {
    var element = await renderFn(props);
    var html = await renderToString(element);
    var id = "island-" + name + "-" + Math.random().toString(36).slice(2, 9);

    return createIslandHTML(
      { name, modulePath: "./islands/" + name, props, id },
      html,
    );
  };
}

/**
 * Create a client-side island with hydration.
 *
 * This is a compile-time marker. During `asi build`,
 * the build pipeline extracts island components into separate chunks.
 */
export function island(
  name: string,
  modulePath: string,
): { name: string; modulePath: string } {
  return { name, modulePath };
}

// ============================================================================
// Helpers
// ============================================================================

/** Recursively copy a directory */
function copyDirSync(src: string, dest: string): void {
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }
  var entries = readdirSync(src, { withFileTypes: true });
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var srcPath = join(src, entry.name);
    var destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}
