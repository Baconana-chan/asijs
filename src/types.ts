import type { TSchema, Static } from "@sinclair/typebox";
import type { Context, TypedContext } from "./context";

export type RouteMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "DELETE"
  | "PATCH"
  | "HEAD"
  | "OPTIONS"
  | "ALL";

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

export interface Route {
  method: RouteMethod;
  path: string;
  handler: Handler;
  middlewares: Middleware[];
}

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
  /** Схема ответа (для документации и клиента) */
  response?: TResponse;
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
}

/** Вывод типа из TSchema или fallback */
export type InferSchema<
  T extends TSchema | undefined,
  Fallback = unknown,
> = T extends TSchema ? Static<T> : Fallback;
