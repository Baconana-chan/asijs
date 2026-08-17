/**
 * SSR collection — the core differentiator of MiyoCSS.
 *
 * Collects utility classes from a JSX tree **before** rendering, generates the
 * exact CSS that was actually used, and injects a `<style>` tag into the
 * document `<head>`.
 *
 * Two collection modes:
 * - `"auto"` (default) — a synchronous tree-walk gathers `className` from every
 *   element. Synchronous components are expanded; **async components are not**
 *   (their body isn't known until render) — that's the documented escape hatch,
 *   see `collectClass` in the roadmap.
 * - `false` — no tree-walk; emit the full static utility catalog for the config
 *   (useful for non-JSX templates or hand-written HTML).
 *
 * The style tag is injected **after** rendering (string or stream), because
 * AsiJS's `renderToString` HTML-escapes children and would corrupt CSS inside a
 * `<style>` element (e.g. `>` in media queries becomes `&gt;`). For streams we
 * buffer only up to `</head>`, then splice the style in — no full-body buffering.
 *
 * @example
 * ```tsx
 * import { render } from "miyocss";
 *
 * const html = await render(
 *   <html>
 *     <head><title>Hi</title></head>
 *     <body><div className="flex p-4 hover:bg-blue-500">Hi</div></body>
 *   </html>,
 *   resolveDefaultConfig(),
 * );
 * // <head>...<style data-miyocss>...</style></head>
 * ```
 */

import { generateCSS } from "./variants";
import { staticUtilityNames } from "./generator";
import type { ResolvedConfig } from "./config";

// ===== Types =====

/** Minimal JSX element shape (compatible with AsiJS `JSXElement`). */
export interface MiyoElement {
  type: string | ((props: Record<string, unknown>) => unknown);
  props: Record<string, unknown> & {
    children?: unknown;
    className?: unknown;
    class?: unknown;
  };
  key?: string | number;
}

/** Renderer abstraction — lets the core work with any SSR engine. */
export interface SsrRenderer {
  renderToString(element: unknown): Promise<string>;
  renderToStream(element: unknown): ReadableStream<Uint8Array>;
}

/** Options for `render` / `stream`. */
export interface SsrOptions {
  /** Class collection mode. `"auto"` (default) walks the tree; `false` uses the static catalog. */
  collect?: "auto" | false;
  /** Attribute on the injected `<style>` tag (default: `data-miyocss`). */
  styleAttr?: string;
  /** Minified output (default: true). */
  minify?: boolean;
}

/** The full static utility catalog for a config (all static + all token-driven classes). */
export function generateFullCSS(config: ResolvedConfig, options: { minify?: boolean } = {}): string {
  const t = config.theme;
  const spacing = Object.keys(t.spacing);
  const colors = Object.keys(t.colors);
  const classes: string[] = [];

  // static utilities (display, position, alignment, ...)
  classes.push(...staticUtilityNames());

  // colors × (text/bg/border)
  for (const c of colors) {
    classes.push(`text-${c}`, `bg-${c}`, `border-${c}`);
  }

  // spacing-driven families
  const pSides = ["p", "px", "py", "pt", "pr", "pb", "pl"];
  const mSides = ["m", "mx", "my", "mt", "mr", "mb", "ml"];
  const gapSides = ["gap", "gap-x", "gap-y"];
  const insetSides = ["inset", "inset-x", "inset-y", "top", "right", "bottom", "left"];
  for (const s of spacing) {
    for (const p of pSides) classes.push(`${p}-${s}`);
    for (const m of mSides) classes.push(`${m}-${s}`);
    for (const g of gapSides) classes.push(`${g}-${s}`);
    for (const i of insetSides) classes.push(`${i}-${s}`);
    // negatives
    for (const m of mSides) classes.push(`-${m}-${s}`);
    for (const i of insetSides) classes.push(`-${i}-${s}`);
    classes.push(`w-${s}`, `h-${s}`);
    classes.push(`min-w-${s}`, `min-h-${s}`, `max-w-${s}`, `max-h-${s}`);
  }

  // token maps
  for (const k of Object.keys(t.fontSize)) classes.push(`text-${k}`);
  for (const k of Object.keys(t.fontWeight)) classes.push(`font-${k}`);
  for (const k of Object.keys(t.fontFamily)) classes.push(`font-${k}`);
  for (const k of Object.keys(t.lineHeight)) classes.push(`leading-${k}`);
  for (const k of Object.keys(t.letterSpacing)) classes.push(`tracking-${k}`);
  for (const k of Object.keys(t.borderRadius)) classes.push(`rounded-${k}`);
  classes.push("rounded");
  for (const k of Object.keys(t.boxShadow)) classes.push(`shadow-${k}`);
  classes.push("shadow");
  for (const k of Object.keys(t.opacity)) classes.push(`opacity-${k}`);
  for (const k of Object.keys(t.zIndex)) classes.push(`z-${k}`);

  // grid + fractions
  for (let n = 1; n <= 12; n++) {
    classes.push(`grid-cols-${n}`, `grid-rows-${n}`, `col-span-${n}`, `row-span-${n}`);
  }
  classes.push("col-span-full", "row-span-full");
  for (let den = 2; den <= 12; den++) {
    for (let num = 1; num < den; num++) classes.push(`w-${num}/${den}`);
  }

  return generateCSS(classes, config, { unknown: "skip" }).replace(/\n\s*/g, "\n");
}

// ===== Tree walk =====

const MAX_DEPTH = 64;

/**
 * Collect every utility class name found in a JSX tree.
 *
 * Walks elements, fragments and arrays. `className` / `class` props are split
 * on whitespace. Component functions are called **synchronously** and their
 * result walked; async components (functions that return a Promise) are
 * skipped — their classes must be collected via the escape hatch (roadmap P2).
 */
export function collectClasses(element: unknown, out?: Set<string>): Set<string> {
  const set = out ?? new Set<string>();
  walk(element, set, 0);
  return set;
}

function walk(node: unknown, out: Set<string>, depth: number): void {
  if (depth > MAX_DEPTH || node === null || node === undefined) return;

  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
    return;
  }

  if (Array.isArray(node)) {
    for (const child of node) walk(child, out, depth + 1);
    return;
  }

  if (typeof node !== "object") return;

  const element = node as MiyoElement;
  const { type, props } = element;

  if (typeof type === "function") {
    // Component function — try to expand synchronously.
    let result: unknown;
    try {
      result = type(props as Record<string, unknown>);
    } catch {
      return; // component threw during walk — render will surface the real error
    }
    if (result && typeof (result as Promise<unknown>).then === "function") {
      return; // async component — body unknown before render (documented limitation)
    }
    walk(result, out, depth + 1);
    return;
  }

  // HTML element (or fragment with empty type)
  const className = props?.className ?? props?.class;
  if (typeof className === "string") {
    for (const token of className.split(/\s+/)) {
      if (token) out.add(token);
    }
  } else if (Array.isArray(className)) {
    for (const token of className) {
      if (typeof token === "string" && token) {
        for (const t of token.split(/\s+/)) if (t) out.add(t);
      }
    }
  }

  const children = props?.children;
  if (children !== undefined) walk(children, out, depth + 1);
}

// ===== Style injection =====

/** Build a `<style>` tag with the given CSS. */
export function styleTag(css: string, attr = "data-miyocss"): string {
  const attrs = attr ? ` ${attr}` : "";
  return `<style${attrs}>${css}</style>`;
}

/** Insert a `<style>` tag before `</head>`, or at the start if no head found. */
export function injectStyleIntoHtml(
  html: string,
  css: string,
  attr = "data-miyocss",
): string {
  const tag = styleTag(css, attr);
  const headClose = html.indexOf("</head>");
  if (headClose !== -1) {
    return html.slice(0, headClose) + tag + html.slice(headClose);
  }
  const headOpen = html.indexOf("<head");
  if (headOpen !== -1) {
    const openEnd = html.indexOf(">", headOpen) + 1;
    return html.slice(0, openEnd) + tag + html.slice(openEnd);
  }
  return tag + html;
}

// ===== Render =====

function cssFor(
  element: unknown,
  config: ResolvedConfig,
  options: SsrOptions,
): string {
  const minify = options.minify ?? true;
  const css =
    options.collect === false
      ? generateFullCSS(config, { minify })
      : generateCSS(collectClasses(element), config);
  return minify ? css.replace(/\n\s*/g, "\n") : css;
}

/**
 * Render a JSX element to an HTML string, collecting used utilities and
 * injecting the resulting `<style>` into `<head>`.
 *
 * @param renderer Optional — defaults to a lazy `asijs` import. Pass a custom
 *   one to use MiyoCSS with Hono, Fastify, plain Node, etc.
 */
export async function render(
  element: unknown,
  config: ResolvedConfig,
  options: SsrOptions = {},
  renderer?: SsrRenderer,
): Promise<string> {
  const [css, r] = await Promise.all([
    Promise.resolve(cssFor(element, config, options)),
    resolveRenderer(renderer),
  ]);
  const html = await r.renderToString(element);
  return injectStyleIntoHtml(html, css, options.styleAttr);
}

/**
 * Render a JSX element to a streaming HTML response, collecting used utilities
 * and injecting `<style>` into `<head>`.
 *
 * Buffers only up to `</head>` (small), then splices the style and streams the
 * rest untouched — no full-body buffering, minimal TTFB cost.
 *
 * @param renderer Optional — defaults to a lazy `asijs` import (see `render`).
 */
export function stream(
  element: unknown,
  config: ResolvedConfig,
  options: SsrOptions = {},
  renderer?: SsrRenderer,
): ReadableStream<Uint8Array> {
  const css = cssFor(element, config, options);
  const attr = options.styleAttr ?? "data-miyocss";
  const tag = styleTag(css, attr);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  // Buffers up to and including `</head>`, then emits: buffer-with-head → style → rest.
  let buffered = "";
  let headDone = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const r = await resolveRenderer(renderer);
      const src = r.renderToStream(element);
      const reader = src.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!headDone) {
            buffered += decoder.decode(value, { stream: true });
            const headClose = buffered.indexOf("</head>");
            if (headClose !== -1) {
              headDone = true;
              const headPart = buffered.slice(0, headClose);
              const rest = buffered.slice(headClose);
              controller.enqueue(encoder.encode(headPart));
              controller.enqueue(encoder.encode(tag));
              controller.enqueue(encoder.encode(rest));
              buffered = "";
              continue;
            }
            // Guard: if head is huge, flush it to avoid unbounded memory
            if (buffered.length > 65_536) {
              headDone = true;
              controller.enqueue(encoder.encode(buffered));
              controller.enqueue(encoder.encode(tag));
              buffered = "";
            }
            continue;
          }
          controller.enqueue(value);
        }
        if (!headDone) {
          // No </head> seen (or head was flushed early) — emit style before the tail.
          controller.enqueue(encoder.encode(tag));
        }
        if (buffered.length > 0) {
          controller.enqueue(encoder.encode(buffered));
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

// ===== Lazy default renderer (asijs) =====

let cachedRenderer: SsrRenderer | null = null;

/** Lazily import AsiJS once; throws if unavailable. */
async function resolveRenderer(renderer?: SsrRenderer): Promise<SsrRenderer> {
  if (renderer) return renderer;
  if (cachedRenderer) return cachedRenderer;
  try {
    const mod = await import("asijs");
    const r: SsrRenderer = {
      renderToString: mod.renderToString as (e: unknown) => Promise<string>,
      renderToStream: mod.renderToStream as (e: unknown) => ReadableStream<Uint8Array>,
    };
    cachedRenderer = r;
    return r;
  } catch {
    throw new Error(
      'miyocss: no SSR renderer available. Install "asijs" or pass a custom renderer ({ renderToString, renderToStream }).',
    );
  }
}
