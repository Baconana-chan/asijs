/**
 * Context — объект контекста запроса (аналог ctx в Elysia/Koa)
 */
export class Context<
  TBody = unknown,
  TQuery = Record<string, string>,
  TParams = Record<string, string>,
> {
  readonly request: Request;
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
  
  /** Fast query string parser без URL объекта */
  private _parseQueryString(qs: string): Record<string, string> {
    if (!qs) return {};
    
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
          const key = keyRaw.indexOf("%") === -1 ? keyRaw : decodeURIComponent(keyRaw);
          const value = valueRaw.indexOf("%") === -1 ? valueRaw : decodeURIComponent(valueRaw);
          result[key] = value;
        } else {
          result[keyRaw] = valueRaw;
        }
      } else {
        // Ключ без значения
        const keyRaw = qs.slice(start, end);
        const key = this._decodeQuery
          ? (keyRaw.indexOf("%") === -1 ? keyRaw : decodeURIComponent(keyRaw))
          : keyRaw;
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
  setCookie(
    name: string, 
    value: string, 
    options: CookieOptions = {}
  ): this {
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
  deleteCookie(name: string, options: Pick<CookieOptions, "path" | "domain"> = {}): this {
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

  /** Получить body как текст */
  async text(): Promise<string> {
    if (!this._bodyParsed) {
      this._body = await this.request.text() as TBody;
      this._bodyParsed = true;
    }
    return this._body as string;
  }

  /** Получить body как FormData */
  async formData(): Promise<FormData> {
    if (!this._bodyParsed) {
      this._body = await this.request.formData() as TBody;
      this._bodyParsed = true;
    }
    return this._body as FormData;
  }

  /** Получить body как ArrayBuffer */
  async arrayBuffer(): Promise<ArrayBuffer> {
    if (!this._bodyParsed) {
      this._body = await this.request.arrayBuffer() as TBody;
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

  /** Redirect */
  redirect(url: string, status: 301 | 302 | 303 | 307 | 308 = 302): Response {
    return Response.redirect(url, status);
  }
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
