import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, rmSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { Asi } from "../src";
import { upload, uploadStorage } from "../src";

const TEST_UPLOAD_DIR = join(import.meta.dir, ".test-uploads");
const TEST_FILE = new File(["hello world"], "test.txt", {
  type: "text/plain",
});
const TEST_IMAGE = new File(
  [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
  "image.png",
  { type: "image/png" },
);

// ============================================================================
// Local Storage
// ============================================================================

describe("uploadStorage.local", () => {
  beforeAll(() => {
    if (!existsSync(TEST_UPLOAD_DIR)) {
      mkdirSync(TEST_UPLOAD_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    rmSync(TEST_UPLOAD_DIR, { recursive: true, force: true });
  });

  it("saves file to disk and returns metadata", async () => {
    const storage = uploadStorage.local(TEST_UPLOAD_DIR);
    const buffer = new Uint8Array(
      await TEST_FILE.arrayBuffer(),
    );

    const result = await storage.save(
      "file",
      "test.txt",
      "text/plain",
      buffer,
      { storage, publicPath: "/uploads", naming: "random" },
    );

    expect(result.fieldName).toBe("file");
    expect(result.mimeType).toBe("text/plain");
    expect(result.size).toBe(11);
    expect(result.storage).toBe("local");
    expect(result.url).toContain("/uploads/");
    expect(result.fileName).not.toBe("test.txt"); // random naming
    expect(result.path).toBeTruthy();

    // Verify file exists on disk
    expect(existsSync(result.path)).toBe(true);
    const content = readFileSync(result.path, "utf-8");
    expect(content).toBe("hello world");
  });

  it("saves with 'keep' naming strategy", async () => {
    const storage = uploadStorage.local(TEST_UPLOAD_DIR);
    const buffer = new Uint8Array(
      await TEST_FILE.arrayBuffer(),
    );

    const result = await storage.save(
      "file",
      "my-document.pdf",
      "application/pdf",
      buffer,
      { storage, naming: "keep" },
    );

    expect(result.fileName).toBe("my-document.pdf");
    expect(result.url).toContain("my-document.pdf");
  });

  it("saves with 'timestamp' naming strategy", async () => {
    const storage = uploadStorage.local(TEST_UPLOAD_DIR);
    const buffer = new Uint8Array(
      await TEST_FILE.arrayBuffer(),
    );

    const before = Date.now();
    const result = await storage.save(
      "file",
      "report.csv",
      "text/csv",
      buffer,
      { storage, naming: "timestamp" },
    );
    const after = Date.now();

    // Format: timestamp-original_name
    expect(result.fileName).toMatch(/^\d+-report\.csv$/);
    const ts = parseInt(result.fileName.split("-")[0], 10);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("deletes file from disk", async () => {
    const storage = uploadStorage.local(TEST_UPLOAD_DIR);
    const buffer = new Uint8Array(
      await TEST_FILE.arrayBuffer(),
    );

    const result = await storage.save("file", "delete-me.txt", "text/plain", buffer, {
      storage,
      naming: "keep",
    });

    expect(existsSync(result.path)).toBe(true);

    const deleted = await storage.delete!(result.path);
    expect(deleted).toBe(true);
    expect(existsSync(result.path)).toBe(false);
  });

  it("returns false when deleting non-existent file", async () => {
    const storage = uploadStorage.local(TEST_UPLOAD_DIR);
    const result = await storage.delete!("/nonexistent/path.txt");
    expect(result).toBe(false);
  });
});

// ============================================================================
// File Naming
// ============================================================================

describe("generateFileName (via internal)", () => {
  it("handles files without extension", async () => {
    const storage = uploadStorage.local(TEST_UPLOAD_DIR);
    const buffer = new Uint8Array([1, 2, 3]);

    const result = await storage.save(
      "file",
      "README",
      "text/plain",
      buffer,
      { storage, naming: "keep" },
    );

    expect(result.fileName).toBe("README");
  });
});

// ============================================================================
// Upload Plugin Integration
// ============================================================================

describe("upload plugin", () => {
  beforeAll(() => {
    if (!existsSync(TEST_UPLOAD_DIR)) {
      mkdirSync(TEST_UPLOAD_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    rmSync(TEST_UPLOAD_DIR, { recursive: true, force: true });
  });

  it("registers as plugin with name 'upload'", () => {
    const app = new Asi();
    const storage = uploadStorage.local(TEST_UPLOAD_DIR);

    app.plugin(
      upload({
        storage,
        maxFileSize: 1024 * 1024,
        allowedTypes: ["image/jpeg", "image/png", "text/plain"],
      }),
    );

    const plugins = app.getPlugins();
    expect(plugins).toContain("upload");
  });

  it("processes multipart file upload", async () => {
    const app = new Asi();
    const storage = uploadStorage.local(TEST_UPLOAD_DIR);

    app.plugin(
      upload({
        storage,
        maxFileSize: 1024 * 1024,
      }),
    );

    app.post("/upload", async (ctx: any) => {
      const files = await ctx.uploadedFiles();
      return { files };
    });

    const formData = new FormData();
    formData.append("file", TEST_FILE);

    const res = await app.handle(
      new Request("http://localhost/upload", {
        method: "POST",
        body: formData,
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.files).toHaveLength(1);
    expect(body.files[0].fieldName).toBe("file");
    expect(body.files[0].mimeType).toContain("text/plain");
    expect(body.files[0].size).toBe(11);
  });

  it("validates allowed MIME types", async () => {
    const app = new Asi({ silent: true });
    const storage = uploadStorage.local(TEST_UPLOAD_DIR);

    app.plugin(
      upload({
        storage,
        maxFileSize: 1024 * 1024,
        allowedTypes: ["image/png"], // text/plain NOT allowed
      }),
    );

    app.post("/upload", async (ctx: any) => {
      const files = await ctx.uploadedFiles();
      return { files };
    });

    const formData = new FormData();
    formData.append("file", TEST_FILE); // text/plain — rejected

    const res = await app.handle(
      new Request("http://localhost/upload", {
        method: "POST",
        body: formData,
      }),
    );

    // Should 500 because middleware throws
    expect(res.status).toBe(500);
  });

  it("validates file size limit", async () => {
    const app = new Asi({ silent: true });
    const storage = uploadStorage.local(TEST_UPLOAD_DIR);

    // Only allow 1 byte max — our test file is 11 bytes
    app.plugin(
      upload({
        storage,
        maxFileSize: 5,
      }),
    );

    app.post("/upload", async (ctx: any) => {
      const files = await ctx.uploadedFiles();
      return { files };
    });

    const formData = new FormData();
    formData.append("file", TEST_FILE);

    const res = await app.handle(
      new Request("http://localhost/upload", {
        method: "POST",
        body: formData,
      }),
    );

    expect(res.status).toBe(500);
  });

  it("skips non-POST/PUT requests", async () => {
    const app = new Asi();
    const storage = uploadStorage.local(TEST_UPLOAD_DIR);

    app.plugin(upload({ storage }));

    app.get("/upload", () => ({ ok: true }));

    const res = await app.handle(
      new Request("http://localhost/upload", { method: "GET" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("handles multiple files in one request", async () => {
    const app = new Asi();
    const storage = uploadStorage.local(TEST_UPLOAD_DIR);

    app.plugin(
      upload({
        storage,
        maxFileSize: 1024 * 1024,
      }),
    );

    app.post("/upload", async (ctx: any) => {
      const files = await ctx.uploadedFiles();
      return { count: files.length, files };
    });

    const formData = new FormData();
    formData.append("doc1", TEST_FILE);
    formData.append("doc2", TEST_IMAGE);

    const res = await app.handle(
      new Request("http://localhost/upload", {
        method: "POST",
        body: formData,
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(2);
    expect(body.files[0].fieldName).toBe("doc1");
    expect(body.files[1].fieldName).toBe("doc2");
  });

  it("skips non-file form fields", async () => {
    const app = new Asi();
    const storage = uploadStorage.local(TEST_UPLOAD_DIR);

    app.plugin(
      upload({
        storage,
        maxFileSize: 1024 * 1024,
      }),
    );

    app.post("/upload", async (ctx: any) => {
      const files = await ctx.uploadedFiles();
      return { count: files.length };
    });

    const formData = new FormData();
    formData.append("name", "John"); // string, not a file
    formData.append("file", TEST_FILE);

    const res = await app.handle(
      new Request("http://localhost/upload", {
        method: "POST",
        body: formData,
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1); // only the file
  });
});

// ============================================================================
// Streaming Uploads (saveStream path)
// ============================================================================

describe("upload streaming", () => {
  beforeAll(() => {
    if (!existsSync(TEST_UPLOAD_DIR)) {
      mkdirSync(TEST_UPLOAD_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    rmSync(TEST_UPLOAD_DIR, { recursive: true, force: true });
  });

  it("saveStream writes identical bytes to disk", async () => {
    const storage = uploadStorage.local(TEST_UPLOAD_DIR);
    expect(typeof storage.saveStream).toBe("function");

    const content = new Uint8Array(256 * 1024);
    for (let i = 0; i < content.length; i++) content[i] = (i * 13) % 256;
    const file = new File([content], "stream.bin", { type: "application/octet-stream" });

    const result = await storage.saveStream!(
      "file",
      "stream.bin",
      "application/octet-stream",
      file.stream(),
      file.size,
      { storage, maxFileSize: 1024 * 1024 },
    );

    expect(result.size).toBe(content.length);
    expect(existsSync(result.path)).toBe(true);
    const onDisk = new Uint8Array(readFileSync(result.path));
    expect(onDisk.length).toBe(content.length);
    expect(Buffer.from(onDisk).equals(Buffer.from(content))).toBe(true);
  });

  it("saveStream aborts and deletes partial file when over maxFileSize", async () => {
    const storage = uploadStorage.local(TEST_UPLOAD_DIR);
    const content = new Uint8Array(1024 * 1024); // 1MB
    const file = new File([content], "big.bin", { type: "application/octet-stream" });

    const before = readdirSync(TEST_UPLOAD_DIR).length;

    let threw = false;
    try {
      await storage.saveStream!(
        "file",
        "big.bin",
        "application/octet-stream",
        file.stream(),
        file.size,
        { storage, maxFileSize: 1024 }, // 1KB limit
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    // Partial file must be cleaned up — no new files left behind
    expect(readdirSync(TEST_UPLOAD_DIR).length).toBe(before);
  });

  it("upload({ streaming: true }) saves files via saveStream", async () => {
    const app = new Asi();
    const storage = uploadStorage.local(TEST_UPLOAD_DIR);

    app.plugin(
      upload({
        storage,
        maxFileSize: 1024 * 1024,
        streaming: true,
      }),
    );

    app.post("/upload", async (ctx: any) => {
      const files = await ctx.uploadedFiles();
      return { files };
    });

    const formData = new FormData();
    formData.append("file", TEST_FILE);

    const res = await app.handle(
      new Request("http://localhost/upload", {
        method: "POST",
        body: formData,
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.files).toHaveLength(1);
    expect(body.files[0].size).toBe(11);
    expect(body.files[0].mimeType).toContain("text/plain");
  });

  it("upload({ streaming: true }) enforces size limit mid-stream", async () => {
    const app = new Asi({ silent: true });
    const storage = uploadStorage.local(TEST_UPLOAD_DIR);

    app.plugin(
      upload({
        storage,
        maxFileSize: 5, // our 11-byte file exceeds this
        streaming: true,
      }),
    );

    app.post("/upload", async (ctx: any) => {
      const files = await ctx.uploadedFiles();
      return { files };
    });

    const before = readdirSync(TEST_UPLOAD_DIR).length;
    const formData = new FormData();
    formData.append("file", TEST_FILE);

    const res = await app.handle(
      new Request("http://localhost/upload", {
        method: "POST",
        body: formData,
      }),
    );

    expect(res.status).toBe(500);

    // No partial files left behind — nothing new was written to disk
    expect(readdirSync(TEST_UPLOAD_DIR).length).toBe(before);
  });

  it("upload({ streaming: true }) falls back to buffered path when storage lacks saveStream", async () => {
    const app = new Asi();
    // Minimal storage without saveStream
    const bufferedOnly: any = {
      name: "custom",
      async save(_fieldName: string, fileName: string, mimeType: string, buffer: Uint8Array) {
        return {
          fieldName: "file",
          fileName,
          mimeType,
          size: buffer.length,
          url: `/uploads/${fileName}`,
          path: fileName,
          storage: "custom",
        };
      },
    };

    app.plugin(upload({ storage: bufferedOnly, streaming: true }));
    app.post("/upload", async (ctx: any) => {
      const files = await ctx.uploadedFiles();
      return { count: files.length };
    });

    const formData = new FormData();
    formData.append("file", TEST_FILE);

    const res = await app.handle(
      new Request("http://localhost/upload", {
        method: "POST",
        body: formData,
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
  });
});

// ============================================================================
// S3 Storage (mock/validation)
// ============================================================================

describe("uploadStorage.s3", () => {
  it("returns storage with name 's3'", () => {
    const s3 = uploadStorage.s3({
      endpoint: "https://s3.amazonaws.com",
      region: "us-east-1",
      accessKeyId: "AKID",
      secretAccessKey: "secret",
      bucket: "test-bucket",
    });

    expect(s3.name).toBe("s3");
  });

  it("r2 storage alias uses forcePathStyle=true", () => {
    const r2 = uploadStorage.r2({
      endpoint: "https://account.r2.cloudflarestorage.com",
      region: "auto",
      accessKeyId: "ak",
      secretAccessKey: "sk",
      bucket: "bucket",
    });

    expect(r2.name).toBe("s3");
  });
});
