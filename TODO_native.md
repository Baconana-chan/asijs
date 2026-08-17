# TODO_native.md — Native / Polyglot Modules Roadmap

> **Статус**: P0 (v1, DoD закрыт) + 2.1 (Go/C/C++/Zig) + 2.2 (Python/Ruby/PHP sidecar) + 2.3 (dev: hot reload, понятные ошибки, `asi native test`) + **2.4 (Lua: встроенный интерпретатор через dlopen liblua)** реализованы ✅ · **Runtime**: Bun (bun:ffi + Bun.spawn sidecar + встроенный liblua) + Node.js (частично) · **Версия**: 1.4.x (в ядре)
>
> Цель: **`.rs`-файл в проекте — first-class citizen**. Создал нативный модуль → AsiJS его понимает (скаффолдит, компилирует, типизирует, вызывает) — без ручного WASM-клея, без ручных FFI-определений, без «а я это не понимаю».
> Ключевой факт: **Bun имеет встроенный `bun:ffi` (dlopen)** — прямая загрузка `.so`/`.dll`/`.dylib` без WASM. Интерпретируемые языки (Ruby/Python/PHP) — через `Bun.spawn` + JSON-RPC по stdio; **Lua — встроенный интерпретатор** (dlopen liblua, C API, ноль IPC).
> Факты на старт: 0 тестов. Сейчас: **85 тестов native** (manifest 10 + rust 8 + ts 4 + runtime 5 + cli 5 + languages 31 + sidecar 16 + dev 8), `tsc --noEmit` чисто, 1845/1845 в полном прогоне (18 skip).

---

## Почему это нужно

Боль, которую закрывает фича (формулировка пользователя):

> «Ты вдруг создал в проекте `.rs` файл, а тебе сказали: „ой, а без WASM, который ты сам вручную не реализовал, я его не понимаю“»

То есть проблема — не в WASM как технологии, а в **ручном клее**: `#[no_mangle] pub extern "C"`, выписывание сигнатур, маршаллинг строк, написание FFI-определений в TS. Этот клей должен генерировать AsiJS.

| | WASM-путь (как у всех) | FFI-путь (наш) |
|---|---|---|
| Технология | wasm-bindgen, ручные биндинги | `bun:ffi` (dlopen) из коробки |
| Ручной клей | да (сложный) | **нет — генерится из манифеста** |
| Скорость | хорошая, но оверхед на границе | нативная, прямой вызов |
| Ограничения | WASM не видит хост-API напрямую | видит всё, что видит процесс |
| Языки | Rust (зрело), Go — больно | Rust, Go, C, Zig, C++ (компилируемые в .so); Ruby/Python/PHP — через sidecar |

---

## Актуальное состояние

| Аспект | Состояние |
|--------|-----------|
| `bun:ffi` в ядре | 🟢 Используется (rust/go/c/cpp/zig) |
| `Bun.spawn` sidecar | 🟢 Используется (python/ruby/php, JSON-RPC по stdio) |
| Встроенный интерпретатор | 🟢 Lua: dlopen liblua + C API (`src/native/lang/lua.ts`) |
| Native-скаффолдер | 🟢 `asi native scaffold <lang>` (11 языков) |
| Манифест / контракт | 🟢 `src/native/manifest.ts` |
| Генерация стабов | 🟢 Rust/Go/C/C++/Zig/Nim/Haskell + server.py/rb/php + lib.lua |
| Генерация TS-обёрток | 🟢 FFI + sidecar клиент + embedded Lua клиент |
| Sidecar (Ruby/Python/PHP) | 🟢 `src/native/sidecar.ts` + `generate-sidecar.ts` |
| Интеграция с `asi build`/`dev`/`analyze` | 🟡 build/list/info/inspect — да; hot reload (2.3) — нет |
| Тесты | 🟢 70 |

---

## P0 🔴 — MVP: `asi native` + Rust через bun:ffi (v1)

*Цель: пользователь создаёт нативный Rust-модуль и вызывает его из хендлера без единой строчки ручного клея. Это самый показательный кейс — остальные языки добавляются тем же механизмом.*

### 1.1 — Манифест как единый контракт ✅
- [x] **`native/manifest.json`** — истина: список функций + типы параметров/результата (в `src/native/manifest.ts`)
- [x] Формат: `{ name, lang, functions: [{ name, params, returns }] }` — типы: string/number/boolean/bytes/json
- [x] Валидация через TypeBox-схемы + человекочитаемые ошибки (`validateManifest`/`parseManifest`)
- [x] Автодетект языка: Cargo.toml → rust, go.mod → go, build.zig → zig, server.py/rb/php → python/ruby/php (`detectLanguage`)
- [x] `loadManifest`/`writeManifest`/`findNativeRoot` + round-trip тесты (10 тестов)

### 1.2 — Генерация Rust-стабов ✅
- [x] **`asi native scaffold rust`** — генерит `native/Cargo.toml` (cdylib + serde) и `native/src/lib.rs`
- [x] Rust-стабы: типизированные `pub fn <name>(...)` + JSON-маршаллинг в диспетчере — **пользователь пишет только тела** (`unimplemented!("implement <name>")`)
- [x] FFI-граница: `#[unsafe(no_mangle)] asijs_call` (JSON в / JSON out) + `asijs_free`, диспетчер по имени функции
- [x] Тесты: содержимое Cargo.toml/lib.rs, параметры по имени, баланс скобок (8 тестов)

### 1.3 — Генерация TS-обёрток (bun:ffi) ✅
- [x] Из того же манифеста — `native/src/generated.ts`: `dlopen` + типизированные методы
- [x] Маршаллинг: JSON-строка наружу/внутрь, NUL-terminated C-string, `asijs_free` в finally
- [x] Экспорт: `ctx.native.foo(params)` с типами из манифеста
- [x] Грация деградации: «Native library not found … run \"asi native build\"» вместо `dlopen failed`
- [x] Тесты: текст обёртки, маршаллинг, обработка ошибок (4 теста)

### 1.4 — Сборка и рантайм ✅
- [x] **`asi native build`** — `cargo build --release` в `native/` (с проверкой cargo и понятной ошибкой без него)
- [x] Кэширование: `.asi-native-cache`-маркер, `isStale`/`markBuilt` (mtime по manifest/Cargo.toml/src/**)
- [x] **`ctx.native`** — middleware `native()` (паттерн circuitBreaker), ленивая загрузка .so при первом вызове
- [x] Кросс-платформа: `.so`/`.dll`/`.dylib` через `platformLibExt()`, путь `<native>/target/release/lib<name><ext>`
- [x] Тесты: мок-dlopen roundtrip (add/sha256/reverse), ошибка при отсутствии .so, resolveLibPath, stale-цикл (5 тестов)

### 1.5 — Интеграция с CLI и дев-опытом ✅
- [x] `asi native` в диспетчере CLI + printHelp (scaffold/build/list/info)
- [x] `asi inspect` — секция **Native Module** + сводка в summary
- [x] `asi analyze` не трогает `native/` (сканирует только .ts/.tsx/.js/.jsx)
- [x] `asi native list` / `asi native info` (сводка + staleness)
- [x] Тесты: scaffold (создание файлов, отказ перезаписать), list, build/info с понятными ошибками (5 тестов)

### v1 — Definition of Done ✅
- [x] Пример end-to-end: Rust-функция `sha256` вызывается из хендлера `app.get("/hash")` — **проверено на реальном cargo**: `sha256('hello')` = `2cf24dba…b9824` через `ctx.native` (тест `scaffold + cargo build + dlopen round-trip`, 17s с первой сборкой)
- [x] Ноль ручного клея: пользователь пишет только тело Rust-функции + манифест
- [x] Все тесты зелёные (70 native: manifest 10 + rust 8 + ts 4 + runtime 5 + cli 5 + languages 24 + sidecar 16), `tsc --noEmit` чисто, 1833/1833 в полном прогоне (19 skip — тулчейны не установлены)
- [x] CI: `.github/workflows/ci.yml` — шаг Setup Rust (dtolnay/rust-toolchain) + кэш cargo registry + `bun test --timeout=120000` (native-тесты компилируют реальные модули)

---

## Языковая карта (кто как подключается)

`bun:ffi` — это не список языков, а **C ABI**: работает с любой shared library (`.so`/`.dll`/`.dylib`), язык внутри не важен. Поэтому способ подключения определяется не «языком вообще», а **формой поставки**: компилируется ли код в C ABI, является ли сам язык встраиваемым интерпретатором, или его проще держать подпроцессом.

### ✅ Полностью готовы — реализация + e2e-тесты активны на железе

| Язык | Категория | Что сделано | На железе для e2e |
|---|---|---|---|
| **Rust** | C ABI (`cargo build`) | генератор стабов `#[no_mangle]` + serde | ✅ 1.97.1 — **e2e с sha2 реально гоняется** (локально + CI) |
| **Go** | C ABI (`-buildmode=c-shared`) | генератор `main.go` + go build | ✅ 1.26.6 — **compile + dlopen-e2e активны** |
| **C** | C ABI (нативно) | генератор стабов `.c` + `cc -shared` | ✅ MSYS2 cc 16.1.0 — **compile + dlopen-e2e активны** |
| **C++** | C ABI (extern "C") | генератор `.cpp` + `-shared` | ✅ MSYS2 g++ 16.1.0 — **compile активен** |
| **Zig** | C ABI (`zig build`) | генератор `build.zig` + `src/lib.zig` (API 0.15–0.17-dev) | ✅ 0.17-dev — **compile + dlopen-e2e активны** |
| **Nim** | C ABI (`nim c --app:lib`) | генератор `lib.nim` (exportc + std/json диспетчер) | ✅ 2.2.10 — **compile + dlopen-e2e активны** |
| **Haskell** | C ABI (`ghc -shared -static`) | генератор `lib.hs` + `lib.def` (embedded mini-JSON, `foreign export`) | ✅ GHC 9.6.7 (GHCup) — **compile + dlopen-e2e активны** |
| **Lua** | 🟢 **встроенный интерпретатор** (dlopen liblua + C API) | генератор `lib.lua` (мини-JSON + диспетчер) + рантайм `lang/lua.ts` | ✅ Lua 5.5.0 (MSYS2 ucrt64) — **реальный e2e через lua55.dll активен** |
| **Python** | sidecar (Bun.spawn + JSON-RPC) | генератор `server.py` + клиент + lifecycle | ✅ 3.13.14 — **e2e через реальный spawn активен** |
| **Ruby** | sidecar | генератор `server.rb` + клиент (kwargs-стабы) | ✅ 4.0.6 — **e2e через реальный spawn активен** |
| **PHP** | sidecar | генератор `server.php` + клиент | ✅ 8.5.8 — **e2e через реальный spawn активен** |

### 🧪 Ждут e2e-тестов — реализация есть, тулчейн установлен, но полный прогон ещё не сделан

_Пусто — все реализованные языки полностью проверены._

### 🖥️ Тулчейн есть на железе — реализации пока нет

| Язык | Категория | Что нужно | На железе |
|---|---|---|---|
| **Java** | C ABI (native-image → .so) | генератор + тулчейн, **без JVM-процесса** | ⚠️ чистый Java 17 есть, но для C ABI нужен именно **GraalVM** (`native-image`) — обычный javac даёт байткод, а не shared library |
| **Luau (Roblox)** | 🟢 встроенный интерпретатор (как Lua) | тот же рантайм-слой с совместимым C API (бонус-таргет 2.4) | ⚠️ нет — не установлен |

### ⬜ Ничего нет — ни реализации, ни тулчейна

| Язык | Категория | Что нужно |
|---|---|---|
| **Odin / D / Crystal** | C ABI | тот же абстрактный генератор + своя команда сборки (⬜ P1, низкий приоритет) |
| **Kotlin/Native, Swift** | C ABI (native-компиляция) | генератор стабов + тулчейн (⬜ P1+) |
| **NativeAOT (C#)** | C ABI (native AOT → .so) | генератор + тулчейн, **без CLR-процесса** (⬜ P2, контракт-платформа) |
| **OCaml / Julia** | C ABI (FFI-stubs / ccall) | генератор стабов + тулчейн (⬜ P2) |
| **Perl / R / Tcl** | sidecar | генератор скрипта-сервера + клиент (⬜ P1+) |
| **ReScript / Dart / Kotlin/JS** | compile-to-JS (клиент) | биндинги из TypeBox в `generateClient` (⬜ P2, 3.2) |
| **Rust / Go / Ruby (серверный кодоген)** | контракт → каркас (axum/chi/Roda) | генератор серверного каркаса из TypeBox (⬜ P2, 3.1) |

> **Про тесты на железе:** compile/e2e-проверки делают `test.skipIf(!toolchainAvailable(...))` — если тулчейна нет, тест помечается `skip`. Все реализованные языки (Rust/C/C++/Zig/Go/Nim/Haskell/Python/Ruby/PHP) стоят на ПК и **полностью проверены**: dlopen round-trip (Rust/C/Zig/Go/Nim/Haskell) и реальный spawn (Python/Ruby/PHP) активны в тестах.

**Три вида нативной интеграции** (определяют реализацию):

1. **Скомпилированные функции** — пользовательский код компилируется в C ABI `.so`, вызов через FFI (Rust/Go/C/Zig/…). Нужен генератор стабов.
2. **Встроенные интерпретаторы** — сам интерпретатор — это `.so`, пользовательский код — скрипты внутри него (Lua). Нужен runtime-слой поверх C API интерпретатора, **генератор стабов не нужен**.
3. **Sidecar-процессы** — интерпретатор — отдельный подпроцесс, общение по stdio JSON-RPC (Python/Ruby/PHP). Нужен генератор скрипта-сервера + управление lifecycle.

---

## Гайды по языкам (что да как — заранее, не только после реализации)

Единый цикл для любого языка: **поставить тулчейн → `asi native scaffold <lang> <name>` → реализовать тела функций → `asi native build` (только для FFI) → `await ctx.native.<fn>(...)` → проверить `asi native test`**. Типы на границе везде одни: `string / number / boolean / bytes / json`; в sidecar `bytes` ездят как base64 (скрипт сам кодирует/декодирует по манифесту).

### FFI — скомпилированные языки (→ .so/.dll/.dylib через bun:ffi)

#### 🦀 Rust ✅
- **Поставить**: rustup (https://rustup.rs) — на железе уже есть; CI: `dtolnay/rust-toolchain` + кэш cargo
- **Scaffold**: `asi native scaffold rust my-crypto` → `native/Cargo.toml` (cdylib + serde) + `native/src/lib.rs`
- **Реализовать** (`src/lib.rs`, было `unimplemented!("implement add")`):
  ```rust
  pub fn add(a: f64, b: f64) -> f64 { a + b }
  ```
- **Собрать**: `asi native build` (= `cargo build --release`) → `target/release/lib<name>.so`
- **Использовать**: `await ctx.native.add(2, 3)`
- **Проверить**: `asi native test` — e2e с реальным cargo (sha256) есть в тестах + CI
- **Hot reload**: POSIX — пересборка + reload; **Windows — .so залочен, нужен рестарт** (watcher подскажет)
- **Нюанс**: cdylib на Windows даёт `name.dll` **без** `lib`-префикса — уже учтено в рантайме

#### 🐹 Go ✅
- **Поставить**: `winget install GoLang.Go` или msi с https://go.dev/dl/ — на железе ещё нет
- **Scaffold**: `asi native scaffold go my-crypto` → `native/go.mod` + `native/main.go` (`//export asijs_call/asijs_free`, диспетчер на encoding/json)
- **Реализовать** (`main.go`, было `panic("implement add")`):
  ```go
  func add(a float64, b float64) float64 { return a + b }
  ```
- **Собрать**: `asi native build` (= `go build -buildmode=c-shared -o target/release/lib<name>.so .`; на Windows — `<name>.dll`)
- **Использовать**: `await ctx.native.add(2, 3)`
- **Проверить**: `asi native test` + compile-проверка + **dlopen-e2e** (активны, go 1.26.6)
- **Hot reload**: как Rust (POSIX ок / Windows рестарт)
- **Нюанс**: `-buildmode=c-shared` генерит ещё `<name>.h` рядом — не мешает, можно игнорировать

#### 🇨 C ✅
- **Поставить**: gcc/clang (MSYS2 `cc` уже есть на железе)
- **Scaffold**: `asi native scaffold c my-crypto` → `native/lib.c` со **встроенным мини-JSON** (~150 строк, валиден и в C, и в C++) — у C нет стандартной JSON-библиотеки, граница вшита в шаблон
- **Реализовать** (`lib.c`, было `return 0.0;` после `// TODO: implement the body of add`):
  ```c
  static double fn_add(double a, double b) { return a + b; }
  ```
- **Собрать**: `asi native build` (= `cc -shared -fPIC -O2 -o target/release/lib<name>.so lib.c`)
- **Использовать**: `await ctx.native.add(2, 3)`
- **Проверить**: `asi native test` + compile-тесты `cc`/`c++` активны (тулчейн есть)
- **Hot reload**: как Rust
- **Нюанс**: строки/bytes на границе — C-строки, диспетчер сам собирает JSON; внимательно с `\0`-терминатором (уже учтено в рантайме)

#### ➕ C++ ✅
- **Поставить**: g++/clang++ (MSYS2 `g++` уже есть)
- **Scaffold**: `asi native scaffold cpp my-crypto` → `native/lib.cpp` — тот же мини-JSON + `extern "C"`-обёртка FFI
- **Реализовать** (`lib.cpp`, было `return 0; // TODO: ...`):
  ```cpp
  static double fn_add(double a, double b) { return a + b; }
  ```
- **Собрать**: `asi native build` (= `c++ -shared -fPIC -O2 -o target/release/lib<name>.so lib.cpp`)
- **Использовать**: `await ctx.native.add(2, 3)`
- **Проверить**: `asi native test` + compile-тест `c++` активен
- **Hot reload**: как Rust
- **Нюанс**: для своих helper-классов — не забывай `static`/`extern "C"` только на границе FFI

#### ⚡ Zig ✅
- **Поставить**: `winget install zig.zig` или zip с https://ziglang.org/download/ (распаковать, добавить в PATH) — ✅ есть (0.17-dev)
- **Scaffold**: `asi native scaffold zig my-crypto` → `native/build.zig` + `native/src/lib.zig` (std.json — свой JSON не нужен)
- **Реализовать** (`src/lib.zig`, было `return 0;` после `// TODO: implement the body of add`):
  ```zig
  pub fn add(a: f64, b: f64) f64 { return a + b; }
  ```
- **Собрать**: `asi native build` (= `zig build -Doptimize=ReleaseFast`)
- **Использовать**: `await ctx.native.add(2, 3)`
- **Проверить**: `asi native test` + compile-проверка + **dlopen-e2e** (активны, zig 0.17-dev)
- **Hot reload**: как Rust
- **Нюанс**: нужен **Zig 0.15–0.17** — на более старых версиях работать не будет (шаблон использует новый `addLibrary`/`createModule` API). Проверено реальной сборкой + dlopen на 0.17-dev.

### Sidecar — интерпретируемые языки (Bun.spawn + JSON-RPC по stdio)

#### 🐍 Python ✅
- **Поставить**: https://www.python.org/downloads/ (Windows: `python`, POSIX: `python3`) — на железе уже есть (3.13)
- **Scaffold**: `asi native scaffold python py_calc` → `native/server.py` (стабы + диспетчер + таблицы типов) + `native/src/generated.ts`
- **Реализовать** (`server.py`, было `raise NotImplementedError("implement add")`):
  ```python
  def add(a, b):
      return a + b
  ```
- **Собрать**: НЕ нужно — `asi native build` просто проверит интерпретатор («✓ Sidecar ready»)
- **Использовать**: `await ctx.native.add(2, 3)`
- **Проверить**: `asi native test` — e2e с реальным spawn активен
- **Hot reload**: ✅ полноценный на любой ОС (процесс перезапускается на следующем вызове)
- **Нюансы**: `bytes`-параметр придёт как `bytes` (base64 раскодирован скриптом), верни `bytes` — скрипт закодирует обратно; reserved words эскейпятся суффиксом `_` (напр. `from_`)

#### 💎 Ruby ✅
- **Поставить**: `winget search RubyInstallerTeam.Ruby` (последняя 3.x) или exe с https://rubyinstaller.org/ — на железе ещё нет
- **Scaffold**: `asi native scaffold ruby my-calc` → `native/server.rb`
- **Реализовать** (`server.rb`, было `raise NotImplementedError, "implement add"`):
  ```ruby
  def add(a, b)
    a + b
  end
  ```
- **Собрать**: не нужно — spawn `ruby server.rb`
- **Использовать**: `await ctx.native.add(2, 3)`
- **Проверить**: `asi native test` (e2e включится после установки ruby)
- **Hot reload**: ✅ полноценный
- **Нюансы**: киворды эскейпятся; bytes-результат — верни бинарную строку (encoding BINARY) — скрипт закодирует в base64

#### 🐘 PHP ✅
- **Поставить**: `winget install PHP.PHP.8.4` или zip с https://windows.php.net/download/ (распаковать, в PATH) — на железе ещё нет
- **Scaffold**: `asi native scaffold php my-calc` → `native/server.php` (с `declare(strict_types=1)`)
- **Реализовать** (`server.php`, было `throw new RuntimeException("implement add")`):
  ```php
  function add($a, $b) {
      return $a + $b;
  }
  ```
- **Собрать**: не нужно — spawn `php server.php`
- **Использовать**: `await ctx.native.add(2, 3)`
- **Проверить**: `asi native test` (e2e включится после установки php)
- **Hot reload**: ✅ полноценный
- **Нюансы**: вызов через `call_user_func_array` с именованными ключами (PHP 8); bytes-параметр приходит `base64_decode`-нутым

### 🎲 Lua ✅ (2.4) — встроенный интерпретатор, вариант А
- **Механизм**: НЕ компилируется — dlopen `liblua` через bun:ffi и вызов C API интерпретатора (`luaL_newstate`, `luaL_openselectedlibs`, `luaL_loadstring`, `lua_pcallk`, `lua_close`) из того же процесса. Ноль IPC, ноль WASM
- **Поставить**: MSYS2 (уже стоит) — `pacman -S mingw-w64-ucrt-x86_64-lua`; на Linux/macOS — системная `liblua.so`; или `ASI_LUA_LIB=/path/to/lua55.dll`
- **Scaffold**: `asi native scaffold lua my-rules` → манифест `lang: "lua"` + `native/lib.lua` с глобальными функциями + `src/generated.ts`
- **Реализация**: пользователь пишет только тела Lua-функций (`function add(a, b) return a + b end`); шлюз (мини-JSON + диспетчер) генерится
- **Нюанс**: стабы не компилируются — интерпретатор сам вызывает функции по имени; Lua 5.5 биндится по базовым C-символам (макросы в заголовках не экспортируются); `lib.lua` перечитывается при hot-reload — правки подхватываются без рестарта

### В планах (предпросмотр — чтобы знать заранее)

#### 🧬 Nim / Odin / D / Crystal ⬜ P1 (низкий приоритет)
- **Механизм**: C ABI — компиляция в `.so` с экспортом C-символов, тот же абстрактный генератор (реестр уже готов — добавится ~30 мин на язык)
- ~~**Nim** — был первым в очереди~~ ✅ **готов** (2.2.10): генератор + compile + dlopen-e2e активны
- **Odin / D / Crystal** — остаются по мере надобности

#### 🍎 Kotlin/Native, Swift ⬜ P1+ (низкий приоритет)
- **Механизм**: C ABI (native-компиляция) → `.so`; нужен генератор стабов + тулчейн (Kotlin/Native, Swift toolchain)
- **Понадобится**: KMP/Swift toolchain — ставь только когда дойдём до реализации

#### ☕ GraalVM (Java) / .NET NativeAOT (C#) ⬜ P2
- **Механизм**: `native-image` → `.so` — **без JVM/CLR-процесса**; Java и C# тоже можно дёргать через bun:ffi
- **Понадобится**: GraalVM CE / .NET SDK с NativeAOT — объёмный тулчейн, ставь ближе к реализации

#### 🐢 Haskell / OCaml / Julia ⬜ P2 (низкий приоритет)
- ~~**Haskell**~~ ✅ **готов** (GHC 9.6.7): генератор `lib.hs` + `lib.def` (мини-JSON, `foreign export ccall`), compile + dlopen-e2e активны
- **OCaml / Julia** — остаются по мере надобности: C ABI (FFI-stubs / `ccall`); генератор стабов + тулчейн

#### 🦈 Perl / R / Tcl ⬜ P1+
- **Механизм**: sidecar (тот же JSON-RPC по stdio) — добавится тем же генератором, что Python/Ruby/PHP

#### 🧩 ReScript / Dart / Kotlin/JS ⬜ P2 (3.2)
- **Механизм**: НЕ нативные модули — compile-to-JS (клиентская сторона): `generateClient` из OpenAPI-спеки → модули на ReScript/Dart/Kotlin/JS; компилятор языка даёт JS

#### 🏗️ Контракт → серверный каркас (Rust axum / Go chi / Ruby Roda) ⬜ P2 (3.1)
- **Механизм**: TypeBox-контракт генерит не стабы, а целый серверный каркас — «спека живёт в AsiJS, исполняется нативно»

---

## P1 🟠 — Расширение языков + sidecar (v2)

*Цель: «любой язык» без WASM. Компилируемые — через FFI, интерпретируемые — через sidecar-процесс, Lua — через встроенный интерпретатор.*

### 2.1 — Больше компилируемых языков (тот же механизм FFI) ✅
- [x] **Go**: `-buildmode=c-shared`, `//export` + encoding/json — генерация `go.mod` + `main.go` (`src/native/generate-go.ts`)
- [x] **C**: `cc -shared` — генерация `lib.c` со **встроенным мини-JSON** (парсер + сериализатор, ~150 строк, валиден C & C++) — C не имеет стандартной JSON-библиотеки, поэтому граница встроена в шаблон (`src/native/generate-c.ts`)
- [x] **C++**: `c++ -shared` — тот же C-язык с `extern "C"`-обёрткой FFI (`lib.cpp`)
- [x] **Zig**: `zig build` — `build.zig` + `src/lib.zig` на std.json (`src/native/generate-zig.ts`)
- [x] **Единый абстрактный генератор** — `src/native/generators.ts`: `{ lang, label, toolchain, files, build, libBaseName, stubFile }` — реестр rust/go/c/cpp/zig, scaffold/build работают единообразно для всех языков
- [x] CLI: `asi native scaffold <go|c|cpp|zig>` генерит стабы; `asi native build` использует toolchain-чек + команду из реестра
- [x] Тесты: снапшоты стабов всех 4 языков + **реальные compile-проверки** (cc/c++/zig, если тулчейн есть) + **e2e round-trip через dlopen** (генерация → компиляция → bun:ffi вызов → результат)
- [x] Найдены и исправлены по пути: отсутствие NUL-терминатора в payload (C-функции ждут C-строку), чтение указателя через `CString` (bun:ffi возвращает number-указатель, не Buffer), обёртка `{ok, result}` в C-диспетчере, инициализация буфера сериализатора

### 2.2 — Sidecar для интерпретируемых языков (Ruby/Python/PHP) ✅
- [x] **JSON-RPC по stdio** через `Bun.spawn` (`src/native/sidecar.ts`): клиент спавнит `python3 server.py` / `ruby server.rb` / `php server.php`, одна JSON-строка на запрос/ответ, id-корреляция параллельных вызовов
- [x] Генерация скрипта-сервера из манифеста (`src/native/generate-sidecar.ts`): `server.py`/`server.rb`/`server.php` — стабы + диспетчер + таблицы типов параметров/результатов (bytes ездят как base64, типизировано по манифесту), пользователь пишет только тела; эскейп reserved words (python/ruby/php)
- [x] Типизированный клиент: тот же `ctx.native.foo(...)` (ветвление в `loadNativeModule`), плюс генерация `src/generated.ts` — `createSidecarClient` + типизированный интерфейс
- [x] Управление жизненным циклом: ленивый spawn при первом вызове, `close()` убивает процесс, рестарт при краше с экспоненциальным backoff (сброс после успешного roundtrip), понятные ошибки при отсутствии интерпретатора
- [x] Ограничения документированы: оверхед IPC, нет общей памяти — sidecar для интерпретируемых, FFI для компилируемых
- [x] Тесты: снапшоты скриптов 3 языков, mock-spawn JSON-RPC roundtrip (числа/строки/bytes/ошибки/корреляция id), рестарт при краше, backoff, реальный Python e2e через `loadNativeModule` (add/reverse/echoBytes/ошибка NotImplemented)
- [x] Найден и исправлен по пути: Bun `FileSink.write` буферизует — теперь await'ится флаш перед ожиданием ответа; **баг bun:test на Windows**: `expect(promise).rejects` вешает реальный Bun.spawn-pipe (работает только ручной try/catch — в тесте задокументировано)

### 2.3 — Дев-экспириенс v2 ✅
- [x] **Hot reload нативных модулей** (`src/native/watch.ts` + middleware): `native({ hotReload: true })` следит за `native/`, пересобирает FFI-языки (`spawnSync` build с debounce) и подменяет модуль **без рестарта сервера**; sidecar (python/ruby/php) перезапускает интерпретатор на следующем вызове — работает на любой ОС. FFI на Windows: build падает на заблокированном .so → понятное сообщение «пересобери и рестартни». Ignore-список: `target/`, `.asi-native-cache`, `generated.ts`, `node_modules` — чтобы не было циклов от собственной сборки. Standalone-хелпер `watchNativeModule()` экспортирован
- [x] **Понятные ошибки**: manifest invalid — теперь с полным путём к `native/`; dlopen-фейл — «если библиотека устарела, запусти `asi native build`»; старые ошибки («cargo не найден» с hint, «функция X не экспортирована») уже были
- [x] **`asi native test`** — smoke-прогон каждой функции из манифеста с sample-аргументами по типам (`sampleNativeArg`): `✓ pass` / `◌ stub (TODO)` / `✗ fail`, exit 1 только на реальных фейлах; `runNativeTest()` экспортирован программно
- [x] Dev-подсказки: `asi dev` и `devMode()` печатают «🦀 Native module detected — use native({ hotReload: true })» при наличии `native/manifest.json`
- [x] Тесты (8): watcher reload на изменение server.py, ignore-пути не триггерят, stop() закрывает watcher, **middleware e2e: изменение python-функции подхватывается без рестарта** (2+3=5 → +100 = 105), invalid manifest с путём, stale-lib ошибка, runNativeTest pass/stub/fail + реальный python

### 2.4 — Lua: встроенный интерпретатор через dlopen liblua (вариант А) 🟢

*Решение принято: **вариант А** — dlopen `liblua.so` через bun:ffi и вызов C API интерпретатора прямо из процесса. Ноль IPC, ноль WASM, один процесс. Это третий вид нативной интеграции (встроенный интерпретатор) — первый на Lua.*

Почему А, а не B/C:
- **B (sidecar)** — лишний процесс и IPC-оверхед; Lua и так спроектирован для встраивания
- **C (fengari, JS-порт)** — медленнее, ограничен, и не демонстрирует нашу фичу «нативно без WASM»

> 🟢 **Lua 5.5 уже стоит на ПК** (MSYS2 ucrt64): `lua55.dll`, `liblua.dll.a` и заголовки на месте — можно приступать к реализации без установки чего-либо.

- [x] **Доставка liblua**: `findLuaLib()` — `ASI_LUA_LIB` env → MSYS2 пути (любой диск: `C:`–`F:`, ucrt64/mingw64) на Windows / системные lib-директории на POSIX → bare-имя для loader'а. Без отдельного `asi native add` — рантайм сам находит liblua
- [x] **Рантайм-слой `src/native/lang/lua.ts`**: dlopen + C API обёртки. Lua 5.5 экспортирует **только базовые символы** — макросы `lua_pcall`/`lua_pop`/`luaL_dostring`/`luaL_openlibs`/`lua_tostring` в заголовках, поэтому биндятся `lua_pcallk`, `lua_settop`, `luaL_loadstring`, `luaL_openselectedlibs`, `lua_tolstring` (+ `luaL_newstate`, `lua_getglobal`, `lua_pushstring`, `lua_close`); строки на границе — NUL-terminated Buffer'ы (bun:ffi не принимает `cstring`-аргументы в этой версии, только `ptr`)
- [x] **Манифест**: `lang: "lua"` (в `NativeLanguage`, TypeBox-схеме, `validateManifest`, `detectLanguage` по `lib.lua`) — функции из манифеста → глобальные функции в Lua-скрипте; эскейп Lua reserved words (`end` → `end_`)
- [x] **Генератор Lua-шлюза** (`src/native/generate-lua.ts`): `lib.lua` со встроенным **мини-JSON кодеком на чистом Lua** (Lua не имеет JSON в stdlib: объекты/массивы/строки с `\uXXXX`-эскейпами/числа/boolean/null), стабами `function add(a, b) error("implement add") end` и диспетчером `asijs_call(input)` — JSON-граница `{"fn","args"}` → `{"ok","result"|"error"}` с проверками типов параметров
- [x] **`ctx.native` для Lua**: тот же интерфейс через `loadNativeModule` (`isEmbeddedLanguage` → `createLuaModule`) — `ctx.native.roll_dice()` работает как у Rust; `src/generated.ts` — типизированный embedded-Lua клиент
- [x] **`asi native build` для lua** — без компиляции («✓ Embedded interpreter ready» + предупреждение, если liblua не найдена); `asi native test` гоняет функции через реальный интерпретатор
- [ ] **Luau (Roblox)** как бонус-таргет того же рантайма (совместимый C API) — остаётся: нужен тулчейн Luau на железе
- [x] Тесты (7): снапшоты `lib.lua` (стабы, диспетчер, эскейп reserved words, типы), `findLuaLib` на реальной машине, **реальный e2e через lua55.dll** (`add`/`greet`/`hash_bytes`/`pass_through` round-trip через `loadNativeModule`), stub-ошибки и ошибки типов → JS-ошибки

---

## P2 🟡 — Контракт-платформа + экосистема (v3)

*Цель: AsiJS — источник истины, а языки — исполняющие стороны. Контракт генерирует всё.*

### 3.1 — Контракт как граница языка
- [ ] **`api({...})` из TypeBox** → REST + RPC + MCP + OpenAPI (уже в основном TODO) **+ native-биндинги для любого языка**
- [ ] Одна TypeBox-схема → Rust-структуры + serde, Go-struct + json, Python-dataclass — автоматически
- [ ] Генерация **серверных каркасов** на Rust (axum) / Go (chi) / Ruby (Roda) из того же контракта — «спека живёт в AsiJS, исполняется нативно»
- [ ] Тесты: контракт → код на 3 языках, типы совпадают

### 3.2 — Compile-to-JS языки (клиентская сторона, без WASM)
- [ ] `generateClient` (сейчас только TS) → **ReScript-модули**, **Dart-классы**, **Kotlin/JS** из OpenAPI-спеки
- [ ] Пользователь пишет хендлеры на ReScript/Dart → компилятор языка даёт JS → AsiJS-контракт гарантирует типы
- [ ] Тесты: генерация биндингов, пример end-to-end с ReScript-модулем (если компилятор в CI)

### 3.3 — WinterCG-сборка (мостик к «один бандл везде»)
- [ ] `asi build --target wintercg` (из основного TODO 3.4) — pure-Web-API entry без Bun-зависимостей
- [ ] После этого — один и тот же AsiJS-бандл в любом WASM-хосте (опционально, не приоритет)
- [ ] Бенчмарк «native hot path»: Rust-функция через FFI против чистого TS — показать выигрыш

### 3.4 — Позиционирование
- [ ] README-секция «Native / Polyglot»: таблица языков (FFI / sidecar / compile-to-JS / codegen-каркас)
- [ ] Доки: `docs/features/native.md` + примеры для каждого пути
- [ ] Бенчмарк-сценарий в `bench/` (FFI vs TS vs WASM) — аргумент для маркетинга

---

## Открытые вопросы

1. **Манифест vs конфиг**: отдельный `native/manifest.json` или секция в `asi.config.ts`? (склоняюсь к config — уже есть резолв, env, типы)
2. **Маршаллинг**: JSON-строка на границе (просто, медленнее) vs прямые типы FFI (быстрее, но генерация сложнее). v1 — JSON, v2 — опция `direct: true` для скаляров
3. **Node.js-поддержка**: `bun:ffi` нет в Node → для Node-адаптера native-модули работать не будут (документировать ограничение) или использовать `node-ffi-rs` как fallback?
4. **Безопасность**: `.so` из `native/` — это произвольный код. Оставляем как есть (dev-инструмент) или песочница в v3?
5. **Когда cargo/go недоступны в CI**: снапшот-тесты текста стабов + мок dlopen, интеграционные — с флагом `--no-skip` в CI с установленными тулчейнами

---

## Связанные пункты основного TODO.md

- [ ] `3.4 — Edge-Native Bundle (WinterCG+)` — pure-Web-API entry (нужен для 3.3)
- [ ] Contract Layer (`api({...})` → REST + RPC + MCP + OpenAPI + SDK + mock) — база для 3.1
- [ ] Official SDK generator (клиенты на TS/Python/Go/Rust) — синергия с 3.2
