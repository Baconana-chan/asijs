/**
 * asijs-react — React Server Components for AsiJS
 *
 * A complete RSC pipeline on top of React 19:
 *
 * - `createRSCHandler` — request handler: HTML shell (streaming SSR) +
 *   Flight payload (`text/x-component`) + client bootstrap module
 * - `createRscPlugin` — AsiJS plugin mounting all three routes
 * - server/client boundaries via `"use client"`:
 *   `isClientModule`, `scanExports`, `buildClientManifest`, `moduleRef`
 * - `buildClientBundle` / `buildServerBundle` — production bundles via Bun.build
 * - lazy react bindings (`loadRuntime`) — optional peers, descriptive errors
 *   when react / react-dom / react-server-dom-webpack are missing
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

export { createRSCHandler, createDefaultRenderer, FLIGHT_CONTENT_TYPE, ROOT_ID } from "./handler";
export type { RscHandlerOptions } from "./handler";

export { createRscPlugin } from "./plugin";
export type { RscPlugin, RscPluginOptions, PluginHostLike } from "./plugin";

export { loadRuntime, CLIENT_BOOTSTRAP_SOURCE } from "./runtime";

export {
  isClientModule,
  scanExports,
  buildClientManifest,
  moduleRef,
} from "./client";
export type { ClientModuleEntry } from "./client";

export { buildClientBundle, buildServerBundle } from "./bundle";
export type { ClientBundleOptions, ServerBundleOptions } from "./bundle";

export type {
  RscOptions,
  RscRoot,
  RscRuntime,
  RscRenderer,
  ClientManifest,
  ClientReferenceMetadata,
  RscBuildResult,
  AsijsAppLike,
} from "./types";
