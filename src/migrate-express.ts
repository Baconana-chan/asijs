/**
 * Migration from Express.js to AsiJS
 *
 * Two-part migration:
 * 1. **Runtime adapter** — wraps Express middleware so it runs inside AsiJS
 * 2. **Codemod transforms** — converts Express source code to AsiJS syntax
 *
 * @example
 * ```ts
 * import { Asi, expressPlugin } from "asijs";
 *
 * const app = new Asi();
 *
 * // Step 1: Run existing Express middleware inside AsiJS
 * app.use(expressPlugin.wrap(cors()));
 * app.use(expressPlugin.wrap(helmet()));
 *
 * // Step 2: Use the codemod to transform source code
 * // $ asi integrate ./app.js
 * ```
 */

import type { Middleware } from "./types";
import type { Context } from "./context";

// ============================================================================
// Types
// ============================================================================

/** Express-compatible request (subset of IncomingMessage) */
export interface ExpressReq {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string>;
  params: Record<string, string>;
  body?: unknown;
  ip?: string;
  originalUrl?: string;
  /** Get a header value */
  get(name: string): string | undefined;
  header(name: string): string | undefined;
  accepts(type: string): boolean;
}

/** Express-compatible response (subset of ServerResponse) */
export interface ExpressRes {
  statusCode: number;
  _headers: Record<string, string | string[] | undefined>;
  body?: unknown;

  status(code: number): ExpressRes;
  send(body: unknown): ExpressRes;
  json(body: unknown): ExpressRes;
  type(type: string): ExpressRes;
  set(field: string, value: string): ExpressRes;
  set(fields: Record<string, string>): ExpressRes;
  get(field: string): string | undefined;
  header(field: string, value: string): ExpressRes;
  redirect(statusOrUrl: number | string, url?: string): void;
  end(): void;
  setHeader(name: string, value: string): void;
  getHeader(name: string): string | undefined;
  removeHeader(name: string): void;
  write(chunk: unknown): boolean;
}

/** Express middleware handler signature */
export type ExpressHandler = (
  req: ExpressReq,
  res: ExpressRes,
  next: (err?: unknown) => void,
) => void | Promise<void>;

/** Express error middleware signature */
export type ExpressErrorHandler = (
  err: unknown,
  req: ExpressReq,
  res: ExpressRes,
  next: (err?: unknown) => void,
) => void | Promise<void>;

// ============================================================================
// Runtime Adapter — wrap Express middleware for use in AsiJS
// ============================================================================

/**
 * Create an Express-compatible request object from an AsiJS context.
 */
function createExpressReq(ctx: Context): ExpressReq {
  const headers: Record<string, string | string[] | undefined> = {};
  ctx.request.headers.forEach((value, key) => {
    const existing = headers[key];
    if (existing !== undefined) {
      headers[key] = Array.isArray(existing)
        ? [...existing, value]
        : [existing, value];
    } else {
      headers[key] = value;
    }
  });

  return {
    method: ctx.method,
    url: ctx.url.toString(),
    path: ctx.path,
    headers,
    query: ctx.query as Record<string, string>,
    params: { ...ctx.params },
    get(name: string) {
      return ctx.request.headers.get(name) ?? undefined;
    },
    header(name: string) {
      return ctx.request.headers.get(name) ?? undefined;
    },
    accepts(_type: string) {
      return true;
    },
  };
}

/**
 * Create an Express-compatible response object from an AsiJS context.
 */
function createExpressRes(ctx: Context): ExpressRes {
  const sentHeaders: Record<string, string | string[] | undefined> = {};
  let statusCode = 200;
  let body: unknown = undefined;
  let isFinished = false;

  const res: ExpressRes = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(code: number) {
      statusCode = code;
    },
    _headers: sentHeaders,

    status(code: number) {
      statusCode = code;
      return res;
    },

    send(data: unknown) {
      body = data;
      isFinished = true;
      return res;
    },

    json(data: unknown) {
      body = data;
      sentHeaders["Content-Type"] = "application/json; charset=utf-8";
      isFinished = true;
      return res;
    },

    type(type: string) {
      sentHeaders["Content-Type"] = type;
      return res;
    },

    set(field: string | Record<string, string>, value?: string) {
      if (typeof field === "object") {
        for (const [k, v] of Object.entries(field)) {
          sentHeaders[k] = v;
        }
      } else {
        sentHeaders[field] = value;
      }
      return res;
    },

    get(field: string) {
      return (sentHeaders[field] as string) ?? undefined;
    },

    header(field: string, value: string) {
      sentHeaders[field] = value;
      return res;
    },

    redirect(statusOrUrl: number | string, url?: string) {
      const [redirectStatus, redirectUrl] =
        typeof statusOrUrl === "number"
          ? [statusOrUrl, url!]
          : [302, statusOrUrl];
      statusCode = redirectStatus;
      sentHeaders["Location"] = redirectUrl;
      isFinished = true;
    },

    end() {
      isFinished = true;
    },

    setHeader(name: string, value: string) {
      sentHeaders[name] = value;
    },

    getHeader(name: string) {
      return sentHeaders[name] as string | undefined;
    },

    removeHeader(name: string) {
      delete sentHeaders[name];
    },

    write(chunk: unknown) {
      body = body !== undefined ? String(body) + String(chunk) : String(chunk);
      return true;
    },
  };

  // Store sent data for conversion back to AsiJS response
  (res as any)._getResult = () => {
    const headers = new Headers();
    for (const [key, value] of Object.entries(sentHeaders)) {
      if (value !== undefined) {
        if (Array.isArray(value)) {
          for (const v of value) {
            headers.append(key, v);
          }
        } else {
          headers.set(key, value);
        }
      }
    }
    return { body, statusCode, headers };
  };
  (res as any)._isFinished = () => isFinished;

  return res;
}

/**
 * Wrap an Express middleware function for use in AsiJS.
 *
 * @example
 * ```ts
 * import cors from "cors";
 * import { Asi, expressPlugin } from "asijs";
 *
 * const app = new Asi();
 * app.use(expressPlugin.wrap(cors()));
 * ```
 */
function wrapExpressMiddleware(
  handler: ExpressHandler | ExpressErrorHandler,
): Middleware {
  return async (ctx: Context, next: () => Promise<Response>) => {
    const req = createExpressReq(ctx);
    const res = createExpressRes(ctx);
    let middlewareCompleted = false;
    let error: unknown = undefined;

    // Run the Express middleware
    await new Promise<void>((resolve, reject) => {
      const done = (err?: unknown) => {
        middlewareCompleted = true;
        if (err) {
          error = err;
          reject(err);
        } else {
          resolve();
        }
      };

      try {
        if (handler.length >= 4) {
          // Error handler (err, req, res, next)
          // In Express, error handlers are invoked when next(err) is called
          // Since this is a wrapper, we just call the handler with undefined err
          (handler as ExpressErrorHandler)(undefined, req, res, done as any);
        } else {
          (handler as ExpressHandler)(req, res, done as any);
        }
      } catch (err) {
        error = err;
        middlewareCompleted = true;
        reject(err);
      }
    }).catch((err) => {
      error = err;
    });

    // If the middleware finished the response, convert to AsiJS Response
    if ((res as any)._isFinished()) {
      const { body: resBody, statusCode: status, headers } = (res as any)._getResult();
      const headerObj: Record<string, string> = {};
      headers.forEach((v: string, k: string) => { headerObj[k] = v; });
      if (resBody !== undefined) {
        return new Response(
          typeof resBody === "object" ? JSON.stringify(resBody) : String(resBody),
          {
            status,
            headers: {
              ...headerObj,
              ...(typeof resBody === "object"
                ? { "Content-Type": "application/json; charset=utf-8" }
                : {}),
            },
          },
        );
      }
      return new Response(null, { status, headers: headerObj });
    }

    // Proceed to next middleware/handler
    const response = await next();

    // If there was an error, attach it to the context for error handling
    if (error) {
      throw error;
    }

    return response;
  };
}

/**
 * Create an AsiJS middleware that wraps Express middleware stack.
 *
 * @example
 * ```ts
 * import { Asi, expressPlugin } from "asijs";
 *
 * const app = new Asi();
 * app.use(expressPlugin(cors(), helmet(), morgan("dev")));
 * ```
 */
function createExpressChain(...middleware: ExpressHandler[]): Middleware {
  return async (ctx: Context, next: () => Promise<Response>) => {
    // Run all Express middleware first
    for (const mw of middleware) {
      const mwResult = await wrapExpressMiddleware(mw)(ctx, async () => {
        return new Response(null, { status: 404 });
      });

      if (mwResult instanceof Response) {
        if (mwResult.status !== 404 || mwResult.body !== null) {
          return mwResult;
        }
      }
    }

    // Run the actual handler
    return next();
  };
}

// ============================================================================
// Express Plugin
// ============================================================================

/**
 * Express integration tools for AsiJS.
 *
 * @example
 * ```ts
 * import { Asi, expressPlugin } from "asijs";
 *
 * const app = new Asi();
 *
 * // Wrap individual Express middleware
 * app.use(expressPlugin.wrap(cors()));
 * app.use(expressPlugin.wrap(helmet()));
 * ```
 */
export const expressPlugin = {
  /**
   * Wrap an Express middleware function for use in AsiJS.
   *
   * @param handler - Express middleware (req, res, next)
   * @returns AsiJS-compatible middleware
   *
   * @example
   * ```ts
   * app.use(expressPlugin.wrap(cors()));
   * app.use(expressPlugin.wrap(require("morgan")("dev")));
   * ```
   */
  wrap: wrapExpressMiddleware,

  /**
   * Create a chain of Express middleware that runs before the AsiJS handler.
   *
   * @param middleware - Express middleware functions
   * @returns AsiJS-compatible middleware
   */
  chain: createExpressChain,

  /**
   * Create an AsiJS handler from an Express route handler.
   *
   * @param handler - Express route handler (req, res)
   * @returns AsiJS handler function
   *
   * @example
   * ```ts
   * app.get("/", expressPlugin.handler((req, res) => {
   *   res.json({ message: "Hello from Express!" });
   * }));
   * ```
   */
  handler(
    handler: (req: ExpressReq, res: ExpressRes) => void | Promise<void>,
  ): (ctx: Context) => Promise<Response> {
    return async (ctx: Context) => {
      const req = createExpressReq(ctx);
      const res = createExpressRes(ctx);

      await handler(req, res);

      const { body, statusCode, headers } = (res as any)._getResult();
      const headerObj: Record<string, string> = {};
      headers.forEach((v: string, k: string) => { headerObj[k] = v; });
      if (body !== undefined) {
        return new Response(
          typeof body === "object" ? JSON.stringify(body) : String(body),
          {
            status: statusCode,
            headers: {
              ...headerObj,
              ...(typeof body === "object" && !headers.has("Content-Type")
                ? { "Content-Type": "application/json; charset=utf-8" }
                : {}),
            },
          },
        );
      }
      return new Response(null, { status: statusCode, headers: headerObj });
    };
  },
};

// ============================================================================
// Codemod — Express → AsiJS source code transformations
// ============================================================================

export const EXPRESS_CODEMOD_RULES = [
  // 1. Import
  {
    description: "Update Express import",
    pattern: /import\s+(?:express|Express)\s*(?:,\s*\{[^}]*\})?\s*from\s*["']express["']/g,
    replacement: `import { Asi } from "asijs"`,
  },
  {
    description: "Update Express require",
    pattern: /(?:const|let|var)\s+express\s*=\s*(?:require|__import)\s*\(\s*["']express["']\s*\)/g,
    replacement: `import { Asi } from "asijs"\nconst app = new Asi()`,
  },
  // 2. App creation
  {
    description: "Replace express() with new Asi()",
    pattern: /(?:const|let|var)\s+(app|express)\s*=\s*express\s*\(\s*\)/g,
    replacement: `const app = new Asi()`,
  },
  // 3. app.use(middleware) → app.use(expressPlugin.wrap(middleware))
  {
    description: "Wrap Express middleware with expressPlugin.wrap()",
    pattern: /app\.use\s*\((\s*(?:cors|helmet|morgan|compression|bodyParser|session|cookieParser)\s*\([^)]*\)\s*)\)/g,
    replacement: `app.use(expressPlugin.wrap($1))`,
  },
  {
    description: "Wrap general Express middleware",
    pattern: /app\.use\s*\((\s*(?:[a-zA-Z_$][\w]*)\s*)\)/g,
    replacement: `app.use(expressPlugin.wrap($1))`,
  },
  // 4. Route methods
  {
    description: "Transform Express route methods",
    pattern: /app\.(get|post|put|patch|delete|head|options)\s*\(\s*["']([^"']+)["']\s*,\s*(async\s+)?\(?\s*(req|request)\s*(?:,\s*(res|response)\s*)?\)?\s*=>\s*\{/g,
    replacement: (match: RegExpExecArray) => {
      return `app.${match[1]}("${match[2]}", (ctx) => {`;
    },
  },
  // 5. res.status(N).send(...) → ctx.status(N).jsonResponse(...) [MUST run BEFORE res.send→return]
  {
    description: "Transform res.status().send() to ctx.status().jsonResponse()",
    pattern: /\b(?:res|response)\.status\s*\(\s*(\d+)\s*\)\s*\.\s*send\s*\(/g,
    replacement: `ctx.status($1).jsonResponse(`,
  },
  // 6. res.status(N).json(...) → ctx.status(N).jsonResponse(...) [MUST run BEFORE res.json→return]
  {
    description: "Transform res.status().json() to ctx.status().jsonResponse()",
    pattern: /\b(?:res|response)\.status\s*\(\s*(\d+)\s*\)\s*\.\s*json\s*\(/g,
    replacement: `ctx.status($1).jsonResponse(`,
  },
  // 7. res.send() → return
  {
    description: "Transform res.send() to return",
    pattern: /\b(?:res|response)\.send\s*\(/g,
    replacement: `return `,
  },
  // 8. res.json() → return (object)
  {
    description: "Transform res.json() to return",
    pattern: /\b(?:res|response)\.json\s*\(/g,
    replacement: `return `,
  },
  // 9. res.status(N) → ctx.status(N)
  {
    description: "Transform res.status() to ctx.status()",
    pattern: /\b(?:res|response)\.status\s*\(/g,
    replacement: `ctx.status(`,
  },
  // 10. req.params.id → ctx.params.id
  {
    description: "Transform req.params to ctx.params",
    pattern: /\b(?:req|request)\.params\b/g,
    replacement: `ctx.params`,
  },
  // 11. req.query → ctx.query
  {
    description: "Transform req.query to ctx.query",
    pattern: /\b(?:req|request)\.query\b/g,
    replacement: `ctx.query`,
  },
  // 12. req.body → ctx.body (awaited)
  {
    description: "Transform req.body to ctx.body()",
    pattern: /\b(?:req|request)\.body\b/g,
    replacement: `await ctx.body()`,
  },
  // 13. req.headers → ctx.request.headers
  {
    description: "Transform req.headers to ctx.request.headers",
    pattern: /\b(?:req|request)\.headers\b/g,
    replacement: `ctx.request.headers`,
  },
  // 14. req.header('X') → ctx.header('X')
  {
    description: "Transform req.header() to ctx.header()",
    pattern: /\b(?:req|request)\.header\s*\(/g,
    replacement: `ctx.header(`,
  },
  // 15. res.redirect() → ctx.redirect()
  {
    description: "Transform res.redirect() to ctx.redirect()",
    pattern: /\b(?:res|response)\.redirect\s*\(/g,
    replacement: `ctx.redirect(`,
  },
  // 16. res.type() → ctx.setHeader('Content-Type')
  {
    description: "Transform res.type() to Content-Type header",
    pattern: /\b(?:res|response)\.type\s*\(\s*["']([^"']+)["']\s*\)/g,
    replacement: `ctx.setHeader("Content-Type", "$1")`,
  },
  // 17. res.set('X', 'Y') → ctx.setHeader('X', 'Y')
  {
    description: "Transform res.set() to ctx.setHeader()",
    pattern: /\b(?:res|response)\.set\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/g,
    replacement: `ctx.setHeader("$1", "$2")`,
  },
  // 18. app.listen(port, callback) → app.listen(port)
  {
    description: "Transform app.listen() with callback",
    pattern: /app\.listen\s*\(\s*(\d+)\s*,\s*(?:async\s+)?\(\)\s*=>\s*\{[^}]*\}\s*\)/g,
    replacement: `app.listen($1)`,
  },
  // 19. app.all('*') → app.all('/*')
  {
    description: "Transform Express wildcard '*' to '/*'",
    pattern: /["']\*["']\s*\)/g,
    replacement: `"/*")`,
  },
  // 20. next() → removed (not needed in AsiJS)
  {
    description: "Remove next() calls from handlers",
    pattern: /\bnext\s*\(\s*\)\s*;?\s*\n?/g,
    replacement: `// [codemod] next() removed\n`,
  },
  // 21. Express Router → AsiJS group
  {
    description: "Transform Express Router to app.group()",
    pattern: /(?:const|let|var)\s+router\s*=\s*express\s*\.\s*Router\s*\(\s*\)/g,
    replacement: `// [codemod] Express Router → app.group()`,
  },
  {
    description: "Transform router.METHOD to group callback",
    pattern: /\brouter\.(get|post|put|patch|delete)\s*\(/g,
    replacement: `g.$1(`,
  },
  // 22. module.exports = router → app.group() comment
  {
    description: "Transform module.exports = router to app.group() hint",
    pattern: /module\s*\.\s*exports\s*=\s*router/g,
    replacement: `// [codemod] module.exports → use app.group("/prefix", (g) => { ... })`,
  },
];

// ============================================================================
// Express codemod detection patterns
// ============================================================================

export const EXPRESS_DETECTORS: RegExp[] = [
  /from\s+["']express["']/,
  /require\s*\(\s*["']express["']\s*\)/,
  /express\s*\(\s*\)/,
  /\.Router\s*\(\s*\)/,
  /\b(?:res|response)\.(send|json|redirect|status)\(/,
  /\bnext\s*\(\s*\)/,
];
