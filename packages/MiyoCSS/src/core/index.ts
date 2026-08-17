/**
 * miyocss core — framework-agnostic engine.
 *
 * No framework imports here by design: the core only knows how to turn
 * tokens + utility class names into CSS. SSR collection hooks and adapters
 * live in `src/asi` (and, later, adapters for Hono/Elysia/Fastify/plain Node).
 *
 * Status (see TODO.md):
 *  - 0.2 ✅ — Design tokens + TypeBox-validated `defineConfig()`
 *  - 0.3 — Utility generator (~150 base utilities + arbitrary values)
 *  - 0.4 — Variants (`hover:`, `focus:`, `active:`, `md:`, `dark:`)
 *  - 0.5 — SSR collection: collect used classes during render,
 *          inject <style> into <head>, zero build step
 */

export const VERSION = "0.1.0";

export {
  defineConfig,
  resolveConfig,
  resolveDefaultConfig,
  deepMerge,
  flattenColors,
  defineUtility,
} from "./config";

export type {
  ColorValue,
  TokenMap,
  MiyoTheme,
  MiyoExtend,
  MiyoOptions,
  NormalizedOptions,
  MiyoConfig,
  FullTheme,
  ResolvedConfig,
  CustomUtility,
  CustomUtilityMatcher,
} from "./config";

export { defaultTheme, defaultOptions } from "./defaults";

export {
  generateUtility,
  renderRule,
  escapeSelector,
  staticUtilityNames,
} from "./generator";

export type { UtilityResult, VariantRule, GenerateOptions } from "./generator";

export {
  generateRule,
  generateCSS,
  parseVariants,
  PSEUDO_VARIANTS,
  PSEUDO_ELEMENTS,
  GROUPABLE_PSEUDOS,
} from "./variants";

export {
  collectClasses,
  generateFullCSS,
  injectStyleIntoHtml,
  render,
  stream,
  styleTag,
} from "./ssr";

export type { MiyoElement, SsrOptions, SsrRenderer } from "./ssr";

export {
  PurgeCache,
  hashCss,
  collectClassesFromHtml,
  purgeToFile,
  purgeDirectory,
  findHtmlFiles,
} from "./purge";

export type { PurgeResult, PurgeToFileOptions, PurgeDirectoryOptions } from "./purge";
