/**
 * Native / Polyglot Modules — abstract generator registry (2.1)
 *
 * Unifies all languages behind one interface:
 *   language → { toolchainCheck, buildCommand, files, stubGenerator }
 *
 * This is what lets `asi native scaffold <lang>` and `asi native build`
 * work uniformly for rust / go / c / cpp / zig / nim / haskell.
 */

import type { NativeLanguage, NativeManifest } from "./manifest";
import { generateCargoToml, generateLibRs } from "./generate-rust";
import { generateGoMod, generateMainGo } from "./generate-go";
import { generateCLib, generateCppLib } from "./generate-c";
import { generateBuildZig, generateZigLib } from "./generate-zig";
import { generateNimLib } from "./generate-nim";
import { generateHaskellLib, generateHaskellDef } from "./generate-haskell";
import { generateLuaLib, generateLuaTsClient } from "./generate-lua";
import { generatePythonServer, generateRubyServer, generatePhpServer } from "./generate-sidecar";
import { findLuaLib } from "./lang/lua";
import { platformLibExt } from "./generate-ts";

/** A file to write during scaffolding. */
export interface GeneratorFile {
  /** Path relative to the native root. */
  path: string;
  content: string;
}

/** Toolchain detection: command + args to check availability. */
export interface ToolchainCheck {
  cmd: string;
  args: string[];
  /** Human-readable hint when the toolchain is missing. */
  hint: string;
}

/** Build invocation (run in the native root). */
export interface BuildCommand {
  cmd: string;
  args: string[];
}

/** Unified interface for every supported language. */
export interface NativeGenerator {
  lang: NativeLanguage;
  /** Human-readable name. */
  label: string;
  /**
   * Integration kind:
   *  - ffi:      compiled to a .so, called through bun:ffi (rust/go/c/…)
   *  - sidecar:  interpreter spawned as a subprocess, JSON-RPC over stdio
   *  - embedded: interpreter dlopen'd in-process, driven via its C API (lua)
   */
  kind: "ffi" | "sidecar" | "embedded";
  /** Toolchain availability check. */
  toolchain: ToolchainCheck;
  /** Files to scaffold. */
  files: (manifest: NativeManifest) => GeneratorFile[];
  /** Build command (run in native root; no-op for sidecar languages). */
  build: (manifest: NativeManifest) => BuildCommand;
  /** Output shared-library file name (without platform extension). */
  libBaseName: (manifest: NativeManifest) => string;
  /** Stub source file name (for docs/debugging). */
  stubFile: string;
}

const rustGenerator: NativeGenerator = {
  lang: "rust",
  label: "Rust",
  kind: "ffi",
  toolchain: {
    cmd: "cargo",
    args: ["--version"],
    hint: 'install the Rust toolchain (https://rustup.rs), or build manually with "cd native && cargo build --release"',
  },
  files: (m) => [
    { path: "Cargo.toml", content: generateCargoToml(m) },
    { path: "src/lib.rs", content: generateLibRs(m) },
  ],
  build: () => ({ cmd: "cargo", args: ["build", "--release"] }),
  libBaseName: (m) => (platformLibExt() === ".dll" ? m.name : `lib${m.name}`),
  stubFile: "src/lib.rs",
};

const goGenerator: NativeGenerator = {
  lang: "go",
  label: "Go",
  kind: "ffi",
  toolchain: {
    cmd: "go",
    args: ["version"],
    hint: 'install the Go toolchain (https://go.dev/dl/), or build manually with "cd native && go build -buildmode=c-shared -o target/release/lib<name>.so ."',
  },
  files: (m) => [
    { path: "go.mod", content: generateGoMod(m) },
    { path: "main.go", content: generateMainGo(m) },
  ],
  build: (m) => ({
    cmd: "go",
    args: [
      "build",
      "-buildmode=c-shared",
      "-o",
      `target/release/${platformLibExt() === ".dll" ? m.name : `lib${m.name}`}${platformLibExt()}`,
      ".",
    ],
  }),
  libBaseName: (m) => (platformLibExt() === ".dll" ? m.name : `lib${m.name}`),
  stubFile: "main.go",
};

/** Shared C/C++ build command. */
function cBuildCommand(manifest: NativeManifest, src: string): BuildCommand {
  const ext = platformLibExt();
  return {
    cmd: "cc",
    args: [
      "-shared",
      "-fPIC",
      "-O2",
      "-o",
      `target/release/lib${manifest.name}${ext}`,
      src,
    ],
  };
}

const cGenerator: NativeGenerator = {
  lang: "c",
  label: "C",
  kind: "ffi",
  toolchain: {
    cmd: "cc",
    args: ["--version"],
    hint: 'install a C compiler (gcc/clang), or build manually with "cd native && cc -shared -fPIC -o target/release/lib<name>.so lib.c"',
  },
  files: (m) => [{ path: "lib.c", content: generateCLib(m) }],
  build: (m) => cBuildCommand(m, "lib.c"),
  libBaseName: (m) => `lib${m.name}`,
  stubFile: "lib.c",
};

const cppGenerator: NativeGenerator = {
  lang: "cpp",
  label: "C++",
  kind: "ffi",
  toolchain: {
    cmd: "c++",
    args: ["--version"],
    hint: 'install a C++ compiler (g++/clang++), or build manually with "cd native && c++ -shared -fPIC -o target/release/lib<name>.so lib.cpp"',
  },
  files: (m) => [{ path: "lib.cpp", content: generateCppLib(m) }],
  build: (m) => ({
    cmd: "c++",
    args: [
      "-shared",
      "-fPIC",
      "-O2",
      "-o",
      `target/release/lib${m.name}${platformLibExt()}`,
      "lib.cpp",
    ],
  }),
  libBaseName: (m) => `lib${m.name}`,
  stubFile: "lib.cpp",
};

const nimGenerator: NativeGenerator = {
  lang: "nim",
  label: "Nim",
  kind: "ffi",
  toolchain: {
    cmd: "nim",
    args: ["--version"],
    hint: 'install the Nim toolchain (https://nim-lang.org/install.html), or build manually with "cd native && nim c -d:release --app:lib -o target/release/lib<name>.<ext> lib.nim"',
  },
  files: (m) => [{ path: "lib.nim", content: generateNimLib(m) }],
  build: (m) => ({
    cmd: "nim",
    args: [
      "c",
      "-d:release",
      "--app:lib",
      // Nim wants `--out:<path>` (colon syntax, not a space-separated value)
      "--out:" +
        `target/release/${platformLibExt() === ".dll" ? m.name : `lib${m.name}`}${platformLibExt()}`,
      "lib.nim",
    ],
  }),
  libBaseName: (m) => (platformLibExt() === ".dll" ? m.name : `lib${m.name}`),
  stubFile: "lib.nim",
};

const haskellGenerator: NativeGenerator = {
  lang: "haskell",
  label: "Haskell",
  kind: "ffi",
  toolchain: {
    cmd: "ghc",
    args: ["--numeric-version"],
    hint: 'install GHC (https://www.haskell.org/ghcup/), or build manually with "cd native && ghc -shared -static -fPIC -package text -o target/release/lib<name>.<ext> lib.hs -optl lib.def"',
  },
  files: (m) => [
    { path: "lib.hs", content: generateHaskellLib(m) },
    { path: "lib.def", content: generateHaskellDef() },
  ],
  build: (m) => {
    const ext = platformLibExt();
    const base = ext === ".dll" ? m.name : `lib${m.name}`;
    const out = `target/release/${base}${ext}`;
    // Windows: the static GHC RTS requires an explicit export list (.def) and
    // an import library; POSIX links dynamic RTS and needs neither.
    const args = ["-shared", "-fPIC", "-package", "text", "lib.hs", "-o", out];
    if (ext === ".dll") {
      args.push("-static", "-optl", "lib.def", `-optl-Wl,--out-implib,${out}.a`);
    }
    return { cmd: "ghc", args };
  },
  libBaseName: (m) => (platformLibExt() === ".dll" ? m.name : `lib${m.name}`),
  stubFile: "lib.hs",
};

const luaGenerator: NativeGenerator = {
  lang: "lua",
  label: "Lua",
  kind: "embedded",
  toolchain: {
    cmd: "lua",
    args: ["-v"],
    hint: "Lua needs no CLI toolchain — AsiJS embeds liblua itself (dlopen). Install Lua for the shared library: MSYS2 'pacman -S mingw-w64-ucrt-x86_64-lua', or set ASI_LUA_LIB=/path/to/lua55.dll",
  },
  files: (m) => [{ path: "lib.lua", content: generateLuaLib(m) }],
  build: () => ({ cmd: "true", args: [] }),
  libBaseName: (m) => m.name,
  stubFile: "lib.lua",
};

const zigGenerator: NativeGenerator = {
  lang: "zig",
  label: "Zig",
  kind: "ffi",
  toolchain: {
    cmd: "zig",
    args: ["version"],
    hint: 'install the Zig toolchain (https://ziglang.org/download/), or build manually with "cd native && zig build -Doptimize=ReleaseFast"',
  },
  files: (m) => [
    { path: "build.zig", content: generateBuildZig(m) },
    { path: "src/lib.zig", content: generateZigLib(m) },
  ],
  build: () => ({ cmd: "zig", args: ["build", "-Doptimize=ReleaseFast"] }),
  libBaseName: (m) => m.name,
  stubFile: "src/lib.zig",
};

/** Shared toolchain check for the three sidecar interpreters. */
function sidecarToolchain(cmd: string, label: string, url: string): ToolchainCheck {
  return {
    cmd,
    args: ["--version"],
    hint: `install ${label} (${url}) — the sidecar runs "${cmd} native/server.<ext>" automatically`,
  };
}

const pythonGenerator: NativeGenerator = {
  lang: "python",
  label: "Python",
  kind: "sidecar",
  toolchain: sidecarToolchain(
    process.platform === "win32" ? "python" : "python3",
    "Python 3",
    "https://www.python.org/downloads/",
  ),
  files: (m) => [{ path: "server.py", content: generatePythonServer(m) }],
  build: () => ({ cmd: "true", args: [] }),
  libBaseName: (m) => m.name,
  stubFile: "server.py",
};

const rubyGenerator: NativeGenerator = {
  lang: "ruby",
  label: "Ruby",
  kind: "sidecar",
  toolchain: sidecarToolchain(
    "ruby",
    "Ruby",
    "https://www.ruby-lang.org/en/downloads/",
  ),
  files: (m) => [{ path: "server.rb", content: generateRubyServer(m) }],
  build: () => ({ cmd: "true", args: [] }),
  libBaseName: (m) => m.name,
  stubFile: "server.rb",
};

const phpGenerator: NativeGenerator = {
  lang: "php",
  label: "PHP",
  kind: "sidecar",
  toolchain: sidecarToolchain(
    "php",
    "PHP",
    "https://www.php.net/downloads",
  ),
  files: (m) => [{ path: "server.php", content: generatePhpServer(m) }],
  build: () => ({ cmd: "true", args: [] }),
  libBaseName: (m) => m.name,
  stubFile: "server.php",
};

/** Registry: language → generator. */
const GENERATORS: Record<string, NativeGenerator> = {
  rust: rustGenerator,
  go: goGenerator,
  c: cGenerator,
  cpp: cppGenerator,
  zig: zigGenerator,
  nim: nimGenerator,
  haskell: haskellGenerator,
  python: pythonGenerator,
  ruby: rubyGenerator,
  php: phpGenerator,
  lua: luaGenerator,
};

/** Whether a liblua is available on this machine (for tests/CLI hints). */
export function luaAvailable(): boolean {
  return findLuaLib() !== null;
}

/** Get the generator for a language (throws for unsupported). */
export function getGenerator(lang: NativeLanguage): NativeGenerator {
  const gen = GENERATORS[lang];
  if (!gen) {
    throw new Error(
      `No generator for language "${lang}" — supported: ${Object.keys(GENERATORS).join(", ")}`,
    );
  }
  return gen;
}

/** All registered languages (for CLI help). */
export function supportedLanguages(): NativeLanguage[] {
  return Object.keys(GENERATORS) as NativeLanguage[];
}

/** All registered generators (for tests/docs). */
export function allGenerators(): NativeGenerator[] {
  return Object.values(GENERATORS);
}
