/**
 * Shared types for asijs-react.
 *
 * Everything is structural and react is never imported at module top-level —
 * the package degrades gracefully when react / react-dom /
 * react-server-dom-webpack are not installed (they are optional peers).
 */

/**
 * A server component root: either a ready-made React element (created via
 * JSX or `createElement`) or a render function returning one. Rendered
 * lazily per request so server components can read request context.
 */
export type RscRoot =
  | unknown
  | (() => unknown);

/**
 * Client reference metadata — the shape consumed by
 * `react-server-dom-webpack`'s `renderToReadableStream(model, webpackMap)`.
 */
export interface ClientReferenceMetadata {
  /** Module id (file path / URL) of the client module. */
  id: string;
  /** Bundler chunk list (empty for unbundled references). */
  chunks: string[];
  /** Exported name. */
  name: string;
  /** Whether the export is async. */
  async: boolean;
}

/**
 * Module map: `moduleId → exportName → reference metadata`. The second
 * argument to the Flight renderer.
 */
export type ClientManifest = Record<string, Record<string, ClientReferenceMetadata>>;

/** Minimal AsiJS app shape (structural — no hard asijs import needed). */
export interface AsijsAppLike {
  handle(request: Request): Promise<Response>;
  use?(middleware: (ctx: unknown, next: () => unknown) => unknown): unknown;
  get?(path: string, handler: (ctx: unknown) => unknown): unknown;
  [key: string]: unknown;
}

/**
 * The react bindings the pipeline needs, resolved lazily at call time.
 * `renderToFlight` and `renderToHtml` return web ReadableStreams.
 */
export interface RscRuntime {
  renderToFlight(
    root: unknown,
    manifest: ClientManifest,
  ): Promise<ReadableStream<Uint8Array>> | ReadableStream<Uint8Array>;
  renderToHtml(root: unknown): Promise<ReadableStream<Uint8Array>> | ReadableStream<Uint8Array>;
  /** `react-server-dom-webpack/server.node` `registerClientReference`. */
  registerClientReference(proxy: object, moduleId: string, exportName: string): unknown;
}

/** Injectable renderer (used by tests to exercise routing without react). */
export interface RscRenderer {
  flight(root: unknown, manifest: ClientManifest): Promise<ReadableStream<Uint8Array>>;
  html(root: unknown): Promise<ReadableStream<Uint8Array>>;
}

/** Options for `createRSCHandler` / `createRscPlugin`. */
export interface RscOptions {
  /** Server component root — element or render function. */
  root: RscRoot;
  /** Client module map (see `buildClientManifest`). */
  client?: ClientManifest;
  /** HTML shell route (default `"/"`). */
  htmlPath?: string;
  /** Flight payload route (default `"/__rsc"`). */
  rscPath?: string;
  /** Client bootstrap script route (default `"/__rsc/client.js"`). */
  clientPath?: string;
  /** Honor the `RSC: 1` request header on `htmlPath` (default `true`). */
  rscHeader?: boolean;
  /** Custom client bootstrap source (default: embedded runtime). */
  clientSource?: string;
  /** Extra `<script>` URLs to inject into the HTML shell. */
  scripts?: string[];
  /** Extra `<link rel="stylesheet">` URLs to inject into the HTML shell. */
  styles?: string[];
  /** Extra `<meta>` tags (raw HTML) for the shell head. */
  head?: string;
  /** Extra response headers for the HTML shell. */
  headers?: Record<string, string>;
  /** Injected renderer (overrides the lazy react runtime). */
  renderer?: RscRenderer;
  /** Injected react bindings (overrides lazy `require`). */
  runtime?: RscRuntime;
  /** Custom error handler. */
  onError?: (error: Error) => Response;
  /** Verbose request logging. */
  verbose?: boolean;
}

/** Result of a bundle build. */
export interface RscBuildResult {
  ok: boolean;
  /** Absolute path of the produced bundle (when ok). */
  outputPath?: string;
  error?: string;
}
