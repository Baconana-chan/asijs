/**
 * Typed Fetch Client for AsiJS (Eden-like)
 *
 * Generates a type-safe API client from route definitions.
 * Inspired by Elysia's Eden and tRPC.
 *
 * @example
 * ```ts
 * import { Asi, t } from "asijs";
 * import { treaty } from "asijs/client";
 *
 * const app = new Asi()
 *   .get("/users/:id", (ctx) => ({ id: ctx.params.id, name: "John" }))
 *   .post("/users", (ctx) => ctx.body, {
 *     body: t.Object({ name: t.String() })
 *   });
 *
 * // Create typed client
 * const api = treaty<typeof app>("http://localhost:3000");
 *
 * // Fully typed!
 * const user = await api.users({ id: "123" }).get();
 * const newUser = await api.users.post({ name: "Jane" });
 * ```
 */

// ===== Types =====

export type HTTPMethod =
  | "get"
  | "post"
  | "put"
  | "patch"
  | "delete"
  | "options"
  | "head";

export interface RequestOptions<
  TBody = unknown,
  TQuery = unknown,
  TParams = unknown,
> {
  body?: TBody;
  query?: TQuery;
  params?: TParams;
  headers?: HeadersInit;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Abort signal for request cancellation */
  signal?: AbortSignal;
  /** Fetch options override */
  fetch?: RequestInit;
}

export interface ClientResponse<T> {
  data: T;
  status: number;
  headers: Headers;
  response: Response;
}

export interface ClientError {
  error: unknown;
  status: number;
  headers: Headers;
  response: Response;
}

export interface ClientConfig {
  /** Base URL for all requests */
  baseUrl: string;
  /** Default headers for all requests */
  headers?: HeadersInit;
  /** Default timeout in milliseconds */
  timeout?: number;
  /** Custom fetch function (useful for testing) */
  fetch?: typeof globalThis.fetch;
  /** Transform response before returning */
  onResponse?: (response: Response) => Response | Promise<Response>;
  /** Transform request before sending */
  onRequest?: (request: Request) => Request | Promise<Request>;
  /** Error handler */
  onError?: (error: ClientError) => void | Promise<void>;
}

// ===== Path Utilities =====

/**
 * Parse path template and extract parameter names
 */
function parsePathTemplate(path: string): string[] {
  const params: string[] = [];
  const regex = /:([a-zA-Z_][a-zA-Z0-9_]*)/g;
  let match;
  while ((match = regex.exec(path)) !== null) {
    params.push(match[1]);
  }
  return params;
}

/**
 * Build URL with path parameters and query string
 */
function buildUrl(
  baseUrl: string,
  path: string,
  params?: Record<string, unknown>,
  query?: Record<string, unknown>,
): string {
  // Replace path parameters
  let url = path;
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url = url.replace(`:${key}`, encodeURIComponent(String(value)));
    }
  }

  // Remove any trailing colons from unreplaced params
  url = url.replace(/\/:[a-zA-Z_][a-zA-Z0-9_]*/g, "");

  // Build query string
  if (query && Object.keys(query).length > 0) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          for (const item of value) {
            searchParams.append(key, String(item));
          }
        } else {
          searchParams.set(key, String(value));
        }
      }
    }
    const qs = searchParams.toString();
    if (qs) {
      url += `?${qs}`;
    }
  }

  // Join base URL and path
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const urlPath = url.startsWith("/") ? url : `/${url}`;

  return base + urlPath;
}

// ===== Client Factory =====

/**
 * Create a simple fetch client for manual use
 */
export function createClient(config: ClientConfig): {
  request: <T = unknown>(
    method: HTTPMethod,
    path: string,
    options?: RequestOptions,
  ) => Promise<ClientResponse<T>>;
  get: <T = unknown>(
    path: string,
    options?: RequestOptions,
  ) => Promise<ClientResponse<T>>;
  post: <T = unknown>(
    path: string,
    options?: RequestOptions,
  ) => Promise<ClientResponse<T>>;
  put: <T = unknown>(
    path: string,
    options?: RequestOptions,
  ) => Promise<ClientResponse<T>>;
  patch: <T = unknown>(
    path: string,
    options?: RequestOptions,
  ) => Promise<ClientResponse<T>>;
  delete: <T = unknown>(
    path: string,
    options?: RequestOptions,
  ) => Promise<ClientResponse<T>>;
  head: <T = unknown>(
    path: string,
    options?: RequestOptions,
  ) => Promise<ClientResponse<T>>;
  options: <T = unknown>(
    path: string,
    options?: RequestOptions,
  ) => Promise<ClientResponse<T>>;
} {
  const fetchFn = config.fetch ?? globalThis.fetch;

  async function request<T = unknown>(
    method: HTTPMethod,
    path: string,
    options: RequestOptions = {},
  ): Promise<ClientResponse<T>> {
    const url = buildUrl(
      config.baseUrl,
      path,
      options.params as Record<string, unknown>,
      options.query as Record<string, unknown>,
    );

    // Merge headers
    const headers = new Headers(config.headers);
    if (options.headers) {
      const optHeaders = new Headers(options.headers);
      optHeaders.forEach((value, key) => headers.set(key, value));
    }

    // Build request init
    const init: RequestInit = {
      method: method.toUpperCase(),
      headers,
      ...options.fetch,
    };

    // Add body for methods that support it
    if (options.body !== undefined && !["get", "head"].includes(method)) {
      if (options.body instanceof FormData) {
        init.body = options.body;
      } else if (
        options.body instanceof Blob ||
        options.body instanceof ArrayBuffer
      ) {
        init.body = options.body;
      } else if (typeof options.body === "string") {
        init.body = options.body;
      } else {
        init.body = JSON.stringify(options.body);
        headers.set("Content-Type", "application/json");
      }
    }

    // Handle timeout
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let abortController: AbortController | undefined;

    if (options.timeout ?? config.timeout) {
      abortController = new AbortController();
      const timeout = options.timeout ?? config.timeout!;
      timeoutId = setTimeout(() => abortController!.abort(), timeout);
      init.signal = options.signal
        ? combineAbortSignals(options.signal, abortController.signal)
        : abortController.signal;
    } else if (options.signal) {
      init.signal = options.signal;
    }

    let request = new Request(url, init);

    // Transform request
    if (config.onRequest) {
      request = await config.onRequest(request);
    }

    try {
      let response = await fetchFn(request);

      if (timeoutId) clearTimeout(timeoutId);

      // Transform response
      if (config.onResponse) {
        response = await config.onResponse(response);
      }

      // Parse response
      const contentType = response.headers.get("Content-Type") ?? "";
      let data: T;

      if (contentType.includes("application/json")) {
        data = (await response.json()) as T;
      } else if (contentType.includes("text/")) {
        data = (await response.text()) as T;
      } else {
        data = response as unknown as T;
      }

      // Check for errors
      if (!response.ok) {
        const error: ClientError = {
          error: data,
          status: response.status,
          headers: response.headers,
          response,
        };

        if (config.onError) {
          await config.onError(error);
        }

        throw error;
      }

      return {
        data,
        status: response.status,
        headers: response.headers,
        response,
      };
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      throw err;
    }
  }

  return {
    get: <T = unknown>(path: string, options?: RequestOptions) =>
      request<T>("get", path, options),
    post: <T = unknown>(path: string, options?: RequestOptions) =>
      request<T>("post", path, options),
    put: <T = unknown>(path: string, options?: RequestOptions) =>
      request<T>("put", path, options),
    patch: <T = unknown>(path: string, options?: RequestOptions) =>
      request<T>("patch", path, options),
    delete: <T = unknown>(path: string, options?: RequestOptions) =>
      request<T>("delete", path, options),
    head: <T = unknown>(path: string, options?: RequestOptions) =>
      request<T>("head", path, options),
    options: <T = unknown>(path: string, options?: RequestOptions) =>
      request<T>("options", path, options),
    request,
  };
}

/**
 * Combine multiple AbortSignals
 */
function combineAbortSignals(
  signal1: AbortSignal,
  signal2: AbortSignal,
): AbortSignal {
  const controller = new AbortController();

  const onAbort = () => controller.abort();

  signal1.addEventListener("abort", onAbort);
  signal2.addEventListener("abort", onAbort);

  if (signal1.aborted || signal2.aborted) {
    controller.abort();
  }

  return controller.signal;
}

// ===== Treaty (Type-Safe Client) =====

/**
 * Route method handler type
 */
type MethodHandler<TResponse = unknown, TBody = unknown, TQuery = unknown> = {
  (options?: {
    body?: TBody;
    query?: TQuery;
    headers?: HeadersInit;
    timeout?: number;
    signal?: AbortSignal;
  }): Promise<ClientResponse<TResponse>>;
};

/**
 * Path segment with parameters
 */
type PathSegment<TParams = Record<string, string>> = {
  (params: TParams): PathProxy;
} & PathProxy;

/**
 * Proxy type for path building
 */
type PathProxy = {
  [segment: string]: PathSegment;
} & {
  get: MethodHandler;
  post: MethodHandler;
  put: MethodHandler;
  patch: MethodHandler;
  delete: MethodHandler;
  head: MethodHandler;
  options: MethodHandler;
};

/**
 * Create a type-safe treaty client (Eden-like)
 *
 * This creates a proxy that allows building paths and calling methods
 * in a fluent, type-safe manner.
 *
 * @example
 * ```ts
 * const api = treaty<typeof app>("http://localhost:3000");
 *
 * // GET /users/123
 * await api.users({ id: "123" }).get();
 * // or: await api.users["123"].get();
 *
 * // POST /users
 * await api.users.post({ body: { name: "John" } });
 *
 * // GET /users/123/posts?limit=10
 * await api.users({ id: "123" }).posts.get({ query: { limit: 10 } });
 * ```
 */
export function treaty<TApp = unknown>(
  baseUrl: string,
  options: Omit<ClientConfig, "baseUrl"> = {},
): PathProxy {
  const client = createClient({ ...options, baseUrl });

  function createPathProxy(
    pathParts: string[] = [],
    params: Record<string, unknown> = {},
  ): PathProxy {
    return new Proxy(() => {}, {
      get(_, prop: string) {
        // HTTP method call
        if (
          ["get", "post", "put", "patch", "delete", "head", "options"].includes(
            prop,
          )
        ) {
          const path = "/" + pathParts.join("/");
          return async (opts: RequestOptions = {}) => {
            return client.request(prop as HTTPMethod, path, {
              ...opts,
              params: {
                ...params,
                ...(opts.params as Record<string, unknown>),
              },
            });
          };
        }

        // Path segment
        return createPathProxy([...pathParts, prop], params);
      },

      apply(_, __, args: unknown[]) {
        // Called with parameters: api.users({ id: "123" })
        const newParams = (args[0] as Record<string, unknown>) ?? {};

        // If last path part was a param placeholder, replace with actual value
        const updatedParts = [...pathParts];
        const allParams = { ...params, ...newParams };

        // Convert params to path segments where appropriate
        // e.g. users({ id: "123" }) → users/123
        if (Object.keys(newParams).length === 1) {
          const [key, value] = Object.entries(newParams)[0];
          // If this looks like a direct ID, append it to path
          if (key === "id" || key.endsWith("Id") || key.endsWith("_id")) {
            updatedParts.push(String(value));
            delete allParams[key];
          }
        }

        return createPathProxy(updatedParts, allParams);
      },
    }) as unknown as PathProxy;
  }

  return createPathProxy();
}

// ===== Batch Requests =====

export interface BatchRequest {
  method: HTTPMethod;
  path: string;
  body?: unknown;
  query?: Record<string, unknown>;
  params?: Record<string, unknown>;
}

export interface BatchResponse<T = unknown> {
  results: Array<ClientResponse<T> | ClientError>;
  successful: number;
  failed: number;
}

/**
 * Execute multiple requests in parallel
 */
export async function batchRequest<T = unknown>(
  client: ReturnType<typeof createClient>,
  requests: BatchRequest[],
): Promise<BatchResponse<T>> {
  const results = await Promise.allSettled(
    requests.map((req) =>
      client.request<T>(req.method, req.path, {
        body: req.body,
        query: req.query,
        params: req.params,
      }),
    ),
  );

  let successful = 0;
  let failed = 0;

  const mappedResults = results.map((result) => {
    if (result.status === "fulfilled") {
      successful++;
      return result.value;
    } else {
      failed++;
      return result.reason as ClientError;
    }
  });

  return {
    results: mappedResults,
    successful,
    failed,
  };
}

// ===== Retry Logic =====

export interface RetryOptions {
  /** Maximum number of retries */
  maxRetries?: number;
  /** Base delay between retries in ms */
  baseDelay?: number;
  /** Maximum delay between retries in ms */
  maxDelay?: number;
  /** Jitter factor (0-1) for randomizing delays */
  jitter?: number;
  /** Status codes to retry on */
  retryOn?: number[];
  /** Whether to retry on network errors */
  retryOnNetworkError?: boolean;
}

const defaultRetryOptions: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  jitter: 0.1,
  retryOn: [408, 429, 500, 502, 503, 504],
  retryOnNetworkError: true,
};

/**
 * Wrap a request function with retry logic
 */
export function withRetry<T>(
  fn: () => Promise<ClientResponse<T>>,
  options: RetryOptions = {},
): Promise<ClientResponse<T>> {
  const opts = { ...defaultRetryOptions, ...options };

  async function attempt(retryCount: number): Promise<ClientResponse<T>> {
    try {
      return await fn();
    } catch (error) {
      const isClientError =
        typeof error === "object" && error !== null && "status" in error;

      const status = isClientError ? (error as ClientError).status : 0;
      const shouldRetry =
        retryCount < opts.maxRetries &&
        (opts.retryOn.includes(status) ||
          (!isClientError && opts.retryOnNetworkError));

      if (!shouldRetry) {
        throw error;
      }

      // Calculate delay with exponential backoff and jitter
      const baseDelay = Math.min(
        opts.baseDelay * Math.pow(2, retryCount),
        opts.maxDelay,
      );
      const jitterAmount = baseDelay * opts.jitter;
      const delay = baseDelay + (Math.random() * 2 - 1) * jitterAmount;

      await new Promise((resolve) => setTimeout(resolve, delay));

      return attempt(retryCount + 1);
    }
  }

  return attempt(0);
}

// ===== Type Helpers for Better Inference =====

/**
 * Extract the response type from an Asi app route
 * Note: This is a placeholder for actual type inference from Asi routes
 */
export type InferResponse<T> = T extends (
  ...args: unknown[]
) => Promise<infer R>
  ? R
  : T extends (...args: unknown[]) => infer R
    ? R
    : unknown;

/**
 * Extract routes from an Asi app type
 */
export type InferRoutes<TApp> = TApp extends { routes: infer R } ? R : never;
