/**
 * RPC 2.0 — Server Actions + Auto Treaty Generation
 *
 * Type-safe RPC with automatic treaty client generation.
 * Define actions once, get typed callable APIs on both server and client.
 *
 * @example
 * ```ts
 * // ===== Server =====
 * import { serverAction, rpc } from "asijs";
 * import { Type } from "@sinclair/typebox";
 *
 * const app = new Asi();
 *
 * const api = rpc(app, {
 *   greet: serverAction(
 *     Type.Object({ name: Type.String() }),
 *     async ({ name }, ctx) => ({ message: `Hello, ${name}!` }),
 *   ),
 * });
 *
 * // Server-side direct call (no HTTP)
 * const result = await api.greet({ name: "World" });
 *
 * // Export type for client
 * export type AppRPC = typeof api;
 * ```
 *
 * @example
 * ```ts
 * // ===== Client =====
 * import { createRPCClient } from "asijs/client";
 * import type { AppRPC } from "./server";
 *
 * const api = createRPCClient<AppRPC>("http://localhost:3000");
 *
 * // Fully type-safe!
 * const result = await api.greet({ name: "World" });
 * // result is typed as { message: string }
 * ```
 */

import { type TSchema, type Static } from "@sinclair/typebox";
import { TypeCompiler, type TypeCheck } from "@sinclair/typebox/compiler";
import type { Asi } from "./asi";
import { Context } from "./context";

// ========================================================================
// Types
// ========================================================================

/**
 * Server Action 2.0 definition (RPC variant — distinct from actions.ts ServerAction).
 *
 * Branded type for type-safe RPC with automatic client inference.
 */
export interface RPCServerAction<TInput = unknown, TOutput = unknown> {
  /** Brand marker for type inference */
  readonly __isServerAction: true;
  /** Phantom input type */
  readonly _input: TInput;
  /** Phantom output type */
  readonly _output: TOutput;
  /** Input validation schema */
  readonly schema: TSchema;
  /** Handler function */
  readonly handler: (input: TInput, ctx: Context) => Promise<TOutput>;
  /** Action name (set at registration) */
  name?: string;
}

/**
 * Action registry type — map of action name to ServerAction
 */
export type RPCRegistry = Record<string, RPCServerAction<any, any>>;

/**
 * Infer the typed client from an RPC registry.
 *
 * Actions with empty objects as input get a no-arg call signature.
 */
export type RPCClient<T extends RPCRegistry> = {
  [K in keyof T]: T[K] extends RPCServerAction<infer TInput, infer TOutput>
    ? IsEmptyObject<TInput> extends true
      ? () => Promise<TOutput>
      : (input: TInput) => Promise<TOutput>
    : never;
};

/**
 * Helper to check if a type is an empty object `{}` or `Record<string, never>`.
 */
type IsEmptyObject<T> = keyof T extends never ? true : false;

/**
 * Options for the rpc() function
 */
export interface RPCOptions {
  /** URL prefix for action endpoints (default: "/rpc") */
  prefix?: string;
  /**
   * Custom error handler returning a Response.
   * If not provided, errors are returned as JSON.
   */
  onError?: (
    error: Error,
    actionName: string,
  ) => Response | Promise<Response>;
}

/**
 * Options for createRPCClient
 */
export interface RPCClientOptions {
  /** URL prefix matching the server (default: "/rpc") */
  prefix?: string;
  /** Custom fetch implementation (for testing) */
  fetch?: typeof globalThis.fetch;
  /** Default headers */
  headers?: HeadersInit;
}

// ========================================================================
// Server Action Creator
// ========================================================================

/**
 * Create a type-safe server action (RPC 2.0).
 *
 * Works both server-side (direct call via `rpc()`) and client-side
 * (type-safe fetch via `createRPCClient`).
 *
 * @param schema - TypeBox schema for input validation
 * @param handler - Handler function receiving validated input and request context
 *
 * @example
 * ```ts
 * const greet = serverAction(
 *   Type.Object({ name: Type.String() }),
 *   async ({ name }, ctx) => {
 *     return { message: `Hello, ${name}!` };
 *   },
 * );
 * ```
 */
export function serverAction<TInput extends TSchema, TOutput>(
  schema: TInput,
  handler: (
    input: Static<TInput>,
    ctx: Context,
  ) => Promise<TOutput>,
): RPCServerAction<Static<TInput>, TOutput> {
  return {
    __isServerAction: true,
    _input: undefined as unknown as Static<TInput>,
    _output: undefined as unknown as TOutput,
    schema,
    handler: handler as (input: unknown, ctx: Context) => Promise<unknown>,
    name: undefined,
  } as RPCServerAction<Static<TInput>, TOutput>;
}

// ========================================================================
// Register Actions & Get Typed API
// ========================================================================

/**
 * Register RPC actions with an Asi app and return a typed callable API.
 *
 * On the server, the returned functions call handlers directly (no HTTP).
 * On the client, use `createRPCClient<typeof api>()` for type-safe fetch.
 *
 * The returned object's type can be exported and used on the client side
 * for automatic treaty generation — this is the "auto treaty" part.
 *
 * @param app - Asi application instance
 * @param actions - Object mapping action names to serverAction() results
 * @param options - Optional prefix and error handler
 *
 * @example
 * ```ts
 * const api = rpc(app, {
 *   greet: serverAction(
 *     Type.Object({ name: Type.String() }),
 *     async ({ name }) => ({ message: `Hello ${name}!` }),
 *   ),
 * });
 *
 * // Server-side direct call
 * const result = await api.greet({ name: "World" });
 *
 * // Export for client
 * export type AppAPI = typeof api;
 * ```
 */
export function rpc<T extends RPCRegistry>(
  app: Asi,
  actions: T,
  options: RPCOptions = {},
): RPCClient<T> {
  const prefix = options.prefix ?? "/rpc";

  // Compile validators once
  const validators = new Map<string, TypeCheck<any>>();

  // Validate actions and register POST endpoints
  for (const [name, actionDef] of Object.entries(actions)) {
    if (!actionDef || typeof actionDef !== "object" || !actionDef.__isServerAction) {
      throw new Error(
        `[RPC] Invalid action "${name}". ` +
          "All actions must be created with serverAction(). " +
          `Got: ${typeof actionDef}`,
      );
    }

    const validator = TypeCompiler.Compile(actionDef.schema);
    validators.set(name, validator);
    actionDef.name = name;

    // Register POST endpoint: /rpc/{actionName}
    app.post(`${prefix}/${name}`, async (ctx) => {
      try {
        // Parse body (support empty body)
        let input: unknown = {};
        try {
          input = await ctx.json();
        } catch {
          // Empty or non-JSON body — keep as {}
        }

        // Validate input
        if (!validator.Check(input)) {
          const errors = [...validator.Errors(input)].map((e) => ({
            path: e.path,
            message: e.message,
          }));

          return ctx.status(400).jsonResponse({
            success: false,
            error: "Validation failed",
            details: errors,
          });
        }

        // Execute handler
        const data = await actionDef.handler(input, ctx);

        return ctx.jsonResponse({ success: true, data });
      } catch (error) {
        if (options.onError) {
          return options.onError(error as Error, name);
        }

        // Default error handling
        if (error instanceof RPCActionError) {
          return ctx.status(400).jsonResponse({
            success: false,
            error: error.message,
            code: error.code,
            details: error.details,
          });
        }

        console.error(`[RPC] "${name}" error:`, error);
        return ctx.status(500).jsonResponse({
          success: false,
          error: error instanceof Error ? error.message : "Internal server error",
        });
      }
    });
  }

  // Build server-side direct-call API
  const client = buildServerClient<T>(actions, validators);

  return client;
}

/**
 * Build the server-side direct-call client.
 * Each action function calls the handler directly with a minimal context.
 */
function buildServerClient<T extends RPCRegistry>(
  actions: T,
  validators: Map<string, TypeCheck<any>>,
): RPCClient<T> {
  const client: Record<string, (...args: unknown[]) => Promise<unknown>> = {};

  for (const [name, actionDef] of Object.entries(actions)) {
    const validator = validators.get(name)!;

    client[name] = async (...args: unknown[]) => {
      const input = args[0] ?? {};

      // Validate
      if (!validator.Check(input)) {
        const errors = [...validator.Errors(input)].map((e) => ({
          path: e.path,
          message: e.message,
        }));

        throw new RPCActionError(
          "Validation failed",
          "VALIDATION_ERROR",
          errors,
        );
      }

      // Execute with a minimal context
      const ctx = new Context(new Request(`http://localhost/_rpc/${name}`));
      return actionDef.handler(input, ctx);
    };
  }

  return client as RPCClient<T>;
}

// ========================================================================
// Client-Side RPC Client (Auto Treaty)
// ========================================================================

/**
 * Create a type-safe RPC client for client-side use.
 *
 * This is the "auto treaty generation" part — pass the exported `typeof api`
 * from the server, and get a fully typed fetch-based client.
 *
 * The type parameter `T` should be the exported API type from the server:
 * ```
 * export type AppRPC = typeof api;
 * const client = createRPCClient<AppRPC>("http://localhost:3000");
 * ```
 *
 * `T` is expected to be a record mapping action names to callable functions,
 * e.g. `{ greet: (input: { name: string }) => Promise<{ message: string }> }`.
 * No constraint is placed on `T` since it's the *result* type, not the registry.
 *
 * Works in browsers and any JS runtime with `fetch`.
 *
 * @param baseUrl - Base URL of the server (e.g. "http://localhost:3000")
 * @param options - Optional prefix and fetch config
 *
 * @example
 * ```ts
 * import { createRPCClient } from "asijs/client";
 * import type { AppAPI } from "./server";
 *
 * const api = createRPCClient<AppAPI>("http://localhost:3000");
 *
 * // Fully type-safe!
 * const result = await api.greet({ name: "World" });
 * ```
 */
export function createRPCClient<T = Record<string, (...args: any[]) => Promise<any>>>(
  baseUrl: string,
  options: RPCClientOptions = {},
): T {
  const prefix = options.prefix ?? "/rpc";
  const fetchFn = options.fetch ?? globalThis.fetch;
  const defaultHeaders = new Headers(options.headers);

  if (!defaultHeaders.has("Content-Type")) {
    defaultHeaders.set("Content-Type", "application/json");
  }

  return new Proxy({} as object, {
    get(_, prop: string | symbol) {
      if (typeof prop === "symbol" || prop === "then" || prop === "catch") {
        return undefined;
      }

      return async (input: unknown = {}) => {
        const normalizedBase = baseUrl.replace(/\/$/, "");
        const url = `${normalizedBase}${prefix}/${prop}`;

        const response = await fetchFn(url, {
          method: "POST",
          headers: defaultHeaders,
          body: JSON.stringify(input),
        });

        const result = await response.json();

        if (!response.ok || result?.success === false) {
          throw new RPCActionError(
            result?.error || "RPC request failed",
            result?.code || "RPC_FAILED",
            result?.details,
          );
        }

        return result.data;
      };
    },
  }) as T;
}

// ========================================================================
// Error Types
// ========================================================================

/**
 * RPC-specific error with code and optional details.
 */
export class RPCActionError extends Error {
  code: string;
  details?: unknown;

  constructor(message: string, code = "RPC_ERROR", details?: unknown) {
    super(message);
    this.name = "RPCActionError";
    this.code = code;
    this.details = details;
  }

  toJSON(): Record<string, unknown> {
    return {
      error: this.message,
      code: this.code,
      details: this.details,
    };
  }
}

// ========================================================================
// Type Inference Helpers
// ========================================================================

/**
 * Infer the output type from a server action
 *
 * @example
 * ```ts
 * type GreetOutput = InferRPCOutput<typeof greet>;
 * // { message: string }
 * ```
 */
export type InferRPCOutput<T> = T extends RPCServerAction<any, infer TOutput>
  ? TOutput
  : never;

/**
 * Infer the input type from a server action
 *
 * @example
 * ```ts
 * type GreetInput = InferRPCInput<typeof greet>;
 * // { name: string }
 * ```
 */
export type InferRPCInput<T> = T extends RPCServerAction<infer TInput, any>
  ? TInput
  : never;

/**
 * Infer the full RPC API type (input/output map) from a registry
 *
 * @example
 * ```ts
 * type API = InferRPCAPI<typeof api>;
 * // { greet: { input: { name: string }, output: { message: string } } }
 * ```
 */
export type InferRPCAPI<T extends RPCRegistry> = {
  [K in keyof T]: T[K] extends RPCServerAction<infer TInput, infer TOutput>
    ? { input: TInput; output: TOutput }
    : never;
};
