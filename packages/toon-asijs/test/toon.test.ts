import { describe, expect, test } from "bun:test";
import {
  createToonFormat,
  getToonFormat,
  TOON_CONTENT_TYPE,
  TOON_CONTENT_TYPES,
  TOON_EXTENSIONS,
} from "../src/index";
import type { ToonFormat } from "../src/index";

// ========================================================================
// Format metadata
// ========================================================================

describe("createToonFormat — metadata", () => {
  test("exposes the expected name, MIME types and extensions", () => {
    const fmt = createToonFormat();
    expect(fmt.name).toBe("toon");
    expect(fmt.contentTypes).toEqual(["application/toon", "text/toon", "application/x-toon"]);
    expect(fmt.contentType).toBe("application/toon");
    expect(fmt.extensions).toEqual([".toon"]);
  });

  test("constants match the format", () => {
    expect(TOON_CONTENT_TYPE).toBe("application/toon");
    expect(TOON_CONTENT_TYPES).toContain("application/toon");
    expect(TOON_EXTENSIONS).toEqual([".toon"]);
  });

  test("implements the full DataFormat contract (sync parse/serialize)", () => {
    const fmt = createToonFormat();
    expect(typeof fmt.parse).toBe("function");
    expect(typeof fmt.serialize).toBe("function");
    // A hand-written TOON document parses to a plain object.
    const parsed = fmt.parse("name: Ada\nage: 30\n") as Record<string, unknown>;
    expect(parsed.name).toBe("Ada");
    expect(parsed.age).toBe(30);
  });
});

// ========================================================================
// Round-trips
// ========================================================================

describe("createToonFormat — round-trip", () => {
  const cases: Array<[string, unknown]> = [
    ["flat object", { name: "Ada", age: 30, active: true }],
    ["nested object", { user: { id: 1, profile: { city: "Kyiv", tags: ["a", "b"] } } }],
    ["array of objects (tabular)", { items: [{ sku: "A1", qty: 2 }, { sku: "B2", qty: 1 }] }],
    ["primitives", { null: null, zero: 0, neg: -1.5, str: "hello", empty: "" }],
    ["strings that look like numbers stay strings", { code: "30", version: "1.4.1" }],
    ["empty containers", { arr: [], obj: {} }],
  ];

  for (const [label, value] of cases) {
    test(`round-trips ${label}`, () => {
      const fmt = createToonFormat();
      const wire = fmt.serialize(value);
      expect(typeof wire).toBe("string");
      expect(wire.length).toBeGreaterThan(0);
      // Deep-equality against the normalized value (JSON-safe values round-trip losslessly).
      expect(JSON.parse(JSON.stringify(fmt.parse(wire)))).toEqual(JSON.parse(JSON.stringify(value)));
    });
  }

  test("serializes keys without quotes and uses indentation instead of braces", () => {
    const fmt = createToonFormat();
    const wire = fmt.serialize({ hello: "world", nested: { a: 1 } });
    expect(wire).toContain("hello:");
    expect(wire).toContain("nested:");
    expect(wire).toContain("a: 1");
    expect(wire).not.toContain("{");
  });

  test("uses tabular form for uniform arrays (token-efficient)", () => {
    const fmt = createToonFormat();
    const wire = fmt.serialize({ items: [{ sku: "A1", qty: 2 }, { sku: "B2", qty: 1 }] });
    // Header declares length + fields; rows are delimiter-separated — much cheaper than JSON.
    expect(wire).toContain("items[2]{sku,qty}:");
    expect(wire).toContain("A1,2");
    expect(wire).toContain("B2,1");
  });

  test("round-trip survives JSON re-serialization (plain JS objects only)", () => {
    const fmt = createToonFormat();
    const original = { users: [{ id: 1, name: "Ada" }, { id: 2, name: "Bob" }] };
    const parsed = fmt.parse(fmt.serialize(original)) as typeof original;
    expect(Array.isArray(parsed.users)).toBe(true);
    expect(parsed.users[0]).toEqual({ id: 1, name: "Ada" });
    expect(parsed.users[1]).toEqual({ id: 2, name: "Bob" });
  });
});

// ========================================================================
// Options passthrough
// ========================================================================

describe("createToonFormat — options", () => {
  test("indentSize changes indentation width", () => {
    const fmt = createToonFormat({ indentSize: 4 });
    const wire = fmt.serialize({ a: { b: 1 } });
    expect(wire).toContain("    b: 1"); // 4 spaces
  });

  test("delimiter switches tabular rows to the chosen separator", () => {
    const fmt = createToonFormat({ delimiter: "\t" });
    const wire = fmt.serialize({ items: [{ a: 1 }, { a: 2 }] });
    expect(wire).toContain("\t");
  });

  test("strict:false tolerates duplicate keys (last-write-wins)", () => {
    const fmt = createToonFormat({ strict: false });
    const parsed = fmt.parse("a: 1\na: 2\n") as Record<string, unknown>;
    expect(parsed.a).toBe(2);
  });

  test("strict mode (default) rejects duplicate keys", () => {
    const fmt = createToonFormat();
    expect(() => fmt.parse("a: 1\na: 2\n")).toThrow();
  });

  test("options are optional — defaults produce valid TOON", () => {
    const fmt = createToonFormat();
    const wire = fmt.serialize({ list: [1, 2, 3] });
    expect(fmt.parse(wire)).toEqual({ list: [1, 2, 3] });
  });
});

// ========================================================================
// Errors
// ========================================================================

describe("createToonFormat — errors", () => {
  test("throws a SyntaxError-compatible error on malformed input", () => {
    const fmt = createToonFormat();
    // Tabular header declares 2 rows but only 1 is present → strict decoder
    // throws ToonDecodeError, which extends SyntaxError.
    expect(() => fmt.parse("items[2]{a}:\n  A1\n")).toThrow(SyntaxError);
  });

  test("throws on invalid escape sequences in strict mode", () => {
    const fmt = createToonFormat();
    expect(() => fmt.parse('a: "bad \\x escape"')).toThrow();
  });
});

// ========================================================================
// Cached singleton
// ========================================================================

describe("getToonFormat — cached singleton", () => {
  test("returns the same instance across calls", () => {
    expect(getToonFormat()).toBe(getToonFormat());
  });

  test("is an instanceof-compatible ToonFormat", () => {
    const fmt = getToonFormat();
    expect((fmt as ToonFormat).name).toBe("toon");
  });
});
