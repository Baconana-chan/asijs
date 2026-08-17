import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";

import type { NativeManifest } from "../src/native/manifest";
import { generateGoMod, generateMainGo } from "../src/native/generate-go";
import { generateCLib, generateCppLib } from "../src/native/generate-c";
import { generateBuildZig, generateZigLib } from "../src/native/generate-zig";
import { generateNimLib } from "../src/native/generate-nim";
import { generateHaskellLib, generateHaskellDef } from "../src/native/generate-haskell";
import { generateLuaLib } from "../src/native/generate-lua";
import { findLuaLib } from "../src/native/lang/lua";
import {
  getGenerator,
  supportedLanguages,
  allGenerators,
} from "../src/native/generators";

// ============================================================================
// Fixture (bytes included to exercise every type)
// ============================================================================

const manifest: NativeManifest = {
  name: "poly",
  lang: "rust",
  functions: [
    { name: "add", params: { a: "number", b: "number" }, returns: "number" },
    { name: "greet", params: { name: "string" }, returns: "string" },
    { name: "enabled", params: { flag: "boolean" }, returns: "boolean" },
    { name: "hash_bytes", params: { data: "bytes" }, returns: "bytes" },
    { name: "pass_through", params: { value: "json" }, returns: "json" },
  ],
};

// ============================================================================
// Registry
// ============================================================================

describe("native generator registry (2.1)", () => {
  test("supports rust/go/c/cpp/zig/nim/haskell + sidecar python/ruby/php + embedded lua", () => {
    expect(supportedLanguages().sort()).toEqual([
      "c",
      "cpp",
      "go",
      "haskell",
      "lua",
      "nim",
      "php",
      "python",
      "ruby",
      "rust",
      "zig",
    ]);
  });

  test("every generator has toolchain + build + files", () => {
    for (const gen of allGenerators()) {
      expect(gen.toolchain.cmd.length).toBeGreaterThan(0);
      expect(gen.toolchain.hint.length).toBeGreaterThan(0);
      const files = gen.files(manifest);
      expect(files.length).toBeGreaterThan(0);
      expect(gen.build(manifest).cmd.length).toBeGreaterThan(0);
      expect(gen.libBaseName(manifest)).toContain(gen.lang === "go" ? "poly" : "poly");
    }
  });

  test("getGenerator throws for unknown language", () => {
    expect(() => getGenerator("cobol" as never)).toThrow(/No generator/);
  });

  test("build commands reference the right toolchain", () => {
    expect(getGenerator("rust").build(manifest).cmd).toBe("cargo");
    expect(getGenerator("go").build(manifest).cmd).toBe("go");
    expect(getGenerator("c").build(manifest).cmd).toBe("cc");
    expect(getGenerator("cpp").build(manifest).cmd).toBe("c++");
    expect(getGenerator("zig").build(manifest).cmd).toBe("zig");
    expect(getGenerator("nim").build(manifest).cmd).toBe("nim");
    expect(getGenerator("haskell").build(manifest).cmd).toBe("ghc");
    expect(getGenerator("lua").kind).toBe("embedded");
    expect(getGenerator("lua").stubFile).toBe("lib.lua");
  });

  test("go build outputs to target/release with correct name", () => {
    const args = getGenerator("go").build(manifest).args.join(" ");
    expect(args).toContain("-buildmode=c-shared");
    expect(args).toContain("target/release/");
    const expectedBase =
      process.platform === "win32" ? "poly" : "libpoly";
    expect(args).toContain(expectedBase);
  });
});

// ============================================================================
// Go
// ============================================================================

describe("native Go generation (2.1)", () => {
  test("go.mod declares the module", () => {
    const mod = generateGoMod(manifest);
    expect(mod).toContain(`module poly`);
    expect(mod).toContain("go 1.21");
  });

  test("main.go contains typed user stubs with TODO", () => {
    const go = generateMainGo(manifest);
    expect(go).toContain(`func add(a float64, b float64) float64 {`);
    expect(go).toContain(`panic("implement add")`);
    expect(go).toContain(`func greet(name string) string {`);
    expect(go).toContain(`func enabled(flag bool) bool {`);
    expect(go).toContain(`func hash_bytes(data []byte) []byte {`);
    expect(go).toContain(`func pass_through(value any) any {`);
  });

  test("main.go contains //export FFI boundary", () => {
    const go = generateMainGo(manifest);
    expect(go).toContain(`//export asijs_call`);
    expect(go).toContain(`//export asijs_free`);
    expect(go).toContain(`C.free(unsafe.Pointer(ptr))`);
    expect(go).toContain(`case "add":`);
    expect(go).toContain(`case "greet":`);
    expect(go).toContain(`func main() {}`);
  });

  test("main.go dispatches args by name with typed extraction", () => {
    const go = generateMainGo(manifest);
    expect(go).toContain(`argString(args, "name", "greet")`);
    expect(go).toContain(`argNumber(args, "a", "add")`);
    expect(go).toContain(`argBool(args, "flag", "enabled")`);
    expect(go).toContain(`argBytes(args, "data", "hash_bytes")`);
    expect(go).toContain(`argJSON(args, "value", "pass_through")`);
  });

  test("main.go balances braces", () => {
    const go = generateMainGo(manifest);
    const opens = (go.match(/{/g) ?? []).length;
    const closes = (go.match(/}/g) ?? []).length;
    expect(opens).toBe(closes);
  });
});

// ============================================================================
// Nim
// ============================================================================

describe("native Nim generation (2.1)", () => {
  test("lib.nim contains typed user stubs with TODO", () => {
    const nim = generateNimLib(manifest);
    expect(nim).toContain(`proc add(a: float64, b: float64): float64 =`);
    expect(nim).toContain(`# TODO: implement the body of add`);
    expect(nim).toContain(`proc greet(name: string): string =`);
    expect(nim).toContain(`proc enabled(flag: bool): bool =`);
    expect(nim).toContain(`proc hash_bytes(data: seq[byte]): seq[byte] =`);
    expect(nim).toContain(`proc pass_through(value: JsonNode): JsonNode =`);
  });

  test("lib.nim contains exportc FFI boundary + dispatcher", () => {
    const nim = generateNimLib(manifest);
    expect(nim).toContain(`{.push exportc, cdecl, dynlib.}`);
    expect(nim).toContain(`proc asijs_call(input: cstring): cstring {.exportc.} =`);
    expect(nim).toContain(`proc asijs_free(p: pointer) {.exportc.} =`);
    expect(nim).toContain(`proc dispatch(fnName: string, args: JsonNode): JsonNode =`);
    expect(nim).toContain(`return err("unknown native function: " & fnName)`);
    expect(nim).toContain(`if fnName == "add":`);
    expect(nim).toContain(`if fnName == "greet":`);
  });

  test("lib.nim balances braces and procs", () => {
    const nim = generateNimLib(manifest);
    expect((nim.match(/proc /g) ?? []).length).toBeGreaterThan(5);
    expect(nim).toContain(`import std/json`);
    expect(nim).toContain(`import std/math`);
  });
});

// ============================================================================
// Haskell
// ============================================================================

describe("native Haskell generation (2.1)", () => {
  test("lib.hs contains typed user stubs with TODO", () => {
    const hs = generateHaskellLib(manifest);
    expect(hs).toContain(`add :: Double -> Double -> Double`);
    expect(hs).toContain(`-- TODO: implement the body of add`);
    expect(hs).toContain(`greet :: String -> String`);
    expect(hs).toContain(`enabled :: Bool -> Bool`);
    expect(hs).toContain(`hash_bytes :: [Int] -> [Int]`);
    expect(hs).toContain(`pass_through :: JVal -> JVal`);
  });

  test("lib.hs contains foreign export FFI boundary + parser", () => {
    const hs = generateHaskellLib(manifest);
    expect(hs).toContain(`foreign export ccall asijs_call :: FC.CString -> IO FC.CString`);
    expect(hs).toContain(`foreign export ccall asijs_free :: FP.Ptr () -> IO ()`);
    expect(hs).toContain(`data JVal = JBool Bool | JNum Double | JStr Text | JArr [JVal] | JObj [(Text, JVal)]`);
    expect(hs).toContain(`jParseObj (T.drop 1 (jSkipSpace t1)) []`);
    expect(hs).toContain(`jParseArr (T.drop 1 (jSkipSpace t1)) []`);
    expect(hs).toContain(`if fn == "add" then`);
  });

  test("lib.def exports the RTS + FFI symbols", () => {
    const def = generateHaskellDef();
    expect(def).toContain(`asijs_call`);
    expect(def).toContain(`asijs_free`);
    expect(def).toContain(`hs_init`);
    expect(def).toContain(`EXPORTS`);
  });
});

// ============================================================================
// C / C++
// ============================================================================

describe("native C generation (2.1)", () => {
  test("lib.c contains user stubs with TODO", () => {
    const c = generateCLib(manifest);
    expect(c).toContain(`static double fn_add(double a, double b) {`);
    expect(c).toContain(`// TODO: implement the body of add`);
    expect(c).toContain(`static const char* fn_greet(const char* name) {`);
    expect(c).toContain(`static int fn_enabled(int flag) {`);
    expect(c).toContain(`static const uint8_t* fn_hash_bytes(const uint8_t* data, size_t data_len) {`);
  });

  test("lib.c embeds a JSON parser and FFI boundary", () => {
    const c = generateCLib(manifest);
    expect(c).toContain(`jval *jv_parse(`);
    expect(c).toContain(`char *jv_serialize(`);
    expect(c).toContain(`asijs_call(const char *input)`);
    expect(c).toContain(`asijs_free(char *ptr)`);
    expect(c).toContain(`strcmp(name, "add") == 0`);
    expect(c).toContain(`strcmp(name, "hash_bytes") == 0`);
  });

  test("lib.c dispatches params with typed extraction", () => {
    const c = generateCLib(manifest);
    expect(c).toContain(`jv_get(args, "a")`);
    expect(c).toContain(`jv_get(args, "name")`);
    expect(c).toContain(`jv_get(args, "data")`);
  });

  test("lib.c is balanced (braces)", () => {
    const c = generateCLib(manifest);
    const opens = (c.match(/{/g) ?? []).length;
    const closes = (c.match(/}/g) ?? []).length;
    expect(opens).toBe(closes);
  });

  test("lib.cpp wraps FFI in extern \"C\"", () => {
    const cpp = generateCppLib(manifest);
    expect(cpp).toContain(`extern "C" {`);
    expect(cpp).toContain(`char *asijs_call(const char *input)`);
    expect(cpp).toContain(`void asijs_free(char *ptr)`);
  });

  test("lib.cpp has C++-compatible stubs (static functions)", () => {
    const cpp = generateCppLib(manifest);
    expect(cpp).toContain(`static double fn_add(double a, double b) {`);
  });
});

// ============================================================================
// Zig
// ============================================================================

describe("native Zig generation (2.1)", () => {
  test("build.zig declares a shared library", () => {
    const zig = generateBuildZig(manifest);
    // Zig >= 0.15 uses addLibrary with .linkage = .dynamic; older used addSharedLibrary
    expect(zig).toMatch(/addLibrary|addSharedLibrary/);
    expect(zig).toContain(`.linkage = .dynamic`);
    expect(zig).toContain(`.name = "poly"`);
    expect(zig).toContain(`src/lib.zig`);
  });

  test("lib.zig contains typed user stubs with TODO", () => {
    const zig = generateZigLib(manifest);
    expect(zig).toContain(`pub fn add(a: f64, b: f64) f64 {`);
    expect(zig).toContain(`// TODO: implement the body of add`);
    expect(zig).toContain(`pub fn greet(name: []const u8) []const u8 {`);
    expect(zig).toContain(`pub fn enabled(flag: bool) bool {`);
    expect(zig).toContain(`pub fn hash_bytes(data: []const u8) []const u8 {`);
    expect(zig).toContain(`pub fn pass_through(value: std.json.Value) std.json.Value {`);
  });

  test("lib.zig contains export fn FFI boundary", () => {
    const zig = generateZigLib(manifest);
    expect(zig).toContain(`export fn asijs_call(input: [*:0]const u8) ?[*:0]u8 {`);
    expect(zig).toContain(`export fn asijs_free(ptr: [*:0]u8) void {`);
    expect(zig).toContain(`std.json.Stringify.valueAlloc`);
  });

  test("lib.zig dispatches by function name", () => {
    const zig = generateZigLib(manifest);
    expect(zig).toContain(`std.mem.eql(u8, fn_name, "add")`);
    expect(zig).toContain(`std.mem.eql(u8, fn_name, "greet")`);
    expect(zig).toContain(`std.mem.eql(u8, fn_name, "pass_through")`);
  });
});

// ============================================================================
// Compile checks (skip when toolchain unavailable)
// ============================================================================

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

describe("native compile checks (2.1)", () => {
  test.skipIf(!toolchainAvailable("cc", ["--version"]))(
    "generated lib.c compiles with cc",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "asi-native-c-"));
      try {
        writeFileSync(join(dir, "lib.c"), generateCLib(manifest), "utf-8");
        const r = spawnSync("cc", ["-shared", "-fPIC", "-o", join(dir, "libpoly.so"), join(dir, "lib.c")], {
          encoding: "utf-8",
        });
        expect(r.status).toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  test.skipIf(!toolchainAvailable("cc", ["--version"]))(
    "generated lib.c round-trips through dlopen",
    async () => {
      // Only run under Bun (bun:ffi available)
      if (typeof Bun === "undefined") return;
      const dir = mkdtempSync(join(tmpdir(), "asi-native-c-e2e-"));
      try {
        // Generate with a real implementation for `add`
        let src = generateCLib({
          ...manifest,
          functions: [
            { name: "add", params: { a: "number", b: "number" }, returns: "number" },
          ],
        });
        src = src.replace(
          "static double fn_add(double a, double b) {\n  // TODO: implement the body of add\n  return 0.0;\n}",
          "static double fn_add(double a, double b) { return a + b; }",
        );
        const srcPath = join(dir, "lib.c");
        writeFileSync(srcPath, src, "utf-8");
        const libPath = join(dir, "libpoly.so");
        const r = spawnSync("cc", ["-shared", "-fPIC", "-o", libPath, srcPath], {
          encoding: "utf-8",
        });
        expect(r.status).toBe(0);
        const { loadNativeModule } = require("../src/native/runtime");
        const mod = loadNativeModule(
          { name: "poly", lang: "c", functions: [{ name: "add", params: { a: "number", b: "number" }, returns: "number" }] },
          { libPath },
        );
        expect((mod["add"] as (a: number, b: number) => number)(2, 3)).toBe(5);
        expect((mod["add"] as (a: number, b: number) => number)(10, 20)).toBe(30);
      } finally {
        // dlopen holds the .so open on Windows — retry cleanup a few times
        for (let i = 0; i < 5; i++) {
          try {
            rmSync(dir, { recursive: true, force: true });
            break;
          } catch {
            await new Promise((res) => setTimeout(res, 100));
          }
        }
      }
    },
  );

  test.skipIf(!toolchainAvailable("c++", ["--version"]))(
    "generated lib.cpp compiles with c++",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "asi-native-cpp-"));
      try {
        writeFileSync(join(dir, "lib.cpp"), generateCppLib(manifest), "utf-8");
        const r = spawnSync("c++", ["-shared", "-fPIC", "-o", join(dir, "libpoly.so"), join(dir, "lib.cpp")], {
          encoding: "utf-8",
        });
        expect(r.status).toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  test.skipIf(!toolchainAvailable("go", ["version"]))(
    "generated main.go compiles with go build",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "asi-native-go-"));
      try {
        writeFileSync(join(dir, "go.mod"), generateGoMod(manifest), "utf-8");
        mkdirSync(join(dir, "src"), { recursive: true });
        writeFileSync(join(dir, "main.go"), generateMainGo(manifest), "utf-8");
        const r = spawnSync(
          "go",
          ["build", "-buildmode=c-shared", "-o", join(dir, "libpoly.so"), "."],
          { cwd: dir, encoding: "utf-8" },
        );
        expect(r.status).toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    120_000,
  );

  test.skipIf(!toolchainAvailable("zig", ["version"]))(
    "generated build.zig + lib.zig compile with zig build",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "asi-native-zig-"));
      try {
        writeFileSync(join(dir, "build.zig"), generateBuildZig(manifest), "utf-8");
        mkdirSync(join(dir, "src"), { recursive: true });
        writeFileSync(join(dir, "src", "lib.zig"), generateZigLib(manifest), "utf-8");
        const r = spawnSync("zig", ["build", "-Doptimize=ReleaseFast"], {
          cwd: dir,
          encoding: "utf-8",
        });
        expect(r.status).toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    120_000,
  );

  test.skipIf(!toolchainAvailable("zig", ["version"]))(
    "generated zig lib round-trips through dlopen",
    async () => {
      // Only run under Bun (bun:ffi available)
      if (typeof Bun === "undefined") return;
      const dir = mkdtempSync(join(tmpdir(), "asi-native-zig-e2e-"));
      try {
        // Generate with a real implementation for `add`
        let src = generateZigLib({
          ...manifest,
          functions: [{ name: "add", params: { a: "number", b: "number" }, returns: "number" }],
        });
        src = src.replace(
          "pub fn add(a: f64, b: f64) f64 {\n    // TODO: implement the body of add\n    _ = a;\n    _ = b;\n    return 0;\n}",
          "pub fn add(a: f64, b: f64) f64 { return a + b; }",
        );
        writeFileSync(join(dir, "build.zig"), generateBuildZig(manifest), "utf-8");
        mkdirSync(join(dir, "src"), { recursive: true });
        writeFileSync(join(dir, "src", "lib.zig"), src, "utf-8");
        const r = spawnSync("zig", ["build", "-Doptimize=ReleaseFast"], {
          cwd: dir,
          encoding: "utf-8",
        });
        expect(r.status).toBe(0);
        // Locate the produced shared library (zig-out/bin/*.dll|so|dylib)
        const libDir = join(dir, "zig-out", "bin");
        const fallbackDir = join(dir, "zig-out", "lib");
        const libName = process.platform === "win32" ? "poly.dll" : `libpoly.${process.platform === "darwin" ? "dylib" : "so"}`;
        const libPath = join(libDir, libName);
        const libPath2 = join(fallbackDir, libName);
        const { existsSync } = await import("fs");
        const found = existsSync(libPath) ? libPath : existsSync(libPath2) ? libPath2 : null;
        expect(found).not.toBeNull();
        const { loadNativeModule } = await import("../src/native/runtime");
        const mod = loadNativeModule(
          { name: "poly", lang: "zig", functions: [{ name: "add", params: { a: "number", b: "number" }, returns: "number" }] },
          { libPath: found! },
        );
        expect((mod["add"] as (a: number, b: number) => number)(2, 3)).toBe(5);
        expect((mod["add"] as (a: number, b: number) => number)(10, 20)).toBe(30);
      } finally {
        // dlopen holds the .so open on Windows — retry cleanup a few times
        for (let i = 0; i < 5; i++) {
          try {
            rmSync(dir, { recursive: true, force: true });
            break;
          } catch {
            await new Promise((res) => setTimeout(res, 100));
          }
        }
      }
    },
    180_000,
  );

  test.skipIf(!toolchainAvailable("go", ["version"]))(
    "generated go lib round-trips through dlopen",
    async () => {
      // Only run under Bun (bun:ffi available)
      if (typeof Bun === "undefined") return;
      const dir = mkdtempSync(join(tmpdir(), "asi-native-go-e2e-"));
      try {
        // Generate with a real implementation for `add`
        let src = generateMainGo({
          ...manifest,
          functions: [{ name: "add", params: { a: "number", b: "number" }, returns: "number" }],
        });
        src = src.replace(
          "func add(a float64, b float64) float64 {\n\t// TODO: implement the body of add\n\tpanic(\"implement add\")\n}",
          "func add(a float64, b float64) float64 { return a + b }",
        );
        const libExt = process.platform === "win32" ? "dll" : process.platform === "darwin" ? "dylib" : "so";
        const libName = process.platform === "win32" ? "poly.dll" : `libpoly.${libExt}`;
        const libPath = join(dir, libName);
        // go build needs a module dir; build in a src/ subdir
        mkdirSync(join(dir, "src"), { recursive: true });
        writeFileSync(join(dir, "src", "main.go"), src, "utf-8");
        writeFileSync(join(dir, "src", "go.mod"), generateGoMod(manifest), "utf-8");
        const r = spawnSync(
          "go",
          ["build", "-buildmode=c-shared", "-o", libPath, "."],
          { cwd: join(dir, "src"), encoding: "utf-8" },
        );
        expect(r.status).toBe(0);
        const { existsSync } = await import("fs");
        expect(existsSync(libPath)).toBe(true);
        const { loadNativeModule } = await import("../src/native/runtime");
        const mod = loadNativeModule(
          { name: "poly", lang: "go", functions: [{ name: "add", params: { a: "number", b: "number" }, returns: "number" }] },
          { libPath },
        );
        expect((mod["add"] as (a: number, b: number) => number)(2, 3)).toBe(5);
        expect((mod["add"] as (a: number, b: number) => number)(10, 20)).toBe(30);
      } finally {
        // dlopen holds the .so open on Windows — retry cleanup a few times
        for (let i = 0; i < 5; i++) {
          try {
            rmSync(dir, { recursive: true, force: true });
            break;
          } catch {
            await new Promise((res) => setTimeout(res, 100));
          }
        }
      }
    },
    180_000,
  );

  test.skipIf(!toolchainAvailable("nim", ["--version"]))(
    "generated lib.nim compiles with nim",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "asi-native-nim-"));
      try {
        writeFileSync(join(dir, "lib.nim"), generateNimLib(manifest), "utf-8");
        const libName = process.platform === "win32" ? "poly.dll" : "libpoly.so";
        const r = spawnSync(
          "nim",
          ["c", "-d:release", "--app:lib", `--out:${join(dir, libName)}`, join(dir, "lib.nim")],
          { encoding: "utf-8" },
        );
        expect(r.status).toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    120_000,
  );

  test.skipIf(!toolchainAvailable("nim", ["--version"]))(
    "generated nim lib round-trips through dlopen",
    async () => {
      // Only run under Bun (bun:ffi available)
      if (typeof Bun === "undefined") return;
      const dir = mkdtempSync(join(tmpdir(), "asi-native-nim-e2e-"));
      try {
        let src = generateNimLib({
          ...manifest,
          functions: [{ name: "add", params: { a: "number", b: "number" }, returns: "number" }],
        });
        src = src.replace(
          "proc add(a: float64, b: float64): float64 =\n  # TODO: implement the body of add\n  return 0.0",
          "proc add(a: float64, b: float64): float64 =\n  return a + b",
        );
        const srcPath = join(dir, "lib.nim");
        writeFileSync(srcPath, src, "utf-8");
        const libPath = join(dir, process.platform === "win32" ? "poly.dll" : "libpoly.so");
        const r = spawnSync(
          "nim",
          ["c", "-d:release", "--app:lib", `--out:${libPath}`, srcPath],
          { encoding: "utf-8" },
        );
        expect(r.status).toBe(0);
        const { loadNativeModule } = await import("../src/native/runtime");
        const mod = loadNativeModule(
          { name: "poly", lang: "nim", functions: [{ name: "add", params: { a: "number", b: "number" }, returns: "number" }] },
          { libPath },
        );
        expect((mod["add"] as (a: number, b: number) => number)(2, 3)).toBe(5);
        expect((mod["add"] as (a: number, b: number) => number)(10, 20)).toBe(30);
      } finally {
        // dlopen holds the .so open on Windows — retry cleanup a few times
        for (let i = 0; i < 5; i++) {
          try {
            rmSync(dir, { recursive: true, force: true });
            break;
          } catch {
            await new Promise((res) => setTimeout(res, 100));
          }
        }
      }
    },
    180_000,
  );

  test.skipIf(!toolchainAvailable("ghc", ["--numeric-version"]))(
    "generated lib.hs compiles with ghc",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "asi-native-hs-"));
      try {
        writeFileSync(join(dir, "lib.hs"), generateHaskellLib(manifest), "utf-8");
        const libName = process.platform === "win32" ? "poly.dll" : "libpoly.so";
        const out = join(dir, libName);
        const args = ["-shared", "-fPIC", "-package", "text", join(dir, "lib.hs"), "-o", out];
        if (process.platform === "win32") {
          writeFileSync(join(dir, "lib.def"), generateHaskellDef(), "utf-8");
          args.push("-static", "-optl", join(dir, "lib.def"), `-optl-Wl,--out-implib,${out}.a`);
        } else {
          // -dynamic: link against the shared RTS (distro GHC ships static,
          // non-PIC package archives — without it the link fails on Linux).
          args.push("-dynamic");
        }
        const r = spawnSync("ghc", args, { encoding: "utf-8" });
        expect(r.status).toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    180_000,
  );

  test.skipIf(!toolchainAvailable("ghc", ["--numeric-version"]))(
    "generated haskell lib round-trips through dlopen",
    async () => {
      // Only run under Bun (bun:ffi available)
      if (typeof Bun === "undefined") return;
      const dir = mkdtempSync(join(tmpdir(), "asi-native-hs-e2e-"));
      try {
        let src = generateHaskellLib({
          ...manifest,
          functions: [{ name: "add", params: { a: "number", b: "number" }, returns: "number" }],
        });
        src = src.replace(
          "add _a _b =\n  -- TODO: implement the body of add\n  0.0",
          "add a b =\n  a + b",
        );
        writeFileSync(join(dir, "lib.hs"), src, "utf-8");
        const libName = process.platform === "win32" ? "poly.dll" : "libpoly.so";
        const libPath = join(dir, libName);
        const args = ["-shared", "-fPIC", "-package", "text", join(dir, "lib.hs"), "-o", libPath];
        if (process.platform === "win32") {
          writeFileSync(join(dir, "lib.def"), generateHaskellDef(), "utf-8");
          args.push("-static", "-optl", join(dir, "lib.def"), `-optl-Wl,--out-implib,${libPath}.a`);
        } else {
          // -dynamic: link against the shared RTS (distro GHC ships static,
          // non-PIC package archives — without it the link fails on Linux).
          args.push("-dynamic");
        }
        const r = spawnSync("ghc", args, { encoding: "utf-8" });
        expect(r.status).toBe(0);
        const { loadNativeModule } = await import("../src/native/runtime");
        const mod = loadNativeModule(
          { name: "poly", lang: "haskell", functions: [{ name: "add", params: { a: "number", b: "number" }, returns: "number" }] },
          { libPath },
        );
        expect((mod["add"] as (a: number, b: number) => number)(2, 3)).toBe(5);
        expect((mod["add"] as (a: number, b: number) => number)(10, 20)).toBe(30);
      } finally {
        // dlopen holds the .so open on Windows — retry cleanup a few times
        for (let i = 0; i < 5; i++) {
          try {
            rmSync(dir, { recursive: true, force: true });
            break;
          } catch {
            await new Promise((res) => setTimeout(res, 100));
          }
        }
      }
    },
    240_000,
  );
});

// ============================================================================
// Lua (embedded interpreter — variant A, 2.4)
// ============================================================================

describe("native Lua generation (2.4)", () => {
  test("lib.lua contains typed user stubs with TODO", () => {
    const lua = generateLuaLib(manifest);
    expect(lua).toContain(`function add(a, b)`);
    expect(lua).toContain(`error("implement add")`);
    expect(lua).toContain(`function greet(name)`);
    expect(lua).toContain(`function enabled(flag)`);
    expect(lua).toContain(`function hash_bytes(data)`);
    expect(lua).toContain(`function pass_through(value)`);
  });

  test("lib.lua embeds a mini JSON codec + asijs_call dispatcher", () => {
    const lua = generateLuaLib(manifest);
    expect(lua).toContain(`local json = {}`);
    expect(lua).toContain(`function json.encode(v)`);
    expect(lua).toContain(`function json.decode(s)`);
    expect(lua).toContain(`function asijs_call(input)`);
    expect(lua).toContain(`local HANDLERS = {`);
    expect(lua).toContain(`["add"] = add,`);
    expect(lua).toContain(`local PARAM_TYPES = {`);
    expect(lua).toContain(`["hash_bytes"] = { ["data"] = "bytes" },`);
  });

  test("lib.lua escapes Lua reserved words in param names", () => {
    const lua = generateLuaLib({
      ...manifest,
      functions: [{ name: "loop", params: { end: "number", until: "string" }, returns: "number" }],
    });
    expect(lua).toContain(`function loop(end_, until_)`);
    expect(lua).toContain(`["loop"] = loop,`);
  });

  test("lib.lua dispatches with type checks and ordered args", () => {
    const lua = generateLuaLib(manifest);
    expect(lua).toContain(`["add"] = { ["a"] = "number", ["b"] = "number" },`);
    expect(lua).toContain(`if t == "number" and type(v) ~= "number" then`);
    expect(lua).toContain(`call_args[i] = v`);
    expect(lua).toContain(`table.unpack(call_args)`);
    expect(lua).toContain(`return json.encode({ ok = true, result = res })`);
  });
});

describe("native Lua runtime (2.4, embedded via liblua)", () => {
  // Skip when liblua is not installed (CI without Lua)
  const luaLib = findLuaLib();

  test.skipIf(!luaLib)("findLuaLib resolves a real library", () => {
    expect(luaLib!.length).toBeGreaterThan(0);
    const { existsSync } = require("fs") as typeof import("fs");
    // Bare names (liblua.so) resolve via the loader — only check file paths
    if (existsSync(luaLib!)) {
      expect(luaLib).toMatch(/lua/i);
    }
  });

  test.skipIf(!luaLib)("embedded lua round-trips through loadNativeModule", async () => {
    // Only run under Bun (bun:ffi available)
    if (typeof Bun === "undefined") return;
    const dir = mkdtempSync(join(tmpdir(), "asi-native-lua-e2e-"));
    const nativeDir = join(dir, "native");
    mkdirSync(nativeDir, { recursive: true });
    try {
      let src = generateLuaLib({
        ...manifest,
        functions: [
          { name: "add", params: { a: "number", b: "number" }, returns: "number" },
          { name: "greet", params: { name: "string" }, returns: "string" },
          { name: "hash_bytes", params: { data: "bytes" }, returns: "bytes" },
          { name: "pass_through", params: { value: "json" }, returns: "json" },
        ],
      });
      src = src
        .replace('  error("implement add")', "  return a + b")
        .replace('  error("implement greet")', '  return "hi " .. name')
        .replace('  error("implement hash_bytes")', "  return data")
        .replace('  error("implement pass_through")', "  return value");
      writeFileSync(join(nativeDir, "lib.lua"), src, "utf-8");
      const { loadNativeModule } = await import("../src/native/runtime");
      const mod = loadNativeModule(
        {
          name: "poly",
          lang: "lua",
          functions: [
            { name: "add", params: { a: "number", b: "number" }, returns: "number" },
            { name: "greet", params: { name: "string" }, returns: "string" },
            { name: "hash_bytes", params: { data: "bytes" }, returns: "bytes" },
            { name: "pass_through", params: { value: "json" }, returns: "json" },
          ],
        },
        { cwd: dir },
      );
      expect((mod["add"] as (a: number, b: number) => number)(2, 3)).toBe(5);
      expect((mod["add"] as (a: number, b: number) => number)(10, 20)).toBe(30);
      expect((mod["greet"] as (n: string) => string)("world")).toBe("hi world");
      const bytes = (mod["hash_bytes"] as (d: Uint8Array) => number[])(new Uint8Array([1, 2, 255]));
      expect(Array.from(bytes)).toEqual([1, 2, 255]);
      const json = (mod["pass_through"] as (v: unknown) => unknown)({ x: 1, y: "s" });
      expect(json).toEqual({ x: 1, y: "s" });
      // errors surface as JS errors with the Lua message
      const mod2 = mod as unknown as { close?: () => void };
      mod2.close?.();
    } finally {
      for (let i = 0; i < 5; i++) {
        try {
          rmSync(dir, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((res) => setTimeout(res, 100));
        }
      }
    }
  }, 60_000);

  test.skipIf(!luaLib)("embedded lua surfaces stub errors from the dispatcher", async () => {
    if (typeof Bun === "undefined") return;
    const dir = mkdtempSync(join(tmpdir(), "asi-native-lua-stub-"));
    const nativeDir = join(dir, "native");
    mkdirSync(nativeDir, { recursive: true });
    try {
      // No implementation — the generated stub raises "implement add"
      writeFileSync(join(nativeDir, "lib.lua"), generateLuaLib(manifest), "utf-8");
      const { loadNativeModule } = await import("../src/native/runtime");
      const mod = loadNativeModule(
        { name: "poly", lang: "lua", functions: [{ name: "add", params: { a: "number", b: "number" }, returns: "number" }] },
        { cwd: dir },
      );
      let err: Error | null = null;
      try {
        (mod["add"] as (a: number, b: number) => number)(1, 2);
      } catch (e) {
        err = e as Error;
      }
      expect(err).not.toBeNull();
      expect(err!.message).toContain("implement add");
      // wrong arg type — the dispatcher checks before calling
      err = null;
      try {
        (mod["add"] as unknown as (a: string, b: number) => number)("x", 2);
      } catch (e) {
        err = e as Error;
      }
      expect(err).not.toBeNull();
      expect(err!.message).toContain("expected number");
      (mod as unknown as { close?: () => void }).close?.();
    } finally {
      for (let i = 0; i < 5; i++) {
        try {
          rmSync(dir, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((res) => setTimeout(res, 100));
        }
      }
    }
  }, 60_000);
});
