import { describe, expect, test } from "bun:test";

import { VERSION } from "../src/core";
import { asiPlugin } from "../src/asi";

describe("miyocss package skeleton", () => {
  test("core exports a version", () => {
    expect(typeof VERSION).toBe("string");
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("asi adapter stub documents the planned API", () => {
    expect(() => asiPlugin()).toThrow(/P0\.6/);
  });

  test("svg module imports cleanly", async () => {
    const svg = await import("../src/svg");
    expect(typeof svg).toBe("object");
  });

  test("main entry re-exports the core", async () => {
    const entry = await import("../src/index");
    expect(entry.VERSION).toBe(VERSION);
  });
});
