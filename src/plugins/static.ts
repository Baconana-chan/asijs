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
   * Показывать listing директории
   * @default false
   */
  listing?: boolean;

  /**
   * Разрешённые расширения файлов (без точки)
   * @default undefined (все разрешены)
   */
  allowedExtensions?: string[];
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
    listing = false,
    allowedExtensions,
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
    { headers: Record<string, string>; etag?: string; size: number; mtime: number }
  >();

  return async (
    ctx: Context,
    next: () => Promise<Response>,
  ): Promise<Response> => {
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
      const cached = headerCache.get(filePath);

      // Build response headers
      let headers: Headers;
      let etagValue: string | undefined;

      if (cached && cached.size === size && cached.mtime === mtime) {
        headers = new Headers(cached.headers);
        etagValue = cached.etag;
      } else {
        const baseHeaders: Record<string, string> = {
          "Content-Type": getMimeType(ext),
          "Cache-Control": cacheControl,
        };

        if (etag) {
          etagValue = `"${mtime.toString(16)}-${size.toString(16)}"`;
          baseHeaders.ETag = etagValue;
        }

        headerCache.set(filePath, {
          headers: baseHeaders,
          etag: etagValue,
          size,
          mtime,
        });

        headers = new Headers(baseHeaders);
      }

      // ETag based on modified time and size
      if (etag) {
        const currentEtag = etagValue ?? headers.get("ETag");

        // Check If-None-Match
        const ifNoneMatch = ctx.header("If-None-Match");
        if (currentEtag && ifNoneMatch === currentEtag) {
          return new Response(null, { status: 304, headers });
        }
      }

      // HEAD request
      if (ctx.method === "HEAD") {
        headers.set("Content-Length", String(size));
        return new Response(null, { status: 200, headers });
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
