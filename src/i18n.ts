/**
 * i18n & Localization Plugin for AsiJS
 *
 * Features:
 * - Locale detection (header, cookie, query, path)
 * - Translation with interpolation
 * - Pluralization support
 * - Date/time/number formatting (Intl API)
 * - Nested translations
 * - Fallback locales
 */

import type { Context } from "./context";
import type { AsiPlugin, PluginHost } from "./plugin";

// ============================================================================
// Types
// ============================================================================

export interface Translation {
  [key: string]: string | Translation | PluralRules;
}

export interface PluralRules {
  zero?: string;
  one: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

export interface Translations {
  [locale: string]: Translation;
}

export interface I18nOptions {
  /** Default locale */
  defaultLocale: string;
  /** Supported locales */
  locales: string[];
  /** Translation messages */
  translations: Translations;
  /** Fallback locale (defaults to defaultLocale) */
  fallbackLocale?: string;
  /** Locale detection strategy */
  detection?: LocaleDetection;
  /** Cookie name for locale preference */
  cookieName?: string;
  /** Query parameter name */
  queryParam?: string;
  /** Path prefix detection (e.g., /en/about) */
  pathPrefix?: boolean;
}

export interface LocaleDetection {
  /** Order of detection methods */
  order?: ("path" | "query" | "cookie" | "header")[];
  /** Cache detected locale in cookie */
  cacheInCookie?: boolean;
}

export interface I18nContext {
  /** Current locale */
  locale: string;
  /** Translate a key */
  t: TranslateFunction;
  /** Format a number */
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  /** Format a date */
  formatDate: (
    value: Date | number | string,
    options?: Intl.DateTimeFormatOptions,
  ) => string;
  /** Format relative time */
  formatRelative: (
    value: number,
    unit: Intl.RelativeTimeFormatUnit,
    options?: Intl.RelativeTimeFormatOptions,
  ) => string;
  /** Format currency */
  formatCurrency: (
    value: number,
    currency: string,
    options?: Intl.NumberFormatOptions,
  ) => string;
  /** Format a list */
  formatList: (values: string[], options?: Intl.ListFormatOptions) => string;
  /** Set locale */
  setLocale: (locale: string) => void;
  /** Get all available locales */
  locales: string[];
  /** Check if locale is RTL */
  isRTL: boolean;
}

export type TranslateFunction = (
  key: string,
  params?: Record<string, string | number>,
  count?: number,
) => string;

// ============================================================================
// RTL Locales
// ============================================================================

const RTL_LOCALES = new Set([
  "ar",
  "ar-SA",
  "ar-EG",
  "ar-AE",
  "he",
  "he-IL",
  "fa",
  "fa-IR",
  "ur",
  "ur-PK",
  "yi",
  "ps",
  "sd",
  "ug",
]);

// ============================================================================
// I18n Class
// ============================================================================

export class I18n {
  private options: Required<I18nOptions>;
  private localeSet: Set<string>;
  private languageFallback: Map<string, string>;
  private pluralRules: Map<string, Intl.PluralRules> = new Map();
  private numberFormats: Map<string, Intl.NumberFormat> = new Map();
  private dateFormats: Map<string, Intl.DateTimeFormat> = new Map();
  private relativeFormats: Map<string, Intl.RelativeTimeFormat> = new Map();
  private listFormats: Map<string, Intl.ListFormat> = new Map();
  private acceptLanguageCache: Map<string, string | null> = new Map();
  private optionsKeyCache: WeakMap<object, string> = new WeakMap();

  constructor(options: I18nOptions) {
    this.options = {
      ...options,
      fallbackLocale: options.fallbackLocale ?? options.defaultLocale,
      detection: options.detection ?? {
        order: ["path", "query", "cookie", "header"],
        cacheInCookie: true,
      },
      cookieName: options.cookieName ?? "locale",
      queryParam: options.queryParam ?? "lang",
      pathPrefix: options.pathPrefix ?? false,
    };

    this.localeSet = new Set(options.locales);
    this.languageFallback = new Map();
    for (const locale of options.locales) {
      const lang = locale.split("-")[0];
      if (!this.languageFallback.has(lang)) {
        this.languageFallback.set(lang, locale);
      }
    }

    // Pre-create Intl formatters for all locales
    for (const locale of options.locales) {
      this.pluralRules.set(locale, new Intl.PluralRules(locale));
    }
  }

  /**
   * Detect locale from request context
   */
  detectLocale(ctx: Context): string {
    const order = this.options.detection.order ?? [
      "path",
      "query",
      "cookie",
      "header",
    ];

    for (const method of order) {
      let detected: string | null = null;

      switch (method) {
        case "path":
          if (this.options.pathPrefix) {
            detected = this.detectFromPath(ctx);
          }
          break;
        case "query":
          detected = this.detectFromQuery(ctx);
          break;
        case "cookie":
          detected = this.detectFromCookie(ctx);
          break;
        case "header":
          detected = this.detectFromHeader(ctx);
          break;
      }

      if (detected && this.isSupported(detected)) {
        return detected;
      }
    }

    return this.options.defaultLocale;
  }

  private detectFromPath(ctx: Context): string | null {
    const segments = ctx.path.split("/").filter(Boolean);

    if (segments.length > 0) {
      const potentialLocale = segments[0];
      if (this.isSupported(potentialLocale)) {
        return potentialLocale;
      }
    }

    return null;
  }

  private detectFromQuery(ctx: Context): string | null {
    const query = ctx.query as Record<string, string>;
    return query[this.options.queryParam] ?? null;
  }

  private detectFromCookie(ctx: Context): string | null {
    return ctx.cookies[this.options.cookieName] ?? null;
  }

  private detectFromHeader(ctx: Context): string | null {
    const acceptLanguage = ctx.request.headers.get("accept-language");
    if (!acceptLanguage) return null;

    if (this.acceptLanguageCache.has(acceptLanguage)) {
      return this.acceptLanguageCache.get(acceptLanguage) ?? null;
    }

    let bestLocale: string | null = null;
    let bestQ = -1;

    const parts = acceptLanguage.split(",");
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      if (!part) continue;

      const semi = part.indexOf(";");
      const code = (semi === -1 ? part : part.slice(0, semi)).trim();
      if (!code) continue;

      let q = 1;
      if (semi !== -1) {
        const qPart = part.slice(semi + 1).trim();
        if (qPart.startsWith("q=")) {
          const parsed = parseFloat(qPart.slice(2));
          if (!Number.isNaN(parsed)) q = parsed;
        }
      }

      if (q < bestQ) continue;

      const matched = this.matchLocale(code);
      if (matched) {
        bestQ = q;
        bestLocale = matched;
        if (bestQ === 1) {
          // Cannot do better than q=1 for later entries
          // but keep scanning in case of earlier unsupported entries
        }
      }
    }

    this.acceptLanguageCache.set(acceptLanguage, bestLocale);
    return bestLocale;
  }

  private isSupported(locale: string): boolean {
    return this.localeSet.has(locale);
  }

  private matchLocale(code: string): string | null {
    if (this.localeSet.has(code)) return code;
    const lang = code.split("-")[0];
    if (this.localeSet.has(lang)) return lang;
    return this.languageFallback.get(lang) ?? null;
  }

  /**
   * Translate a key
   */
  translate(
    locale: string,
    key: string,
    params?: Record<string, string | number>,
    count?: number,
  ): string {
    const translation = this.getTranslation(locale, key);

    if (translation === null) {
      // Try fallback locale
      if (locale !== this.options.fallbackLocale) {
        const fallback = this.getTranslation(this.options.fallbackLocale, key);
        if (fallback !== null) {
          return this.interpolate(
            typeof fallback === "string"
              ? fallback
              : this.selectPlural(this.options.fallbackLocale, fallback, count),
            params,
          );
        }
      }
      // Return key as fallback
      return key;
    }

    // Handle plural rules
    if (typeof translation === "object" && !Array.isArray(translation)) {
      if ("one" in translation || "other" in translation) {
        const pluralForm = this.selectPlural(
          locale,
          translation as PluralRules,
          count,
        );
        return this.interpolate(pluralForm, { ...params, count: count ?? 0 });
      }
    }

    return this.interpolate(translation as string, params);
  }

  private getTranslation(
    locale: string,
    key: string,
  ): string | PluralRules | null {
    const translations = this.options.translations[locale];
    if (!translations) return null;

    // Support nested keys with dot notation
    const keys = key.split(".");
    let result: unknown = translations;

    for (const k of keys) {
      if (result && typeof result === "object" && k in result) {
        result = (result as Record<string, unknown>)[k];
      } else {
        return null;
      }
    }

    if (typeof result === "string") {
      return result;
    }

    if (
      typeof result === "object" &&
      result !== null &&
      ("one" in result || "other" in result)
    ) {
      return result as PluralRules;
    }

    return null;
  }

  private selectPlural(
    locale: string,
    rules: PluralRules,
    count?: number,
  ): string {
    const n = count ?? 0;

    // Get plural category
    let pluralRules = this.pluralRules.get(locale);
    if (!pluralRules) {
      pluralRules = new Intl.PluralRules(locale);
      this.pluralRules.set(locale, pluralRules);
    }

    const category = pluralRules.select(n);

    // Handle special zero case
    if (n === 0 && rules.zero) {
      return rules.zero;
    }

    // Try exact category match, then fallback to 'other'
    return (
      rules[category as keyof PluralRules] ?? rules.other ?? rules.one ?? ""
    );
  }

  private interpolate(
    template: string,
    params?: Record<string, string | number>,
  ): string {
    if (!params) return template;

    return template.replace(/\{\{?\s*(\w+)\s*\}?\}/g, (_, key) => {
      return params[key]?.toString() ?? `{${key}}`;
    });
  }

  /**
   * Format number
   */
  formatNumber(
    locale: string,
    value: number,
    options?: Intl.NumberFormatOptions,
  ): string {
    const key = `${locale}:${this.getOptionsKey(options)}`;
    let formatter = this.numberFormats.get(key);
    if (!formatter) {
      formatter = new Intl.NumberFormat(locale, options);
      this.numberFormats.set(key, formatter);
    }
    return formatter.format(value);
  }

  /**
   * Format date
   */
  formatDate(
    locale: string,
    value: Date | number | string,
    options?: Intl.DateTimeFormatOptions,
  ): string {
    const key = `${locale}:${this.getOptionsKey(options)}`;
    let formatter = this.dateFormats.get(key);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat(locale, options);
      this.dateFormats.set(key, formatter);
    }
    const date = value instanceof Date ? value : new Date(value);
    return formatter.format(date);
  }

  /**
   * Format relative time
   */
  formatRelative(
    locale: string,
    value: number,
    unit: Intl.RelativeTimeFormatUnit,
    options?: Intl.RelativeTimeFormatOptions,
  ): string {
    const key = `${locale}:${this.getOptionsKey(options)}`;
    let formatter = this.relativeFormats.get(key);
    if (!formatter) {
      formatter = new Intl.RelativeTimeFormat(locale, options);
      this.relativeFormats.set(key, formatter);
    }
    return formatter.format(value, unit);
  }

  /**
   * Format currency
   */
  formatCurrency(
    locale: string,
    value: number,
    currency: string,
    options?: Intl.NumberFormatOptions,
  ): string {
    return this.formatNumber(locale, value, {
      style: "currency",
      currency,
      ...options,
    });
  }

  /**
   * Format list
   */
  formatList(
    locale: string,
    values: string[],
    options?: Intl.ListFormatOptions,
  ): string {
    const key = `${locale}:${this.getOptionsKey(options)}`;
    let formatter = this.listFormats.get(key);
    if (!formatter) {
      formatter = new Intl.ListFormat(locale, options);
      this.listFormats.set(key, formatter);
    }
    return formatter.format(values);
  }

  private getOptionsKey(options?: object): string {
    if (!options) return "";
    const cached = this.optionsKeyCache.get(options);
    if (cached) return cached;
    const key = JSON.stringify(options);
    this.optionsKeyCache.set(options, key);
    return key;
  }

  /**
   * Check if locale is RTL
   */
  isRTL(locale: string): boolean {
    return RTL_LOCALES.has(locale) || RTL_LOCALES.has(locale.split("-")[0]);
  }

  /**
   * Create context helpers
   */
  createContext(ctx: Context, initialLocale?: string): I18nContext {
    let currentLocale = initialLocale ?? this.detectLocale(ctx);

    return {
      get locale() {
        return currentLocale;
      },
      t: (key, params, count) =>
        this.translate(currentLocale, key, params, count),
      formatNumber: (value, options) =>
        this.formatNumber(currentLocale, value, options),
      formatDate: (value, options) =>
        this.formatDate(currentLocale, value, options),
      formatRelative: (value, unit, options) =>
        this.formatRelative(currentLocale, value, unit, options),
      formatCurrency: (value, currency, options) =>
        this.formatCurrency(currentLocale, value, currency, options),
      formatList: (values, options) =>
        this.formatList(currentLocale, values, options),
      setLocale: (locale) => {
        if (this.isSupported(locale)) {
          currentLocale = locale;
        }
      },
      locales: this.options.locales,
      get isRTL() {
        return RTL_LOCALES.has(currentLocale);
      },
    };
  }

  get defaultLocale(): string {
    return this.options.defaultLocale;
  }

  get locales(): string[] {
    return this.options.locales;
  }
}

// ============================================================================
// Plugin
// ============================================================================

/**
 * Create i18n plugin
 *
 * @example
 * ```ts
 * const app = new Asi();
 *
 * app.use(i18n({
 *   defaultLocale: 'en',
 *   locales: ['en', 'ru', 'ja'],
 *   translations: {
 *     en: {
 *       greeting: 'Hello, {{name}}!',
 *       items: {
 *         one: '{{count}} item',
 *         other: '{{count}} items'
 *       }
 *     },
 *     ru: {
 *       greeting: 'Привет, {{name}}!',
 *       items: {
 *         one: '{{count}} предмет',
 *         few: '{{count}} предмета',
 *         many: '{{count}} предметов',
 *         other: '{{count}} предметов'
 *       }
 *     }
 *   }
 * }));
 *
 * app.get('/', (ctx) => {
 *   const { t, formatDate } = ctx.i18n;
 *   return {
 *     message: t('greeting', { name: 'World' }),
 *     items: t('items', {}, 5),
 *     date: formatDate(new Date())
 *   };
 * });
 * ```
 */
export function i18n(options: I18nOptions): AsiPlugin {
  const instance = new I18n(options);

  return {
    name: "i18n",
    config: {
      name: "i18n",
      setup(app: PluginHost) {
        // Add beforeHandle to inject i18n context
        app.use((ctx, next) => {
          const i18nContext = instance.createContext(ctx);
          (ctx as Context & { i18n: I18nContext }).i18n = i18nContext;

          // Set locale in store for other middleware
          ctx.store.locale = i18nContext.locale;
          ctx.store.isRTL = i18nContext.isRTL;

          return next();
        });
      },
    },
    async apply(app, state, decorators) {
      decorators.set("i18nInstance", instance);
      if (this.config.setup) {
        await this.config.setup(app);
      }
    },
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create translation function for a specific locale
 */
export function createTranslator(
  translations: Translations,
  locale: string,
  fallbackLocale?: string,
): TranslateFunction {
  const i18nInstance = new I18n({
    defaultLocale: locale,
    locales: Object.keys(translations),
    translations,
    fallbackLocale,
  });

  return (key, params, count) =>
    i18nInstance.translate(locale, key, params, count);
}

/**
 * Load translations from JSON files (for lazy loading)
 */
export async function loadTranslations(
  locales: string[],
  loader: (locale: string) => Promise<Translation>,
): Promise<Translations> {
  const translations: Translations = {};

  await Promise.all(
    locales.map(async (locale) => {
      translations[locale] = await loader(locale);
    }),
  );

  return translations;
}

/**
 * Merge translations (for extending base translations)
 */
export function mergeTranslations(
  base: Translations,
  override: Translations,
): Translations {
  const result: Translations = { ...base };

  for (const locale of Object.keys(override)) {
    result[locale] = deepMerge(result[locale] ?? {}, override[locale]);
  }

  return result;
}

function deepMerge(target: Translation, source: Translation): Translation {
  const result: Translation = { ...target };

  for (const key of Object.keys(source)) {
    const sourceValue = source[key];
    const targetValue = result[key];

    if (
      typeof sourceValue === "object" &&
      typeof targetValue === "object" &&
      !("one" in sourceValue) &&
      !("other" in sourceValue)
    ) {
      result[key] = deepMerge(
        targetValue as Translation,
        sourceValue as Translation,
      );
    } else {
      result[key] = sourceValue;
    }
  }

  return result;
}

/**
 * Get browser locale (for client-side)
 */
export function getBrowserLocale(
  supportedLocales: string[],
  defaultLocale: string,
): string {
  if (typeof navigator === "undefined") {
    return defaultLocale;
  }

  const browserLocales = navigator.languages ?? [navigator.language];

  for (const browserLocale of browserLocales) {
    // Try exact match
    if (supportedLocales.includes(browserLocale)) {
      return browserLocale;
    }
    // Try language code only
    const lang = browserLocale.split("-")[0];
    if (supportedLocales.includes(lang)) {
      return lang;
    }
    // Try finding a locale that starts with the language
    const match = supportedLocales.find((l) => l.startsWith(lang + "-"));
    if (match) {
      return match;
    }
  }

  return defaultLocale;
}

// ============================================================================
// Presets
// ============================================================================

/**
 * Common date format presets
 */
export const dateFormats = {
  short: { dateStyle: "short" } as Intl.DateTimeFormatOptions,
  medium: { dateStyle: "medium" } as Intl.DateTimeFormatOptions,
  long: { dateStyle: "long" } as Intl.DateTimeFormatOptions,
  full: { dateStyle: "full" } as Intl.DateTimeFormatOptions,
  time: { timeStyle: "short" } as Intl.DateTimeFormatOptions,
  datetime: {
    dateStyle: "medium",
    timeStyle: "short",
  } as Intl.DateTimeFormatOptions,
};

/**
 * Common number format presets
 */
export const numberFormats = {
  decimal: { style: "decimal" } as Intl.NumberFormatOptions,
  percent: { style: "percent" } as Intl.NumberFormatOptions,
  compact: { notation: "compact" } as Intl.NumberFormatOptions,
  scientific: { notation: "scientific" } as Intl.NumberFormatOptions,
};
