/**
 * Auto-Instrumentation — Automatic Span Creation for AsiJS Requests
 *
 * Creates OpenTelemetry spans for:
 * - Full request lifecycle (middleware chain + handler)
 * - Individual handler execution
 * - Database queries (opt-in)
 * - External HTTP calls (opt-in)
 *
 * Spans are decorated with semantic conventions attributes
 * and W3C TraceContext is extracted from incoming headers.
 *
 * @example
 * ```ts
 * import { otelPlugin } from "asijs-opentelemetry";
 *
 * app.plugin(otelPlugin({
 *   instrument: {
 *     spans: {
 *       request: true,
 *       handler: true,
 *       database: true,
 *     },
 *     skipPaths: ["/health", "/metrics"],
 *   },
 * }));
 * ```
 */

import type { Context, Middleware } from "asijs";
import type { InstrumentConfig } from "./types";
import { tracerManager } from "./tracer";

// ========================================================================
// Semantic convention attribute names
// ========================================================================

const SEMATTRS = {
  HTTP_METHOD: "http.method",
  HTTP_URL: "http.url",
  HTTP_TARGET: "http.target",
  HTTP_HOST: "http.host",
  HTTP_SCHEME: "http.scheme",
  HTTP_STATUS_CODE: "http.status_code",
  HTTP_ROUTE: "http.route",
  HTTP_REQUEST_CONTENT_LENGTH: "http.request_content_length",
  HTTP_RESPONSE_CONTENT_LENGTH: "http.response_content_length",
  HTTP_USER_AGENT: "http.user_agent",
  HTTP_FLAVOR: "http.flavor",

  NET_HOST_IP: "net.host.ip",
  NET_HOST_PORT: "net.host.port",
  NET_PEER_IP: "net.peer.ip",

  // Custom AsiJS attributes
  ASIJS_HANDLER: "asijs.handler",
  ASIJS_REQUEST_ID: "asijs.request_id",
  ASIJS_VERSION: "asijs.version",
};

// ========================================================================
// Instrumentation middleware
// ========================================================================

/**
 * Create an AsiJS middleware that creates OpenTelemetry spans
 * for every request and (optionally) handler execution.
 *
 * Extracts W3C TraceContext from `traceparent` / `tracestate` headers
 * so distributed tracing works across services.
 */
export function otelInstrumentationMiddleware(
  config: InstrumentConfig = {},
): Middleware {
  const {
    spans: spanOptions = {},
    attributes: attrOptions,
    skipPaths = ["/health", "/ready", "/live", "/metrics"],
    skip,
  } = config;

  const options = {
    request: spanOptions.request ?? true,
    handler: spanOptions.handler ?? true,
    database: spanOptions.database ?? false,
    httpClient: spanOptions.httpClient ?? false,
    middleware: spanOptions.middleware ?? false,
  };

  return async (ctx: Context, next: () => Promise<Response>) => {
    // Skip check
    if (skip?.(ctx) || skipPaths.includes(ctx.path)) {
      return next();
    }

    const api = tracerManager.getOTelAPI();
    if (!api || !tracerManager.isInitialized) {
      return next();
    }

    // Extract parent trace context from incoming headers
    let parentContext = api.context.active();
    if (tracerManager.getConfig().propagateTraceContext ?? true) {
      const traceparent = ctx.header("traceparent");
      if (traceparent) {
        const carrier: Record<string, string> = { traceparent };
        const tracestate = ctx.header("tracestate");
        if (tracestate) {
          carrier.tracestate = tracestate;
        }
        parentContext = api.propagation.extract(parentContext, carrier);
      }
    }

    if (!options.request) {
      return next();
    }

    const tracer = tracerManager.getTracer()!;

    // Build request span attributes
    const attributes: Record<string, unknown> = {
      [SEMATTRS.HTTP_METHOD]: ctx.method,
      [SEMATTRS.HTTP_URL]: ctx.url.toString(),
      [SEMATTRS.HTTP_TARGET]: ctx.path,
      [SEMATTRS.HTTP_HOST]: ctx.header("host") ?? "localhost",
      [SEMATTRS.HTTP_SCHEME]: ctx.url.protocol?.replace(":", "") ?? "http",
      [SEMATTRS.HTTP_USER_AGENT]: ctx.header("user-agent") ?? "",
      [SEMATTRS.HTTP_FLAVOR]: "1.1",
      [SEMATTRS.ASIJS_REQUEST_ID]: (ctx as any).requestId ?? "",
      [SEMATTRS.ASIJS_VERSION]: "1.2.0",
      [SEMATTRS.NET_PEER_IP]:
        ctx.header("x-forwarded-for") ?? ctx.header("x-real-ip") ?? "",
    };

    // Add static attributes from config
    if (attrOptions?.static) {
      Object.assign(attributes, attrOptions.static);
    }

    // Add dynamic attributes from config
    if (attrOptions?.dynamic) {
      try {
        const dynamicAttrs = attrOptions.dynamic(ctx);
        Object.assign(attributes, dynamicAttrs);
      } catch { /* ignore extractor errors */ }
    }

    // Use route pattern if available (set by AsiJS router)
    const routePattern = (ctx as any).routePattern;
    if (routePattern) {
      attributes[SEMATTRS.HTTP_ROUTE] = routePattern;
    }

    // Start the request span
    const spanName = `${ctx.method} ${routePattern ?? ctx.path}`;
    const span = tracer.startSpan(spanName, { attributes }, parentContext);

    const requestCtx = api.trace.setSpan(parentContext, span);

    try {
      // Execute the request within the span context
      let response: Response;
      try {
        response = await api.context.with(requestCtx, () => next());
      } catch (error) {
        // Record error on span
        span.recordException(error as Error);
        span.setStatus({
          code: api.SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }

      // Add response attributes
      span.setAttribute(SEMATTRS.HTTP_STATUS_CODE, response.status);
      const contentLength = response.headers.get("content-length");
      if (contentLength) {
        span.setAttribute(
          SEMATTRS.HTTP_RESPONSE_CONTENT_LENGTH,
          parseInt(contentLength, 10),
        );
      }

      // Determine span status from response code
      if (response.status >= 500) {
        span.setStatus({
          code: api.SpanStatusCode.ERROR,
        });
      } else {
        span.setStatus({ code: api.SpanStatusCode.OK });
      }

      return response;
    } finally {
      span.end();
    }
  };
}

// ========================================================================
// Handler instrumentation helper
// ========================================================================

/**
 * Wrap a route handler with OpenTelemetry instrumentation.
 * Creates a child span under the request span.
 */
export function instrumentHandler(
  handler: (ctx: Context) => unknown | Promise<unknown>,
  name?: string,
): (ctx: Context) => Promise<unknown> {
  return async (ctx: Context) => {
    const api = tracerManager.getOTelAPI();
    if (!api || !tracerManager.isInitialized) {
      return handler(ctx);
    }

    const currentCtx = api.context.active();

    return tracerManager.withSpan(
      name ?? `handler:${(ctx as any).routePattern ?? ctx.path}`,
      () => handler(ctx),
      { parentContext: currentCtx },
    );
  };
}

// ========================================================================
// DB query instrumentation helper
// ========================================================================

/**
 * Instrument a database query as a child span.
 *
 * @example
 * ```ts
 * const users = await instrumentQuery("SELECT * FROM users", db.query(sql));
 * ```
 */
export async function instrumentQuery<T>(
  queryName: string,
  queryFn: Promise<T>,
  attributes?: Record<string, unknown>,
): Promise<T> {
  const api = tracerManager.getOTelAPI();
  if (!api || !tracerManager.isInitialized) {
    return queryFn;
  }

  return tracerManager.withSpan(`db.query:${queryName}`, async () => {
    try {
      const result = await queryFn;
      return result;
    } catch (error) {
      throw error;
    }
  }, { attributes: { "db.system": "sql", ...attributes } });
}

// ========================================================================
// External HTTP call instrumentation helper
// ========================================================================

/**
 * Instrument an external HTTP fetch call as a child span.
 *
 * @example
 * ```ts
 * const data = await instrumentFetch("https://api.example.com/data", {
 *   method: "GET",
 * });
 * ```
 */
export async function instrumentFetch<T = Response>(
  url: string,
  options?: RequestInit & {
    spanName?: string;
    attributes?: Record<string, unknown>;
  },
): Promise<T> {
  const api = tracerManager.getOTelAPI();
  if (!api || !tracerManager.isInitialized) {
    return fetch(url, options) as Promise<T>;
  }

  const { spanName, attributes, ...fetchOptions } = options ?? {};

  return tracerManager.withSpan(
    spanName ?? `http.client:${options?.method ?? "GET"} ${url}`,
    async (span) => {
      // Inject trace context into outgoing request headers
      const headers = new Headers(fetchOptions.headers);
      const carrier: Record<string, string> = {};
      api.propagation.inject(api.context.active(), carrier);
      for (const [key, value] of Object.entries(carrier)) {
        headers.set(key, value);
      }

      const response = await fetch(url, { ...fetchOptions, headers });

      span.setAttribute("http.status_code", response.status);
      span.setAttribute("http.url", url);

      if (response.status >= 400) {
        span.setStatus({
          code: api.SpanStatusCode.ERROR,
          message: `HTTP ${response.status}`,
        });
      }

      return response as T;
    },
    { attributes: { "http.method": fetchOptions.method ?? "GET", ...attributes } },
  );
}
