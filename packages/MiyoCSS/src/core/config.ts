/**
 * miyocss core — token configuration (MiyoCSS TODO 0.2).
 *
 * Design tokens + `defineConfig()` with runtime TypeBox validation and
 * `resolveConfig()` that deep-merges user config over defaults:
 *
 *  - `theme.*`      — REPLACES the default group wholesale (setting
 *                     `theme.spacing` drops all default spacing steps).
 *  - `extend.theme.*` — deep-merges into whatever `theme` resolved to
 *                     (Tailwind-style: additions without losing defaults).
 *
 * Colors support nesting — `{ blue: { 500: "#3b82f6" } }` flattens to
 * `blue-500` on resolve. A nested `DEFAULT` key flattens to the parent
 * name itself: `{ primary: { DEFAULT: "#3b82f6" } }` → `primary`.
 */

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import { defaultOptions, defaultTheme } from "./defaults";

// ===== TypeBox schemas =====

/** Recursive color value: a CSS string or a nested map of shades. */
const colorValueSchema = Type.Recursive((self) =>
  Type.Union([Type.String(), Type.Record(Type.String(), self)]),
);

/** Token group: named → CSS value (string or number). */
const tokenMapSchema = Type.Record(
  Type.String(),
  Type.Union([Type.String(), Type.Number()]),
);

/** Group whose values are CSS strings only (fonts, shadows, ...). */
const stringMapSchema = Type.Record(Type.String(), Type.String());

const themeSchema = Type.Object(
  {
    colors: Type.Optional(Type.Record(Type.String(), colorValueSchema)),
    spacing: Type.Optional(tokenMapSchema),
    fontFamily: Type.Optional(stringMapSchema),
    fontSize: Type.Optional(tokenMapSchema),
    fontWeight: Type.Optional(tokenMapSchema),
    lineHeight: Type.Optional(tokenMapSchema),
    letterSpacing: Type.Optional(tokenMapSchema),
    borderRadius: Type.Optional(tokenMapSchema),
    boxShadow: Type.Optional(stringMapSchema),
    opacity: Type.Optional(tokenMapSchema),
    zIndex: Type.Optional(tokenMapSchema),
    breakpoints: Type.Optional(tokenMapSchema),
  },
  { additionalProperties: false },
);

const optionsSchema = Type.Object(
  {
    darkMode: Type.Optional(
      Type.Union([Type.Literal("class"), Type.Literal("media")]),
    ),
    prefix: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

const configSchema = Type.Object(
  {
    theme: Type.Optional(themeSchema),
    extend: Type.Optional(
      Type.Object(
        { theme: Type.Optional(themeSchema) },
        { additionalProperties: false },
      ),
    ),
    options: Type.Optional(optionsSchema),
  },
  { additionalProperties: false },
);

/**
 * A user-defined utility (MiyoCSS TODO 1.1).
 *
 * Two kinds of matching, tried in order:
 * - `static` — exact class name → declarations (`{ card: { background: "#fff" } }`)
 * - `match` — regex matchers, first hit wins; the handler receives the
 *   RegExp match array and the resolved config, and returns declarations or null.
 *
 * Custom utilities are resolved BEFORE built-ins, so a user-defined `card`
 * overrides any future built-in of the same name (documented contract).
 */
export interface CustomUtilityMatcher {
  /** Tested against the full class name (variants already stripped). */
  pattern: RegExp;
  /** Return CSS declarations, or null if the class shouldn't match. */
  apply: (match: RegExpMatchArray, config: ResolvedConfig) => Record<string, string> | null;
}

export interface CustomUtility {
  /** Unique name, used in error messages. */
  name: string;
  /** Exact class name → declarations. */
  static?: Record<string, Record<string, string>>;
  /** Regex matchers, tried in order. */
  match?: CustomUtilityMatcher[];
}

/**
 * Validate + return a custom utility definition. Throws a TypeError for a
 * malformed definition (bad name, non-declaration statics, non-regex matchers).
 */
export function defineUtility(util: CustomUtility): CustomUtility {
  if (!util || typeof util !== "object") {
    throw new TypeError("miyocss: defineUtility() expects an object");
  }
  if (typeof util.name !== "string" || util.name.length === 0) {
    throw new TypeError('miyocss: defineUtility() requires a non-empty string "name"');
  }
  if (util.static !== undefined) {
    if (!util.static || typeof util.static !== "object" || Array.isArray(util.static)) {
      throw new TypeError(`miyocss: utility "${util.name}" — static must be an object of class → declarations`);
    }
    for (const [cls, decls] of Object.entries(util.static)) {
      if (!decls || typeof decls !== "object" || Array.isArray(decls)) {
        throw new TypeError(`miyocss: utility "${util.name}" — static "${cls}" must map to CSS declarations`);
      }
    }
  }
  if (util.match !== undefined) {
    if (!Array.isArray(util.match)) {
      throw new TypeError(`miyocss: utility "${util.name}" — match must be an array`);
    }
    for (const matcher of util.match) {
      if (!(matcher.pattern instanceof RegExp)) {
        throw new TypeError(`miyocss: utility "${util.name}" — every matcher needs a RegExp pattern`);
      }
      if (typeof matcher.apply !== "function") {
        throw new TypeError(`miyocss: utility "${util.name}" — every matcher needs an apply() function`);
      }
    }
  }
  return util;
}

// ===== Public types =====

/** A single color value: CSS string, or nested map of shades. */
export type ColorValue = Static<typeof colorValueSchema>;

/** Named token → CSS value. */
export type TokenMap = Static<typeof tokenMapSchema>;

/** A theme group, all optional (user input shape). */
export type MiyoTheme = Static<typeof themeSchema>;

/** `extend` block — deep-merged on top of the resolved theme. */
export interface MiyoExtend {
  theme?: MiyoTheme;
}

/** Framework-level options (utilities, dark mode, prefixing). */
export type MiyoOptions = Static<typeof optionsSchema>;

/** Normalized options after `defineConfig`. */
export interface NormalizedOptions {
  darkMode: "class" | "media";
  prefix: string;
}

/** Full user-facing config. */
export type MiyoConfig = Static<typeof configSchema> & {
  /** Custom utilities registered via `defineUtility()` (MiyoCSS TODO 1.1). */
  utilities?: CustomUtility[];
};

/** Theme with every group guaranteed present (post-resolve). */
export type FullTheme = Required<MiyoTheme>;

/** Fully resolved config — what the utility generator (0.3) consumes. */
export interface ResolvedConfig {
  theme: {
    /** Flattened: `blue-500`, `primary`, ... (no nested objects). */
    colors: Record<string, string>;
    spacing: TokenMap;
    fontFamily: Record<string, string>;
    fontSize: TokenMap;
    fontWeight: TokenMap;
    lineHeight: TokenMap;
    letterSpacing: TokenMap;
    borderRadius: TokenMap;
    boxShadow: Record<string, string>;
    opacity: TokenMap;
    zIndex: TokenMap;
    breakpoints: TokenMap;
  };
  options: NormalizedOptions;
  /** Custom utilities (0 — built-in only). */
  utilities: CustomUtility[];
}

// ===== Validation =====

/** Throw a TypeError with the first validation errors, if config is invalid. */
function assertValidConfig(config: unknown): asserts config is MiyoConfig {
  // `utilities` holds functions/regexes — validate shape separately, then strip
  // before TypeBox checks (functions can't round-trip through a JSON schema).
  const { utilities, ...rest } = (config ?? {}) as Partial<MiyoConfig>;
  if (utilities !== undefined) {
    for (const util of utilities) defineUtility(util);
  }
  if (Value.Check(configSchema, rest)) return;
  const errors: string[] = [];
  for (const error of Value.Errors(configSchema, config)) {
    errors.push(`${error.path || "/"}: ${error.message}`);
    if (errors.length >= 5) break;
  }
  throw new TypeError(`miyocss: invalid config — ${errors.join("; ")}`);
}

// ===== defineConfig =====

/**
 * Validate + normalize a user config.
 *
 * Throws a TypeError at startup for typos, wrong token types and unknown
 * keys, instead of silently producing broken CSS later.
 *
 * @example
 * ```ts
 * const config = defineConfig({
 *   theme: { colors: { brand: "#6d28d9" } },
 *   extend: { theme: { spacing: { 18: "72px" } } },
 *   options: { darkMode: "class", prefix: "mi-" },
 * });
 * ```
 */
export function defineConfig(
  config: MiyoConfig,
): MiyoConfig & { options: NormalizedOptions } {
  assertValidConfig(config);
  return {
    ...config,
    options: { ...defaultOptions, ...(config.options ?? {}) },
  };
}

// ===== resolveConfig =====

/**
 * Merge a config over the built-in defaults and flatten colors.
 *
 * Call it with nothing to get the default theme resolved.
 */
export function resolveConfig(config?: MiyoConfig): ResolvedConfig {
  const theme = mergeTheme(defaultTheme, config?.theme, config?.extend?.theme);
  return {
    theme: {
      ...theme,
      colors: flattenColors(theme.colors),
    },
    options: { ...defaultOptions, ...(config?.options ?? {}) },
    utilities: config?.utilities ?? [],
  };
}

/** Resolved default theme — handy for previews, tooling and tests. */
export function resolveDefaultConfig(): ResolvedConfig {
  return resolveConfig();
}

// ===== Merge helpers =====

function mergeTheme(
  defaults: MiyoTheme,
  user?: MiyoTheme,
  extend?: MiyoTheme,
): FullTheme {
  const result = deepClone(defaults) as FullTheme;
  for (const key of Object.keys(defaults)) {
    // theme.* replaces the whole group
    if (user && key in user) {
      (result as Record<string, unknown>)[key] = deepClone(
        (user as Record<string, unknown>)[key],
      );
    }
    // extend.theme.* deep-merges on top
    if (extend && key in extend) {
      (result as Record<string, unknown>)[key] = deepMerge(
        (result as Record<string, unknown>)[key],
        (extend as Record<string, unknown>)[key],
      );
    }
  }
  return result;
}

/** Deep-merge `b` into `a` for plain objects; arrays/primitives replace. */
export function deepMerge<T>(a: T, b: T): T {
  if (isPlainObject(a) && isPlainObject(b)) {
    const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
    for (const [key, value] of Object.entries(
      b as Record<string, unknown>,
    )) {
      out[key] =
        key in out ? deepMerge(out[key], value) : deepClone(value);
    }
    return out as T;
  }
  return b;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function deepClone<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => deepClone(v)) as T;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = deepClone(val);
  }
  return out as T;
}

// ===== Color flattening =====

/**
 * Flatten nested color maps into `name-shade` string keys.
 *
 * A nested `DEFAULT` key flattens to the parent name itself:
 * `{ primary: { DEFAULT: "#3b82f6", 600: "#2563eb" } }`
 * → `{ primary: "#3b82f6", "primary-600": "#2563eb" }`.
 */
export function flattenColors(
  colors: Record<string, ColorValue>,
  prefix = "",
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(colors)) {
    const flatKey =
      key === "DEFAULT" && prefix !== ""
        ? prefix
        : prefix !== ""
          ? `${prefix}-${key}`
          : key;
    if (typeof value === "string") {
      out[flatKey] = value;
    } else {
      Object.assign(out, flattenColors(value, flatKey));
    }
  }
  return out;
}
