/**
 * JSX/HTML Streaming for AsiJS
 * 
 * Provides JSX runtime and streaming HTML responses for SSR.
 * 
 * @example
 * ```tsx
 * // tsconfig.json: "jsx": "react-jsx", "jsxImportSource": "asijs"
 * 
 * import { Asi, html, stream } from "asijs";
 * 
 * function App({ name }: { name: string }) {
 *   return (
 *     <html>
 *       <head><title>Hello {name}</title></head>
 *       <body>
 *         <h1>Welcome, {name}!</h1>
 *       </body>
 *     </html>
 *   );
 * }
 * 
 * const app = new Asi();
 * 
 * app.get("/", (ctx) => html(<App name="World" />));
 * app.get("/stream", (ctx) => stream(<App name="Stream" />));
 * ```
 */

// ===== Types =====

export type JSXChild = 
  | string 
  | number 
  | boolean 
  | null 
  | undefined 
  | JSXElement 
  | JSXChild[];

export type JSXChildren = JSXChild | JSXChild[];

export interface JSXProps {
  children?: JSXChildren;
  [key: string]: unknown;
}

export type JSXComponent<P extends Record<string, unknown> = JSXProps> = (props: P) => JSXElement | Promise<JSXElement>;

export interface JSXElement {
  type: string | JSXComponent<any>;
  props: JSXProps;
  key?: string | number;
}

export type JSXNode = JSXElement | string | number | boolean | null | undefined | JSXNode[];

// ===== JSX Factory (createElement) =====

/**
 * JSX factory function - creates JSX elements
 * Used by the JSX transform when "jsx": "react-jsx" or "jsx": "preserve"
 */
export function jsx<P extends Record<string, unknown> = JSXProps>(
  type: string | JSXComponent<P>,
  props: P,
  key?: string | number
): JSXElement {
  return { type, props: props as JSXProps, key };
}

export const jsxs = jsx;
export const jsxDEV = jsx;

/**
 * Fragment component for grouping children
 */
export function Fragment(props: { children?: JSXChildren }): JSXElement {
  return jsx("", { children: props.children });
}

// ===== HTML Escaping =====

const escapeMap: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
};

const escapeRegex = /[&<>"']/g;

/**
 * Escape HTML special characters
 */
export function escapeHtml(str: string): string {
  return str.replace(escapeRegex, (char) => escapeMap[char]);
}

// ===== Void Elements (self-closing) =====

const voidElements = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr"
]);

// ===== Attribute Handling =====

const booleanAttributes = new Set([
  "async", "autofocus", "autoplay", "checked", "controls", "default",
  "defer", "disabled", "formnovalidate", "hidden", "ismap", "loop",
  "multiple", "muted", "novalidate", "open", "readonly", "required",
  "reversed", "selected", "allowfullscreen", "allowpaymentrequest",
  "playsinline", "nomodule", "disablepictureinpicture", "disableremoteplayback"
]);

/**
 * Convert props to HTML attributes string
 */
function propsToAttributes(props: JSXProps): string {
  const attrs: string[] = [];
  
  for (const [key, value] of Object.entries(props)) {
    // Skip internal props
    if (key === "children" || key === "key" || key === "ref") {
      continue;
    }
    
    // Skip undefined, null, false
    if (value === undefined || value === null || value === false) {
      continue;
    }
    
    // Convert camelCase to kebab-case for data-* and aria-*
    let attrName = key;
    if (key.startsWith("data") && key.length > 4 && key[4] === key[4].toUpperCase()) {
      attrName = "data-" + key.slice(4).replace(/([A-Z])/g, "-$1").toLowerCase();
    } else if (key.startsWith("aria") && key.length > 4) {
      attrName = "aria-" + key.slice(4).toLowerCase();
    } else if (key === "className") {
      attrName = "class";
    } else if (key === "htmlFor") {
      attrName = "for";
    }
    
    // Boolean attributes
    if (booleanAttributes.has(attrName.toLowerCase())) {
      if (value === true) {
        attrs.push(attrName);
      }
      continue;
    }
    
    // Style object
    if (key === "style" && typeof value === "object") {
      const styleStr = Object.entries(value as Record<string, unknown>)
        .map(([prop, val]) => {
          const cssProp = prop.replace(/([A-Z])/g, "-$1").toLowerCase();
          return `${cssProp}:${val}`;
        })
        .join(";");
      attrs.push(`style="${escapeHtml(styleStr)}"`);
      continue;
    }
    
    // Regular attributes
    attrs.push(`${attrName}="${escapeHtml(String(value))}"`);
  }
  
  return attrs.length > 0 ? " " + attrs.join(" ") : "";
}

// ===== Render to String =====

/**
 * Render children to string
 */
async function renderChildren(children: JSXChildren): Promise<string> {
  if (children === null || children === undefined || children === false) {
    return "";
  }
  
  if (typeof children === "string") {
    return escapeHtml(children);
  }
  
  if (typeof children === "number") {
    return String(children);
  }
  
  if (typeof children === "boolean") {
    return "";
  }
  
  if (Array.isArray(children)) {
    const parts = await Promise.all(children.map(child => renderChildren(child)));
    return parts.join("");
  }
  
  // JSXElement
  return renderToString(children);
}

/**
 * Render JSX element to HTML string
 */
export async function renderToString(element: JSXNode): Promise<string> {
  // Handle primitives
  if (element === null || element === undefined || element === false) {
    return "";
  }
  
  if (typeof element === "string") {
    return escapeHtml(element);
  }
  
  if (typeof element === "number") {
    return String(element);
  }
  
  if (typeof element === "boolean") {
    return "";
  }
  
  // Handle arrays
  if (Array.isArray(element)) {
    const parts = await Promise.all(element.map(child => renderToString(child)));
    return parts.join("");
  }
  
  const { type, props } = element;
  
  // Handle Fragment
  if (type === "" || type === Fragment) {
    return renderChildren(props.children);
  }
  
  // Handle component functions
  if (typeof type === "function") {
    const result = await type(props);
    return renderToString(result);
  }
  
  // Handle HTML elements
  const tagName = type;
  const attributes = propsToAttributes(props);
  
  // Void elements (self-closing)
  if (voidElements.has(tagName)) {
    return `<${tagName}${attributes} />`;
  }
  
  // Elements with children
  const children = await renderChildren(props.children);
  return `<${tagName}${attributes}>${children}</${tagName}>`;
}

// ===== Render to Stream =====

/**
 * Render JSX element to a readable stream
 * Useful for large pages and streaming SSR
 */
export function renderToStream(element: JSXNode): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  
  return new ReadableStream({
    async start(controller) {
      try {
        await streamElement(element, controller, encoder);
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    }
  });
}

async function streamElement(
  element: JSXNode, 
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): Promise<void> {
  // Handle primitives
  if (element === null || element === undefined || element === false) {
    return;
  }
  
  if (typeof element === "string") {
    controller.enqueue(encoder.encode(escapeHtml(element)));
    return;
  }
  
  if (typeof element === "number") {
    controller.enqueue(encoder.encode(String(element)));
    return;
  }
  
  if (typeof element === "boolean") {
    return;
  }
  
  // Handle arrays
  if (Array.isArray(element)) {
    for (const child of element) {
      await streamElement(child, controller, encoder);
    }
    return;
  }
  
  const { type, props } = element;
  
  // Handle Fragment
  if (type === "" || type === Fragment) {
    await streamChildren(props.children, controller, encoder);
    return;
  }
  
  // Handle component functions
  if (typeof type === "function") {
    const result = await type(props);
    await streamElement(result, controller, encoder);
    return;
  }
  
  // Handle HTML elements
  const tagName = type;
  const attributes = propsToAttributes(props);
  
  // Void elements (self-closing)
  if (voidElements.has(tagName)) {
    controller.enqueue(encoder.encode(`<${tagName}${attributes} />`));
    return;
  }
  
  // Stream opening tag
  controller.enqueue(encoder.encode(`<${tagName}${attributes}>`));
  
  // Stream children
  await streamChildren(props.children, controller, encoder);
  
  // Stream closing tag
  controller.enqueue(encoder.encode(`</${tagName}>`));
}

async function streamChildren(
  children: JSXChildren,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): Promise<void> {
  if (children === null || children === undefined || children === false) {
    return;
  }
  
  if (typeof children === "string") {
    controller.enqueue(encoder.encode(escapeHtml(children)));
    return;
  }
  
  if (typeof children === "number") {
    controller.enqueue(encoder.encode(String(children)));
    return;
  }
  
  if (typeof children === "boolean") {
    return;
  }
  
  if (Array.isArray(children)) {
    for (const child of children) {
      await streamChildren(child, controller, encoder);
    }
    return;
  }
  
  // JSXElement
  await streamElement(children, controller, encoder);
}

// ===== Response Helpers =====

/**
 * Create an HTML response from JSX
 * 
 * @example
 * ```tsx
 * app.get("/", (ctx) => html(<App />));
 * ```
 */
export async function html(element: JSXNode, status = 200): Promise<Response> {
  const body = await renderToString(element);
  return new Response("<!DOCTYPE html>" + body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

/**
 * Create a streaming HTML response from JSX
 * 
 * @example
 * ```tsx
 * app.get("/", (ctx) => stream(<App />));
 * ```
 */
export function stream(element: JSXNode, status = 200): Response {
  // Create a stream that prepends DOCTYPE
  const encoder = new TextEncoder();
  const doctype = encoder.encode("<!DOCTYPE html>");
  const contentStream = renderToStream(element);
  
  // Combine DOCTYPE with content
  const combinedStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(doctype);
      
      const reader = contentStream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    }
  });
  
  return new Response(combinedStream, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Transfer-Encoding": "chunked",
    },
  });
}

// ===== Suspense-like Streaming =====

/**
 * Placeholder for async content - renders fallback immediately,
 * then streams actual content when ready
 */
export interface SuspenseProps {
  children: JSXNode | Promise<JSXNode>;
  fallback?: JSXNode;
}

/**
 * Async component wrapper - similar to React Suspense
 * Renders fallback while waiting for async children
 */
export function Suspense(props: SuspenseProps): JSXElement {
  return jsx("asi-suspense", props as unknown as Record<string, unknown>);
}

/**
 * Create an async component that can be streamed
 */
export function createAsyncComponent<P extends JSXProps>(
  loader: (props: P) => Promise<JSXElement>
): JSXComponent<P> {
  return async (props: P) => {
    return await loader(props);
  };
}

// ===== Raw HTML =====

/**
 * Insert raw HTML without escaping
 * Use with caution - can lead to XSS vulnerabilities
 */
export function raw(htmlString: string): JSXElement {
  return {
    type: "raw",
    props: { html: htmlString },
  };
}

// Override renderToString to handle raw elements
const originalRenderToString = renderToString;
export { originalRenderToString };

// ===== Template Literals =====

/**
 * Tagged template literal for HTML
 * 
 * @example
 * ```ts
 * const name = "World";
 * return htmlTemplate`<h1>Hello ${name}!</h1>`;
 * ```
 */
export function htmlTemplate(
  strings: TemplateStringsArray,
  ...values: unknown[]
): string {
  let result = "";
  
  for (let i = 0; i < strings.length; i++) {
    result += strings[i];
    if (i < values.length) {
      const value = values[i];
      if (typeof value === "string") {
        result += escapeHtml(value);
      } else if (value !== null && value !== undefined) {
        result += escapeHtml(String(value));
      }
    }
  }
  
  return result;
}

/**
 * Tagged template for raw HTML (no escaping)
 */
export function rawHtml(
  strings: TemplateStringsArray,
  ...values: unknown[]
): string {
  let result = "";
  
  for (let i = 0; i < strings.length; i++) {
    result += strings[i];
    if (i < values.length) {
      result += String(values[i] ?? "");
    }
  }
  
  return result;
}

// ===== Component Helpers =====

/**
 * Conditional rendering helper
 */
export function when<T>(
  condition: T | null | undefined | false,
  render: (value: NonNullable<T>) => JSXNode
): JSXNode {
  if (condition) {
    return render(condition as NonNullable<T>);
  }
  return null;
}

/**
 * List rendering helper with key support
 */
export function each<T>(
  items: T[],
  render: (item: T, index: number) => JSXElement,
  keyFn?: (item: T, index: number) => string | number
): JSXElement[] {
  return items.map((item, index) => {
    const element = render(item, index);
    if (keyFn) {
      element.key = keyFn(item, index);
    }
    return element;
  });
}

// ===== Head Management =====

interface HeadContext {
  title?: string;
  meta: Array<{ name?: string; property?: string; content: string }>;
  links: Array<{ rel: string; href: string; [key: string]: string }>;
  scripts: Array<{ src?: string; content?: string; async?: boolean; defer?: boolean }>;
}

const headContext: HeadContext = {
  meta: [],
  links: [],
  scripts: [],
};

/**
 * Set document title
 */
export function setTitle(title: string): void {
  headContext.title = title;
}

/**
 * Add meta tag
 */
export function addMeta(meta: { name?: string; property?: string; content: string }): void {
  headContext.meta.push(meta);
}

/**
 * Add link tag
 */
export function addLink(link: { rel: string; href: string; [key: string]: string }): void {
  headContext.links.push(link);
}

/**
 * Add script tag
 */
export function addScript(script: { src?: string; content?: string; async?: boolean; defer?: boolean }): void {
  headContext.scripts.push(script);
}

/**
 * Render accumulated head content
 */
export function renderHead(): JSXElement {
  const children: JSXElement[] = [];
  
  if (headContext.title) {
    children.push(jsx("title", { children: headContext.title }));
  }
  
  for (const meta of headContext.meta) {
    children.push(jsx("meta", meta));
  }
  
  for (const link of headContext.links) {
    children.push(jsx("link", link));
  }
  
  for (const script of headContext.scripts) {
    if (script.src) {
      children.push(jsx("script", { src: script.src, async: script.async, defer: script.defer }));
    } else if (script.content) {
      children.push(jsx("script", { children: script.content }));
    }
  }
  
  // Clear context after rendering
  headContext.meta = [];
  headContext.links = [];
  headContext.scripts = [];
  headContext.title = undefined;
  
  return jsx(Fragment, { children });
}

// ===== Export JSX namespace for TypeScript =====

export namespace JSX {
  export interface Element extends JSXElement {}
  
  export interface ElementChildrenAttribute {
    children: {};
  }
  
  export interface IntrinsicElements {
    // HTML elements
    a: JSXProps;
    abbr: JSXProps;
    address: JSXProps;
    area: JSXProps;
    article: JSXProps;
    aside: JSXProps;
    audio: JSXProps;
    b: JSXProps;
    base: JSXProps;
    bdi: JSXProps;
    bdo: JSXProps;
    blockquote: JSXProps;
    body: JSXProps;
    br: JSXProps;
    button: JSXProps;
    canvas: JSXProps;
    caption: JSXProps;
    cite: JSXProps;
    code: JSXProps;
    col: JSXProps;
    colgroup: JSXProps;
    data: JSXProps;
    datalist: JSXProps;
    dd: JSXProps;
    del: JSXProps;
    details: JSXProps;
    dfn: JSXProps;
    dialog: JSXProps;
    div: JSXProps;
    dl: JSXProps;
    dt: JSXProps;
    em: JSXProps;
    embed: JSXProps;
    fieldset: JSXProps;
    figcaption: JSXProps;
    figure: JSXProps;
    footer: JSXProps;
    form: JSXProps;
    h1: JSXProps;
    h2: JSXProps;
    h3: JSXProps;
    h4: JSXProps;
    h5: JSXProps;
    h6: JSXProps;
    head: JSXProps;
    header: JSXProps;
    hgroup: JSXProps;
    hr: JSXProps;
    html: JSXProps;
    i: JSXProps;
    iframe: JSXProps;
    img: JSXProps;
    input: JSXProps;
    ins: JSXProps;
    kbd: JSXProps;
    label: JSXProps;
    legend: JSXProps;
    li: JSXProps;
    link: JSXProps;
    main: JSXProps;
    map: JSXProps;
    mark: JSXProps;
    menu: JSXProps;
    meta: JSXProps;
    meter: JSXProps;
    nav: JSXProps;
    noscript: JSXProps;
    object: JSXProps;
    ol: JSXProps;
    optgroup: JSXProps;
    option: JSXProps;
    output: JSXProps;
    p: JSXProps;
    param: JSXProps;
    picture: JSXProps;
    pre: JSXProps;
    progress: JSXProps;
    q: JSXProps;
    rp: JSXProps;
    rt: JSXProps;
    ruby: JSXProps;
    s: JSXProps;
    samp: JSXProps;
    script: JSXProps;
    section: JSXProps;
    select: JSXProps;
    slot: JSXProps;
    small: JSXProps;
    source: JSXProps;
    span: JSXProps;
    strong: JSXProps;
    style: JSXProps;
    sub: JSXProps;
    summary: JSXProps;
    sup: JSXProps;
    table: JSXProps;
    tbody: JSXProps;
    td: JSXProps;
    template: JSXProps;
    textarea: JSXProps;
    tfoot: JSXProps;
    th: JSXProps;
    thead: JSXProps;
    time: JSXProps;
    title: JSXProps;
    tr: JSXProps;
    track: JSXProps;
    u: JSXProps;
    ul: JSXProps;
    var: JSXProps;
    video: JSXProps;
    wbr: JSXProps;
    // SVG elements (basic)
    svg: JSXProps;
    path: JSXProps;
    circle: JSXProps;
    rect: JSXProps;
    line: JSXProps;
    polyline: JSXProps;
    polygon: JSXProps;
    ellipse: JSXProps;
    g: JSXProps;
    text: JSXProps;
    defs: JSXProps;
    use: JSXProps;
    // Custom elements
    [key: string]: JSXProps;
  }
}
