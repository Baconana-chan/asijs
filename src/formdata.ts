/**
 * FormData / Multipart parsing support for AsiJS
 * 
 * @example
 * ```ts
 * import { Asi, Type, FormDataSchema, FileSchema } from "asijs";
 * 
 * const app = new Asi();
 * 
 * // Simple form fields
 * app.post("/register", async (ctx) => {
 *   const data = await ctx.formData();
 *   return { name: data.get("name") };
 * }, {
 *   schema: {
 *     body: FormDataSchema({
 *       name: Type.String(),
 *       email: Type.String({ format: "email" }),
 *     })
 *   }
 * });
 * 
 * // With file upload
 * app.post("/upload", async (ctx) => {
 *   const file = ctx.file("avatar");
 *   return { size: file?.size };
 * }, {
 *   schema: {
 *     body: FormDataSchema({
 *       avatar: FileSchema({ maxSize: 5_000_000, mimeTypes: ["image/png", "image/jpeg"] }),
 *       description: Type.Optional(Type.String()),
 *     })
 *   }
 * });
 * ```
 */

import { Type, type TSchema, type Static } from "@sinclair/typebox";
import { TypeCompiler, type TypeCheck } from "@sinclair/typebox/compiler";

// ===== File Schema =====

/** Options for file validation */
export interface FileSchemaOptions {
  /** Maximum file size in bytes */
  maxSize?: number;
  /** Allowed MIME types */
  mimeTypes?: string[];
  /** Minimum file size in bytes */
  minSize?: number;
  /** File name pattern (regex) */
  namePattern?: RegExp | string;
}

/** Parsed file info from FormData */
export interface ParsedFile {
  /** File name */
  name: string;
  /** File size in bytes */
  size: number;
  /** MIME type */
  type: string;
  /** The original File/Blob object */
  file: File;
  /** Get file as ArrayBuffer */
  arrayBuffer(): Promise<ArrayBuffer>;
  /** Get file as text */
  text(): Promise<string>;
}

/** Symbol to identify File schemas */
export const FILE_SCHEMA_SYMBOL = Symbol("FileSchema");

/** Symbol to identify FormData schemas */
export const FORMDATA_SCHEMA_SYMBOL = Symbol("FormDataSchema");

/**
 * Create a File schema for FormData validation
 * 
 * @example
 * ```ts
 * FileSchema({ maxSize: 10_000_000, mimeTypes: ["image/*", "application/pdf"] })
 * ```
 */
export function FileSchema(options: FileSchemaOptions = {}): TSchema & { [FILE_SCHEMA_SYMBOL]: FileSchemaOptions } {
  // We use a custom schema that won't be directly validated by TypeBox
  // but will be handled by our FormData validator
  const schema = Type.Any({
    [FILE_SCHEMA_SYMBOL]: options,
    title: "File",
    description: buildFileDescription(options),
  });
  
  return Object.assign(schema, { [FILE_SCHEMA_SYMBOL]: options });
}

function buildFileDescription(options: FileSchemaOptions): string {
  const parts: string[] = ["File upload"];
  if (options.maxSize) {
    parts.push(`max ${formatBytes(options.maxSize)}`);
  }
  if (options.mimeTypes?.length) {
    parts.push(`types: ${options.mimeTypes.join(", ")}`);
  }
  return parts.join(", ");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ===== FormData Schema =====

/** FormData schema type */
export interface FormDataSchemaType {
  [FORMDATA_SCHEMA_SYMBOL]: true;
  fields: Record<string, TSchema>;
  compiledFields?: Map<string, TypeCheck<TSchema>>;
}

/**
 * Create a FormData schema for validating multipart form data
 * 
 * @example
 * ```ts
 * FormDataSchema({
 *   name: Type.String(),
 *   age: Type.Number(),
 *   avatar: FileSchema({ maxSize: 5_000_000 }),
 * })
 * ```
 */
export function FormDataSchema<T extends Record<string, TSchema>>(
  fields: T
): TSchema & FormDataSchemaType {
  // Create a wrapper schema
  const schema = Type.Object(
    Object.fromEntries(
      Object.entries(fields).map(([key, value]) => {
        // For file fields, use Any
        if (isFileSchema(value)) {
          return [key, Type.Any()];
        }
        return [key, value];
      })
    ) as T
  );
  
  return Object.assign(schema, {
    [FORMDATA_SCHEMA_SYMBOL]: true as const,
    fields,
  });
}

/** Check if schema is a File schema */
export function isFileSchema(schema: unknown): schema is TSchema & { [FILE_SCHEMA_SYMBOL]: FileSchemaOptions } {
  return schema !== null && typeof schema === "object" && FILE_SCHEMA_SYMBOL in schema;
}

/** Check if schema is a FormData schema */
export function isFormDataSchema(schema: unknown): schema is TSchema & FormDataSchemaType {
  return schema !== null && typeof schema === "object" && FORMDATA_SCHEMA_SYMBOL in schema;
}

// ===== FormData Validator =====

export interface FormDataValidationError {
  field: string;
  message: string;
}

export interface FormDataValidationResult<T = Record<string, unknown>> {
  success: boolean;
  data?: T;
  files?: Map<string, ParsedFile>;
  errors?: FormDataValidationError[];
}

/**
 * Validate FormData against a schema
 */
export async function validateFormData<T extends Record<string, TSchema>>(
  formData: FormData,
  schema: TSchema & FormDataSchemaType
): Promise<FormDataValidationResult<{ [K in keyof T]: Static<T[K]> }>> {
  const errors: FormDataValidationError[] = [];
  const data: Record<string, unknown> = {};
  const files = new Map<string, ParsedFile>();
  
  const fields = schema.fields;
  
  // Compile schemas if not already compiled
  if (!schema.compiledFields) {
    schema.compiledFields = new Map();
    for (const [key, fieldSchema] of Object.entries(fields)) {
      if (!isFileSchema(fieldSchema)) {
        schema.compiledFields.set(key, TypeCompiler.Compile(fieldSchema));
      }
    }
  }
  
  for (const [key, fieldSchema] of Object.entries(fields)) {
    const rawValue = formData.get(key);
    
    // Check if field is optional
    const isOptional = fieldSchema.type === "union" && 
      (fieldSchema as any).anyOf?.some((s: TSchema) => s.type === "null" || s.type === "undefined");
    
    // Handle file fields
    if (isFileSchema(fieldSchema)) {
      if (rawValue instanceof File) {
        const fileError = validateFile(rawValue, fieldSchema[FILE_SCHEMA_SYMBOL], key);
        if (fileError) {
          errors.push(fileError);
        } else {
          const parsedFile = createParsedFile(rawValue);
          files.set(key, parsedFile);
          data[key] = parsedFile;
        }
      } else if (rawValue === null && !isOptional) {
        errors.push({ field: key, message: "File is required" });
      }
      continue;
    }
    
    // Handle regular fields
    if (rawValue === null) {
      if (!isOptional && !("default" in fieldSchema)) {
        errors.push({ field: key, message: "Field is required" });
      } else if ("default" in fieldSchema) {
        data[key] = fieldSchema.default;
      }
      continue;
    }
    
    // Coerce value based on expected type
    let value: unknown = rawValue;
    if (typeof rawValue === "string") {
      value = coerceFormValue(rawValue, fieldSchema);
    }
    
    // Validate with compiled schema
    const compiled = schema.compiledFields!.get(key);
    if (compiled) {
      if (!compiled.Check(value)) {
        const typeErrors = [...compiled.Errors(value)];
        for (const error of typeErrors) {
          errors.push({ 
            field: key, 
            message: error.message || `Invalid value for ${key}` 
          });
        }
      } else {
        data[key] = value;
      }
    } else {
      data[key] = value;
    }
  }
  
  if (errors.length > 0) {
    return { success: false, errors };
  }
  
  return { 
    success: true, 
    data: data as { [K in keyof T]: Static<T[K]> },
    files,
  };
}

function validateFile(
  file: File, 
  options: FileSchemaOptions, 
  fieldName: string
): FormDataValidationError | null {
  // Check min size
  if (options.minSize !== undefined && file.size < options.minSize) {
    return { 
      field: fieldName, 
      message: `File too small. Minimum: ${formatBytes(options.minSize)}` 
    };
  }
  
  // Check max size
  if (options.maxSize !== undefined && file.size > options.maxSize) {
    return { 
      field: fieldName, 
      message: `File too large. Maximum: ${formatBytes(options.maxSize)}` 
    };
  }
  
  // Check MIME type
  if (options.mimeTypes && options.mimeTypes.length > 0) {
    const isAllowed = options.mimeTypes.some(pattern => {
      if (pattern.endsWith("/*")) {
        // Wildcard pattern: image/*
        const prefix = pattern.slice(0, -2);
        return file.type.startsWith(prefix + "/");
      }
      return file.type === pattern;
    });
    
    if (!isAllowed) {
      return { 
        field: fieldName, 
        message: `Invalid file type: ${file.type}. Allowed: ${options.mimeTypes.join(", ")}` 
      };
    }
  }
  
  // Check name pattern
  if (options.namePattern) {
    const regex = typeof options.namePattern === "string" 
      ? new RegExp(options.namePattern) 
      : options.namePattern;
    
    if (!regex.test(file.name)) {
      return { 
        field: fieldName, 
        message: `Invalid file name: ${file.name}` 
      };
    }
  }
  
  return null;
}

function createParsedFile(file: File): ParsedFile {
  return {
    name: file.name,
    size: file.size,
    type: file.type,
    file,
    arrayBuffer: () => file.arrayBuffer(),
    text: () => file.text(),
  };
}

function coerceFormValue(value: string, schema: TSchema): unknown {
  const type = schema.type;
  
  switch (type) {
    case "number":
    case "integer":
      const num = Number(value);
      return isNaN(num) ? value : num;
    
    case "boolean":
      if (value === "true" || value === "1" || value === "on") return true;
      if (value === "false" || value === "0" || value === "") return false;
      return value;
    
    case "array":
      // For arrays, we expect multiple form fields or JSON
      try {
        return JSON.parse(value);
      } catch {
        return [value];
      }
    
    case "object":
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    
    default:
      return value;
  }
}

// ===== Multiple Files Support =====

/**
 * Get all files with the same field name from FormData
 */
export function getMultipleFiles(formData: FormData, fieldName: string): File[] {
  const files: File[] = [];
  for (const value of formData.getAll(fieldName)) {
    if (value instanceof File) {
      files.push(value);
    }
  }
  return files;
}

/**
 * Create a schema for multiple files
 */
export function MultipleFilesSchema(options: FileSchemaOptions & { maxCount?: number; minCount?: number } = {}): TSchema {
  return Type.Array(FileSchema(options), {
    minItems: options.minCount,
    maxItems: options.maxCount,
  });
}
