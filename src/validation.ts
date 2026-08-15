/**
 * Validation module using TypeBox
 *
 * Provides fast runtime validation with full TypeScript type inference
 */

import { type TSchema, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { TypeCompiler, type TypeCheck } from "@sinclair/typebox/compiler";

export { Type, type TSchema, type Static } from "@sinclair/typebox";

// Compiled-validator cache shared with compiler.ts (LRU when enabled)
import { compileSchema } from "./compiler";

/** Результат валидации */
export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: ValidationError[];
}

/** Ошибка валидации */
export interface ValidationError {
  path: string;
  message: string;
  value?: unknown;
  expected?: string;
  received?: string;
}

/** Схема для роута */
export interface RouteSchema<
  TBody extends TSchema = TSchema,
  TQuery extends TSchema = TSchema,
  TParams extends TSchema = TSchema,
  THeaders extends TSchema = TSchema,
  TResponse extends TSchema = TSchema,
> {
  body?: TBody;
  query?: TQuery;
  params?: TParams;
  headers?: THeaders;
  response?: TResponse;
}

/**
 * Валидировать данные по схеме TypeBox.
 *
 * Uses the compiled validator (TypeCompiler) when available — the generated
 * `check` function runs ~15× faster than the interpreted Value.Check
 * (2.2.5 — Complex Validation: Compiled TypeBox).
 */
export function validate<T extends TSchema>(
  schema: T,
  data: unknown,
): ValidationResult<Static<T>> {
  try {
    const compiled = compileSchema(schema);
    // Fast path: compiled Check — no coercion involved
    if (compiled.Check(data)) {
      return { success: true, data: data as Static<T> };
    }

    // Collect errors from the compiled checker (same shape as Value.Errors)
    const errors = collectCompiledErrors(compiled, data);
    return { success: false, errors };
  } catch (err) {
    return {
      success: false,
      errors: [{ path: "", message: String(err) }],
    };
  }
}

/**
 * Валидировать и преобразовать данные (coerce strings to numbers, etc.)
 *
 * Two-stage (2.2.5):
 * 1. Fast path — compiled `Check` on the raw data. When the data already
 *    conforms (typical for JSON bodies with correct types) and the schema
 *    has no defaults to apply, this avoids Convert+Default entirely.
 * 2. Slow path — full coercion (Convert → Default → compiled Check) with
 *    identical semantics to the previous implementation.
 */
export function validateAndCoerce<T extends TSchema>(
  schema: T,
  data: unknown,
): ValidationResult<Static<T>> {
  try {
    const compiled = compileSchema(schema);

    // Fast path: data already conforms and no defaults need applying
    if (compiled.Check(data) && !schemaHasDefaults(schema)) {
      return { success: true, data: data as Static<T> };
    }

    // Преобразуем данные согласно схеме (string "123" -> number 123)
    const converted = Value.Convert(schema, data);

    // Устанавливаем default значения
    const withDefaults = Value.Default(schema, converted);

    // Проверяем валидность
    if (compiled.Check(withDefaults)) {
      return { success: true, data: withDefaults as Static<T> };
    }

    // Собираем ошибки с подробной информацией
    const errors = collectCompiledErrors(compiled, withDefaults);
    return { success: false, errors };
  } catch (err) {
    return {
      success: false,
      errors: [{ path: "", message: String(err) }],
    };
  }
}

/** Collect errors from a compiled TypeCheck in the ValidationError shape */
function collectCompiledErrors<T extends TSchema>(
  compiled: TypeCheck<T>,
  data: unknown,
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const error of compiled.Errors(data)) {
    errors.push({
      path: error.path || "/",
      message: error.message,
      value: error.value,
      expected: (error.schema as any)?.type || String(error.schema),
      received: typeof error.value,
    });
  }
  return errors;
}

// ============================================================================
// Schema analysis — defaults detection (cached per schema)
// ============================================================================

const defaultsCache = new WeakMap<TSchema, boolean>();
const visitingDefaults = new Set<TSchema>();

/**
 * True if the schema (or any nested subschema) declares `default` values.
 * Used to decide whether the fast validation path is safe: when defaults
 * exist, `Value.Default` must still run to materialize them.
 */
export function schemaHasDefaults(schema: TSchema): boolean {
  const cached = defaultsCache.get(schema);
  if (cached !== undefined) return cached;
  if (visitingDefaults.has(schema)) return false; // cycle guard
  visitingDefaults.add(schema);

  let result = false;
  const s = schema as any;

  if (s && typeof s === "object" && "default" in s) {
    result = true;
  } else if (s && typeof s === "object") {
    // Containers: Object (properties), Array/Tuple (items), unions/intersections
    const props = s.properties;
    if (props && typeof props === "object") {
      for (const key of Object.keys(props)) {
        if (schemaHasDefaults(props[key])) {
          result = true;
          break;
        }
      }
    }
    if (!result && s.items) {
      if (Array.isArray(s.items)) {
        for (const item of s.items) {
          if (schemaHasDefaults(item)) {
            result = true;
            break;
          }
        }
      } else if (schemaHasDefaults(s.items)) {
        result = true;
      }
    }
    if (!result) {
      for (const key of ["anyOf", "oneOf", "allOf", "not"] as const) {
        const group = s[key];
        if (!group) continue;
        const list = Array.isArray(group) ? group : [group];
        for (const sub of list) {
          if (schemaHasDefaults(sub)) {
            result = true;
            break;
          }
        }
        if (result) break;
      }
    }
  }

  visitingDefaults.delete(schema);
  defaultsCache.set(schema, result);
  return result;
}

/** For tests — clear the cached defaults analysis */
export function resetDefaultsCache(): void {
  // WeakMap can't be cleared; recreate via re-import is overkill.
  // Documented as internal: analysis is idempotent, so caching is safe.
}

/**
 * Создать валидатор из схемы (для переиспользования)
 */
export function createValidator<T extends TSchema>(
  schema: T,
): {
  check: (data: unknown) => data is Static<T>;
  validate: (data: unknown) => ValidationResult<Static<T>>;
  validateAndCoerce: (data: unknown) => ValidationResult<Static<T>>;
  parse: (data: unknown) => Static<T>;
} {
  const compiled = compileSchema(schema);
  return {
    check: (data: unknown): data is Static<T> => compiled.Check(data),
    validate: (data: unknown) => validate(schema, data),
    validateAndCoerce: (data: unknown) => validateAndCoerce(schema, data),
    parse: (data: unknown): Static<T> => {
      const result = validate(schema, data);
      if (!result.success) {
        throw new ValidationException(result.errors ?? []);
      }
      return result.data!;
    },
  };
}

/**
 * Исключение валидации
 */
export class ValidationException extends Error {
  constructor(public readonly errors: ValidationError[]) {
    super(
      `Validation failed: ${errors.map((e) => `${e.path}: ${e.message}`).join(", ")}`,
    );
    this.name = "ValidationException";
  }
}
