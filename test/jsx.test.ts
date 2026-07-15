import { describe, expect, it } from "bun:test";
import { each, escapeHtml, jsx, renderToStream, renderToString, when } from "../src";

describe("jsx.ts", () => {
  it("renderToString() renders nested JSX and escapes text", async () => {
    const tree = jsx("main", {
      children: [
        jsx("h1", { children: "AsiJS" }),
        jsx("p", { children: "<fast & safe>" }),
      ],
    });

    expect(await renderToString(tree)).toBe(
      "<main><h1>AsiJS</h1><p>&lt;fast &amp; safe&gt;</p></main>",
    );
  });

  it("renderToStream() streams the same HTML structure", async () => {
    const tree = jsx("section", {
      children: jsx("span", { children: "streamed" }),
    });

    const response = new Response(renderToStream(tree));
    expect(await response.text()).toBe(
      "<section><span>streamed</span></section>",
    );
  });

  it("escapeHtml() escapes special characters", () => {
    expect(escapeHtml(`Tom & "Jerry"`)).toBe("Tom &amp; &quot;Jerry&quot;");
  });

  it("when() returns rendered content only for truthy values", async () => {
    const shown = when("docs", (value) => jsx("span", { children: value }));
    const hidden = when("", (value) => jsx("span", { children: value }));

    expect(await renderToString(shown)).toBe("<span>docs</span>");
    expect(hidden).toBeNull();
  });

  it("each() renders lists and assigns keys", async () => {
    const items = each(
      ["api", "ssr"],
      (item) => jsx("li", { children: item }),
      (item) => item,
    );

    expect(items[0].key).toBe("api");
    expect(await renderToString(jsx("ul", { children: items }))).toBe(
      "<ul><li>api</li><li>ssr</li></ul>",
    );
  });
});
