/**
 * Plugin System for AsiJS
 * 
 * Inspired by Elysia's plugin system but with simpler API.
 * 
 * @example
 * ```ts
 * import { Asi, createPlugin } from "asijs";
 * 
 * // Simple plugin
 * const myPlugin = createPlugin({
 *   name: "my-plugin",
 *   setup(app) {
 *     app.get("/plugin-route", () => "From plugin!");
 *   }
 * });
 * 
 * // Plugin with decorators
 * const authPlugin = createPlugin({
 *   name: "auth",
 *   decorate: {
 *     getUser: (ctx) => ctx.header("Authorization")?.split(" ")[1],
 *   },
 *   state: {
 *     users: new Map<string, { name: string }>(),
 *   },
 *   beforeHandle: async (ctx) => {
 *     // Check auth
 *   },
 * });
 * 
 * const app = new Asi();
 * app.plugin(myPlugin);
 * app.plugin(authPlugin);
 * ```
 */

import type { Middleware, BeforeHandler, AfterHandler } from "./types";
import type { Context } from "./context";

/** Plugin configuration */
export interface AsiPluginConfig<
  TDecorate extends Record<string, unknown> = Record<string, unknown>,
  TState extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Unique plugin name */
  name: string;
  
  /**
   * Setup function called when plugin is registered
   * Use this to add routes, middleware, etc.
   */
  setup?: (app: PluginHost) => void | Promise<void>;
  
  /**
   * Decorators to add to the Context
   * These become available as ctx.decorator on all requests
   */
  decorate?: TDecorate;
  
  /**
   * Shared state accessible via app.state
   * Persists across requests
   */
  state?: TState;
  
  /**
   * Global beforeHandle hooks to run before every request
   */
  beforeHandle?: BeforeHandler | BeforeHandler[];
  
  /**
   * Global afterHandle hooks to run after every request
   */
  afterHandle?: AfterHandler | AfterHandler[];
  
  /**
   * Middleware to add globally
   */
  middleware?: Middleware | Middleware[];
  
  /**
   * Plugin dependencies (other plugin names)
   */
  dependencies?: string[];
  
  /**
   * Plugin version
   */
  version?: string;
}

/** Interface for the app exposed to plugins */
export interface PluginHost {
  get(path: string, handler: (ctx: Context) => unknown, options?: unknown): PluginHost;
  post(path: string, handler: (ctx: Context) => unknown, options?: unknown): PluginHost;
  put(path: string, handler: (ctx: Context) => unknown, options?: unknown): PluginHost;
  delete(path: string, handler: (ctx: Context) => unknown, options?: unknown): PluginHost;
  patch(path: string, handler: (ctx: Context) => unknown, options?: unknown): PluginHost;
  all(path: string, handler: (ctx: Context) => unknown, options?: unknown): PluginHost;
  use(middleware: Middleware): PluginHost;
  use(path: string, middleware: Middleware): PluginHost;
  onBeforeHandle(handler: BeforeHandler): PluginHost;
  onAfterHandle(handler: AfterHandler): PluginHost;
  group(prefix: string, callback: (group: unknown) => void): PluginHost;
  
  /** Get shared state from the app */
  getState<T = unknown>(key: string): T | undefined;
  
  /** Set shared state on the app */
  setState<T = unknown>(key: string, value: T): void;
  
  /** Get decorator by name */
  getDecorator<T = unknown>(key: string): T | undefined;
}

/** Created plugin instance */
export interface AsiPlugin<
  TDecorate extends Record<string, unknown> = Record<string, unknown>,
  TState extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Plugin name */
  readonly name: string;
  /** Plugin configuration */
  readonly config: AsiPluginConfig<TDecorate, TState>;
  /** Apply plugin to app */
  apply(app: PluginHost, state: Map<string, unknown>, decorators: Map<string, unknown>): Promise<void>;
}

/**
 * Create a new plugin
 * 
 * @example
 * ```ts
 * const loggingPlugin = createPlugin({
 *   name: "logging",
 *   beforeHandle: (ctx) => {
 *     console.log(`${ctx.method} ${ctx.path}`);
 *   }
 * });
 * ```
 */
export function createPlugin<
  TDecorate extends Record<string, unknown> = Record<string, unknown>,
  TState extends Record<string, unknown> = Record<string, unknown>,
>(config: AsiPluginConfig<TDecorate, TState>): AsiPlugin<TDecorate, TState> {
  return {
    name: config.name,
    config,
    
    async apply(app: PluginHost, state: Map<string, unknown>, decorators: Map<string, unknown>): Promise<void> {
      // Register state
      if (config.state) {
        for (const [key, value] of Object.entries(config.state)) {
          state.set(key, value);
        }
      }
      
      // Register decorators
      if (config.decorate) {
        for (const [key, value] of Object.entries(config.decorate)) {
          decorators.set(key, value);
        }
      }
      
      // Register middleware
      if (config.middleware) {
        const middlewares = Array.isArray(config.middleware) 
          ? config.middleware 
          : [config.middleware];
        for (const mw of middlewares) {
          app.use(mw);
        }
      }
      
      // Register beforeHandle hooks
      if (config.beforeHandle) {
        const hooks = Array.isArray(config.beforeHandle) 
          ? config.beforeHandle 
          : [config.beforeHandle];
        for (const hook of hooks) {
          app.onBeforeHandle(hook);
        }
      }
      
      // Register afterHandle hooks
      if (config.afterHandle) {
        const hooks = Array.isArray(config.afterHandle) 
          ? config.afterHandle 
          : [config.afterHandle];
        for (const hook of hooks) {
          app.onAfterHandle(hook);
        }
      }
      
      // Run setup
      if (config.setup) {
        await config.setup(app);
      }
    },
  };
}

/**
 * Create a plugin from a simple function
 * 
 * @example
 * ```ts
 * const routePlugin = pluginFn("routes", (app) => {
 *   app.get("/health", () => ({ status: "ok" }));
 * });
 * ```
 */
export function pluginFn(
  name: string, 
  setup: (app: PluginHost) => void | Promise<void>
): AsiPlugin {
  return createPlugin({ name, setup });
}

// ===== Built-in plugin helpers =====

/**
 * Create a decorator plugin (adds methods/properties to context)
 * 
 * @example
 * ```ts
 * const decoratorPlugin = decorators("helpers", {
 *   now: () => new Date(),
 *   randomId: () => crypto.randomUUID(),
 * });
 * ```
 */
export function decorators<T extends Record<string, unknown>>(
  name: string, 
  decorate: T
): AsiPlugin<T, Record<string, unknown>> {
  return createPlugin({ name, decorate });
}

/**
 * Create a state plugin (adds shared state to the app)
 * 
 * @example
 * ```ts
 * const statePlugin = sharedState("cache", {
 *   cache: new Map<string, unknown>(),
 *   hits: 0,
 * });
 * ```
 */
export function sharedState<T extends Record<string, unknown>>(
  name: string, 
  state: T
): AsiPlugin<Record<string, unknown>, T> {
  return createPlugin({ name, state });
}

/**
 * Create a guard plugin (adds beforeHandle protection)
 * 
 * @example
 * ```ts
 * const authGuard = guard("auth", async (ctx) => {
 *   const token = ctx.header("Authorization");
 *   if (!token) {
 *     return new Response("Unauthorized", { status: 401 });
 *   }
 * });
 * ```
 */
export function guard(
  name: string, 
  handler: BeforeHandler
): AsiPlugin {
  return createPlugin({ name, beforeHandle: handler });
}
