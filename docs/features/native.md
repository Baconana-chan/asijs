# Native / Polyglot Modules

AsiJS lets you write parts of your application in **other languages** with **zero manual glue** — no WASM, no hand-written FFI definitions, no "I don't understand this file" moments.

The core idea: **a `.rs` (or `.py`, `.rb`, `.php`…) file in your project is a first-class citizen**. You scaffold a native module, implement the function bodies, and AsiJS generates both sides of the boundary:

- **Native stubs** — FFI entry + JSON marshalling for compiled languages (you write only the function bodies)
- **TypeScript wrapper** — a typed client exposed as `ctx.native.<fn>(...)`

Three integration kinds, same `ctx.native` interface:

| Kind | Languages | How it runs |
|------|-----------|-------------|
| **FFI (compiled)** | Rust, Go, C, C++, Zig, Nim, Haskell | compiled to `.so`/`.dll`/`.dylib`, loaded via Bun's **`bun:ffi` (dlopen)** |
| **Embedded interpreter** | Lua | liblua itself is dlopen'd in-process and driven through its **C API** — no compilation, no IPC |
| **Sidecar (interpreted)** | Python, Ruby, PHP | interpreter spawned via `Bun.spawn`, JSON-RPC over stdio |

> **Zig**: require Zig **0.15–0.17** — older versions won't work (the generated `build.zig` uses the newer `addLibrary`/`createModule` API). Verified by a real build + dlopen on 0.17-dev.
>
> **Haskell**: needs GHC with the `text` package and (on Windows) the static RTS; the generated `lib.def` export list + `hs_init` are handled automatically. The embedded mini-JSON keeps the `JVal` type at exactly **five constructors** — a sixth makes the statically-linked GHC DLL segfault the host on Windows (verified on 9.6.7). `asi native build` creates `target/release/` itself since GHC refuses a missing output dir.
>
> **Lua**: needs liblua on the machine — MSYS2 `pacman -S mingw-w64-ucrt-x86_64-lua`, a system `liblua.so`, or `ASI_LUA_LIB=/path/to/lua55.dll`. Lua 5.5 exports only the base C API (macros like `lua_pcall`/`luaL_dostring` are header-only), so the runtime binds `lua_pcallk`/`lua_settop`/`luaL_loadstring`/`luaL_openselectedlibs` instead — handled automatically.

## Quick Start (Rust)

Compiled languages (FFI):

```bash
asi native scaffold rust my-crypto   # also: go | c | cpp | zig
asi native build                     # cargo build --release (no build for sidecar)
```

```bash
# 1. Scaffold a native module
asi native scaffold rust my-crypto
```

This creates:

```
native/
├── manifest.json       # functions & types (single source of truth)
├── Cargo.toml          # cdylib crate (serde + serde_json)
└── src/
    ├── lib.rs          # stub functions — implement the TODO bodies
    └── generated.ts    # typed bun:ffi wrapper (auto-generated)
```

```rust
// native/src/lib.rs — implement the bodies
pub fn sha256(input: String) -> String {
    // TODO: implement the body of sha256
    unimplemented!("implement sha256")
}
```

```bash
# 2. Compile the shared library
asi native build
```

```ts
// src/index.ts — use it in your app
import { Asi } from "asijs";
import { native } from "asijs/native";

const app = new Asi();
app.use(native({ cwd: process.cwd() }));

app.get("/hash", async (ctx) => {
  const hash = await ctx.native.sha256(ctx.query.input as string);
  return { hash };
});

app.listen(3000);
```

## Quick Start (Python — sidecar)

Interpreted languages need no compile step — the interpreter runs the generated server script directly:

```bash
asi native scaffold python py_calc    # also: ruby | php
```

```
native/
├── manifest.json       # functions & types (single source of truth)
├── server.py           # stub functions — implement the TODO bodies
└── src/
    └── generated.ts    # typed sidecar client (auto-generated)
```

```python
# native/server.py — implement the bodies
def add(a, b):
    # TODO: implement the body of add
    raise NotImplementedError("implement add")
```

```bash
asi native build   # "✓ Sidecar ready — no compilation needed"
```

> **Ruby stubs use keyword arguments** — the dispatcher calls `handler.call(**args)`, so a generated stub is `def add(a:, b:)` (Ruby 3 splits kwargs from positional args). Unimplemented stubs `raise "implement add"` (a RuntimeError — `NotImplementedError` is a ScriptError and would kill the process).

The same `ctx.native.add(2, 3)` call works for all three kinds — the runtime branches on the manifest language.

## Quick Start (Lua — embedded interpreter)

Lua runs **inside the AsiJS process**: the runtime dlopens liblua and drives it through the Lua C API. No compile step, no sidecar process, no IPC:

```bash
asi native scaffold lua my-rules
```

```
native/
├── manifest.json       # functions & types (single source of truth)
├── lib.lua             # stub functions — implement the TODO bodies
└── src/
    └── generated.ts    # typed embedded-Lua client (auto-generated)
```

```lua
-- native/lib.lua — implement the bodies
function add(a, b)
  -- TODO: implement the body of add
  error("implement add")
end
```

```bash
asi native build   # "✓ Embedded interpreter ready — no compilation needed"
```

```ts
// src/index.ts
import { Asi } from "asijs";
import { native } from "asijs/native";

const app = new Asi();
app.use(native({ cwd: process.cwd() }));

app.get("/roll", async (ctx) => {
  return { value: await ctx.native.roll_dice() };
});
```

The generated `lib.lua` embeds a **mini JSON codec** (Lua has no JSON in its standard library) plus the `asijs_call` dispatcher — you only write the function bodies. `bytes` params arrive as Lua arrays of numbers and can be returned as an array or as a raw string (converted automatically). Lua reserved words in parameter names are escaped with a `_` suffix (`end` → `end_`).

## Manifest

The manifest is the single source of truth. Functions and their types are declared here; AsiJS generates everything else from it.

```json
{
  "name": "my_crypto",
  "lang": "rust",
  "functions": [
    { "name": "add", "params": { "a": "number", "b": "number" }, "returns": "number" },
    { "name": "sha256", "params": { "input": "string" }, "returns": "string" }
  ]
}
```

### Supported types

| Type | Rust | TypeScript |
|------|------|------------|
| `string` | `String` | `string` |
| `number` | `f64` | `number` |
| `boolean` | `bool` | `boolean` |
| `bytes` | `Vec<u8>` | `Uint8Array` |
| `json` | `serde_json::Value` | `unknown` |

## CLI

| Command | Description |
|---------|-------------|
| `asi native scaffold <lang> [name]` | Generate a native module — `rust|go|c|cpp|zig|nim|haskell` (FFI), `lua` (embedded), or `python|ruby|php` (sidecar). |
| `asi native build [--force]` | Compile the shared library (`cargo build --release` / `go build` / `cc -shared` / `zig build`); for sidecar/embedded languages just verifies the interpreter/liblua and marks the module ready. |
| `asi native test` | Smoke-run every declared function with sample args — `✓ pass` / `◌ stub (TODO)` / `✗ fail`. |
| `asi native list` | List declared functions. |
| `asi native info` | Manifest summary + build staleness. |

## API

### `native(options)` — middleware

Adds `ctx.native` to the request context. Loads the manifest lazily on the first call; for FFI languages the shared library is dlopen'd lazily, for sidecar languages the interpreter process is spawned lazily and restarted with backoff if it crashes.

```ts
app.use(native({ cwd: process.cwd() }));
```

Options:

| Option | Default | Description |
|--------|---------|-------------|
| `cwd` | `process.cwd()` | Project root (where `native/` lives). |
| `libPath` | auto | Explicit path to the shared library (overrides auto-resolution). |
| `hotReload` | `false` | Watch `native/` and swap the module on change without restarting the server. |
| `buildOnChange` | `true` | Rebuild FFI languages when `hotReload` is on. |
| `debounceMs` | `300` | Debounce for the hot-reload watcher. |
| `verbose` | `true` | Print watcher lifecycle messages. |

### `loadNativeModule(manifest, options?, dlopen?)`

Load a module directly (no middleware). The third argument lets you inject a custom `dlopen` (useful for tests/mocks).

```ts
import { loadNativeModule } from "asijs/native";
import { loadManifest } from "asijs/native";

const manifest = await loadManifest("./native");
const module = loadNativeModule(manifest, { cwd: process.cwd() });
module.sha256("hello"); // => "hash:..."
```

### Manifest helpers

| Function | Description |
|----------|-------------|
| `parseManifest(input)` | Validate + normalize a manifest object (throws with readable errors). |
| `validateManifest(input)` | Return a list of validation errors (empty = valid). |
| `loadManifest(nativeRoot)` | Read + parse `native/manifest.json`. |
| `writeManifest(nativeRoot, manifest)` | Write a manifest. |
| `findNativeRoot(cwd)` | Locate the native module root in a project. |
| `detectLanguage(dir)` | Detect language from directory contents (Cargo.toml/go.mod/build.zig/server.py/rb/php/lib.lua). |

### Generators

| Function | Description |
|----------|-------------|
| `generateCargoToml(manifest)` / `generateLibRs(manifest)` | Rust: Cargo.toml + `lib.rs` (stubs + FFI boundary + dispatcher). |
| `generateGoMod(manifest)` / `generateMainGo(manifest)` | Go: `go.mod` + `main.go` (`//export` + encoding/json). |
| `generateCLib(manifest)` / `generateCppLib(manifest)` | C/C++: `lib.c`/`lib.cpp` with a built-in mini-JSON boundary. |
| `generateBuildZig(manifest)` / `generateZigLib(manifest)` | Zig: `build.zig` + `src/lib.zig` (std.json). |
| `generateNimLib(manifest)` | Nim: `lib.nim` (`exportc`/`dynlib` + std/json dispatcher). |
| `generateHaskellLib(manifest)` / `generateHaskellDef(manifest)` | Haskell: `lib.hs` (embedded mini-JSON, `foreign export ccall`) + `lib.def` (Windows export list incl. `hs_init`). |
| `generateLuaLib(manifest)` / `generateLuaTsClient(manifest)` | Lua: `lib.lua` (mini JSON + stubs + `asijs_call` dispatcher) + typed embedded client. |
| `generatePythonServer(manifest)` / `generateRubyServer(manifest)` / `generatePhpServer(manifest)` | Sidecar: `server.py`/`server.rb`/`server.php` (stubs + JSON-RPC dispatcher + bytes handling). |
| `generateTsWrapper(manifest, libPathExpr)` | `generated.ts` source: typed `bun:ffi` wrapper. |
| `generateSidecarTsClient(manifest)` | `generated.ts` source: typed client over `createSidecarClient`. |

## Hot reload in dev (2.3)

Pass `hotReload: true` to the middleware and `asi dev` will pick up native changes without a server restart:

```ts
app.use(native({ cwd: process.cwd(), hotReload: true }));
```

- **Sidecar languages** (python/ruby/php) reload fully on any platform — the interpreter is respawned on the next call.
- **Embedded Lua** reloads fully on any platform — `lib.lua` is re-read and the Lua state re-created on the next call (no compilation, so nothing to lock).
- **FFI languages** rebuild and reload on POSIX; on Windows a loaded `.so` is locked, so the watcher prints a clear message and you run `asi native build` + restart manually.
- Build output (`target/`, `generated.ts`, `.asi-native-cache`) is ignored so the watcher never loops on its own rebuild.

`asi dev` and `devMode()` print a hint when `native/manifest.json` is detected. A standalone helper is also exported for custom wiring:

```ts
import { watchNativeModule } from "asijs/native";
const stop = watchNativeModule({
  cwd: process.cwd(),
  onEvent: (e) => console.log(`[native] ${e.message}`),
});
```

## Smoke test: `asi native test` (2.3)

Runs every function declared in the manifest with sample arguments (by type), reporting `✓ pass` / `◌ stub (TODO)` / `✗ fail` — a fast way to see which stubs are still unimplemented:

```bash
asi native test
```

```
  py_calc (python) — 3 function(s)

    ✓ add -> 2
    ◌ sha256 — TODO stub ([native:sha256] implement sha256)
    ◌ reverse — TODO stub ([native:reverse] implement reverse)

    1 pass · 2 stub · 0 fail
```

The runner is also available programmatically: `runNativeTest(manifest, { cwd })` returns typed results.

### Sidecar client & embedded Lua

| Function | Description |
|----------|-------------|
| `createSidecarClient(manifest, options?)` | Spawn the interpreter and return a typed module (one async fn per manifest function + `close()`). Options: `cwd`, `spawn` (tests), `interpreter`, `backoffMs`, `maxBackoffMs`, `forwardStderr`. |
| `isSidecarLanguage(lang)` | Whether a language runs as a sidecar process. |
| `createLuaModule(manifest, options?)` | Embed liblua in-process and return a typed module (synchronous functions + `close()`). Options: `cwd`, `libPath`, `dlopen` (tests). |
| `findLuaLib()` | Locate liblua (`ASI_LUA_LIB` env → MSYS2/system dirs → loader search). |
| `isEmbeddedLanguage(lang)` | Whether a language runs as an embedded interpreter. |

## How the boundary works

1. The generated wrapper serializes `{ fn, args }` to a JSON string.
2. `asijs_call` (in the Rust lib) receives it as a NUL-terminated C string.
3. The dispatcher matches the function name, deserializes params, calls your stub.
4. The result is serialized back, returned as a C string, read and freed by the wrapper (`asijs_free`).

The user never touches pointers, `extern "C"`, or marshalling — it is all generated.

## Roadmap

- **v1 (done)** — Rust via `bun:ffi`, manifest, scaffold/build/list/info, `ctx.native`
- **v2 (P1, done)** — Go/C/C++/Zig/Nim/Haskell stubs ✅, sidecar JSON-RPC for Python/Ruby/PHP ✅, hot reload + `asi native test` (2.3) ✅, **Lua embedded via liblua (2.4)** ✅ (real e2e through lua55.dll)
- **v3 (P2)** — contract-first codegen (TypeBox → Rust structs, Go structs, Python dataclasses), compile-to-JS client bindings (ReScript/Dart/Kotlin)

Full roadmap: [`TODO_native.md`](https://github.com/asijs/asijs/blob/main/TODO_native.md)

> **Note**: FFI modules require Bun (`bun:ffi`); sidecar modules also work on plain Node.js (uses `child_process`). Embedded Lua requires Bun (`bun:ffi` for the C API). On Node.js the `native()` middleware throws a clear error only for FFI/embedded languages.
