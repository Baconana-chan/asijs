/**
 * Core shared types — routes, handlers, middleware and validation schemas.
 *
 * Everything here is framework-wide: `Handler` / `Middleware` are the shapes
 * every route and plugin works with, `RouteOptions` / `RouteSchema` configure
 * validation, and `InferSchema` derives TypeScript types from TypeBox schemas.
 */

import type { TSchema, Static } from "@sinclair/typebox";
import type { Context, TypedContext } from "./context";

/** HTTP methods supported by the router. `"ALL"` matches every method. */
export type RouteMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "DELETE"
  | "PATCH"
  | "HEAD"
  | "OPTIONS"
  | "ALL";

/**
 * Route handler — receives the request context and returns a value.
 * Objects are serialized to JSON, strings to text, `Response` is used as-is.
 */
export type Handler<T = unknown> = (ctx: Context) => T | Promise<T>;

/** Типизированный handler с выводом типов из схемы */
export type TypedHandler<
  TBody = unknown,
  TQuery = Record<string, string>,
  TParams = Record<string, string>,
  TResponse = unknown,
> = (
  ctx: TypedContext<TBody, TQuery, TParams>,
) => TResponse | Promise<TResponse>;

/**
 * Middleware — runs before the handler. May short-circuit the request by
 * returning a `Response`, or delegate to `next()` and post-process its result.
 */
export type Middleware = (
  ctx: Context,
  next: () => Promise<Response>,
) => Response | Promise<Response> | void | Promise<void>;

/** Хук перед выполнением handler */
export type BeforeHandler = (
  ctx: Context,
) => void | Response | Promise<void | Response>;

/** Хук после выполнения handler */
export type AfterHandler = (
  ctx: Context,
  response: Response,
) => Response | Promise<Response>;

/** Кастомный обработчик ошибок */
export type ErrorHandler = (
  ctx: Context,
  error: unknown,
) => Response | Promise<Response>;

/** Кастомный обработчик 404 */
export type NotFoundHandler = (ctx: Context) => Response | Promise<Response>;

/** An internal route registration (method + path + handler + middlewares). */
export interface Route {
  method: RouteMethod;
  path: string;
  handler: Handler;
  middlewares: Middleware[];
}

/** Result of matching a request path against the route table (params extracted). */
export interface RouteMatch {
  path: string;
  handler: Handler;
  params: Record<string, string>;
  middlewares: Middleware[];
}

/** Схема валидации для роута */
export interface RouteSchema<
  TBody extends TSchema | undefined = undefined,
  TQuery extends TSchema | undefined = undefined,
  TParams extends TSchema | undefined = undefined,
  THeaders extends TSchema | undefined = undefined,
  TResponse extends TSchema | undefined = undefined,
> {
  /** Схема тела запроса */
  body?: TBody;
  /** Схема query параметров */
  query?: TQuery;
  /** Схема path параметров */
  params?: TParams;
  /** Схема заголовков */
  headers?: THeaders;
  /**
   * Схема ответа: одиночная TypeBox-схема (сериализация по умолчанию),
   * либо статусно-ключевая map `{ 200: schema, "2xx": schema, default: schema }`
   * для сериализации по статусу (3.2).
   */
  response?: TResponse | Record<string | number, TSchema>;
}

/** Опции для регистрации роута */
export interface RouteOptions<
  TBody extends TSchema | undefined = undefined,
  TQuery extends TSchema | undefined = undefined,
  TParams extends TSchema | undefined = undefined,
  THeaders extends TSchema | undefined = undefined,
  TResponse extends TSchema | undefined = undefined,
> {
  /** Схема валидации */
  schema?: RouteSchema<TBody, TQuery, TParams, THeaders, TResponse>;
  /** Middleware только для этого роута */
  beforeHandle?: BeforeHandler | BeforeHandler[];
  /** Хук после handler */
  afterHandle?: AfterHandler | AfterHandler[];
  /**
   * Per-content-type response serializers (3.2):
   * content-type → TypeBox schema or serializer fn. Picked via the
   * request's Accept header; falls back to `schema.response` / JSON.
   */
  serializers?: Record<string, TSchema | ((value: unknown) => string)>;
}

/** Вывод типа из TSchema или fallback */
export type InferSchema<
  T extends TSchema | undefined,
  Fallback = unknown,
> = T extends TSchema ? Static<T> : Fallback;
