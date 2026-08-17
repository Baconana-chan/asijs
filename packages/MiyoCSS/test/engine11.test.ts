import { describe, expect, test } from "bun:test";

import {
  defineConfig,
  defineUtility,
  generateCSS,
  generateRule,
  generateUtility,
  resolveConfig,
  resolveDefaultConfig,
  staticUtilityNames,
  generateFullCSS,
  type CustomUtility,
} from "../src/core";

const config = resolveDefaultConfig();

// ===== defineUtility =====

describe("defineUtility", () => {
  test("validates shape and returns the utility", () => {
    const util = defineUtility({
      name: "card",
      static: { card: { background: "#fff", padding: "16px" } },
    });
    expect(util.name).toBe("card");
    expect(util.static?.card).toEqual({ background: "#fff", padding: "16px" });
  });

  test("throws on missing name", () => {
    // @ts-expect-error — intentionally invalid
    expect(() => defineUtility({ static: { x: { color: "red" } } })).toThrow(/name/);
  });

  test("throws on non-object static value", () => {
    expect(() =>
      defineUtility({ name: "bad", static: { x: "not-declarations" } }),
    ).toThrow(/static "x"/);
  });

  test("throws on matcher without regex or apply", () => {
    expect(() =>
      defineUtility({
        name: "bad",
        match: [{ pattern: /^x$/, apply: () => null }],
      }),
    ).not.toThrow();
    expect(() =>
      defineUtility({
        name: "bad",
        match: [{ pattern: "not-regex", apply: () => null } as never],
      }),
    ).toThrow(/RegExp/);
    expect(() =>
      defineUtility({
        name: "bad",
        match: [{ pattern: /^x$/, apply: undefined } as never],
      }),
    ).toThrow(/apply/);
  });
});

describe("custom utilities in config", () => {
  const custom = resolveConfig(
    defineConfig({
      utilities: [
        defineUtility({
          name: "brand",
          static: {
            "brand-card": { background: "#6d28d9", borderRadius: "8px" },
          },
          match: [
            {
              pattern: /^brand-(padding|margin)-(.+)$/,
              apply: (m, cfg) => {
                const value = cfg.theme.spacing[m[2]];
                if (value === undefined) return null;
                const prop = m[1] === "padding" ? "padding" : "margin";
                return { [prop]: String(value) };
              },
            },
          ],
        }),
      ],
    }),
  );

  test("static custom utility resolves", () => {
    expect(generateUtility("brand-card", custom)).toEqual({
      className: "brand-card",
      declarations: { background: "#6d28d9", borderRadius: "8px" },
    });
  });

  test("match custom utility resolves from tokens", () => {
    expect(generateUtility("brand-padding-4", custom)?.declarations).toEqual({
      padding: "16px",
    });
    expect(generateUtility("brand-margin-2", custom)?.declarations).toEqual({
      margin: "8px",
    });
  });

  test("unknown custom match returns null", () => {
    expect(generateUtility("brand-padding-999", custom)).toBeNull();
  });

  test("custom utilities work with variants", () => {
    const rule = generateRule("hover:brand-card", custom);
    expect(rule?.selectorSuffix).toBe(":hover");
    expect(rule?.declarations.background).toBe("#6d28d9");
  });

  test("custom utilities override built-ins (documented contract)", () => {
    const over = resolveConfig(
      defineConfig({
        utilities: [defineUtility({ name: "o", static: { flex: { color: "red" } } })],
      }),
    );
    expect(generateUtility("flex", over)?.declarations).toEqual({ color: "red" });
    // ...and the built-in is still reachable without the custom utility.
    expect(generateUtility("flex", config)?.declarations).toEqual({ display: "flex" });
  });

  test("custom static names appear in staticUtilityNames and full CSS", () => {
    expect(staticUtilityNames(custom)).toContain("brand-card");
    const full = generateFullCSS(custom);
    expect(full).toContain(".brand-card");
  });

  test("generateCSS renders custom utilities with variants", () => {
    const css = generateCSS(["brand-card", "hover:brand-padding-4"], custom);
    expect(css).toContain(".brand-card");
    expect(css).toContain(".hover\\:brand-padding-4:hover");
  });

  test("config with malformed utilities throws at defineConfig", () => {
    expect(() =>
      defineConfig({ utilities: [{ name: "nope", static: { x: "bad" } } as CustomUtility] }),
    ).toThrow(/static "x"/);
  });
});

// ===== Group / peer variants =====

describe("group-* / peer-* variants", () => {
  test("group-hover produces .group:hover prefix", () => {
    const rule = generateRule("group-hover:bg-red-500", config);
    expect(rule?.selectorPrefix).toBe(".group:hover ");
    expect(rule?.selectorSuffix).toBeUndefined();
  });

  test("group-focus / group-active", () => {
    expect(generateRule("group-focus:opacity-50", config)?.selectorPrefix).toBe(
      ".group:focus ",
    );
    expect(generateRule("group-active:opacity-50", config)?.selectorPrefix).toBe(
      ".group:active ",
    );
  });

  test("peer-checked produces .peer:checked ~ prefix", () => {
    expect(generateRule("peer-checked:block", config)?.selectorPrefix).toBe(
      ".peer:checked ~ ",
    );
    expect(generateRule("peer-hover:block", config)?.selectorPrefix).toBe(
      ".peer:hover ~ ",
    );
  });

  test("unknown group pseudo returns null", () => {
    expect(generateRule("group-nope:block", config)).toBeNull();
    expect(generateRule("peer-nope:block", config)).toBeNull();
  });

  test("composes with breakpoints (media wraps, prefix stays)", () => {
    const rule = generateRule("group-hover:md:bg-red-500", config);
    expect(rule?.selectorPrefix).toBe(".group:hover ");
    expect(rule?.media).toBe("min-width: 768px");
  });

  test("dark:class + group-hover stack as .dark .group:hover", () => {
    const classConfig = resolveConfig(defineConfig({ options: { darkMode: "class" } }));
    const rule = generateRule("dark:group-hover:bg-red-500", classConfig);
    expect(rule?.selectorPrefix).toBe(".dark .group:hover ");
  });

  test("renders full selector", () => {
    const css = generateCSS(["group-hover:bg-red-500"], config);
    expect(css).toContain(".group:hover .group-hover\\:bg-red-500");
    const cssPeer = generateCSS(["peer-checked:block"], config);
    expect(cssPeer).toContain(".peer:checked ~ .peer-checked\\:block");
  });
});

// ===== before / after =====

describe("before: / after: pseudo-elements", () => {
  test("before: appends ::before", () => {
    const rule = generateRule("before:content-['']", config);
    expect(rule?.selectorSuffix).toBe("::before");
    expect(rule?.declarations).toEqual({ content: "''" });
  });

  test("after: appends ::after", () => {
    const rule = generateRule("after:content-['']", config);
    expect(rule?.selectorSuffix).toBe("::after");
  });

  test("pseudo-element always last, regardless of variant order", () => {
    const a = generateRule("before:hover:content-['']", config);
    const b = generateRule("hover:before:content-['']", config);
    expect(a?.selectorSuffix).toBe(":hover::before");
    expect(b?.selectorSuffix).toBe(":hover::before");
  });

  test("content-none static utility", () => {
    expect(generateUtility("content-none", config)?.declarations).toEqual({
      content: "none",
    });
  });

  test("renders ::before selector", () => {
    const css = generateCSS(["before:content-['']"], config);
    expect(css).toContain(".before\\:content-\\[\\'\\'\\]::before");
    expect(css).toContain("content: '';");
  });

  test("structural variants still work (0.4 regression)", () => {
    expect(generateRule("first:mt-0", config)?.selectorSuffix).toBe(":first-child");
    expect(generateRule("odd:bg-gray-50", config)?.selectorSuffix).toBe(
      ":nth-child(odd)",
    );
  });
});

// ===== Dynamic values from tokens =====

describe("dynamic values from tokens (token() refs)", () => {
  test("calc() with spacing token", () => {
    expect(generateUtility("w-[calc(100%_-_token(spacing.4))]", config)?.declarations).toEqual({
      width: "calc(100% - 16px)",
    });
  });

  test("clamp() with tokens", () => {
    expect(
      generateUtility("w-[clamp(token(spacing.2),50vw,token(spacing.8))]", config)?.declarations,
    ).toEqual({
      width: "clamp(8px,50vw,32px)",
    });
  });

  test("min()/max() with tokens", () => {
    expect(
      generateUtility("h-[min(token(spacing.4),100%)]", config)?.declarations,
    ).toEqual({ height: "min(16px,100%)" });
    expect(
      generateUtility("p-[max(token(spacing.1),0.5rem)]", config)?.declarations,
    ).toEqual({ padding: "max(4px,0.5rem)" });
  });

  test("color token reference", () => {
    expect(generateUtility("bg-[token(colors.red-500)]", config)?.declarations).toEqual({
      "background-color": "#ef4444",
    });
  });

  test("missing token rejects the arbitrary value", () => {
    expect(generateUtility("w-[calc(100%-token(nope.4))]", config)).toBeNull();
  });

  test("token refs inside spacing families", () => {
    expect(generateUtility("m-[token(spacing.6)]", config)?.declarations).toEqual({
      margin: "24px",
    });
  });
});

// ===== Shortcuts & statics =====

describe("shortcuts and static utilities without values", () => {
  test("center shortcut expands to flex + align + justify", () => {
    expect(generateUtility("center", config)?.declarations).toEqual({
      display: "flex",
      "align-items": "center",
      "justify-content": "center",
    });
  });

  test("inline-center shortcut", () => {
    expect(generateUtility("inline-center", config)?.declarations).toEqual({
      display: "inline-flex",
      "align-items": "center",
      "justify-content": "center",
    });
  });

  test("static utilities without values resolve (0.3 regression)", () => {
    for (const cls of ["hidden", "block", "sr-only", "truncate"]) {
      expect(generateUtility(cls, config)).not.toBeNull();
    }
  });

  test("shortcuts work with variants", () => {
    const rule = generateRule("md:center", config);
    expect(rule?.media).toBe("min-width: 768px");
    expect(rule?.declarations.display).toBe("flex");
  });
});

// ===== Full CSS includes new statics =====

describe("generateFullCSS with 1.1 additions", () => {
  test("includes center, inline-center, content-none", () => {
    const css = generateFullCSS(config);
    expect(css).toContain(".center");
    expect(css).toContain(".inline-center");
    expect(css).toContain(".content-none");
  });
});
