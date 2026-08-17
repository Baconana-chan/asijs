import { describe, expect, test } from "bun:test";

import {
  defineConfig,
  resolveConfig,
  resolveDefaultConfig,
  flattenColors,
  defaultTheme,
  defaultOptions,
} from "../src/core";

describe("defineConfig — validation", () => {
  test("returns normalized config with default options", () => {
    const config = defineConfig({});
    expect(config.options).toEqual(defaultOptions);
  });

  test("keeps user options, filling only missing keys", () => {
    const config = defineConfig({ options: { prefix: "mi-" } });
    expect(config.options).toEqual({ darkMode: "media", prefix: "mi-" });
  });

  test("accepts number tokens", () => {
    const config = defineConfig({ theme: { spacing: { 1: 4 } } });
    expect(config.theme?.spacing).toEqual({ 1: 4 });
  });

  test("throws on invalid token type", () => {
    expect(() =>
      defineConfig({ theme: { colors: { blue: 123 } } }),
    ).toThrow(/invalid config/);
  });

  test("throws on unknown top-level key", () => {
    expect(() =>
      defineConfig({ themee: {} } as never),
    ).toThrow(/invalid config/);
  });

  test("throws on unknown key inside a theme group", () => {
    expect(() =>
      defineConfig({ theme: { spacings: {} } } as never),
    ).toThrow(/invalid config/);
  });

  test("throws on invalid options", () => {
    expect(() =>
      defineConfig({ options: { darkMode: "always" } } as never),
    ).toThrow(/invalid config/);
  });

  test("throws on non-string boxShadow value", () => {
    expect(() =>
      defineConfig({ theme: { boxShadow: { sm: 42 } } } as never),
    ).toThrow(/invalid config/);
  });
});

describe("resolveConfig — defaults", () => {
  test("resolves defaults when called with nothing", () => {
    const resolved = resolveDefaultConfig();
    expect(resolved.theme.spacing["1"]).toBe("4px"); // 4px base
    expect(resolved.theme.spacing["4"]).toBe("16px");
    expect(resolved.theme.breakpoints.md).toBe("768px");
    expect(resolved.theme.fontSize.base).toBe("16px");
    expect(resolved.theme.borderRadius.DEFAULT).toBe("4px");
  });

  test("flattens nested default colors", () => {
    const resolved = resolveDefaultConfig();
    expect(resolved.theme.colors["blue-500"]).toBe("#3b82f6");
    expect(resolved.theme.colors["red-500"]).toBe("#ef4444");
    expect(resolved.theme.colors.black).toBe("#000000");
  });

  test("does not mutate the shared default theme", () => {
    const before = JSON.stringify(defaultTheme);
    resolveConfig({
      extend: { theme: { colors: { brand: "#6d28d9" } } },
    });
    expect(JSON.stringify(defaultTheme)).toBe(before);
  });
});

describe("resolveConfig — replace vs extend semantics", () => {
  test("theme.* replaces the whole group", () => {
    const resolved = resolveConfig({
      theme: { spacing: { 1: "8px", 2: "16px" } },
    });
    // default steps are gone
    expect(resolved.theme.spacing["4"]).toBeUndefined();
    expect(resolved.theme.spacing["1"]).toBe("8px");
    // untouched groups keep defaults
    expect(resolved.theme.breakpoints.md).toBe("768px");
  });

  test("extend.theme.* deep-merges, keeping defaults", () => {
    const resolved = resolveConfig({
      extend: { theme: { spacing: { 18: "72px" } } },
    });
    expect(resolved.theme.spacing["18"]).toBe("72px");
    expect(resolved.theme.spacing["4"]).toBe("16px"); // default preserved
  });

  test("extend merges nested colors", () => {
    const resolved = resolveConfig({
      extend: { theme: { colors: { brand: { 500: "#6d28d9" } } } },
    });
    expect(resolved.theme.colors["brand-500"]).toBe("#6d28d9");
    expect(resolved.theme.colors["blue-500"]).toBe("#3b82f6"); // default preserved
  });

  test("extend applies on top of user theme", () => {
    const resolved = resolveConfig({
      theme: { colors: { brand: "#6d28d9" } }, // replaces palette
      extend: { theme: { colors: { accent: "#f59e0b" } } },
    });
    expect(resolved.theme.colors.brand).toBe("#6d28d9");
    expect(resolved.theme.colors.accent).toBe("#f59e0b");
    // default palette replaced by theme.colors, so gone
    expect(resolved.theme.colors["blue-500"]).toBeUndefined();
  });

  test("merge result is not shared between calls", () => {
    const a = resolveConfig({ extend: { theme: { colors: { x: "#111" } } } });
    const b = resolveConfig({});
    expect(b.theme.colors.x).toBeUndefined();
    expect(a.theme.colors.x).toBe("#111");
  });
});

describe("flattenColors", () => {
  test("flattens nested shades", () => {
    const flat = flattenColors({ blue: { 500: "#3b82f6", 600: "#2563eb" } });
    expect(flat).toEqual({
      "blue-500": "#3b82f6",
      "blue-600": "#2563eb",
    });
  });

  test("maps nested DEFAULT key to the parent name", () => {
    const flat = flattenColors({
      primary: { DEFAULT: "#6d28d9", 600: "#5b21b6" },
    });
    expect(flat["primary"]).toBe("#6d28d9");
    expect(flat["primary-600"]).toBe("#5b21b6");
  });

  test("flattens deeper nesting", () => {
    const flat = flattenColors({
      brand: { dark: { 100: "#111" } },
    });
    expect(flat["brand-dark-100"]).toBe("#111");
  });

  test("keeps flat values as-is", () => {
    const flat = flattenColors({ white: "#fff", current: "currentColor" });
    expect(flat).toEqual({ white: "#fff", current: "currentColor" });
  });
});

describe("defaults sanity", () => {
  test("spacing is 4px based", () => {
    expect(defaultTheme.spacing?.["1"]).toBe("4px");
    expect(defaultTheme.spacing?.["0.5"]).toBe("2px");
  });

  test("has breakpoints and a full palette", () => {
    expect(Object.keys(defaultTheme.breakpoints ?? {})).toContain("lg");
    expect(Object.keys(defaultTheme.colors ?? {})).toContain("blue");
  });

  test("resolveConfig with user options overrides defaults", () => {
    const resolved = resolveConfig({
      options: { darkMode: "class", prefix: "mi-" },
    });
    expect(resolved.options).toEqual({ darkMode: "class", prefix: "mi-" });
  });
});
