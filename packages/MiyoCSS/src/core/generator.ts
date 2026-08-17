/**
 * miyocss core — utility generator (MiyoCSS TODO 0.3).
 *
 * Turns a class name into CSS declarations using the resolved config.
 * Framework-agnostic: no framework imports — 0.5's SSR collector and the
 * adapters will call `generateCSS` / `generateUtility`.
 *
 * Scope (0.3): layout, flex/grid, spacing (p/m/gap, negative), typography,
 * colors (text/bg/border, slash opacity), borders/effects, sizing, grid
 * template + arbitrary values (`w-[17px]`, `bg-[#f00]`, `grid-cols-[200px_1fr]`).
 *
 * Variants (`hover:`, `md:`) are a 0.4 concern: `generateUtility` receives a
 * plain class; the variant layer will strip prefixes and wrap the result.
 */

import type { ResolvedConfig, TokenMap } from "./config";

// ===== Result types =====

export interface UtilityResult {
  /** The class name as written. */
  className: string;
  /** CSS declarations, insertion-ordered. */
  declarations: Record<string, string>;
}

/**
 * A generated rule — base utility plus optional variant wrapping
 * (0.4). Selector = `selectorPrefix + "." + escape(className) + selectorSuffix`,
 * wrapped in `@media (media)` when present.
 */
export interface VariantRule extends UtilityResult {
  /** e.g. ".dark " for class-mode dark variant. */
  selectorPrefix?: string;
  /** e.g. ":hover" for pseudo-class variants. */
  selectorSuffix?: string;
  /** media query conditions joined with " and ", e.g. "min-width: 768px". */
  media?: string;
}

export interface GenerateOptions {
  /** What to do with classes that match no utility. Default "skip". */
  unknown?: "skip" | "throw";
}

// ===== Selector escaping =====

/**
 * Escape a class name for use in a CSS selector.
 * Handles leading digits (`1/2` → `\31 \/2`) and special chars (`:` → `\:`).
 */
export function escapeSelector(name: string): string {
  const rest = name.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
  if (/^\d/.test(rest)) {
    return `\\3${rest[0]} ${rest.slice(1)}`;
  }
  return rest;
}

// ===== Rendering =====

/** Render one rule, honoring variant wrapping (media / prefix / suffix). */
export function renderRule(result: VariantRule): string {
  const selector = `.${escapeSelector(result.className)}`;
  const full =
    (result.selectorPrefix ?? "") + selector + (result.selectorSuffix ?? "");
  const decls = Object.entries(result.declarations)
    .map(([key, value]) => `  ${key}: ${value};`)
    .join("\n");
  const inner = `${full} {\n${decls}\n}`;
  return result.media ? `@media (${result.media}) {\n${inner}\n}` : inner;
}

/** Names of all static utilities (display, position, alignment, ...). */
export function staticUtilityNames(): string[] {
  return Object.keys(STATIC_UTILITIES);
}

// ===== Arbitrary values =====

const ARBITRARY_RE = /^(.*)-\[(.+)\]$/;

/** Strip dangerous CSS from an arbitrary value; `_` becomes a space. */
function sanitizeArbitrary(value: string): string | null {
  if (/[;{}!<>]/.test(value)) return null;
  const cleaned = value.replace(/_/g, " ").trim();
  return cleaned.length > 0 ? cleaned : null;
}

const COLOR_PREFIX_RE =
  /^(#|rgb\(|rgba\(|hsl\(|hsla\(|hwb\(|lab\(|lch\(|oklab\(|oklch\(|color\(|var\(|transparent$|currentcolor$|inherit$)/i;

const NAMED_COLORS = new Set([
  "black", "white", "red", "green", "blue", "yellow", "orange", "purple",
  "gray", "grey", "silver", "gold", "pink", "brown", "cyan", "magenta",
  "teal", "navy", "olive", "lime", "maroon", "violet", "indigo", "coral",
  "salmon", "tan", "beige", "azure", "ivory", "khaki", "plum", "tomato",
  "turquoise",
]);

function isColorValue(value: string): boolean {
  const v = value.trim();
  return COLOR_PREFIX_RE.test(v) || NAMED_COLORS.has(v.toLowerCase());
}

/** Opacity token value (`"0.5"`, `"1"`) or arbitrary `[0.33]` → percent. */
function opacityToPercent(opacity: string): string | null {
  const n = Number(opacity);
  if (!Number.isFinite(n)) return null;
  const pct = Math.round(n * 100 * 100) / 100;
  return `${pct}%`;
}

/** Resolve `color` + slash opacity (`red-500/50`) via color-mix. */
function withOpacity(
  color: string,
  opacityKey: string,
  config: ResolvedConfig,
): string | null {
  let fraction: string | null = null;
  const arb = opacityKey.match(/^\[(.+)\]$/);
  if (arb) {
    fraction = sanitizeArbitrary(arb[1]);
  } else {
    const token = config.theme.opacity[opacityKey];
    fraction = token === undefined ? null : String(token);
  }
  if (fraction === null) return null;
  const percent = opacityToPercent(fraction);
  if (percent === null) return null;
  return `color-mix(in srgb, ${color} ${percent}, transparent)`;
}

/** Try arbitrary-value generation for `base-[value]`. */
function arbitraryDeclarations(
  base: string,
  raw: string,
  config: ResolvedConfig,
): Record<string, string> | null {
  const value = sanitizeArbitrary(raw);
  if (value === null) return null;

  const negate = (v: string): string =>
    /^0/.test(v) ? v : `-${v}`;

  switch (base) {
    case "w":
      return { width: value };
    case "h":
      return { height: value };
    case "min-w":
      return { "min-width": value };
    case "min-h":
      return { "min-height": value };
    case "max-w":
      return { "max-width": value };
    case "max-h":
      return { "max-height": value };
    case "p":
    case "px":
    case "py":
    case "pt":
    case "pr":
    case "pb":
    case "pl":
      return spacingDecls(base, value);
    case "m":
    case "mx":
    case "my":
    case "mt":
    case "mr":
    case "mb":
    case "ml":
      return spacingDecls(base, value);
    case "gap":
      return { gap: value };
    case "gap-x":
      return { "column-gap": value };
    case "gap-y":
      return { "row-gap": value };
    case "inset":
      return { inset: value };
    case "inset-x":
      return { left: value, right: value };
    case "inset-y":
      return { top: value, bottom: value };
    case "top":
      return { top: value };
    case "right":
      return { right: value };
    case "bottom":
      return { bottom: value };
    case "left":
      return { left: value };
    case "text":
      return isColorValue(value)
        ? { color: value }
        : { "font-size": value };
    case "bg":
      return { "background-color": value };
    case "border":
      return isColorValue(value)
        ? { "border-color": value }
        : { "border-width": value };
    case "rounded":
      return { "border-radius": value };
    case "rounded-t":
      return { "border-top-left-radius": value, "border-top-right-radius": value };
    case "rounded-r":
      return { "border-top-right-radius": value, "border-bottom-right-radius": value };
    case "rounded-b":
      return { "border-bottom-left-radius": value, "border-bottom-right-radius": value };
    case "rounded-l":
      return { "border-top-left-radius": value, "border-bottom-left-radius": value };
    case "rounded-tl":
      return { "border-top-left-radius": value };
    case "rounded-tr":
      return { "border-top-right-radius": value };
    case "rounded-br":
      return { "border-bottom-right-radius": value };
    case "rounded-bl":
      return { "border-bottom-left-radius": value };
    case "shadow":
      return { "box-shadow": value };
    case "z":
      return /^\d+$/.test(value) ? { "z-index": value } : null;
    case "opacity":
      return Number.isFinite(Number(value)) ? { opacity: value } : null;
    case "leading":
      return { "line-height": value };
    case "tracking":
      return { "letter-spacing": value };
    case "font":
      return /^\d+$/.test(value) ? { "font-weight": value } : null;
    case "grid-cols":
      return { "grid-template-columns": value };
    case "grid-rows":
      return { "grid-template-rows": value };
    case "col-span":
      return { "grid-column": `span ${value} / span ${value}` };
    case "row-span":
      return { "grid-row": `span ${value} / span ${value}` };
    case "neg-m":
      return spacingDecls("m", negate(value));
    default:
      return null;
  }
}

// ===== Spacing / side helpers =====

const SIDE_MAP: Record<string, string> = {
  t: "top",
  r: "right",
  b: "bottom",
  l: "left",
};

/** `p-4` / `px-4` / `pt-4` etc. → padding/margin declarations. */
function spacingDecls(
  prefix: string,
  value: string,
): Record<string, string> | null {
  const prop = prefix[0] === "p" ? "padding" : "margin";
  const rest = prefix.slice(1);
  if (rest === "") return { [prop]: value };
  if (rest === "x") return { [`${prop}-left`]: value, [`${prop}-right`]: value };
  if (rest === "y") return { [`${prop}-top`]: value, [`${prop}-bottom`]: value };
  const side = SIDE_MAP[rest];
  if (!side) return null;
  return { [`${prop}-${side}`]: value };
}

// ===== Static utilities =====

const STATIC_UTILITIES: Record<string, Record<string, string>> = {
  // display
  block: { display: "block" },
  "inline-block": { display: "inline-block" },
  inline: { display: "inline" },
  flex: { display: "flex" },
  "inline-flex": { display: "inline-flex" },
  grid: { display: "grid" },
  "inline-grid": { display: "inline-grid" },
  contents: { display: "contents" },
  hidden: { display: "none" },
  "flow-root": { display: "flow-root" },
  table: { display: "table" },
  "inline-table": { display: "inline-table" },
  "table-row": { display: "table-row" },
  "table-cell": { display: "table-cell" },
  "list-item": { display: "list-item" },
  // position
  static: { position: "static" },
  fixed: { position: "fixed" },
  absolute: { position: "absolute" },
  relative: { position: "relative" },
  sticky: { position: "sticky" },
  // overflow
  "overflow-auto": { overflow: "auto" },
  "overflow-hidden": { overflow: "hidden" },
  "overflow-visible": { overflow: "visible" },
  "overflow-scroll": { overflow: "scroll" },
  "overflow-clip": { overflow: "clip" },
  "overflow-x-auto": { "overflow-x": "auto" },
  "overflow-x-hidden": { "overflow-x": "hidden" },
  "overflow-x-visible": { "overflow-x": "visible" },
  "overflow-x-scroll": { "overflow-x": "scroll" },
  "overflow-x-clip": { "overflow-x": "clip" },
  "overflow-y-auto": { "overflow-y": "auto" },
  "overflow-y-hidden": { "overflow-y": "hidden" },
  "overflow-y-visible": { "overflow-y": "visible" },
  "overflow-y-scroll": { "overflow-y": "scroll" },
  "overflow-y-clip": { "overflow-y": "clip" },
  // box sizing
  "box-border": { "box-sizing": "border-box" },
  "box-content": { "box-sizing": "content-box" },
  // visibility
  visible: { visibility: "visible" },
  invisible: { visibility: "hidden" },
  collapse: { visibility: "collapse" },
  // float
  "float-start": { float: "inline-start" },
  "float-end": { float: "inline-end" },
  "float-right": { float: "right" },
  "float-left": { float: "left" },
  "float-none": { float: "none" },
  // flex container
  "flex-row": { "flex-direction": "row" },
  "flex-row-reverse": { "flex-direction": "row-reverse" },
  "flex-col": { "flex-direction": "column" },
  "flex-col-reverse": { "flex-direction": "column-reverse" },
  "flex-wrap": { "flex-wrap": "wrap" },
  "flex-wrap-reverse": { "flex-wrap": "wrap-reverse" },
  "flex-nowrap": { "flex-wrap": "nowrap" },
  // flex item
  "flex-1": { flex: "1 1 0%" },
  "flex-auto": { flex: "1 1 auto" },
  "flex-initial": { flex: "0 1 auto" },
  "flex-none": { flex: "none" },
  grow: { "flex-grow": "1" },
  "grow-0": { "flex-grow": "0" },
  shrink: { "flex-shrink": "1" },
  "shrink-0": { "flex-shrink": "0" },
  // alignment
  "items-start": { "align-items": "flex-start" },
  "items-end": { "align-items": "flex-end" },
  "items-center": { "align-items": "center" },
  "items-baseline": { "align-items": "baseline" },
  "items-stretch": { "align-items": "stretch" },
  "justify-start": { "justify-content": "flex-start" },
  "justify-end": { "justify-content": "flex-end" },
  "justify-center": { "justify-content": "center" },
  "justify-between": { "justify-content": "space-between" },
  "justify-around": { "justify-content": "space-around" },
  "justify-evenly": { "justify-content": "space-evenly" },
  "content-center": { "align-content": "center" },
  "content-start": { "align-content": "flex-start" },
  "content-end": { "align-content": "flex-end" },
  "content-between": { "align-content": "space-between" },
  "content-around": { "align-content": "space-around" },
  "content-evenly": { "align-content": "space-evenly" },
  "content-stretch": { "align-content": "stretch" },
  "self-auto": { "align-self": "auto" },
  "self-start": { "align-self": "flex-start" },
  "self-end": { "align-self": "flex-end" },
  "self-center": { "align-self": "center" },
  "self-stretch": { "align-self": "stretch" },
  "self-baseline": { "align-self": "baseline" },
  "justify-items-start": { "justify-items": "start" },
  "justify-items-end": { "justify-items": "end" },
  "justify-items-center": { "justify-items": "center" },
  "justify-items-stretch": { "justify-items": "stretch" },
  "justify-self-auto": { "justify-self": "auto" },
  "justify-self-start": { "justify-self": "start" },
  "justify-self-end": { "justify-self": "end" },
  "justify-self-center": { "justify-self": "center" },
  "justify-self-stretch": { "justify-self": "stretch" },
  // text align / wrap / transform / vertical align
  "text-left": { "text-align": "left" },
  "text-center": { "text-align": "center" },
  "text-right": { "text-align": "right" },
  "text-justify": { "text-align": "justify" },
  "text-start": { "text-align": "start" },
  "text-end": { "text-align": "end" },
  "whitespace-normal": { "white-space": "normal" },
  "whitespace-nowrap": { "white-space": "nowrap" },
  "whitespace-pre": { "white-space": "pre" },
  "whitespace-pre-line": { "white-space": "pre-line" },
  "whitespace-pre-wrap": { "white-space": "pre-wrap" },
  "whitespace-break-spaces": { "white-space": "break-spaces" },
  "text-wrap": { "text-wrap": "wrap" },
  "text-nowrap": { "text-wrap": "nowrap" },
  "text-balance": { "text-wrap": "balance" },
  "text-pretty": { "text-wrap": "pretty" },
  truncate: { overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" },
  "text-ellipsis": { "text-overflow": "ellipsis" },
  "text-clip": { "text-overflow": "clip" },
  italic: { "font-style": "italic" },
  "not-italic": { "font-style": "normal" },
  uppercase: { "text-transform": "uppercase" },
  lowercase: { "text-transform": "lowercase" },
  capitalize: { "text-transform": "capitalize" },
  "normal-case": { "text-transform": "none" },
  "align-baseline": { "vertical-align": "baseline" },
  "align-top": { "vertical-align": "top" },
  "align-middle": { "vertical-align": "middle" },
  "align-bottom": { "vertical-align": "bottom" },
  "align-text-top": { "vertical-align": "text-top" },
  "align-text-bottom": { "vertical-align": "text-bottom" },
  // a11y
  "sr-only": {
    position: "absolute",
    width: "1px",
    height: "1px",
    padding: "0",
    margin: "-1px",
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    "white-space": "nowrap",
    "border-width": "0",
  },
  "not-sr-only": {
    position: "static",
    width: "auto",
    height: "auto",
    padding: "0",
    margin: "0",
    overflow: "visible",
    clip: "auto",
    "white-space": "normal",
  },
};

// ===== Token lookups =====

function negateLength(value: string): string {
  return /^0/.test(value) ? value : `-${value}`;
}

/** Sizing specials shared by w/h. */
const SIZE_SPECIALS: Record<string, string> = {
  full: "100%",
  screen: "100vh",
  svh: "100svh",
  lvh: "100lvh",
  dvh: "100dvh",
  min: "min-content",
  max: "max-content",
  fit: "fit-content",
  auto: "auto",
};

function fractionPercent(match: RegExpMatchArray): string | null {
  const num = Number(match[1]);
  const den = Number(match[2]);
  if (
    !Number.isInteger(num) ||
    !Number.isInteger(den) ||
    den < 2 ||
    den > 12 ||
    num >= den
  ) {
    return null;
  }
  // percent = (num / den) * 100, rounded to 4 decimals
  return `${Math.round((num / den) * 100 * 10000) / 10000}%`;
}

// ===== generateUtility =====

/**
 * Resolve a single utility class into CSS declarations, or null if unknown.
 */
export function generateUtility(
  className: string,
  config: ResolvedConfig,
): UtilityResult | null {
  if (className === "") return null;

  // 1. Arbitrary values: any `base-[value]` form.
  const arb = className.match(ARBITRARY_RE);
  if (arb && arb[1] !== "") {
    const base = arb[1];
    const declarations = arbitraryDeclarations(base, arb[2], config);
    if (declarations) return { className, declarations };
    return null;
  }

  // 2. Static utilities.
  if (className in STATIC_UTILITIES) {
    return { className, declarations: { ...STATIC_UTILITIES[className] } };
  }

  const theme = config.theme;
  const decls = (d: Record<string, string>) => ({ className, declarations: d });

  // 3. Spacing: p/m with sides, plus negative.
  const negSpacing = className.match(/^-([pm])(x|y|t|r|b|l)?-(.+)$/);
  if (negSpacing) {
    const value = theme.spacing[negSpacing[3]];
    if (value !== undefined) {
      const d = spacingDecls(negSpacing[1] + (negSpacing[2] ?? ""), negateLength(String(value)));
      if (d) return decls(d);
    }
    return null;
  }
  const spacing = className.match(/^([pm])(x|y|t|r|b|l)?-(.+)$/);
  if (spacing) {
    const key = spacing[3];
    const value = key === "auto" && spacing[1] === "m"
      ? "auto"
      : theme.spacing[key];
    if (value !== undefined) {
      const d = spacingDecls(spacing[1] + (spacing[2] ?? ""), String(value));
      if (d) return decls(d);
    }
    return null;
  }

  // 4. Gap.
  const gap = className.match(/^gap(?:-([xy]))?-(.+)$/);
  if (gap) {
    const value = theme.spacing[gap[2]];
    if (value !== undefined) {
      const side = gap[1];
      if (side === "x") return decls({ "column-gap": String(value) });
      if (side === "y") return decls({ "row-gap": String(value) });
      return decls({ gap: String(value) });
    }
    return null;
  }

  // 5. Inset / top / right / bottom / left (incl. negative).
  const negInset = className.match(/^-(inset-x|inset-y|inset|top|right|bottom|left)-(.+)$/);
  if (negInset) {
    const value = theme.spacing[negInset[2]];
    if (value !== undefined) {
      return decls(insetDecls(negInset[1], negateLength(String(value))));
    }
    return null;
  }
  const inset = className.match(/^(inset-x|inset-y|inset|top|right|bottom|left)-(.+)$/);
  if (inset) {
    const key = inset[2];
    const value = key === "auto" ? "auto" : theme.spacing[key];
    if (value !== undefined) {
      return decls(insetDecls(inset[1], String(value)));
    }
    return null;
  }

  // 6. Sizing: w/h/min/max + fractions + specials.
  const size = className.match(/^(w|h)-(.+)$/);
  if (size) {
    const prop = size[1] === "w" ? "width" : "height";
    const key = size[2];
    const frac = key.match(/^(\d+)\/(\d+)$/);
    if (frac) {
      const pct = fractionPercent(frac);
      if (pct) return decls({ [prop]: pct });
      return null;
    }
    if (key in SIZE_SPECIALS) return decls({ [prop]: SIZE_SPECIALS[key] });
    const value = theme.spacing[key];
    if (value !== undefined) return decls({ [prop]: String(value) });
    return null;
  }
  const minMax = className.match(/^(min-w|min-h|max-w|max-h)-(.+)$/);
  if (minMax) {
    const [prefix, key] = [minMax[1], minMax[2]];
    const prop = {
      "min-w": "min-width",
      "min-h": "min-height",
      "max-w": "max-width",
      "max-h": "max-height",
    }[prefix] as string;
    const extraSpecials: Record<string, string> =
      prefix === "max-w" || prefix === "max-h"
        ? { none: "none", ...SIZE_SPECIALS }
        : { ...SIZE_SPECIALS, auto: "auto" };
    if (key in extraSpecials) return decls({ [prop]: extraSpecials[key] });
    const value = theme.spacing[key];
    if (value !== undefined) return decls({ [prop]: String(value) });
    return null;
  }

  // 7. z-index.
  const z = className.match(/^z-(.+)$/);
  if (z) {
    const value = theme.zIndex[z[1]];
    if (value !== undefined) return decls({ "z-index": String(value) });
    return null;
  }

  // 8. Fonts: family first, then weight.
  const font = className.match(/^font-(.+)$/);
  if (font) {
    const family = theme.fontFamily[font[1]];
    if (family !== undefined) return decls({ "font-family": family });
    const weight = theme.fontWeight[font[1]];
    if (weight !== undefined) return decls({ "font-weight": String(weight) });
    return null;
  }

  // 9. Leading / tracking.
  const leading = className.match(/^leading-(.+)$/);
  if (leading) {
    const value = theme.lineHeight[leading[1]];
    if (value !== undefined) return decls({ "line-height": String(value) });
    return null;
  }
  const tracking = className.match(/^tracking-(.+)$/);
  if (tracking) {
    const value = theme.letterSpacing[tracking[1]];
    if (value !== undefined) return decls({ "letter-spacing": String(value) });
    return null;
  }

  // 10. text-*: font size token → color (with slash opacity).
  const text = className.match(/^text-(.+?)(?:\/(.+))?$/);
  if (text) {
    const key = text[1];
    const size = theme.fontSize[key];
    if (size !== undefined && text[2] === undefined) {
      return decls({ "font-size": String(size) });
    }
    const color = theme.colors[key];
    if (color !== undefined) {
      if (text[2] !== undefined) {
        const mixed = withOpacity(color, text[2], config);
        if (mixed === null) return null;
        return decls({ color: mixed });
      }
      return decls({ color });
    }
    return null;
  }

  // 11. bg-*.
  const bg = className.match(/^bg-(.+?)(?:\/(.+))?$/);
  if (bg) {
    const color = theme.colors[bg[1]];
    if (color !== undefined) {
      if (bg[2] !== undefined) {
        const mixed = withOpacity(color, bg[2], config);
        if (mixed === null) return null;
        return decls({ "background-color": mixed });
      }
      return decls({ "background-color": color });
    }
    return null;
  }

  // 12. Rounded.
  const roundedBare = className.match(/^rounded$/);
  if (roundedBare) {
    const value = theme.borderRadius.DEFAULT;
    if (value !== undefined) return decls({ "border-radius": String(value) });
    return null;
  }
  const rounded = className.match(/^rounded(?:-(t|r|b|l|tl|tr|bl|br))?(?:-(.+))?$/);
  if (rounded) {
    const side = rounded[1];
    const key = rounded[2] ?? "DEFAULT";
    const value = theme.borderRadius[key];
    if (value !== undefined) {
      const radius = String(value);
      if (!side) return decls({ "border-radius": radius });
      const props = RADIUS_SIDES[side];
      return decls(Object.fromEntries(props.map((p) => [p, radius])));
    }
    return null;
  }

  // 13. Border: widths, sides, style, color (+ slash opacity).
  if (className === "border") return decls({ "border-width": "1px" });
  const borderSideBare = className.match(/^border-(x|y)$/);
  if (borderSideBare) {
    const side = borderSideBare[1];
    return decls(
      side === "x"
        ? { "border-left-width": "1px", "border-right-width": "1px" }
        : { "border-top-width": "1px", "border-bottom-width": "1px" },
    );
  }
  const borderSideBareOne = className.match(/^border-(t|r|b|l)$/);
  if (borderSideBareOne) {
    return decls({ [`border-${SIDE_MAP[borderSideBareOne[1]]}-width`]: "1px" });
  }
  const borderWidth = className.match(/^border-([0-9]+)$/);
  if (borderWidth) {
    return decls({ "border-width": `${borderWidth[1]}px` });
  }
  const borderSideWidth = className.match(/^border-(x|y|t|r|b|l)-([0-9]+)$/);
  if (borderSideWidth) {
    const [side, width] = [borderSideWidth[1], borderSideWidth[2]];
    if (side === "x") {
      return decls({
        "border-left-width": `${width}px`,
        "border-right-width": `${width}px`,
      });
    }
    if (side === "y") {
      return decls({
        "border-top-width": `${width}px`,
        "border-bottom-width": `${width}px`,
      });
    }
    return decls({ [`border-${SIDE_MAP[side]}-width`]: `${width}px` });
  }
  const borderRest = className.match(/^border-(.+?)(?:\/(.+))?$/);
  if (borderRest) {
    const key = borderRest[1];
    const style = BORDER_STYLES[key];
    if (style !== undefined && borderRest[2] === undefined) {
      return decls({ "border-style": style });
    }
    const color = theme.colors[key];
    if (color !== undefined) {
      if (borderRest[2] !== undefined) {
        const mixed = withOpacity(color, borderRest[2], config);
        if (mixed === null) return null;
        return decls({ "border-color": mixed });
      }
      return decls({ "border-color": color });
    }
    return null;
  }

  // 14. Shadow.
  if (className === "shadow") {
    const value = theme.boxShadow.DEFAULT;
    if (value !== undefined) return decls({ "box-shadow": value });
    return null;
  }
  const shadow = className.match(/^shadow-(.+)$/);
  if (shadow) {
    const value = theme.boxShadow[shadow[1]];
    if (value !== undefined) return decls({ "box-shadow": value });
    return null;
  }

  // 15. Opacity.
  const opacity = className.match(/^opacity-(.+)$/);
  if (opacity) {
    const value = theme.opacity[opacity[1]];
    if (value !== undefined) return decls({ opacity: String(value) });
    return null;
  }

  // 16. Grid: cols/rows + spans.
  const gridCols = className.match(/^grid-cols-(.+)$/);
  if (gridCols) {
    const n = gridCols[1];
    if (n === "none") return decls({ "grid-template-columns": "none" });
    if (/^\d+$/.test(n) && Number(n) >= 1 && Number(n) <= 12) {
      return decls({ "grid-template-columns": `repeat(${n}, minmax(0, 1fr))` });
    }
    return null;
  }
  const gridRows = className.match(/^grid-rows-(.+)$/);
  if (gridRows) {
    const n = gridRows[1];
    if (n === "none") return decls({ "grid-template-rows": "none" });
    if (/^\d+$/.test(n) && Number(n) >= 1 && Number(n) <= 12) {
      return decls({ "grid-template-rows": `repeat(${n}, minmax(0, 1fr))` });
    }
    return null;
  }
  const colSpan = className.match(/^col-span-(.+)$/);
  if (colSpan) {
    if (colSpan[1] === "full") return decls({ "grid-column": "1 / -1" });
    if (/^\d+$/.test(colSpan[1]) && Number(colSpan[1]) >= 1 && Number(colSpan[1]) <= 12) {
      return decls({ "grid-column": `span ${colSpan[1]} / span ${colSpan[1]}` });
    }
    return null;
  }
  const rowSpan = className.match(/^row-span-(.+)$/);
  if (rowSpan) {
    if (rowSpan[1] === "full") return decls({ "grid-row": "1 / -1" });
    if (/^\d+$/.test(rowSpan[1]) && Number(rowSpan[1]) >= 1 && Number(rowSpan[1]) <= 12) {
      return decls({ "grid-row": `span ${rowSpan[1]} / span ${rowSpan[1]}` });
    }
    return null;
  }

  return null;
}

// ===== Helpers =====

const RADIUS_SIDES: Record<string, string[]> = {
  t: ["border-top-left-radius", "border-top-right-radius"],
  r: ["border-top-right-radius", "border-bottom-right-radius"],
  b: ["border-bottom-left-radius", "border-bottom-right-radius"],
  l: ["border-top-left-radius", "border-bottom-left-radius"],
  tl: ["border-top-left-radius"],
  tr: ["border-top-right-radius"],
  br: ["border-bottom-right-radius"],
  bl: ["border-bottom-left-radius"],
};

const BORDER_STYLES: Record<string, string> = {
  solid: "solid",
  dashed: "dashed",
  dotted: "dotted",
  double: "double",
  none: "none",
  hidden: "hidden",
};

function insetDecls(prefix: string, value: string): Record<string, string> {
  switch (prefix) {
    case "inset":
      return { inset: value };
    case "inset-x":
      return { left: value, right: value };
    case "inset-y":
      return { top: value, bottom: value };
    default:
      return { [prefix]: value };
  }
}

// Re-export TokenMap for convenience of generator consumers.
export type { TokenMap };
