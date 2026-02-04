import type { Server, ServerWebSocket } from "bun";
import type { TSchema, Static } from "@sinclair/typebox";
import { Context, type TypedContext } from "./context";
import { Router } from "./router";
import { validateAndCoerce, ValidationException, type ValidationError } from "./validation";
import { compileHandler, compileSchema, analyzeRoute, StaticRouter, type CompiledRoute } from "./compiler";
import { isFormDataSchema, validateFormData, type FormDataSchemaType } from "./formdata";
import type { 
  Handler, 
  Middleware, 
  RouteMethod, 
  BeforeHandler, 
  AfterHandler,
  ErrorHandler,
  NotFoundHandler,
  RouteOptions,
  InferSchema,
} from "./types";

/** WebSocket event handlers */
export interface WebSocketHandlers<T = unknown> {
  /** Вызывается при открытии соединения */
  open?: (ws: ServerWebSocket<T>) => void | Promise<void>;
  /** Вызывается при получении сообщения */
  message?: (ws: ServerWebSocket<T>, message: string | Buffer) => void | Promise<void>;
  /** Вызывается при закрытии соединения */
  close?: (ws: ServerWebSocket<T>, code: number, reason: string) => void | Promise<void>;
  /** Вызывается при ошибке */
  error?: (ws: ServerWebSocket<T>, error: Error) => void | Promise<void>;
  /** Вызывается при drain (буфер опустел) */
  drain?: (ws: ServerWebSocket<T>) => void | Promise<void>;
}

/** WebSocket route configuration */
export interface WebSocketRoute<T = unknown> {
  /** Путь для WebSocket (например "/ws" или "/chat/:room") */
  path: string;
  /** Обработчики событий */
  handlers: WebSocketHandlers<T>;
  /** Опционально: проверка перед upgrade */
  beforeUpgrade?: (request: Request) => boolean | Promise<boolean>;
}

export interface AsiConfig {
  port?: number;
  hostname?: string;
  /** Включить подробные ошибки в dev режиме */
  development?: boolean;
  
  // === Bun.serve() options ===
  
  /** 
   * Использовать SO_REUSEPORT для нескольких процессов на одном порту
   * Полезно для кластеризации
   */
  reusePort?: boolean;
  
  /**
   * Режим низкого потребления памяти
   * Отключает некоторые оптимизации для экономии RAM
   */
  lowMemoryMode?: boolean;
  
  /**
   * Максимальный размер тела запроса в байтах
   * По умолчанию: 128MB
   */
  maxRequestBodySize?: number;
  
  /**
   * TLS конфигурация для HTTPS
   */
  tls?: {
    key?: string | Buffer | Array<string | Buffer>;
    cert?: string | Buffer | Array<string | Buffer>;
    ca?: string | Buffer | Array<string | Buffer>;
    passphrase?: string;
  };
  
  /**
   * Таймаут ожидания idle соединения в секундах
   * По умолчанию: 10
   */
  idleTimeout?: number;
  
  /**
   * Автоматически искать свободный порт если указанный занят
   * По умолчанию: true в development режиме
   */
  autoPort?: boolean;
  
  /**
   * Максимальное количество попыток найти свободный порт
   * По умолчанию: 10 (т.е. проверит порты 3000-3009)
   */
  autoPortRange?: number;
  
  /**
   * Показывать подробную информацию при старте
   * По умолчанию: true
   */
  startupBanner?: boolean;
  
  /**
   * Таймаут graceful shutdown в миллисекундах
   * По умолчанию: 30000 (30 секунд)
   */
  gracefulShutdownTimeout?: number;
  
  /**
   * Отключить все логи (для тестов)
   */
  silent?: boolean;

  /**
   * Декодировать query параметры (decodeURIComponent)
   * По умолчанию: false для максимальной производительности
   */
  decodeQuery?: boolean;
}

/** Интерфейс для группировки роутов */
export interface GroupBuilder {
  get<
    TBody extends TSchema | undefined = undefined,
    TQuery extends TSchema | undefined = undefined,
    TParams extends TSchema | undefined = undefined,
  >(
    path: string, 
    handler: (ctx: TypedContext<
      InferSchema<TBody>,
      InferSchema<TQuery, Record<string, string>>,
      InferSchema<TParams, Record<string, string>>
    >) => unknown | Promise<unknown>,
    options?: RouteOptions<TBody, TQuery, TParams>
  ): GroupBuilder;
  
  post<
    TBody extends TSchema | undefined = undefined,
    TQuery extends TSchema | undefined = undefined,
    TParams extends TSchema | undefined = undefined,
  >(
    path: string, 
    handler: (ctx: TypedContext<
      InferSchema<TBody>,
      InferSchema<TQuery, Record<string, string>>,
      InferSchema<TParams, Record<string, string>>
    >) => unknown | Promise<unknown>,
    options?: RouteOptions<TBody, TQuery, TParams>
  ): GroupBuilder;
  
  put<
    TBody extends TSchema | undefined = undefined,
    TQuery extends TSchema | undefined = undefined,
    TParams extends TSchema | undefined = undefined,
  >(
    path: string, 
    handler: (ctx: TypedContext<
      InferSchema<TBody>,
      InferSchema<TQuery, Record<string, string>>,
      InferSchema<TParams, Record<string, string>>
    >) => unknown | Promise<unknown>,
    options?: RouteOptions<TBody, TQuery, TParams>
  ): GroupBuilder;
  
  delete<
    TBody extends TSchema | undefined = undefined,
    TQuery extends TSchema | undefined = undefined,
    TParams extends TSchema | undefined = undefined,
  >(
    path: string, 
    handler: (ctx: TypedContext<
      InferSchema<TBody>,
      InferSchema<TQuery, Record<string, string>>,
      InferSchema<TParams, Record<string, string>>
    >) => unknown | Promise<unknown>,
    options?: RouteOptions<TBody, TQuery, TParams>
  ): GroupBuilder;
  
  patch<
    TBody extends TSchema | undefined = undefined,
    TQuery extends TSchema | undefined = undefined,
    TParams extends TSchema | undefined = undefined,
  >(
    path: string, 
    handler: (ctx: TypedContext<
      InferSchema<TBody>,
      InferSchema<TQuery, Record<string, string>>,
      InferSchema<TParams, Record<string, string>>
    >) => unknown | Promise<unknown>,
    options?: RouteOptions<TBody, TQuery, TParams>
  ): GroupBuilder;
  
  all<
    TBody extends TSchema | undefined = undefined,
    TQuery extends TSchema | undefined = undefined,
    TParams extends TSchema | undefined = undefined,
  >(
    path: string, 
    handler: (ctx: TypedContext<
      InferSchema<TBody>,
      InferSchema<TQuery, Record<string, string>>,
      InferSchema<TParams, Record<string, string>>
    >) => unknown | Promise<unknown>,
    options?: RouteOptions<TBody, TQuery, TParams>
  ): GroupBuilder;
  
  use(middleware: Middleware): GroupBuilder;
  group(prefix: string, callback: (group: GroupBuilder) => void): GroupBuilder;
}

/**
 * Asi — главный класс фреймворка
 * 
 * @example
 * ```ts
 * const app = new Asi();
 * 
 * app.get("/", () => "Hello, World!");
 * app.get("/json", () => ({ message: "Hello" }));
 * app.get("/user/:id", (ctx) => `User ${ctx.params.id}`);
 * 
 * // Группировка
 * app.group("/api", (api) => {
 *   api.get("/users", () => [...]);
 *   api.group("/v2", (v2) => {
 *     v2.get("/users", () => [...]);
 *   });
 * });
 * 
 * // WebSocket
 * app.ws("/chat", {
 *   open(ws) { console.log("Connected"); },
 *   message(ws, msg) { ws.send(`Echo: ${msg}`); },
 *   close(ws) { console.log("Disconnected"); },
 * });
 * 
 * app.listen(3000);
 * ```
 */
export class Asi {
  private router = new Router();
  private globalMiddlewares: Middleware[] = [];
  private globalBeforeHandlers: BeforeHandler[] = [];
  private globalAfterHandlers: AfterHandler[] = [];
  private pathMiddlewares: Map<string, Middleware[]> = new Map();
  private server: Server | null = null;
  private config: AsiConfig;
  
  private customErrorHandler: ErrorHandler | null = null;
  private customNotFoundHandler: NotFoundHandler | null = null;
  
  // WebSocket routes
  private wsRoutes: Map<string, WebSocketRoute<any>> = new Map();
  
  // Compilation
  private isCompiled = false;
  private staticRouter = new StaticRouter();
  private compiledRoutes: Map<RouteMethod, Map<string, CompiledRoute>> = new Map();
  
  // Route metadata for compilation
  private routeMetadata: Array<{
    method: RouteMethod;
    path: string;
    handler: Handler;
    middlewares: Middleware[];
    schemas?: { body?: TSchema; query?: TSchema; params?: TSchema };
  }> = [];
  
  // Plugin system
  private _state: Map<string, unknown> = new Map();
  private _decorators: Map<string, unknown> = new Map();
  private _plugins: Set<string> = new Set();

  constructor(config: AsiConfig = {}) {
    // Environment detection
    const env = process.env.BUN_ENV || process.env.NODE_ENV || "development";
    const isProduction = env === "production";
    const isBun = typeof Bun !== "undefined";
    
    // PORT from environment (PORT=8080 bun dev)
    const envPort = process.env.PORT ? parseInt(process.env.PORT, 10) : undefined;
    
    this.config = {
      port: envPort ?? 3000,
      hostname: "0.0.0.0",
      development: !isProduction,
      startupBanner: true,
      gracefulShutdownTimeout: 30000,
      silent: false,
      ...config,
    };
    
    // Warning if not running on Bun
    if (!isBun && !this.config.silent) {
      console.warn("⚠️  AsiJS is optimized for Bun. Running on Node.js may have reduced performance.");
    }
  }

  // ===== Route registration with type inference =====

  /**
   * GET роут с опциональной валидацией
   * 
   * @example
   * ```ts
   * // Без валидации
   * app.get("/", () => "Hello");
   * 
   * // С валидацией query
   * app.get("/search", (ctx) => {
   *   return { q: ctx.body }; // ctx.body типизирован!
   * }, {
   *   schema: {
   *     query: Type.Object({ q: Type.String() })
   *   }
   * });
   * ```
   */
  get<
    TBody extends TSchema | undefined = undefined,
    TQuery extends TSchema | undefined = undefined,
    TParams extends TSchema | undefined = undefined,
  >(
    path: string, 
    handler: (ctx: TypedContext<
      InferSchema<TBody>,
      InferSchema<TQuery, Record<string, string>>,
      InferSchema<TParams, Record<string, string>>
    >) => unknown | Promise<unknown>,
    options?: RouteOptions<TBody, TQuery, TParams>
  ): this {
    return this.route("GET", path, handler as Handler, options);
  }

  post<
    TBody extends TSchema | undefined = undefined,
    TQuery extends TSchema | undefined = undefined,
    TParams extends TSchema | undefined = undefined,
  >(
    path: string, 
    handler: (ctx: TypedContext<
      InferSchema<TBody>,
      InferSchema<TQuery, Record<string, string>>,
      InferSchema<TParams, Record<string, string>>
    >) => unknown | Promise<unknown>,
    options?: RouteOptions<TBody, TQuery, TParams>
  ): this {
    return this.route("POST", path, handler as Handler, options);
  }

  put<
    TBody extends TSchema | undefined = undefined,
    TQuery extends TSchema | undefined = undefined,
    TParams extends TSchema | undefined = undefined,
  >(
    path: string, 
    handler: (ctx: TypedContext<
      InferSchema<TBody>,
      InferSchema<TQuery, Record<string, string>>,
      InferSchema<TParams, Record<string, string>>
    >) => unknown | Promise<unknown>,
    options?: RouteOptions<TBody, TQuery, TParams>
  ): this {
    return this.route("PUT", path, handler as Handler, options);
  }

  delete<
    TBody extends TSchema | undefined = undefined,
    TQuery extends TSchema | undefined = undefined,
    TParams extends TSchema | undefined = undefined,
  >(
    path: string, 
    handler: (ctx: TypedContext<
      InferSchema<TBody>,
      InferSchema<TQuery, Record<string, string>>,
      InferSchema<TParams, Record<string, string>>
    >) => unknown | Promise<unknown>,
    options?: RouteOptions<TBody, TQuery, TParams>
  ): this {
    return this.route("DELETE", path, handler as Handler, options);
  }

  patch<
    TBody extends TSchema | undefined = undefined,
    TQuery extends TSchema | undefined = undefined,
    TParams extends TSchema | undefined = undefined,
  >(
    path: string, 
    handler: (ctx: TypedContext<
      InferSchema<TBody>,
      InferSchema<TQuery, Record<string, string>>,
      InferSchema<TParams, Record<string, string>>
    >) => unknown | Promise<unknown>,
    options?: RouteOptions<TBody, TQuery, TParams>
  ): this {
    return this.route("PATCH", path, handler as Handler, options);
  }

  head<
    TBody extends TSchema | undefined = undefined,
    TQuery extends TSchema | undefined = undefined,
    TParams extends TSchema | undefined = undefined,
  >(
    path: string, 
    handler: (ctx: TypedContext<
      InferSchema<TBody>,
      InferSchema<TQuery, Record<string, string>>,
      InferSchema<TParams, Record<string, string>>
    >) => unknown | Promise<unknown>,
    options?: RouteOptions<TBody, TQuery, TParams>
  ): this {
    return this.route("HEAD", path, handler as Handler, options);
  }

  options<
    TBody extends TSchema | undefined = undefined,
    TQuery extends TSchema | undefined = undefined,
    TParams extends TSchema | undefined = undefined,
  >(
    path: string, 
    handler: (ctx: TypedContext<
      InferSchema<TBody>,
      InferSchema<TQuery, Record<string, string>>,
      InferSchema<TParams, Record<string, string>>
    >) => unknown | Promise<unknown>,
    options?: RouteOptions<TBody, TQuery, TParams>
  ): this {
    return this.route("OPTIONS", path, handler as Handler, options);
  }

  all<
    TBody extends TSchema | undefined = undefined,
    TQuery extends TSchema | undefined = undefined,
    TParams extends TSchema | undefined = undefined,
  >(
    path: string, 
    handler: (ctx: TypedContext<
      InferSchema<TBody>,
      InferSchema<TQuery, Record<string, string>>,
      InferSchema<TParams, Record<string, string>>
    >) => unknown | Promise<unknown>,
    options?: RouteOptions<TBody, TQuery, TParams>
  ): this {
    return this.route("ALL", path, handler as Handler, options);
  }

  /** Добавить роут с любым методом */
  route(method: RouteMethod, path: string, handler: Handler, options?: RouteOptions): this {
    const wrappedHandler = this.wrapHandler(handler, options);
    const middlewares = [...this.globalMiddlewares];
    this.router.add(method, path, wrappedHandler, middlewares);
    
    // Сохраняем metadata для компиляции
    this.routeMetadata.push({
      method,
      path,
      handler,
      middlewares,
      schemas: options?.schema,
    });
    
    return this;
  }

  /** Обернуть handler с валидацией и хуками */
  private wrapHandler(handler: Handler, options?: RouteOptions): Handler {
    const schema = options?.schema;
    const hasValidation = schema?.body || schema?.query || schema?.params;
    const hasHooks = options?.beforeHandle || options?.afterHandle;

    if (!hasValidation && !hasHooks) {
      return handler;
    }

    const beforeHandlers = options?.beforeHandle 
      ? (Array.isArray(options.beforeHandle) ? options.beforeHandle : [options.beforeHandle])
      : [];
    const afterHandlers = options?.afterHandle
      ? (Array.isArray(options.afterHandle) ? options.afterHandle : [options.afterHandle])
      : [];

    return async (ctx: Context) => {
      // === Валидация ===
      if (hasValidation) {
        const validationErrors: ValidationError[] = [];

        // Валидация body
        if (schema?.body) {
          // Check if it's a FormData schema
          if (isFormDataSchema(schema.body)) {
            try {
              const formData = await ctx.formData();
              const result = await validateFormData(formData, schema.body as TSchema & FormDataSchemaType);
              if (!result.success) {
                validationErrors.push(...(result.errors?.map(e => ({ 
                  path: `body.${e.field}`, 
                  message: e.message 
                })) ?? []));
              } else {
                ctx._setBody(result.data as any);
                if (result.files) {
                  ctx._setFiles(result.files);
                }
              }
            } catch (err) {
              validationErrors.push({ 
                path: "body", 
                message: "Invalid FormData" 
              });
            }
          } else {
            // Regular JSON body
            try {
              const rawBody = await ctx.json();
              const result = validateAndCoerce(schema.body, rawBody);
              if (!result.success) {
                validationErrors.push(...(result.errors?.map(e => ({ 
                  ...e, 
                  path: `body${e.path}` 
                })) ?? []));
              } else {
                ctx._setBody(result.data);
              }
            } catch (err) {
              validationErrors.push({ 
                path: "body", 
                message: "Invalid JSON body" 
              });
            }
          }
        }

        // Валидация query
        if (schema?.query) {
          const result = validateAndCoerce(schema.query, ctx.query);
          if (!result.success) {
            validationErrors.push(...(result.errors?.map(e => ({ 
              ...e, 
              path: `query${e.path}` 
            })) ?? []));
          } else {
            ctx._setQuery(result.data);
          }
        }

        // Валидация params
        if (schema?.params) {
          const result = validateAndCoerce(schema.params, ctx.params);
          if (!result.success) {
            validationErrors.push(...(result.errors?.map(e => ({ 
              ...e, 
              path: `params${e.path}` 
            })) ?? []));
          } else {
            ctx._setParams(result.data);
          }
        }

        // Если есть ошибки валидации — вернуть 400
        if (validationErrors.length > 0) {
          throw new ValidationException(validationErrors);
        }
      }

      // === beforeHandle хуки ===
      for (const before of beforeHandlers) {
        const result = await before(ctx);
        if (result instanceof Response) {
          return result;
        }
      }

      // === Выполнить handler ===
      let result = await handler(ctx);

      // === afterHandle хуки ===
      if (afterHandlers.length > 0 && !(result instanceof Response)) {
        result = this.toResponse(result, ctx);
      }
      
      for (const after of afterHandlers) {
        if (result instanceof Response) {
          result = await after(ctx, result);
        }
      }

      return result;
    };
  }

  // ===== Middleware =====

  /** Добавить глобальный middleware или middleware для пути */
  use(pathOrMiddleware: string | Middleware, middleware?: Middleware): this {
    if (typeof pathOrMiddleware === "function") {
      this.globalMiddlewares.push(pathOrMiddleware);
    } else if (middleware) {
      // Middleware для конкретного пути
      const path = pathOrMiddleware;
      if (!this.pathMiddlewares.has(path)) {
        this.pathMiddlewares.set(path, []);
      }
      this.pathMiddlewares.get(path)!.push(middleware);
    }
    return this;
  }

  // ===== Global hooks =====

  /** Глобальный хук перед каждым handler */
  onBeforeHandle(handler: BeforeHandler): this {
    this.globalBeforeHandlers.push(handler);
    return this;
  }

  /** Глобальный хук после каждого handler */
  onAfterHandle(handler: AfterHandler): this {
    this.globalAfterHandlers.push(handler);
    return this;
  }

  /** Кастомный обработчик ошибок */
  onError(handler: ErrorHandler): this {
    this.customErrorHandler = handler;
    return this;
  }

  /** Кастомный обработчик 404 */
  onNotFound(handler: NotFoundHandler): this {
    this.customNotFoundHandler = handler;
    return this;
  }

  // ===== WebSocket =====

  /**
   * Зарегистрировать WebSocket endpoint
   * 
   * @example
   * ```ts
   * app.ws("/chat", {
   *   open(ws) {
   *     console.log("Client connected");
   *   },
   *   message(ws, msg) {
   *     ws.send(`Echo: ${msg}`);
   *   },
   *   close(ws) {
   *     console.log("Client disconnected");
   *   },
   * });
   * 
   * // С данными пользователя
   * app.ws<{ userId: string }>("/user", {
   *   open(ws) {
   *     console.log(`User ${ws.data.userId} connected`);
   *   },
   *   message(ws, msg) {
   *     // ws.data.userId доступен
   *   },
   * });
   * ```
   */
  ws<T = unknown>(
    path: string, 
    handlers: WebSocketHandlers<T>,
    options?: { beforeUpgrade?: (request: Request) => boolean | Promise<boolean> }
  ): this {
    this.wsRoutes.set(path, {
      path,
      handlers,
      beforeUpgrade: options?.beforeUpgrade,
    });
    return this;
  }

  // ===== Plugin System =====

  /**
   * Register a plugin
   * 
   * @example
   * ```ts
   * import { createPlugin } from "asijs";
   * 
   * const myPlugin = createPlugin({
   *   name: "my-plugin",
   *   setup(app) {
   *     app.get("/from-plugin", () => "Hello from plugin!");
   *   }
   * });
   * 
   * app.plugin(myPlugin);
   * ```
   */
  async plugin(plugin: import("./plugin").AsiPlugin): Promise<this> {
    // Check if already registered
    if (this._plugins.has(plugin.name)) {
      return this;
    }
    
    // Check dependencies
    if (plugin.config.dependencies) {
      for (const dep of plugin.config.dependencies) {
        if (!this._plugins.has(dep)) {
          throw new Error(`Plugin "${plugin.name}" requires plugin "${dep}" to be registered first`);
        }
      }
    }
    
    // Mark as registered
    this._plugins.add(plugin.name);
    
    // Create PluginHost adapter
    const host: import("./plugin").PluginHost = {
      get: (path, handler, options) => { this.get(path, handler as any, options as any); return host; },
      post: (path, handler, options) => { this.post(path, handler as any, options as any); return host; },
      put: (path, handler, options) => { this.put(path, handler as any, options as any); return host; },
      delete: (path, handler, options) => { this.delete(path, handler as any, options as any); return host; },
      patch: (path, handler, options) => { this.patch(path, handler as any, options as any); return host; },
      all: (path, handler, options) => { this.all(path, handler as any, options as any); return host; },
      use: (pathOrMw: string | Middleware, mw?: Middleware) => { 
        this.use(pathOrMw as any, mw as any); 
        return host; 
      },
      onBeforeHandle: (handler) => { this.onBeforeHandle(handler); return host; },
      onAfterHandle: (handler) => { this.onAfterHandle(handler); return host; },
      group: (prefix, callback) => { this.group(prefix, callback as any); return host; },
      getState: <T>(key: string) => this._state.get(key) as T | undefined,
      setState: <T>(key: string, value: T) => { this._state.set(key, value); },
      getDecorator: <T>(key: string) => this._decorators.get(key) as T | undefined,
    };
    
    // Apply plugin
    await plugin.apply(host, this._state, this._decorators);
    
    return this;
  }

  /**
   * Get shared state by key
   * 
   * @example
   * ```ts
   * const cache = app.state<Map<string, unknown>>("cache");
   * ```
   */
  state<T = unknown>(key: string): T | undefined {
    return this._state.get(key) as T | undefined;
  }

  /**
   * Set shared state
   * 
   * @example
   * ```ts
   * app.setState("counter", 0);
   * ```
   */
  setState<T = unknown>(key: string, value: T): this {
    this._state.set(key, value);
    return this;
  }

  /**
   * Get decorator by key
   * 
   * @example
   * ```ts
   * const myHelper = app.decorator<() => string>("myHelper");
   * ```
   */
  decorator<T = unknown>(key: string): T | undefined {
    return this._decorators.get(key) as T | undefined;
  }

  /**
   * Add a decorator
   * 
   * @example
   * ```ts
   * app.decorate("now", () => new Date());
   * app.decorate("randomId", () => crypto.randomUUID());
   * ```
   */
  decorate<T = unknown>(key: string, value: T): this {
    this._decorators.set(key, value);
    return this;
  }

  /**
   * Check if a plugin is registered
   */
  hasPlugin(name: string): boolean {
    return this._plugins.has(name);
  }

  // ===== Route grouping =====

  /** Группировка роутов с общим префиксом */
  group(prefix: string, callback: (group: GroupBuilder) => void, parentMiddlewares: Middleware[] = []): this {
    const groupMiddlewares: Middleware[] = [...parentMiddlewares];

    // Внутренний метод для добавления роута с group middleware
    const addGroupRoute = (method: RouteMethod, path: string, handler: Handler, options?: RouteOptions) => {
      const wrappedHandler = this.wrapHandler(handler, options);
      // Добавляем global + group middleware
      const allMiddlewares = [...this.globalMiddlewares, ...groupMiddlewares];
      this.router.add(method, prefix + path, wrappedHandler, allMiddlewares);
    };

    const groupBuilder: GroupBuilder = {
      get: (path, handler, options) => {
        addGroupRoute("GET", path, handler, options);
        return groupBuilder;
      },
      post: (path, handler, options) => {
        addGroupRoute("POST", path, handler, options);
        return groupBuilder;
      },
      put: (path, handler, options) => {
        addGroupRoute("PUT", path, handler, options);
        return groupBuilder;
      },
      delete: (path, handler, options) => {
        addGroupRoute("DELETE", path, handler, options);
        return groupBuilder;
      },
      patch: (path, handler, options) => {
        addGroupRoute("PATCH", path, handler, options);
        return groupBuilder;
      },
      all: (path, handler, options) => {
        addGroupRoute("ALL", path, handler, options);
        return groupBuilder;
      },
      use: (middleware) => {
        groupMiddlewares.push(middleware);
        return groupBuilder;
      },
      group: (nestedPrefix, nestedCallback) => {
        // Передаём текущие middleware во вложенную группу
        this.group(prefix + nestedPrefix, nestedCallback, groupMiddlewares);
        return groupBuilder;
      },
    };

    callback(groupBuilder);
    return this;
  }

  // ===== Compilation =====

  /**
   * Скомпилировать все роуты для максимальной производительности
   * 
   * Вызывается автоматически при listen() или вручную перед тестами.
   * 
   * Что делает:
   * - Предкомпилирует TypeBox валидаторы
   * - Создаёт оптимизированные handler-ы без лишних проверок
   * - Строит статический роутер для путей без параметров
   * 
   * @example
   * ```ts
   * const app = new Asi();
   * app.get("/", () => "Hello");
   * app.compile(); // Опционально — автоматически при listen()
   * ```
   */
  compile(): this {
    if (this.isCompiled) return this;
    
    const startTime = performance.now();
    let staticCount = 0;
    let dynamicCount = 0;
    
    for (const meta of this.routeMetadata) {
      const analysis = analyzeRoute(meta.path, meta.middlewares, meta.schemas);
      
      // Компилируем handler
      let compiledExecute = compileHandler(
        meta.handler,
        meta.middlewares,
        meta.schemas
      );

      // Static response precompute (safe subset)
      if (
        analysis.isStatic &&
        meta.middlewares.length === 0 &&
        !meta.schemas &&
        meta.handler.length === 0
      ) {
        try {
          const result = (meta.handler as () => unknown)();
          if (!(result instanceof Promise)) {
            const factory = this._createStaticResponseFactory(result);
            if (factory) {
              compiledExecute = async () => factory();
            }
          }
        } catch {
          // Если precompute не удался — используем обычный compiled handler
        }
      }
      
      const compiledRoute: CompiledRoute = {
        method: meta.method,
        path: meta.path,
        execute: compiledExecute,
      };
      
      // Статические роуты — в быстрый роутер
      if (analysis.isStatic) {
        this.staticRouter.add(compiledRoute);
        staticCount++;
      } else {
        dynamicCount++;
      }
      
      // Сохраняем для lookup
      let methodMap = this.compiledRoutes.get(meta.method);
      if (!methodMap) {
        methodMap = new Map();
        this.compiledRoutes.set(meta.method, methodMap);
      }
      methodMap.set(meta.path, compiledRoute);
    }
    
    this.isCompiled = true;
    
    const duration = (performance.now() - startTime).toFixed(2);
    if (this.config.development) {
      console.log(`⚡ Compiled ${this.routeMetadata.length} routes in ${duration}ms`);
      console.log(`   Static: ${staticCount}, Dynamic: ${dynamicCount}`);
    }
    
    return this;
  }

  /** Создать factory для статического Response (без ctx) */
  private _createStaticResponseFactory(result: unknown): (() => Response) | null {
    if (result instanceof Response) return null;

    const type = typeof result;

    if (type === "object") {
      if (result === null) return () => new Response(null, { status: 204 });
      if (result instanceof Blob) return () => new Response(result);
      const body = JSON.stringify(result);
      const headers = { "Content-Type": "application/json; charset=utf-8" };
      return () => new Response(body, { status: 200, headers });
    }

    if (type === "string") {
      const headers = { "Content-Type": "text/plain; charset=utf-8" };
      return () => new Response(result as string, { status: 200, headers });
    }

    if (result === undefined) {
      return () => new Response(null, { status: 204 });
    }

    const headers = { "Content-Type": "text/plain; charset=utf-8" };
    return () => new Response(String(result), { status: 200, headers });
  }

  // ===== Request handling =====

  /** Обработать запрос (для тестирования или интеграции) */
  async handle(request: Request): Promise<Response> {
    // Fast path extraction без URL объекта
    const url = request.url;
    const qIdx = url.indexOf("?");
    let path: string;
    let queryString = "";
    
    if (qIdx === -1) {
      const startIdx = url.indexOf("/", url.indexOf("//") + 2);
      path = startIdx === -1 ? "/" : url.slice(startIdx);
    } else {
      const startIdx = url.indexOf("/", url.indexOf("//") + 2);
      path = startIdx === -1 ? "/" : url.slice(startIdx, qIdx);
      queryString = url.slice(qIdx + 1);
    }
    
    const method = request.method as RouteMethod;
    
    // Lazy context creation — только когда нужен
    let ctx: Context | null = null;
    const getContext = () => {
      if (!ctx) {
        ctx = new Context(request, { decodeQuery: this.config.decodeQuery ?? false });
        ctx._setUrlParts(path, queryString);
      }
      return ctx;
    };

    try {
      // Выполнить глобальные beforeHandle (fast path если пусто)
      const beforeHandlers = this.globalBeforeHandlers;
      if (beforeHandlers.length > 0) {
        ctx = getContext();
        for (let i = 0; i < beforeHandlers.length; i++) {
          const result = await beforeHandlers[i](ctx);
          if (result instanceof Response) {
            return result;
          }
        }
      }

      // === FAST PATH: Скомпилированный статический роут ===
      if (this.isCompiled && this.staticRouter.hasRoutes) {
        const compiled = this.staticRouter.find(method, path);
        if (compiled) {
          ctx = getContext();
          let response = await compiled.execute(ctx);
          
          // afterHandle
          const afterHandlers = this.globalAfterHandlers;
          for (let i = 0; i < afterHandlers.length; i++) {
            response = await afterHandlers[i](ctx, response);
          }
          
          return response;
        }
      }

      // === NORMAL PATH: Dynamic router ===
      const match = this.router.find(method, path);

      // Если есть глобальные middleware — они могут обработать запрос даже без роута
      // (например CORS для OPTIONS)
      const globalMw = this.globalMiddlewares;
      
      if (!match) {
        ctx = getContext();
        // Если есть глобальные middleware — дать им шанс обработать
        if (globalMw.length > 0) {
          const notFoundHandler = () => this.notFound(ctx!);
          return this.executeHandler(ctx, globalMw, notFoundHandler);
        }
        return this.notFound(ctx);
      }

      ctx = getContext();
      
      // Установка параметров
      ctx.params = match.params;

      // === FAST PATH: Compiled dynamic route (без path middleware) ===
      if (this.isCompiled) {
        const compiled = this.compiledRoutes.get(method)?.get(match.path);
        if (compiled) {
          let response: Response;
          if (this.pathMiddlewares.size === 0) {
            response = await compiled.execute(ctx);
          } else {
            const pathMw = this.collectPathMiddlewares(path);
            response = pathMw.length === 0
              ? await compiled.execute(ctx)
              : await this.executeHandler(ctx, pathMw, compiled.execute as unknown as Handler);
          }

          // Выполнить глобальные afterHandle (fast path если пусто)
          const afterHandlers = this.globalAfterHandlers;
          for (let i = 0; i < afterHandlers.length; i++) {
            response = await afterHandlers[i](ctx, response);
          }

          return response;
        }
      }

      // Выполнение middleware chain + handler
      // Избегаем создания нового массива если нет path middleware
      const hasPathMw = this.pathMiddlewares.size > 0;
      const middlewares = hasPathMw 
        ? this.mergeMiddlewares(match.middlewares, path)
        : match.middlewares;

      let response = await this.executeHandler(ctx, middlewares, match.handler);
      
      // Выполнить глобальные afterHandle (fast path если пусто)
      const afterHandlers = this.globalAfterHandlers;
      for (let i = 0; i < afterHandlers.length; i++) {
        response = await afterHandlers[i](ctx, response);
      }

      return response;
    } catch (error) {
      ctx = getContext();
      return this.handleError(ctx, error);
    }
  }

  /** Объединить route middleware с path middleware (только если есть path middleware) */
  private mergeMiddlewares(routeMiddlewares: Middleware[], requestPath: string): Middleware[] {
    const pathMw = this.collectPathMiddlewares(requestPath);
    if (pathMw.length === 0) return routeMiddlewares;
    if (routeMiddlewares.length === 0) return pathMw;
    return [...routeMiddlewares, ...pathMw];
  }

  /** Собрать middleware для пути */
  private collectPathMiddlewares(requestPath: string): Middleware[] {
    const result: Middleware[] = [];
    
    for (const [pattern, middlewares] of this.pathMiddlewares) {
      // Точное совпадение или path начинается с pattern + "/"
      // /api матчит /api и /api/users, но НЕ /apix
      if (
        requestPath === pattern || 
        requestPath.startsWith(pattern + "/")
      ) {
        result.push(...middlewares);
      }
    }
    
    return result;
  }

  private async executeHandler(
    ctx: Context, 
    middlewares: Middleware[], 
    handler: Handler
  ): Promise<Response> {
    const len = middlewares.length;
    
    // Fast path: no middleware
    if (len === 0) {
      const result = await handler(ctx);
      return this.toResponse(result, ctx);
    }
    
    let index = 0;
    let handlerCalled = false;

    const next = async (): Promise<Response> => {
      // Защита от повторного вызова после handler
      if (handlerCalled) {
        throw new Error("next() called after handler already executed");
      }

      if (index < len) {
        const middleware = middlewares[index++];
        const result = await middleware(ctx, next);
        
        // Если middleware вернул Response — используем его
        if (result instanceof Response) {
          return result;
        }
        
        // Если middleware ничего не вернул и не вызвал next() внутри,
        // значит он уже вызвал next() и результат уже получен через рекурсию.
        // Не вызываем next() повторно!
        // Возвращаем placeholder который будет заменён
        return result as Response;
      }

      // Выполнение основного handler
      handlerCalled = true;
      const result = await handler(ctx);
      return this.toResponse(result, ctx);
    };

    return next();
  }

  /** Преобразовать результат handler в Response (hot path, inline-optimized) */
  private toResponse(result: unknown, ctx: Context): Response {
    // Fast path: уже Response (самый частый случай с ctx.json())
    if (result instanceof Response) {
      return result;
    }

    // Получаем Set-Cookie headers если есть
    const setCookies = (ctx as any)._setCookies as string[];
    const status = ctx["_status"] || 200;

    // Object / Array → JSON (второй по частоте)
    // Проверяем typeof первым — быстрее чем instanceof
    const type = typeof result;
    if (type === "object") {
      if (result === null) {
        return new Response(null, { status: 204 });
      }
      if (result instanceof Blob) {
        return new Response(result);
      }
      // JSON response — fast path без cookies
      if (!setCookies || setCookies.length === 0) {
        return status === 200
          ? Response.json(result as any)
          : Response.json(result as any, { status });
      }
      const headers = new Headers({ "Content-Type": "application/json; charset=utf-8" });
      for (const cookie of setCookies) {
        headers.append("Set-Cookie", cookie);
      }
      return new Response(JSON.stringify(result), { status, headers });
    }

    // String → text/plain
    if (type === "string") {
      const headers = new Headers({ "Content-Type": "text/plain; charset=utf-8" });
      for (const cookie of setCookies) {
        headers.append("Set-Cookie", cookie);
      }
      return new Response(result as string, { status, headers });
    }

    // undefined → 204 No Content  
    if (result === undefined) {
      return new Response(null, { status: 204 });
    }

    // Number, boolean, etc → string
    const headers = new Headers({ "Content-Type": "text/plain; charset=utf-8" });
    for (const cookie of setCookies) {
      headers.append("Set-Cookie", cookie);
    }
    return new Response(String(result), { status, headers });
  }

  private async notFound(ctx: Context): Promise<Response> {
    if (this.customNotFoundHandler) {
      return this.customNotFoundHandler(ctx);
    }
    
    // In development mode, suggest similar routes
    let suggestions: string[] = [];
    if (this.config.development) {
      suggestions = this._findSimilarRoutes(ctx.path, ctx.method);
    }
    
    const response: Record<string, unknown> = {
      error: "Not Found",
      path: ctx.path,
      method: ctx.method,
    };
    
    if (suggestions.length > 0) {
      response.suggestions = suggestions;
      response.hint = "Did you mean one of these routes?";
    }
    
    return ctx.status(404).jsonResponse(response);
  }
  
  /** Find similar routes for 404 suggestions */
  private _findSimilarRoutes(path: string, method: string): string[] {
    const suggestions: string[] = [];
    const pathParts = path.toLowerCase().split("/").filter(Boolean);
    
    for (const meta of this.routeMetadata) {
      // Check same method or ANY
      if (meta.method !== method && meta.method !== "ALL") continue;
      
      const routeParts = meta.path.toLowerCase().split("/").filter(Boolean);
      
      // Simple similarity: count matching parts
      let matches = 0;
      const maxLen = Math.max(pathParts.length, routeParts.length);
      
      for (let i = 0; i < Math.min(pathParts.length, routeParts.length); i++) {
        const rp = routeParts[i];
        const pp = pathParts[i];
        
        // :param matches anything
        if (rp.startsWith(":") || rp === pp) {
          matches++;
        } else if (rp.includes(pp) || pp.includes(rp)) {
          matches += 0.5;
        }
      }
      
      // At least 50% similarity
      if (matches / maxLen >= 0.5) {
        suggestions.push(`${meta.method} ${meta.path}`);
      }
    }
    
    // Limit to 5 suggestions
    return suggestions.slice(0, 5);
  }

  private async handleError(ctx: Context, error: unknown): Promise<Response> {
    // Обработка ошибок валидации
    if (error instanceof ValidationException) {
      return ctx.status(400).jsonResponse({
        error: "Validation Error",
        details: error.errors,
      });
    }

    if (this.customErrorHandler) {
      try {
        return await this.customErrorHandler(ctx, error);
      } catch (handlerError) {
        console.error("[Asi] Error in custom error handler:", handlerError);
      }
    }

    console.error("[Asi Error]", error);

    const message = this.config.development && error instanceof Error 
      ? error.message 
      : "Internal Server Error";

    const stack = this.config.development && error instanceof Error
      ? error.stack
      : undefined;

    return ctx.status(500).jsonResponse({
      error: message,
      ...(stack && { stack }),
    });
  }

  // ===== Server =====

  /** Найти WebSocket route по пути */
  private findWsRoute(path: string): WebSocketRoute<any> | null {
    // Сначала точное совпадение
    const exact = this.wsRoutes.get(path);
    if (exact) return exact;
    
    // Потом проверяем паттерны с параметрами
    for (const [pattern, route] of this.wsRoutes) {
      if (this.matchWsPath(pattern, path)) {
        return route;
      }
    }
    
    return null;
  }

  /** Простой матчинг пути для WebSocket (поддержка :param) */
  private matchWsPath(pattern: string, path: string): boolean {
    const patternParts = pattern.split("/").filter(Boolean);
    const pathParts = path.split("/").filter(Boolean);
    
    if (patternParts.length !== pathParts.length) return false;
    
    for (let i = 0; i < patternParts.length; i++) {
      const pp = patternParts[i];
      if (pp.startsWith(":")) continue; // параметр — любое значение
      if (pp !== pathParts[i]) return false;
    }
    
    return true;
  }

  /** Запустить сервер */
  listen(port?: number, callback?: () => void): Server {
    // PORT from env takes priority, then argument, then config
    const envPort = process.env.PORT ? parseInt(process.env.PORT, 10) : undefined;
    const basePort = port ?? envPort ?? this.config.port ?? 3000;
    const autoPort = this.config.autoPort ?? this.config.development ?? true;
    const maxAttempts = this.config.autoPortRange ?? 10;
    const silent = this.config.silent ?? false;

    // Автоматическая компиляция при старте
    if (!this.isCompiled) {
      this.compile();
    }

    // Если есть WebSocket роуты — используем websocket опцию
    const hasWebSocket = this.wsRoutes.size > 0;
    
    // Port 0 = random available port
    if (basePort === 0) {
      this.server = this._createServer(0, hasWebSocket);
      const actualPort = this.server.port;
      this._printStartupBanner(actualPort, hasWebSocket, silent);
      callback?.();
      return this.server;
    }
    
    // Попытка запуска с автоматическим поиском порта
    let finalPort = basePort;
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < (autoPort ? maxAttempts : 1); attempt++) {
      finalPort = basePort + attempt;
      
      try {
        this.server = this._createServer(finalPort, hasWebSocket);
        
        // Успешно запустились
        if (attempt > 0 && !silent) {
          console.log(`⚠️  Port ${basePort} was in use, using port ${finalPort} instead`);
        }
        
        this._printStartupBanner(finalPort, hasWebSocket, silent);
        callback?.();
        return this.server;
      } catch (error: any) {
        lastError = error;
        
        // Если это не ошибка занятого порта — пробрасываем сразу
        if (error?.code !== "EADDRINUSE") {
          throw error;
        }
        
        // Если autoPort выключен — пробрасываем ошибку
        if (!autoPort) {
          throw error;
        }
        
        // Иначе пробуем следующий порт
      }
    }
    
    // Все попытки исчерпаны
    throw new Error(
      `Failed to start server. Ports ${basePort}-${basePort + maxAttempts - 1} are all in use.\n` +
      `Original error: ${lastError?.message}`
    );
  }
  
  /** Печать startup banner */
  private _printStartupBanner(port: number, hasWebSocket: boolean, silent: boolean): void {
    if (silent || this.config.startupBanner === false) return;
    
    const protocol = this.config.tls ? "https" : "http";
    const env = process.env.BUN_ENV || process.env.NODE_ENV || "development";
    const hostname = this.config.hostname === "0.0.0.0" ? "localhost" : this.config.hostname;
    
    // Count routes
    const staticCount = this.staticRouter.size;
    const dynamicCount = this.routeMetadata.length - staticCount;
    const wsCount = this.wsRoutes.size;
    
    // Plugins
    const plugins = Array.from(this._plugins).join(", ") || "none";
    
    // Memory (Bun-specific)
    const heapUsed = typeof Bun !== "undefined" 
      ? `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB heap`
      : "N/A";
    
    console.log();
    console.log(`✅ Server started on ${protocol}://${hostname}:${port}`);
    console.log(`   Environment: ${env}`);
    console.log(`   Routes: ${this.routeMetadata.length} (${staticCount} static, ${dynamicCount} dynamic${wsCount > 0 ? `, ${wsCount} WebSocket` : ""})`);
    console.log(`   Plugins: ${plugins}`);
    console.log(`   Memory: ${heapUsed}`);
    console.log();
  }
  
  /** Создать Bun.serve() сервер (внутренний метод) */
  private _createServer(port: number, hasWebSocket: boolean): Server {
    return Bun.serve({
      port,
      hostname: this.config.hostname,
      
      fetch: (request, server) => {
        // Проверяем WebSocket upgrade
        if (hasWebSocket) {
          const upgrade = request.headers.get("upgrade");
          if (upgrade === "websocket") {
            const url = new URL(request.url);
            const wsRoute = this.findWsRoute(url.pathname);
            if (!wsRoute) return this.handle(request);
            // Проверка beforeUpgrade
            if (wsRoute.beforeUpgrade) {
              const allowed = wsRoute.beforeUpgrade(request);
              if (allowed instanceof Promise) {
                return allowed.then((ok) => {
                  if (!ok) return new Response("Forbidden", { status: 403 });
                  const success = server.upgrade(request, { data: { path: url.pathname } });
                  return success ? undefined : new Response("Upgrade failed", { status: 500 });
                });
              }
              if (!allowed) return new Response("Forbidden", { status: 403 });
            }
            
            const success = server.upgrade(request, { data: { path: url.pathname } });
            if (success) return undefined;
          }
        }
        
        return this.handle(request);
      },
      
      // WebSocket handlers
      ...(hasWebSocket && {
        websocket: {
          open: (ws: ServerWebSocket<{ path: string }>) => {
            const route = this.findWsRoute(ws.data.path);
            route?.handlers.open?.(ws);
          },
          message: (ws: ServerWebSocket<{ path: string }>, message: string | Buffer) => {
            const route = this.findWsRoute(ws.data.path);
            route?.handlers.message?.(ws, message);
          },
          close: (ws: ServerWebSocket<{ path: string }>, code: number, reason: string) => {
            const route = this.findWsRoute(ws.data.path);
            route?.handlers.close?.(ws, code, reason);
          },
          error: (ws: ServerWebSocket<{ path: string }>, error: Error) => {
            const route = this.findWsRoute(ws.data.path);
            route?.handlers.error?.(ws, error);
          },
          drain: (ws: ServerWebSocket<{ path: string }>) => {
            const route = this.findWsRoute(ws.data.path);
            route?.handlers.drain?.(ws);
          },
        },
      }),
      
      // Bun.serve() performance options
      reusePort: this.config.reusePort,
      lowMemoryMode: this.config.lowMemoryMode,
      maxRequestBodySize: this.config.maxRequestBodySize,
      idleTimeout: this.config.idleTimeout,
      
      // TLS
      ...(this.config.tls && {
        tls: this.config.tls,
      }),
    });
  }

  /** Остановить сервер */
  stop(): void {
    this.server?.stop();
    this.server = null;
  }
}
