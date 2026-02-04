/**
 * Example: File Upload with Validation
 * 
 * Demonstrates:
 * - FormData parsing
 * - File validation (size, type)
 * - Saving uploaded files
 * - Multiple file upload
 * 
 * Run: bun run examples/file-upload.ts
 */

import { Asi, Type, FormDataSchema, FileSchema } from "../src";
import { mkdir } from "fs/promises";
import { join } from "path";

const app = new Asi({ development: true });

// Create uploads directory
const UPLOAD_DIR = "./uploads";
await mkdir(UPLOAD_DIR, { recursive: true });

// ===== Routes =====

app.get("/", () => ({
  message: "File Upload API",
  endpoints: [
    "POST /upload/single - Upload single file",
    "POST /upload/multiple - Upload multiple files",
    "POST /upload/avatar - Upload avatar image (max 2MB, images only)",
  ],
}));

// Single file upload
app.post("/upload/single", async (ctx) => {
  const file = await ctx.file("file");
  
  if (!file) {
    return ctx.status(400).jsonResponse({ error: "No file provided" });
  }
  
  // Save file
  const filename = `${Date.now()}-${file.name}`;
  const filepath = join(UPLOAD_DIR, filename);
  
  await Bun.write(filepath, file);
  
  return {
    message: "File uploaded successfully",
    file: {
      name: file.name,
      size: file.size,
      type: file.type,
      savedAs: filename,
    },
  };
});

// Multiple file upload
app.post("/upload/multiple", async (ctx) => {
  const formData = await ctx.formData();
  const files = formData.getAll("files") as File[];
  
  if (files.length === 0) {
    return ctx.status(400).jsonResponse({ error: "No files provided" });
  }
  
  const results = [];
  
  for (const file of files) {
    if (!(file instanceof File)) continue;
    
    const filename = `${Date.now()}-${file.name}`;
    const filepath = join(UPLOAD_DIR, filename);
    
    await Bun.write(filepath, file);
    
    results.push({
      name: file.name,
      size: file.size,
      type: file.type,
      savedAs: filename,
    });
  }
  
  return {
    message: `${results.length} files uploaded successfully`,
    files: results,
  };
});

// Avatar upload with validation
app.post("/upload/avatar", async (ctx) => {
  // Parse and validate FormData
  const form = await ctx.formData();
  
  // Validate using FormDataSchema
  const validation = FormDataSchema({
    username: Type.String({ minLength: 1 }),
  });
  
  const result = validation.validate(form);
  if (!result.success) {
    return ctx.status(400).jsonResponse({
      error: "Validation failed",
      details: result.errors,
    });
  }
  
  // Validate file
  const avatar = form.get("avatar") as File;
  if (!avatar || !(avatar instanceof File)) {
    return ctx.status(400).jsonResponse({ error: "Avatar file required" });
  }
  
  // File validation
  const fileValidation = FileSchema({
    maxSize: 2 * 1024 * 1024, // 2MB
    mimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  });
  
  const fileResult = fileValidation.validate(avatar);
  if (!fileResult.success) {
    return ctx.status(400).jsonResponse({
      error: "Invalid file",
      details: fileResult.errors,
    });
  }
  
  // Save avatar
  const ext = avatar.name.split(".").pop() || "jpg";
  const filename = `avatar-${result.data.username}-${Date.now()}.${ext}`;
  const filepath = join(UPLOAD_DIR, filename);
  
  await Bun.write(filepath, avatar);
  
  return ctx.status(201).jsonResponse({
    message: "Avatar uploaded successfully",
    username: result.data.username,
    avatar: {
      filename,
      size: avatar.size,
      type: avatar.type,
      url: `/uploads/${filename}`,
    },
  });
});

// ===== Start Server =====

app.listen(3000, () => {
  console.log("\n📚 Try these commands:");
  console.log("");
  console.log("  # Single file upload");
  console.log("  curl -X POST http://localhost:3000/upload/single -F 'file=@./README.md'");
  console.log("");
  console.log("  # Multiple file upload");
  console.log("  curl -X POST http://localhost:3000/upload/multiple -F 'files=@./README.md' -F 'files=@./package.json'");
  console.log("");
  console.log("  # Avatar upload (with validation)");
  console.log("  curl -X POST http://localhost:3000/upload/avatar -F 'username=john' -F 'avatar=@./avatar.jpg'");
  console.log("");
});
