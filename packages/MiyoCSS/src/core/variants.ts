/**
 * miyocss core — variants (MiyoCSS TODO 0.4).
 *
 * `hover:`, `focus:`, `active:` (pseudo-classes), `sm:`…`2xl:` (breakpoints
 * from theme tokens) and `dark:` (media or class strategy from options).
 * Variants compose: `hover:md:bg-red-500` becomes
 * `@media (min-width: 768px) { .hover\:md\:bg-red-500:hover { … } }`.
 *
 * `generateCSS` routes through `generateRule`, so unknown variants and
 * unknown bases are skipped consistently (or thrown with `unknown: "throw"`).
 *
 * Known limitation: a ":" inside an arbitrary value (e.g. `bg-[url(a:b)]`)
 * would be misparsed — arbitrary values containing colons are rare.
 */

import {
  generateUtility,
  renderRule,
  type GenerateOptions,
  type VariantRule,
} from "./generator";
import type { ResolvedConfig } from "./config";

/** Pseudo-class/structural variants → CSS suffix. */
export const PSEUDO_VARIANTS: Record<string, string> = {
  hover: ":hover",
  focus: ":focus",
  "focus-visible": ":focus-visible",
  "focus-within": ":focus-within",
  active: ":active",
  visited: ":visited",
  disabled: ":disabled",
  checked: ":checked",
  required: ":required",
  "read-only": ":read-only",
  placeholder: "::placeholder",
  first: ":first-child",
  last: ":last-child",
  odd: ":nth-child(odd)",
  even: ":nth-child(even)",
  "first-of-type": ":first-of-type",
  "last-of-type": ":last-of-type",
  empty: ":empty",
  target: ":target",
  valid: ":valid",
  invalid: ":invalid",
  optional: ":optional",
  "in-range": ":in-range",
  "out-of-range": ":out-of-range",
};

const DARK_MEDIA = "prefers-color-scheme: dark";

/**
 * Split a class name into variant prefixes and the base utility.
 * Returns null for plain classes (no ":") — use generateUtility directly.
 */
export function parseVariants(className: string): {
  base: string;
  variants: string[];
} | null {
  const parts = className.split(":");
  if (parts.length === 1) return null;
  const base = parts[parts.length - 1];
  if (base === "") return null;
  return { base, variants: parts.slice(0, -1) };
}

/** Apply one variant to a rule. Returns false if the variant is unknown. */
function applyVariant(
  rule: VariantRule,
  name: string,
  config: ResolvedConfig,
): boolean {
  if (name === "dark") {
    if (config.options.darkMode === "class") {
      rule.selectorPrefix = ".dark " + (rule.selectorPrefix ?? "");
    } else {
      rule.media = rule.media ? `${rule.media} and ${DARK_MEDIA}` : DARK_MEDIA;
    }
    return true;
  }

  const pseudo = PSEUDO_VARIANTS[name];
  if (pseudo !== undefined) {
    rule.selectorSuffix = (rule.selectorSuffix ?? "") + pseudo;
    return true;
  }

  const breakpoint = config.theme.breakpoints[name];
  if (breakpoint !== undefined) {
    const media = `min-width: ${breakpoint}`;
    rule.media = rule.media ? `${rule.media} and ${media}` : media;
    return true;
  }

  return false;
}

/**
 * Resolve a class name (with optional variants) into a rule.
 * Plain classes fall through to `generateUtility`.
 */
export function generateRule(
  className: string,
  config: ResolvedConfig,
): VariantRule | null {
  const parsed = parseVariants(className);
  if (!parsed) {
    const base = generateUtility(className, config);
    if (!base) return null;
    return { className, declarations: base.declarations };
  }

  const baseResult = generateUtility(parsed.base, config);
  if (!baseResult) return null;

  const rule: VariantRule = {
    className,
    declarations: baseResult.declarations,
  };
  for (const variant of parsed.variants) {
    if (!applyVariant(rule, variant, config)) return null;
  }
  return rule;
}

// ===== Ordering =====

/** Cascade-aware sort key: base → pseudo → media (ascending min-width). */
function ruleKey(rule: VariantRule): [number, number, number, string] {
  const media = rule.media ?? "";
  return [
    media ? 1 : 0,
    mediaWidth(media),
    rule.selectorSuffix ? 1 : 0,
    rule.className,
  ];
}

function mediaWidth(media: string): number {
  if (!media) return 0;
  const match = media.match(/min-width:\s*([\d.]+)px/);
  return match ? Number(match[1]) : 0;
}

/**
 * Generate CSS text for a set of classes (deduped).
 *
 * Ordering follows the cascade: base utilities first, then pseudo
 * variants, then media-query variants sorted by ascending breakpoint —
 * so `md:p-4` always overrides `p-4`, and `hover:*` overrides `*`.
 */
export function generateCSS(
  classes: Iterable<string>,
  config: ResolvedConfig,
  options: GenerateOptions = {},
): string {
  const unique = [...new Set(classes)];
  const results: VariantRule[] = [];
  for (const name of unique) {
    const result = generateRule(name, config);
    if (!result) {
      if (options.unknown === "throw") {
        throw new Error(`miyocss: unknown utility "${name}"`);
      }
      continue;
    }
    results.push(result);
  }
  results.sort((a, b) => {
    const ka = ruleKey(a);
    const kb = ruleKey(b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
    }
    return 0;
  });
  return results.map((r) => renderRule(r)).join("\n");
}
