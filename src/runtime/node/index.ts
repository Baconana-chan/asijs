/**
 * Node.js runtime adapter for AsiJS
 *
 * Provides a Node.js HTTP server adapter that allows AsiJS
 * applications to run on Node.js 18+ (with global fetch API).
 *
 * @example
 * ```ts
 * import { Asi } from "asijs";
 * import { nodeAdapter } from "asijs/node";
 *
 * const app = new Asi({
 *   serverAdapter: nodeAdapter(),
 * });
 *
 * app.get("/", () => "Hello from Node.js!");
 * app.listen(3000);
 * ```
 */

export { nodeAdapter, ensureHttp, isHttpReady } from "./server";
export type { ServerAdapter, ServerAdapterConfig, ServerHandle } from "../types";
