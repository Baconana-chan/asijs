/**
 * @asijs/astro — Astro adapter for AsiJS
 *
 * Allows running an AsiJS application as Astro server endpoints and API routes.
 *
 * @example
 * ```ts
 * // src/pages/api/[...asi].ts (Astro pages router)
 * import { Asi } from "asijs";
 * import { createAstroHandler } from "@asijs/astro";
 *
 * const app = new Asi();
 * app.get("/api/hello", () => ({ message: "Hello from AsiJS!" }));
 *
 * export const all = createAstroHandler(app);
 * ```
 *
 * @example
 * ```ts
 * // src/pages/api/hello.ts (single endpoint)
 * import { Asi } from "asijs";
 * import { createEndpoint } from "@asijs/astro";
 *
 * const app = new Asi();
 * app.get("/api/hello", () => "Hello!");
 *
 * export const GET = createEndpoint(app, "GET");
 * ```
 */

import type { Asi } from "asijs";

// ============================================================================
// Types
// ============================================================================

export interface AstroAdapterOptions {
  /** Base path prefix */
  basePath?: string;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Custom error handler */
  onError?: (error: Error) => Response;
}

type AstroAPIContext = {
  request: Request;
  cookies: {
    get: (key: string) => { value: string } | undefined;
    set: (key: string, value: string, options?: Record<string, any>) => void;
    delete: (key: string) => void;
  };
  params: Record<string, string | undefined>;
  redirect: (path: string, status?: number) => Response;
  url: URL;
  clientAddress?: string;
  locals?: Record<string, any>;
};

type AstroEndpoint = (context: AstroAPIContext) => Promise<Response>;

// ============================================================================
// Handlers
// ============================================================================

/**
 * Create a catch-all Astro handler that routes all methods through AsiJS.
 *
 * Use in `src/pages/api/[...asi].ts` or `src/pages/[...asi].ts`.
 *
 * @example
 * ```ts
 * // src/pages/api/[...asi].ts
 * import { Asi } from "asijs";
 * import { createAstroHandler } from "@asijs/astro";
 *
 * const app = new Asi();
 * app.get("/api/hello", () => "Hello!");
 *
 * export const all = createAstroHandler(app);
 * ```
 */
export function createAstroHandler(
  app: Asi,
  options: AstroAdapterOptions = {},
): AstroEndpoint {
  const { basePath = "", verbose = false } = options;

  return async (context: AstroAPIContext): Promise<Response> => {
    try {
      let request = context.request;
      const url = new URL(request.url);

      // Strip basePath
      if (basePath && url.pathname.startsWith(basePath)) {
        url.pathname = url.pathname.slice(basePath.length) || "/";
        request = new Request(url.toString(), request);
      }

      // Attach Astro-specific context to the request for middleware access
      const enrichedReq = request as Request & {
        _astroContext?: AstroAPIContext;
      };
      enrichedReq._astroContext = context;

      if (verbose) {
        console.log(`[@asijs/astro] ${request.method} ${url.pathname}`);
      }

      const response = await app.handle(enrichedReq);

      return response;
    } catch (error) {
      if (verbose) {
        console.error(`[@asijs/astro] Error:`, error);
      }

      if (options.onError) {
        return options.onError(error instanceof Error ? error : new Error(String(error)));
      }

      return new Response(
        JSON.stringify({ error: "Internal Server Error" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  };
}

/**
 * Create a single-method Astro endpoint.
 *
 * @example
 * ```ts
 * // src/pages/api/hello.ts
 * import { Asi } from "asijs";
 * import { createEndpoint } from "@asijs/astro";
 *
 * const app = new Asi();
 * app.get("/api/hello", () => "Hello!");
 *
 * export const GET = createEndpoint(app, "GET");
 * ```
 */
export function createEndpoint(
  app: Asi,
  method: string,
  options: AstroAdapterOptions = {},
): AstroEndpoint {
  const handler = createAstroHandler(app, options);

  return async (context: AstroAPIContext): Promise<Response> => {
    if (context.request.method !== method.toUpperCase()) {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { "Allow": method.toUpperCase() },
      });
    }
    return handler(context);
  };
}

/**
 * Create a middleware function that can be used in Astro's `onRequest` hook.
 *
 * @example
 * ```ts
 * // src/middleware.ts
 * import { Asi } from "asijs";
 * import { createAstroMiddleware } from "@asijs/astro";
 *
 * const app = new Asi();
 * app.get("/api/*", (ctx) => ctx.json({ message: "Hello!" }));
 *
 * export const onRequest = createAstroMiddleware(app);
 * ```
 */
export function createAstroMiddleware(
  app: Asi,
  options: AstroAdapterOptions = {},
) {
  const handler = createAstroHandler(app, options);

  return async (
    context: AstroAPIContext,
    next: () => Promise<Response>,
  ): Promise<Response> => {
    const url = new URL(context.request.url);

    // Only handle API routes, pass through everything else
    if (!url.pathname.startsWith(options.basePath || "/api")) {
      return next();
    }

    const response = await handler(context);

    // If AsiJS handled it (non-404), return the response
    if (response.status !== 404) {
      return response;
    }

    // Otherwise, pass through
    return next();
  };
}
