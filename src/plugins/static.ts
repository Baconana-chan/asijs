/**
 * Static Files Plugin для AsiJS
 *
 * @example
 * ```ts
 * import { Asi } from "asijs";
 * import { staticFiles } from "asijs/plugins/static";
 *
 * const app = new Asi();
 *
 * // Простой вариант - папка public
 * app.use(staticFiles("./public"));
 *
 * // С опциями
 * app.use(staticFiles("./public", {
 *   prefix: "/static",
 *   index: "index.html",
 *   maxAge: 3600,
 * }));
 * ```
 */

import { join, extname } from "path";
import type { BunFile } from "bun";
import type { Middleware } from "../types";
import type { Context } from "../context";

export interface StaticOptions {
  /**
   * URL префикс для статических файлов
   * @default ""
   */
  prefix?: string;

  /**
   * Файл index для папок
   * @default "index.html"
   */
  index?: string;

  /**
   * Cache-Control max-age в секундах
   * @default 0 (no-cache)
   */
  maxAge?: number;

  /**
   * Добавлять ETag заголовок
   * @default true
   */
  etag?: boolean;

  /**
   * Стратегия генерации ETag
   * - "mtime": на основе mtime+size (быстро, по умолчанию)
   * - "bun": Bun.hash() для небольших файлов (точнее, но дороже)
   * @default "mtime"
   */
  etagStrategy?: "mtime" | "bun";

  /**
   * Показывать listing директории
   * @default false
   */
  listing?: boolean;

  /**
   * Разрешённые расширения файлов (без точки)
   * @default undefined (все разрешены)
   */
  allowedExtensions?: string[];

  /**
   * Кэшировать маленькие файлы в памяти
   * @default false
   */
  cacheSmallFiles?: boolean;

  /**
   * Максимальный размер файла для кэширования (в байтах)
   * @default 131072 (128KB)
   */
  cacheMaxFileSize?: number;

  /**
   * Максимальное количество файлов в кэше
   * @default 512
   */
  cacheMaxEntries?: number;

  /**
   * Максимальный суммарный размер кэша (в байтах)
   * @default 16777216 (16MB)
   */
  cacheMaxBytes?: number;

  /**
   * Preload файлов в память при старте (in-memory cache, 2.2.7).
   *
   * - `true` — загрузить все файлы под glob `**&#47;*.{html,css,js,svg}`
   * - строка | массив строк — явные glob-паттерны, резолвятся относительно `root`
   *
   * Файлы больше `cacheMaxFileSize` пропускаются. Preload работает независимо
   * от `cacheSmallFiles` (загруженные файлы всегда отдаются из памяти).
   *
   * @default false
   */
  preload?: boolean | string | string[];

  /**
   * TTL кэша в секундах (MemoryCache-совместимая семантика).
   * После истечения файл перечитывается с диска при следующем запросе —
   * полезно когда файл меняется без изменения size/mtime.
   *
   * @default undefined (без истечения — инвалидация по size/mtime)
   */
  cacheTtl?: number;
}

// Минимальный набор MIME типов
const MIME_TYPES: Record<string, string> = {
  // Text
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  md: "text/markdown; charset=utf-8",

  // Images
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  webp: "image/webp",
  avif: "image/avif",

  // Fonts
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",

  // Media
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  webm: "video/webm",
  ogg: "audio/ogg",
  wav: "audio/wav",

  // Documents
  pdf: "application/pdf",
  zip: "application/zip",
  gz: "application/gzip",
  tar: "application/x-tar",

  // Other
  wasm: "application/wasm",
  map: "application/json",
};

function getMimeType(ext: string): string {
  return MIME_TYPES[ext] || "application/octet-stream";
}

function buildBunHashEtag(buffer: ArrayBuffer): string {
  const hash = Bun.hash(new Uint8Array(buffer));
  const hex =
    typeof hash === "bigint"
      ? hash.toString(16)
      : (hash >>> 0).toString(16);
  return `"${hex}"`;
}

/**
 * Создать middleware для статических файлов
 */
export function staticFiles(
  root: string,
  options: StaticOptions = {},
): Middleware {
  const {
    prefix = "",
    index = "index.html",
    maxAge = 0,
    etag = true,
    etagStrategy = "mtime",
    listing = false,
    allowedExtensions,
    cacheSmallFiles = false,
    cacheMaxFileSize = 128 * 1024,
    cacheMaxEntries = 512,
    cacheMaxBytes = 16 * 1024 * 1024,
    preload = false,
    cacheTtl,
  } = options;

  // Normalize prefix
  const normalizedPrefix = prefix.startsWith("/") ? prefix : `/${prefix}`;
  const prefixWithSlash = normalizedPrefix.endsWith("/")
    ? normalizedPrefix
    : `${normalizedPrefix}/`;

  const cacheControl = maxAge > 0 ? `public, max-age=${maxAge}` : "no-cache";
  const allowedSet = allowedExtensions
    ? new Set(allowedExtensions.map((ext) => ext.toLowerCase()))
    : null;
  const headerCache = new Map<
    string,
    {
      headers: Record<string, string>;
      etag?: string;
      size: number;
      mtime: number;
      etagStrategy?: "mtime" | "bun";
    }
  >();

  interface CacheEntry {
    body: ArrayBuffer;
    headers: Record<string, string>;
    etag?: string;
    size: number;
    mtime: number;
    /** 0 = никогда не истекает (инвалидация по size/mtime); иначе Date.now() + ttl */
    expires: number;
  }

  const fileCache = new Map<string, CacheEntry>();
  let cacheBytes = 0;

  const evictCache = () => {
    while (fileCache.size > cacheMaxEntries || cacheBytes > cacheMaxBytes) {
      const firstKey = fileCache.keys().next().value as string | undefined;
      if (!firstKey) break;
      const entry = fileCache.get(firstKey);
      if (entry) cacheBytes -= entry.size;
      fileCache.delete(firstKey);
    }
  };

  /** Lazy TTL cleanup — выбросить истёкшие записи (вызывается при записи) */
  const purgeExpired = () => {
    if (!cacheTtl) return;
    const now = Date.now();
    for (const [key, entry] of fileCache) {
      if (entry.expires !== 0 && entry.expires <= now) {
        cacheBytes -= entry.size;
        fileCache.delete(key);
      }
    }
  };

  /** Запись в fileCache: чтение буфера + ETag(bun) + byte-accounting + eviction */
  const cacheFile = async (
    filePath: string,
    file: BunFile,
    size: number,
    mtime: number,
    baseHeaders: Record<string, string>,
    etagValue: string | undefined,
  ): Promise<{ body: ArrayBuffer; headers: Record<string, string>; etag: string | undefined }> => {
    const body = await file.arrayBuffer();
    if (etag && etagStrategy === "bun") {
      etagValue = buildBunHashEtag(body);
      baseHeaders = { ...baseHeaders, ETag: etagValue };
    }
    purgeExpired();
    fileCache.set(filePath, {
      body,
      headers: baseHeaders,
      etag: etagValue,
      size,
      mtime,
      expires: cacheTtl ? Date.now() + cacheTtl * 1000 : 0,
    });
    cacheBytes += size;
    evictCache();
    return { body, headers: baseHeaders, etag: etagValue };
  };

  /** Кэш-валидность: size/mtime совпали и TTL не истёк */
  const isFresh = (entry: CacheEntry, size: number, mtime: number): boolean =>
    entry.size === size &&
    entry.mtime === mtime &&
    (entry.expires === 0 || entry.expires > Date.now());

  // Preload (2.2.7): загрузить matching файлы в память при старте
  const DEFAULT_PRELOAD_GLOB = "**/*.{html,css,js,svg}";
  let preloadSettled = !preload;
  let preloadPromise: Promise<void> | null = null;

  if (preload) {
    const patterns = preload === true ? [DEFAULT_PRELOAD_GLOB] : Array.isArray(preload) ? preload : [preload];
    preloadPromise = (async () => {
      const seen = new Set<string>();
      for (const pattern of patterns) {
        const glob = new Bun.Glob(pattern);
        for await (const rel of glob.scan({ cwd: root, onlyFiles: true })) {
          const fp = join(root, rel);
          if (seen.has(fp)) continue;
          seen.add(fp);
          try {
            const file = Bun.file(fp);
            const size = file.size;
            if (size > cacheMaxFileSize) continue;
            const mtime = file.lastModified;
            const ext = extname(fp).slice(1).toLowerCase();
            if (allowedSet && !allowedSet.has(ext)) continue;
            const baseHeaders = {
              "Content-Type": getMimeType(ext),
              "Cache-Control": cacheControl,
            };
            let etagValue: string | undefined;
            if (etag && etagStrategy === "mtime") {
              etagValue = `"${mtime.toString(16)}-${size.toString(16)}"`;
              (baseHeaders as Record<string, string>).ETag = etagValue;
            }
            await cacheFile(fp, file, size, mtime, baseHeaders, etagValue);
          } catch {
            // Пропускаем недоступные файлы
          }
        }
      }
    })().catch(() => {
      /* preload — best-effort */
    }).finally(() => {
      preloadSettled = true;
    });
  }

  return async (
    ctx: Context,
    next: () => Promise<Response>,
  ): Promise<Response> => {
    // First requests wait for startup preload (fast — уже в полёте)
    if (preloadPromise && !preloadSettled) {
      await preloadPromise;
    }

    // Only handle GET and HEAD
    if (ctx.method !== "GET" && ctx.method !== "HEAD") {
      return next();
    }

    const path = ctx.path;

    // Check prefix match
    let relativePath: string;
    if (prefix === "" || prefix === "/") {
      relativePath = path;
    } else if (path === normalizedPrefix || path.startsWith(prefixWithSlash)) {
      relativePath = path.slice(normalizedPrefix.length) || "/";
    } else {
      return next();
    }

    // Security: prevent path traversal
    if (relativePath.includes("..")) {
      return next();
    }

    // Build file path
    let filePath = join(root, relativePath);

    try {
      // === FAST PATH (2.2.7): in-memory cache hit — ноль fs-вызовов ===
      // `file.exists()` стоит ~150µs на запрос — главный bottleneck. Когда
      // пользователь явно выбрал memory-first serving (`preload` или
      // `cacheTtl`), отдаём из памяти без stat/read. Trade-off: изменение
      // файла без смены TTL/size/mtime не подхватывается мгновенно
      // (поведение CDN edge). Без этих опций сохраняется прежняя семантика:
      // cacheSmallFiles валидирует size/mtime с диска на каждый запрос.
      const memoryFirst = cacheTtl !== undefined || preload !== false;
      const cachedHit = memoryFirst ? fileCache.get(filePath) : undefined;
      if (cachedHit && (cachedHit.expires === 0 || cachedHit.expires > Date.now())) {
        const fastHeaders = new Headers(cachedHit.headers);
        if (etag && cachedHit.etag && ctx.header("If-None-Match") === cachedHit.etag) {
          return new Response(null, { status: 304, headers: fastHeaders });
        }
        fastHeaders.set("Content-Length", String(cachedHit.size));
        if (ctx.method === "HEAD") {
          return new Response(null, { status: 200, headers: fastHeaders });
        }
        return new Response(cachedHit.body, { headers: fastHeaders });
      }

      // Slow path — fs операции
      let file = Bun.file(filePath);
      let exists = await file.exists();

      // Check if directory → try index file
      if (!exists) {
        const indexPath = join(filePath, index);
        file = Bun.file(indexPath);
        exists = await file.exists();
        if (exists) {
          filePath = indexPath;
        }
      }

      if (!exists) {
        return next();
      }

      // Check extension filter
      const ext = extname(filePath).slice(1).toLowerCase();
      if (allowedSet && !allowedSet.has(ext)) {
        return next();
      }

      const size = file.size;
      const mtime = file.lastModified;
      const canCache = cacheSmallFiles && size <= cacheMaxFileSize;
      const canHash = etag && etagStrategy === "bun" && size <= cacheMaxFileSize;
      const cached = headerCache.get(filePath);

      // Build response headers
      let headers: Headers;
      let etagValue: string | undefined;
      let baseHeaders: Record<string, string>;

      if (
        cached &&
        cached.size === size &&
        cached.mtime === mtime &&
        cached.etagStrategy === etagStrategy
      ) {
        baseHeaders = cached.headers;
        headers = new Headers(baseHeaders);
        etagValue = cached.etag;
      } else {
        baseHeaders = {
          "Content-Type": getMimeType(ext),
          "Cache-Control": cacheControl,
        };

        if (etag && !canHash) {
          etagValue = `"${mtime.toString(16)}-${size.toString(16)}"`;
          baseHeaders.ETag = etagValue;
        }

        headerCache.set(filePath, {
          headers: baseHeaders,
          etag: etagValue,
          size,
          mtime,
          etagStrategy,
        });

        headers = new Headers(baseHeaders);
      }

      // In-memory cache lookup (2.2.7) — читаем всегда: preloaded файлы
      // отдаются из памяти даже при cacheSmallFiles: false
      const cachedFile = fileCache.get(filePath);
      if (cachedFile) {
        if (isFresh(cachedFile, size, mtime)) {
          baseHeaders = cachedFile.headers;
          headers = new Headers(baseHeaders);
          if (cachedFile.etag) {
            etagValue = cachedFile.etag;
          }
        } else {
          // Истёк (TTL) или size/mtime изменились — выбросить и перечитать
          fileCache.delete(filePath);
          cacheBytes -= cachedFile.size;
        }
      }

      const ifNoneMatch = etag ? ctx.header("If-None-Match") : null;

      // ETag check
      if (etag) {
        const currentEtag = etagValue ?? headers.get("ETag");
        if (currentEtag && ifNoneMatch === currentEtag) {
          return new Response(null, { status: 304, headers });
        }
      }

      // HEAD request
      if (ctx.method === "HEAD") {
        headers.set("Content-Length", String(size));
        return new Response(null, { status: 200, headers });
      }

      if (canCache) {
        if (cachedFile && isFresh(cachedFile, size, mtime)) {
          const responseHeaders = new Headers(cachedFile.headers);
          responseHeaders.set("Content-Length", String(size));
          return new Response(cachedFile.body, { headers: responseHeaders });
        }

        const {
          body: buffer,
          headers: newBaseHeaders,
          etag: cachedEtag,
        } = await cacheFile(
          filePath,
          file,
          size,
          mtime,
          baseHeaders,
          etagValue,
        );
        baseHeaders = newBaseHeaders;
        if (etagValue === undefined) etagValue = cachedEtag;
        headerCache.set(filePath, {
          headers: baseHeaders,
          etag: etagValue,
          size,
          mtime,
          etagStrategy,
        });
        if (etagValue && ifNoneMatch === etagValue) {
          const responseHeaders = new Headers(baseHeaders);
          return new Response(null, { status: 304, headers: responseHeaders });
        }

        const responseHeaders = new Headers(baseHeaders);
        responseHeaders.set("Content-Length", String(size));
        return new Response(buffer, { headers: responseHeaders });
      }

      // Preloaded (без cacheSmallFiles) — отдаём из памяти
      if (cachedFile && isFresh(cachedFile, size, mtime)) {
        const responseHeaders = new Headers(cachedFile.headers);
        responseHeaders.set("Content-Length", String(size));
        return new Response(cachedFile.body, { headers: responseHeaders });
      }

      if (canHash) {
        const buffer = await file.arrayBuffer();
        etagValue = buildBunHashEtag(buffer);
        baseHeaders = { ...baseHeaders, ETag: etagValue };
        headerCache.set(filePath, {
          headers: baseHeaders,
          etag: etagValue,
          size,
          mtime,
          etagStrategy,
        });
        if (etagValue && ifNoneMatch === etagValue) {
          const responseHeaders = new Headers(baseHeaders);
          return new Response(null, { status: 304, headers: responseHeaders });
        }
        const responseHeaders = new Headers(baseHeaders);
        responseHeaders.set("Content-Length", String(size));
        return new Response(buffer, { headers: responseHeaders });
      }

      // Return file (Bun handles streaming automatically)
      return new Response(file, { headers });
    } catch (error) {
      // File not found or other error
      return next();
    }
  };
}

export default staticFiles;
