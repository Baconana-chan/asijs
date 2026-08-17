import { describe, expect, it } from "bun:test";
import { jsx } from "asijs";
import { resolveDefaultConfig } from "../src/core/config";
import {
  collectClasses,
  generateFullCSS,
  injectStyleIntoHtml,
  render,
  stream,
  styleTag,
} from "../src/core/ssr";
import { renderToString, renderToStream } from "asijs";

const config = resolveDefaultConfig();
const renderer = {
  renderToString,
  renderToStream,
};

function el(type: string, props: Record<string, unknown> = {}) {
  return jsx(type, props);
}

function htmlDoc(children: unknown) {
  return el("html", {
    children: [
      el("head", { children: el("title", { children: "Test" }) }),
      el("body", { children }),
    ],
  });
}

describe("collectClasses — tree walk", () => {
  it("collects className from plain elements", () => {
    const tree = el("div", { className: "flex p-4 hover:bg-blue-500" });
    const set = collectClasses(tree);
    expect([...set].sort()).toEqual(["flex", "hover:bg-blue-500", "p-4"]);
  });

  it("supports `class` prop as alias", () => {
    const tree = el("div", { class: "grid gap-2" });
    expect([...collectClasses(tree)].sort()).toEqual(["gap-2", "grid"]);
  });

  it("walks nested children recursively", () => {
    const tree = el("div", {
      className: "flex",
      children: [
        el("span", { className: "text-sm" }),
        el("section", {
          className: "p-6",
          children: el("h1", { className: "text-xl font-bold" }),
        }),
      ],
    });
    const set = collectClasses(tree);
    expect(set.has("flex")).toBe(true);
    expect(set.has("text-sm")).toBe(true);
    expect(set.has("p-6")).toBe(true);
    expect(set.has("text-xl")).toBe(true);
    expect(set.has("font-bold")).toBe(true);
  });

  it("handles fragments and arrays", () => {
    const tree = el("", {
      children: [
        el("div", { className: "a" }),
        [el("div", { className: "b" }), el("div", { className: "c" })],
      ],
    });
    expect([...collectClasses(tree)].sort()).toEqual(["a", "b", "c"]);
  });

  it("expands synchronous component functions", () => {
    function Card(props: Record<string, unknown>) {
      return el("div", { className: `card ${props.className ?? ""}` });
    }
    const tree = el("div", {
      children: jsx(Card, { className: "p-4" }),
    });
    const set = collectClasses(tree);
    expect(set.has("card")).toBe(true);
    expect(set.has("p-4")).toBe(true);
  });

  it("skips async components (documented limitation)", () => {
    async function AsyncCard() {
      return el("div", { className: "async-only" });
    }
    const tree = el("div", {
      children: jsx(AsyncCard, {}),
    });
    const set = collectClasses(tree);
    expect(set.has("async-only")).toBe(false); // body unknown before render
  });

  it("deduplicates classes", () => {
    const tree = el("div", {
      className: "flex",
      children: el("div", { className: "flex p-2 p-2" }),
    });
    const set = collectClasses(tree);
    expect(set.size).toBe(2);
  });

  it("handles primitive children without throwing", () => {
    const tree = el("div", {
      children: ["text", 42, true, null, undefined],
    });
    expect(collectClasses(tree).size).toBe(0);
  });
});

describe("injectStyleIntoHtml", () => {
  it("injects before </head>", () => {
    const html = "<html><head><title>x</title></head><body></body></html>";
    const out = injectStyleIntoHtml(html, ".a{color:red}");
    expect(out).toContain("<style data-miyocss>.a{color:red}</style></head>");
    expect(out.indexOf("<style")).toBeLessThan(out.indexOf("</head>"));
  });

  it("falls back to after <head> open when no close tag", () => {
    const html = "<html><head><title>x</title><body></body></html>";
    const out = injectStyleIntoHtml(html, ".a{color:red}");
    expect(out).toContain("<style data-miyocss>.a{color:red}</style><title>");
  });

  it("prepends when there is no head at all", () => {
    const out = injectStyleIntoHtml("<div>hi</div>", ".a{color:red}");
    expect(out.startsWith("<style data-miyocss>")).toBe(true);
  });

  it("uses custom style attribute", () => {
    const out = injectStyleIntoHtml("<head></head>", ".a{}", "data-foo");
    expect(out).toContain('<style data-foo>');
  });
});

describe("render — string path", () => {
  it("collects classes and injects style into head", async () => {
    const tree = htmlDoc(
      el("div", { className: "flex items-center gap-4 p-6" }),
    );
    const html = await render(tree, config, {}, renderer);

    // head contains the style tag
    const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
    expect(head).toContain('<style data-miyocss>');

    // style contains exactly the used utilities
    expect(head).toContain(".flex {");
    expect(head).toContain(".items-center {");
    expect(head).toContain(".gap-4 {");
    expect(head).toContain(".p-6 {");

    // no unused utilities in the page
    expect(head).not.toContain(".grid {");

    // body rendered normally
    expect(html).toContain('class="flex items-center gap-4 p-6"');
  });

  it("renders variants with proper selectors", async () => {
    const tree = htmlDoc(
      el("div", { className: "p-4 hover:bg-blue-500 md:p-8" }),
    );
    const html = await render(tree, config, {}, renderer);
    expect(html).toContain(".hover\\:bg-blue-500:hover");
    expect(html).toContain("@media (min-width: 768px)");
    expect(html).toContain(".md\\:p-8");
  });

  it("supports conditional classes (no false positives)", async () => {
    const cond = false;
    const tree = htmlDoc(
      el("div", { className: `flex ${cond ? "hidden" : ""} p-4` }),
    );
    const html = await render(tree, config, {}, renderer);
    expect(html).toContain(".flex {");
    expect(html).toContain(".p-4 {");
    expect(html).not.toContain(".hidden {"); // never rendered → not collected
  });

  it("custom styleAttr is honored", async () => {
    const tree = htmlDoc(el("div", { className: "flex" }));
    const html = await render(tree, config, { styleAttr: "data-my" }, renderer);
    expect(html).toContain('<style data-my>');
  });

  it("collect:false emits full static catalog", async () => {
    const tree = htmlDoc(el("div", { className: "flex" }));
    const html = await render(tree, config, { collect: false }, renderer);
    expect(html).toContain(".flex {");
    // full catalog — token-driven families present even if unused
    expect(html).toContain(".grid {");
    expect(html).toContain(".p-4 {");
    expect(html).toContain(".text-blue-500 {");
  });
});

describe("stream — stream path", () => {
  it("injects style after head and streams the rest", async () => {
    const tree = htmlDoc(
      el("div", { className: "flex p-4" }),
    );
    const res = stream(tree, config, {}, renderer);
    const reader = res.getReader();
    const decoder = new TextDecoder();
    let html = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
    }

    expect(html).toContain("<head>");
    const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
    expect(head).toContain('<style data-miyocss>');
    expect(head).toContain(".flex {");
    expect(head).toContain(".p-4 {");
    expect(html).toContain('class="flex p-4"');
    expect(html).not.toContain(".grid {");
  });

  it("matches render() output for the same tree", async () => {
    const tree = htmlDoc(
      el("main", { className: "container mx-auto p-6 md:p-12" }),
    );
    const str = await render(tree, config, {}, renderer);
    const res = stream(tree, config, {}, renderer);
    const reader = res.getReader();
    const decoder = new TextDecoder();
    let streamed = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      streamed += decoder.decode(value, { stream: true });
    }
    expect(streamed).toBe(str);
  });

  it("handles pages without </head> gracefully", async () => {
    const tree = el("div", { className: "flex" });
    const res = stream(tree, config, {}, renderer);
    const reader = res.getReader();
    const decoder = new TextDecoder();
    let html = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
    }
    expect(html).toContain(".flex {");
    expect(html).toContain('class="flex"');
  });
});

describe("styleTag", () => {
  it("builds a style tag with default attr", () => {
    expect(styleTag(".a{color:red}")).toBe(
      "<style data-miyocss>.a{color:red}</style>",
    );
  });
  it("builds a style tag without attr when empty string", () => {
    expect(styleTag(".a{}", "")).toBe("<style>.a{}</style>");
  });
});

describe("generateFullCSS", () => {
  it("produces a superset that includes static + token utilities", () => {
    const css = generateFullCSS(config);
    expect(css).toContain(".flex {");
    expect(css).toContain(".p-4 {");
    expect(css).toContain(".text-blue-500 {");
    expect(css).toContain(".grid-cols-3 {");
    expect(css).toContain(".w-1\\/2 {"); // selector-escaped slash
  });
  it("does not throw on unknown tokens", () => {
    expect(() => generateFullCSS(config)).not.toThrow();
  });
});
