import { describe, expect, test } from "bun:test";

import {
  generateRule,
  generateCSS,
  parseVariants,
  resolveDefaultConfig,
  resolveConfig,
  defineConfig,
  escapeSelector,
} from "../src/core";

const config = resolveDefaultConfig();
const classConfig = resolveConfig(defineConfig({ options: { darkMode: "class" } }));

describe("parseVariants", () => {
  test("splits variant prefixes from base", () => {
    expect(parseVariants("hover:bg-red-500")).toEqual({
      base: "bg-red-500",
      variants: ["hover"],
    });
    expect(parseVariants("hover:md:bg-red-500")).toEqual({
      base: "bg-red-500",
      variants: ["hover", "md"],
    });
  });

  test("returns null for plain classes", () => {
    expect(parseVariants("p-4")).toBeNull();
    expect(parseVariants("hover:")).toBeNull();
  });
});

describe("generateRule — pseudo-classes", () => {
  test("hover", () => {
    expect(generateRule("hover:bg-red-500", config)).toEqual({
      className: "hover:bg-red-500",
      declarations: { "background-color": "#ef4444" },
      selectorSuffix: ":hover",
    });
  });

  test("focus / active", () => {
    expect(generateRule("focus:border-2", config)?.selectorSuffix).toBe(":focus");
    expect(generateRule("active:scale-95", config)).toBeNull(); // no scale utility yet
    expect(generateRule("active:opacity-50", config)?.selectorSuffix).toBe(":active");
  });

  test("structural", () => {
    expect(generateRule("odd:bg-gray-50", config)?.selectorSuffix).toBe(
      ":nth-child(odd)",
    );
    expect(generateRule("first:mt-0", config)?.selectorSuffix).toBe(":first-child");
  });

  test("unknown variant or base returns null", () => {
    expect(generateRule("nope:bg-red-500", config)).toBeNull();
    expect(generateRule("hover:nope-1", config)).toBeNull();
  });
});

describe("generateRule — breakpoints", () => {
  test("md from tokens", () => {
    const rule = generateRule("md:flex", config);
    expect(rule?.media).toBe("min-width: 768px");
    expect(rule?.selectorSuffix).toBeUndefined();
  });

  test("all default breakpoints resolve", () => {
    for (const bp of ["sm", "md", "lg", "xl", "2xl"]) {
      expect(generateRule(`${bp}:p-4`, config)?.media).toMatch(/^min-width: /);
    }
  });

  test("custom breakpoint from extend", () => {
    const custom = resolveConfig(
      defineConfig({ extend: { theme: { breakpoints: { "3xl": "1792px" } } } }),
    );
    expect(generateRule("3xl:p-4", custom)?.media).toBe("min-width: 1792px");
  });
});

describe("generateRule — dark", () => {
  test("media strategy by default", () => {
    expect(generateRule("dark:bg-black", config)?.media).toBe(
      "prefers-color-scheme: dark",
    );
  });

  test("class strategy from options", () => {
    expect(generateRule("dark:bg-black", classConfig)?.selectorPrefix).toBe(".dark ");
  });
});

describe("composition", () => {
  test("pseudo + breakpoint", () => {
    const rule = generateRule("hover:md:bg-red-500", config);
    expect(rule?.selectorSuffix).toBe(":hover");
    expect(rule?.media).toBe("min-width: 768px");
  });

  test("breakpoint + dark (class mode)", () => {
    const rule = generateRule("md:dark:bg-black", classConfig);
    expect(rule?.media).toBe("min-width: 768px");
    expect(rule?.selectorPrefix).toBe(".dark ");
  });

  test("dark + pseudo (class mode)", () => {
    const rule = generateRule("dark:hover:bg-black", classConfig);
    expect(rule?.selectorPrefix).toBe(".dark ");
    expect(rule?.selectorSuffix).toBe(":hover");
  });

  test("media stacking joins with ' and '", () => {
    const rule = generateRule("md:dark:bg-black", config);
    expect(rule?.media).toBe("min-width: 768px and prefers-color-scheme: dark");
  });
});

describe("generateCSS rendering", () => {
  test("pseudo rule", () => {
    const css = generateCSS(["hover:bg-red-500"], config);
    expect(css).toBe(
      ".hover\\:bg-red-500:hover {\n  background-color: #ef4444;\n}",
    );
  });

  test("breakpoint rule wraps in @media", () => {
    const css = generateCSS(["md:flex"], config);
    expect(css).toBe(
      "@media (min-width: 768px) {\n.md\\:flex {\n  display: flex;\n}\n}",
    );
  });

  test("dark media wraps in @media", () => {
    const css = generateCSS(["dark:bg-black"], config);
    expect(css).toBe(
      "@media (prefers-color-scheme: dark) {\n.dark\\:bg-black {\n  background-color: #000000;\n}\n}",
    );
  });

  test("dark class mode prepends .dark", () => {
    const css = generateCSS(["dark:bg-black"], classConfig);
    expect(css).toBe(
      ".dark .dark\\:bg-black {\n  background-color: #000000;\n}",
    );
  });

  test("composition: pseudo inside media", () => {
    const css = generateCSS(["hover:md:bg-red-500"], config);
    expect(css).toBe(
      "@media (min-width: 768px) {\n.hover\\:md\\:bg-red-500:hover {\n  background-color: #ef4444;\n}\n}",
    );
  });

  test("escaped selectors for variants", () => {
    expect(escapeSelector("hover:md:bg-red-500")).toBe("hover\\:md\\:bg-red-500");
  });

  test("unknown variant thrown with unknown: 'throw'", () => {
    expect(() =>
      generateCSS(["nope:p-4"], config, { unknown: "throw" }),
    ).toThrow(/unknown utility "nope:p-4"/);
  });
});

describe("generateCSS ordering (cascade)", () => {
  test("base before pseudo before media", () => {
    const css = generateCSS(["p-4", "md:p-4", "hover:p-4"], config);
    const p4 = css.indexOf(".p-4 {");
    const hover = css.indexOf(".hover\\:p-4:hover");
    const md = css.indexOf("@media (min-width: 768px)");
    expect(p4).toBeGreaterThan(-1);
    expect(hover).toBeGreaterThan(p4);
    expect(md).toBeGreaterThan(hover);
  });

  test("breakpoints ascending", () => {
    const css = generateCSS(["lg:p-4", "sm:p-4", "md:p-4"], config);
    expect(css.indexOf("@media (min-width: 640px)")).toBeLessThan(
      css.indexOf("@media (min-width: 768px)"),
    );
    expect(css.indexOf("@media (min-width: 768px)")).toBeLessThan(
      css.indexOf("@media (min-width: 1024px)"),
    );
  });

  test("mixed render is deterministic", () => {
    const classes = ["bg-red-500", "md:flex", "hover:text-blue-600", "p-4", "dark:bg-black"];
    const a = generateCSS(classes, config);
    const b = generateCSS([...classes].reverse(), config);
    expect(a).toBe(b);
    // base rules first, dark last
    expect(a.indexOf(".bg-red-500")).toBeLessThan(a.indexOf("@media"));
  });
});
