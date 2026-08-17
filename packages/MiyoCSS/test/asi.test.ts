import { describe, expect, it } from "bun:test";
import { Asi, jsx } from "asijs";
import {
  asiPlugin,
  miyocss,
  html,
  stream,
  StyleSheet,
  STYLE_SHEET_CLASS,
} from "../src/asi";

function doc(children: unknown) {
  return jsx("html", {
    children: [
      jsx("head", { children: jsx("title", { children: "Test" }) }),
      jsx("body", { children }),
    ],
  });
}

describe("asiPlugin — plugin shape", () => {
  it("returns a plugin named miyocss", () => {
    const p = asiPlugin();
    expect(p.name).toBe("miyocss");
    expect(p.config.name).toBe("miyocss");
  });

  it("miyocss is a friendly alias", () => {
    expect(miyocss).toBe(asiPlugin);
  });
});

describe("asiPlugin — integration with a real Asi app", () => {
  it("registers config in state and decorates ctx with miyocss + styles", async () => {
    const app = new Asi({ development: false, silent: true });
    app.plugin(asiPlugin({ config: { theme: { colors: { brand: "#0af" } } } }));

    let captured: Record<string, unknown> = {};
    app.get("/", (ctx: any) => {
      captured = {
        miyocss: ctx.miyocss,
        styles: ctx.styles(["flex", "p-4"]),
        full: ctx.styles(),
      };
      return "ok";
    });

    const res = await app.handle(new Request("http://localhost/"));
    expect(await res.text()).toBe("ok");

    // ctx.miyocss — resolved config with the custom token
    expect(captured.miyocss).toBeTruthy();
    expect((captured.miyocss as any).theme.colors.brand).toBe("#0af");

    // ctx.styles(classes) — exact CSS for the given classes
    const styles = captured.styles as string;
    expect(styles).toContain("<style");
    expect(styles).toContain(".flex");
    expect(styles).toContain(".p-4");
    expect(styles).not.toContain("hidden");

    // ctx.styles() — full static catalog
    const full = captured.full as string;
    expect(full).toContain(".flex");
    expect(full).toContain(".p-4");

    // app-level access via decorator
    const cfg = app.decorator<{ theme: { colors: Record<string, string> } }>("miyocss");
    expect(cfg).toBeTruthy();
    expect(cfg!.theme.colors.brand).toBe("#0af");
    expect(app.decorator<(...args: unknown[]) => string>("styles")).toBeTypeOf("function");
  });

  it("ctx.styles() skips unknown classes without throwing", async () => {
    const app = new Asi({ development: false, silent: true });
    app.plugin(asiPlugin());
    let out = "";
    app.get("/", (ctx: any) => {
      out = ctx.styles(["flex", "definitely-not-a-utility"]);
      return "ok";
    });
    await app.handle(new Request("http://localhost/"));
    expect(out).toContain(".flex");
    expect(out).not.toContain("definitely-not-a-utility");
  });
});

describe("html() — render + auto-inject", () => {
  it("injects a <style> with exactly the used utilities into <head>", async () => {
    const page = doc(jsx("div", { className: "flex p-4 hover:bg-blue-500" }, "Hello"));
    const out = await html(page);

    const styleIdx = out.indexOf("<style");
    const headIdx = out.indexOf("</head>");
    expect(styleIdx).toBeGreaterThan(-1);
    expect(styleIdx).toBeLessThan(headIdx);

    expect(out).toContain(".flex");
    expect(out).toContain(".p-4");
    expect(out).toContain(":hover");
    expect(out).toContain("bg-blue-500");
    expect(out).not.toContain("hidden");
    expect(out).not.toContain("grid");
  });

  it("zero false positives — conditional classes only when truthy", async () => {
    const cond = false;
    const page = doc(
      jsx("div", { className: cond && "hidden", children: "x" }),
    );
    const out = await html(page);
    expect(out).not.toContain("hidden");
  });

  it("collects conditional classes when truthy", async () => {
    const cond = true;
    const page = doc(
      jsx("div", { className: cond && "hidden", children: "x" }),
    );
    const out = await html(page);
    expect(out).toContain(".hidden");
  });

  it("supports custom tokens via config option", async () => {
    const config = {
      extend: {
        theme: {
          colors: { brand: { DEFAULT: "#0af", 500: "#00aaff" } },
        },
      },
    };
    const page = doc(
      jsx("div", { className: "bg-brand text-brand-500" }, "Brand"),
    );
    const out = await html(page, { config });
    expect(out).toContain("bg-brand");
    expect(out).toContain("#0af");
    expect(out).toContain("text-brand-500");
    expect(out).toContain("#00aaff");
  });

  it("collect:false emits the full static catalog", async () => {
    const page = doc(jsx("div", { className: "flex", children: "x" }));
    const out = await html(page, { collect: false });
    // full catalog includes utilities not used on the page
    expect(out).toContain(".flex");
    expect(out).toContain(".grid");
    expect(out).toContain(".hidden");
  });
});

describe("<StyleSheet /> — manual placement", () => {
  it("replaces the placeholder with a single style tag in <head>", async () => {
    const page = jsx("html", {
      children: [
        jsx("head", { children: [jsx("title", { children: "T" }), jsx(StyleSheet, {})] }),
        jsx("body", { children: jsx("div", { className: "grid gap-2" }, "x") }),
      ],
    });
    const out = await html(page);

    expect((out.match(/<style/g) || []).length).toBe(1);
    expect(out).toContain(".grid");
    expect(out).toContain(".gap-2");
    expect(out).not.toContain(STYLE_SHEET_CLASS);

    const titleIdx = out.indexOf("</title>");
    const styleIdx = out.indexOf("<style");
    const headIdx = out.indexOf("</head>");
    expect(styleIdx).toBeGreaterThan(titleIdx);
    expect(styleIdx).toBeLessThan(headIdx);
  });

  it("places the style tag in <body> when the placeholder is there", async () => {
    const page = jsx("html", {
      children: [
        jsx("head", { children: jsx("title", { children: "T" }) }),
        jsx("body", {
          children: [
            jsx("main", { className: "flex" }, "content"),
            jsx(StyleSheet, {}),
          ],
        }),
      ],
    });
    const out = await html(page);

    expect((out.match(/<style/g) || []).length).toBe(1);
    const styleIdx = out.indexOf("<style");
    const bodyIdx = out.indexOf("</body>");
    const headIdx = out.indexOf("</head>");
    // in body, after head closed
    expect(styleIdx).toBeGreaterThan(headIdx);
    expect(styleIdx).toBeLessThan(bodyIdx);
    expect(out).toContain(".flex");
  });
});

describe("stream() — streaming variant", () => {
  async function collect(s: ReadableStream<Uint8Array>): Promise<string> {
    const reader = s.getReader();
    let out = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      out += new TextDecoder().decode(value);
    }
    return out;
  }

  it("injects styles into <head>", async () => {
    const page = doc(jsx("div", { className: "flex p-4" }, "x"));
    const out = await collect(stream(page));

    expect(out).toContain(".flex");
    expect(out).toContain(".p-4");
    expect(out.indexOf("<style")).toBeLessThan(out.indexOf("</head>"));
  });

  it("replaces a <StyleSheet /> placeholder", async () => {
    const page = jsx("html", {
      children: [
        jsx("head", { children: [jsx("title", { children: "T" }), jsx(StyleSheet, {})] }),
        jsx("body", { children: jsx("div", { className: "flex" }, "x") }),
      ],
    });
    const out = await collect(stream(page));

    expect((out.match(/<style/g) || []).length).toBe(1);
    expect(out).toContain(".flex");
    expect(out).not.toContain(STYLE_SHEET_CLASS);
    const titleIdx = out.indexOf("</title>");
    const styleIdx = out.indexOf("<style");
    expect(styleIdx).toBeGreaterThan(titleIdx);
  });

  it("falls back to head injection when the placeholder never appears", async () => {
    // Async component hides the StyleSheet from the pre-render walk — the
    // stream fallback should still inject styles (best effort, into head).
    const AsyncSheet = async () => {
      const s = StyleSheet();
      await Promise.resolve();
      return s;
    };
    const page = jsx("html", {
      children: [
        jsx("head", { children: [jsx("title", { children: "T" }), jsx(AsyncSheet, {})] }),
        jsx("body", { children: jsx("div", { className: "flex" }, "x") }),
      ],
    });
    const out = await collect(stream(page));
    expect(out).toContain(".flex");
    // either the placeholder got replaced or the fallback injected into head —
    // both must contain a real style tag with the used utility
    expect((out.match(/<style/g) || []).length).toBeGreaterThan(0);
  });
});
