import { describe, it, expect } from "bun:test";
import { Asi, Type, FormDataSchema, FileSchema, validateFormData } from "../src";

describe("FormData Parsing", () => {
  describe("FormDataSchema", () => {
    it("should validate simple form fields", async () => {
      const schema = FormDataSchema({
        name: Type.String(),
        age: Type.Number(),
      });
      
      const formData = new FormData();
      formData.append("name", "Alice");
      formData.append("age", "25");
      
      const result = await validateFormData(formData, schema);
      
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: "Alice", age: 25 });
    });
    
    it("should coerce string to number", async () => {
      const schema = FormDataSchema({
        count: Type.Number(),
      });
      
      const formData = new FormData();
      formData.append("count", "42");
      
      const result = await validateFormData(formData, schema);
      
      expect(result.success).toBe(true);
      expect(result.data?.count).toBe(42);
    });
    
    it("should coerce string to boolean", async () => {
      const schema = FormDataSchema({
        active: Type.Boolean(),
      });
      
      const formData = new FormData();
      formData.append("active", "true");
      
      const result = await validateFormData(formData, schema);
      
      expect(result.success).toBe(true);
      expect(result.data?.active).toBe(true);
    });
    
    it("should return errors for missing required fields", async () => {
      const schema = FormDataSchema({
        name: Type.String(),
        email: Type.String(),
      });
      
      const formData = new FormData();
      formData.append("name", "Alice");
      // email is missing
      
      const result = await validateFormData(formData, schema);
      
      expect(result.success).toBe(false);
      expect(result.errors?.length).toBeGreaterThan(0);
      expect(result.errors?.some(e => e.field === "email")).toBe(true);
    });
    
    it("should handle optional fields with defaults", async () => {
      const schema = FormDataSchema({
        name: Type.String(),
        role: Type.String({ default: "user" }),
      });
      
      const formData = new FormData();
      formData.append("name", "Alice");
      
      const result = await validateFormData(formData, schema);
      
      expect(result.success).toBe(true);
      expect(result.data?.role).toBe("user");
    });
  });
  
  describe("FileSchema", () => {
    it("should validate file uploads", async () => {
      const schema = FormDataSchema({
        avatar: FileSchema(),
      });
      
      const file = new File(["hello world"], "test.txt", { type: "text/plain" });
      const formData = new FormData();
      formData.append("avatar", file);
      
      const result = await validateFormData(formData, schema);
      
      expect(result.success).toBe(true);
      expect(result.files?.has("avatar")).toBe(true);
      expect(result.files?.get("avatar")?.name).toBe("test.txt");
      expect(result.files?.get("avatar")?.size).toBe(11);
    });
    
    it("should validate file max size", async () => {
      const schema = FormDataSchema({
        avatar: FileSchema({ maxSize: 5 }), // 5 bytes
      });
      
      const file = new File(["hello world"], "test.txt", { type: "text/plain" }); // 11 bytes
      const formData = new FormData();
      formData.append("avatar", file);
      
      const result = await validateFormData(formData, schema);
      
      expect(result.success).toBe(false);
      expect(result.errors?.some(e => e.message.includes("too large"))).toBe(true);
    });
    
    it("should validate file MIME type", async () => {
      const schema = FormDataSchema({
        image: FileSchema({ mimeTypes: ["image/png", "image/jpeg"] }),
      });
      
      const file = new File(["hello"], "test.txt", { type: "text/plain" });
      const formData = new FormData();
      formData.append("image", file);
      
      const result = await validateFormData(formData, schema);
      
      expect(result.success).toBe(false);
      expect(result.errors?.some(e => e.message.includes("Invalid file type"))).toBe(true);
    });
    
    it("should support wildcard MIME types", async () => {
      const schema = FormDataSchema({
        image: FileSchema({ mimeTypes: ["image/*"] }),
      });
      
      const file = new File(["fake png data"], "test.png", { type: "image/png" });
      const formData = new FormData();
      formData.append("image", file);
      
      const result = await validateFormData(formData, schema);
      
      expect(result.success).toBe(true);
    });
    
    it("should validate min file size", async () => {
      const schema = FormDataSchema({
        doc: FileSchema({ minSize: 100 }),
      });
      
      const file = new File(["small"], "test.txt", { type: "text/plain" }); // 5 bytes
      const formData = new FormData();
      formData.append("doc", file);
      
      const result = await validateFormData(formData, schema);
      
      expect(result.success).toBe(false);
      expect(result.errors?.some(e => e.message.includes("too small"))).toBe(true);
    });
  });
  
  describe("Integration with Asi", () => {
    it("should validate FormData in route handler", async () => {
      const app = new Asi();
      
      app.post("/upload", async (ctx) => {
        return { 
          name: ctx.body.name,
          hasFile: !!ctx.file("avatar"),
        };
      }, {
        schema: {
          body: FormDataSchema({
            name: Type.String(),
            avatar: FileSchema(),
          })
        }
      });
      
      const file = new File(["test content"], "avatar.png", { type: "image/png" });
      const formData = new FormData();
      formData.append("name", "Alice");
      formData.append("avatar", file);
      
      const req = new Request("http://localhost/upload", {
        method: "POST",
        body: formData,
      });
      
      const res = await app.handle(req);
      const body = await res.json();
      
      expect(res.status).toBe(200);
      expect(body.name).toBe("Alice");
      expect(body.hasFile).toBe(true);
    });
    
    it("should return 400 for invalid FormData", async () => {
      const app = new Asi();
      
      app.post("/upload", async (ctx) => {
        return { success: true };
      }, {
        schema: {
          body: FormDataSchema({
            name: Type.String(),
            email: Type.String({ format: "email" }),
          })
        }
      });
      
      const formData = new FormData();
      formData.append("name", "Alice");
      // email is missing
      
      const req = new Request("http://localhost/upload", {
        method: "POST",
        body: formData,
      });
      
      const res = await app.handle(req);
      
      expect(res.status).toBe(400);
    });
    
    it("should access file via ctx.file()", async () => {
      const app = new Asi();
      
      app.post("/upload", async (ctx) => {
        const file = ctx.file("document");
        return { 
          name: file?.name,
          size: file?.size,
          type: file?.type,
        };
      }, {
        schema: {
          body: FormDataSchema({
            document: FileSchema(),
          })
        }
      });
      
      const file = new File(["hello world content"], "doc.pdf", { type: "application/pdf" });
      const formData = new FormData();
      formData.append("document", file);
      
      const req = new Request("http://localhost/upload", {
        method: "POST",
        body: formData,
      });
      
      const res = await app.handle(req);
      const body = await res.json();
      
      expect(res.status).toBe(200);
      expect(body.name).toBe("doc.pdf");
      expect(body.size).toBe(19);
      expect(body.type).toBe("application/pdf");
    });
  });
});
