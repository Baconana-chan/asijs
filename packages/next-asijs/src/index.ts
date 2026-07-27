/**
 * @asijs/next — Next.js API Route adapter for AsiJS
 *
 * Allows running an AsiJS application as Next.js API routes.
 * Supports App Router (route.ts) and Pages Router (pages/api/*.ts).
 *
 * @example
 * ```ts
 * // app/api/[[...asi]]/route.ts (App Router)
 * import { Asi } from "asijs";
 * import { createNextHandler } from "@asijs/next";
 *
 * const app = new Asi();
 * app.get("/api/hello", () => ({ message: "Hello from AsiJS!" }));
 *
 * export const { GET, POST, PUT, DELETE, PATCH } = createNextHandler(app, {
 *   basePath: "/api",
 * });
 * ```
 *
 * @example
 * ```ts
 * // pages/api/[[...asi]].ts (Pages Router)
 * import { Asi } from "asijs";
 * import { createPagesHandler } from "@asijs/next";
 *
 * const app = new Asi();
 * app.get("/api/hello", () => ({ message: "Hello from AsiJS!" }));
 *
 * export default createPagesHandler(app, { basePath: "/api" });
 * ```
 */

import type { Asi } from "asijs";

// ============================================================================
// Types
// ============================================================================

export interface NextAdapterOptions {
  /** Base path prefix to strip from incoming requests */
  basePath?: string;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Custom error handler */
  onError?: (error: Error) => Response;
}

// ============================================================================
// App Router Handler (route.ts)
// ============================================================================

type NextRequest = Request & {
  nextUrl?: { pathname?: string; searchParams?: URLSearchParams };
  cookies?: Map<string, string>;
  geo?: { city?: string; country?: string; region?: string };
  ip?: string;
};

type NextResponse = Response;

/**
 * Create Next.js App Router handlers for AsiJS.
 *
 * Use in `app/api/[[...asi]]/route.ts` to catch-all route all methods.
 *
 * @example
 * ```ts
 * // app/api/[[...asi]]/route.ts
 * import { Asi } from "asijs";
 * import { createNextHandler } from "@asijs/next";
 *
 * const app = new Asi();
 * app.get("/api/hello", () => "Hello!");
 *
 * export const { GET, POST, PUT, DELETE, PATCH } = createNextHandler(app);
 * ```
 */
export function createNextHandler(
  app: Asi,
  options: NextAdapterOptions = {},
): {
  GET: (req: NextRequest) => Promise<NextResponse>;
  POST: (req: NextRequest) => Promise<NextResponse>;
  PUT: (req: NextRequest) => Promise<NextResponse>;
  DELETE: (req: NextRequest) => Promise<NextResponse>;
  PATCH: (req: NextRequest) => Promise<NextResponse>;
  HEAD: (req: NextRequest) => Promise<NextResponse>;
  OPTIONS: (req: NextRequest) => Promise<NextResponse>;
} {
  const handler = createHandler(app, options);

  return {
    GET: (req) => handler(req),
    POST: (req) => handler(req),
    PUT: (req) => handler(req),
    DELETE: (req) => handler(req),
    PATCH: (req) => handler(req),
    HEAD: (req) => handler(req),
    OPTIONS: (req) => handler(req),
  };
}

// ============================================================================
// Pages Router Handler (pages/api/*.ts)
// ============================================================================

type NextApiRequest = {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: any;
  query?: Record<string, string | string[]>;
  cookies?: Partial<Record<string, string>>;
};

type NextApiResponse = {
  status: (code: number) => NextApiResponse;
  json: (data: any) => void;
  send: (data: any) => void;
  setHeader: (name: string, value: string) => NextApiResponse;
  end: (data?: any) => void;
  redirect: (url: string) => void;
};

/**
 * Create a Next.js Pages Router handler for AsiJS.
 *
 * Use in `pages/api/[[...asi]].ts` to catch-all route all methods.
 *
 * @example
 * ```ts
 * // pages/api/[[...asi]].ts
 * import { Asi } from "asijs";
 * import { createPagesHandler } from "@asijs/next";
 *
 * const app = new Asi();
 * app.get("/api/hello", () => "Hello!");
 *
 * export default createPagesHandler(app);
 * ```
 */
export function createPagesHandler(
  app: Asi,
  options: NextAdapterOptions = {},
): (req: NextApiRequest, res: NextApiResponse) => Promise<void> {
  const handler = createHandler(app, options);

  return async (req: NextApiRequest, res: NextApiResponse) => {
    try {
      // Convert NextApiRequest to standard Request
      const url = req.url || "http://localhost/";
      const method = req.method || "GET";
      const headers = new Headers();

      for (const [key, value] of Object.entries(req.headers)) {
        if (value !== undefined) {
          if (Array.isArray(value)) {
            for (const v of value) headers.append(key, v);
          } else {
            headers.set(key, value);
          }
        }
      }

      // Handle body
      let body: BodyInit | undefined;
      if (req.body && method !== "GET" && method !== "HEAD") {
        body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      }

      const request = new Request(url, { method, headers, body });
      const response = await handler(request);

      // Convert Response to NextApiResponse
      res.status(response.status);

      response.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });

      const responseBody = await response.text();
      if (responseBody) {
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          res.json(JSON.parse(responseBody));
        } else {
          res.send(responseBody);
        }
      } else {
        res.end();
      }
    } catch (error) {
      if (options.onError) {
        const errResponse = options.onError(error instanceof Error ? error : new Error(String(error)));
        res.status(errResponse.status);
        errResponse.headers.forEach((v, k) => res.setHeader(k, v));
        const body = await errResponse.text();
        res.send(body || "");
      } else {
        console.error("[@asijs/next] Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    }
  };
}

// ============================================================================
// Shared handler
// ============================================================================

function createHandler(app: Asi, options: NextAdapterOptions = {}) {
  const { basePath = "", verbose = false } = options;

  return async (request: Request): Promise<Response> => {
    try {
      // Strip basePath if configured
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
        console.log(`[@asijs/next] ${req.method} ${new URL(req.url).pathname}`);
      }

      // Handle via AsiJS
      return await app.handle(req);
    } catch (error) {
      if (verbose) {
        console.error(`[@asijs/next] Error:`, error);
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
