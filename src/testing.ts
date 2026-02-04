/**
 * Test Utilities for AsiJS
 *
 * Bun-native testing utilities:
 * - mockContext() - Create mock request context
 * - testClient() - HTTP client for testing apps
 * - Custom assertions
 * - Request/Response builders
 */

import { Context } from "./context";

// Type for Asi app
type AsiApp = {
  handle?: (request: Request) => Promise<Response>;
  fetch?: (request: Request) => Promise<Response>;
  _compiledHandler?: (request: Request) => Promise<Response>;
};

// ============================================================================
// Types
// ============================================================================

export interface MockContextOptions {
  /** HTTP method */
  method?: string;
  /** Request URL or path */
  url?: string;
  /** Request headers */
  headers?: Record<string, string>;
  /** Request body */
  body?: unknown;
  /** URL parameters */
  params?: Record<string, string>;
  /** Query parameters */
  query?: Record<string, string>;
  /** Cookies */
  cookies?: Record<string, string>;
  /** Initial store values */
  store?: Record<string, unknown>;
}

export interface TestClientOptions {
  /** Base URL for requests */
  baseUrl?: string;
  /** Default headers for all requests */
  headers?: Record<string, string>;
  /** Default timeout */
  timeout?: number;
}

export interface TestResponse<T = unknown> {
  /** Response status code */
  status: number;
  /** Response status text */
  statusText: string;
  /** Response headers */
  headers: Headers;
  /** Parsed JSON body */
  json: () => Promise<T>;
  /** Raw text body */
  text: () => Promise<string>;
  /** Array buffer body */
  arrayBuffer: () => Promise<ArrayBuffer>;
  /** Blob body */
  blob: () => Promise<Blob>;
  /** Original Response object */
  raw: Response;
  /** Check if response was successful (2xx) */
  ok: boolean;
}

export interface TestClient {
  /** Make GET request */
  get: <T = unknown>(
    path: string,
    options?: RequestOptions,
  ) => Promise<TestResponse<T>>;
  /** Make POST request */
  post: <T = unknown>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ) => Promise<TestResponse<T>>;
  /** Make PUT request */
  put: <T = unknown>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ) => Promise<TestResponse<T>>;
  /** Make PATCH request */
  patch: <T = unknown>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ) => Promise<TestResponse<T>>;
  /** Make DELETE request */
  delete: <T = unknown>(
    path: string,
    options?: RequestOptions,
  ) => Promise<TestResponse<T>>;
  /** Make HEAD request */
  head: (path: string, options?: RequestOptions) => Promise<TestResponse>;
  /** Make OPTIONS request */
  options: (path: string, options?: RequestOptions) => Promise<TestResponse>;
  /** Make WebSocket connection */
  ws: (path: string) => Promise<WebSocket>;
  /** Set authorization header */
  auth: (token: string, type?: "Bearer" | "Basic") => TestClient;
  /** Set custom header */
  header: (key: string, value: string) => TestClient;
}

export interface RequestOptions {
  /** Request headers */
  headers?: Record<string, string>;
  /** Query parameters */
  query?: Record<string, string>;
  /** Request timeout in ms */
  timeout?: number;
}

// ============================================================================
// Mock Context
// ============================================================================

/**
 * Create a mock context for testing handlers
 *
 * @example
 * ```ts
 * import { mockContext } from 'asijs/testing';
 *
 * test('handler returns greeting', async () => {
 *   const ctx = mockContext({
 *     method: 'GET',
 *     url: '/hello/world',
 *     params: { name: 'world' }
 *   });
 *
 *   const result = await myHandler(ctx);
 *   expect(result).toBe('Hello, world!');
 * });
 * ```
 */
export function mockContext(options: MockContextOptions = {}): Context {
  const {
    method = "GET",
    url = "/",
    headers = {},
    body,
    params = {},
    query = {},
    cookies = {},
    store = {},
  } = options;

  // Build URL with query params
  const baseUrl = url.startsWith("http") ? url : `http://localhost${url}`;
  const urlObj = new URL(baseUrl);
  for (const [key, value] of Object.entries(query)) {
    urlObj.searchParams.set(key, value);
  }

  // Build headers
  const reqHeaders = new Headers(headers);

  // Add cookies
  if (Object.keys(cookies).length > 0) {
    const cookieString = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
    reqHeaders.set("Cookie", cookieString);
  }

  // Add content-type for body
  if (body && !reqHeaders.has("Content-Type")) {
    reqHeaders.set("Content-Type", "application/json");
  }

  // Create request
  const request = new Request(urlObj.toString(), {
    method,
    headers: reqHeaders,
    body: body
      ? typeof body === "string"
        ? body
        : JSON.stringify(body)
      : undefined,
  });

  // Create real Context instance
  const ctx = new Context(request);

  // Set params
  ctx.params = params as Record<string, string>;

  // Set store values
  for (const [key, value] of Object.entries(store)) {
    ctx.store[key] = value;
  }

  return ctx;
}

/**
 * Create a mock context with FormData
 */
export function mockFormDataContext(
  formData: FormData,
  options: Omit<MockContextOptions, "body"> = {},
): Context {
  const ctx = mockContext({
    ...options,
    method: options.method || "POST",
    headers: {
      ...options.headers,
    },
  });

  // The Context will use the formData from the request
  // Files can be accessed via ctx.file() and ctx.files() which parse formData

  return ctx;
}

// ============================================================================
// Test Client
// ============================================================================

/**
 * Create a test client for an AsiJS app
 *
 * @example
 * ```ts
 * import { Asi } from 'asijs';
 * import { testClient } from 'asijs/testing';
 *
 * const app = new Asi();
 * app.get('/users/:id', (ctx) => ({ id: ctx.params.id }));
 *
 * const client = testClient(app);
 *
 * test('GET /users/:id returns user', async () => {
 *   const res = await client.get('/users/123');
 *   expect(res.status).toBe(200);
 *   expect(await res.json()).toEqual({ id: '123' });
 * });
 * ```
 */
export function testClient(
  app: AsiApp,
  options: TestClientOptions = {},
): TestClient {
  const { baseUrl = "http://localhost", headers: defaultHeaders = {} } =
    options;

  const currentHeaders: Record<string, string> = { ...defaultHeaders };

  const makeRequest = async <T>(
    method: string,
    path: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<TestResponse<T>> => {
    // Build URL
    const url = new URL(path, baseUrl);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        url.searchParams.set(key, value);
      }
    }

    // Build headers
    const headers = new Headers({
      ...currentHeaders,
      ...options.headers,
    });

    // Add content-type for body
    if (body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    // Create request
    const request = new Request(url.toString(), {
      method,
      headers,
      body: body
        ? typeof body === "string"
          ? body
          : JSON.stringify(body)
        : undefined,
    });

    // Get handler from app
    const handler = getAppHandler(app);
    const response = await handler(request);

    return wrapResponse<T>(response);
  };

  const client: TestClient = {
    get: <T>(path: string, options?: RequestOptions) =>
      makeRequest<T>("GET", path, undefined, options),

    post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
      makeRequest<T>("POST", path, body, options),

    put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
      makeRequest<T>("PUT", path, body, options),

    patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
      makeRequest<T>("PATCH", path, body, options),

    delete: <T>(path: string, options?: RequestOptions) =>
      makeRequest<T>("DELETE", path, undefined, options),

    head: (path: string, options?: RequestOptions) =>
      makeRequest("HEAD", path, undefined, options),

    options: (path: string, options?: RequestOptions) =>
      makeRequest("OPTIONS", path, undefined, options),

    ws: async (path: string) => {
      const url = new URL(path, baseUrl.replace("http", "ws"));
      return new WebSocket(url.toString());
    },

    auth: (token: string, type: "Bearer" | "Basic" = "Bearer") => {
      currentHeaders["Authorization"] = `${type} ${token}`;
      return client;
    },

    header: (key: string, value: string) => {
      currentHeaders[key] = value;
      return client;
    },
  };

  return client;
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

  // Fallback to handle method
  if (
    typeof (app as unknown as { handle?: (req: Request) => Promise<Response> })
      .handle === "function"
  ) {
    return (
      app as unknown as { handle: (req: Request) => Promise<Response> }
    ).handle.bind(app);
  }

  // Fallback to fetch method
  if (
    typeof (app as unknown as { fetch?: (req: Request) => Promise<Response> })
      .fetch === "function"
  ) {
    return (
      app as unknown as { fetch: (req: Request) => Promise<Response> }
    ).fetch.bind(app);
  }

  throw new Error("App does not have a request handler");
}

/**
 * Wrap Response with test helpers
 */
function wrapResponse<T>(response: Response): TestResponse<T> {
  // Clone response for multiple reads
  const cloned = response.clone();

  return {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    json: () => cloned.clone().json() as Promise<T>,
    text: () => cloned.clone().text(),
    arrayBuffer: () => cloned.clone().arrayBuffer(),
    blob: () => cloned.clone().blob(),
    raw: response,
    ok: response.ok,
  };
}

// ============================================================================
// Request Builders
// ============================================================================

/**
 * Build a mock Request object
 */
export function buildRequest(
  method: string,
  url: string,
  options: {
    headers?: Record<string, string>;
    body?: unknown;
    query?: Record<string, string>;
  } = {},
): Request {
  const urlObj = new URL(url, "http://localhost");

  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      urlObj.searchParams.set(key, value);
    }
  }

  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return new Request(urlObj.toString(), {
    method,
    headers,
    body: options.body
      ? typeof options.body === "string"
        ? options.body
        : JSON.stringify(options.body)
      : undefined,
  });
}

/**
 * Build FormData from object
 */
export function buildFormData(
  data: Record<string, string | Blob | File>,
): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(data)) {
    formData.append(key, value);
  }
  return formData;
}

/**
 * Create a mock File
 */
export function mockFile(
  content: string | ArrayBuffer,
  name: string,
  type = "text/plain",
): File {
  const blob = new Blob([content], { type });
  return new File([blob], name, { type });
}

// ============================================================================
// Assertions
// ============================================================================

/**
 * Assert that response has a specific status code
 */
export function assertStatus(response: TestResponse, expected: number): void {
  if (response.status !== expected) {
    throw new Error(`Expected status ${expected}, got ${response.status}`);
  }
}

/**
 * Assert that response is OK (2xx)
 */
export function assertOk(response: TestResponse): void {
  if (!response.ok) {
    throw new Error(`Expected OK response, got ${response.status}`);
  }
}

/**
 * Assert that response has a header
 */
export function assertHeader(
  response: TestResponse,
  name: string,
  expected?: string,
): void {
  const value = response.headers.get(name);
  if (value === null) {
    throw new Error(`Expected header "${name}" to exist`);
  }
  if (expected !== undefined && value !== expected) {
    throw new Error(
      `Expected header "${name}" to be "${expected}", got "${value}"`,
    );
  }
}

/**
 * Assert that response has content-type
 */
export function assertContentType(
  response: TestResponse,
  expected: string,
): void {
  const contentType = response.headers.get("Content-Type");
  if (!contentType || !contentType.includes(expected)) {
    throw new Error(
      `Expected content-type "${expected}", got "${contentType}"`,
    );
  }
}

/**
 * Assert JSON response matches expected structure
 */
export async function assertJson<T>(
  response: TestResponse<T>,
  expected: T | ((data: T) => boolean),
): Promise<void> {
  const data = await response.json();

  if (typeof expected === "function") {
    const fn = expected as (data: T) => boolean;
    if (!fn(data)) {
      throw new Error(`JSON assertion failed: ${JSON.stringify(data)}`);
    }
  } else {
    const dataStr = JSON.stringify(data);
    const expectedStr = JSON.stringify(expected);
    if (dataStr !== expectedStr) {
      throw new Error(`Expected JSON ${expectedStr}, got ${dataStr}`);
    }
  }
}

/**
 * Assert response body contains text
 */
export async function assertContains(
  response: TestResponse,
  expected: string,
): Promise<void> {
  const text = await response.text();
  if (!text.includes(expected)) {
    throw new Error(`Expected response to contain "${expected}"`);
  }
}

/**
 * Assert response is a redirect
 */
export function assertRedirect(
  response: TestResponse,
  location?: string,
): void {
  if (response.status < 300 || response.status >= 400) {
    throw new Error(`Expected redirect, got ${response.status}`);
  }
  if (location !== undefined) {
    assertHeader(response, "Location", location);
  }
}

// ============================================================================
// Test Lifecycle Helpers
// ============================================================================

/**
 * Create an app and client for testing
 */
export function setupTest(configure: (app: AsiApp) => void): {
  app: AsiApp;
  client: TestClient;
} {
  // Dynamic import to avoid circular dependency
  const { Asi } = require("./asi") as { Asi: new () => AsiApp };
  const app = new Asi();
  configure(app);
  const client = testClient(app);
  return { app, client };
}

/**
 * Run tests with a fresh app instance
 */
export async function withApp(
  configure: (app: AsiApp) => void,
  tests: (client: TestClient) => Promise<void>,
): Promise<void> {
  const { client } = setupTest(configure);
  await tests(client);
}

// ============================================================================
// Snapshot Testing
// ============================================================================

/**
 * Create a response snapshot for comparison
 */
export async function snapshotResponse(response: TestResponse): Promise<{
  status: number;
  headers: Record<string, string>;
  body: string;
}> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    // Skip headers that change between runs
    if (!["date", "x-request-id"].includes(key.toLowerCase())) {
      headers[key] = value;
    }
  });

  return {
    status: response.status,
    headers,
    body: await response.text(),
  };
}

// ============================================================================
// Performance Testing
// ============================================================================

/**
 * Measure handler execution time
 */
export async function measureHandler(
  handler: (ctx: Context) => unknown | Promise<unknown>,
  ctx: Context,
  iterations = 100,
): Promise<{
  min: number;
  max: number;
  avg: number;
  median: number;
  p95: number;
  p99: number;
}> {
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await handler(ctx);
    times.push(performance.now() - start);
  }

  times.sort((a, b) => a - b);

  return {
    min: times[0],
    max: times[times.length - 1],
    avg: times.reduce((a, b) => a + b, 0) / times.length,
    median: times[Math.floor(times.length / 2)],
    p95: times[Math.floor(times.length * 0.95)],
    p99: times[Math.floor(times.length * 0.99)],
  };
}

/**
 * Benchmark a route
 */
export async function benchmarkRoute(
  client: TestClient,
  method: keyof TestClient,
  path: string,
  iterations = 100,
): Promise<{
  rps: number;
  avgLatency: number;
  minLatency: number;
  maxLatency: number;
}> {
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await (client[method] as (path: string) => Promise<TestResponse>)(path);
    times.push(performance.now() - start);
  }

  const totalTime = times.reduce((a, b) => a + b, 0);

  return {
    rps: (iterations / totalTime) * 1000,
    avgLatency: totalTime / iterations,
    minLatency: Math.min(...times),
    maxLatency: Math.max(...times),
  };
}
