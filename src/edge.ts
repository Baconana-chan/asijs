/**
 * Edge / Serverless Adapter for AsiJS
 *
 * Exports fetch-compatible handlers for:
 * - Cloudflare Workers
 * - Vercel Edge Functions
 * - Deno Deploy
 * - AWS Lambda@Edge
 * - Netlify Edge Functions
 * - Bun.serve() (default)
 *
 * All runtimes use the standard Fetch API
 */

// Edge adapters work with any Asi-like app that has a handle/fetch method
type AsiApp = {
  handle?: (request: Request) => Promise<Response>;
  fetch?: (request: Request) => Promise<Response>;
  _compiledHandler?: (request: Request) => Promise<Response>;
};

// ============================================================================
// Types
// ============================================================================

/**
 * Standard fetch handler signature (Web Fetch API)
 */
export type FetchHandler = (
  request: Request,
  env?: unknown,
  ctx?: ExecutionContext,
) => Response | Promise<Response>;

/**
 * Cloudflare Workers execution context
 */
export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

/**
 * Cloudflare Workers environment bindings
 */
export interface CloudflareEnv {
  [key: string]: unknown;
}

/**
 * Vercel Edge config
 */
export interface VercelEdgeConfig {
  runtime: "edge";
  regions?: string[];
}

/**
 * Deno Deploy handler
 */
export type DenoHandler = (request: Request) => Response | Promise<Response>;

/**
 * AWS Lambda@Edge event
 */
export interface LambdaEdgeEvent {
  Records: Array<{
    cf: {
      request: {
        uri: string;
        method: string;
        headers: Record<string, Array<{ key: string; value: string }>>;
        body?: {
          data: string;
          encoding: "base64" | "text";
        };
        querystring: string;
      };
    };
  }>;
}

/**
 * AWS Lambda@Edge response
 */
export interface LambdaEdgeResponse {
  status: string;
  statusDescription: string;
  headers: Record<string, Array<{ key: string; value: string }>>;
  body?: string;
  bodyEncoding?: "base64" | "text";
}

/**
 * Adapter options
 */
export interface AdapterOptions {
  /** Base path prefix */
  basePath?: string;
  /** Trust proxy headers */
  trustProxy?: boolean;
  /** Custom error handler */
  onError?: (error: Error) => Response;
  /** Before request hook */
  beforeRequest?: (request: Request) => Request | Promise<Request>;
  /** After response hook */
  afterResponse?: (response: Response) => Response | Promise<Response>;
}

// ============================================================================
// Core Fetch Handler
// ============================================================================

/**
 * Convert AsiJS app to a standard fetch handler
 *
 * @example
 * ```ts
 * import { Asi } from 'asijs';
 * import { toFetchHandler } from 'asijs/edge';
 *
 * const app = new Asi();
 * app.get('/', () => 'Hello from the Edge!');
 *
 * export default toFetchHandler(app);
 * ```
 */
export function toFetchHandler(
  app: AsiApp,
  options: AdapterOptions = {},
): FetchHandler {
  const {
    basePath = "",
    trustProxy = true,
    onError,
    beforeRequest,
    afterResponse,
  } = options;

  const handler = getAppHandler(app);

  return async (request: Request, env?: unknown, ctx?: ExecutionContext) => {
    try {
      // Apply before hook
      let req = request;
      if (beforeRequest) {
        req = await beforeRequest(request);
      }

      // Handle base path stripping
      if (basePath) {
        const path = getPathname(req.url);
        if (path.startsWith(basePath)) {
          const url = new URL(req.url);
          url.pathname = path.slice(basePath.length) || "/";
          req = new Request(url.toString(), req);
        }
      }

      // Store env and ctx in request for access in handlers
      (
        req as Request & { env?: unknown; executionContext?: ExecutionContext }
      ).env = env;
      (
        req as Request & { env?: unknown; executionContext?: ExecutionContext }
      ).executionContext = ctx;

      const response = await handler(req);

      // Apply after hook
      if (afterResponse) {
        return await afterResponse(response);
      }

      return response;
    } catch (error) {
      if (onError) {
        return onError(
          error instanceof Error ? error : new Error(String(error)),
        );
      }

      console.error("Edge handler error:", error);
      return new Response(
        JSON.stringify({
          error: "Internal Server Error",
          message: error instanceof Error ? error.message : "Unknown error",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  };
}

/**
 * Get the fetch handler from an Asi app
 */
function getAppHandler(app: AsiApp): (request: Request) => Promise<Response> {
  // Try to get the compiled handler
  if (
    (
      app as unknown as {
        _compiledHandler?: (req: Request) => Promise<Response>;
      }
    )._compiledHandler
  ) {
    return (
      app as unknown as {
        _compiledHandler: (req: Request) => Promise<Response>;
      }
    )._compiledHandler;
  }

  // Fallback to fetch method if available
  if (
    typeof (app as unknown as { fetch?: (req: Request) => Promise<Response> })
      .fetch === "function"
  ) {
    return (
      app as unknown as { fetch: (req: Request) => Promise<Response> }
    ).fetch.bind(app);
  }

  // Manual handler creation
  return async (request: Request) => {
    const response = await (
      app as unknown as { handle: (req: Request) => Promise<Response> }
    ).handle(request);
    return response;
  };
}

// ============================================================================
// Platform-Specific Adapters
// ============================================================================

/**
 * Cloudflare Workers adapter
 *
 * @example
 * ```ts
 * // worker.ts
 * import { Asi } from 'asijs';
 * import { cloudflare } from 'asijs/edge';
 *
 * const app = new Asi();
 * app.get('/', (ctx) => {
 *   const env = ctx.env as { MY_KV: KVNamespace };
 *   return 'Hello from Cloudflare!';
 * });
 *
 * export default cloudflare(app);
 * ```
 */
export function cloudflare(
  app: AsiApp,
  options: AdapterOptions = {},
): {
  fetch: FetchHandler;
} {
  const handler = toFetchHandler(app, { trustProxy: true, ...options });

  return {
    fetch: handler,
  };
}

/**
 * Vercel Edge adapter
 *
 * @example
 * ```ts
 * // api/edge.ts
 * import { Asi } from 'asijs';
 * import { vercelEdge } from 'asijs/edge';
 *
 * const app = new Asi();
 * app.get('/api/*', () => 'Hello from Vercel Edge!');
 *
 * export const { GET, POST, PUT, DELETE, PATCH } = vercelEdge(app);
 * export const config = { runtime: 'edge' };
 * ```
 */
export function vercelEdge(
  app: AsiApp,
  options: AdapterOptions = {},
): {
  GET: FetchHandler;
  POST: FetchHandler;
  PUT: FetchHandler;
  DELETE: FetchHandler;
  PATCH: FetchHandler;
  HEAD: FetchHandler;
  OPTIONS: FetchHandler;
} {
  const handler = toFetchHandler(app, { trustProxy: true, ...options });

  return {
    GET: handler,
    POST: handler,
    PUT: handler,
    DELETE: handler,
    PATCH: handler,
    HEAD: handler,
    OPTIONS: handler,
  };
}

/**
 * Deno Deploy adapter
 *
 * @example
 * ```ts
 * // main.ts
 * import { Asi } from 'asijs';
 * import { deno } from 'asijs/edge';
 *
 * const app = new Asi();
 * app.get('/', () => 'Hello from Deno Deploy!');
 *
 * Deno.serve(deno(app));
 * ```
 */
export function deno(app: AsiApp, options: AdapterOptions = {}): DenoHandler {
  const handler = toFetchHandler(app, options);
  return (request: Request) => handler(request);
}

/**
 * AWS Lambda@Edge adapter
 *
 * @example
 * ```ts
 * // handler.ts
 * import { Asi } from 'asijs';
 * import { lambdaEdge } from 'asijs/edge';
 *
 * const app = new Asi();
 * app.get('/*', () => 'Hello from Lambda@Edge!');
 *
 * export const handler = lambdaEdge(app);
 * ```
 */
export function lambdaEdge(
  app: AsiApp,
  options: AdapterOptions = {},
): (event: LambdaEdgeEvent) => Promise<LambdaEdgeResponse> {
  const handler = toFetchHandler(app, options);

  return async (event: LambdaEdgeEvent) => {
    const cfRequest = event.Records[0].cf.request;

    // Convert Lambda@Edge request to Fetch Request
    const headers = new Headers();
    for (const [key, values] of Object.entries(cfRequest.headers)) {
      for (const { value } of values) {
        headers.append(key, value);
      }
    }

    const host = headers.get("host") || "localhost";
    const url = `https://${host}${cfRequest.uri}${cfRequest.querystring ? "?" + cfRequest.querystring : ""}`;

    let body: BodyInit | undefined;
    if (cfRequest.body) {
      body =
        cfRequest.body.encoding === "base64"
          ? Uint8Array.from(atob(cfRequest.body.data), (c) => c.charCodeAt(0))
          : cfRequest.body.data;
    }

    const request = new Request(url, {
      method: cfRequest.method,
      headers,
      body:
        cfRequest.method !== "GET" && cfRequest.method !== "HEAD"
          ? body
          : undefined,
    });

    // Handle request
    const response = await handler(request);

    // Convert Fetch Response to Lambda@Edge response
    const responseHeaders: Record<
      string,
      Array<{ key: string; value: string }>
    > = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key.toLowerCase()] = [{ key, value }];
    });

    let responseBody: string | undefined;
    let bodyEncoding: "base64" | "text" | undefined;

    if (response.body) {
      const arrayBuffer = await response.arrayBuffer();
      const contentType = response.headers.get("content-type") || "";

      // Binary content should be base64 encoded
      if (
        contentType.includes("image/") ||
        contentType.includes("application/octet-stream") ||
        contentType.includes("font/")
      ) {
        responseBody = btoa(
          String.fromCharCode(...new Uint8Array(arrayBuffer)),
        );
        bodyEncoding = "base64";
      } else {
        responseBody = new TextDecoder().decode(arrayBuffer);
        bodyEncoding = "text";
      }
    }

    return {
      status: response.status.toString(),
      statusDescription: response.statusText || getStatusText(response.status),
      headers: responseHeaders,
      body: responseBody,
      bodyEncoding,
    };
  };
}

/**
 * Netlify Edge Functions adapter
 *
 * @example
 * ```ts
 * // netlify/edge-functions/api.ts
 * import { Asi } from 'asijs';
 * import { netlifyEdge } from 'asijs/edge';
 *
 * const app = new Asi();
 * app.get('/api/*', () => 'Hello from Netlify Edge!');
 *
 * export default netlifyEdge(app);
 * export const config = { path: '/api/*' };
 * ```
 */
export function netlifyEdge(
  app: AsiApp,
  options: AdapterOptions = {},
): (
  request: Request,
  context: { geo: { city?: string; country?: { code?: string } } },
) => Promise<Response> {
  const handler = toFetchHandler(app, options);

  return async (request: Request, context) => {
    // Add geo info to request
    const headers = new Headers(request.headers);
    if (context.geo?.city) {
      headers.set("x-netlify-city", context.geo.city);
    }
    if (context.geo?.country?.code) {
      headers.set("x-netlify-country", context.geo.country.code);
    }

    const enrichedRequest = new Request(request.url, {
      method: request.method,
      headers,
      body: request.body,
    });

    return handler(enrichedRequest);
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a static asset handler for edge environments
 */
export function createStaticHandler(
  assets: Map<string, { content: Uint8Array; contentType: string }>,
  options: {
    cacheControl?: string;
    notFoundResponse?: Response;
  } = {},
): FetchHandler {
  const { cacheControl = "public, max-age=31536000, immutable" } = options;

  return async (request: Request) => {
    const path = getPathname(request.url);

    const asset = assets.get(path);
    if (!asset) {
      return (
        options.notFoundResponse ?? new Response("Not Found", { status: 404 })
      );
    }

    return new Response(asset.content, {
      headers: {
        "Content-Type": asset.contentType,
        "Cache-Control": cacheControl,
      },
    });
  };
}

/**
 * Combine multiple handlers with routing
 */
export function combineHandlers(
  routes: Array<{ pattern: string | RegExp; handler: FetchHandler }>,
): FetchHandler {
  return async (request: Request, env?: unknown, ctx?: ExecutionContext) => {
    const path = getPathname(request.url);

    for (const route of routes) {
      if (typeof route.pattern === "string") {
        if (path.startsWith(route.pattern)) {
          return route.handler(request, env, ctx);
        }
      } else {
        if (route.pattern.test(path)) {
          return route.handler(request, env, ctx);
        }
      }
    }

    return new Response("Not Found", { status: 404 });
  };
}

function getPathname(url: string): string {
  const qIdx = url.indexOf("?");
  const end = qIdx === -1 ? url.length : qIdx;
  const startIdx = url.indexOf("/", url.indexOf("//") + 2);
  return startIdx === -1 ? "/" : url.slice(startIdx, end);
}

/**
 * Add CORS headers for edge functions
 */
export function withCORS(
  handler: FetchHandler,
  options: {
    origin?: string | string[] | ((origin: string) => boolean);
    methods?: string[];
    headers?: string[];
    credentials?: boolean;
    maxAge?: number;
  } = {},
): FetchHandler {
  const {
    origin = "*",
    methods = ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    headers = ["Content-Type", "Authorization"],
    credentials = false,
    maxAge = 86400,
  } = options;

  return async (request: Request, env?: unknown, ctx?: ExecutionContext) => {
    const requestOrigin = request.headers.get("origin") || "";

    // Determine allowed origin
    let allowedOrigin = "*";
    if (typeof origin === "string") {
      allowedOrigin = origin;
    } else if (Array.isArray(origin)) {
      if (origin.includes(requestOrigin)) {
        allowedOrigin = requestOrigin;
      }
    } else if (typeof origin === "function") {
      if (origin(requestOrigin)) {
        allowedOrigin = requestOrigin;
      }
    }

    // Handle preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": allowedOrigin,
          "Access-Control-Allow-Methods": methods.join(", "),
          "Access-Control-Allow-Headers": headers.join(", "),
          "Access-Control-Max-Age": maxAge.toString(),
          ...(credentials && { "Access-Control-Allow-Credentials": "true" }),
        },
      });
    }

    // Handle actual request
    const response = await handler(request, env, ctx);

    // Add CORS headers to response
    const newHeaders = new Headers(response.headers);
    newHeaders.set("Access-Control-Allow-Origin", allowedOrigin);
    if (credentials) {
      newHeaders.set("Access-Control-Allow-Credentials", "true");
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  };
}

/**
 * Get HTTP status text
 */
function getStatusText(status: number): string {
  const statusTexts: Record<number, string> = {
    200: "OK",
    201: "Created",
    204: "No Content",
    301: "Moved Permanently",
    302: "Found",
    304: "Not Modified",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    500: "Internal Server Error",
    502: "Bad Gateway",
    503: "Service Unavailable",
  };
  return statusTexts[status] || "Unknown";
}

// ============================================================================
// Types for Context Enhancement
// ============================================================================

declare module "./types" {
  interface Context {
    /** Cloudflare/Edge environment bindings */
    env?: CloudflareEnv;
    /** Cloudflare execution context */
    executionContext?: ExecutionContext;
  }
}
