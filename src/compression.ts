/**
 * Response Compression Middleware for AsiJS
 *
 * Compresses HTTP responses using gzip or brotli based on the Accept-Encoding header.
 * Uses Bun's built-in compression when available, falls back to Node.js zlib.
 *
 * @example
 * ```ts
 * import { Asi, compression } from "asijs";
 *
 * const app = new Asi();
 *
 * // Default — gzip for responses > 1KB
 * app.use(compression());
 *
 * // With custom options
 * app.use(compression({
 *   brotli: true,        // Enable brotli (if available)
 *   threshold: 512,      // Minimum body size in bytes
 *   level: 6,            // Compression level (1-9)
 * }));
 *
 * // Exclude specific content types
 * app.use(compression({
 *   exclude: ["image/", "video/"],
 * }));
 * ```
 */

import type { Middleware } from "./types";
import type { Context } from "./context";

// ===== Types =====

export interface CompressionOptions {
  /**
   * Enable brotli compression (if available).
   * When true, prefers `br` over `gzip` if the client supports both.
   * @default false
   */
  brotli?: boolean;

  /**
   * Minimum response body size (in bytes) to trigger compression.
   * Responses smaller than this are not compressed.
   * @default 1024
   */
  threshold?: number;

  /**
   * Compression level (1-9).
   * Higher = better compression, slower.
   * @default 6
   */
  level?: number;

  /**
   * Content type prefixes to exclude from compression.
   * E.g., ["image/", "video/", "audio/"] to skip media files.
   * @default ["image/", "video/", "audio/"]
   */
  exclude?: string[];

  /**
   * Content types to always compress, regardless of exclude.
   * E.g., ["image/svg+xml"] to compress SVG.
   * @default []
   */
  include?: string[];
}

// ===== Defaults =====

const DEFAULT_OPTIONS: CompressionOptions = {
  brotli: false,
  threshold: 1024,
  level: 6,
  exclude: ["image/", "video/", "audio/"],
  include: [],
};

const COMPRESSIBLE_TYPES = [
  "text/",
  "application/json",
  "application/javascript",
  "application/x-javascript",
  "application/xml",
  "application/xhtml+xml",
  "application/atom+xml",
  "application/rss+xml",
  "application/ld+json",
  "application/manifest+json",
  "application/vnd.api+json",
  "application/geo+json",
  "application/graphql+json",
  "font/ttf",
  "font/otf",
  "image/svg+xml",
];

// ===== Compression Functions =====

/** Check if a content type is compressible */
function isCompressible(
  contentType: string | null,
  exclude: string[],
  include: string[],
): boolean {
  if (!contentType) return false;

  const lower = contentType.toLowerCase();

  // If explicitly included, compress it
  for (const inc of include) {
    if (lower.startsWith(inc)) return true;
  }

  // If explicitly excluded, skip it
  for (const exc of exclude) {
    if (lower.startsWith(exc)) return false;
  }

  // Check if it's a compressible type
  for (const ct of COMPRESSIBLE_TYPES) {
    if (lower.startsWith(ct)) return true;
  }

  return false;
}

/** Select encoding based on Accept-Encoding header and options */
function selectEncoding(
  acceptEncoding: string | null,
  brotliEnabled: boolean,
): "gzip" | "br" | null {
  if (!acceptEncoding) return null;

  const lower = acceptEncoding.toLowerCase();

  // Brotli is preferred if enabled and client accepts it
  if (brotliEnabled && lower.includes("br")) {
    return "br";
  }

  // Gzip is widely supported
  if (lower.includes("gzip")) {
    return "gzip";
  }

  // Deflate as last resort (rare)
  if (lower.includes("deflate")) {
    return "gzip"; // Use gzip for deflate too (better compression)
  }

  // */* means any encoding — use gzip
  if (lower.includes("*/*") || lower.includes("*")) {
    return "gzip";
  }

  return null;
}

/** Try to compress with Bun's native gzip */
function compressGzipBun(data: ArrayBuffer, level: number): Uint8Array | null {
  try {
    return (Bun as any).gzipSync(data, { level });
  } catch {
    return null;
  }
}

/** Compress data using Node.js zlib (fallback) */
async function compressGzipNode(
  data: ArrayBuffer,
  level: number,
): Promise<Uint8Array | null> {
  try {
    const { gzipSync } = await import("zlib");
    const buffer = Buffer.from(data);
    return gzipSync(buffer, { level });
  } catch {
    return null;
  }
}

// ===== Middleware =====

/**
 * Create compression middleware.
 *
 * Compresses response bodies based on the Accept-Encoding header.
 * Uses Bun's native gzip when available, falls back to Node.js zlib.
 *
 * @example
 * ```ts
 * app.use(compression({ threshold: 512, brotli: true }));
 * ```
 */
export function compression(options: CompressionOptions = {}): Middleware {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { brotli, threshold, level } = opts;

  const hasBun = typeof Bun !== "undefined";
  const brotliEnabled = opts.brotli === true;

  return async (ctx: Context, next: () => Promise<Response>): Promise<Response> => {
    const response = await next();
    const acceptEncoding = ctx.header("accept-encoding");

    // Don't compress if Content-Encoding is already set
    if (response.headers.has("Content-Encoding")) {
      return response;
    }

    // Check if client accepts compression
    const encoding = selectEncoding(acceptEncoding, brotliEnabled);

    // Add Vary header when not compressing (for caching/CDN correctness)
    if (!encoding && acceptEncoding) {
      const vary = response.headers.get("Vary");
      if (!vary || !vary.includes("Accept-Encoding")) {
        const newVary = vary ? vary + ", Accept-Encoding" : "Accept-Encoding";
        const h = new Headers(response.headers);
        h.set("Vary", newVary);
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: h,
        });
      }
      return response;
    }

    if (!encoding) {
      return response;
    }

    // Check content type
    const contentType = response.headers.get("Content-Type");
    if (!isCompressible(contentType, opts.exclude!, opts.include!)) {
      return response;
    }

    // Skip small responses (check Content-Length header first)
    const contentLength = response.headers.get("Content-Length");
    if (contentLength && parseInt(contentLength, 10) < threshold!) {
      return response;
    }

    // Read the body
    let body: ArrayBuffer;
    try {
      body = await response.clone().arrayBuffer();
    } catch {
      return response;
    }

    // Skip if body is too small (actual size, not just Content-Length)
    if (body.byteLength < threshold!) {
      return response;
    }

    // Compress
    let compressed: Uint8Array | null = null;

    if (hasBun && encoding === "gzip") {
      compressed = compressGzipBun(body, level!);
    }

    // Node.js fallback for gzip
    if (!compressed && encoding === "gzip") {
      compressed = await compressGzipNode(body, level!);
    }

    if (!compressed) {
      return response;
    }

    // Build compressed response
    const headers = new Headers(response.headers);
    headers.set("Content-Encoding", encoding);

    // Append to existing Vary, don't overwrite
    const existingVary = response.headers.get("Vary");
    if (existingVary && !existingVary.includes("Accept-Encoding")) {
      headers.set("Vary", existingVary + ", Accept-Encoding");
    } else if (!existingVary) {
      headers.set("Vary", "Accept-Encoding");
    }
    if (headers.has("ETag")) {
      headers.delete("ETag");
    }

    return new Response(compressed as BodyInit, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

export default compression;
