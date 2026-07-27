/**
 * Migration from Koa.js to AsiJS
 *
 * Two-part migration:
 * 1. **Runtime adapter** — wraps Koa middleware so it runs inside AsiJS
 * 2. **Codemod transforms** — converts Koa source code to AsiJS syntax
 *
 * @example
 * ```ts
 * import { Asi, koaPlugin } from "asijs";
 *
 * const app = new Asi();
 *
 * // Step 1: Run existing Koa middleware inside AsiJS
 * app.use(koaPlugin.wrap(require("koa-cors")()));
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

/** Koa-compatible context (subset) */
export interface KoaCtx {
  request: {
    method: string;
    url: string;
    path: string;
    headers: Record<string, string | string[]>;
    query: Record<string, string>;
    params: Record<string, string>;
    body?: unknown;
    ip?: string;
    fresh?: boolean;
    host?: string;
    protocol?: string;
    secure?: boolean;
    accept: {
      accepts(type: string): boolean;
    };
  };
  response: {
    status: number;
    message: string;
    body: unknown;
    type: string;
    length: number;
    headers: Record<string, string | string[]>;
    set(field: string, value: string): void;
    set(fields: Record<string, string>): void;
    get(field: string): string | undefined;
    remove(field: string): void;
    redirect(url: string, alt?: string): void;
    attachment(filename?: string): void;
    lastModified?: Date;
    etag?: string;
    vary(value: string): void;
  };
  app: unknown;
  state: Record<string, unknown>;
  cookies: {
    get(name: string, options?: Record<string, unknown>): string | undefined;
    set(name: string, value: string, options?: Record<string, unknown>): void;
  };
  status: number;
  body: unknown;
  type: string;
  length: number;
  method: string;
  url: string;
  path: string;
  query: Record<string, string>;
  params: Record<string, string>;
  headers: Record<string, string | string[]>;
  host: string;
  protocol: string;
  secure: boolean;
  ip: string;
  accept: {
    accepts(type: string): boolean;
  };

  /** Koa middleware signature: (ctx, next) => Promise<void> */
  (): void;
  set(field: string, value: string): void;
  set(fields: Record<string, string>): void;
  get(field: string): string | undefined;
  redirect(url: string, alt?: string): void;
  attachment(filename?: string): void;
  vary(value: string): void;
}

/** Koa middleware handler signature */
export type KoaMiddleware = (
  ctx: KoaCtx,
  next: () => Promise<void>,
) => Promise<void> | void;

// ============================================================================
// Runtime Adapter — wrap Koa middleware for use in AsiJS
// ============================================================================

/**
 * Create a Koa-compatible context from an AsiJS context.
 */
function createKoaCtx(ctx: Context): KoaCtx {
  const headers: Record<string, string | string[]> = {};
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

  const koaState: Record<string, unknown> = {};

  const koaCtx = {
    request: {
      get method() { return ctx.method; },
      get url() { return ctx.url.toString(); },
      get path() { return ctx.path; },
      get headers() { return headers; },
      get query() { return ctx.query as Record<string, string>; },
      get ip() { return ctx.request.headers.get("x-forwarded-for") ?? undefined; },
      accept: {
        accepts: (type: string) => true,
      },
    },
    response: {
      status: 200,
      message: "OK",
      body: undefined,
      type: "",
      length: 0,
      headers: {},

      set(field: string | Record<string, string>, value?: string) {
        if (typeof field === "object") {
          Object.assign(this.headers, field);
        } else if (value !== undefined) {
          (this.headers as Record<string, string>)[field] = value;
        }
      },
      get(field: string) {
        return (this.headers as Record<string, string>)[field];
      },
      remove(field: string) {
        delete (this.headers as Record<string, string>)[field];
      },
      redirect(url: string) {
        (this.headers as Record<string, string>)["Location"] = url;
        this.status = 302;
      },
      attachment() {},
      vary(value: string) {
        const existing = (this.headers as Record<string, string>)["Vary"];
        (this.headers as Record<string, string>)["Vary"] = existing
          ? existing + ", " + value
          : value;
      },
    },

    get app() { return undefined; },
    get state() { return koaState; },
    set state(s) { Object.assign(koaState, s); },

    cookies: {
      get(name: string) {
        const cookie = ctx.request.headers.get("cookie");
        if (!cookie) return undefined;
        const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
        return match ? decodeURIComponent(match[1]!) : undefined;
      },
      set(name: string, value: string) {
        // Will be converted to Set-Cookie header
        const existingCookies = (ctx as any)._setCookies || [];
        (ctx as any)._setCookies = [...existingCookies, `${name}=${encodeURIComponent(value)}; Path=/`];
      },
    },

    get status() { return (this as any).response.status; },
    set status(code: number) {
      (this as any).response.status = code;
      (ctx as any)._status = code;
    },

    get body() { return (this as any).response.body; },
    set body(val: unknown) {
      (this as any).response.body = val;
    },

    get type() { return (this as any).response.type; },
    set type(t: string) {
      (this as any).response.type = t;
    },

    get length() { return (this as any).response.length; },
    set length(len: number) {
      (this as any).response.length = len;
    },

    get method() { return ctx.method; },
    get url() { return ctx.url.toString(); },
    get path() { return ctx.path; },
    get query() { return ctx.query as Record<string, string>; },
    get params() { return ctx.params as Record<string, string>; },
    get headers() { return headers; },
    get host() { return ctx.request.headers.get("host") ?? "localhost"; },
    get protocol() {
      const fwd = ctx.request.headers.get("x-forwarded-proto");
      return fwd ?? "http";
    },
    get secure() { return this.protocol === "https"; },
    get ip() { return ctx.request.headers.get("x-forwarded-for") ?? ctx.request.headers.get("x-real-ip") ?? "127.0.0.1"; },
    get accept() {
      return { accepts: (type: string) => true };
    },

    set(field: string | Record<string, string>, value?: string) {
      (this as any).response.set(field as any, value);
    },
    get(field: string) {
      return (this as any).response.get(field);
    },
    redirect(url: string, alt?: string) {
      (this as any).response.redirect(alt || url);
    },
    attachment(filename?: string) {
      (this as any).response.attachment(filename);
    },
    vary(value: string) {
      (this as any).response.vary(value);
    },
  };

  return koaCtx as unknown as KoaCtx;
}

/**
 * Wrap a Koa middleware function for use in AsiJS.
 *
 * @example
 * ```ts
 * import { Asi, koaPlugin } from "asijs";
 *
 * const app = new Asi();
 * app.use(koaPlugin.wrap(require("koa-cors")()));
 * ```
 */
function wrapKoaMiddleware(handler: KoaMiddleware): Middleware {
  return async (ctx: Context, next: () => Promise<Response>) => {
    const koaCtx = createKoaCtx(ctx);
    let koaCompleted = false;

    // Run the Koa middleware
    await new Promise<void>((resolve, reject) => {
      const koaNext = async () => {
        koaCompleted = true;
        resolve();
      };

      try {
        const result = handler(koaCtx, koaNext);
        if (result instanceof Promise) {
          result.then(() => {
            if (!koaCompleted) {
              koaCompleted = true;
              resolve();
            }
          }).catch(reject);
        } else {
          if (!koaCompleted) {
            koaCompleted = true;
            resolve();
          }
        }
      } catch (err) {
        reject(err);
      }
    });

    // If the Koa middleware set a body, convert it to an AsiJS Response
    if (koaCtx.body !== undefined) {
      const headers = new Headers();
      const responseHeaders = (koaCtx as any).response.headers;
      for (const [key, value] of Object.entries(responseHeaders)) {
        if (value !== undefined) {
          if (Array.isArray(value)) {
            for (const v of value) {
              headers.append(key, v);
            }
          } else {
            headers.set(key, value as string);
          }
        }
      }

      // Set Content-Type from Koa's type
      if (koaCtx.response.type) {
        headers.set("Content-Type", koaCtx.response.type);
      }

      const body = koaCtx.body;
      const status = koaCtx.status || 200;

      if (typeof body === "string") {
        if (!headers.has("Content-Type")) {
          headers.set("Content-Type", "text/html; charset=utf-8");
        }
        return new Response(body, { status, headers });
      }

      if (typeof body === "object" && body !== null) {
        if (!headers.has("Content-Type")) {
          headers.set("Content-Type", "application/json; charset=utf-8");
        }
        return new Response(JSON.stringify(body), { status, headers });
      }

      if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
        return new Response(body as BodyInit, { status, headers });
      }

      return new Response(String(body), { status, headers });
    }

    // Proceed to next middleware/handler
    return next();
  };
}

// ============================================================================
// Koa Plugin
// ============================================================================

/**
 * Koa integration tools for AsiJS.
 *
 * @example
 * ```ts
 * import { Asi, koaPlugin } from "asijs";
 *
 * const app = new Asi();
 * app.use(koaPlugin.wrap(require("koa-cors")()));
 * app.use(koaPlugin.wrap(require("koa-bodyparser")()));
 * ```
 */
export const koaPlugin = {
  /**
   * Wrap a Koa middleware function for use in AsiJS.
   *
   * @param handler - Koa middleware (ctx, next) => Promise<void>
   * @returns AsiJS-compatible middleware
   */
  wrap: wrapKoaMiddleware,

  /**
   * Create an AsiJS handler from a Koa route handler.
   *
   * @param handler - Koa route handler (ctx) => void
   * @returns AsiJS handler function
   */
  handler(
    handler: (ctx: KoaCtx) => void | Promise<void>,
  ): (ctx: Context) => Promise<Response> {
    return async (ctx: Context) => {
      const koaCtx = createKoaCtx(ctx);
      await handler(koaCtx);

      if (koaCtx.body !== undefined) {
        const headers = new Headers();
        const responseHeaders = (koaCtx as any).response.headers;
        for (const [key, value] of Object.entries(responseHeaders)) {
          if (value !== undefined) {
            headers.set(key, value as string);
          }
        }

        if (koaCtx.response.type) {
          headers.set("Content-Type", koaCtx.response.type);
        }

        const body = koaCtx.body;
        const status = koaCtx.status || 200;

        if (typeof body === "string") {
          if (!headers.has("Content-Type")) {
            headers.set("Content-Type", "text/html; charset=utf-8");
          }
          return new Response(body, { status, headers });
        }

        if (typeof body === "object" && body !== null) {
          if (!headers.has("Content-Type")) {
            headers.set("Content-Type", "application/json; charset=utf-8");
          }
          return new Response(JSON.stringify(body), { status, headers });
        }

        return new Response(String(body), { status, headers });
      }

      // Include headers even without body (redirect, 204, etc.)
      const responseHeaders = (koaCtx as any).response.headers;
      const headerEntries: Record<string, string> = {};
      for (const [key, value] of Object.entries(responseHeaders)) {
        if (value !== undefined) {
          headerEntries[key] = value as string;
        }
      }
      if (koaCtx.response.type) {
        headerEntries["Content-Type"] = koaCtx.response.type;
      }

      return new Response(null, { status: koaCtx.status || 204, headers: headerEntries });
    };
  },
};

// ============================================================================
// Codemod — Koa → AsiJS source code transformations
// ============================================================================

export const KOA_CODEMOD_RULES = [
  // 1. Import
  {
    description: "Update Koa import",
    pattern: /import\s+(?:Koa|koa)\s*(?:,\s*\{[^}]*\})?\s*from\s*["']koa["']/g,
    replacement: `import { Asi } from "asijs"`,
  },
  {
    description: "Update Koa require",
    pattern: /(?:const|let|var)\s+(?:Koa|koa|app)\s*=\s*(?:require|__import)\s*\(\s*["']koa["']\s*\)/g,
    replacement: `import { Asi } from "asijs"\nconst app = new Asi()`,
  },
  // 2. App creation
  {
    description: "Replace new Koa() with new Asi()",
    pattern: /new\s+Koa\s*\(\s*\)/g,
    replacement: `new Asi()`,
  },
  // 3. app.use(middleware) → app.use(koaPlugin.wrap(middleware))
  {
    description: "Wrap Koa middleware with koaPlugin.wrap()",
    pattern: /app\.use\s*\((\s*(?:[a-zA-Z_$][\w]*)\s*)\)/g,
    replacement: `app.use(koaPlugin.wrap($1))`,
  },
  // 4. ctx.body = value → return value
  {
    description: "Transform ctx.body assignment to return",
    pattern: /ctx\.body\s*=\s*/g,
    replacement: `return `,
  },
  // 5. ctx.status = N → ctx.status(N)
  {
    description: "Transform ctx.status = N to ctx.status(N)",
    pattern: /ctx\.status\s*=\s*(\d+)/g,
    replacement: `ctx.status($1)`,
  },
  // 6. ctx.body = await ... → return await ...
  {
    description: "Transform ctx.body = await to return await",
    pattern: /ctx\.body\s*=\s*await\s+/g,
    replacement: `return await `,
  },
  // 7. ctx.params.id → ctx.params.id (same)
  // 8. ctx.query → ctx.query (same)
  // 9. ctx.request.body → await ctx.body()
  {
    description: "Transform ctx.request.body to await ctx.body()",
    pattern: /\bctx\.request\.body\b/g,
    replacement: `await ctx.body()`,
  },
  // 10. ctx.throw(N) → ctx.status(N).jsonResponse()
  {
    description: "Transform ctx.throw() to ctx.status().jsonResponse()",
    pattern: /ctx\.throw\s*\(\s*(\d+)\s*(?:,\s*["']([^"']+)["'])?\s*\)/g,
    replacement: `ctx.status($1).jsonResponse({ error: $2 ? "$2" : "Error" })`,
  },
  // 11. ctx.redirect(url) → ctx.redirect(url)
  {
    description: "Keep ctx.redirect() as is",
    pattern: /\bctx\.redirect\s*\(/g,
    replacement: `ctx.redirect(`,
  },
  // 12. ctx.set('X', 'Y') → ctx.setHeader('X', 'Y')
  {
    description: "Transform ctx.set() to ctx.setHeader()",
    pattern: /\bctx\.set\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/g,
    replacement: `ctx.setHeader("$1", "$2")`,
  },
  // 13. ctx.type = 'text/html' → ctx.setHeader('Content-Type', 'text/html')
  {
    description: "Transform ctx.type = to ctx.setHeader()",
    pattern: /ctx\.type\s*=\s*["']([^"']+)["']/g,
    replacement: `ctx.setHeader("Content-Type", "$1")`,
  },
  // 14. app.listen(port) → app.listen(port) (same)
  // 15. await next() → removed
  {
    description: "Remove await next() calls",
    pattern: /await\s+next\s*\(\s*\)\s*;?\s*\n?/g,
    replacement: `// [codemod] await next() removed\n`,
  },
  // 16. ctx.app → app reference
  {
    description: "Keep ctx.app — add hint",
    pattern: /\bctx\.app\b/g,
    replacement: `ctx.app // [codemod] ctx.app → direct app reference`,
  },
  // 17. ctx.state → ctx.store
  {
    description: "Transform ctx.state to ctx.store",
    pattern: /\bctx\.state\b/g,
    replacement: `ctx.store`,
  },
  // 18. ctx.cookies.set() → Set-Cookie header
  {
    description: "Transform ctx.cookies.set() hint",
    pattern: /\bctx\.cookies\.set\s*\(/g,
    replacement: `ctx.setHeader("Set-Cookie", `,
  },
  // 19. ctx.cookies.get() → ctx.header()
  {
    description: "Transform ctx.cookies.get() to header access",
    pattern: /\bctx\.cookies\.get\s*\(/g,
    replacement: `ctx.header(`,
  },
  // 20. Router (koa-router) → app.group()
  {
    description: "Transform koa-router to app.group()",
    pattern: /(?:const|let|var)\s+router\s*=\s*new\s+Router\s*\(\s*\)/g,
    replacement: `// [codemod] koa-router → app.group()`,
  },
  {
    description: "Transform router.METHOD to group callback",
    pattern: /\brouter\.(get|post|put|patch|delete)\s*\(/g,
    replacement: `g.$1(`,
  },
  // 21. Router prefix
  {
    description: "Transform Router prefix",
    pattern: /(?:const|let|var)\s+router\s*=\s*new\s+Router\s*\(\s*\{\s*prefix\s*:\s*["']([^"']+)["']\s*\}\s*\)/g,
    replacement: `// [codemod] Router prefix "$1" → app.group("$1", (g) => {`,
  },
  // 22. module.exports = router → app.group() hint
  {
    description: "Transform module.exports = router",
    pattern: /module\s*\.\s*exports\s*=\s*router/g,
    replacement: `// [codemod] module.exports → merge into main app`,
  },
];

// ============================================================================
// Koa codemod detection patterns
// ============================================================================

export const KOA_DETECTORS: RegExp[] = [
  /from\s+["']koa["']/,
  /require\s*\(\s*["']koa["']\s*\)/,
  /new\s+Koa\s*\(\s*\)/,
  /\bctx\.body\s*=/,
  /\bctx\.status\s*=\s*\d+/,
  /\bctx\.throw\s*\(/,
  /\bctx\.cookies\b/,
];
