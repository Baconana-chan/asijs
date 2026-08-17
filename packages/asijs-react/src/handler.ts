/**
 * The RSC request pipeline.
 *
 * `createRSCHandler` returns a plain `(request) => Promise<Response>`
 * handler implementing three routes:
 *
 * - `htmlPath` (default `/`) — full HTML document: streaming SSR of the
 *   server component tree inside `<div id="__asijs_rsc_root">`, plus the
 *   client bootstrap script for hydration.
 * - `rscPath` (default `/__rsc`) — pure Flight payload stream
 *   (`text/x-component`) for client-side navigation.
 * - `clientPath` (default `/__rsc/client.js`) — the client bootstrap module.
 *
 * The same `RSC: 1` header that the bootstrap sends makes `htmlPath` answer
 * with Flight instead of HTML (standard RSC negotiation).
 */
import type {
  ClientManifest,
  RscOptions,
  RscRenderer,
  RscRuntime,
} from "./types";
import { CLIENT_BOOTSTRAP_SOURCE, loadRuntime } from "./runtime";

const ROOT_ID = "__asijs_rsc_root";
const FLIGHT_CONTENT_TYPE = "text/x-component; charset=utf-8";

/** Build the default renderer on top of the lazy react bindings. */
export function createDefaultRenderer(runtime?: RscRuntime): RscRenderer {
  const rt = runtime ?? loadRuntime();
  return {
    async flight(root, manifest) {
      const stream = await rt.renderToFlight(root, manifest);
      return asByteStream(stream);
    },
    async html(root) {
      const stream = await rt.renderToHtml(root);
      return asByteStream(stream);
    },
  };
}

/** Normalize a renderer output into a byte ReadableStream. */
function asByteStream(stream: ReadableStream<Uint8Array> | ReadableStream<unknown>): ReadableStream<Uint8Array> {
  // react-dom and react-server-dom-webpack both yield Uint8Array chunks.
  return stream as ReadableStream<Uint8Array>;
}

/**
 * Chain prefix bytes → a web stream → suffix bytes into one stream.
 *
 * Push-based (`start()` drives the inner stream): the async-`pull` variant
 * deadlocks with Bun's `Response.text()`/`arrayBuffer()` when the inner
 * read is awaited, while the push model works with every consumer.
 */
function chainStreams(
  prefix: Uint8Array,
  stream: ReadableStream<Uint8Array>,
  suffix: Uint8Array,
): ReadableStream<Uint8Array> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(prefix);
      reader = stream.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
      } catch (error) {
        controller.error(error);
        return;
      } finally {
        reader.releaseLock();
      }
      controller.enqueue(suffix);
      controller.close();
    },
    cancel() {
      reader?.cancel().catch(() => {});
    },
  });
}

/** Resolve the root element for a request (root may be a render function). */
function resolveRoot(root: RscOptions["root"]): unknown {
  return typeof root === "function" ? (root as () => unknown)() : root;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Compose the HTML shell document around the SSR stream. */
function renderShell(
  renderer: RscRenderer,
  options: RscHandlerOptions,
): Promise<ReadableStream<Uint8Array>> {
  const htmlPath = options.htmlPath ?? "/";
  const rscPath = options.rscPath ?? "/__rsc";
  const clientPath = options.clientPath ?? "/__rsc/client.js";
  const root = resolveRoot(options.root);

  const headParts: string[] = [
    '<meta charset="utf-8"/>',
    '<meta name="viewport" content="width=device-width, initial-scale=1"/>',
    options.head ?? "",
    ...(options.styles ?? []).map(
      (href) => `<link rel="stylesheet" href="${escapeHtml(href)}"/>`,
    ),
  ];
  const scriptTags = [
    ...(options.scripts ?? []).map(
      (src) => `<script src="${escapeHtml(src)}" defer></script>`,
    ),
  ];
  const config = `<script>window.__ASIJS_RSC__=${JSON.stringify({
    url: rscPath,
    htmlPath,
  })}</script>`;

  const prefix =
    `<!doctype html><html><head>` +
    headParts.join("") +
    `<title>${escapeHtml(options.title ?? "AsiJS + React")}</title>` +
    `</head><body><div id="${ROOT_ID}">`;
  const suffix =
    `</div>` +
    scriptTags.join("") +
    `<script type="module" src="${escapeHtml(clientPath)}" crossorigin></script>` +
    config +
    `</body></html>`;

  return renderer.html(root).then((stream) =>
    chainStreams(new TextEncoder().encode(prefix), stream, new TextEncoder().encode(suffix)),
  );
}

/** Options accepted by `createRSCHandler` (title lives here). */
export interface RscHandlerOptions extends RscOptions {
  /** Document title for the HTML shell. */
  title?: string;
}

/**
 * Create the RSC request handler. Returns a plain fetch-style handler that
 * AsiJS (or any server) can call with a standard `Request`.
 *
 * @example
 * ```ts
 * import { createRSCHandler } from "asijs-react";
 *
 * const handler = createRSCHandler({
 *   root: <App/>,
 *   client: clientManifest,
 *   title: "My App",
 * });
 *
 * // in an AsiJS app:
 * app.get("/", (ctx) => handler(ctx.request));
 * app.get("/__rsc", (ctx) => handler(ctx.request));
 * ```
 */
export function createRSCHandler(options: RscHandlerOptions): (request: Request) => Promise<Response> {
  const htmlPath = options.htmlPath ?? "/";
  const rscPath = options.rscPath ?? "/__rsc";
  const clientPath = options.clientPath ?? "/__rsc/client.js";
  const clientSource = options.clientSource ?? CLIENT_BOOTSTRAP_SOURCE;
  const rscHeader = options.rscHeader !== false;

  let renderer: RscRenderer;
  try {
    renderer = options.renderer ?? createDefaultRenderer(options.runtime);
  } catch (error) {
    // Missing react at construction time — every request answers with the
    // descriptive error so the failure is visible in dev, not silent.
    const message = error instanceof Error ? error.message : String(error);
    return async () =>
      new Response(JSON.stringify({ error: "asijs-react: " + message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
  }

  return async (request: Request): Promise<Response> => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      url = new URL("http://localhost/");
    }
    const path = url.pathname;
    const method = request.method.toUpperCase();

    if (options.verbose) {
      console.log(`[asijs-react] ${method} ${path}`);
    }

    try {
      // 1. Client bootstrap module
      if (method === "GET" && path === clientPath) {
        return new Response(clientSource, {
          headers: { "Content-Type": "application/javascript; charset=utf-8" },
        });
      }

      const wantsRsc =
        method === "GET" &&
        (path === rscPath || (rscHeader && path === htmlPath && request.headers.get("RSC") === "1"));

      // 2. Flight payload
      if (wantsRsc) {
        const root = resolveRoot(options.root);
        const stream = await renderer.flight(root, options.client ?? {});
        return new Response(stream, {
          headers: {
            "Content-Type": FLIGHT_CONTENT_TYPE,
            "Cache-Control": "no-cache",
            "X-RSC": "1",
          },
        });
      }

      // 3. HTML shell (streaming SSR)
      if (method === "GET" && path === htmlPath) {
        const shell = await renderShell(renderer, options);
        return new Response(shell, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            ...(options.headers ?? {}),
          },
        });
      }

      return new Response("Not Found", { status: 404 });
    } catch (error) {
      if (options.onError) {
        return options.onError(error instanceof Error ? error : new Error(String(error)));
      }
      const message = error instanceof Error ? error.message : String(error);
      return new Response(JSON.stringify({ error: "RSC render error", message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };
}

export { FLIGHT_CONTENT_TYPE, ROOT_ID };

export type { ClientManifest };
