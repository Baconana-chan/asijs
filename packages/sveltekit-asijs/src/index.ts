/**
 * @asijs/sveltekit — SvelteKit adapter for AsiJS
 *
 * Allows running an AsiJS application as SvelteKit server hooks and API endpoints.
 *
 * @example
 * ```ts
 * // src/hooks.server.ts (global server hooks)
 * import { Asi } from "asijs";
 * import { createSvelteKitHook } from "@asijs/sveltekit";
 *
 * const app = new Asi();
 * app.get("/api/hello", () => ({ message: "Hello from AsiJS!" }));
 *
 * export const handle = createSvelteKitHook(app);
 * ```
 *
 * @example
 * ```ts
 * // src/routes/api/[...asi]/+server.ts (catch-all API route)
 * import { Asi } from "asijs";
 * import { createServerHandler } from "@asijs/sveltekit";
 *
 * const app = new Asi();
 * app.get("/api/hello", () => "Hello!");
 *
 * export const GET = createServerHandler(app, "GET");
 * export const POST = createServerHandler(app, "POST");
 * ```
 */

import type { Asi } from "asijs";

// ============================================================================
// Types
// ============================================================================

export interface SvelteKitAdapterOptions {
  /** Base path prefix for API routes */
  basePath?: string;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Custom error handler */
  onError?: (error: Error) => Response;
}

// ============================================================================
// Server Hook (handle)
// ============================================================================

type ResolveFn = (event: any) => Response | Promise<Response>;

type ServerHookEvent = {
  request: Request;
  url: URL;
  params: Record<string, string>;
  locals: Record<string, any>;
  cookies: {
    get: (key: string) => string | undefined;
    set: (key: string, value: string, options?: Record<string, any>) => void;
    delete: (key: string, options?: Record<string, any>) => void;
  };
  platform?: Record<string, any>;
  fetch: typeof fetch;
  clientAddress?: string;
};

type ServerHook = (
  event: ServerHookEvent,
  resolve: ResolveFn,
) => Response | Promise<Response>;

/**
 * Create a SvelteKit `handle` hook that routes requests through AsiJS.
 *
 * AsiJS handles API routes; everything else is passed through to SvelteKit's resolver.
 *
 * @example
 * ```ts
 * // src/hooks.server.ts
 * import { Asi } from "asijs";
 * import { createSvelteKitHook } from "@asijs/sveltekit";
 *
 * const app = new Asi();
 * app.get("/api/hello", () => "Hello from AsiJS + SvelteKit!");
 *
 * export const handle = createSvelteKitHook(app, { basePath: "/api" });
 * ```
 */
export function createSvelteKitHook(
  app: Asi,
  options: SvelteKitAdapterOptions = {},
): ServerHook {
  const { basePath = "/api", verbose = false } = options;

  return async (
    event: ServerHookEvent,
    resolve: ResolveFn,
  ): Promise<Response> => {
    try {
      const path = event.url.pathname;

      // Only handle routes matching basePath
      if (!path.startsWith(basePath)) {
        return resolve(event);
      }

      const { createRequest, toResponse } = convertSvelteKitRequest(event, basePath);

      if (verbose) {
        console.log(`[@asijs/sveltekit] ${event.request.method} ${path}`);
      }

      const response = await app.handle(createRequest());

      // If AsiJS returned 404, let SvelteKit handle it
      if (response.status === 404) {
        return resolve(event);
      }

      return response;
    } catch (error) {
      if (verbose) console.error(`[@asijs/sveltekit] Error:`, error);

      if (options.onError) {
        return options.onError(error instanceof Error ? error : new Error(String(error)));
      }

      return new Response(
        JSON.stringify({ error: "Internal Server Error" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  };
}

/**
 * Create a SvelteKit server handler for a specific HTTP method.
 *
 * Use in `src/routes/api/[...asi]/+server.ts`.
 *
 * @example
 * ```ts
 * // src/routes/api/[...asi]/+server.ts
 * import { Asi } from "asijs";
 * import { createServerHandler } from "@asijs/sveltekit";
 *
 * const app = new Asi();
 * app.get("/api/hello", () => ({ message: "Hello!" }));
 *
 * export const GET = createServerHandler(app, "GET");
 * export const POST = createServerHandler(app, "POST");
 * export const PUT = createServerHandler(app, "PUT");
 * export const DELETE = createServerHandler(app, "DELETE");
 * ```
 */
export function createServerHandler(
  app: Asi,
  method: string,
  options: SvelteKitAdapterOptions = {},
) {
  return async (event: ServerHookEvent): Promise<Response> => {
    if (event.request.method !== method.toUpperCase()) {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: method.toUpperCase() },
      });
    }

    const { createRequest } = convertSvelteKitRequest(event, options.basePath || "");

    try {
      return await app.handle(createRequest());
    } catch (error) {
      if (options.onError) {
        return options.onError(error instanceof Error ? error : new Error(String(error)));
      }
      throw error;
    }
  };
}

/**
 * Create a SvelteKit server handler that handles all HTTP methods.
 *
 * Use in `src/routes/api/[...asi]/+server.ts`.
 *
 * @example
 * ```ts
 * // src/routes/api/[...asi]/+server.ts
 * import { Asi } from "asijs";
 * import { createUniversalHandler } from "@asijs/sveltekit";
 *
 * const app = new Asi();
 * app.get("/api/hello", () => ({ message: "Hello!" }));
 *
 * export const GET = createUniversalHandler(app);
 * export const POST = createUniversalHandler(app);
 * ```
 */
export function createUniversalHandler(
  app: Asi,
  options: SvelteKitAdapterOptions = {},
) {
  return async (event: ServerHookEvent): Promise<Response> => {
    const { createRequest } = convertSvelteKitRequest(event, options.basePath || "");

    try {
      return await app.handle(createRequest());
    } catch (error) {
      if (options.onError) {
        return options.onError(error instanceof Error ? error : new Error(String(error)));
      }
      throw error;
    }
  };
}

// ============================================================================
// Helper: Convert SvelteKit request to standard Request
// ============================================================================

function convertSvelteKitRequest(
  event: ServerHookEvent,
  basePath: string,
): {
  createRequest: () => Request;
  toResponse: (response: Response) => Response;
} {
  return {
    createRequest: () => {
      // Pass original URL through — basePath is only used as a filter
      // in the hook to decide which requests to intercept
      const req = new Request(event.url.toString(), event.request) as Request & {
        _sveltekitLocals?: Record<string, any>;
        _sveltekitPlatform?: Record<string, any>;
        _clientAddress?: string;
      };

      req._sveltekitLocals = event.locals;
      req._sveltekitPlatform = event.platform;
      req._clientAddress = event.clientAddress;

      return req;
    },
    toResponse: (response: Response) => {
      // Preserve cookies from SvelteKit
      return response;
    },
  };
}
