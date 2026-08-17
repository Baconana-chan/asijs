/**
 * Native / Polyglot Modules — Lua gateway generator (2.4)
 *
 * Lua runs as an **embedded interpreter** (variant A): the runtime dlopen's
 * liblua itself (`lua55.dll` / `liblua.so`) and drives it through its C API
 * in-process — no compilation, no sidecar process. The generated `lib.lua`
 * is the gateway: a mini JSON codec (Lua has no built-in JSON) plus typed
 * stubs for the manifest functions plus a dispatcher (`asijs_call`) that
 * reads a JSON request, calls the user function by name and returns a JSON
 * response.
 *
 * The user implements only the function bodies; everything else is generated.
 */

import type { NativeManifest, NativeTypeName } from "./manifest";
import { tsTypeName } from "./manifest";

// ============================================================================
// Identifier safety (Lua reserved words)
// ============================================================================

const LUA_KEYWORDS = new Set([
  "and", "break", "do", "else", "elseif", "end", "false", "for", "function",
  "goto", "if", "in", "local", "nil", "not", "or", "repeat", "return", "then",
  "true", "until", "while",
]);

/** Make an identifier safe for Lua (reserved words get a `_` suffix). */
function safeIdent(name: string): string {
  return LUA_KEYWORDS.has(name) ? `${name}_` : name;
}

// ============================================================================
// Shared building blocks
// ============================================================================

/** One stub per manifest function. */
function stubLines(manifest: NativeManifest): string[] {
  const lines: string[] = [];
  for (const fn of manifest.functions) {
    const params = Object.entries(fn.params)
      .map(([n]) => safeIdent(n))
      .join(", ");
    lines.push(`-- TODO: implement the body of ${fn.name}`);
    lines.push(`function ${safeIdent(fn.name)}(${params})`);
    lines.push(`  error("implement ${fn.name}")`);
    lines.push(`end`);
    lines.push(``);
    lines.push(``);
  }
  return lines;
}

/** The dispatcher tables: PARAM_TYPES, PARAM_ORDER, RETURN_TYPES, HANDLERS. */
function dispatcherTables(manifest: NativeManifest): string[] {
  const lines: string[] = [];
  lines.push(`-- ====== dispatcher tables (generated) ======`);
  lines.push(`local PARAM_TYPES = {`);
  for (const fn of manifest.functions) {
    const params = Object.entries(fn.params)
      .map(([n, t]) => `[${JSON.stringify(n)}] = ${JSON.stringify(t)}`)
      .join(", ");
    lines.push(`  [${JSON.stringify(fn.name)}] = { ${params} },`);
  }
  lines.push(`}`);
  lines.push(``);
  lines.push(`local PARAM_ORDER = {`);
  for (const fn of manifest.functions) {
    const names = Object.keys(fn.params).map((n) => JSON.stringify(n)).join(", ");
    lines.push(`  [${JSON.stringify(fn.name)}] = { ${names} },`);
  }
  lines.push(`}`);
  lines.push(``);
  lines.push(`local RETURN_TYPES = {`);
  for (const fn of manifest.functions) {
    lines.push(`  [${JSON.stringify(fn.name)}] = ${JSON.stringify(fn.returns)},`);
  }
  lines.push(`}`);
  lines.push(``);
  lines.push(`local HANDLERS = {`);
  for (const fn of manifest.functions) {
    lines.push(`  [${JSON.stringify(fn.name)}] = ${safeIdent(fn.name)},`);
  }
  lines.push(`}`);
  lines.push(``);
  lines.push(``);
  return lines;
}

// ============================================================================
// Mini JSON codec (pure Lua, no dependencies)
// ============================================================================

/**
 * The generated script embeds a compact JSON codec because Lua has no
 * built-in JSON. Supported: objects, arrays, strings (incl. \\uXXXX escapes),
 * numbers, booleans and null. UTF-8 strings pass through untouched; \u
 * escapes decode to UTF-8 (BMP; surrogate pairs are not joined).
 */
const MINI_JSON = `-- ====== mini JSON codec (pure Lua) ======
local json = {}
json.null = {} -- sentinel for JSON null (nil is "missing")

local function encode_value(v)
  local t = type(v)
  if v == json.null then return "null" end
  if t == "nil" then return "null" end
  if t == "boolean" then return v and "true" or "false" end
  if t == "number" then
    if v ~= v or v == math.huge or v == -math.huge then return "null" end
    if v == math.floor(v) and math.abs(v) < 1e15 then
      return string.format("%d", v)
    end
    return string.format("%.17g", v)
  end
  if t == "string" then
    -- byte-wise escaping: JSON-safe for control chars, passes UTF-8 through
    local out = {}
    for bi = 1, #v do
      local b = v:byte(bi)
      if b == 34 then out[#out + 1] = '\\\\"'
      elseif b == 92 then out[#out + 1] = "\\\\\\\\"
      elseif b == 10 then out[#out + 1] = "\\\\n"
      elseif b == 13 then out[#out + 1] = "\\\\r"
      elseif b == 9 then out[#out + 1] = "\\\\t"
      elseif b < 32 then out[#out + 1] = string.format("\\\\u%04x", b)
      else out[#out + 1] = v:sub(bi, bi) end
    end
    return '"' .. table.concat(out) .. '"'
  end
  if t == "table" then
    local count, maxk = 0, 0
    local is_arr = true
    for k in pairs(v) do
      count = count + 1
      if type(k) ~= "number" or k < 1 then is_arr = false break end
      if k > maxk then maxk = k end
    end
    if is_arr and count == maxk then
      local parts = {}
      for i = 1, maxk do parts[i] = encode_value(v[i]) end
      return "[" .. table.concat(parts, ",") .. "]"
    end
    local parts = {}
    for k, val in pairs(v) do
      if type(k) == "string" then
        parts[#parts + 1] = encode_value(k) .. ":" .. encode_value(val)
      end
    end
    return "{" .. table.concat(parts, ",") .. "}"
  end
  return "null"
end

local function skip_ws(s, i)
  while i <= #s and string.find(" \\t\\n\\r", s:sub(i, i), 1, true) do i = i + 1 end
  return i
end

local function decode_string(s, i)
  i = i + 1 -- skip opening quote
  local out = {}
  while i <= #s do
    local c = s:sub(i, i)
    if c == '"' then return table.concat(out), i + 1 end
    if c == "\\\\" then
      local e = s:sub(i + 1, i + 1)
      if e == "n" then out[#out + 1] = "\\n"
      elseif e == "t" then out[#out + 1] = "\\t"
      elseif e == "r" then out[#out + 1] = "\\r"
      elseif e == "b" then out[#out + 1] = "\\b"
      elseif e == "f" then out[#out + 1] = "\\f"
      elseif e == "/" then out[#out + 1] = "/"
      elseif e == "\\\\" then out[#out + 1] = "\\\\"
      elseif e == '"' then out[#out + 1] = '"'
      elseif e == "u" then
        local hex = s:sub(i + 2, i + 5)
        local code = tonumber(hex, 16)
        if code and code >= 0 and code <= 0x10FFFF then
          if code < 0x80 then
            out[#out + 1] = string.char(code)
          elseif code < 0x800 then
            out[#out + 1] = string.char(
              0xC0 + math.floor(code / 0x40),
              0x80 + code % 0x40
            )
          else
            out[#out + 1] = string.char(
              0xE0 + math.floor(code / 0x1000),
              0x80 + math.floor(code / 0x40) % 0x40,
              0x80 + code % 0x40
            )
          end
        end
        i = i + 4
      end
      i = i + 1
    else
      out[#out + 1] = c
      i = i + 1
    end
  end
  error("json: unterminated string")
end

local function decode_value(s, i)
  i = skip_ws(s, i)
  local c = s:sub(i, i)
  if c == "{" then
    local obj = {}
    i = skip_ws(s, i + 1)
    if s:sub(i, i) == "}" then return obj, i + 1 end
    while true do
      local key, ni = decode_string(s, i)
      i = skip_ws(s, ni)
      if s:sub(i, i) == ":" then i = skip_ws(s, i + 1) end
      local val, nv = decode_value(s, i)
      i = skip_ws(s, nv)
      if val ~= json.null then obj[key] = val end
      local sep = s:sub(i, i)
      if sep == "," then
        i = skip_ws(s, i + 1)
      elseif sep == "}" then
        return obj, i + 1
      else
        error("json: expected , or }")
      end
    end
  elseif c == "[" then
    local arr = {}
    i = skip_ws(s, i + 1)
    if s:sub(i, i) == "]" then return arr, i + 1 end
    while true do
      local val, nv = decode_value(s, i)
      i = skip_ws(s, nv)
      arr[#arr + 1] = val == json.null and nil or val
      local sep = s:sub(i, i)
      if sep == "," then
        i = skip_ws(s, i + 1)
      elseif sep == "]" then
        return arr, i + 1
      else
        error("json: expected , or ]")
      end
    end
  elseif c == '"' then
    return decode_string(s, i)
  elseif s:sub(i, i + 3) == "true" then
    return true, i + 4
  elseif s:sub(i, i + 4) == "false" then
    return false, i + 5
  elseif s:sub(i, i + 3) == "null" then
    return json.null, i + 4
  else
    local j = i
    while j <= #s and string.find("-+0123456789.eE", s:sub(j, j), 1, true) do
      j = j + 1
    end
    local num = tonumber(s:sub(i, j - 1))
    if num == nil then error("json: bad number") end
    return num, j
  end
end

function json.encode(v)
  return encode_value(v)
end

function json.decode(s)
  local v, i = decode_value(s, 1)
  i = skip_ws(s, i)
  if i <= #s then error("json: trailing characters") end
  return v
end

`;

// ============================================================================
// Gateway generation
// ============================================================================

/**
 * Generate `lib.lua` — stubs + mini JSON + dispatcher for the manifest
 * functions. The user implements only the function bodies.
 */
export function generateLuaLib(manifest: NativeManifest): string {
  const lines: string[] = [];
  lines.push(`-- Auto-generated by AsiJS — DO NOT EDIT the dispatcher below.`);
  lines.push(`-- Implement the function bodies, then run your app: AsiJS embeds`);
  lines.push(`-- liblua via bun:ffi and calls these functions directly (no build).`);
  lines.push(``);
  lines.push(``);
  lines.push(MINI_JSON.trimEnd());
  lines.push(``);
  lines.push(`-- ====== user functions ======`);
  lines.push(``);
  lines.push(...stubLines(manifest));
  lines.push(...dispatcherTables(manifest));
  lines.push(`-- ====== JSON-RPC boundary ======`);
  lines.push(`-- Input:  {"fn": "...", "args": {...}}`);
  lines.push(`-- Output: {"ok": true, "result": ...} | {"ok": false, "error": "..."}`);
  lines.push(`function asijs_call(input)`);
  lines.push(`  local ok, req = pcall(json.decode, input)`);
  lines.push(`  if not ok then`);
  lines.push(`    return json.encode({ ok = false, error = "invalid JSON: " .. tostring(req) })`);
  lines.push(`  end`);
  lines.push(`  local fn = req.fn`);
  lines.push(`  local handler = HANDLERS[fn]`);
  lines.push(`  if not handler then`);
  lines.push(`    return json.encode({ ok = false, error = "unknown function: " .. tostring(fn) })`);
  lines.push(`  end`);
  lines.push(`  local args = req.args or {}`);
  lines.push(`  local types = PARAM_TYPES[fn] or {}`);
  lines.push(`  local order = PARAM_ORDER[fn] or {}`);
  lines.push(`  local call_args = {}`);
  lines.push(`  for i, name in ipairs(order) do`);
  lines.push(`    local v = args[name]`);
  lines.push(`    if v == nil then`);
  lines.push(`      return json.encode({ ok = false, error = "[" .. fn .. "] param \\"" .. name .. "\\": missing" })`);
  lines.push(`    end`);
  lines.push(`    local t = types[name]`);
  lines.push(`    if t == "number" and type(v) ~= "number" then`);
  lines.push(`      return json.encode({ ok = false, error = "[" .. fn .. "] param \\"" .. name .. "\\": expected number" })`);
  lines.push(`    end`);
  lines.push(`    if t == "string" and type(v) ~= "string" then`);
  lines.push(`      return json.encode({ ok = false, error = "[" .. fn .. "] param \\"" .. name .. "\\": expected string" })`);
  lines.push(`    end`);
  lines.push(`    if t == "boolean" and type(v) ~= "boolean" then`);
  lines.push(`      return json.encode({ ok = false, error = "[" .. fn .. "] param \\"" .. name .. "\\": expected boolean" })`);
  lines.push(`    end`);
  lines.push(`    call_args[i] = v`);
  lines.push(`  end`);
  lines.push(`  local ok2, res = pcall(handler, table.unpack(call_args))`);
  lines.push(`  if not ok2 then`);
  lines.push(`    return json.encode({ ok = false, error = tostring(res) })`);
  lines.push(`  end`);
  lines.push(`  if RETURN_TYPES[fn] == "bytes" and type(res) == "string" then`);
  lines.push(`    local arr = {}`);
  lines.push(`    for bi = 1, #res do arr[bi] = string.byte(res, bi) end`);
  lines.push(`    res = arr`);
  lines.push(`  end`);
  lines.push(`  return json.encode({ ok = true, result = res })`);
  lines.push(`end`);
  lines.push(``);
  return lines.join("\n");
}

// ============================================================================
// TypeScript client (direct use, mirrors the ctx.native interface)
// ============================================================================

/** JS-identifier-safe PascalCase for a module name. */
function pascalName(name: string): string {
  const ident = name.replace(/[^a-zA-Z0-9_]/g, "_");
  return ident.charAt(0).toUpperCase() + ident.slice(1);
}

/**
 * Generate `src/generated.ts` for an embedded Lua module — a typed wrapper
 * around `loadNativeModule`. Same shape as the FFI wrapper; functions are
 * synchronous (no IPC, no process).
 */
export function generateLuaTsClient(manifest: NativeManifest): string {
  const header = `// Auto-generated by AsiJS — DO NOT EDIT
// Lua client for "${manifest.name}" (embedded interpreter via liblua).
// Regenerate with: asi native build
`;
  const lines: string[] = [];
  lines.push(header);
  lines.push(``);
  lines.push(`import { loadNativeModule, type NativeModule } from "asijs/native";`);
  lines.push(``);
  lines.push(`export interface ${pascalName(manifest.name)}Functions {`);
  for (const fn of manifest.functions) {
    const params = Object.entries(fn.params)
      .map(([n, t]) => `${n}: ${tsTypeName(t)}`)
      .join(", ");
    lines.push(`  ${fn.name}(${params}): ${tsTypeName(fn.returns)};`);
  }
  lines.push(`}`);
  lines.push(``);
  lines.push(`export interface ModuleConfig {`);
  lines.push(`  /** Project root (default: process.cwd()). */`);
  lines.push(`  cwd?: string;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`export function loadModule(`);
  lines.push(`  opts: ModuleConfig = {},`);
  lines.push(`): NativeModule & ${pascalName(manifest.name)}Functions {`);
  const manifestJson = JSON.stringify(manifest, null, 2).split("\n").join("\n  ");
  lines.push(`  const manifest = ${manifestJson};`);
  lines.push(`  return loadNativeModule(manifest, opts) as NativeModule & ${pascalName(manifest.name)}Functions;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`export default loadModule;`);
  lines.push(``);
  return lines.join("\n");
}
