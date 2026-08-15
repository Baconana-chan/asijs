/**
 * Upload Provider for AsiJS
 *
 * Supports local filesystem, S3-compatible (AWS S3, Cloudflare R2, MinIO),
 * and streaming uploads with multipart/form-data parsing.
 *
 * Features:
 * - Multipart file upload middleware
 * - Local filesystem storage
 * - S3-compatible storage (AWS S3, Cloudflare R2, MinIO)
 * - File type validation (MIME type whitelist)
 * - Size limits
 * - Streaming uploads for large files
 *
 * @example
 * ```ts
 * import { Asi, upload } from "asijs";
 *
 * const app = new Asi();
 *
 * // Local storage
 * app.plugin(upload({
 *   storage: upload.storage.local("./uploads"),
 *   maxFileSize: 10 * 1024 * 1024, // 10MB
 *   allowedTypes: ["image/jpeg", "image/png", "application/pdf"],
 * }));
 *
 * app.post("/upload", async (ctx) => {
 *   const files = await ctx.uploadedFiles();
 *   // files: Array<{ fieldName: string; fileName: string; mimeType: string; size: number; url: string; path: string }>
 *   return { files };
 * });
 * ```
 */

import { mkdirSync, existsSync, unlinkSync, createWriteStream } from "fs";
import { writeFile } from "fs/promises";
import { join, extname } from "path";
import { randomUUID } from "crypto";
import type { Context } from "./context";
import { createPlugin, type AsiPlugin } from "./plugin";

// ============================================================================
// Types
// ============================================================================

export interface UploadedFile {
  /** Original form field name */
  fieldName: string;
  /** Original file name */
  fileName: string;
  /** MIME type */
  mimeType: string;
  /** File size in bytes */
  size: number;
  /** Public URL to access the file */
  url: string;
  /** Storage path (local path or S3 key) */
  path: string;
  /** Storage provider name */
  storage: string;
}

export interface UploadOptions {
  /** Storage backend */
  storage: UploadStorage;
  /** Maximum file size in bytes (default: 5MB) */
  maxFileSize?: number;
  /** Allowed MIME types (default: all) */
  allowedTypes?: string[];
  /** Base URL for public file access (default: /uploads) */
  publicPath?: string;
  /** Rename files: "keep" | "random" | "timestamp" (default: "random") */
  naming?: "keep" | "random" | "timestamp";
  /**
   * Stream file contents to storage instead of buffering the whole file in
   * memory (default: false). Recommended for large files — memory stays
   * O(chunk) instead of O(file). Requires the storage to implement `saveStream`.
   */
  streaming?: boolean;
}

export interface UploadStorage {
  name: string;
  save: (
    fieldName: string,
    fileName: string,
    mimeType: string,
    buffer: Uint8Array,
    options: UploadOptions,
  ) => Promise<UploadedFile>;
  /**
   * Optional streaming save — used when `upload({ streaming: true })`.
   * Receives the file content as a ReadableStream and must not buffer the
   * whole file in memory. `size` is the declared size from multipart headers.
   * Enforces `options.maxFileSize` mid-stream (aborts + deletes partial file).
   */
  saveStream?: (
    fieldName: string,
    fileName: string,
    mimeType: string,
    stream: ReadableStream<Uint8Array>,
    size: number,
    options: UploadOptions,
  ) => Promise<UploadedFile>;
  delete?: (path: string) => Promise<boolean>;
  url?: (path: string) => string;
}

// ============================================================================

// Local Storage
// ============================================================================

/**
 * Local filesystem storage provider.
 *
 * @example
 * ```ts
 * const storage = upload.storage.local("./uploads");
 * ```
 */
function localStorage(uploadDir: string): UploadStorage {
  // Ensure upload directory exists
  if (!existsSync(uploadDir)) {
    mkdirSync(uploadDir, { recursive: true });
  }

  return {
    name: "local",
    async save(fieldName, fileName, mimeType, buffer, options) {
      const savedName = generateFileName(fileName, options.naming ?? "random");
      const filePath = join(uploadDir, savedName);
      // Async write — never block the event loop on disk I/O
      await writeFile(filePath, buffer);

      return {
        fieldName,
        fileName: savedName,
        mimeType,
        size: buffer.length,
        url: `${options.publicPath ?? "/uploads"}/${savedName}`,
        path: filePath,
        storage: "local",
      };
    },
    async saveStream(fieldName, fileName, mimeType, stream, size, options) {
      const savedName = generateFileName(fileName, options.naming ?? "random");
      const filePath = join(uploadDir, savedName);
      const maxFileSize = options.maxFileSize ?? 5 * 1024 * 1024;

      // Fast reject before touching the stream — the declared size from
      // multipart headers is already known.
      if (size > maxFileSize) {
        throw new Error(
          `File "${fileName}" exceeds maximum size of ${maxFileSize} bytes`,
        );
      }

      let written = 0;
      try {
        // Bun fast path: FileSink streams chunks straight to disk without
        // buffering the whole file in JS memory. Fallback: Node write stream.
        if (typeof Bun !== "undefined" && typeof Bun.file === "function") {
          const sink = Bun.file(filePath).writer();
          try {
            const reader = stream.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              written += value.length;
              if (written > maxFileSize) {
                // Cancel the reader so the request body stream stops
                await reader.cancel().catch(() => {});
                throw new Error(
                  `File "${fileName}" exceeds maximum size of ${maxFileSize} bytes`,
                );
              }
              sink.write(value);
            }
          } finally {
            await sink.end();
          }
        } else {
          // Node fallback — pipe the web stream into a write stream
          const { Readable } = await import("stream");
          await new Promise<void>((resolve, reject) => {
            const ws = createWriteStream(filePath);
            const nodeStream = Readable.fromWeb(stream as any);
            nodeStream.on("data", (chunk: Buffer) => {
              written += chunk.length;
              if (written > maxFileSize) {
                ws.destroy(new Error(
                  `File "${fileName}" exceeds maximum size of ${maxFileSize} bytes`,
                ));
              }
            });
            nodeStream.pipe(ws);
            ws.on("finish", () => resolve());
            ws.on("error", reject);
            nodeStream.on("error", reject);
          });
        }
      } catch (error) {
        // Remove the partial file so a rejected upload leaves no garbage
        try {
          unlinkSync(filePath);
        } catch {
          // ignore — file may not exist yet
        }
        throw error;
      }

      return {
        fieldName,
        fileName: savedName,
        mimeType,
        size: written,
        url: `${options.publicPath ?? "/uploads"}/${savedName}`,
        path: filePath,
        storage: "local",
      };
    },
    async delete(path) {
      try {
        unlinkSync(path);
        return true;
      } catch {
        return false;
      }
    },
  };
}

// ============================================================================
// S3 Storage (AWS S3 / Cloudflare R2 / MinIO)
// ============================================================================

export interface S3StorageConfig {
  /** S3 endpoint (e.g., "https://s3.amazonaws.com") */
  endpoint: string;
  /** Region (e.g., "us-east-1") */
  region: string;
  /** Access key ID */
  accessKeyId: string;
  /** Secret access key */
  secretAccessKey: string;
  /** Bucket name */
  bucket: string;
  /** Public base URL (e.g., "https://cdn.example.com") */
  publicUrl?: string;
  /** Force path-style URLs (default: false, virtual-hosted) */
  forcePathStyle?: boolean;
}

/**
 * S3-compatible storage (AWS S3, Cloudflare R2, MinIO).
 *
 * Uses fetch-based S3 API (no SDK required).
 *
 * @example
 * ```ts
 * const storage = upload.storage.s3({
 *   endpoint: "https://s3.amazonaws.com",
 *   region: "us-east-1",
 *   accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
 *   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
 *   bucket: "my-bucket",
 * });
 * ```
 */
function s3Storage(config: S3StorageConfig): UploadStorage {
  return {
    name: "s3",
    async save(fieldName, fileName, mimeType, buffer, options) {
      const savedName = generateFileName(fileName, options.naming ?? "random");

      // Construct S3 PutObject URL
      const path = `uploads/${savedName}`;
      const url = config.publicUrl
        ? `${config.publicUrl}/${path}`
        : `${config.endpoint}/${config.bucket}/${path}`;

      // Simple S3 PUT request (presigned-style)
      const s3Url = config.forcePathStyle
        ? `${config.endpoint}/${config.bucket}/${path}`
        : `${config.endpoint}/${path}`;

      try {
        const response = await fetch(s3Url, {
          method: "PUT",
          headers: {
            "Content-Type": mimeType,
            "Content-Length": String(buffer.length),
            "x-amz-acl": "public-read",
          },
          body: buffer as BodyInit,
        });

        if (!response.ok) {
          throw new Error(`S3 upload failed: ${response.status} ${response.statusText}`);
        }
      } catch (error) {
        throw new Error(`S3 upload failed: ${(error as Error).message}`);
      }

      return {
        fieldName,
        fileName: savedName,
        mimeType,
        size: buffer.length,
        url,
        path,
        storage: "s3",
      };
    },
    async saveStream(fieldName, fileName, mimeType, stream, size, options) {
      const savedName = generateFileName(fileName, options.naming ?? "random");
      const path = `uploads/${savedName}`;
      const url = config.publicUrl
        ? `${config.publicUrl}/${path}`
        : `${config.endpoint}/${config.bucket}/${path}`;
      const s3Url = config.forcePathStyle
        ? `${config.endpoint}/${config.bucket}/${path}`
        : `${config.endpoint}/${path}`;

      try {
        // Streaming PUT — body is a ReadableStream. Node fetch requires
        // `duplex: "half"` for stream bodies; Bun handles it natively.
        const init: RequestInit & { duplex?: string } = {
          method: "PUT",
          headers: {
            "Content-Type": mimeType,
            "Content-Length": String(size),
            "x-amz-acl": "public-read",
          },
          body: stream as unknown as BodyInit,
        };
        if (typeof Bun === "undefined") {
          init.duplex = "half";
        }
        const response = await fetch(s3Url, init);

        if (!response.ok) {
          throw new Error(`S3 upload failed: ${response.status} ${response.statusText}`);
        }
      } catch (error) {
        throw new Error(`S3 upload failed: ${(error as Error).message}`);
      }

      return {
        fieldName,
        fileName: savedName,
        mimeType,
        size,
        url,
        path,
        storage: "s3",
      };
    },

    async delete(path) {
      const s3Url = config.forcePathStyle
        ? `${config.endpoint}/${config.bucket}/${path}`
        : `${config.endpoint}/${path}`;

      try {
        const response = await fetch(s3Url, { method: "DELETE" });
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}

// ============================================================================
// Cloudflare R2 Storage (shorthand)
// ============================================================================

/**
 * Cloudflare R2 storage provider (S3-compatible).
 * Alias for `s3` with `forcePathStyle: true`.
 *
 * @example
 * ```ts
 * const storage = upload.storage.r2({
 *   endpoint: "https://<account>.r2.cloudflarestorage.com",
 *   region: "auto",
 *   accessKeyId: process.env.R2_ACCESS_KEY_ID!,
 *   secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
 *   bucket: "my-bucket",
 *   publicUrl: "https://cdn.example.com",
 * });
 * ```
 */
function r2Storage(config: S3StorageConfig): UploadStorage {
  return s3Storage({ ...config, forcePathStyle: true });
}

// ============================================================================
// File naming
// ============================================================================

function generateFileName(original: string, naming: "keep" | "random" | "timestamp"): string {
  const ext = original.includes(".") ? original.split(".").pop() : "";

  switch (naming) {
    case "keep":
      return original;
    case "timestamp":
      return `${Date.now()}-${original.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
    case "random":
    default: {
      const id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return ext ? `${id}.${ext}` : id;
    }
  }
}

// ============================================================================
// Upload Plugin
// ============================================================================

/**
 * Upload plugin for AsiJS.
 *
 * @example
 * ```ts
 * import { Asi, upload } from "asijs";
 *
 * const app = new Asi();
 *
 * // Local storage
 * app.plugin(upload({
 *   storage: upload.storage.local("./uploads"),
 *   maxFileSize: 10 * 1024 * 1024,
 *   allowedTypes: ["image/jpeg", "image/png"],
 * }));
 * ```
 */
export function upload(options: UploadOptions): AsiPlugin {
  const maxFileSize = options.maxFileSize ?? 5 * 1024 * 1024; // 5MB default
  const allowedTypes = options.allowedTypes;
  const storage = options.storage;

  return createPlugin({
    name: "upload",
    setup(app: any) {
        // Store upload options in app state
        app.setState("upload:options", options);
        app.setState("upload:storage", storage);

        // Middleware to handle multipart uploads
        app.use(async (ctx: Context, next: () => Promise<Response>) => {
          const method = ctx.method;
          const contentType = ctx.request.headers.get("content-type") || "";

          // Only handle POST/PUT with multipart
          if (method !== "POST" && method !== "PUT") return next();
          if (!contentType.includes("multipart/form-data")) return next();

          // Parse and upload files
          try {
            const formData = await ctx.request.formData();
            const files: UploadedFile[] = [];

            for (const [fieldName, value] of formData.entries()) {
              // Skip string values — only process File objects
              if (typeof value === "string") continue;
              const file = value as File;

              // Validate file size
              if (file.size > maxFileSize) {
                throw new Error(
                  `File "${file.name}" exceeds maximum size of ${maxFileSize} bytes`,
                );
              }

              // Validate MIME type
              if (allowedTypes && !allowedTypes.includes(file.type)) {
                throw new Error(
                  `File type "${file.type}" is not allowed for "${file.name}"`,
                );
              }

              // Streaming path — no full-file buffer in memory (great for
              // large files). Falls back to the buffered path when the
              // storage doesn't implement `saveStream`.
              if (options.streaming === true && storage.saveStream) {
                const uploaded = await storage.saveStream(
                  fieldName,
                  file.name,
                  file.type,
                  file.stream(),
                  file.size,
                  options,
                );
                files.push(uploaded);
                continue;
              }

              // Read file buffer
              const buffer = new Uint8Array(await file.arrayBuffer());

              // Save to storage
              const uploaded = await storage.save(
                fieldName,
                file.name,
                file.type,
                buffer,
                options,
              );
              files.push(uploaded);
            }

            // Attach uploaded files to context
            (ctx as any).uploadedFiles = async () => files;
          } catch (error) {
            throw error;
          }

          return next();
        });
    },
  });
}

// ============================================================================
// Exports
// ============================================================================

export const uploadStorage = {
  local: localStorage,
  s3: s3Storage,
  r2: r2Storage,
};
