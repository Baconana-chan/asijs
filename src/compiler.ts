/**
 * Static Code Analysis & Route Compilation
 * 
 * Оптимизация: предкомпиляция роутов в быстрые функции
 * без лишних проверок в runtime
 */

import type { TSchema } from "@sinclair/typebox";
import { TypeCompiler, type TypeCheck } from "@sinclair/typebox/compiler";
import type { Handler, Middleware, RouteMethod } from "./types";
import type { Context } from "./context";

/** Скомпилированный роут */
export interface CompiledRoute {
  method: RouteMethod;
  path: string;
  /** Скомпилированный handler (middleware уже встроены) */
  execute: (ctx: Context) => Promise<Response>;
  /** Скомпилированные валидаторы */
  validators?: {
    body?: TypeCheck<TSchema>;
    query?: TypeCheck<TSchema>;
    params?: TypeCheck<TSchema>;
  };
}

/** Опции компиляции */
export interface CompileOptions {
  /** Включить строгую валидацию */
  strictValidation?: boolean;
  /** Кэшировать скомпилированные валидаторы */
  cacheValidators?: boolean;
}

// Кэш скомпилированных TypeBox схем
const validatorCache = new Map<TSchema, TypeCheck<TSchema>>();

/**
 * Скомпилировать TypeBox схему в быстрый валидатор
 */
export function compileSchema<T extends TSchema>(schema: T): TypeCheck<T> {
  // Проверяем кэш
  const cached = validatorCache.get(schema);
  if (cached) return cached as TypeCheck<T>;
  
  // Компилируем
  const compiled = TypeCompiler.Compile(schema);
  validatorCache.set(schema, compiled);
  
  return compiled;
}

/**
 * Создать скомпилированный handler с встроенными middleware
 */
export function compileHandler(
  handler: Handler,
  middlewares: Middleware[],
  schemas?: {
    body?: TSchema;
    query?: TSchema;
    params?: TSchema;
  }
): (ctx: Context) => Promise<Response> {
  // Предкомпилируем валидаторы
  const validators = schemas ? {
    body: schemas.body ? compileSchema(schemas.body) : undefined,
    query: schemas.query ? compileSchema(schemas.query) : undefined,
    params: schemas.params ? compileSchema(schemas.params) : undefined,
  } : undefined;

  const middlewareCount = middlewares.length;
  const flatMiddlewares = middlewareCount > 0 && middlewares.every(mw => mw.length < 2);

  // Без middleware и валидации — самый быстрый путь
  if (middlewareCount === 0 && !validators) {
    return async (ctx: Context): Promise<Response> => {
      const result = await handler(ctx);
      return toResponseFast(result, ctx);
    };
  }

  // Только валидация, без middleware
  if (middlewareCount === 0 && validators) {
    return async (ctx: Context): Promise<Response> => {
      // Валидация
      if (validators.params) {
        if (!validators.params.Check(ctx.params)) {
          return validationError("params", validators.params.Errors(ctx.params));
        }
      }
      
      if (validators.query) {
        const query = ctx.query;
        if (!validators.query.Check(query)) {
          return validationError("query", validators.query.Errors(query));
        }
        (ctx as any)._query = query;
      }
      
      if (validators.body) {
        const body = await ctx.json();
        if (!validators.body.Check(body)) {
          return validationError("body", validators.body.Errors(body));
        }
        (ctx as any).body = body;
      }
      
      const result = await handler(ctx);
      return toResponseFast(result, ctx);
    };
  }

  // Flat middleware (без next) — последовательное выполнение без chain
  if (flatMiddlewares) {
    return async (ctx: Context): Promise<Response> => {
      // Валидация сначала
      if (validators) {
        if (validators.params && !validators.params.Check(ctx.params)) {
          return validationError("params", validators.params.Errors(ctx.params));
        }
        
        if (validators.query) {
          const query = ctx.query;
          if (!validators.query.Check(query)) {
            return validationError("query", validators.query.Errors(query));
          }
        }
        
        if (validators.body) {
          const body = await ctx.json();
          if (!validators.body.Check(body)) {
            return validationError("body", validators.body.Errors(body));
          }
          (ctx as any).body = body;
        }
      }

      for (let i = 0; i < middlewareCount; i++) {
        const result = await (middlewares[i] as (ctx: Context) => Response | Promise<Response> | void)(ctx);
        if (result instanceof Response) return result;
        if (result !== undefined) return toResponseFast(result, ctx);
      }

      const result = await handler(ctx);
      return toResponseFast(result, ctx);
    };
  }

  // С middleware — используем итеративный подход вместо рекурсии
  return async (ctx: Context): Promise<Response> => {
    // Валидация сначала
    if (validators) {
      if (validators.params && !validators.params.Check(ctx.params)) {
        return validationError("params", validators.params.Errors(ctx.params));
      }
      
      if (validators.query) {
        const query = ctx.query;
        if (!validators.query.Check(query)) {
          return validationError("query", validators.query.Errors(query));
        }
      }

      if (validators.body) {
        const body = await ctx.json();
        if (!validators.body.Check(body)) {
          return validationError("body", validators.body.Errors(body));
        }
        (ctx as any).body = body;
      }
    }

    // Выполняем middleware chain
    let index = 0;
    
    const next = async (): Promise<Response> => {
      if (index < middlewareCount) {
        const mw = middlewares[index++];
        const result = await mw(ctx, next);
        if (result instanceof Response) return result;
        return result as unknown as Response;
      }
      
      const result = await handler(ctx);
      return toResponseFast(result, ctx);
    };
    
    return next();
  };
}

/**
 * Быстрое преобразование результата в Response (inline)
 */
function toResponseFast(result: unknown, ctx: Context): Response {
  if (result instanceof Response) return result;
  
  const type = typeof result;
  const status = (ctx as any)._status || 200;
  
  if (type === "object") {
    if (result === null) return new Response(null, { status: 204 });
    if (result instanceof Blob) return new Response(result);
    return status === 200
      ? Response.json(result as any)
      : Response.json(result as any, { status });
  }
  
  if (type === "string") {
    return new Response(result as string, {
      status,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  
  if (result === undefined) {
    return new Response(null, { status: 204 });
  }
  
  return new Response(String(result), {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/**
 * Создать ошибку валидации
 */
function validationError(field: string, errors: Iterable<any>): Response {
  const details = Array.from(errors).map(e => ({
    path: e.path,
    message: e.message,
  }));
  
  return new Response(JSON.stringify({
    error: "Validation Error",
    field,
    details,
  }), {
    status: 400,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/**
 * Анализ роута для оптимизации
 */
export interface RouteAnalysis {
  /** Путь статический (без параметров) */
  isStatic: boolean;
  /** Количество сегментов */
  segmentCount: number;
  /** Имена параметров */
  paramNames: string[];
  /** Есть wildcard */
  hasWildcard: boolean;
  /** Есть схема валидации */
  hasValidation: boolean;
  /** Количество middleware */
  middlewareCount: number;
}

/**
 * Проанализировать роут
 */
export function analyzeRoute(
  path: string,
  middlewares: Middleware[],
  schemas?: { body?: TSchema; query?: TSchema; params?: TSchema }
): RouteAnalysis {
  const segments = path.split("/").filter(Boolean);
  const paramNames: string[] = [];
  let hasWildcard = false;
  
  for (const seg of segments) {
    if (seg.startsWith(":")) {
      paramNames.push(seg.slice(1));
    } else if (seg === "*") {
      hasWildcard = true;
    }
  }
  
  return {
    isStatic: paramNames.length === 0 && !hasWildcard,
    segmentCount: segments.length,
    paramNames,
    hasWildcard,
    hasValidation: !!(schemas?.body || schemas?.query || schemas?.params),
    middlewareCount: middlewares.length,
  };
}

/**
 * Оптимизированный статический роутер для compile-time known routes
 */
export class StaticRouter {
  private staticRoutes: Map<string, Map<RouteMethod, CompiledRoute>> = new Map();
  
  /** Добавить статический роут (без параметров) */
  add(route: CompiledRoute): void {
    if (!this.staticRoutes.has(route.path)) {
      this.staticRoutes.set(route.path, new Map());
    }
    this.staticRoutes.get(route.path)!.set(route.method, route);
  }
  
  /** Найти статический роут */
  find(method: RouteMethod, path: string): CompiledRoute | null {
    const routes = this.staticRoutes.get(path);
    if (!routes) return null;
    
    return routes.get(method) || routes.get("ALL" as RouteMethod) || null;
  }
  
  /** Проверить есть ли статические роуты */
  get hasRoutes(): boolean {
    return this.staticRoutes.size > 0;
  }
  
  /** Количество статических роутов */
  get size(): number {
    let count = 0;
    for (const methods of this.staticRoutes.values()) {
      count += methods.size;
    }
    return count;
  }
  
  /** Получить все статические пути */
  get paths(): string[] {
    return Array.from(this.staticRoutes.keys());
  }
}

/**
 * Генератор кода для роутов (advanced)
 * Создаёт оптимизированные функции match
 */
export function generateRouteMatcherCode(routes: Array<{ method: RouteMethod; path: string }>): string {
  const lines: string[] = [
    "// Auto-generated route matcher",
    "export function matchRoute(method, path) {",
  ];
  
  // Группируем по первому сегменту для быстрого отсечения
  const byFirstSegment = new Map<string, typeof routes>();
  
  for (const route of routes) {
    const segments = route.path.split("/").filter(Boolean);
    const first = segments[0] || "";
    
    if (!byFirstSegment.has(first)) {
      byFirstSegment.set(first, []);
    }
    byFirstSegment.get(first)!.push(route);
  }
  
  lines.push("  const segments = path.split('/').filter(Boolean);");
  lines.push("  const first = segments[0] || '';");
  lines.push("  ");
  lines.push("  switch (first) {");
  
  for (const [first, groupRoutes] of byFirstSegment) {
    if (first.startsWith(":")) {
      // Параметр — default case
      continue;
    }
    
    lines.push(`    case "${first}":`);
    
    for (const route of groupRoutes) {
      const segments = route.path.split("/").filter(Boolean);
      lines.push(`      // ${route.method} ${route.path}`);
      lines.push(`      if (method === "${route.method}" && segments.length === ${segments.length}) {`);
      lines.push(`        // TODO: full match logic`);
      lines.push(`        return { matched: true, route: "${route.path}" };`);
      lines.push(`      }`);
    }
    
    lines.push("      break;");
  }
  
  lines.push("    default:");
  lines.push("      break;");
  lines.push("  }");
  lines.push("  ");
  lines.push("  return null;");
  lines.push("}");
  
  return lines.join("\n");
}

export default {
  compileSchema,
  compileHandler,
  analyzeRoute,
  StaticRouter,
  generateRouteMatcherCode,
};
