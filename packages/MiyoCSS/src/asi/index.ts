/**
 * miyocss/asi — AsiJS adapter (P0.6).
 *
 * Three layers:
 *
 * 1. **`asiPlugin({ config, collect })`** — an AsiJS plugin. `app.plugin(asiPlugin(...))`
 *    registers the resolved config in app state (`app.getState("miyocss")`) and on
 *    every request decorates the context with `ctx.miyocss` (resolved config) and
 *    `ctx.styles()` (manual style-tag helper). `miyocss` is a friendly alias.
 *
 * 2. **`html(element, options)`** — render + collect + auto-inject. The main DX:
 *    return `html(<Page />)` from a handler and the exact `<style>` lands in
 *    `<head>`. Only classes actually rendered end up in the CSS (0.5 engine —
 *    synchronous tree-walk before render, zero build step, zero false positives).
 *
 * 3. **`<StyleSheet />`** — optional in-tree placeholder. Put it where you want
 *    the style tag to land (e.g. inside `<head>` or `<body>`); `html()`/`stream()`
 *    replace it with the real CSS. Without it, styles are injected into `<head>`.
 *
 * @example
 * ```tsx
 * import { Asi } from "asijs";
 * import { asiPlugin, html, StyleSheet } from "miyocss/asi";
 *
 * const app = new Asi();
 * app.plugin(asiPlugin({ config: { extend: { theme: { colors: { brand: "#0af" } } } } }));
 *
 * app.get("/", () =>
 *   html(
 *     <html>
 *       <head>
 *         <title>Home</title>
 *         <StyleSheet />
 *       </head>
 *       <body>
 *         <div className="flex p-4 bg-brand hover:bg-blue-500">Hello</div>
 *       </body>
 *     </html>,
 *   ),
 * );
 * ```
 *
 * Manual control without JSX rendering:
 * ```tsx
 * app.get("/plain", (ctx) => {
 *   // ctx.styles() — full static catalog for the config
 *   // ctx.styles(["flex", "p-4"]) — CSS for exactly these classes (variants OK)
 *   return `<!doctype html><html><head>${ctx.styles(["flex"])}</head><body class="flex">…</body></html>`;
 * });
 * ```
 */

import { createPlugin, renderToString, renderToStream, jsx } from "asijs";
import type { AsiPlugin, Context } from "asijs";
import {
  collectClasses,
  generateCSS,
  generateFullCSS,
  styleTag,
  injectStyleIntoHtml,
  resolveConfig,
  resolveDefaultConfig,
  purgeDirectory,
  stream as coreStream,
} from "../core";
import type {
  ResolvedConfig,
  MiyoConfig,
  PurgeResult,
  PurgeDirectoryOptions,
} from "../core";

// ============================================================================
// <StyleSheet /> placeholder
// ============================================================================

/** Class name the placeholder `<style>` renders with (matched post-render). */
export const STYLE_SHEET_CLASS = "miyocss-sheet";

const PLACEHOLDER_HTML = `<style class="${STYLE_SHEET_CLASS}"></style>`;
const PLACEHOLDER_RE = /<style class="miyocss-sheet"><\/style>/g;

/**
 * Optional in-tree placeholder: `html()`/`stream()` replace it with the real
 * `<style data-miyocss>` tag containing the collected CSS. Use it to control
 * exactly where the style tag lands; without it styles go into `<head>`.
 */
export function StyleSheet(): ReturnType<typeof jsx> {
  return jsx("style", { class: STYLE_SHEET_CLASS });
}

/** Whether the tree contains a `<StyleSheet />` component. */
function hasStyleSheet(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(hasStyleSheet);
  if (node && typeof node === "object") {
    const el = node as { type?: unknown; props?: { children?: unknown } };
    if (typeof el.type === "function" && el.type === StyleSheet) return true;
    const children = el.props?.children;
    if (children !== undefined) return hasStyleSheet(children);
  }
  return false;
}

// ============================================================================
// Config resolution
// ============================================================================

/** Options accepted by `html`, `stream` and `asiPlugin`. */
export interface MiyoCssOptions {
  /** Design tokens / theme (0.2 `defineConfig` shape). Defaults to built-in tokens. */
  config?: MiyoConfig;
  /** Class collection: `"auto"` (default) collects at render time; `false` emits the full static catalog. */
  collect?: "auto" | false;
  /** Attribute on the injected `<style>` tag (default: `data-miyocss`). */
  styleAttr?: string;
  /** Minified CSS output (default: true). */
  minify?: boolean;
}

/** `HtmlOptions` — `MiyoCssOptions` without the collect flag (html has its own). */
export type HtmlOptions = MiyoCssOptions;

function resolveAdapterConfig(config?: MiyoConfig): ResolvedConfig {
  return config ? resolveConfig(config) : resolveDefaultConfig();
}

function cssFor(
  element: unknown,
  config: ResolvedConfig,
  options: HtmlOptions,
): string {
  const minify = options.minify ?? true;
  const css =
    options.collect === false
      ? generateFullCSS(config, { minify })
      : generateCSS(collectClasses(element), config);
  return minify ? css.replace(/\n\s*/g, "\n") : css;
}

// ============================================================================
// AsiJS plugin
// ============================================================================

/**
 * AsiJS plugin — registers the MiyoCSS config and per-request context helpers.
 *
 * - `app.getState("miyocss")` → `{ config, collect, styleAttr, minify }`
 * - `ctx.miyocss` → resolved `ResolvedConfig`
 * - `ctx.styles(classes?)` → `<style>` tag: exact CSS for `classes`, or the
 *   full static catalog when called without arguments
 *
 * @example
 * ```ts
 * app.plugin(asiPlugin({ config: myConfig }));
 * // or, friendlier:
 * app.plugin(miyocss({ config: myConfig }));
 * ```
 */
export function asiPlugin(options: MiyoCssOptions = {}): AsiPlugin {
  const config = resolveAdapterConfig(options.config);
  const styleAttr = options.styleAttr ?? "data-miyocss";
  const minify = options.minify ?? true;

  const styles = (classes?: Iterable<string>): string => {
    const css = classes ? generateCSS(classes, config) : generateFullCSS(config);
    const out = minify ? css.replace(/\n\s*/g, "\n") : css;
    return styleTag(out, styleAttr);
  };

  return createPlugin({
    name: "miyocss",
    state: {
      miyocss: {
        config,
        collect: options.collect ?? "auto",
        styleAttr,
        minify,
      },
    },
    // App-level access (via app.getDecorator("miyocss") / app.getDecorator("styles")).
    decorate: { miyocss: config, styles },
    setup(app) {
      // Context access — AsiJS decorators are app-level, so ctx helpers are
      // injected per request through a middleware (same pattern as the i18n plugin).
      app.use((ctx, next) => {
        const c = ctx as Context & {
          miyocss?: ResolvedConfig;
          styles?: typeof styles;
        };
        c.miyocss = config;
        c.styles = styles;
        return next();
      });
    },
  });
}

/**
 * Friendly alias so the plugin reads naturally:
 * `app.use(miyocss({ config }))`.
 */
export const miyocss = asiPlugin;

// ============================================================================
// html() / stream() — render + collect + inject
// ============================================================================

/**
 * Render a JSX element to an HTML string with MiyoCSS styles.
 *
 * Collects the utility classes from the tree **before** rendering, generates the
 * exact CSS and injects a `<style>` tag — into `<head>`, or at the position of a
 * `<StyleSheet />` placeholder when one is present in the tree.
 *
 * @example
 * ```tsx
 * app.get("/", () =>
 *   html(
 *     <html>
 *       <head><title>Products</title></head>
 *       <body>
 *         <div className="grid gap-4 md:grid-cols-2">…</div>
 *       </body>
 *     </html>,
 *   ),
 * );
 * ```
 */
export async function html(
  element: unknown,
  options: HtmlOptions = {},
): Promise<string> {
  const config = resolveAdapterConfig(options.config);
  const css = cssFor(element, config, options);
  // Element is framework-agnostic (`unknown`) here; asijs's renderToString is
  // typed against its own JSXNode — the cast is safe, the tree-walk already
  // validated the shape.
  const rendered = await renderToString(element as never);
  if (hasStyleSheet(element)) {
    return rendered.replace(PLACEHOLDER_RE, styleTag(css, options.styleAttr));
  }
  return injectStyleIntoHtml(rendered, css, options.styleAttr);
}

/**
 * Render a JSX element to a streaming HTML response with MiyoCSS styles.
 *
 * Buffers only until the `<StyleSheet />` placeholder is seen (or `<head>`
 * closes) — the style tag is spliced in and the rest streams untouched, so the
 * TTFB cost is negligible. Without a placeholder, behaves like the core
 * `stream()` (injects into `<head>`, buffers only up to `</head>`).
 */
// ============================================================================
// purgeSsg — one CSS file for an `asi build --ssg` output (TODO 1.2)
// ============================================================================

/** Options for `purgeSsg` — same as the core `purgeDirectory` minus `config`. */
export type PurgeSsgOptions = Omit<PurgeDirectoryOptions, "config"> & {
  /** MiyoCSS config (0.2 `defineConfig` shape) — default: built-in tokens. */
  config?: MiyoConfig;
};

/**
 * Post-process an `asi build --ssg` output directory into one hashed CSS file.
 *
 * Walks every HTML file, collects the utility classes that were actually
 * rendered, writes `miyocss.<hash>.css` and — with `rewrite: true` (default) —
 * replaces the inline `<style data-miyocss>` tags with a single `<link>`, so
 * the whole static site shares one immutable, CDN-cacheable stylesheet.
 *
 * @example
 * ```ts
 * // after: asi build --ssg
 * const { href, classes, files } = purgeSsg({ dir: "dist", config: myConfig });
 * ```
 */
export function purgeSsg(options: PurgeSsgOptions): PurgeResult {
  const config = options.config ? resolveConfig(options.config) : undefined;
  return purgeDirectory({
    ...options,
    config,
    rewrite: options.rewrite ?? true,
  });
}

export function stream(
  element: unknown,
  options: HtmlOptions = {},
): ReadableStream<Uint8Array> {
  const config = resolveAdapterConfig(options.config);
  const css = cssFor(element, config, options);
  const tag = styleTag(css, options.styleAttr);

  if (!hasStyleSheet(element)) {
    return coreStream(
      element,
      config,
      {
        collect: options.collect ?? "auto",
        styleAttr: options.styleAttr,
        minify: options.minify,
      },
      { renderToString, renderToStream },
    );
  }

  // StyleSheet present: buffer until the placeholder appears, splice the style
  // tag in place, then stream everything else untouched.
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffered = "";
  let replaced = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = renderToStream(element as never).getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!replaced) {
            buffered += decoder.decode(value, { stream: true });
            const idx = buffered.indexOf(PLACEHOLDER_HTML);
            if (idx !== -1) {
              replaced = true;
              controller.enqueue(
                encoder.encode(
                  buffered.slice(0, idx) + tag + buffered.slice(idx + PLACEHOLDER_HTML.length),
                ),
              );
              buffered = "";
              continue;
            }
            // Placeholder not seen yet — guard against unbounded memory. If it
            // lives inside an async component (invisible to the pre-render
            // walk), fall back to head injection, best effort.
            if (buffered.length > 262_144) {
              replaced = true;
              controller.enqueue(
                encoder.encode(injectStyleIntoHtml(buffered, css, options.styleAttr)),
              );
              buffered = "";
              continue;
            }
            continue;
          }
          controller.enqueue(value);
        }
        if (buffered.length) {
          controller.enqueue(encoder.encode(replaced ? buffered : buffered + tag));
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}
