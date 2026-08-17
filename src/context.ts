/**
 * Request context — the object passed to every handler and middleware.
 *
 * Wraps the incoming `Request` with lazy query/body/cookies parsing, typed
 * params, response helpers (`status`, `json`, `html`, `setHeader`, `cookie`,
 * ...), file uploads, and `ContextPool` for zero-allocation request cycles.
 */

import type { NegotiateHandlers, NegotiateOptions } from "./negotiate";
import { negotiateResponse } from "./negotiate";
import { formatForContentType, getFormat, jsonFormat } from "./formats";
import type { StreamJsonOptions, StreamNDJsonOptions } from "./json-stream";
import {
  createJsonStream,
  createNDJsonStream,
} from "./json-stream";

/**
 * Context — объект контекста запроса (аналог ctx в Elysia/Koa)
 */
export class Context<
  TBody = unknown,
  TQuery = Record<string, string>,
  TParams = Record<string, string>,
> {
  request: Request;
  private _decodeQuery: boolean;

  // Lazy URL parsing — только когда нужно
  private _url: URL | null = null;
  private _path: string | null = null;
  private _queryString: string | null = null;

  params: TParams = {} as TParams;
  private _query: TQuery | null = null;
  private _body: TBody | undefined = undefined;
  private _bodyParsed = false;
  private _cookies: Record<string, string> | null = null;
  private _setCookies: string[] = [];
  private _files: Map<string, import("./formdata").ParsedFile> | null = null;

  private _status: number = 200;
  private _headers: Headers = new Headers();

  // Store для передачи данных между middleware
  store: Record<string, unknown> = {};

  /** Session object (added by sessions() middleware) */
  session?: import("./session").Session;

  /**
   * Circuit breaker helper (added by circuitBreaker() middleware).
   * Call through a named circuit breaker to add resilience to external API calls.
   *
   * @example
   * ```ts
   * const data = await ctx.circuitBreaker!("stripe-api", async () => {
   *   const res = await fetch("https://api.stripe.com/...");
   *   return res.json();
   * });
   * ```
   */
  circuitBreaker?: <T>(name: string, fn: () => Promise<T>) => Promise<T>;

  /**
   * Error boundary helper (added by errorBoundary() middleware).
   * Catch handler errors and return a structured response or fallback.
   *
   * @example
   * ```ts
   * app.get("/risky", async (ctx) => {
   *   const result = await ctx.errorBoundary(
   *     () => riskyCall(),
   *     { fallback: { ok: false } },
   *   );
   *   return result;
   * });
   * ```
   */
  errorBoundary?: <T>(
    fn: () => T | Promise<T>,
    options?: import("./error-boundary").ErrorBoundaryOptions<T>,
  ) => Promise<T>;

  // Валидированные данные (устанавливаются после валидации)
  /** Валидированное тело запроса */
  body!: TBody;

  /** Валидированные query параметры */
  validatedQuery!: TQuery;

  /** Валидированные path параметры */
  validatedParams!: TParams;

  constructor(request: Request, options?: { decodeQuery?: boolean }) {
    this.request = request;
    this._decodeQuery = options?.decodeQuery ?? false;
  }

  /**
   * @internal Reset this context for reuse from a pool.
   * Resets every field to its pristine state, deletes middleware-added
   * properties (prevents cross-request leaks), and binds a new Request.
   */
  _reset(request: Request, decodeQuery: boolean): void {
    // Delete middleware-added properties (e.g. ctx.user, ctx.auth) — own
    // enumerable keys that aren't core Context fields.
    // Fast path: a pristine pooled context has exactly CONTEXT_CORE_KEYS.size
    // own enumerable fields, so count keys with a cheap for..in first and only
    // run the hasOwnProperty + delete pass when something was actually added.
    let keyCount = 0;
    for (const key in this) keyCount++;
    if (keyCount !== CONTEXT_CORE_KEYS.size) {
      for (const key in this) {
        if (!CONTEXT_CORE_KEYS.has(key) && Object.prototype.hasOwnProperty.call(this, key)) {
          try {
            delete (this as any)[key];
          } catch {
            // non-configurable — ignore
          }
        }
      }
    }

    this.request = request;
    this._decodeQuery = decodeQuery;
    this._url = null;
    this._path = null;
    this._queryString = null;
    this.params = {} as TParams;
    this._query = null;
    this._body = undefined;
    this._bodyParsed = false;
    this._cookies = null;
    this._setCookies = [];
    this._files = null;
    this._status = 200;
    this._headers = new Headers();
    this.store = {};
    this.session = undefined;
    this.circuitBreaker = undefined;
    this.errorBoundary = undefined;
    (this as any).body = undefined;
    (this as any).validatedQuery = undefined;
    (this as any).validatedParams = undefined;
  }

  /**
   * @internal Lightweight rebind for pooled reuse.
   * `release()` already reset this context to its pristine state, so acquire
   * only needs to bind the new Request — no field scan, no allocations.
   * Lazy fields (`_path`, `_query`, ...) are left null by release and get set
   * by `_setUrlParts()` / lazy getters on demand.
   */
  _rebind(request: Request, decodeQuery: boolean): void {
    this.request = request;
    this._decodeQuery = decodeQuery;
  }

  // ===== Fast path extraction =====

  /** @internal Извлечь path и queryString из URL без создания URL объекта */
  private _parseUrl(): void {
    if (this._path !== null) return;

    const url = this.request.url;
    const qIdx = url.indexOf("?");

    if (qIdx === -1) {
      // Нет query string — просто извлекаем path
      // URL: http://host:port/path
      const startIdx = url.indexOf("/", url.indexOf("//") + 2);
      this._path = startIdx === -1 ? "/" : url.slice(startIdx);
      this._queryString = "";
    } else {
      // Есть query string
      const startIdx = url.indexOf("/", url.indexOf("//") + 2);
      this._path = startIdx === -1 ? "/" : url.slice(startIdx, qIdx);
      this._queryString = url.slice(qIdx + 1);
    }
  }

  /** @internal Предустановить path и queryString (из внешнего fast-path парсинга) */
  _setUrlParts(path: string, queryString: string): void {
    if (this._path === null) {
      this._path = path;
      this._queryString = queryString;
    }
  }

  /** @internal Установить path (для middleware, изменяющих путь — например apiVersion) */
  _setPath(path: string): void {
    this._path = path;
  }

  /** @internal Установить path без проверок (принудительно) */
  _forceUrl(path: string, queryString?: string): void {
    this._path = path;
    if (queryString !== undefined) this._queryString = queryString;
  }

  /** Полный URL объект (lazy) */
  get url(): URL {
    if (this._url === null) {
      this._url = new URL(this.request.url);
    }
    return this._url;
  }

  // ===== Getters =====

  /** Метод запроса */
  get method(): string {
    return this.request.method;
  }

  /** Путь запроса (без query string) — оптимизированный */
  get path(): string {
    if (this._path === null) {
      this._parseUrl();
    }
    return this._path!;
  }

  /** Query параметры (lazy parsing) — raw без валидации */
  get query(): TQuery {
    if (this._query === null) {
      this._parseUrl();
      this._query = this._parseQueryString(this._queryString!) as TQuery;
    }
    return this._query;
  }

  /** Fast query string parser без URL объекта (2.2.6) */
  private _parseQueryString(qs: string): Record<string, string> {
    if (!qs) return {};

    // Cached parse: повторяющиеся query-строки (pagination, фильтры) не
    // парсятся заново. Возвращаем shallow copy — потребители могут мутировать
    // ctx.query, кэш остаётся чистым.
    const cache = getDefaultQueryCache();
    if (cache) {
      const key = (this._decodeQuery ? "d\u0000" : "r\u0000") + qs;
      const hit = cache.get(key);
      if (hit) {
        const copy: Record<string, string> = {};
        for (const k in hit) copy[k] = hit[k];
        return copy;
      }

      const parsed = this._parseQueryStringUncached(qs);
      cache.set(key, parsed);
      return parsed;
    }

    return this._parseQueryStringUncached(qs);
  }

  /** Single-pass inline parser: q=a&b=c → {q:'a',b:'c'} без URL объекта */
  private _parseQueryStringUncached(qs: string): Record<string, string> {
    const result: Record<string, string> = {};
    let start = 0;

    while (start < qs.length) {
      // Найти конец пары key=value
      let end = qs.indexOf("&", start);
      if (end === -1) end = qs.length;

      // Найти разделитель =
      const eqIdx = qs.indexOf("=", start);

      if (eqIdx !== -1 && eqIdx < end) {
        const keyRaw = qs.slice(start, eqIdx);
        const valueRaw = qs.slice(eqIdx + 1, end);
        if (this._decodeQuery) {
          result[safeDecode(keyRaw)] = safeDecode(valueRaw);
        } else {
          result[keyRaw] = valueRaw;
        }
      } else {
        // Ключ без значения
        const keyRaw = qs.slice(start, end);
        const key = this._decodeQuery ? safeDecode(keyRaw) : keyRaw;
        if (key) result[key] = "";
      }

      start = end + 1;
    }

    return result;
  }

  /** Получить заголовок запроса */
  header(name: string): string | null {
    return this.request.headers.get(name);
  }

  /** Получить все заголовки запроса */
  get headers(): Headers {
    return this.request.headers;
  }

  // ===== Cookies =====

  /** Получить все cookies (lazy parsing) */
  get cookies(): Record<string, string> {
    if (this._cookies === null) {
      this._cookies = {};
      const cookieHeader = this.request.headers.get("Cookie");
      if (cookieHeader) {
        for (const pair of cookieHeader.split(";")) {
          const eqIdx = pair.indexOf("=");
          if (eqIdx > 0) {
            const name = pair.slice(0, eqIdx).trim();
            const value = pair.slice(eqIdx + 1).trim();
            this._cookies[name] = decodeURIComponent(value);
          }
        }
      }
    }
    return this._cookies;
  }

  /** Получить cookie по имени */
  cookie(name: string): string | undefined {
    return this.cookies[name];
  }

  /** Установить cookie */
  setCookie(name: string, value: string, options: CookieOptions = {}): this {
    const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];

    if (options.maxAge !== undefined) {
      parts.push(`Max-Age=${options.maxAge}`);
    }
    if (options.expires) {
      parts.push(`Expires=${options.expires.toUTCString()}`);
    }
    if (options.path) {
      parts.push(`Path=${options.path}`);
    }
    if (options.domain) {
      parts.push(`Domain=${options.domain}`);
    }
    if (options.secure) {
      parts.push("Secure");
    }
    if (options.httpOnly) {
      parts.push("HttpOnly");
    }
    if (options.sameSite) {
      parts.push(`SameSite=${options.sameSite}`);
    }

    this._setCookies.push(parts.join("; "));
    return this;
  }

  /** Удалить cookie */
  deleteCookie(
    name: string,
    options: Pick<CookieOptions, "path" | "domain"> = {},
  ): this {
    return this.setCookie(name, "", {
      ...options,
      maxAge: 0,
    });
  }

  // ===== Body parsing (lazy) =====

  /** Получить body как JSON (raw, без валидации) */
  async json<T = TBody>(): Promise<T> {
    if (!this._bodyParsed) {
      this._body = await this.request.json();
      this._bodyParsed = true;
    }
    return this._body as unknown as T;
  }

  /**
   * Получить body, распарсенный по Content-Type запроса (или по явному
   * формату): JSON, YAML и любые зарегистрированные `registerFormat()`.
   *
   * `format` — имя формата ("yaml") или MIME ("application/yaml"); без него
   * формат выбирается из заголовка `Content-Type`. Неизвестный/отсутствующий
   * Content-Type → JSON (как `json()`).
   *
   * @example
   * ```ts
   * app.post("/config", async (ctx) => {
   *   const body = await ctx.parseBody();     // по Content-Type
   *   const raw = await ctx.parseBody("yaml"); // принудительно YAML
   *   return body;
   * });
   * ```
   */
  async parseBody<T = TBody>(format?: string): Promise<T> {
    if (!this._bodyParsed) {
      const fmt = format
        ? getFormat(format) ?? jsonFormat
        : formatForContentType(this.request.headers.get("content-type")) ?? jsonFormat;
      if (fmt.name === "json") {
        this._body = (await this.request.json()) as TBody;
      } else {
        const text = await this.request.text();
        this._body = fmt.parse(text) as TBody;
      }
      this._bodyParsed = true;
    }
    return this._body as unknown as T;
  }

  /** Получить body как текст */
  async text(): Promise<string> {
    if (!this._bodyParsed) {
      this._body = (await this.request.text()) as TBody;
      this._bodyParsed = true;
    }
    return this._body as string;
  }

  /** Получить body как FormData */
  async formData(): Promise<FormData> {
    if (!this._bodyParsed) {
      this._body = (await this.request.formData()) as TBody;
      this._bodyParsed = true;
    }
    return this._body as FormData;
  }

  /** Получить body как ArrayBuffer */
  async arrayBuffer(): Promise<ArrayBuffer> {
    if (!this._bodyParsed) {
      this._body = (await this.request.arrayBuffer()) as TBody;
      this._bodyParsed = true;
    }
    return this._body as ArrayBuffer;
  }

  // ===== File helpers =====

  /**
   * Get a file from validated FormData
   * @param name Field name
   * @returns ParsedFile or undefined
   */
  file(name: string): import("./formdata").ParsedFile | undefined {
    return this._files?.get(name);
  }

  /** Get all validated files */
  get files(): Map<string, import("./formdata").ParsedFile> {
    return this._files ?? new Map();
  }

  /** @internal Set files from FormData validation */
  _setFiles(files: Map<string, import("./formdata").ParsedFile>): void {
    this._files = files;
  }

  // ===== Internal: set validated data =====

  /** @internal Установить валидированное тело */
  _setBody(data: TBody): void {
    this.body = data;
    this._body = data;
    this._bodyParsed = true;
  }

  /** @internal Установить валидированные query */
  _setQuery(data: TQuery): void {
    this.validatedQuery = data;
    this._query = data;
  }

  /** @internal Установить валидированные params */
  _setParams(data: TParams): void {
    this.validatedParams = data;
    this.params = data;
  }

  // ===== Response builders =====

  /** Установить статус ответа */
  status(code: number): this {
    this._status = code;
    return this;
  }

  /** Установить заголовок ответа */
  setHeader(name: string, value: string): this {
    this._headers.set(name, value);
    return this;
  }

  /** Получить заголовки ответа */
  get responseHeaders(): Headers {
    return this._headers;
  }

  /** Получить статус ответа */
  get responseStatus(): number {
    return this._status;
  }

  /** @internal Применить Set-Cookie headers */
  private applySetCookies(): void {
    for (const cookie of this._setCookies) {
      this._headers.append("Set-Cookie", cookie);
    }
  }

  /** Вернуть JSON ответ */
  jsonResponse<T>(data: T, status?: number): Response {
    if (status) this._status = status;
    this._headers.set("Content-Type", "application/json");
    this.applySetCookies();
    return new Response(JSON.stringify(data), {
      status: this._status,
      headers: this._headers,
    });
  }

  /** Вернуть текстовый ответ */
  textResponse(data: string, status?: number): Response {
    if (status) this._status = status;
    this._headers.set("Content-Type", "text/plain; charset=utf-8");
    this.applySetCookies();
    return new Response(data, {
      status: this._status,
      headers: this._headers,
    });
  }

  /** Вернуть HTML ответ */
  html(data: string, status?: number): Response {
    if (status) this._status = status;
    this._headers.set("Content-Type", "text/html; charset=utf-8");
    this.applySetCookies();
    return new Response(data, {
      status: this._status,
      headers: this._headers,
    });
  }

  /**
   * Content negotiation — automatically selects the best response format
   * based on the Accept request header.
   *
   * @example
   * ```ts
   * return ctx.negotiate({
   *   json: { id: 1, name: "Alice" },
   *   html: "<h1>Alice</h1>",
   * });
   *
   * // With async handlers
   * return ctx.negotiate({
   *   json: () => db.findUser(id),
   *   html: async () => renderUserTemplate(await db.findUser(id)),
   * });
   * ```
   */
  negotiate(
    handlers: NegotiateHandlers,
    options?: NegotiateOptions,
  ): Promise<Response> {
    return negotiateResponse(this, handlers, options);
  }

  // ===== JSON Streaming =====

  /**
   * Stream a JSON array without buffering the entire payload in memory.
   *
   * Accepts both synchronous arrays and async iterables, making it ideal
   * for paginated database results or large datasets.
   *
   * @example
   * ```ts
   * // Sync array
   * return ctx.streamJson([{ id: 1 }, { id: 2 }]);
   *
   * // Async generator (paginated)
   * return ctx.streamJson(asyncDbResults());
   * ```
   */
  streamJson<T = unknown>(
    data: T[] | AsyncIterable<T>,
    options: StreamJsonOptions = {},
  ): Response {
    this._headers.set("Content-Type", "application/json");
    this._headers.set("X-Content-Type-Options", "nosniff");
    this._headers.set("Cache-Control", "no-cache");
    this.applySetCookies();
    const stream = createJsonStream(data, { replacer: options.replacer });
    return new Response(stream, {
      status: options.status ?? this._status,
      headers: this._headers,
    });
  }

  /**
   * Stream NDJSON (newline-delimited JSON) — one JSON object per line.
   *
   * Useful for log streams, real-time data feeds, and streaming ETL.
   * Content-Type is set to `application/x-ndjson`.
   *
   * @example
   * ```ts
   * return ctx.streamNDJson([
   *   { level: "info", msg: "started" },
   *   { level: "warn", msg: "high memory" },
   * ]);
   * ```
   */
  streamNDJson<T = unknown>(
    data: AsyncIterable<T> | Iterable<T>,
    options: StreamNDJsonOptions = {},
  ): Response {
    this._headers.set("Content-Type", "application/x-ndjson");
    this._headers.set("X-Content-Type-Options", "nosniff");
    this._headers.set("Cache-Control", "no-cache");
    this.applySetCookies();
    const stream = createNDJsonStream(data, { replacer: options.replacer });
    return new Response(stream, {
      status: options.status ?? this._status,
      headers: this._headers,
    });
  }

  /** Redirect */
  redirect(url: string, status: 301 | 302 | 303 | 307 | 308 = 302): Response {
    return Response.redirect(url, status);
  }
}

/**
 * Safe percent-decode: never throws on malformed input.
 * `decodeURIComponent("%E0%A4%A")` бросает URIError — URLSearchParams вместо
 * этого возвращает сырую строку. Возвращаем raw при ошибке (2.2.6).
 */
function safeDecode(s: string): string {
  if (s.indexOf("%") === -1) return s;
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Bounded LRU cache for parsed query strings (2.2.6).
 *
 * Key = decode-flag + query string. Cache entries are returned as shallow
 * copies, so consumer mutations of `ctx.query` never poison the cache.
 * Eviction is O(1): Map insertion order + delete/re-insert on access.
 */
export class QueryParseCache {
  private max: number;
  private cache = new Map<string, Record<string, string>>();

  constructor(max: number = 512) {
    this.max = max;
  }

  get(key: string): Record<string, string> | undefined {
    const found = this.cache.get(key);
    if (found) {
      this.cache.delete(key);
      this.cache.set(key, found);
    }
    return found;
  }

  set(key: string, value: Record<string, string>): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
      this.cache.set(key, value);
      return;
    }
    if (this.cache.size >= this.max) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, value);
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

let defaultQueryCache: QueryParseCache | null = null;
let queryCacheDisabled = false;

/**
 * Get the shared query-parse cache (enabled by default in Asi, 2.2.6).
 * Returns null when disabled via `queryCache: false` or before first use
 * with no default — the parser then falls back to direct parsing.
 */
export function getDefaultQueryCache(max?: number): QueryParseCache | null {
  if (defaultQueryCache === null && !queryCacheDisabled) {
    defaultQueryCache = new QueryParseCache(max ?? 512);
  }
  return defaultQueryCache;
}

/** Disable the shared query-parse cache (queryCache: false). */
export function disableDefaultQueryCache(): void {
  queryCacheDisabled = true;
  defaultQueryCache = null;
}

/** Reset the shared cache state (tests / re-enable). */
export function resetDefaultQueryCache(): void {
  queryCacheDisabled = false;
  defaultQueryCache = null;
}

/** Core Context field names kept across pool resets (everything else is deleted) */
const CONTEXT_CORE_KEYS = new Set<string>([
  "request",
  "params",
  "store",
  "session",
  "circuitBreaker",
  "errorBoundary",
  "body",
  "validatedQuery",
  "validatedParams",
  // Internal lazy fields (own class properties — must survive reset)
  "_decodeQuery",
  "_url",
  "_path",
  "_queryString",
  "_query",
  "_body",
  "_bodyParsed",
  "_cookies",
  "_setCookies",
  "_files",
  "_status",
  "_headers",
]);

// Shared placeholder request used to reset pooled contexts on release
const PLACEHOLDER_REQUEST = new Request("http://localhost/");

/**
 * ContextPool — recycler for zero-allocation request cycles.
 *
 * Pre-allocated `Context` objects are acquired per request and released back
 * to the pool when the response is produced. This removes the per-request
 * `new Context()` + field-init + Headers allocation from the hot path.
 *
 * Design:
 * - `acquire(request, decodeQuery)` → resets a pooled context and returns it
 * - `release(ctx)` → resets the context (including middleware-added props) and
 *   returns it to the pool
 * - Pool growth — when every context is in flight, a fresh one is created
 * - Automatic shrink — a lazy timer trims the pool back to `size` after the
 *   pool has been idle over `shrinkIntervalMs`
 */
export class ContextPool {
  private pool: Context[] = [];
  private readonly size: number;
  private readonly max: number;
  private readonly shrinkIntervalMs: number;
  private shrinkTimer: ReturnType<typeof setTimeout> | null = null;
  private _stats = { acquired: 0, released: 0, created: 0 };

  constructor(options: ContextPoolOptions = {}) {
    this.size = options.size ?? 1000;
    this.max = options.max ?? this.size * 2;
    this.shrinkIntervalMs = options.shrinkIntervalMs ?? 30_000;
    this._stats.created = this.size;

    // Pre-allocate the pool
    for (let i = 0; i < this.size; i++) {
      this.pool.push(new Context(PLACEHOLDER_REQUEST));
    }
  }

  /** Get a ready-to-use context bound to `request`. */
  acquire(request: Request, decodeQuery: boolean): Context {
    const ctx = this.pool.pop();
    if (ctx) {
      ctx._rebind(request, decodeQuery);
      this._stats.acquired++;
      return ctx;
    }
    // Pool exhausted — grow
    this._stats.created++;
    this._stats.acquired++;
    return new Context(request, { decodeQuery });
  }

  /** Reset the context and return it to the pool. */
  release(ctx: Context): void {
    ctx._reset(PLACEHOLDER_REQUEST, false);
    this._stats.released++;

    if (this.pool.length < this.max) {
      this.pool.push(ctx);
    }

    // Lazy shrink — if we're over the target size, trim back to `size` after
    // an idle interval. One-shot timer that doesn't hold the event loop open.
    if (this.pool.length > this.size && !this.shrinkTimer) {
      const t = setTimeout(() => {
        this.shrinkTimer = null;
        if (this.pool.length > this.size) {
          this.pool.length = this.size;
        }
      }, this.shrinkIntervalMs);
      (t as any).unref?.();
      this.shrinkTimer = t;
    }
  }

  /** Current pool depth (contexts available for reuse). */
  get sizeNow(): number {
    return this.pool.length;
  }

  /** Reset to a pristine state (used in tests). */
  clear(): void {
    if (this.shrinkTimer) {
      clearTimeout(this.shrinkTimer);
      this.shrinkTimer = null;
    }
    this.pool = [];
    this._stats = { acquired: 0, released: 0, created: this.size };
    const placeholder = new Request("http://localhost/");
    for (let i = 0; i < this.size; i++) {
      this.pool.push(new Context(placeholder));
    }
  }

  /** Lifecycle counters for diagnostics. */
  get stats() {
    return { ...this._stats };
  }
}

/** Опции для ContextPool */
export interface ContextPoolOptions {
  /** Pre-allocated pool size. Default 1000. */
  size?: number;
  /** Hard cap on the retained pool (growth bound). Default size * 2. */
  max?: number;
  /** Idle ms before the pool shrinks back to `size`. Default 30s. */
  shrinkIntervalMs?: number;
}

/** Опции для установки cookie */
export interface CookieOptions {
  /** Время жизни в секундах */
  maxAge?: number;
  /** Дата истечения */
  expires?: Date;
  /** Путь для cookie */
  path?: string;
  /** Домен для cookie */
  domain?: string;
  /** Только HTTPS */
  secure?: boolean;
  /** Недоступна для JavaScript */
  httpOnly?: boolean;
  /** Политика SameSite */
  sameSite?: "Strict" | "Lax" | "None";
}

/** Типизированный контекст с выводом типов */
export type TypedContext<
  TBody = unknown,
  TQuery = Record<string, string>,
  TParams = Record<string, string>,
> = Context<TBody, TQuery, TParams>;
