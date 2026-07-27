/**
 * @asijs/remix — Remix adapter for AsiJS
 *
 * Allows running an AsiJS application as Remix loaders, actions, and resource routes.
 *
 * @example
 * ```ts
 * // app/routes/api.$.tsx (catch-all resource route)
 * import { Asi } from "asijs";
 * import { createRemixHandler } from "@asijs/remix";
 *
 * const app = new Asi();
 * app.get("/api/hello", () => ({ message: "Hello from AsiJS!" }));
 *
 * export const { loader, action } = createRemixHandler(app, {
 *   basePath: "/api",
 * });
 * ```
 *
 * @example
 * ```ts
 * // app/routes/api.hello.ts (single endpoint)
 * import { Asi } from "asijs";
 * import { createLoader, createAction } from "@asijs/remix";
 *
 * const app = new Asi();
 * app.get("/api/hello", () => "Hello!");
 *
 * export const loader = createLoader(app);
 * ```
 */

import type { Asi } from "asijs";

// ============================================================================
// Types
// ============================================================================

export interface RemixAdapterOptions {
  /** Base path prefix to strip */
  basePath?: string;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Custom error handler */
  onError?: (error: Error) => Response;
}

// ============================================================================
// Remix Loader & Action Types
// ============================================================================

type LoaderFunctionArgs = {
  request: Request;
  params: Record<string, string | undefined>;
  context: Record<string, unknown>;
};

type ActionFunctionArgs = {
  request: Request;
  params: Record<string, string | undefined>;
  context: Record<string, unknown>;
};

type LoaderFunction = (args: LoaderFunctionArgs) => Promise<Response>;
type ActionFunction = (args: ActionFunctionArgs) => Promise<Response>;

// ============================================================================
// Handlers
// ============================================================================

/**
 * Create a combined Remix loader and action handler for catch-all resource routes.
 *
 * Use in `app/routes/api.$.tsx` or similar catch-all routes.
 *
 * @example
 * ```ts
 * // app/routes/api.$.tsx
 * import { Asi } from "asijs";
 * import { createRemixHandler } from "@asijs/remix";
 *
 * const app = new Asi();
 * app.get("/api/hello", () => "Hello!");
 *
 * export const { loader, action } = createRemixHandler(app);
 * ```
 */
export function createRemixHandler(
  app: Asi,
  options: RemixAdapterOptions = {},
): {
  loader: LoaderFunction;
  action: ActionFunction;
} {
  const { basePath = "", verbose = false } = options;

  const handler = async (request: Request): Promise<Response> => {
    try {
      let req = request;
      if (basePath) {
        const url = new URL(request.url);
        const path = url.pathname;
        if (path.startsWith(basePath)) {
          url.pathname = path.slice(basePath.length) || "/";
          req = new Request(url.toString(), request);
        }
      }

      if (verbose) {
        console.log(`[@asijs/remix] ${req.method} ${new URL(req.url).pathname}`);
      }

      return await app.handle(req);
    } catch (error) {
      if (verbose) console.error(`[@asijs/remix] Error:`, error);

      if (options.onError) {
        return options.onError(error instanceof Error ? error : new Error(String(error)));
      }

      return new Response(
        JSON.stringify({ error: "Internal Server Error" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  };

  return {
    loader: async ({ request }: LoaderFunctionArgs) => handler(request),
    action: async ({ request }: ActionFunctionArgs) => handler(request),
  };
}

/**
 * Create a Remix loader function backed by AsiJS.
 *
 * @example
 * ```ts
 * // app/routes/users.tsx
 * import { Asi } from "asijs";
 * import { createLoader } from "@asijs/remix";
 *
 * const app = new Asi();
 * app.get("/api/users", () => [{ id: 1, name: "Alice" }]);
 *
 * export const loader = createLoader(app);
 * ```
 */
export function createLoader(
  app: Asi,
  options: RemixAdapterOptions = {},
): LoaderFunction {
  const { createRemixHandler } = require("./index");
  const { loader } = createRemixHandler(app, options);
  return loader;
}

/**
 * Create a Remix action function backed by AsiJS.
 *
 * @example
 * ```ts
 * // app/routes/users.tsx
 * import { Asi } from "asijs";
 * import { createAction } from "@asijs/remix";
 *
 * const app = new Asi();
 * app.post("/api/users", async (ctx) => {
 *   const body = await ctx.json();
 *   return { success: true, user: body };
 * });
 *
 * export const action = createAction(app);
 * ```
 */
export function createAction(
  app: Asi,
  options: RemixAdapterOptions = {},
): ActionFunction {
  const { createRemixHandler } = require("./index");
  const { action } = createRemixHandler(app, options);
  return action;
}

/**
 * Create a Remix session-based authentication handler.
 *
 * Combines session cookie management with AsiJS route handling.
 *
 * @example
 * ```ts
 * // app/routes/auth.login.ts
 * import { Asi } from "asijs";
 * import { createSessionHandler } from "@asijs/remix";
 *
 * const app = new Asi();
 * app.post("/auth/login", async (ctx) => {
 *   return { token: "session-token" };
 * });
 *
 * export const action = createSessionHandler(app, {
 *   sessionKey: "token",
 * });
 * ```
 */
export function createSessionHandler(
  app: Asi,
  options: RemixAdapterOptions & {
    sessionKey?: string;
    getSession?: (request: Request) => Promise<Record<string, any>>;
    commitSession?: (session: Record<string, any>) => Promise<string>;
    destroySession?: (request: Request) => Promise<string>;
  } = {},
): { loader: LoaderFunction; action: ActionFunction } {
  const { createRemixHandler } = require("./index");
  const { loader, action } = createRemixHandler(app, options);
  const sessionKey = options.sessionKey || "session";

  return {
    loader: async (args: LoaderFunctionArgs) => {
      if (options.getSession) {
        const session = await options.getSession(args.request);
        (args.request as any)._remixSession = session;
      }
      return loader(args);
    },
    action: async (args: ActionFunctionArgs) => {
      if (options.getSession) {
        const session = await options.getSession(args.request);
        (args.request as any)._remixSession = session;
      }

      const response = await action(args);

      if (options.commitSession) {
        const session = (args.request as any)._remixSession;
        if (session) {
          const cookie = await options.commitSession(session);
          response.headers.set("Set-Cookie", cookie);
        }
      }

      return response;
    },
  };
}
