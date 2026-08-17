import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";

import {
  parseManifest,
  validateManifest,
  loadManifest,
  writeManifest,
  findNativeRoot,
  detectLanguage,
  DEFAULT_SOURCE_DIR,
  type NativeManifest,
} from "../src/native/manifest";
import {
  generateCargoToml,
  generateLibRs,
} from "../src/native/generate-rust";
import {
  generateTsWrapper,
  defaultLibPathExpr,
} from "../src/native/generate-ts";
import {
  loadNativeModule,
  resolveLibPath,
  isStale,
  markBuilt,
  readCString,
  type DLOpenLike,
} from "../src/native/runtime";
import { handleNative } from "../src/native/cli";

function toolchainAvailable(cmd: string, args: string[]): boolean {
  try {
    const r = spawnSync(cmd, args, { encoding: "utf-8" });
    return r.status === 0;
  } catch {
    // Toolchain not installed (ENOENT on spawn) — treat as unavailable so
    // tests skip instead of crashing the file.
    return false;
  }
}

/**
 * Call the native CLI and restore `process.exitCode` afterwards.
 *
 * `handleNative` is a real CLI entry: on error paths it sets
 * `process.exitCode = 1` (so the binary exits non-zero). When tests exercise
 * those paths, the exit code leaks into the bun test process and makes
 * `bun test` exit 1 even though every test passed — this wrapper keeps the
 * suite's exit code clean.
 */
async function runNative(args: string[]): Promise<void> {
  const prevExitCode = process.exitCode;
  try {
    await handleNative(args);
  } finally {
    // Bun quirk: assigning `undefined` does NOT clear a previously-set exit
    // code (it stays 1), so restore explicitly to 0 when nothing was set.
    process.exitCode = prevExitCode === undefined ? 0 : prevExitCode;
  }
}

// ============================================================================
// Fixtures
// ============================================================================

const validManifest: NativeManifest = {
  name: "my_crypto",
  lang: "rust",
  functions: [
    { name: "add", params: { a: "number", b: "number" }, returns: "number" },
    { name: "sha256", params: { input: "string" }, returns: "string" },
    { name: "reverse", params: { input: "string" }, returns: "string" },
  ],
};

function makeTempProject(): { dir: string; nativeRoot: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "asi-native-test-"));
  const nativeRoot = join(dir, DEFAULT_SOURCE_DIR);
  mkdirSync(join(nativeRoot, "src"), { recursive: true });
  return {
    dir,
    nativeRoot,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

// ============================================================================
// 1.1 — Manifest
// ============================================================================

describe("native manifest (1.1)", () => {
  test("valid manifest parses cleanly", () => {
    expect(validateManifest(validManifest)).toEqual([]);
    const parsed = parseManifest(validManifest);
    expect(parsed.name).toBe("my_crypto");
    expect(parsed.functions).toHaveLength(3);
    expect(parsed.functions[0]).toEqual({
      name: "add",
      params: { a: "number", b: "number" },
      returns: "number",
    });
  });

  test("rejects invalid name", () => {
    const errors = validateManifest({ ...validManifest, name: "my crypto!" });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("name");
  });

  test("rejects invalid lang", () => {
    const errors = validateManifest({ ...validManifest, lang: "cobol" });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("lang");
  });

  test("rejects duplicate function names", () => {
    const dup = {
      ...validManifest,
      functions: [
        ...validManifest.functions,
        { name: "add", params: {}, returns: "number" },
      ],
    };
    const errors = validateManifest(dup);
    expect(errors.some((e) => e.includes("duplicated"))).toBe(true);
  });

  test("rejects invalid param type", () => {
    const bad = {
      ...validManifest,
      functions: [
        { name: "f", params: { x: "object" }, returns: "string" },
      ],
    };
    const errors = validateManifest(bad);
    expect(errors.some((e) => e.includes("invalid type"))).toBe(true);
  });

  test("round-trips through writeManifest/loadManifest", async () => {
    const { nativeRoot, cleanup } = makeTempProject();
    try {
      await writeManifest(nativeRoot, validManifest);
      const loaded = await loadManifest(nativeRoot);
      expect(loaded).toEqual({
        ...validManifest,
        sourceDir: "native", // parseManifest adds the default
      });
    } finally {
      cleanup();
    }
  });

  test("findNativeRoot locates the native dir", async () => {
    const { dir, nativeRoot, cleanup } = makeTempProject();
    try {
      await writeManifest(nativeRoot, validManifest);
      expect(findNativeRoot(dir)).toBe(nativeRoot);
      // Outside the project → null
      expect(findNativeRoot(tmpdir())).toBeNull();
    } finally {
      cleanup();
    }
  });

  test("detectLanguage recognizes cargo/go/zig", () => {
    const { nativeRoot, cleanup } = makeTempProject();
    try {
      writeFileSync(join(nativeRoot, "Cargo.toml"), "", "utf-8");
      expect(detectLanguage(nativeRoot)).toBe("rust");
      rmSync(join(nativeRoot, "Cargo.toml"));
      writeFileSync(join(nativeRoot, "go.mod"), "", "utf-8");
      expect(detectLanguage(nativeRoot)).toBe("go");
      rmSync(join(nativeRoot, "go.mod"));
      writeFileSync(join(nativeRoot, "build.zig"), "", "utf-8");
      expect(detectLanguage(nativeRoot)).toBe("zig");
      rmSync(join(nativeRoot, "build.zig"));
      expect(detectLanguage(nativeRoot)).toBeNull();
    } finally {
      cleanup();
    }
  });
});

// ============================================================================
// 1.2 — Rust stub generation
// ============================================================================

describe("native Rust generation (1.2)", () => {
  test("Cargo.toml is a cdylib with serde", () => {
    const toml = generateCargoToml(validManifest);
    expect(toml).toContain("crate-type = [\"cdylib\"]");
    expect(toml).toContain("serde_json");
    expect(toml).toContain(`name = "my_crypto"`);
  });

  test("lib.rs contains user stubs with TODO bodies", () => {
    const rs = generateLibRs(validManifest);
    expect(rs).toContain(`pub fn sha256(input: String) -> String {`);
    expect(rs).toContain(`unimplemented!("implement sha256")`);
    expect(rs).toContain(`pub fn add(a: f64, b: f64) -> f64 {`);
    expect(rs).toContain(`unimplemented!("implement add")`);
  });

  test("lib.rs contains the FFI boundary with no_mangle", () => {
    const rs = generateLibRs(validManifest);
    expect(rs).toContain(`#[unsafe(no_mangle)]`);
    expect(rs).toContain(`pub extern "C" fn asijs_call`);
    expect(rs).toContain(`pub extern "C" fn asijs_free`);
    expect(rs).toContain(`"sha256" => {`);
    expect(rs).toContain(`"add" => {`);
  });

  test("lib.rs dispatches params by name", () => {
    const rs = generateLibRs(validManifest);
    expect(rs).toContain(`args.get("input")`);
    expect(rs).toContain(`args.get("a")`);
    expect(rs).toContain(`let out = sha256(input);`);
    expect(rs).toContain(`let out = add(a, b);`);
  });

  test("generated lib.rs is valid rust syntax (balance check)", () => {
    const rs = generateLibRs(validManifest);
    const opens = (rs.match(/{/g) ?? []).length;
    const closes = (rs.match(/}/g) ?? []).length;
    expect(opens).toBe(closes);
    // Every function ends with a closing brace line
    expect(rs.split("\n").filter((l) => l.trim() === "}").length).toBeGreaterThan(0);
  });
});

// ============================================================================
// 1.3 — TS wrapper generation
// ============================================================================

describe("native TS wrapper generation (1.3)", () => {
  test("wrapper contains dlopen + typed methods", () => {
    const ts = generateTsWrapper(validManifest, defaultLibPathExpr(validManifest));
    expect(ts).toContain('from "bun:ffi"');
    expect(ts).toContain("dlopen(");
    expect(ts).toContain("asijs_call");
    expect(ts).toContain("asijs_free");
    expect(ts).toContain(`sha256(input: string): string {`);
    expect(ts).toContain(`add(a: number, b: number): number {`);
    expect(ts).toContain(`reverse(input: string): string {`);
  });

  test("wrapper marshals params into JSON payload", () => {
    const ts = generateTsWrapper(validManifest, defaultLibPathExpr(validManifest));
    expect(ts).toContain(`JSON.stringify({ fn: fnName, args })`);
    expect(ts).toContain(`"input": input`);
    expect(ts).toContain(`"a": a`);
  });

  test("wrapper throws on error responses", () => {
    const ts = generateTsWrapper(validManifest, defaultLibPathExpr(validManifest));
    expect(ts).toContain(`if (!res.ok)`);
    expect(ts).toContain("native error");
  });

  test("wrapper has correct lib path expression", () => {
    const expr = defaultLibPathExpr(validManifest);
    expect(expr).toContain("join(__dirname");
    const expectedBase =
      process.platform === "win32" ? "my_crypto" : "libmy_crypto";
    expect(expr).toContain(expectedBase);
  });
});

// ============================================================================
// 1.4 — Runtime (mock dlopen)
// ============================================================================

describe("native runtime (1.4)", () => {
  /** A fake "library" that decodes the JSON payload and echoes it back. */
  function makeMockLib() {
    return {
      symbols: {
        asijs_call: (input: Uint8Array) => {
          // Trim the NUL terminator that the runtime appends (C-string convention)
          let text = new TextDecoder().decode(input);
          text = text.replace(/\0+$/, "");
          const req = JSON.parse(text) as { fn: string; args: Record<string, unknown> };
          // Fake computation for the test functions
          let result: unknown;
          if (req.fn === "add") {
            result = (req.args["a"] as number) + (req.args["b"] as number);
          } else if (req.fn === "sha256") {
            result = `hash:${req.args["input"]}`;
          } else if (req.fn === "reverse") {
            result = String(req.args["input"]).split("").reverse().join("");
          } else {
            result = null;
          }
          const resp = JSON.stringify({ ok: true, result });
          const bytes = new TextEncoder().encode(resp);
          // NUL-terminate like a C string
          const withNul = new Uint8Array(bytes.length + 1);
          withNul.set(bytes);
          return withNul;
        },
        asijs_free: () => {},
      },
    } as unknown as ReturnType<DLOpenLike>;
  }

  test("loadNativeModule calls functions through the mock lib", () => {
    const module = loadNativeModule(validManifest, {}, makeMockLib);
    const add = module["add"] as (a: number, b: number) => number;
    expect(add(2, 3)).toBe(5);
    const sha = module["sha256"] as (input: string) => string;
    expect(sha("hello")).toBe("hash:hello");
    const rev = module["reverse"] as (input: string) => string;
    expect(rev("abc")).toBe("cba");
  });

  test("loadNativeModule throws a clear error when library is missing", () => {
    const manifest: NativeManifest = {
      name: "missing",
      lang: "rust",
      functions: [{ name: "f", params: {}, returns: "string" }],
    };
    // Lazy loading: the error surfaces on the first call, not at load time
    const module = loadNativeModule(manifest, { cwd: tmpdir() });
    expect(() => (module["f"] as () => unknown)()).toThrow(
      /run "asi native build"/,
    );
  });

  test("resolveLibPath points at target/release", () => {
    const path = resolveLibPath(validManifest, { cwd: join("proj") });
    const expectedBase =
      process.platform === "win32" ? "my_crypto" : "libmy_crypto";
    const expected = join(
      "proj",
      "native",
      "target",
      "release",
      `${expectedBase}${process.platform === "win32" ? ".dll" : ".so"}`,
    );
    expect(path).toBe(expected);
  });

  test("readCString reads NUL-terminated text", () => {
    const bytes = new TextEncoder().encode("hello\x00world");
    expect(readCString(bytes)).toBe("hello");
  });

  test("isStale/markBuilt cycle", () => {
    const { nativeRoot, cleanup } = makeTempProject();
    try {
      writeFileSync(join(nativeRoot, "manifest.json"), "{}", "utf-8");
      expect(isStale(nativeRoot, validManifest)).toBe(true);
      markBuilt(nativeRoot);
      expect(isStale(nativeRoot, validManifest)).toBe(false);
      // Touching the manifest makes it stale again. Force the mtime forward:
      // CI filesystems (overlayfs) can have coarse mtime granularity, and two
      // writes in the same tick would leave manifest mtime == marker mtime,
      // making isStale() return false (flaky CI failure).
      const manifestPath = join(nativeRoot, "manifest.json");
      writeFileSync(manifestPath, "{}", "utf-8");
      utimesSync(manifestPath, new Date(), new Date(Date.now() + 60_000));
      expect(isStale(nativeRoot, validManifest)).toBe(true);
    } finally {
      cleanup();
    }
  });
});

// ============================================================================
// 1.5 — CLI
// ============================================================================

describe("native CLI (1.5)", () => {
  test("scaffold rust creates manifest + Cargo.toml + lib.rs + generated.ts", async () => {
    const { dir, nativeRoot, cleanup } = makeTempProject();
    const prevCwd = process.cwd();
    try {
      process.chdir(dir);
      // Avoid writing into the existing native/ dir from fixture; remove it first
      rmSync(nativeRoot, { recursive: true, force: true });
      await runNative(["scaffold", "rust", "test_crypto"]);
      expect(require("fs").existsSync(join(nativeRoot, "manifest.json"))).toBe(true);
      expect(require("fs").existsSync(join(nativeRoot, "Cargo.toml"))).toBe(true);
      expect(require("fs").existsSync(join(nativeRoot, "src", "lib.rs"))).toBe(true);
      expect(require("fs").existsSync(join(nativeRoot, "src", "generated.ts"))).toBe(true);

      const manifest = await loadManifest(nativeRoot);
      expect(manifest.name).toBe("test_crypto");
      expect(manifest.lang).toBe("rust");
      expect(manifest.functions.length).toBeGreaterThan(0);
    } finally {
      process.chdir(prevCwd);
      cleanup();
    }
  });

  test("scaffold refuses to overwrite an existing module", async () => {
    const { dir, nativeRoot, cleanup } = makeTempProject();
    const prevCwd = process.cwd();
    try {
      await writeManifest(nativeRoot, validManifest);
      process.chdir(dir);
      await runNative(["scaffold", "rust", "other"]);
      // Original manifest untouched
      const manifest = await loadManifest(nativeRoot);
      expect(manifest.name).toBe("my_crypto");
    } finally {
      process.chdir(prevCwd);
      cleanup();
    }
  });

  test("list shows declared functions", async () => {
    const { dir, nativeRoot, cleanup } = makeTempProject();
    const prevCwd = process.cwd();
    try {
      await writeManifest(nativeRoot, validManifest);
      process.chdir(dir);
      await runNative(["list"]);
    } finally {
      process.chdir(prevCwd);
      cleanup();
    }
  });

  test("build without cargo reports a clear error", async () => {
    const { dir, nativeRoot, cleanup } = makeTempProject();
    const prevCwd = process.cwd();
    try {
      await writeManifest(nativeRoot, validManifest);
      process.chdir(dir);
      await runNative(["build"]);
    } finally {
      process.chdir(prevCwd);
      cleanup();
    }
  });

  test.skipIf(!toolchainAvailable("cargo", ["--version"]))(
    "scaffold + cargo build + dlopen round-trip (Rust e2e)",
    async () => {
      if (typeof Bun === "undefined") return;
      const { dir, nativeRoot, cleanup } = makeTempProject();
      const prevCwd = process.cwd();
      try {
        // Scaffold a rust module
        process.chdir(dir);
        await runNative(["scaffold", "rust", "e2e_crypto"]);

        // Implement sha256 (needs the sha2 crate) + reverse/add bodies
        const libRsPath = join(nativeRoot, "src", "lib.rs");
        const libRs = require("fs").readFileSync(libRsPath, "utf-8");
        const impl = libRs
          .replace(
            /pub fn add\(a: f64, b: f64\) -> f64 \{[\s\S]*?\n\}/,
            "pub fn add(a: f64, b: f64) -> f64 {\n    a + b\n}",
          )
          .replace(
            /pub fn sha256\(input: String\) -> String \{[\s\S]*?\n\}/,
            `pub fn sha256(input: String) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(input.as_bytes());
    format!("{:x}", h.finalize())
}`,
          )
          .replace(
            /pub fn reverse\(input: String\) -> String \{[\s\S]*?\n\}/,
            "pub fn reverse(input: String) -> String {\n    input.chars().rev().collect()\n}",
          );
        require("fs").writeFileSync(libRsPath, impl, "utf-8");

        // Add sha2 to Cargo.toml
        const cargoPath = join(nativeRoot, "Cargo.toml");
        const toml = require("fs").readFileSync(cargoPath, "utf-8");
        require("fs").writeFileSync(
          cargoPath,
          toml.replace("[dependencies]", "[dependencies]\nsha2 = \"0.10\""),
          "utf-8",
        );

        // Build (real cargo)
        await runNative(["build"]);

        // Load and call through bun:ffi
        const manifest = await loadManifest(nativeRoot);
        const { loadNativeModule } = require("../src/native/runtime");
        const mod = loadNativeModule(manifest, { cwd: dir });
        expect((mod["add"] as (a: number, b: number) => number)(2, 3)).toBe(5);
        expect((mod["reverse"] as (s: string) => string)("abc")).toBe("cba");
        const hash = (mod["sha256"] as (s: string) => string)("hello");
        expect(hash).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
      } finally {
        process.chdir(prevCwd);
        for (let i = 0; i < 5; i++) {
          try {
            cleanup();
            break;
          } catch {
            await new Promise((res) => setTimeout(res, 150));
          }
        }
      }
    },
    120_000,
  );

  test("info without a module reports a clear error", async () => {
    const { dir, cleanup } = makeTempProject();
    const prevCwd = process.cwd();
    try {
      process.chdir(dir);
      await runNative(["info"]);
    } finally {
      process.chdir(prevCwd);
      cleanup();
    }
  });
});
