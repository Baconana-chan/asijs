/**
 * Async Error Boundary — Structured Error Handling for AsiJS
 *
 * - Error classification: business (4xx) vs system (5xx) vs fatal (crash)
 * - `ctx.errorBoundary<T>(fn)` — catch handler errors and return a structured response
 * - Error reporting pipeline: plugin hooks for Sentry, logging, metrics
 * - Retry policies: automatic retry for idempotent operations
 *
 * @example
 * ```ts
 * import { Asi, BusinessError, retry } from "asijs";
 *
 * const app = new Asi();
 *
 * // Throw business errors with a status code:
 * app.get("/users/:id", async (ctx) => {
 *   const user = await db.find(ctx.params.id);
 *   if (!user) throw new BusinessError("USER_NOT_FOUND", "User not found");
 *   return user;
 * });
 *
 * // Handle errors locally with a structured fallback:
 * app.get("/risky", async (ctx) => {
 *   const result = await ctx.errorBoundary(
 *     () => riskyCall(),
 *     { fallback: { ok: false } },
 *   );
 *   return result;
 * });
 *
 * // Retry idempotent operations:
 * const data = await retry(() => fetchExternal(), { attempts: 3, backoff: "exponential" });
 * ```
 */

import type { Context } from "./context";
import type { Middleware } from "./types";
import { createPlugin, type AsiPlugin } from "./plugin";
import { ValidationException } from "./validation";

// ============================================================================
// Error classification
// ============================================================================

/** Error categories */
export type ErrorCategory = "business" | "system" | "fatal" | "validation";

/** Structured error info after classification */
export interface ClassifiedError {
  /** Stable category */
  category: ErrorCategory;
  /** HTTP status to return */
  status: number;
  /** Stable error code (e.g. "USER_NOT_FOUND") */
  code?: string;
  /** Safe message for the client */
  message: string;
  /** Additional machine-readable details */
  details?: unknown;
  /** Whether retrying the operation makes sense */
  retryable: boolean;
  /** The original error */
  original: unknown;
}

/**
 * Base error with an HTTP status — the foundation for business/system errors.
 */
export class HttpError extends Error {
  /** HTTP status code */
  status: number;
  /** Stable machine-readable error code */
  code?: string;
  /** Extra details attached to the error response */
  details?: unknown;
  /** Whether retrying may help (defaults to false for 4xx, true for 5xx) */
  retryable?: boolean;

  constructor(
    status: number,
    message: string,
    options: { code?: string; details?: unknown; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "HttpError";
    this.status = status;
    this.code = options.code;
    this.details = options.details;
    if (options.retryable !== undefined) this.retryable = options.retryable;
  }
}

/** Business error — a client-side problem (4xx), not a server fault */
export class BusinessError extends HttpError {
  constructor(
    code: string,
    message?: string,
    options: { status?: number; details?: unknown } = {},
  ) {
    super(options.status ?? 400, message ?? code, { code, details: options.details });
    this.name = "BusinessError";
  }
}

/** Not found shorthand */
export class NotFoundError extends BusinessError {
  constructor(message = "Resource not found", options: { details?: unknown } = {}) {
    super("NOT_FOUND", message, { status: 404, ...options });
    this.name = "NotFoundError";
  }
}

/** Unauthorized shorthand */
export class UnauthorizedError extends BusinessError {
  constructor(message = "Unauthorized", options: { details?: unknown } = {}) {
    super("UNAUTHORIZED", message, { status: 401, ...options });
    this.name = "UnauthorizedError";
  }
}

/** Forbidden shorthand */
export class ForbiddenError extends BusinessError {
  constructor(message = "Forbidden", options: { details?: unknown } = {}) {
    super("FORBIDDEN", message, { status: 403, ...options });
    this.name = "ForbiddenError";
  }
}

/** Conflict shorthand */
export class ConflictError extends BusinessError {
  constructor(message = "Conflict", options: { details?: unknown } = {}) {
    super("CONFLICT", message, { status: 409, ...options });
    this.name = "ConflictError";
  }
}

/** System error — a server-side fault (5xx) */
export class SystemError extends HttpError {
  constructor(
    message = "Internal Server Error",
    options: { code?: string; details?: unknown; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(500, message, {
      code: options.code ?? "INTERNAL_ERROR",
      details: options.details,
      retryable: options.retryable ?? true,
      cause: options.cause,
    });
    this.name = "SystemError";
  }
}

/** Fatal error — process-level crash, must not be swallowed silently */
export class FatalError extends Error {
  /** Stable code */
  code?: string;
  /** Whether the process should exit (default: true) */
  crash: boolean;

  constructor(message: string, options: { code?: string; crash?: boolean; cause?: unknown } = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "FatalError";
    this.code = options.code ?? "FATAL_ERROR";
    this.crash = options.crash ?? true;
  }
}

/**
 * Classify any thrown value into a structured, client-safe error.
 */
export function classifyError(error: unknown): ClassifiedError {
  // Validation errors from the validation engine
  if (error instanceof ValidationException) {
    return {
      category: "validation",
      status: 400,
      code: "VALIDATION_ERROR",
      message: "Validation Error",
      details: error.errors,
      retryable: false,
      original: error,
    };
  }

  // HttpError family (BusinessError / SystemError / shorthands)
  if (error instanceof HttpError) {
    const status = error.status;
    const isClient = status >= 400 && status < 500;
    return {
      category: isClient ? "business" : "system",
      status,
      code: error.code,
      message: error.message || (isClient ? "Bad Request" : "Internal Server Error"),
      details: error.details,
      retryable: error.retryable ?? !isClient,
      original: error,
    };
  }

  if (error instanceof FatalError) {
    return {
      category: "fatal",
      status: 500,
      code: error.code,
      message: error.message,
      retryable: false,
      original: error,
    };
  }

  // Any other error — system error
  const message = error instanceof Error ? error.message : String(error);
  return {
    category: "system",
    status: 500,
    code: "INTERNAL_ERROR",
    message,
    retryable: true,
    original: error,
  };
}

// ============================================================================
// Structured response
// ============================================================================

/** Shape of the structured error response body */
export interface ErrorResponseBody {
  error: string;
  code?: string;
  details?: unknown;
  category: ErrorCategory;
  requestId?: string;
}

/**
 * Build a structured error Response from any thrown value.
 * Respects `ctx.store.requestId` when set (by requestId middleware or plugins).
 */
export function toErrorResponse(ctx: Context, error: unknown): Response {
  const classified = classifyError(error);
  const requestId =
    typeof ctx.store?.requestId === "string"
      ? (ctx.store.requestId as string)
      : undefined;

  const body: ErrorResponseBody = {
    error: classified.message,
    category: classified.category,
    ...(classified.code ? { code: classified.code } : {}),
    ...(classified.details !== undefined ? { details: classified.details } : {}),
    ...(requestId ? { requestId } : {}),
  };

  return ctx.status(classified.status).jsonResponse(body);
}

// ============================================================================
// ctx.errorBoundary
// ============================================================================

/** Options for `ctx.errorBoundary` */
export interface ErrorBoundaryOptions<T> {
  /** Fallback value returned when the operation throws (instead of a Response) */
  fallback?: T;
  /** Custom handler — receives the classified error, may return a value or rethrow */
  onError?: (error: ClassifiedError) => T | Promise<T>;
  /** Re-throw instead of catching (default: false) */
  rethrow?: boolean;
  /** Report the error through the app's error reporters (default: true) */
  report?: boolean;
}

/**
 * Attach `errorBoundary` to a Context instance.
 * Called internally by `errorBoundary()` middleware / plugin.
 */
export function attachErrorBoundary(ctx: Context): void {
  if ((ctx as unknown as { errorBoundary?: unknown }).errorBoundary) return;

  ctx.errorBoundary = async function <T>(
    fn: () => T | Promise<T>,
    options: ErrorBoundaryOptions<T> = {},
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (options.rethrow) throw error;

      if (options.onError) {
        const result = await options.onError(classifyError(error));
        // If the handler returns a Response, use it directly; otherwise fallback
        return (result ?? options.fallback) as T;
      }

      if (options.fallback !== undefined) {
        return options.fallback;
      }

      // No fallback — throw a response so the pipeline turns it into JSON
      throw toErrorResponse(ctx, error);
    }
  };
}

// ============================================================================
// Error reporting pipeline
// ============================================================================

/** Context passed to error reporters */
export interface ErrorReportContext {
  ctx: Context;
  error: unknown;
  classified: ClassifiedError;
  requestId?: string;
  durationMs?: number;
}

/** A single error reporter hook */
export type ErrorReporter = (report: ErrorReportContext) => void | Promise<void>;

/** Options for the error reporting pipeline */
export interface ErrorReporterOptions {
  /** Custom reporter hooks (Sentry, structured logger, metrics, ...) */
  reporters?: ErrorReporter[];
  /** Log every error through console.error (default: true) */
  logToConsole?: boolean;
  /** Only report errors at or above this category (default: "system") */
  minCategory?: ErrorCategory;
  /** Attach a request id to store when not present (default: true) */
  requestId?: boolean;
}

const CATEGORY_RANK: Record<ErrorCategory, number> = {
  validation: 0,
  business: 1,
  system: 2,
  fatal: 3,
};

/**
 * Error reporting pipeline — runs all reporter hooks for a classified error.
 * Used by `errorBoundary()` middleware and available for direct calls.
 */
export async function runErrorReporters(
  reporters: ErrorReporter[],
  report: ErrorReportContext,
  options: { logToConsole?: boolean; minCategory?: ErrorCategory } = {},
): Promise<void> {
  const minRank = CATEGORY_RANK[options.minCategory ?? "system"];
  const rank = CATEGORY_RANK[report.classified.category];

  if (rank < minRank) return;

  if (options.logToConsole !== false) {
    console.error(
      `[Asi Error:${report.classified.category}:${report.classified.status}]`,
      report.classified.message,
    );
  }

  for (const reporter of reporters) {
    try {
      await reporter(report);
    } catch (reporterError) {
      console.error("[Asi] Error reporter failed:", reporterError);
    }
  }
}

// ============================================================================
// errorBoundary middleware / plugin
// ============================================================================

/** Options for the error-boundary plugin (handling + retry/backoff). */
export interface ErrorBoundaryPluginOptions extends ErrorReporterOptions {
  /** Whether to also handle errors globally via app.onError (default: true) */
  handleGlobalErrors?: boolean;
}

/**
 * Create the error boundary plugin:
 * - Attaches `ctx.errorBoundary` to every request context
 * - Registers a global `onError` handler that returns structured JSON
 * - Runs the reporting pipeline (Sentry, logger, metrics hooks)
 * - Optionally sets `ctx.store.requestId` for correlation
 *
 * @example
 * ```ts
 * app.plugin(errorBoundary({
 *   reporters: [
 *     (report) => sentry.captureException(report.error, { extra: { path: report.ctx.path } }),
 *   ],
 * }));
 * ```
 */
export function errorBoundary(options: ErrorBoundaryPluginOptions = {}): AsiPlugin {
  const reporters: ErrorReporter[] = options.reporters ?? [];
  const withRequestId = options.requestId ?? true;

  const middleware: Middleware = async (ctx, next) => {
    // Attach errorBoundary to the context
    attachErrorBoundary(ctx);

    // Attach a request id for correlation
    if (withRequestId && !ctx.store.requestId) {
      ctx.store.requestId = crypto.randomUUID();
    }

    const start = performance.now();
    try {
      return await next();
    } catch (error) {
      const durationMs = performance.now() - start;

      const classified = classifyError(error);
      const report: ErrorReportContext = {
        ctx,
        error,
        classified,
        requestId: ctx.store.requestId as string | undefined,
        durationMs,
      };
      await runErrorReporters(reporters, report, {
        logToConsole: options.logToConsole,
        minCategory: options.minCategory,
      });

      return toErrorResponse(ctx, error);
    }
  };

  return createPlugin({
    name: "errorBoundary",
    version: "1.0.0",
    middleware: [middleware],
    setup(app: any) {
      // Handle errors that escape route handlers / middleware
      if (options.handleGlobalErrors !== false && typeof app.onError === "function") {
        app.onError((ctx: Context, error: unknown) => {
          const classified = classifyError(error);
          const report: ErrorReportContext = {
            ctx,
            error,
            classified,
            requestId: ctx.store?.requestId as string | undefined,
          };
          void runErrorReporters(reporters, report, {
            logToConsole: options.logToConsole,
            minCategory: options.minCategory,
          });
          return toErrorResponse(ctx, error);
        });
      }

      // Expose helpers via app state for programmatic use
      app.setState("errorBoundary", {
        classify: classifyError,
        toResponse: (ctx: Context, err: unknown) => toErrorResponse(ctx, err),
      });
    },
  });
}

// ============================================================================
// Retry policies
// ============================================================================

/** Retry backoff strategies for async error handling. */
export type BackoffStrategy = "fixed" | "exponential" | "linear";

/** Options for `retry` */
export interface ErrorRetryOptions {
  /** Maximum attempts including the first (default: 3) */
  attempts?: number;
  /** Base delay between attempts in ms (default: 100) */
  delayMs?: number;
  /** Backoff strategy (default: "exponential") */
  backoff?: BackoffStrategy;
  /** Max delay cap in ms (default: 10_000) */
  maxDelayMs?: number;
  /** Predicate deciding whether to retry (default: retryable 5xx or network errors) */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Callback after each failed attempt (before delay) */
  onRetry?: (error: unknown, attempt: number) => void | Promise<void>;
  /** Jitter factor 0..1 — randomizes the delay to avoid thundering herd (default: 0.2) */
  jitter?: number;
}

/** Compute the delay before attempt `attempt` (0-based after first failure) */
export function computeBackoff(
  attempt: number,
  options: { backoff?: BackoffStrategy; delayMs?: number; maxDelayMs?: number; jitter?: number },
): number {
  const base = options.delayMs ?? 100;
  const max = options.maxDelayMs ?? 10_000;
  const strategy = options.backoff ?? "exponential";
  const jitter = options.jitter ?? 0.2;

  let delay: number;
  switch (strategy) {
    case "fixed":
      delay = base;
      break;
    case "linear":
      delay = base * (attempt + 1);
      break;
    case "exponential":
    default:
      delay = base * Math.pow(2, attempt);
      break;
  }

  delay = Math.min(delay, max);

  if (jitter > 0) {
    const spread = delay * jitter;
    delay = delay - spread + Math.random() * spread * 2;
  }

  return Math.max(0, Math.round(delay));
}

/** Default retry predicate: 5xx HttpErrors / SystemError are retryable */
export function defaultShouldRetry(error: unknown): boolean {
  if (error instanceof HttpError) {
    return error.status >= 500;
  }
  // Network errors (fetch, DNS, ECONNREFUSED...) are retryable
  if (error instanceof Error && /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/i.test(error.message)) {
    return true;
  }
  return false;
}

/**
 * Retry an idempotent operation with backoff.
 *
 * @example
 * ```ts
 * const data = await retry(
 *   () => fetch("https://api.example.com/data").then((r) => r.json()),
 *   { attempts: 3, backoff: "exponential", delayMs: 50 },
 * );
 * ```
 */
export async function retry<T>(
  fn: () => T | Promise<T>,
  options: ErrorRetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;
  const delayMs = options.delayMs ?? 100;
  const backoff = options.backoff ?? "exponential";
  const maxDelayMs = options.maxDelayMs ?? 10_000;
  const jitter = options.jitter;

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isLast = attempt === attempts - 1;
      if (isLast || !shouldRetry(error, attempt)) {
        throw error;
      }
      await options.onRetry?.(error, attempt + 1);
      const delay = computeBackoff(attempt, { backoff, delayMs, maxDelayMs, jitter });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

// ============================================================================
// Convenience exports
// ============================================================================

/**
 * Run a function inside a fresh error boundary context — returns either the
 * result or a structured {@link ErrorResponseBody} (programmatic use).
 */
export async function tryCatch<T>(
  fn: () => T | Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: ClassifiedError }> {
  try {
    return { ok: true as const, value: await fn() };
  } catch (error) {
    return { ok: false as const, error: classifyError(error) };
  }
}
