/**
 * AsiJS core framework — the `Asi` application class.
 *
 * Routes, middleware, hooks, TypeBox validation, WebSockets, plugins,
 * error pages, the database layer (2.3) and the compiled router.
 *
 * @example
 * ```ts
 * import { Asi } from "asijs";
 *
 * const app = new Asi();
 * app.get("/", () => "Hello, world!");
 * app.listen(3000);
 * ```
 */

import type { Server, ServerWebSocket } from "bun";
import type { ServerAdapter, ServerHandle } from "./runtime/types";
import type { RoomManager, PubSubWebSocket } from "./ws-pubsub";
import type { TSchema, Static } from "@sinclair/typebox";
import {
  Context,
  ContextPool,
  disableDefaultQueryCache,
  getDefaultQueryCache,
  type TypedContext,
} from "./context";
import { Database, Migrator } from "./db";
import { Router } from "./router";
import {
  validateAndCoerce,
  ValidationException,
  type ValidationError,
} from "./validation";
import {
  renderDefaultErrorPage,
  renderDiscoveredErrorPage,
  shouldRenderHtmlErrorPage,
  type ErrorPagesOptions,
} from "./error-pages";
export type { ErrorPagesOptions } from "./error-pages";
import {
  renderDevErrorPage,
  renderDevNotFoundPage,
} from "./dev-error-page";
import {
  compileHandler,
  compileSchema,
  analyzeRoute,
  StaticRouter,
  enableLRUSchemaCache,
  type CompiledRoute,
} from "./compiler";
import { wrapWithResponseSerializer } from "./serialize";
import {
  RadixTreeRouter,
  MiddlewareChainFlattener,
} from "./router-perf";
import {
  registerYamlFormat,
  getFormat as getRegisteredFormat,
  jsonFormat,
  pickResponseFormat,
  makeFormatResponse,
} from "./formats";
import {
  isFormDataSchema,
  validateFormData,
  type FormDataSchemaType,
} from "./formdata";
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
import type { SecurityConfig } from "./security-core";
import { SecurityManager } from "./security-core";
import {
  PluginDependencyManager,
  type PluginGraphInfo,
  CyclicDependencyError,
  MissingDependencyError,
} from "./plugin-deps";
import { PluginBuilder, type PluginHooks } from "./plugin";

/** WebSocket event handlers */
export interface WebSocketHandlers<T = unknown> {
  /** Вызывается при открытии соединения */
  open?: (ws: ServerWebSocket<T>) => void | Promise<void>;
  /** Вызывается при получении сообщения */
  message?: (
    ws: ServerWebSocket<T>,
    message: string | Buffer,
  ) => void | Promise<void>;
  /** Вызывается при закрытии соединения */
  close?: (
    ws: ServerWebSocket<T>,
    code: number,
    reason: string,
  ) => void | Promise<void>;
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

/**
 * AsiJS application configuration — passed to `new Asi(config)`.
 *
 * Toggles the context pool, security presets, error-page discovery, the
 * database layer, development mode and more. All fields are optional;
 * each documented field is described inline below.
 */
export interface AsiConfig {
  port?: number;
  hostname?: string;

  /**
   * Database Layer (2.3) — настроить встроенное подключение к БД.
   *
   * SQLite через `bun:sqlite` (zero-dep), PostgreSQL через пакет `postgres`
   * (lazy import, `bun add postgres`). Доступ через `app.db`.
   *
   * ```ts
   * const app = new Asi({
   *   database: {
   *     url: "file:./app.db",
   *     migrationsDir: "./migrations",
   *     autoMigrate: true,
   *   },
   * });
   * ```
   */
  database?: import("./db").DatabaseConfig;

  /** Включить подробные ошибки в dev режиме */
  development?: boolean;
  /** HTML error pages with auto-discovery for 404/500 */
  errorPages?: boolean | ErrorPagesOptions;

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

  /**
   * Cache parsed query strings (QueryParseCache).
   *
   * Повторяющиеся query-строки (pagination, фильтры) не парсятся заново —
   * результат берётся из bounded LRU-кэша и возвращается как shallow copy
   * (мутации ctx.query не портят кэш). Pass a number to set the maximum
   * cache size (default 512).
   *
   * @default true
   */
  queryCache?: boolean | number;

  /**
   * Default response format (formats layer) — "json" (default), "yaml",
   * or a custom `DataFormat`. Object results, errors and 404 bodies are
   * serialized in this format unless the Accept header asks for a
   * registered alternative. Request bodies are parsed by Content-Type via
   * `ctx.parseBody()` regardless.
   *
   * ```ts
   * const app = new Asi({ format: "yaml" });
   * ```
   */
  format?: string | import("./formats").DataFormat;

    /**
   * Плагин для HTTP-сервера (например, nodeAdapter для Node.js)
   * По умолчанию: undefined (используется Bun.serve())
   */
  serverAdapter?: ServerAdapter;

  /**
   * SPA / SSR / Hybrid Rendering mode
   *
   * When enabled:
   * - `spa: true` — serves the SPA client bundle for all non-API routes
   * - `spa: { ... }` — full configuration with SSR + islands
   *
   * In dev mode, HMR is automatically enabled.
   * In production, `asi build` must be run first.
   *
   * @example
   * ```ts
   * // Simple SPA mode
   * const app = new Asi({ spa: true });
   *
   * // With custom config
   * const app = new Asi({
   *   spa: {
   *     clientEntry: "src/client.tsx",
   *     hmr: true,
   *     islands: {
   *       Counter: "./src/islands/counter.tsx",
   *     },
   *   },
   * });
   * ```
   */
  spa?: boolean | import("./spa").SPAOptions;

  /**
   * Router backend selection.
   *
   * - `"radix"` (default) — compressed radix tree with binary-search static
   *   children, inline static-route bypass, and a pre-parsed path cache.
   *   Uses sorted arrays instead of Maps for static segment lookup.
   *   More memory-efficient for 1M+ routes.
   * - `"trie"` — standard segment-based trie router (proven, compatible)
   *
   * @default "radix"
   */
  router?: "trie" | "radix";

  /**
   * Enable the middleware chain flattener.
   * When true, middleware chains are compiled into a single flat async function
   * during compile(), avoiding per-request loop/chain overhead. Flat
   * middlewares (without `next`) are inlined directly — no runtime loop.
   *
   * @default true
   */
  flattenMiddleware?: boolean;

  /**
   * Enable LRU-based schema validator cache instead of the simple Map.
   * Prevents unbounded memory growth with large numbers of schemas.
   * Pass a number to set the maximum cache size (default 10000).
   *
   * @default true
   */
  lruSchemaCache?: boolean | number;

  /**
   * Enable the request Context pool (Recycler pattern).
   *
   * When enabled, `Context` objects are pre-allocated and reused across
   * requests instead of being created per request — removes the per-request
   * Context + Headers allocation from the hot path.
   *
   * Pass an object for fine-grained control:
   * ```ts
   * const app = new Asi({ contextPool: { size: 1000, shrinkIntervalMs: 30_000 } });
   * ```
   *
   * @default true
   */
  contextPool?: boolean | import("./context").ContextPoolOptions;

  /**
   * Built-in security protections.
   *
   * When `true`, enables all protections with sensible defaults:
   * - Auto-escape HTML in string responses (XSS protection)
   * - Request body size limit (1 MB)
   * - CSP nonce auto-generation
   * - Strict Content-Type enforcement (JSON only)
   * - OWASP security headers
   * - Dev-mode vulnerability warnings
   *
   * Pass an object for fine-grained control:
   *
   * @example
   * ```ts
   * // Zero-config: all protections
   * const app = new Asi({ security: true });
   *
   * // Fine-grained config
   * const app = new Asi({
   *   security: {
   *     autoEscape: true,
   *     maxBodySize: "10mb",
   *     autoNonce: false,
   *     strictContentType: "json-only",
   *     headers: true,
   *   },
   * });
   * ```
   */
  security?: SecurityConfig | boolean;
}

/** Route info for public inspection (used by MCP, dev dashboard, etc.) */
export interface RouteInfo {
  method: RouteMethod;
  path: string;
  hasValidation: boolean;
  hasMiddleware: boolean;
}

/** Middleware counts for public inspection */
export interface MiddlewareInfo {
  global: number;
  pathBased: number;
}

/** Public app configuration accessible via getAppConfig() */
export interface AppConfigInfo {
  port: number;
  hostname: string;
  development: boolean;
}

/** Интерфейс для группировки роутов */
export interface GroupBuilder {
  get<
    TBody extends TSchema | undefined = undefined,
    TQuery extends TSchema | undefined = undefined,
    TParams extends TSchema | undefined = undefined,
  >(
    path: string,
    handler: (
      ctx: TypedContext<
        InferSchema<TBody>,
        InferSchema<TQuery, Record<string, string>>,
        InferSchema<TParams, Record<string, string>>
      >,
    ) => unknown | Promise<unknown>,
    options?: RouteOptions<TBody, TQuery, TParams>,
  ): GroupBuilder;

  post<
    TBody extends TSchema | undefined = undefined,
    TQuery extends TSchema | undefined = undefined,
    TParams extends TSchema | undefined = undefined,
  >(
    path: string,
    handler: (
      ctx: TypedContext<
        InferSchema<TBody>,
        InferSchema<TQuery, Record<string, string>>,
        InferSchema<TParams, Record<string, string>>
      >,
    ) => unknown | Promise<unknown>,
    options?: RouteOptions<TBody, TQuery, TParams>,
  ): GroupBuilder;

  put<
    TBody extends TSchema | undefined = undefined,
    TQuery extends TSchema | undefined = undefined,
    TParams extends TSchema | undefined = undefined,
  >(
    path: string,
    handler: (
      ctx: TypedContext<
        InferSchema<TBody>,
        InferSchema<TQuery, Record<string, string>>,
        InferSchema<TParams, Record<string, string>>
      >,
    ) => unknown | Promise<unknown>,
    options?: RouteOptions<TBody, TQuery, TParams>,
  ): GroupBuilder;

  delete<
    TBody extends TSchema | undefined = undefined,
    TQuery extends TSchema | undefined = undefined,
    TParams extends TSchema | undefined = undefined,
  >(
    path: string,
    handler: (
      ctx: TypedContext<
        InferSchema<TBody>,
        InferSchema<TQuery, Record<string, string>>,
        InferSchema<TParams, Record<string, string>>
      >,
    ) => unknown | Promise<unknown>,
    options?: RouteOptions<TBody, TQuery, TParams>,
  ): GroupBuilder;

  patch<
    TBody extends TSchema | undefined = undefined,
    TQuery extends TSchema | undefined = undefined,
    TParams extends TSchema | undefined = undefined,
  >(
    path: string,
    handler: (
      ctx: TypedContext<
        InferSchema<TBody>,
        InferSchema<TQuery, Record<string, string>>,
        InferSchema<TParams, Record<string, string>>
      >,
    ) => unknown | Promise<unknown>,
    options?: RouteOptions<TBody, TQuery, TParams>,
  ): GroupBuilder;

  all<
    TBody extends TSchema | undefined = undefined,
    TQuery extends TSchema | undefined = undefined,
    TParams extends TSchema | undefined = undefined,
  >(
    path: string,
    handler: (
      ctx: TypedContext<
        InferSchema<TBody>,
        InferSchema<TQuery, Record<string, string>>,
        InferSchema<TParams, Record<string, string>>
      >,
    ) => unknown | Promise<unknown>,
    options?: RouteOptions<TBody, TQuery, TParams>,
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
  private middlewareFlatCache: WeakMap<Middleware[], boolean> = new WeakMap();
  private server: ServerHandle | null = null;
  private config: AsiConfig;

  private customErrorHandler: ErrorHandler | null = null;
  private customNotFoundHandler: NotFoundHandler | null = null;

  // WebSocket routes
  private wsRoutes: Map<string, WebSocketRoute<any>> = new Map();

  // Track active WebSocket connections for graceful shutdown
  private activeWsConnections: Set<ServerWebSocket<any>> = new Set();

  // Compilation
  private isCompiled = false;
  private staticRouter = new StaticRouter();
  private compiledRoutes: Map<RouteMethod, Map<string, CompiledRoute>> =
    new Map();

  // Router performance — optional when config.router === "radix"
  private radixRouter: RadixTreeRouter | null = null;

  // Middleware chain flattener — optional when config.flattenMiddleware === true
  private chainFlattener: MiddlewareChainFlattener | null = null;

  // Context pool — Recycler for zero-allocation request cycles
  private contextPool: ContextPool | null = null;

  // Default response/request format (formats) — null = JSON
  private _format: import("./formats").DataFormat | null = null;

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
  private _pluginDeps: PluginDependencyManager = new PluginDependencyManager();
  private _pluginBuilders: Map<string, PluginBuilder> = new Map();
  private _initialized = false;

  // Built-in security
  private _securityManager: SecurityManager | null = null;

  // Database Layer (2.3)
  private _db: import("./db").Database | null = null;
  private _dbInitAttempted = false;

  /**
   * Database connection (2.3). Lazily created from `config.database` on first
   * access. With `autoMigrate: true`, pending migrations run automatically
   * (once) on first access; with `autoSeed`, the seed file runs too.
   */
  get db(): import("./db").Database | null {
    if (!this.config.database) return null;
    if (!this._db && !this._dbInitAttempted) {
      this._dbInitAttempted = true;
      this._db = new Database(this.config.database);

      // Auto-migration (2.3) — lazy, on first database access
      const dbConfig = this.config.database;
      const silent = this.config.silent ?? false;
      if (dbConfig.autoMigrate) {
        try {
          const migrator = new Migrator(this._db, { dir: dbConfig.migrationsDir });
          const result = migrator.up();
          if (result.applied.length > 0 && !silent) {
            console.log(
              `🗄️  Applied ${result.applied.length} migration(s): ${result.applied.join(", ")}`,
            );
          }
        } catch (err) {
          if (!silent) console.warn(`⚠️  Migration failed: ${(err as Error).message}`);
        }
      }

      // Auto-seed — fire-and-forget (TS-сиды могут быть async)
      if (dbConfig.autoSeed && !silent) {
        void (async () => {
          try {
            const { runSeed, findSeedFile } = await import("./db/seed");
            const seedFile = dbConfig.seedFile ?? findSeedFile(process.cwd());
            if (seedFile) {
              await runSeed(this._db!, seedFile);
              console.log(`🌱 Seeded database from ${seedFile}`);
            }
          } catch (err) {
            console.warn(`⚠️  Seed failed: ${(err as Error).message}`);
          }
        })();
      }
    }
    return this._db;
  }

  constructor(config: AsiConfig = {}) {
    // Environment detection
    const env = process.env.BUN_ENV || process.env.NODE_ENV || "development";
    const isProduction = env === "production";
    const isBun = typeof Bun !== "undefined";

    // PORT from environment (PORT=8080 bun dev)
    const envPort = process.env.PORT
      ? parseInt(process.env.PORT, 10)
      : undefined;

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
      console.warn(
        "⚠️  AsiJS is optimized for Bun. Running on Node.js may have reduced performance.",
      );
    }

    // Router performance — radix is the default backend
    if (this.config.router !== "trie") {
      this.radixRouter = new RadixTreeRouter();
    }

    // Context pool — on by default, disable with contextPool: false
    if (this.config.contextPool !== false) {
      this.contextPool = new ContextPool(
        typeof this.config.contextPool === "object"
          ? this.config.contextPool
          : undefined,
      );
    }

    if (this.config.flattenMiddleware !== false) {
      // Use the app's own toResponse so flattened chains still apply
      // Set-Cookie headers and auto-escape (unlike bare toResponseFast)
      this.chainFlattener = new MiddlewareChainFlattener({
        toResponse: (result, ctx) => this.toResponse(result, ctx),
      });
    }

    if (this.config.lruSchemaCache !== false) {
      const maxSize =
        typeof this.config.lruSchemaCache === "number"
          ? this.config.lruSchemaCache
          : 10000;
      enableLRUSchemaCache(maxSize);
    }

    if (this.config.queryCache === false) {
      disableDefaultQueryCache();
    } else {
      getDefaultQueryCache(
        typeof this.config.queryCache === "number"
          ? this.config.queryCache
          : undefined,
      );
    }

    // Default format (formats) — null = JSON
    if (this.config.format) {
      this.setFormat(this.config.format);
    }

    // Built-in security — auto-register middleware chain
    if (this.config.security !== undefined && this.config.security !== false) {
      this._initSecurity();
    }
  }

  /**
   * Initialize the built-in security module.
   * Registers security middleware chain in the correct order.
   */
  private _initSecurity(): void {
    this._securityManager = new SecurityManager(this.config.security!);
    const securityMw = this._securityManager.buildMiddleware({
      development: this.config.development,
    });
    // Add to global middlewares in order (security runs before user middleware)
    for (const mw of securityMw) {
      this.globalMiddlewares.push(mw);
    }
  }

  private get errorPagesOptions(): ErrorPagesOptions | undefined {
    if (this.config.errorPages === false) {
      return { enabled: false };
    }

    if (this.config.errorPages === true || this.config.errorPages === undefined) {
      return undefined;
    }

    return this.config.errorPages;
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
    handler: (
      ctx: TypedContext<
        InferSchema<TBody>,
        InferSchema<TQuery, Record<string, string>>,
        InferSchema<TParams, Record<string, string>>
      >,
    ) => unknown | Promise<unknown>,
    options?: RouteOptions<TBody, TQuery, TParams>,
  ): this {
    return this.route("GET", path, handler as Handler, options);
  }

  post<
    TBody extends TSchema | undefined = undefined,
    TQuery extends TSchema | undefined = undefined,
    TParams extends TSchema | undefined = undefined,
  >(
    path: string,
    handler: (
      ctx: TypedContext<
        InferSchema<TBody>,
        InferSchema<TQuery, Record<string, string>>,
        InferSchema<TParams, Record<string, string>>
      >,
    ) => unknown | Promise<unknown>,
    options?: RouteOptions<TBody, TQuery, TParams>,
  ): this {
    return this.route("POST", path, handler as Handler, options);
  }

  put<
    TBody extends TSchema | undefined = undefined,
    TQuery extends TSchema | undefined = undefined,
    TParams extends TSchema | undefined = undefined,
  >(
    path: string,
    handler: (
      ctx: TypedContext<
        InferSchema<TBody>,
        InferSchema<TQuery, Record<string, string>>,
        InferSchema<TParams, Record<string, string>>
      >,
    ) => unknown | Promise<unknown>,
    options?: RouteOptions<TBody, TQuery, TParams>,
  ): this {
    return this.route("PUT", path, handler as Handler, options);
  }

  delete<
    TBody extends TSchema | undefined = undefined,
    TQuery extends TSchema | undefined = undefined,
    TParams extends TSchema | undefined = undefined,
  >(
    path: string,
    handler: (
      ctx: TypedContext<
        InferSchema<TBody>,
        InferSchema<TQuery, Record<string, string>>,
        InferSchema<TParams, Record<string, string>>
      >,
    ) => unknown | Promise<unknown>,
    options?: RouteOptions<TBody, TQuery, TParams>,
  ): this {
    return this.route("DELETE", path, handler as Handler, options);
  }

  patch<
    TBody extends TSchema | undefined = undefined,
    TQuery extends TSchema | undefined = undefined,
    TParams extends TSchema | undefined = undefined,
  >(
    path: string,
    handler: (
      ctx: TypedContext<
        InferSchema<TBody>,
        InferSchema<TQuery, Record<string, string>>,
        InferSchema<TParams, Record<string, string>>
      >,
    ) => unknown | Promise<unknown>,
    options?: RouteOptions<TBody, TQuery, TParams>,
  ): this {
    return this.route("PATCH", path, handler as Handler, options);
  }

  head<
    TBody extends TSchema | undefined = undefined,
    TQuery extends TSchema | undefined = undefined,
    TParams extends TSchema | undefined = undefined,
  >(
    path: string,
    handler: (
      ctx: TypedContext<
        InferSchema<TBody>,
        InferSchema<TQuery, Record<string, string>>,
        InferSchema<TParams, Record<string, string>>
      >,
    ) => unknown | Promise<unknown>,
    options?: RouteOptions<TBody, TQuery, TParams>,
  ): this {
    return this.route("HEAD", path, handler as Handler, options);
  }

  options<
    TBody extends TSchema | undefined = undefined,
    TQuery extends TSchema | undefined = undefined,
    TParams extends TSchema | undefined = undefined,
  >(
    path: string,
    handler: (
      ctx: TypedContext<
        InferSchema<TBody>,
        InferSchema<TQuery, Record<string, string>>,
        InferSchema<TParams, Record<string, string>>
      >,
    ) => unknown | Promise<unknown>,
    options?: RouteOptions<TBody, TQuery, TParams>,
  ): this {
    return this.route("OPTIONS", path, handler as Handler, options);
  }

  all<
    TBody extends TSchema | undefined = undefined,
    TQuery extends TSchema | undefined = undefined,
    TParams extends TSchema | undefined = undefined,
  >(
    path: string,
    handler: (
      ctx: TypedContext<
        InferSchema<TBody>,
        InferSchema<TQuery, Record<string, string>>,
        InferSchema<TParams, Record<string, string>>
      >,
    ) => unknown | Promise<unknown>,
    options?: RouteOptions<TBody, TQuery, TParams>,
  ): this {
    return this.route("ALL", path, handler as Handler, options);
  }

  /** Добавить роут с любым методом */
  route(
    method: RouteMethod,
    path: string,
    handler: Handler,
    options?: RouteOptions<any, any, any, any, any>,
  ): this {
    // Fire onBeforeRoute hooks before the first route registration
    if (!this._initialized && this._plugins.size > 0) {
      this._fireBeforeRouteHooks();
    }

    const wrappedHandler = this.wrapHandler(handler, options);
    const middlewares = [...this.globalMiddlewares];
    this.router.add(method, path, wrappedHandler, middlewares);

    // Radix tree — keep in sync
    if (this.radixRouter) {
      this.radixRouter.add(method, path, wrappedHandler, middlewares);
    }

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
  private wrapHandler(
    handler: Handler,
    options?: RouteOptions<any, any, any, any, any>,
  ): Handler {
    const schema = options?.schema;
    const hasValidation = schema?.body || schema?.query || schema?.params;
    const hasHooks = options?.beforeHandle || options?.afterHandle;
    const hasResponseSerializer = !!(schema?.response || options?.serializers);

    if (!hasValidation && !hasHooks && !hasResponseSerializer) {
      return handler;
    }

    const beforeHandlers = options?.beforeHandle
      ? Array.isArray(options.beforeHandle)
        ? options.beforeHandle
        : [options.beforeHandle]
      : [];
    const afterHandlers = options?.afterHandle
      ? Array.isArray(options.afterHandle)
        ? options.afterHandle
        : [options.afterHandle]
      : [];

    const wrapped = async (ctx: Context) => {
      // === Валидация ===
      if (hasValidation) {
        const validationErrors: ValidationError[] = [];

        // Валидация body
        if (schema?.body) {
          // Check if it's a FormData schema
          if (isFormDataSchema(schema.body)) {
            try {
              const formData = await ctx.formData();
              const result = await validateFormData(
                formData,
                schema.body as TSchema & FormDataSchemaType,
              );
              if (!result.success) {
                validationErrors.push(
                  ...(result.errors?.map((e) => ({
                    path: `body.${e.field}`,
                    message: e.message,
                  })) ?? []),
                );
              } else {
                ctx._setBody(result.data as any);
                if (result.files) {
                  ctx._setFiles(result.files);
                }
              }
            } catch (err) {
              validationErrors.push({
                path: "body",
                message: "Invalid FormData",
              });
            }
          } else {
            // Regular body — format-aware: parses by Content-Type via the
            // formats layer (JSON native, YAML/TOON/... when registered).
            try {
              const rawBody = await ctx.parseBody();
              const result = validateAndCoerce(schema.body, rawBody);
              if (!result.success) {
                validationErrors.push(
                  ...(result.errors?.map((e) => ({
                    ...e,
                    path: `body${e.path}`,
                  })) ?? []),
                );
              } else {
                ctx._setBody(result.data);
              }
            } catch (err) {
              validationErrors.push({
                path: "body",
                message: "Invalid JSON body",
              });
            }
          }
        }

        // Валидация query
        if (schema?.query) {
          const result = validateAndCoerce(schema.query, ctx.query);
          if (!result.success) {
            validationErrors.push(
              ...(result.errors?.map((e) => ({
                ...e,
                path: `query${e.path}`,
              })) ?? []),
            );
          } else {
            ctx._setQuery(result.data);
          }
        }

        // Валидация params
        if (schema?.params) {
          const result = validateAndCoerce(schema.params, ctx.params);
          if (!result.success) {
            validationErrors.push(
              ...(result.errors?.map((e) => ({
                ...e,
                path: `params${e.path}`,
              })) ?? []),
            );
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

    // === Response serialization (3.2): status-keyed schema + content-type ===
    // Object results are serialized with the compiled response serializer
    // before the default JSON path. Non-matching results flow through.
    return wrapWithResponseSerializer(wrapped, {
      response: schema?.response,
      serializers: options?.serializers,
    });
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
   * }, { roomManager: rooms });
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
    options?: {
      beforeUpgrade?: (request: Request) => boolean | Promise<boolean>;
      /** Room Manager for pub/sub (broadcast, rooms, presence) */
      roomManager?: RoomManager;
    },
  ): this {
    this.wsRoutes.set(path, {
      path,
      handlers,
      beforeUpgrade: options?.beforeUpgrade,
    });

    // Store roomManager reference for use in server websocket handlers
    if (options?.roomManager) {
      this._state.set("roomManager:" + path, options.roomManager);
    }

    return this;
  }

  // ===== Plugin System =====

  /**
   * Register a plugin.
   *
   * Returns a PluginBuilder for chaining `.dependsOn()`, `.withHooks()`, `.lazy()`.
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
   * // Basic usage
   * app.plugin(myPlugin);
   *
   * // With dependencies and hooks
   * app.plugin(authPlugin)
   *   .dependsOn(["sessions", "cors"])
   *   .withHooks({
   *     onAfterInit: (app) => console.log("auth ready"),
   *   });
   * ```
   */
  plugin(plugin: import("./plugin").AsiPlugin): PluginBuilder {
    // If already registered, return existing builder
    if (this._plugins.has(plugin.name)) {
      const existing = this._pluginBuilders.get(plugin.name);
      if (existing) return existing;
    }

    const builder = new PluginBuilder(plugin, async (p, deps, hooks, lazy) => {
      await this._registerPlugin(p, deps, hooks, lazy);
    });

    this._pluginBuilders.set(plugin.name, builder);

    // Register in dependency manager immediately
    this._pluginDeps.addPlugin(
      plugin.name,
      builder.getDependencies(),
      plugin as any,
      builder.getHooks(),
      {
        version: plugin.config.version,
        lazy: builder.isLazy(),
      },
    );

    // Mark as registered
    this._plugins.add(plugin.name);

    // Initialize immediately or defer based on dependencies/lazy flag
    if (builder.isLazy()) {
      this._pluginDeps.setStatus(plugin.name, "pending");
    } else if (this._pluginDeps.areDependenciesReady(plugin.name)) {
      // Fire and forget — plugin init is async but the builder API is sync
      this._initPlugin(plugin, builder.getHooks());
    } else {
      this._pluginDeps.setStatus(plugin.name, "pending");
    }

    return builder;
  }

  /**
   * @internal — Internal plugin registration with dependency management.
   */
  private async _registerPlugin(
    plugin: import("./plugin").AsiPlugin,
    dependencies: string[],
    hooks: PluginHooks,
    lazy: boolean,
  ): Promise<void> {
    if (this._plugins.has(plugin.name)) return;

    // Register in dependency manager
    this._pluginDeps.addPlugin(
      plugin.name,
      dependencies,
      plugin as any,
      hooks,
      {
        version: plugin.config.version,
        lazy,
      },
    );

    // Mark as registered
    this._plugins.add(plugin.name);

    // If lazy, defer initialization
    if (lazy) {
      this._pluginDeps.setStatus(plugin.name, "pending");
      return;
    }

    // Initialize immediately if dependencies are ready
    if (this._pluginDeps.areDependenciesReady(plugin.name)) {
      await this._initPlugin(plugin, hooks);
    } else {
      this._pluginDeps.setStatus(plugin.name, "pending");
    }
  }

  /**
   * @internal — Initialize a single plugin.
   */
  private async _initPlugin(
    plugin: import("./plugin").AsiPlugin,
    hooks: PluginHooks,
  ): Promise<void> {
    this._pluginDeps.setStatus(plugin.name, "initializing");

    // Fire onBeforeInit hook
    if (hooks.onBeforeInit) {
      await hooks.onBeforeInit(this._createPluginHost());
    }

    // Create PluginHost adapter
    const host = this._createPluginHost();

    // Apply plugin
    await plugin.apply(host, this._state, this._decorators);

    this._pluginDeps.setStatus(plugin.name, "initialized");

    // Fire onAfterInit hook
    if (hooks.onAfterInit) {
      await hooks.onAfterInit(host);
    }

    // Check for pending plugins that now have their dependencies ready
    await this._flushPendingPlugins();
  }

  /**
   * @internal — Create a PluginHost adapter bound to this Asi instance.
   */
  private _createPluginHost(): import("./plugin").PluginHost {
    const host: import("./plugin").PluginHost = {
      get: (path, handler, options) => {
        this.get(path, handler as any, options as any);
        return host;
      },
      post: (path, handler, options) => {
        this.post(path, handler as any, options as any);
        return host;
      },
      put: (path, handler, options) => {
        this.put(path, handler as any, options as any);
        return host;
      },
      delete: (path, handler, options) => {
        this.delete(path, handler as any, options as any);
        return host;
      },
      patch: (path, handler, options) => {
        this.patch(path, handler as any, options as any);
        return host;
      },
      all: (path, handler, options) => {
        this.all(path, handler as any, options as any);
        return host;
      },
      ws: (path, handlers, options) => {
        this.ws(path, handlers as any, options as any);
        return host;
      },
      use: (pathOrMw: string | Middleware, mw?: Middleware) => {
        this.use(pathOrMw as any, mw as any);
        return host;
      },
      onBeforeHandle: (handler) => {
        this.onBeforeHandle(handler);
        return host;
      },
      onAfterHandle: (handler) => {
        this.onAfterHandle(handler);
        return host;
      },
      group: (prefix, callback) => {
        this.group(prefix, callback as any);
        return host;
      },
      getState: <T>(key: string) => this._state.get(key) as T | undefined,
      setState: <T>(key: string, value: T) => {
        this._state.set(key, value);
      },
      getDecorator: <T>(key: string) =>
        this._decorators.get(key) as T | undefined,
    };
    return host;
  }

  /**
   * @internal — Initialize any pending plugins whose dependencies are now ready.
   */
  private async _flushPendingPlugins(): Promise<void> {
    const ready = this._pluginDeps.getReadyPlugins();

    for (const node of ready) {
      if (node.plugin) {
        const builder = this._pluginBuilders.get(node.name);
        const hooks = builder?.getHooks() || node.hooks;
        await this._initPlugin(node.plugin, hooks);
      }
    }
  }

  /**
   * Finalise plugin initialisation.
   * Initializes all registered plugins that haven't been initialized yet.
   * Respects dependency order via topological sort.
   *
   * Automatically called by `listen()` and `handle()` if not yet done.
   *
   * @example
   * ```ts
   * const app = new Asi();
   * app.plugin(corsPlugin);
   * app.plugin(authPlugin).dependsOn(["cors"]);
   * await app.initPlugins();
   * app.get("/", () => "Hello");
   * ```
   */
  async initPlugins(): Promise<this> {
    if (this._initialized) return this;
    this._initialized = true;

    // Check for cyclic dependencies
    const cycle = this._pluginDeps.detectCycle();
    if (cycle) {
      throw new CyclicDependencyError(cycle);
    }

    // Resolve init order
    const order = this._pluginDeps.resolveOrder();

    for (const name of order) {
      const node = this._pluginDeps.getPlugin(name);
      if (node && node.plugin && node.status !== "initialized") {
        const builder = this._pluginBuilders.get(name);
        const hooks = builder?.getHooks() || node.hooks;
        await this._initPlugin(node.plugin, hooks);
      }
    }

    return this;
  }

  /**
   * @internal — Fire onBeforeRoute hooks for all registered plugins.
   * Called once when the first route is registered.
   */
  private _firedBeforeRoute = false;
  private _fireBeforeRouteHooks(): void {
    if (this._firedBeforeRoute) return;
    this._firedBeforeRoute = true;

    for (const [name, builder] of this._pluginBuilders) {
      const hooks = builder.getHooks();
      if (hooks.onBeforeRoute) {
        try {
          hooks.onBeforeRoute(this._createPluginHost());
        } catch (error) {
          if (!this.config.silent) console.error(`[Asi] Error in onBeforeRoute hook for plugin "${name}":`, error);
        }
      }
    }
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
   * Set the default response format (formats layer).
   *
   * Accepts a format name ("json" | "yaml") or a custom `DataFormat`.
   * Object results, errors and 404 bodies are serialized in this format
   * unless the Accept header asks for a registered alternative.
   *
   * ```ts
   * app.setFormat("yaml");
   * // or with a custom format:
   * app.setFormat({ name: "toml", contentTypes: [...], ... });
   * ```
   */
  setFormat(format: string | import("./formats").DataFormat): this {
    if (typeof format === "string") {
      if (format === "json") {
        this._format = null;
        return this;
      }
      if (format === "yaml") {
        this._format = registerYamlFormat();
        return this;
      }
      const fmt = getRegisteredFormat(format);
      if (!fmt) {
        throw new Error(
          `[Asi] Unknown format "${format}" — register it with registerFormat() first.`,
        );
      }
      this._format = fmt;
      return this;
    }
    this._format = format;
    return this;
  }

  /**
   * Get the current default response format (formats layer).
   * Returns the JSON format when none was set.
   */
  getFormat(): import("./formats").DataFormat {
    return this._format ?? jsonFormat;
  }

  /**
   * Check if a plugin is registered
   */
  hasPlugin(name: string): boolean {
    return this._plugins.has(name);
  }

  // ===== Public inspection API для плагинов и инструментов (MCP, dashboard) =====

  /**
   * Route info for public inspection.
   */
  getRoutes(): RouteInfo[] {
    return this.routeMetadata.map((m) => ({
      method: m.method,
      path: m.path,
      hasValidation: !!(m.schemas?.body || m.schemas?.query || m.schemas?.params),
      hasMiddleware: m.middlewares.length > 0,
    }));
  }

  /**
   * Get names of all registered plugins.
   */
  getPlugins(): string[] {
    return Array.from(this._plugins);
  }

  /**
   * Get rich plugin info with dependency graph, status, and initialization order.
   * Useful for debugging and the `asi inspect --plugins` command.
   *
   * @example
   * ```ts
   * const info = app.pluginInfo();
   * console.log(info.initOrder); // ["cors", "sessions", "auth"]
   * console.log(info.hasCycle);  // false
   * ```
   */
  pluginInfo(): PluginGraphInfo {
    return this._pluginDeps.getGraphInfo();
  }

  /**
   * Get the dependency manager DOT graph for debugging.
   */
  pluginDepGraph(): string {
    return this._pluginDeps.toDot();
  }

  /**
   * Get middleware counts.
   */
  getMiddlewareInfo(): MiddlewareInfo {
    return {
      global: this.globalMiddlewares.length,
      pathBased: this.pathMiddlewares.size,
    };
  }

  /**
   * Get public app configuration.
   */
  getAppConfig(): AppConfigInfo {
    return {
      port: this.config.port ?? 3000,
      hostname: this.config.hostname ?? "0.0.0.0",
      development: this.config.development ?? false,
    };
  }

  // ===== Route grouping =====

  /** Группировка роутов с общим префиксом */
  group(
    prefix: string,
    callback: (group: GroupBuilder) => void,
    parentMiddlewares: Middleware[] = [],
  ): this {
    const groupMiddlewares: Middleware[] = [...parentMiddlewares];

    // Внутренний метод для добавления роута с group middleware
    const addGroupRoute = (
      method: RouteMethod,
      path: string,
      handler: Handler,
      options?: RouteOptions<any, any, any, any, any>,
    ) => {
      const wrappedHandler = this.wrapHandler(handler, options);
      // Добавляем global + group middleware
      const allMiddlewares = [...this.globalMiddlewares, ...groupMiddlewares];
      this.router.add(method, prefix + path, wrappedHandler, allMiddlewares);
      // Radix tree — keep in sync
      if (this.radixRouter) {
        this.radixRouter.add(method, prefix + path, wrappedHandler, allMiddlewares);
      }
    };

    const groupBuilder: GroupBuilder = {
      get: (path, handler, options) => {
        addGroupRoute("GET", path, handler as Handler, options as any);
        return groupBuilder;
      },
      post: (path, handler, options) => {
        addGroupRoute("POST", path, handler as Handler, options as any);
        return groupBuilder;
      },
      put: (path, handler, options) => {
        addGroupRoute("PUT", path, handler as Handler, options as any);
        return groupBuilder;
      },
      delete: (path, handler, options) => {
        addGroupRoute("DELETE", path, handler as Handler, options as any);
        return groupBuilder;
      },
      patch: (path, handler, options) => {
        addGroupRoute("PATCH", path, handler as Handler, options as any);
        return groupBuilder;
      },
      all: (path, handler, options) => {
        addGroupRoute("ALL", path, handler as Handler, options as any);
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

    // ===== File-based routing =====

  /**
   * Register routes from a file-based routing directory.
   *
   * Scans a directory for route files and registers them automatically.
   *
   * Conventions:
   * - `src/routes/users.ts` with `export function get(ctx) {}` → `GET /users`
   * - `src/routes/users/[id].ts` → `GET /users/:id`
   * - `src/routes/users.get.ts` → `GET /users` (method suffix)
   * - `src/routes/users/index.ts` → `GET /users`
   * - `src/routes/(auth)/login.ts` → `/login` ((group) ignored)
   * - Files/dirs starting with `_` are ignored (private helpers)
   *
   * @example
   * ```ts
   * const app = new Asi();
   * await app.fromFileRoutes();        // scans src/routes/
   * await app.fromFileRoutes({ dir: "app/routes", verbose: true });
   * app.listen(3000);
   * ```
   */
  async fromFileRoutes(
    options: import("./routes").FileRoutesOptions = {},
  ): Promise<this> {
    const { registerFileRoutes } = await import("./routes");
    await registerFileRoutes(this, options);
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
        meta.schemas,
        this._format,
      );

      // Static response precompute (safe subset) — skip when a non-JSON
      // default format is set (the precomputed Response would be JSON).
      if (
        analysis.isStatic &&
        meta.middlewares.length === 0 &&
        !meta.schemas &&
        meta.handler.length === 0 &&
        (!this._format || this._format.name === "json")
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

    // Middleware chain flattener — compile all middleware chains
    if (this.chainFlattener) {
      let flattenedCount = 0;
      for (const meta of this.routeMetadata) {
        this.chainFlattener.flatten(
          meta.handler,
          meta.middlewares,
          meta.method + ":" + meta.path,
        );
        flattenedCount++;
      }
      if (this.config.development) {
        console.log("   Flattened " + flattenedCount + " middleware chains");
      }
    }

    this.isCompiled = true;

    const duration = (performance.now() - startTime).toFixed(2);
    if (this.config.development) {
      console.log(
        `⚡ Compiled ${this.routeMetadata.length} routes in ${duration}ms`,
      );
      console.log(`   Static: ${staticCount}, Dynamic: ${dynamicCount}`);
      if (this.radixRouter) {
        console.log("   Router: radix tree (compressed)");
      }
    }

    return this;
  }

  /** Создать factory для статического Response (без ctx) */
  private _createStaticResponseFactory(
    result: unknown,
  ): (() => Response) | null {
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

    // Lazy context acquisition — только когда нужен (pooled when enabled)
    let ctx: Context | null = null;
    let ctxFromPool = false;
    const getContext = () => {
      if (!ctx) {
        if (this.contextPool) {
          ctx = this.contextPool.acquire(
            request,
            this.config.decodeQuery ?? false,
          );
          ctxFromPool = true;
        } else {
          ctx = new Context(request, {
            decodeQuery: this.config.decodeQuery ?? false,
          });
        }
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

      // === RADIX PATH: Radix tree router (default backend) ===
      if (this.radixRouter) {
        const radixMatch = this.radixRouter.find(method, path);
        if (radixMatch) {
          ctx = getContext();
          ctx.params = radixMatch.params;

          // Path-based middleware (use("/api", mw)) must be merged in,
          // mirroring the trie path. When present we skip the flattener:
          // the merged array is a fresh copy per request, which would miss
          // the compiled-chain cache every time.
          const hasPathMw = this.pathMiddlewares.size > 0;
          const middlewares = hasPathMw
            ? this.mergeMiddlewares(radixMatch.middlewares, path)
            : radixMatch.middlewares;

          // Use flattener if enabled (stable middlewares array → cache hits).
          // Skip it for middleware-free routes: executeHandler() already has
          // a len === 0 fast path that avoids the per-request cache lookup.
          if (this.chainFlattener && !hasPathMw && middlewares.length > 0) {
            const flat = this.chainFlattener.flatten(
              radixMatch.handler,
              middlewares,
              method + ":" + radixMatch.path,
            );
            let response = await flat.execute(ctx);

            // afterHandle
            const afterHandlers = this.globalAfterHandlers;
            for (let i = 0; i < afterHandlers.length; i++) {
              response = await afterHandlers[i](ctx, response);
            }
            return response;
          }

          // Normal execution with radix match (merged path middleware)
          let response = await this.executeHandler(
            ctx,
            middlewares,
            radixMatch.handler,
          );

          const afterHandlers = this.globalAfterHandlers;
          for (let i = 0; i < afterHandlers.length; i++) {
            response = await afterHandlers[i](ctx, response);
          }
          return response;
        }
      }

      // === NORMAL PATH: Dynamic router ===
      // When radix router is active, we already returned above
      // (either with the match or with 404). This path is only
      // reached when radixRouter is null (trie mode).
      const match = this.router.find(method, path);

      // Если есть глобальные middleware — они могут обработать запрос даже без роута
      // (например CORS для OPTIONS)
      const globalMw = this.globalMiddlewares;

      if (!match) {
        ctx = getContext();
        // Если есть глобальные middleware — дать им шанс обработать
        if (globalMw.length > 0) {
          const notFoundHandler = () => this.notFound(ctx!);
          // Await — the finally below releases the pooled ctx, so it must
          // not run while executeHandler is still using ctx asynchronously.
          const mwResponse = await this.executeHandler(
            ctx,
            globalMw,
            notFoundHandler,
          );
          return mwResponse;
        }
        // Await before returning — same pooling-safety reason
        return await this.notFound(ctx);
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
            response =
              pathMw.length === 0
                ? await compiled.execute(ctx)
                : await this.executeHandler(
                    ctx,
                    pathMw,
                    compiled.execute as unknown as Handler,
                  );
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
      // Await first — the finally below releases the pooled context, so it
      // must not run while handleError is still using ctx asynchronously.
      const errorResponse = await this.handleError(ctx, error);
      return errorResponse;
    } finally {
      // Return the context to the pool (if pooled) after the response is built
      if (ctxFromPool && ctx && this.contextPool) {
        this.contextPool.release(ctx);
      }
    }
  }

  /** Объединить route middleware с path middleware (только если есть path middleware) */
  private mergeMiddlewares(
    routeMiddlewares: Middleware[],
    requestPath: string,
  ): Middleware[] {
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
      if (requestPath === pattern || requestPath.startsWith(pattern + "/")) {
        result.push(...middlewares);
      }
    }

    return result;
  }

  private async executeHandler(
    ctx: Context,
    middlewares: Middleware[],
    handler: Handler,
  ): Promise<Response> {
    const len = middlewares.length;

    // Fast path: no middleware
    if (len === 0) {
      const result = await handler(ctx);
      return this.toResponse(result, ctx);
    }

    // Fast path for middlewares without next()
    if (this.isFlatMiddlewares(middlewares)) {
      for (let i = 0; i < len; i++) {
        const result = await (middlewares[i] as (ctx: Context) => unknown)(ctx);
        if (result instanceof Response) return result;
        if (result !== undefined) return this.toResponse(result, ctx);
      }
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
        return result as unknown as Response;
      }

      // Выполнение основного handler
      handlerCalled = true;
      const result = await handler(ctx);
      return this.toResponse(result, ctx);
    };

    return next();
  }

  private isFlatMiddlewares(middlewares: Middleware[]): boolean {
    const cached = this.middlewareFlatCache.get(middlewares);
    if (cached !== undefined) return cached;
    const flat = middlewares.every((mw) => mw.length < 2);
    this.middlewareFlatCache.set(middlewares, flat);
    return flat;
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
      // Formats layer: non-JSON default format or Accept-negotiated format
      const fmt = pickResponseFormat(ctx, this._format);
      if (fmt) {
        return makeFormatResponse(
          fmt.serialize(result),
          fmt,
          ctx,
          status,
          setCookies,
        );
      }
      // JSON response — fast path без cookies
      if (!setCookies || setCookies.length === 0) {
        return status === 200
          ? Response.json(result as any)
          : Response.json(result as any, { status });
      }
      const headers = new Headers({
        "Content-Type": "application/json; charset=utf-8",
      });
      for (const cookie of setCookies) {
        headers.append("Set-Cookie", cookie);
      }
      return new Response(JSON.stringify(result), { status, headers });
    }

    // String → text/plain (with optional auto-escape for XSS protection)
    if (type === "string") {
      let body = result as string;
      if (this._securityManager?.getConfig().autoEscape) {
        body = this._securityManager.escapeResponseBody(body) as string;
      }
      const headers = new Headers({
        "Content-Type": "text/plain; charset=utf-8",
      });
      for (const cookie of setCookies) {
        headers.append("Set-Cookie", cookie);
      }
      return new Response(body, { status, headers });
    }

    // undefined → 204 No Content
    if (result === undefined) {
      return new Response(null, { status: 204 });
    }

    // Number, boolean, etc → string (with optional auto-escape)
    let body = String(result);
    if (this._securityManager?.getConfig().autoEscape) {
      body = this._securityManager.escapeResponseBody(body) as string;
    }
    const headers = new Headers({
      "Content-Type": "text/plain; charset=utf-8",
    });
    for (const cookie of setCookies) {
      headers.append("Set-Cookie", cookie);
    }
    return new Response(body, { status, headers });
  }

  private async notFound(ctx: Context): Promise<Response> {
    const silent = this.config.silent ?? false;
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

    if (shouldRenderHtmlErrorPage(ctx.request)) {
      const pageContext = {
        status: 404 as const,
        path: ctx.path,
        method: ctx.method,
        request: ctx.request,
        development: this.config.development ?? false,
        suggestions,
      };

      // Order: discovered (user custom) → dev pretty → default
      try {
        const discovered = await renderDiscoveredErrorPage(
          404,
          pageContext,
          this.errorPagesOptions,
        );
        if (discovered) return discovered;
      } catch (pageError) {
        if (!silent) console.error("[Asi] Error rendering discovered 404 page:", pageError);
      }

      // In development mode, use the pretty dev error page
      if (this.config.development) {
        try {
          const headers: Record<string, string> = {};
          ctx.request.headers.forEach((v, k) => {
            headers[k] = v;
          });
          return renderDevNotFoundPage({
            status: 404,
            method: ctx.method,
            path: ctx.path,
            headers,
            query: ctx.query as Record<string, string>,
            suggestions,
          });
        } catch (devPageError) {
          if (!silent) console.error("[Asi] Error rendering dev 404 page:", devPageError);
        }
      }

      try {
        return renderDefaultErrorPage(pageContext);
      } catch (defaultPageError) {
        if (!silent) console.error("[Asi] Error rendering default 404 page:", defaultPageError);
      }
    }

    return this._formatResponse(response, ctx, 404);
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

  /** Serialize an error/404 object in the default (or negotiated) format. */
  private _formatResponse(data: unknown, ctx: Context, status: number): Response {
    const fmt = pickResponseFormat(ctx, this._format);
    if (fmt) {
      const setCookies = (ctx as any)._setCookies as string[] | undefined;
      return makeFormatResponse(fmt.serialize(data), fmt, ctx, status, setCookies);
    }
    return ctx.status(status).jsonResponse(data);
  }

  private async handleError(ctx: Context, error: unknown): Promise<Response> {
    const silent = this.config.silent ?? false;
    // Обработка ошибок валидации
    if (error instanceof ValidationException) {
      return this._formatResponse(
        { error: "Validation Error", details: error.errors },
        ctx,
        400,
      );
    }

    if (this.customErrorHandler) {
      try {
        return await this.customErrorHandler(ctx, error);
      } catch (handlerError) {
        if (!silent) console.error("[Asi] Error in custom error handler:", handlerError);
      }
    }

    if (!silent) console.error("[Asi Error]", error);

    const message =
      this.config.development && error instanceof Error
        ? error.message
        : "Internal Server Error";

    const stack =
      this.config.development && error instanceof Error
        ? error.stack
        : undefined;

    if (shouldRenderHtmlErrorPage(ctx.request)) {
      // Order: discovered (user custom) → dev pretty → default
      const pageContext = {
        status: 500 as const,
        path: ctx.path,
        method: ctx.method,
        request: ctx.request,
        development: this.config.development ?? false,
        error,
      };

      try {
        const discovered = await renderDiscoveredErrorPage(
          500,
          pageContext,
          this.errorPagesOptions,
        );
        if (discovered) return discovered;
      } catch (pageError) {
        if (!silent) console.error("[Asi] Error rendering discovered 500 page:", pageError);
      }

      // In development mode, use the pretty dev error page with full details
      if (this.config.development && error instanceof Error) {
        const devCtx: import("./dev-error-page").DevErrorPageContext = {
          status: 500,
          method: ctx.method,
          path: ctx.path,
          headers: (() => {
            const h: Record<string, string> = {};
            ctx.request.headers.forEach((v, k) => { h[k] = v; });
            return h;
          })(),
          query: ctx.query as Record<string, string>,
        };
        try {
          return renderDevErrorPage(error, devCtx);
        } catch (devPageError) {
          if (!silent) console.error("[Asi] Error rendering dev error page:", devPageError);
        }
      }

      try {
        return renderDefaultErrorPage(pageContext);
      } catch (defaultPageError) {
        if (!silent) console.error("[Asi] Error rendering default 500 page:", defaultPageError);
      }
    }

    return this._formatResponse(
      { error: message, ...(stack && { stack }) },
      ctx,
      500,
    );
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
  listen(port?: number, callback?: () => void): ServerHandle {
    // PORT from env takes priority, then argument, then config
    const envPort = process.env.PORT
      ? parseInt(process.env.PORT, 10)
      : undefined;
    const basePort = port ?? envPort ?? this.config.port ?? 3000;
    const autoPort = this.config.autoPort ?? this.config.development ?? true;
    const maxAttempts = this.config.autoPortRange ?? 10;
    const silent = this.config.silent ?? false;

    // Автоматическая компиляция при старте
    if (!this.isCompiled) {
      this.compile();
    }

    // Database Layer (2.3) — авто-миграция/сид запускаются лениво при первом
    // обращении к `app.db` (getter), поэтому здесь ничего не нужно.

    // Если есть WebSocket роуты — используем websocket опцию
    const hasWebSocket = this.wsRoutes.size > 0;

    // Port 0 = random available port
    if (basePort === 0) {
      this.server = this._createServer(0, hasWebSocket);
      const actualPort = this.server.port ?? 0;
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
          console.log(
            `⚠️  Port ${basePort} was in use, using port ${finalPort} instead`,
          );
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
        `Original error: ${lastError?.message}`,
    );
  }

  /** Печать startup banner */
  private _printStartupBanner(
    port: number,
    hasWebSocket: boolean,
    silent: boolean,
  ): void {
    if (silent || this.config.startupBanner === false) return;

    const protocol = this.config.tls ? "https" : "http";
    const env = process.env.BUN_ENV || process.env.NODE_ENV || "development";
    const hostname =
      this.config.hostname === "0.0.0.0" ? "localhost" : this.config.hostname;

    // Count routes
    const staticCount = this.staticRouter.size;
    const dynamicCount = this.routeMetadata.length - staticCount;
    const wsCount = this.wsRoutes.size;

    // Plugins
    const plugins = Array.from(this._plugins).join(", ") || "none";

    // Memory (Bun-specific)
    const heapUsed =
      typeof Bun !== "undefined"
        ? `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB heap`
        : "N/A";

    console.log();
    console.log(`✅ Server started on ${protocol}://${hostname}:${port}`);
    console.log(`   Environment: ${env}`);
    console.log(
      `   Routes: ${this.routeMetadata.length} (${staticCount} static, ${dynamicCount} dynamic${wsCount > 0 ? `, ${wsCount} WebSocket` : ""})`,
    );
    console.log(`   Plugins: ${plugins}`);
    console.log(`   Memory: ${heapUsed}`);
    console.log();
  }

  /** Создать сервер (через адаптер или Bun.serve) */
  private _createServer(port: number, hasWebSocket: boolean): ServerHandle {
    const adapter = this.config.serverAdapter;

    if (adapter) {
      // Convert wsRoutes to adapter config format
      const wsRouteConfigs = hasWebSocket
        ? Array.from(this.wsRoutes.values()).map((route) => ({
            path: route.path,
            beforeUpgrade: route.beforeUpgrade,
            handlers: {
              open: (ws: any) => route.handlers.open?.(ws),
              message: (ws: any, data: any) =>
                route.handlers.message?.(ws, data),
              close: (ws: any, code: number, reason: string) =>
                route.handlers.close?.(ws, code, reason),
              error: (ws: any, error: Error) =>
                route.handlers.error?.(ws, error),
            },
          }))
        : undefined;

      // Используем плагин-адаптер (Node.js, etc.) — синхронный вызов
      return adapter.createServer(
        this,
        {
          port,
          hostname: this.config.hostname ?? "0.0.0.0",
          tls: this.config.tls,
          reusePort: this.config.reusePort,
          maxRequestBodySize: this.config.maxRequestBodySize,
          idleTimeout: this.config.idleTimeout,
          // Pass auto-port config so adapter can handle EADDRINUSE internally
          autoPort: this.config.autoPort ?? this.config.development ?? true,
          autoPortRange: this.config.autoPortRange ?? 10,
          webSocketRoutes: wsRouteConfigs,
        },
        (request: Request) => this.handle(request),
      );
    }

    // Bun-native server (default) — синхронный
    const bunServer = Bun.serve({
      port,
      hostname: this.config.hostname,

      fetch: (request: Request, server: Server<{ path: string }>) => {
        // Проверяем WebSocket upgrade
        if (hasWebSocket) {
          const upgrade = request.headers.get("upgrade");
          if (upgrade === "websocket") {
            const url = new URL(request.url);
            const wsRoute = this.findWsRoute(url.pathname);
            if (!wsRoute) return this.handle(request);
            if (wsRoute.beforeUpgrade) {
              const allowed = wsRoute.beforeUpgrade(request);
              if (allowed instanceof Promise) {
                return allowed.then((ok) => {
                  if (!ok) return new Response("Forbidden", { status: 403 });
                  const success = server.upgrade(request, {
                    data: { path: url.pathname },
                  });
                  return success
                    ? undefined
                    : new Response("Upgrade failed", { status: 500 });
                });
              }
              if (!allowed) return new Response("Forbidden", { status: 403 });
            }

            const success = server.upgrade(request, {
              data: { path: url.pathname },
            });
            if (success) return undefined;
          }
        }

        return this.handle(request);
      },

      ...(hasWebSocket && {
        websocket: {
          open: (ws: ServerWebSocket<{ path: string }>) => {
            this.activeWsConnections.add(ws);
            const route = this.findWsRoute(ws.data.path);
            route?.handlers.open?.(ws);
          },
          message: (
            ws: ServerWebSocket<{ path: string }>,
            message: string | Buffer,
          ) => {
            const route = this.findWsRoute(ws.data.path);
            route?.handlers.message?.(ws, message);
          },
          close: (
            ws: ServerWebSocket<{ path: string }>,
            code: number,
            reason: string,
          ) => {
            this.activeWsConnections.delete(ws);
            const route = this.findWsRoute(ws.data.path);
            route?.handlers.close?.(ws, code, reason);
          },
          error: (ws: ServerWebSocket<{ path: string }>, error: Error) => {
            this.activeWsConnections.delete(ws);
            const route = this.findWsRoute(ws.data.path);
            route?.handlers.error?.(ws, error);
          },
          drain: (ws: ServerWebSocket<{ path: string }>) => {
            const route = this.findWsRoute(ws.data.path);
            route?.handlers.drain?.(ws);
          },
        },
      }),

      reusePort: this.config.reusePort,
      maxRequestBodySize: this.config.maxRequestBodySize,
      idleTimeout: this.config.idleTimeout,

      ...(this.config.tls && {
        tls: this.config.tls,
      }),
    } as any) as unknown as ServerHandle;

    return bunServer;
  }

  /**
   * Gracefully drain all active WebSocket connections
   *
   * Sends close frame (1001 - Going Away) to all active connections,
   * waits for them to close gracefully, then forcefully terminates
   * any remaining connections after the timeout.
   *
   * @param timeoutMs Maximum time to wait for connections to close (default 10000ms)
   */
  async drainWebSockets(timeoutMs: number = 10000): Promise<void> {
    if (this.activeWsConnections.size === 0) return;

    const connections = Array.from(this.activeWsConnections);
    const count = connections.length;

    // Send close frame (1001 = Going Away) to all active connections
    for (const ws of connections) {
      try {
        ws.close(1001, "Server shutting down");
      } catch {
        // Ignore errors during close (connection may already be gone)
      }
    }

    // Wait for all connections to close gracefully
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && this.activeWsConnections.size > 0) {
      await new Promise((r) => setTimeout(r, 100));
    }

    // Forcefully terminate any remaining connections
    if (this.activeWsConnections.size > 0) {
      const remaining = Array.from(this.activeWsConnections);
      for (const ws of remaining) {
        try {
          ws.terminate();
        } catch {
          // Ignore errors
        }
      }
      this.activeWsConnections.clear();
    }
  }

  /**
   * Get the number of active WebSocket connections.
   * Useful for monitoring and health checks.
   */
  get wsConnectionCount(): number {
    return this.activeWsConnections.size;
  }

  /** Остановить сервер */
  stop(): void {
    this.server?.stop();
    this.server = null;
    this.activeWsConnections.clear();
  }
}
