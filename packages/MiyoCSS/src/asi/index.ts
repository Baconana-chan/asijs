/**
 * miyocss/asi — AsiJS adapter.
 *
 * Wrapper approach (architectural decision №1, see TODO.md): instead of
 * hooking AsiJS internals, we expose our own `render()` / `stream()`
 * wrappers that tree-walk the JSX tree to collect utility classes BEFORE
 * rendering, then call the plain AsiJS `renderToString` / `renderToStream`.
 * The generated `<style>` is injected directly into the `<head>` element
 * of the tree — no AsiJS core changes, works for string and stream alike.
 *
 * Planned (see TODO.md P0.6):
 *  - `app.use(asiPlugin({ tokens, darkMode, collect }))`
 *  - `render(element, options)` / `stream(element, options)` wrappers
 *  - `html()` wrapper: render + auto-inject styles
 *  - `<StyleSheet />` helper for manual control
 */

import type { AsiPlugin } from "asijs";

export interface AsiPluginOptions {
  /** Design tokens — defined in P0.2 (`defineConfig`). */
  config?: Record<string, unknown>;
  /** Class collection strategy. "auto" (default) collects at render time. */
  collect?: "auto" | "none";
}

/**
 * AsiJS adapter plugin.
 *
 * @throws Not implemented — planned in MiyoCSS P0.6.
 */
export function asiPlugin(_options: AsiPluginOptions = {}): AsiPlugin {
  throw new Error(
    "miyocss/asi: not implemented yet — planned in MiyoCSS P0.6",
  );
}
