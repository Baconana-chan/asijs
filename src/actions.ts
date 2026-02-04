/**
 * Server Functions / Server Actions
 * 
 * Next.js / Remix-style server actions for AsiJS.
 * Write functions on the server, call them from the client with full type safety.
 * 
 * @example
 * ```ts
 * // Define actions
 * const actions = {
 *   createUser: action(
 *     Type.Object({ name: Type.String(), email: Type.String() }),
 *     async (input) => {
 *       const user = await db.users.create(input);
 *       return user;
 *     }
 *   ),
 *   deleteUser: action(
 *     Type.Object({ id: Type.Number() }),
 *     async ({ id }) => {
 *       await db.users.delete(id);
 *       return { success: true };
 *     }
 *   ),
 * };
 * 
 * // Register with app
 * const client = registerActions(app, actions, { prefix: "/actions" });
 * 
 * // Call from client (type-safe!)
 * const user = await client.createUser({ name: "John", email: "john@example.com" });
 * ```
 */

import { Type, type TSchema, type Static } from "@sinclair/typebox";
import { TypeCompiler, type TypeCheck } from "@sinclair/typebox/compiler";
import type { Asi } from "./asi";
import type { Context } from "./context";

// ===== Types =====

/**
 * Server action definition
 */
export interface ServerAction<TInput extends TSchema, TOutput> {
  __isAction: true;
  name: string;
  inputSchema: TInput;
  handler: (input: Static<TInput>, ctx: Context) => Promise<TOutput>;
  compiledValidator?: TypeCheck<TInput>;
  middleware?: ActionMiddleware[];
}

/**
 * Action middleware
 */
export type ActionMiddleware = (
  ctx: Context,
  input: unknown,
  next: () => Promise<unknown>
) => Promise<unknown>;

/**
 * Action options
 */
export interface ActionOptions {
  /** Action name (auto-generated if not provided) */
  name?: string;
  /** Middleware to run before the action */
  middleware?: ActionMiddleware[];
}

/**
 * Actions registry type
 */
export type ActionsRegistry = Record<string, ServerAction<any, any>>;

/**
 * Client type for actions (inferred from registry)
 */
export type ActionsClient<T extends ActionsRegistry> = {
  [K in keyof T]: T[K] extends ServerAction<infer TInput, infer TOutput>
    ? (input: Static<TInput>) => Promise<TOutput>
    : never;
};

/**
 * Register actions options
 */
export interface RegisterActionsOptions {
  /** URL prefix for action endpoints (default: "/actions") */
  prefix?: string;
  /** Base URL for client (default: inferred from app) */
  baseUrl?: string;
  /** Add CSRF protection */
  csrf?: boolean;
  /** Custom error handler */
  onError?: (error: Error, actionName: string, ctx: Context) => Response | Promise<Response>;
}

// ===== Action Creator =====

/**
 * Create a server action with input validation
 * 
 * @example
 * ```ts
 * const createUser = action(
 *   Type.Object({ name: Type.String() }),
 *   async (input) => {
 *     return { id: 1, name: input.name };
 *   }
 * );
 * ```
 */
export function action<TInput extends TSchema, TOutput>(
  inputSchema: TInput,
  handler: (input: Static<TInput>, ctx: Context) => Promise<TOutput>,
  options?: ActionOptions
): ServerAction<TInput, TOutput> {
  return {
    __isAction: true,
    name: options?.name || "",
    inputSchema,
    handler,
    middleware: options?.middleware,
  };
}

/**
 * Create an action without input validation (for simple actions)
 */
export function simpleAction<TOutput>(
  handler: (ctx: Context) => Promise<TOutput>,
  options?: Omit<ActionOptions, "name"> & { name?: string }
): ServerAction<typeof Type.Object, TOutput> {
  return {
    __isAction: true,
    name: options?.name || "",
    inputSchema: Type.Object({}),
    handler: async (_input, ctx) => handler(ctx),
    middleware: options?.middleware,
  };
}

/**
 * Create action with middleware
 */
export function actionWithMiddleware<TInput extends TSchema, TOutput>(
  middleware: ActionMiddleware[],
  inputSchema: TInput,
  handler: (input: Static<TInput>, ctx: Context) => Promise<TOutput>
): ServerAction<TInput, TOutput> {
  return action(inputSchema, handler, { middleware });
}

// ===== Built-in Middleware =====

/**
 * Require authentication middleware
 */
export function requireAuth(
  getUser: (ctx: Context) => unknown | Promise<unknown>
): ActionMiddleware {
  return async (ctx, input, next) => {
    const user = await getUser(ctx);
    if (!user) {
      throw new ActionError("Unauthorized", "UNAUTHORIZED", 401);
    }
    (ctx as any).user = user;
    return next();
  };
}

/**
 * Rate limit middleware for actions
 */
export function actionRateLimit(
  limit: number,
  windowMs: number = 60000
): ActionMiddleware {
  const requests = new Map<string, { count: number; resetAt: number }>();

  return async (ctx, input, next) => {
    const key = ctx.header("x-forwarded-for") || ctx.header("x-real-ip") || "unknown";
    const now = Date.now();
    
    let record = requests.get(key);
    if (!record || now > record.resetAt) {
      record = { count: 0, resetAt: now + windowMs };
      requests.set(key, record);
    }
    
    record.count++;
    if (record.count > limit) {
      throw new ActionError("Too many requests", "RATE_LIMIT", 429);
    }
    
    return next();
  };
}

/**
 * Logging middleware for actions
 */
export function actionLogger(
  log: (info: { action: string; duration: number; success: boolean; error?: Error }) => void = console.log as any
): ActionMiddleware {
  return async (ctx, input, next) => {
    const start = performance.now();
    let success = true;
    let error: Error | undefined;
    
    try {
      return await next();
    } catch (e) {
      success = false;
      error = e as Error;
      throw e;
    } finally {
      const duration = performance.now() - start;
      log({ action: (ctx as any).__actionName || "unknown", duration, success, error });
    }
  };
}

// ===== Action Error =====

/**
 * Custom error for actions with code and status
 */
export class ActionError extends Error {
  code: string;
  status: number;
  details?: unknown;

  constructor(message: string, code: string = "ACTION_ERROR", status: number = 400, details?: unknown) {
    super(message);
    this.name = "ActionError";
    this.code = code;
    this.status = status;
    this.details = details;
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      details: this.details,
    };
  }
}

// ===== Register Actions =====

/**
 * Register actions with an Asi app and get a typed client
 * 
 * @example
 * ```ts
 * const actions = {
 *   createUser: action(UserSchema, async (input) => { ... }),
 *   deleteUser: action(DeleteSchema, async (input) => { ... }),
 * };
 * 
 * const client = registerActions(app, actions);
 * 
 * // Use client
 * const user = await client.createUser({ name: "John" });
 * ```
 */
export function registerActions<T extends ActionsRegistry>(
  app: Asi,
  actions: T,
  options: RegisterActionsOptions = {}
): ActionsClient<T> {
  const { 
    prefix = "/actions",
    baseUrl,
    onError,
  } = options;

  // Compile validators
  const compiledActions = new Map<string, {
    action: ServerAction<any, any>;
    validator: TypeCheck<any>;
  }>();

  for (const [name, actionDef] of Object.entries(actions)) {
    if (!actionDef.__isAction) {
      throw new Error(`Invalid action: ${name}. Use action() to create actions.`);
    }

    // Set action name
    actionDef.name = name;

    // Compile validator
    const validator = TypeCompiler.Compile(actionDef.inputSchema);
    compiledActions.set(name, { action: actionDef, validator });

    // Register POST endpoint
    const path = `${prefix}/${name}`;
    
    app.post(path, async (ctx) => {
      try {
        // Parse input
        let input: unknown;
        try {
          input = await ctx.json();
        } catch {
          input = {};
        }

        // Validate input
        if (!validator.Check(input)) {
          const errors = [...validator.Errors(input)].map(e => ({
            path: e.path,
            message: e.message,
          }));
          throw new ActionError("Validation failed", "VALIDATION_ERROR", 400, errors);
        }

        // Set action name for middleware
        (ctx as any).__actionName = name;

        // Run middleware chain
        const runMiddleware = async (
          middlewares: ActionMiddleware[],
          index: number
        ): Promise<unknown> => {
          if (index >= middlewares.length) {
            // Execute handler
            return actionDef.handler(input, ctx);
          }
          
          return middlewares[index](ctx, input, () => runMiddleware(middlewares, index + 1));
        };

        const middlewares = actionDef.middleware || [];
        const result = await runMiddleware(middlewares, 0);

        return ctx.jsonResponse({
          success: true,
          data: result,
        });
      } catch (error) {
        if (onError) {
          return onError(error as Error, name, ctx);
        }

        if (error instanceof ActionError) {
          return ctx.status(error.status).jsonResponse(error.toJSON());
        }

        console.error(`Action ${name} error:`, error);
        return ctx.status(500).jsonResponse({
          error: "Internal server error",
          code: "INTERNAL_ERROR",
        });
      }
    });
  }

  // Create client
  const client = createActionsClient<T>(
    baseUrl || "",
    prefix,
    Object.keys(actions)
  );

  return client;
}

/**
 * Create a typed client for actions
 */
export function createActionsClient<T extends ActionsRegistry>(
  baseUrl: string,
  prefix: string,
  actionNames: string[]
): ActionsClient<T> {
  const client: any = {};

  for (const name of actionNames) {
    client[name] = async (input: unknown) => {
      const url = `${baseUrl}${prefix}/${name}`;
      
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        const error = new ActionError(
          result.error || "Action failed",
          result.code || "ACTION_FAILED",
          response.status,
          result.details
        );
        throw error;
      }

      return result.data;
    };
  }

  return client as ActionsClient<T>;
}

// ===== Actions Plugin =====

/**
 * Actions plugin options
 */
export interface ActionsPluginOptions<T extends ActionsRegistry> {
  /** Actions registry */
  actions: T;
  /** URL prefix (default: "/actions") */
  prefix?: string;
  /** Global middleware for all actions */
  middleware?: ActionMiddleware[];
  /** Error handler */
  onError?: (error: Error, actionName: string, ctx: Context) => Response | Promise<Response>;
}

/**
 * Create actions plugin
 * 
 * @example
 * ```ts
 * const { plugin, client } = actionsPlugin({
 *   actions: {
 *     createUser: action(UserSchema, async (input) => { ... }),
 *   },
 * });
 * 
 * app.plugin(plugin);
 * 
 * // Use client
 * const user = await client.createUser({ name: "John" });
 * ```
 */
export function actionsPlugin<T extends ActionsRegistry>(
  options: ActionsPluginOptions<T>
): { plugin: (app: Asi) => void; client: ActionsClient<T> } {
  let client: ActionsClient<T>;

  const plugin = (app: Asi) => {
    // Apply global middleware to all actions
    if (options.middleware) {
      for (const actionDef of Object.values(options.actions)) {
        actionDef.middleware = [
          ...(options.middleware || []),
          ...(actionDef.middleware || []),
        ];
      }
    }

    client = registerActions(app, options.actions, {
      prefix: options.prefix,
      onError: options.onError,
    });
  };

  // Create placeholder client
  const placeholderClient = createActionsClient<T>(
    "",
    options.prefix || "/actions",
    Object.keys(options.actions)
  );

  return { plugin, client: placeholderClient };
}

// ===== Batch Actions =====

/**
 * Batch multiple action calls into a single request
 */
export interface BatchActionCall {
  action: string;
  input: unknown;
}

export interface BatchActionResult {
  action: string;
  success: boolean;
  data?: unknown;
  error?: string;
  code?: string;
}

/**
 * Register batch endpoint for actions
 */
export function registerBatchActions(
  app: Asi,
  actions: ActionsRegistry,
  options: { prefix?: string } = {}
): void {
  const prefix = options.prefix || "/actions";

  app.post(`${prefix}/__batch`, async (ctx) => {
    const calls = await ctx.json<BatchActionCall[]>();

    if (!Array.isArray(calls)) {
      return ctx.status(400).jsonResponse({
        error: "Expected array of action calls",
      });
    }

    const results: BatchActionResult[] = [];

    for (const call of calls) {
      const actionDef = actions[call.action];

      if (!actionDef) {
        results.push({
          action: call.action,
          success: false,
          error: `Unknown action: ${call.action}`,
          code: "UNKNOWN_ACTION",
        });
        continue;
      }

      try {
        // Validate
        if (!actionDef.compiledValidator) {
          actionDef.compiledValidator = TypeCompiler.Compile(actionDef.inputSchema);
        }

        if (!actionDef.compiledValidator.Check(call.input)) {
          results.push({
            action: call.action,
            success: false,
            error: "Validation failed",
            code: "VALIDATION_ERROR",
          });
          continue;
        }

        // Execute
        const data = await actionDef.handler(call.input, ctx);
        results.push({
          action: call.action,
          success: true,
          data,
        });
      } catch (error) {
        results.push({
          action: call.action,
          success: false,
          error: (error as Error).message,
          code: error instanceof ActionError ? error.code : "ACTION_ERROR",
        });
      }
    }

    return ctx.jsonResponse({ results });
  });
}

// ===== Form Action Helper =====

/**
 * Create a form-compatible action (for traditional form submissions)
 */
export function formAction<TInput extends TSchema, TOutput>(
  inputSchema: TInput,
  handler: (input: Static<TInput>, ctx: Context) => Promise<TOutput>,
  options?: ActionOptions & { 
    redirectOnSuccess?: string;
    redirectOnError?: string;
  }
): ServerAction<TInput, TOutput> & { formHandler: (ctx: Context) => Promise<Response> } {
  const act = action(inputSchema, handler, options);

  const formHandler = async (ctx: Context): Promise<Response> => {
    try {
      const formData = await ctx.formData();
      const input: Record<string, unknown> = {};

      for (const [key, value] of formData.entries()) {
        if (value instanceof File) {
          input[key] = value;
        } else {
          // Try to parse as JSON for complex types
          try {
            input[key] = JSON.parse(value);
          } catch {
            input[key] = value;
          }
        }
      }

      const validator = TypeCompiler.Compile(inputSchema);
      if (!validator.Check(input)) {
        if (options?.redirectOnError) {
          return ctx.redirect(`${options.redirectOnError}?error=validation`);
        }
        return ctx.status(400).jsonResponse({ error: "Validation failed" });
      }

      await handler(input as Static<TInput>, ctx);

      if (options?.redirectOnSuccess) {
        return ctx.redirect(options.redirectOnSuccess);
      }

      return ctx.redirect(ctx.header("referer") || "/");
    } catch (error) {
      if (options?.redirectOnError) {
        return ctx.redirect(`${options.redirectOnError}?error=${encodeURIComponent((error as Error).message)}`);
      }
      throw error;
    }
  };

  return { ...act, formHandler };
}

// ===== Type Inference Helpers =====

/**
 * Infer input type from action
 */
export type InferActionInput<T> = T extends ServerAction<infer TInput, any>
  ? Static<TInput>
  : never;

/**
 * Infer output type from action
 */
export type InferActionOutput<T> = T extends ServerAction<any, infer TOutput>
  ? TOutput
  : never;

/**
 * Infer all action types from registry
 */
export type InferActions<T extends ActionsRegistry> = {
  [K in keyof T]: {
    input: InferActionInput<T[K]>;
    output: InferActionOutput<T[K]>;
  };
};
