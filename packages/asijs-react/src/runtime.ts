/**
 * Lazy react bindings + the embedded client bootstrap.
 *
 * `react`, `react-dom` and `react-server-dom-webpack` are optional peers:
 * nothing is imported at module load. `loadRuntime()` resolves them at call
 * time and throws a descriptive error (with an install hint) when missing.
 */
import type { ClientManifest, RscRuntime } from "./types";

const INSTALL_HINT =
  "asijs-react needs React 19+ installed. Run: bun add react react-dom react-server-dom-webpack";

/** Resolve the react bindings, throwing a descriptive error when missing. */
export function loadRuntime(): RscRuntime {
  let rscServer: {
    renderToReadableStream: (
      model: unknown,
      webpackMap: ClientManifest,
      options?: Record<string, unknown>,
    ) => unknown;
    registerClientReference?: (proxy: object, moduleId: string, exportName: string) => unknown;
  } | undefined;
  let reactDomServer: {
    renderToReadableStream: (root: unknown, options?: Record<string, unknown>) => unknown;
  } | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    rscServer = require("react-server-dom-webpack/server.node");
  } catch {
    rscServer = undefined;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    reactDomServer = require("react-dom/server");
  } catch {
    reactDomServer = undefined;
  }
  if (!rscServer || !reactDomServer) {
    const missing = [
      !rscServer ? "react-server-dom-webpack" : null,
      !reactDomServer ? "react-dom" : null,
    ].filter(Boolean);
    throw new Error(`${INSTALL_HINT} (missing: ${missing.join(", ")})`);
  }
  return {
    renderToFlight(root, manifest) {
      return rscServer!.renderToReadableStream(root, manifest, {}) as
        | Promise<ReadableStream<Uint8Array>>
        | ReadableStream<Uint8Array>;
    },
    renderToHtml(root) {
      return reactDomServer!.renderToReadableStream(root, {}) as
        | Promise<ReadableStream<Uint8Array>>
        | ReadableStream<Uint8Array>;
    },
    registerClientReference(proxy, moduleId, exportName) {
      if (typeof rscServer!.registerClientReference === "function") {
        return rscServer!.registerClientReference(proxy, moduleId, exportName);
      }
      return proxy;
    },
  };
}

/**
 * The client bootstrap — served at `clientPath` and bundled by
 * `buildClientBundle`. On load it:
 *
 * 1. reads the RSC config injected by the HTML shell (`window.__ASIJS_RSC__`),
 * 2. fetches the Flight payload (`RSC: 1` header),
 * 3. decodes it with `react-server-dom-webpack/client.browser`,
 * 4. hydrates the SSR'd root with `react-dom/client`.
 *
 * Bare specifiers are resolved by the host dev server or inlined by
 * `buildClientBundle` for production.
 */
export const CLIENT_BOOTSTRAP_SOURCE = `/* asijs-react client bootstrap */
(async () => {
  const rootEl = document.getElementById("__asijs_rsc_root");
  if (!rootEl) return;
  try {
    const [{ createFromFetch }, { hydrateRoot }] = await Promise.all([
      import("react-server-dom-webpack/client.browser"),
      import("react-dom/client"),
    ]);
    const cfg = window.__ASIJS_RSC__ || { url: "/__rsc" };
    const res = await fetch(cfg.url, { headers: { RSC: "1" } });
    if (!res.ok) throw new Error("RSC fetch failed: " + res.status);
    const root = await createFromFetch(res);
    hydrateRoot(rootEl, root);
  } catch (err) {
    console.error("[asijs-react] bootstrap failed:", err);
  }
})();
`;
