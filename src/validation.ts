/**
 * Validation module using TypeBox
 *
 * Provides fast runtime validation with full TypeScript type inference
 */

import { type TSchema, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export { Type, type TSchema, type Static } from "@sinclair/typebox";

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
 * Валидировать данные по схеме TypeBox
 */
export function validate<T extends TSchema>(
  schema: T,
  data: unknown,
): ValidationResult<Static<T>> {
  try {
    // Проверяем валидность
    if (Value.Check(schema, data)) {
      return { success: true, data: data as Static<T> };
    }

    // Собираем ошибки с подробной информацией
    const errors: ValidationError[] = [];
    for (const error of Value.Errors(schema, data)) {
      errors.push({
        path: error.path || "/",
        message: error.message,
        value: error.value,
        expected: (error.schema as any)?.type || String(error.schema),
        received: typeof error.value,
      });
    }

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
 */
export function validateAndCoerce<T extends TSchema>(
  schema: T,
  data: unknown,
): ValidationResult<Static<T>> {
  try {
    // Преобразуем данные согласно схеме (string "123" -> number 123)
    const converted = Value.Convert(schema, data);

    // Устанавливаем default значения
    const withDefaults = Value.Default(schema, converted);

    // Проверяем валидность
    if (Value.Check(schema, withDefaults)) {
      return { success: true, data: withDefaults as Static<T> };
    }

    // Собираем ошибки с подробной информацией
    const errors: ValidationError[] = [];
    for (const error of Value.Errors(schema, withDefaults)) {
      errors.push({
        path: error.path || "/",
        message: error.message,
        value: error.value,
        expected: (error.schema as any)?.type || String(error.schema),
        received: typeof error.value,
      });
    }

    return { success: false, errors };
  } catch (err) {
    return {
      success: false,
      errors: [{ path: "", message: String(err) }],
    };
  }
}

/**
 * Создать валидатор из схемы (для переиспользования)
 */
export function createValidator<T extends TSchema>(schema: T) {
  return {
    check: (data: unknown): data is Static<T> => Value.Check(schema, data),
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
