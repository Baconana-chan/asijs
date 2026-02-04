/**
 * CORS Plugin для AsiJS
 * 
 * @example
 * ```ts
 * import { Asi } from "asijs";
 * import { cors } from "asijs/plugins/cors";
 * 
 * const app = new Asi();
 * app.use(cors());
 * // или с опциями:
 * app.use(cors({
 *   origin: "https://example.com",
 *   methods: ["GET", "POST"],
 *   credentials: true,
 * }));
 * ```
 */

import type { Middleware } from "../types";
import type { Context } from "../context";

export interface CorsOptions {
  /** 
   * Разрешённые origins
   * - true: все origins (*)
   * - string: конкретный origin
   * - string[]: список origins
   * - (origin: string) => boolean: функция проверки
   * @default true
   */
  origin?: boolean | string | string[] | ((origin: string) => boolean);
  
  /**
   * Разрешённые HTTP методы
   * @default ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH"]
   */
  methods?: string[];
  
  /**
   * Разрешённые заголовки в запросе
   * @default [] (отражает Access-Control-Request-Headers)
   */
  allowedHeaders?: string[];
  
  /**
   * Заголовки которые можно читать на клиенте
   * @default []
   */
  exposedHeaders?: string[];
  
  /**
   * Разрешить отправку credentials (cookies, auth headers)
   * @default false
   */
  credentials?: boolean;
  
  /**
   * Время кэширования preflight ответа в секундах
   * @default 86400 (24 часа)
   */
  maxAge?: number;
  
  /**
   * Автоматически отвечать на preflight (OPTIONS)
   * @default true
   */
  preflight?: boolean;
}

const DEFAULT_METHODS = ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH"];
const DEFAULT_MAX_AGE = 86400;

/**
 * Создать CORS middleware
 */
export function cors(options: CorsOptions = {}): Middleware {
  const {
    origin = true,
    methods = DEFAULT_METHODS,
    allowedHeaders = [],
    exposedHeaders = [],
    credentials = false,
    maxAge = DEFAULT_MAX_AGE,
    preflight = true,
  } = options;

  const methodsHeader = methods.join(", ");
  const exposedHeadersHeader = exposedHeaders.length > 0 
    ? exposedHeaders.join(", ") 
    : null;

  // Функция проверки origin
  const checkOrigin = (requestOrigin: string | null): string | null => {
    if (!requestOrigin) return null;
    
    if (origin === true) {
      return requestOrigin; // Отражаем origin запроса
    }
    
    if (origin === false) {
      return null;
    }
    
    if (typeof origin === "string") {
      return origin === requestOrigin ? origin : null;
    }
    
    if (Array.isArray(origin)) {
      return origin.includes(requestOrigin) ? requestOrigin : null;
    }
    
    if (typeof origin === "function") {
      return origin(requestOrigin) ? requestOrigin : null;
    }
    
    return null;
  };

  return async (ctx: Context, next: () => Promise<Response>): Promise<Response> => {
    const requestOrigin = ctx.header("Origin");
    const allowedOrigin = checkOrigin(requestOrigin);

    // Preflight request (OPTIONS)
    if (preflight && ctx.method === "OPTIONS") {
      const headers = new Headers();
      
      if (allowedOrigin) {
        headers.set("Access-Control-Allow-Origin", allowedOrigin);
      }
      
      headers.set("Access-Control-Allow-Methods", methodsHeader);
      
      // Reflect requested headers or use configured
      const requestedHeaders = ctx.header("Access-Control-Request-Headers");
      if (requestedHeaders && allowedHeaders.length === 0) {
        headers.set("Access-Control-Allow-Headers", requestedHeaders);
      } else if (allowedHeaders.length > 0) {
        headers.set("Access-Control-Allow-Headers", allowedHeaders.join(", "));
      }
      
      if (credentials) {
        headers.set("Access-Control-Allow-Credentials", "true");
      }
      
      headers.set("Access-Control-Max-Age", String(maxAge));
      
      // Preflight не нуждается в теле
      return new Response(null, { status: 204, headers });
    }

    // Обычный запрос — добавляем CORS заголовки к ответу
    const response = await next();
    
    if (allowedOrigin) {
      response.headers.set("Access-Control-Allow-Origin", allowedOrigin);
    }
    
    if (credentials) {
      response.headers.set("Access-Control-Allow-Credentials", "true");
    }
    
    if (exposedHeadersHeader) {
      response.headers.set("Access-Control-Expose-Headers", exposedHeadersHeader);
    }
    
    // Vary header для правильного кэширования
    const vary = response.headers.get("Vary");
    if (vary) {
      if (!vary.includes("Origin")) {
        response.headers.set("Vary", `${vary}, Origin`);
      }
    } else {
      response.headers.set("Vary", "Origin");
    }
    
    return response;
  };
}

export default cors;
