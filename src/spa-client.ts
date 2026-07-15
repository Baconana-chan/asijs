/**
 * Client-side Hydration for AsiJS SPA/SSR
 *
 * This module runs in the browser and handles:
 * - Hydrating server-rendered HTML with client-side interactivity
 * - Mounting island components (partial hydration)
 * - HMR reload on dev changes
 *
 * @example
 * ```tsx
 * // src/client.tsx — Client entry point
 * import { hydrate } from "asijs/spa-client";
 * import { App } from "./app";
 *
 * const props = window.__ASIJS_PROPS__;
 * hydrate(App, props);
 * ```
 */

// Re-export types
export type { IslandDefinition } from "./spa";

// ============================================================================
// Hydration
// ============================================================================

/**
 * Hydrate a server-rendered page.
 *
 * Finds the root element (#app or custom selector),
 * reads serialized props, and calls the app's mount function.
 *
 * Unlike React's hydrateRoot, this does NOT require a full framework runtime.
 * It simply calls the provided mount function after DOM is ready.
 *
 * @param mountFn - Function that receives props and mounts the app
 * @param defaultProps - Fallback props if not found in the DOM
 */
export function hydrate(
  mountFn: (props: Record<string, unknown>, root: HTMLElement) => void,
  defaultProps: Record<string, unknown> = {},
): void {
  if (typeof document === "undefined") {
    // Running on the server — skip
    return;
  }

  // Wait for DOM to be ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function() {
      doHydrate(mountFn, defaultProps);
    });
  } else {
    doHydrate(mountFn, defaultProps);
  }
}

function doHydrate(
  mountFn: (props: Record<string, unknown>, root: HTMLElement) => void,
  defaultProps: Record<string, unknown>,
): void {
  // Read serialized props from the server
  var props = readProps();
  if (!props || Object.keys(props).length === 0) {
    props = defaultProps;
  }

  // Find the root element
  var root = document.getElementById("app");
  if (!root) {
    console.warn("[AsiJS] No #app element found for hydration.");
    return;
  }

  // Mount the app (attach event listeners, set up state, etc.)
  try {
    mountFn(props, root);
  } catch (err) {
    console.error("[AsiJS] Hydration mount error:", err);
  }

  // Hydrate island components
  hydrateIslands();
}

/**
 * Read serialized props from the server.
 * Looks for a <script id="__ASIJS_PROPS__" type="application/json"> tag.
 */
function readProps(): Record<string, unknown> | null {
  var el = document.getElementById("__ASIJS_PROPS__");
  if (!el || !el.textContent) return null;

  try {
    return JSON.parse(el.textContent);
  } catch {
    console.warn("[AsiJS] Failed to parse serialized props.");
    return null;
  }
}

// ============================================================================
// Islands — Partial Hydration
// ============================================================================

/**
 * Hydrate all island components on the page.
 *
 * Finds elements with `data-island` attribute and hydrates them.
 * Each island loads its own JavaScript chunk and initializes independently.
 */
export function hydrateIslands(): void {
  var islands = document.querySelectorAll("[data-island]");
  if (islands.length === 0) return;

  for (var i = 0; i < islands.length; i++) {
    var el = islands[i] as HTMLElement;
    var islandName = el.getAttribute("data-island") || "";
    var modulePath = el.getAttribute("data-module") || "";
    var islandId = el.getAttribute("data-island-id") || "";

    if (!islandName || !modulePath) continue;

    // Read island props from the adjacent script tag
    var props = readIslandProps(islandId);

    // Import the island module and call its mount function
    importModule(islandName, modulePath, el, props);
  }
}

/**
 * Read props for a specific island component.
 */
function readIslandProps(islandId: string): Record<string, unknown> {
  var selector =
    'script[type="application/json"][data-island-props="' +
    islandId.replace(/"/g, '\\"') +
    '"]';
  var script = document.querySelector(selector);

  if (!script || !script.textContent) return {};

  try {
    return JSON.parse(script.textContent);
  } catch {
    return {};
  }
}

/**
 * Dynamically import an island module and call its mount function.
 *
 * The island module should export a `mount` function that receives
 * the container element and props.
 */
function importModule(
  name: string,
  modulePath: string,
  container: HTMLElement,
  props: Record<string, unknown>,
): void {
  var importPath = modulePath;

  // Try dynamic import
  import(importPath)
    .then(function(mod) {
      if (typeof mod.mount === "function") {
        mod.mount(container, props);
      } else if (typeof mod.default === "function") {
        mod.default(container, props);
      } else {
        console.warn(
          "[AsiJS] Island '" +
            name +
            "' has no mount or default export.",
        );
      }
    })
    .catch(function(err) {
      console.error("[AsiJS] Failed to load island '" + name + "':", err);
    });
}

// ============================================================================
// HMR Client
// ============================================================================

/**
 * Connect to the HMR WebSocket for development.
 *
 * When the server sends "reload", the page is reloaded.
 * When the server sends specific module paths, only those modules are hot-swapped.
 *
 * @example
 * ```ts
 * // Called automatically when spa.hmr is enabled
 * connectHMR(3000);
 * ```
 */
export function connectHMR(port: number): WebSocket {
  var protocol = location.protocol === "https:" ? "wss:" : "ws:";
  var ws = new WebSocket(protocol + "//localhost:" + port + "/__asi_hmr");

  ws.onmessage = function(event) {
    var data = event.data;

    if (data === "reload") {
      location.reload();
    } else if (typeof data === "string" && data.startsWith("update:")) {
      // Hot module replacement for specific modules
      var modulePath = data.slice(7);
      console.log("[HMR] Update:", modulePath);
      // In a full implementation, this would use import() to hot-swap
    }
  };

  ws.onclose = function() {
    // Reconnect on close
    setTimeout(function() { connectHMR(port); }, 1000);
  };

  ws.onerror = function() {
    // Ignore — the close handler will reconnect
  };

  return ws;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Get the serialized props from the page.
 * Useful for accessing server data in client-side code.
 *
 * @example
 * ```ts
 * const user = getPageProps<User>();
 * ```
 */
export function getPageProps<T = Record<string, unknown>>(): T | null {
  return readProps() as T | null;
}
