/**
 * AsiJS plugin: mount the RSC pipeline on an AsiJS app.
 *
 * Registers `htmlPath`, `rscPath` and `clientPath` as GET routes. Each route
 * handler forwards `ctx.request` to the RSC handler and returns the resulting
 * `Response` — AsiJS supports returning `Response` objects from handlers
 * natively, so headers/status/streaming bodies pass through untouched.
 */
import type { RscHandlerOptions } from "./handler";
import { createRSCHandler } from "./handler";

/** Minimal AsiJS plugin host shape. */
export interface PluginHostLike {
  get(path: string, handler: (ctx: { request: Request }) => unknown): unknown;
}

/** The plugin object shape AsiJS `app.plugin()` expects. */
export interface RscPlugin {
  name: string;
  config: Record<string, unknown>;
  apply(app: PluginHostLike): Promise<void> | void;
}

export interface RscPluginOptions extends RscHandlerOptions {
  /** Plugin name (default `"asijs-react"`). */
  name?: string;
}

/**
 * Create an AsiJS plugin that mounts the RSC pipeline.
 *
 * @example
 * ```ts
 * import { Asi } from "asijs";
 * import { createRscPlugin } from "asijs-react";
 *
 * const app = new Asi();
 * app.plugin(createRscPlugin({ root: <App/>, title: "My App" }));
 * app.listen(3000);
 * ```
 */
export function createRscPlugin(options: RscPluginOptions): RscPlugin {
  const handler = createRSCHandler(options);
  const htmlPath = options.htmlPath ?? "/";
  const rscPath = options.rscPath ?? "/__rsc";
  const clientPath = options.clientPath ?? "/__rsc/client.js";

  const route = (path: string) => (ctx: { request: Request }) => handler(ctx.request);

  return {
    name: options.name ?? "asijs-react",
    config: {},
    apply(app) {
      app.get(htmlPath, route(htmlPath));
      app.get(rscPath, route(rscPath));
      app.get(clientPath, route(clientPath));
    },
  };
}
