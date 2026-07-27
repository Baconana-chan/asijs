/**
 * Circuit Breaker & Resilience for AsiJS
 *
 * Implements the circuit breaker pattern for external API calls:
 *
 * - **CLOSED**: normal operation, requests pass through
 * - **OPEN**: error threshold exceeded, requests are rejected immediately
 * - **HALF_OPEN**: recovery timeout elapsed, probe request allowed
 *
 * @example
 * ```ts
 * import { Asi, circuitBreaker } from "asijs";
 * import { healthCheck } from "asijs";
 *
 * const app = new Asi();
 *
 * // Register circuit breaker middleware
 * app.use(circuitBreaker({
 *   name: "stripe-api",
 *   threshold: 5,
 *   windowMs: 60_000,
 *   recoveryTimeout: 30_000,
 *   timeout: 5000,
 * }));
 *
 * // Use in a handler
 * app.get("/api/charges", async (ctx) => {
 *   const result = await ctx.circuitBreaker!("stripe-api", async () => {
 *     const res = await fetch("https://api.stripe.com/charges");
 *     return res.json();
 *   });
 *   return { data: result };
 * });
 *
 * // Healthcheck integration
 * const registry = getCircuitBreakerRegistry();
 * app.use(healthCheck({
 *   checks: registry.getHealthChecks(),
 * }));
 * ```
 */

import type { Middleware } from "./types";
import type { Context } from "./context";
import type { HealthCheckFn, HealthCheckResult } from "./health";

// ============================================================================
// Types
// ============================================================================

/** Circuit breaker state */
export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

/** Options for creating a circuit breaker */
export interface CircuitBreakerOptions {
  /** Unique name for this circuit breaker (used in metrics and healthchecks) */
  name: string;

  /**
   * Number of failures within the window to trip the breaker.
   * @default 5
   */
  threshold?: number;

  /**
   * Sliding window for counting failures (milliseconds).
   * @default 60_000 (1 minute)
   */
  windowMs?: number;

  /**
   * Time to wait before transitioning from OPEN to HALF_OPEN (milliseconds).
   * @default 30_000 (30 seconds)
   */
  recoveryTimeout?: number;

  /**
   * Per-request timeout (milliseconds). Requests exceeding this are counted as failures.
   * @default 10_000 (10 seconds)
   */
  timeout?: number;

  /**
   * Fallback function to call when the circuit is OPEN.
   * Allows returning a degraded response instead of throwing.
   */
  fallback?: <T>(name: string) => T | Promise<T>;

  /**
   * Custom error filter — return true to count the error as a failure.
   * Default: counts all errors as failures.
   */
  shouldTrip?: (error: unknown) => boolean;

  /**
   * Optional callback when state changes.
   */
  onStateChange?: (name: string, from: CircuitState, to: CircuitState, metrics: CircuitBreakerMetrics) => void;

  /**
   * Optional custom registry. If not provided, uses the global singleton.
   */
  registry?: CircuitBreakerRegistry;
}

/** Snapshot of circuit breaker metrics */
export interface CircuitBreakerMetrics {
  /** Current state */
  state: CircuitState;
  /** Total successful calls */
  successCount: number;
  /** Total failed calls */
  failureCount: number;
  /** Total rejected calls (circuit was OPEN) */
  rejectCount: number;
  /** Number of successful recoveries (HALF_OPEN → CLOSED) */
  recoveryCount: number;
  /** Total calls (success + failure + reject) */
  totalCount: number;
  /** Timestamp of last failure (ms), or null */
  lastFailure: number | null;
  /** Timestamp of last success (ms), or null */
  lastSuccess: number | null;
  /** Timestamp when circuit opened (ms), or null */
  openSince: number | null;
  /** Time until next recovery attempt (ms), or 0 if closed */
  timeUntilRecovery: number;
  /** Current threshold */
  threshold: number;
  /** Sliding window size (ms) */
  windowMs: number;
  /** Remaining errors allowed before tripping */
  remainingThreshold: number;
}

/** Result of calling through a circuit breaker */
export type CircuitResult<T> =
  | { success: true; data: T }
  | { success: false; error: Error; state: CircuitState };

// ============================================================================
// Circuit Breaker Error
// ============================================================================

/**
 * Error thrown when a circuit breaker rejects a request.
 */
export class CircuitBreakerError extends Error {
  /** The name of the circuit breaker that rejected the request */
  readonly breakerName: string;
  /** The state of the circuit when the error was thrown */
  readonly circuitState: CircuitState;

  constructor(breakerName: string, message?: string) {
    super(message ?? `Circuit breaker "${breakerName}" is OPEN — request rejected`);
    this.name = "CircuitBreakerError";
    this.breakerName = breakerName;
    this.circuitState = "OPEN";
  }
}

// ============================================================================
// Timeout helper
// ============================================================================

function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  name: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new CircuitBreakerError(name, `Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    fn()
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

// ============================================================================
// Individual Circuit Breaker
// ============================================================================

/**
 * A single named circuit breaker.
 *
 * Tracks failures in a sliding window and transitions between
 * CLOSED, OPEN, and HALF_OPEN states.
 */
export class CircuitBreaker {
  private _state: CircuitState = "CLOSED";
  private _successCount = 0;
  private _failureCount = 0;
  private _rejectCount = 0;
  private _recoveryCount = 0;
  private _totalCount = 0;
  private _lastFailure: number | null = null;
  private _lastSuccess: number | null = null;
  private _openSince: number | null = null;
  private _errorTimestamps: number[] = [];
  private _mutex: Promise<void> = Promise.resolve();
  private _options: {
    name: string;
    threshold: number;
    windowMs: number;
    recoveryTimeout: number;
    timeout: number;
    fallback?: <T>(name: string) => T | Promise<T>;
    shouldTrip: (error: unknown) => boolean;
    onStateChange: (name: string, from: CircuitState, to: CircuitState, metrics: CircuitBreakerMetrics) => void;
  };

  constructor(private readonly _name: string, options?: CircuitBreakerOptions) {
    this._options = {
      name: _name,
      threshold: options?.threshold ?? 5,
      windowMs: options?.windowMs ?? 60_000,
      recoveryTimeout: options?.recoveryTimeout ?? 30_000,
      timeout: options?.timeout ?? 10_000,
      fallback: options?.fallback,
      shouldTrip: options?.shouldTrip ?? (() => true),
      onStateChange: options?.onStateChange ?? (() => {}),
    };
  }

  /** The name of this circuit breaker */
  get name(): string {
    return this._name;
  }

  /**
   * Get current state with auto-recovery transition.
   * Auto-transitions OPEN → HALF_OPEN when recovery timeout elapses.
   *
   * Note: In single-threaded JS, concurrent async calls may race on state
   * transitions. This is acceptable — the window is microscopic and the
   * worst case is an extra probe request in HALF_OPEN.
   */
  get state(): CircuitState {
    // Auto-transition from OPEN to HALF_OPEN when recovery timeout elapses
    if (this._state === "OPEN" && this._openSince !== null) {
      const elapsed = Date.now() - this._openSince;
      if (elapsed >= this._options.recoveryTimeout) {
        this._transition("HALF_OPEN");
      }
    }
    return this._state;
  }

  /**
   * Call a function through the circuit breaker.
   *
   * - CLOSED: executes the function normally
   * - OPEN: rejects immediately (or calls fallback if configured)
   * - HALF_OPEN: allows one probe through
   *
   * @returns The result of the function, or throws CircuitBreakerError
   */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = this.state;
    this._totalCount++;

    // OPEN state — reject or fallback
    if (currentState === "OPEN") {
      this._rejectCount++;
      if (this._options.fallback) {
        return (await this._options.fallback<T>(this._name)) as T;
      }
      throw new CircuitBreakerError(
        this._name,
        `Circuit breaker "${this._name}" is OPEN — request rejected after ${this._failureCount} failures`,
      );
    }

    // HALF_OPEN or CLOSED — try the request
    try {
      const result = await withTimeout(fn, this._options.timeout, this._name);
      this._onSuccess();
      return result;
    } catch (err) {
      if (this._options.shouldTrip(err)) {
        this._onFailure();
      } else {
        // Error didn't count toward threshold (e.g., 404 response)
        this._totalCount--; // Don't count non-trip errors
      }
      throw err;
    }
  }

  /**
   * Execute a function through the circuit breaker and return a structured result.
   * Never throws — returns { success: true, data } or { success: false, error }.
   */
  async callSafe<T>(fn: () => Promise<T>): Promise<CircuitResult<T>> {
    try {
      const data = await this.call(fn);
      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        state: this._state,
      };
    }
  }

  /**
   * Get current metrics snapshot.
   */
  getMetrics(): CircuitBreakerMetrics {
    const currentState = this.state;
    const remaining = Math.max(0, this._options.threshold - this._errorTimestamps.length);

    return {
      state: currentState,
      successCount: this._successCount,
      failureCount: this._failureCount,
      rejectCount: this._rejectCount,
      recoveryCount: this._recoveryCount,
      totalCount: this._totalCount,
      lastFailure: this._lastFailure,
      lastSuccess: this._lastSuccess,
      openSince: this._openSince,
      timeUntilRecovery:
        currentState === "OPEN" && this._openSince !== null
          ? Math.max(0, this._options.recoveryTimeout - (Date.now() - this._openSince))
          : 0,
      threshold: this._options.threshold,
      windowMs: this._options.windowMs,
      remainingThreshold: remaining,
    };
  }

  /**
   * Reset the circuit breaker to CLOSED state and clear all counters.
   */
  reset(): void {
    const oldState = this._state;
    this._state = "CLOSED";
    this._errorTimestamps = [];
    this._successCount = 0;
    this._failureCount = 0;
    this._rejectCount = 0;
    this._recoveryCount = 0;
    this._totalCount = 0;
    this._lastFailure = null;
    this._lastSuccess = null;
    this._openSince = null;
    if (oldState !== "CLOSED") {
      this._options.onStateChange(this._name, oldState, "CLOSED", this.getMetrics());
    }
  }

  /**
   * Force the circuit breaker into a specific state.
   */
  forceState(state: CircuitState): void {
    const oldState = this._state;
    this._state = state;
    if (state === "OPEN") {
      this._openSince = Date.now();
    } else if (state === "CLOSED") {
      this._openSince = null;
    }
    if (oldState !== state) {
      this._options.onStateChange(this._name, oldState, state, this.getMetrics());
    }
  }

  /**
   * Get a health check function for this breaker.
   * Returns healthy/degraded/unhealthy based on circuit state.
   */
  getHealthCheck(): HealthCheckFn {
    return () => {
      const metrics = this.getMetrics();
      const result: HealthCheckResult = {
        status: metrics.state === "CLOSED" ? "healthy" :
                metrics.state === "HALF_OPEN" ? "degraded" : "unhealthy",
        meta: {
          state: metrics.state,
          successCount: metrics.successCount,
          failureCount: metrics.failureCount,
          rejectCount: metrics.rejectCount,
          recoveryCount: metrics.recoveryCount,
          totalCount: metrics.totalCount,
          threshold: metrics.threshold,
          windowMs: metrics.windowMs,
          timeUntilRecovery: metrics.timeUntilRecovery,
        },
      };
      return result;
    };
  }

  /** Called when a request succeeds */
  private _onSuccess(): void {
    this._successCount++;
    this._lastSuccess = Date.now();

    if (this._state === "HALF_OPEN") {
      // Recovery successful — close the circuit
      const oldState = this._state;
      this._state = "CLOSED";
      this._recoveryCount++;
      this._errorTimestamps = [];
      this._openSince = null;
      this._options.onStateChange(this._name, oldState, "CLOSED", this.getMetrics());
    }
  }

  /** Called when a request fails */
  private _onFailure(): void {
    this._failureCount++;
    this._lastFailure = Date.now();
    this._errorTimestamps.push(Date.now());

    // Prune errors outside the sliding window
    const cutoff = Date.now() - this._options.windowMs;
    this._errorTimestamps = this._errorTimestamps.filter((t) => t > cutoff);

    if (this._state === "HALF_OPEN") {
      // Probe failed — back to OPEN
      const oldState = this._state;
      this._state = "OPEN";
      this._openSince = Date.now();
      this._options.onStateChange(this._name, oldState, "OPEN", this.getMetrics());
    } else if (this._state === "CLOSED" && this._errorTimestamps.length >= this._options.threshold) {
      // Threshold exceeded — open the circuit
      const oldState = this._state;
      this._state = "OPEN";
      this._openSince = Date.now();
      this._options.onStateChange(this._name, oldState, "OPEN", this.getMetrics());
    }
  }

  /** Transition to a new state */
  private _transition(newState: CircuitState): void {
    if (this._state === newState) return;
    const oldState = this._state;
    this._state = newState;
    if (newState === "OPEN") {
      this._openSince = Date.now();
    }
    this._options.onStateChange(this._name, oldState, newState, this.getMetrics());
  }
}

// ============================================================================
// Circuit Breaker Registry
// ============================================================================

/**
 * Manages multiple named circuit breakers.
 *
 * Provides a unified interface for calling through any registered breaker,
 * retrieving metrics, health checks, and resetting all breakers.
 */
export class CircuitBreakerRegistry {
  private _breakers = new Map<string, CircuitBreaker>();

  /**
   * Register a circuit breaker.
   * If a breaker with the same name already exists, it is not replaced.
   */
  register(name: string, breaker: CircuitBreaker): this {
    if (!this._breakers.has(name)) {
      this._breakers.set(name, breaker);
    }
    return this;
  }

  /**
   * Get a registered breaker by name.
   */
  get(name: string): CircuitBreaker | undefined {
    return this._breakers.get(name);
  }

  /**
   * Check if a breaker is registered.
   */
  has(name: string): boolean {
    return this._breakers.has(name);
  }

  /**
   * Call a function through a named breaker.
   *
   * @throws CircuitBreakerError if the circuit is OPEN (unless fallback is configured)
   * @throws Error if no breaker is registered with the given name
   */
  async call<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const breaker = this._breakers.get(name);
    if (!breaker) {
      throw new Error(`No circuit breaker registered with name "${name}"`);
    }
    return breaker.call(fn);
  }

  /**
   * Call a function through a named breaker, returning a safe result.
   */
  async callSafe<T>(name: string, fn: () => Promise<T>): Promise<CircuitResult<T>> {
    const breaker = this._breakers.get(name);
    if (!breaker) {
      return { success: false, error: new Error(`No circuit breaker "${name}"`), state: "CLOSED" };
    }
    return breaker.callSafe(fn);
  }

  /**
   * Get metrics for all registered breakers.
   */
  getAllMetrics(): Record<string, CircuitBreakerMetrics> {
    const result: Record<string, CircuitBreakerMetrics> = {};
    for (const [name, breaker] of this._breakers) {
      result[name] = breaker.getMetrics();
    }
    return result;
  }

  /**
   * Get health check functions for all registered breakers.
   * Suitable for passing to healthCheck({ checks }).
   *
   * @example
   * ```ts
   * const registry = getCircuitBreakerRegistry();
   * app.use(healthCheck({
   *   checks: registry.getHealthChecks(),
   * }));
   * ```
   */
  getHealthChecks(): Record<string, HealthCheckFn> {
    const result: Record<string, HealthCheckFn> = {};
    for (const [name, breaker] of this._breakers) {
      result[`cb:${name}`] = breaker.getHealthCheck();
    }
    return result;
  }

  /**
   * Reset all registered breakers to CLOSED state.
   */
  resetAll(): void {
    for (const breaker of this._breakers.values()) {
      breaker.reset();
    }
  }

  /**
   * Get the names of all registered breakers.
   */
  getNames(): string[] {
    return Array.from(this._breakers.keys());
  }

  /**
   * Remove a breaker by name.
   */
  remove(name: string): boolean {
    return this._breakers.delete(name);
  }

  /**
   * Get the total number of registered breakers.
   */
  get size(): number {
    return this._breakers.size;
  }
}

// ============================================================================
// Global Singleton Registry
// ============================================================================

let _globalRegistry: CircuitBreakerRegistry | null = null;

/**
 * Get the global circuit breaker registry (singleton).
 * Created lazily on first call.
 */
export function getCircuitBreakerRegistry(): CircuitBreakerRegistry {
  if (!_globalRegistry) {
    _globalRegistry = new CircuitBreakerRegistry();
  }
  return _globalRegistry;
}

/**
 * Reset the global registry (useful in tests).
 */
export function resetCircuitBreakerRegistry(): void {
  _globalRegistry = null;
}

// ============================================================================
// Circuit Breaker Middleware
// ============================================================================

/**
 * Circuit breaker middleware.
 *
 * Creates and registers a named circuit breaker, and adds the
 * `ctx.circuitBreaker(name, fn)` helper to the request context.
 *
 * @example
 * ```ts
 * // Register with defaults
 * app.use(circuitBreaker({ name: "stripe-api" }));
 *
 * // With full options
 * app.use(circuitBreaker({
 *   name: "github-api",
 *   threshold: 10,
 *   windowMs: 120_000,
 *   recoveryTimeout: 60_000,
 *   timeout: 5000,
 *   fallback: () => ({ cached: true }),
 * }));
 *
 * // Use in a handler
 * app.get("/data", async (ctx) => {
 *   const result = await ctx.circuitBreaker!("github-api", async () => {
 *     const res = await fetch("https://api.github.com/repos/owner/repo");
 *     if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
 *     return res.json();
 *   });
 *   return result;
 * });
 * ```
 */
export function circuitBreaker(options: CircuitBreakerOptions): Middleware {
  const registry = options.registry ?? getCircuitBreakerRegistry();

  // Create and register the breaker
  const breaker = new CircuitBreaker(options.name, {
    ...options,
    registry, // Pass registry reference for access
  });
  registry.register(options.name, breaker);

  // Return middleware that adds ctx.circuitBreaker
  return async (ctx: Context, next: () => Promise<Response>): Promise<Response> => {
    // Make circuitBreaker available on the context
    (ctx as any).circuitBreaker = <T>(name: string, fn: () => Promise<T>): Promise<T> => {
      return registry.call(name, fn);
    };

    // Store registry reference for middleware downstream
    ctx.store["__circuit_breaker_registry"] = registry;

    return next();
  };
}

// ============================================================================
// Preset: Common circuit breaker configurations
// ============================================================================

/** Preset: Circuit breaker for external HTTP APIs (5 failures, 30s recovery) */
export function apiCircuitBreaker(name: string, overrides?: Partial<CircuitBreakerOptions>): Middleware {
  return circuitBreaker({
    name,
    threshold: 5,
    windowMs: 60_000,
    recoveryTimeout: 30_000,
    timeout: 10_000,
    ...overrides,
  });
}

/** Preset: Circuit breaker for database calls (3 failures, 10s recovery) */
export function dbCircuitBreaker(name: string, overrides?: Partial<CircuitBreakerOptions>): Middleware {
  return circuitBreaker({
    name,
    threshold: 3,
    windowMs: 30_000,
    recoveryTimeout: 10_000,
    timeout: 30_000,
    ...overrides,
  });
}

/** Preset: Circuit breaker for critical infrastructure (2 failures, 60s recovery) */
export function criticalCircuitBreaker(name: string, overrides?: Partial<CircuitBreakerOptions>): Middleware {
  return circuitBreaker({
    name,
    threshold: 2,
    windowMs: 30_000,
    recoveryTimeout: 60_000,
    timeout: 5_000,
    ...overrides,
  });
}
