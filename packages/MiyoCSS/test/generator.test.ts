import { describe, expect, test } from "bun:test";

import {
  generateUtility,
  generateCSS,
  escapeSelector,
  resolveDefaultConfig,
  resolveConfig,
  defineConfig,
} from "../src/core";

const config = resolveDefaultConfig();

const decl = (className: string) =>
  generateUtility(className, config)?.declarations ?? null;

describe("layout", () => {
  test("display", () => {
    expect(decl("block")).toEqual({ display: "block" });
    expect(decl("flex")).toEqual({ display: "flex" });
    expect(decl("grid")).toEqual({ display: "grid" });
    expect(decl("hidden")).toEqual({ display: "none" });
  });

  test("position + overflow + z-index", () => {
    expect(decl("relative")).toEqual({ position: "relative" });
    expect(decl("sticky")).toEqual({ position: "sticky" });
    expect(decl("overflow-x-hidden")).toEqual({ "overflow-x": "hidden" });
    expect(decl("z-50")).toEqual({ "z-index": "50" });
    expect(decl("z-auto")).toEqual({ "z-index": "auto" });
  });

  test("sr-only", () => {
    const d = decl("sr-only");
    expect(d?.["position"]).toBe("absolute");
    expect(d?.["clip"]).toBe("rect(0, 0, 0, 0)");
  });
});

describe("flex/grid", () => {
  test("flex direction/wrap/item", () => {
    expect(decl("flex-col")).toEqual({ "flex-direction": "column" });
    expect(decl("flex-wrap")).toEqual({ "flex-wrap": "wrap" });
    expect(decl("flex-1")).toEqual({ flex: "1 1 0%" });
    expect(decl("grow")).toEqual({ "flex-grow": "1" });
  });

  test("alignment", () => {
    expect(decl("items-center")).toEqual({ "align-items": "center" });
    expect(decl("justify-between")).toEqual({ "justify-content": "space-between" });
    expect(decl("self-end")).toEqual({ "align-self": "flex-end" });
  });

  test("gap from spacing tokens", () => {
    expect(decl("gap-4")).toEqual({ gap: "16px" });
    expect(decl("gap-x-2")).toEqual({ "column-gap": "8px" });
    expect(decl("gap-y-6")).toEqual({ "row-gap": "24px" });
  });

  test("grid template + spans", () => {
    expect(decl("grid-cols-3")).toEqual({
      "grid-template-columns": "repeat(3, minmax(0, 1fr))",
    });
    expect(decl("grid-cols-none")).toEqual({ "grid-template-columns": "none" });
    expect(decl("grid-cols-13")).toBeNull(); // out of range
    expect(decl("grid-rows-2")).toEqual({
      "grid-template-rows": "repeat(2, minmax(0, 1fr))",
    });
    expect(decl("col-span-2")).toEqual({ "grid-column": "span 2 / span 2" });
    expect(decl("col-span-full")).toEqual({ "grid-column": "1 / -1" });
    expect(decl("row-span-full")).toEqual({ "grid-row": "1 / -1" });
  });
});

describe("spacing (p/m, 4px base, negative)", () => {
  test("padding sides", () => {
    expect(decl("p-4")).toEqual({ padding: "16px" });
    expect(decl("px-2")).toEqual({ "padding-left": "8px", "padding-right": "8px" });
    expect(decl("py-1")).toEqual({ "padding-top": "4px", "padding-bottom": "4px" });
    expect(decl("pt-3")).toEqual({ "padding-top": "12px" });
  });

  test("margin sides + auto", () => {
    expect(decl("m-0")).toEqual({ margin: "0px" });
    expect(decl("mx-auto")).toEqual({ "margin-left": "auto", "margin-right": "auto" });
    expect(decl("mt-2")).toEqual({ "margin-top": "8px" });
  });

  test("negative margins", () => {
    expect(decl("-m-4")).toEqual({ margin: "-16px" });
    expect(decl("-mt-2")).toEqual({ "margin-top": "-8px" });
    expect(decl("-mx-1")).toEqual({ "margin-left": "-4px", "margin-right": "-4px" });
  });

  test("inset family", () => {
    expect(decl("inset-0")).toEqual({ inset: "0px" });
    expect(decl("inset-x-4")).toEqual({ left: "16px", right: "16px" });
    expect(decl("top-2")).toEqual({ top: "8px" });
    expect(decl("-top-2")).toEqual({ top: "-8px" });
    expect(decl("left-auto")).toEqual({ left: "auto" });
  });

  test("unknown spacing key returns null", () => {
    expect(decl("p-999")).toBeNull();
    expect(decl("gap-13")).toBeNull();
  });
});

describe("typography", () => {
  test("font family vs weight", () => {
    expect(decl("font-sans")).toEqual({
      "font-family": expect.stringContaining("system-ui"),
    });
    expect(decl("font-mono")).toEqual({ "font-family": expect.stringContaining("monospace") });
    expect(decl("font-bold")).toEqual({ "font-weight": "700" });
    expect(decl("font-black")).toEqual({ "font-weight": "900" });
  });

  test("font size / leading / tracking", () => {
    expect(decl("text-xl")).toEqual({ "font-size": "20px" });
    expect(decl("text-base")).toEqual({ "font-size": "16px" });
    expect(decl("leading-tight")).toEqual({ "line-height": "1.25" });
    expect(decl("tracking-widest")).toEqual({ "letter-spacing": "0.1em" });
  });

  test("text-align + case + style", () => {
    expect(decl("text-center")).toEqual({ "text-align": "center" });
    expect(decl("uppercase")).toEqual({ "text-transform": "uppercase" });
    expect(decl("italic")).toEqual({ "font-style": "italic" });
    expect(decl("truncate")).toEqual({
      overflow: "hidden",
      "text-overflow": "ellipsis",
      "white-space": "nowrap",
    });
  });
});

describe("colors (text/bg/border + slash opacity)", () => {
  test("text color", () => {
    expect(decl("text-red-500")).toEqual({ color: "#ef4444" });
    expect(decl("text-current")).toEqual({ color: "currentColor" });
  });

  test("background", () => {
    expect(decl("bg-blue-500")).toEqual({ "background-color": "#3b82f6" });
    expect(decl("bg-transparent")).toEqual({ "background-color": "transparent" });
  });

  test("border color", () => {
    expect(decl("border-red-500")).toEqual({ "border-color": "#ef4444" });
  });

  test("slash opacity via color-mix", () => {
    expect(decl("bg-red-500/50")).toEqual({
      "background-color": "color-mix(in srgb, #ef4444 50%, transparent)",
    });
    expect(decl("text-blue-500/25")).toEqual({
      color: "color-mix(in srgb, #3b82f6 25%, transparent)",
    });
    expect(decl("bg-red-500/100")).toEqual({
      "background-color": "color-mix(in srgb, #ef4444 100%, transparent)",
    });
  });

  test("unknown color returns null", () => {
    expect(decl("bg-nope-500")).toBeNull();
    expect(decl("text-red-999")).toBeNull();
  });
});

describe("borders/effects", () => {
  test("border widths + sides + style", () => {
    expect(decl("border")).toEqual({ "border-width": "1px" });
    expect(decl("border-2")).toEqual({ "border-width": "2px" });
    expect(decl("border-0")).toEqual({ "border-width": "0px" });
    expect(decl("border-t")).toEqual({ "border-top-width": "1px" });
    expect(decl("border-x-2")).toEqual({
      "border-left-width": "2px",
      "border-right-width": "2px",
    });
    expect(decl("border-dashed")).toEqual({ "border-style": "dashed" });
  });

  test("border radius incl. DEFAULT and sides", () => {
    expect(decl("rounded")).toEqual({ "border-radius": "4px" });
    expect(decl("rounded-md")).toEqual({ "border-radius": "6px" });
    expect(decl("rounded-full")).toEqual({ "border-radius": "9999px" });
    expect(decl("rounded-t-lg")).toEqual({
      "border-top-left-radius": "8px",
      "border-top-right-radius": "8px",
    });
    expect(decl("rounded-br-2xl")).toEqual({ "border-bottom-right-radius": "16px" });
  });

  test("shadows", () => {
    expect(decl("shadow")).toEqual({
      "box-shadow": "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
    });
    expect(decl("shadow-lg")).toEqual({
      "box-shadow": "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
    });
    expect(decl("shadow-none")).toEqual({ "box-shadow": "none" });
  });

  test("opacity tokens", () => {
    expect(decl("opacity-50")).toEqual({ opacity: "0.5" });
    expect(decl("opacity-100")).toEqual({ opacity: "1" });
  });
});

describe("sizing", () => {
  test("width/height from spacing + specials", () => {
    expect(decl("w-4")).toEqual({ width: "16px" });
    expect(decl("w-full")).toEqual({ width: "100%" });
    expect(decl("w-screen")).toEqual({ width: "100vh" });
    expect(decl("h-96")).toEqual({ height: "384px" });
    expect(decl("h-screen")).toEqual({ height: "100vh" });
  });

  test("fractions", () => {
    expect(decl("w-1/2")).toEqual({ width: "50%" });
    expect(decl("w-1/3")).toEqual({ width: "33.3333%" });
    expect(decl("w-3/4")).toEqual({ width: "75%" });
    expect(decl("w-5/6")).toEqual({ width: "83.3333%" });
    expect(decl("w-2/1")).toBeNull(); // num >= den
    expect(decl("w-1/13")).toBeNull(); // den out of range
  });

  test("min/max", () => {
    expect(decl("min-w-0")).toEqual({ "min-width": "0px" });
    expect(decl("min-h-full")).toEqual({ "min-height": "100%" });
    expect(decl("max-w-4")).toEqual({ "max-width": "16px" });
    expect(decl("max-w-none")).toEqual({ "max-width": "none" });
    expect(decl("max-h-screen")).toEqual({ "max-height": "100vh" });
  });
});

describe("arbitrary values", () => {
  test("sizing and spacing", () => {
    expect(decl("w-[17px]")).toEqual({ width: "17px" });
    expect(decl("p-[13px]")).toEqual({ padding: "13px" });
    expect(decl("mt-[10px]")).toEqual({ "margin-top": "10px" });
    expect(decl("gap-[7px]")).toEqual({ gap: "7px" });
    expect(decl("top-[10px]")).toEqual({ top: "10px" });
  });

  test("colors vs font-size disambiguation in text-", () => {
    expect(decl("text-[#f00]")).toEqual({ color: "#f00" });
    expect(decl("text-[rgb(1,2,3)]")).toEqual({ color: "rgb(1,2,3)" });
    expect(decl("text-[13px]")).toEqual({ "font-size": "13px" });
  });

  test("bg / border / radius / shadow", () => {
    expect(decl("bg-[#0f0]")).toEqual({ "background-color": "#0f0" });
    expect(decl("border-[3px]")).toEqual({ "border-width": "3px" });
    expect(decl("border-[#abc]")).toEqual({ "border-color": "#abc" });
    expect(decl("rounded-[20px]")).toEqual({ "border-radius": "20px" });
    expect(decl("shadow-[0_2px_8px_rgba(0,0,0,0.3)]")).toEqual({
      "box-shadow": "0 2px 8px rgba(0,0,0,0.3)",
    });
  });

  test("numeric families", () => {
    expect(decl("z-[100]")).toEqual({ "z-index": "100" });
    expect(decl("opacity-[0.33]")).toEqual({ opacity: "0.33" });
    expect(decl("leading-[1.7]")).toEqual({ "line-height": "1.7" });
    expect(decl("tracking-[0.02em]")).toEqual({ "letter-spacing": "0.02em" });
    expect(decl("font-[600]")).toEqual({ "font-weight": "600" });
  });

  test("grid arbitrary", () => {
    expect(decl("grid-cols-[200px_1fr]")).toEqual({
      "grid-template-columns": "200px 1fr",
    });
  });

  test("injection attempts rejected", () => {
    expect(decl("w-[1px;background:red]")).toBeNull();
    expect(decl("w-[1px{color:red}]")).toBeNull();
    expect(decl("w-[1px!important]")).toBeNull();
    expect(decl("bg-[red];")).toBeNull(); // no arbitrary match at all
  });
});

describe("generateCSS / escaping", () => {
  test("renders rules sorted and deduped", () => {
    const css = generateCSS(["p-4", "p-4", "bg-red-500", "w-1/2"], config);
    expect(css).toBe(
      [
        ".bg-red-500 {\n  background-color: #ef4444;\n}",
        ".p-4 {\n  padding: 16px;\n}",
        ".w-1\\/2 {\n  width: 50%;\n}",
      ].join("\n"),
    );
  });

  test("skips unknown by default, throws with unknown: 'throw'", () => {
    expect(generateCSS(["nope-1", "p-4"], config)).toBe(
      ".p-4 {\n  padding: 16px;\n}",
    );
    expect(() => generateCSS(["nope-1"], config, { unknown: "throw" })).toThrow(
      /unknown utility "nope-1"/,
    );
  });

  test("escapeSelector handles special chars and leading digits", () => {
    expect(escapeSelector("p-4")).toBe("p-4");
    expect(escapeSelector("md:p-4")).toBe("md\\:p-4");
    expect(escapeSelector("w-1/2")).toBe("w-1\\/2");
    expect(escapeSelector("1/2")).toBe("\\31 \\/2");
  });

  test("works with extended custom tokens", () => {
    const custom = resolveConfig(
      defineConfig({
        extend: {
          theme: {
            spacing: { 18: "72px" },
            colors: { brand: { DEFAULT: "#6d28d9", 600: "#5b21b6" } },
          },
        },
      }),
    );
    expect(generateUtility("p-18", custom)?.declarations).toEqual({ padding: "72px" });
    expect(generateUtility("bg-brand", custom)?.declarations).toEqual({
      "background-color": "#6d28d9",
    });
    expect(generateUtility("bg-brand-600", custom)?.declarations).toEqual({
      "background-color": "#5b21b6",
    });
  });
});
