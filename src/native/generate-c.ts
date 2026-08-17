/**
 * Native / Polyglot Modules — C / C++ stub generators (2.1)
 *
 * C has no standard JSON library, so the generated module embeds a
 * compact JSON parser/serializer (~150 lines) that is valid in both C
 * and C++ (explicit casts, no C++-only syntax). The dispatcher reads
 * `{ "fn": ..., "args": {...} }`, calls the user function, and returns
 * a JSON response.
 *
 * Build: `cc -shared -fPIC -o lib<name>.so lib.c` (or `c++ ... lib.cpp`).
 *
 * The user edits ONLY the function bodies (marked `// TODO: implement`).
 */

import type { NativeManifest, NativeTypeName } from "./manifest";

/** C type for a boundary type (no trailing space). */
export function cTypeName(t: NativeTypeName): string {
  switch (t) {
    case "string":
      return "const char*";
    case "number":
      return "double";
    case "boolean":
      return "int";
    case "bytes":
      return "const uint8_t*";
    case "json":
      return "jval*";
  }
}

/**
 * Embedded minimal JSON value type + parser + serializer.
 * Valid C99 and C++ (explicit casts everywhere).
 */
const JSON_HELPER = `
/* ===== minimal JSON (embedded, valid C & C++) ===== */
typedef struct jval jval;
struct jval {
  int type;      /* 0 null, 1 bool, 2 num, 3 str, 4 arr, 5 obj */
  int boolean;
  double num;
  char *str;
  jval **items;  /* array items or object values */
  char **keys;   /* object keys (type==5) */
  size_t len;
};

static jval *jv_alloc(int type) {
  jval *v = (jval *)calloc(1, sizeof(jval));
  v->type = type;
  return v;
}

static void jv_free(jval *v) {
  if (!v) return;
  if (v->str) free(v->str);
  if (v->items) {
    size_t i;
    for (i = 0; i < v->len; i++) jv_free(v->items[i]);
    free(v->items);
  }
  if (v->keys) {
    size_t i;
    for (i = 0; i < v->len; i++) free(v->keys[i]);
    free(v->keys);
  }
  free(v);
}

static jval *jv_str_new(const char *s) {
  jval *v = jv_alloc(3);
  v->str = (char *)malloc(strlen(s) + 1);
  strcpy(v->str, s);
  return v;
}

static void jv_push(jval *arr, jval *item) {
  arr->items = (jval **)realloc(arr->items, (arr->len + 1) * sizeof(jval *));
  arr->items[arr->len++] = item;
}

static void jv_set(jval *obj, const char *key, jval *val) {
  obj->keys = (char **)realloc(obj->keys, (obj->len + 1) * sizeof(char *));
  obj->items = (jval **)realloc(obj->items, (obj->len + 1) * sizeof(jval *));
  obj->keys[obj->len] = (char *)malloc(strlen(key) + 1);
  strcpy(obj->keys[obj->len], key);
  obj->items[obj->len] = val;
  obj->len++;
}

static jval *jv_get(jval *obj, const char *key) {
  size_t i;
  if (!obj || obj->type != 5) return NULL;
  for (i = 0; i < obj->len; i++) {
    if (strcmp(obj->keys[i], key) == 0) return obj->items[i];
  }
  return NULL;
}

static const char *jv_skip_ws(const char *p) {
  while (*p == ' ' || *p == '\\t' || *p == '\\n' || *p == '\\r') p++;
  return p;
}

static jval *jv_parse_value(const char **pp);

static jval *jv_parse_string(const char **pp) {
  const char *p = *pp;
  char buf[4096];
  size_t n = 0;
  if (*p != '"') return NULL;
  p++;
  while (*p && *p != '"') {
    if (*p == '\\\\' && p[1]) {
      p++;
      switch (*p) {
        case 'n': buf[n++] = '\\n'; break;
        case 't': buf[n++] = '\\t'; break;
        case 'r': buf[n++] = '\\r'; break;
        case 'b': buf[n++] = '\\b'; break;
        case 'f': buf[n++] = '\\f'; break;
        default: buf[n++] = *p; break;
      }
      p++;
    } else {
      buf[n++] = *p++;
    }
    if (n >= sizeof(buf) - 1) return NULL;
  }
  if (*p != '"') return NULL;
  buf[n] = 0;
  *pp = p + 1;
  return jv_str_new(buf);
}

static jval *jv_parse_number(const char **pp) {
  const char *p = *pp;
  char *end = NULL;
  double d = strtod(p, &end);
  if (end == p) return NULL;
  *pp = end;
  jval *v = jv_alloc(2);
  v->num = d;
  return v;
}

static jval *jv_parse_array(const char **pp) {
  const char *p = jv_skip_ws(*pp);
  jval *arr = jv_alloc(4);
  if (*p != '[') { jv_free(arr); return NULL; }
  p++;
  p = jv_skip_ws(p);
  if (*p == ']') { *pp = p + 1; return arr; }
  for (;;) {
    jval *item = jv_parse_value(&p);
    if (!item) { jv_free(arr); return NULL; }
    jv_push(arr, item);
    p = jv_skip_ws(p);
    if (*p == ',') { p++; continue; }
    if (*p == ']') { *pp = p + 1; return arr; }
    jv_free(arr);
    return NULL;
  }
}

static jval *jv_parse_object(const char **pp) {
  const char *p = jv_skip_ws(*pp);
  jval *obj = jv_alloc(5);
  if (*p != '{') { jv_free(obj); return NULL; }
  p++;
  p = jv_skip_ws(p);
  if (*p == '}') { *pp = p + 1; return obj; }
  for (;;) {
    jval *k = jv_parse_string(&p);
    if (!k || k->type != 3) { jv_free(obj); jv_free(k); return NULL; }
    p = jv_skip_ws(p);
    if (*p != ':') { jv_free(obj); jv_free(k); return NULL; }
    p++;
    jval *val = jv_parse_value(&p);
    if (!val) { jv_free(obj); jv_free(k); return NULL; }
    jv_set(obj, k->str, val);
    jv_free(k);
    p = jv_skip_ws(p);
    if (*p == ',') { p++; continue; }
    if (*p == '}') { *pp = p + 1; return obj; }
    jv_free(obj);
    return NULL;
  }
}

static jval *jv_parse_value(const char **pp) {
  const char *p = jv_skip_ws(*pp);
  jval *v = NULL;
  if (*p == '"') v = jv_parse_string(&p);
  else if (*p == '[') v = jv_parse_array(&p);
  else if (*p == '{') v = jv_parse_object(&p);
  else if (*p == 't' && strncmp(p, "true", 4) == 0) { v = jv_alloc(1); v->boolean = 1; p += 4; }
  else if (*p == 'f' && strncmp(p, "false", 5) == 0) { v = jv_alloc(1); p += 5; }
  else if (*p == 'n' && strncmp(p, "null", 4) == 0) { v = jv_alloc(0); p += 4; }
  else v = jv_parse_number(&p);
  *pp = p;
  return v;
}

static jval *jv_parse(const char *s) {
  const char *p = s;
  jval *v = jv_parse_value(&p);
  if (!v) return NULL;
  p = jv_skip_ws(p);
  if (*p != 0) { jv_free(v); return NULL; }
  return v;
}

static void jv_serialize_into(jval *v, char **out, size_t *cap) {
  char tmp[64];
  size_t need;
  if (!v) return;
  if (*cap == 0) { *cap = 128; *out = (char *)malloc(*cap); if (!*out) return; (*out)[0] = 0; }
  switch (v->type) {
    case 0: need = 4; snprintf(tmp, sizeof(tmp), "null"); break;
    case 1: need = 5; snprintf(tmp, sizeof(tmp), v->boolean ? "true" : "false"); break;
    case 2: need = 32; snprintf(tmp, sizeof(tmp), "%.17g", v->num); break;
    case 3: need = strlen(v->str) + 2; break;
    case 4: need = 2; break;
    case 5: need = 2; break;
    default: return;
  }
  if (*cap < strlen(*out) + need + 2) {
    *cap = (*cap + need + 2) * 2;
    *out = (char *)realloc(*out, *cap);
  }
  if (v->type == 3) {
    strcat(*out, "\\"");
    strcat(*out, v->str);
    strcat(*out, "\\"");
  } else if (v->type == 4) {
    size_t i;
    strcat(*out, "[");
    for (i = 0; i < v->len; i++) {
      if (i) strcat(*out, ",");
      jv_serialize_into(v->items[i], out, cap);
    }
    strcat(*out, "]");
  } else if (v->type == 5) {
    size_t i;
    strcat(*out, "{");
    for (i = 0; i < v->len; i++) {
      if (i) strcat(*out, ",");
      strcat(*out, "\\"");
      strcat(*out, v->keys[i]);
      strcat(*out, "\\":");
      jv_serialize_into(v->items[i], out, cap);
    }
    strcat(*out, "}");
  } else {
    strcat(*out, tmp);
  }
}

static char *jv_serialize(jval *v) {
  char *out = NULL;
  size_t cap = 0;
  jv_serialize_into(v, &out, &cap);
  return out ? out : strdup("null");
}
`;

/** Parameter list for a C function signature (bytes → ptr + len). */
function cParams(fn: { name: string; params: Record<string, NativeTypeName> }): string {
  return Object.entries(fn.params)
    .map(([name, type]) => {
      const base = cTypeName(type);
      if (type === "bytes") return `${base} ${name}, size_t ${name}_len`;
      return `${base} ${name}`;
    })
    .join(", ");
}

/** Extract a param from the parsed args (jval), with a clear error. */
function cParamExtract(
  paramName: string,
  type: NativeTypeName,
  fnName: string,
): string {
  const target = cTypeName(type).trim();
  switch (type) {
    case "string":
      return `  jval *_p_${paramName} = jv_get(args, "${paramName}");
  if (!_p_${paramName} || _p_${paramName}->type != 3)
    return jv_error("[${fnName}] param \\"${paramName}\\": expected string");
  const char *${paramName} = _p_${paramName}->str;`;
    case "number":
      return `  jval *_p_${paramName} = jv_get(args, "${paramName}");
  if (!_p_${paramName} || _p_${paramName}->type != 2)
    return jv_error("[${fnName}] param \\"${paramName}\\": expected number");
  double ${paramName} = _p_${paramName}->num;`;
    case "boolean":
      return `  jval *_p_${paramName} = jv_get(args, "${paramName}");
  if (!_p_${paramName} || _p_${paramName}->type != 1)
    return jv_error("[${fnName}] param \\"${paramName}\\": expected boolean");
  int ${paramName} = _p_${paramName}->boolean;`;
    case "bytes": {
      return `  jval *_p_${paramName} = jv_get(args, "${paramName}");
  if (!_p_${paramName} || _p_${paramName}->type != 4)
    return jv_error("[${fnName}] param \\"${paramName}\\": expected byte array");
  uint8_t *_b_${paramName} = (uint8_t *)calloc(_p_${paramName}->len ? _p_${paramName}->len : 1, 1);
  size_t i_${paramName};
  for (i_${paramName} = 0; i_${paramName} < _p_${paramName}->len; i_${paramName}++) {
    jval *_e = _p_${paramName}->items[i_${paramName}];
    if (!_e || _e->type != 2) { free(_b_${paramName}); return jv_error("[${fnName}] param \\"${paramName}\\": byte is not a number"); }
    _b_${paramName}[i_${paramName}] = (uint8_t)_e->num;
  }
  const uint8_t *${paramName} = _b_${paramName};
  size_t ${paramName}_len = _p_${paramName}->len;`;
    }
    case "json":
      return `  jval *${paramName} = jv_get(args, "${paramName}");`;
  }
}

/** Convert a C return value into a wrapped { ok: true, result } response. */
function cReturnStmt(expr: string, type: NativeTypeName): string {
  switch (type) {
    case "string":
      return `  return wrap_result(jv_str_new(${expr}));`;
    case "number":
      return `  { jval *_r = jv_alloc(2); _r->num = ${expr}; return wrap_result(_r); }`;
    case "boolean":
      return `  { jval *_r = jv_alloc(1); _r->boolean = ${expr} ? 1 : 0; return wrap_result(_r); }`;
    case "bytes":
      return `  return wrap_result(jv_bytes_new(${expr}, ${expr}_len));`;
    case "json":
      return `  return wrap_result(${expr});`;
  }
}

/** Dispatch case for one function. */
function cDispatchCase(manifest: NativeManifest, fnName: string): string {
  const fn = manifest.functions.find((f) => f.name === fnName);
  if (!fn) return "";
  const extracts = Object.keys(fn.params)
    .map((p) => cParamExtract(p, fn.params[p]!, fnName))
    .join("\n");
  const callArgs = Object.keys(fn.params)
    .map((p) => (fn.params[p] === "bytes" ? `${p}, ${p}_len` : p))
    .join(", ");
  const retExpr = `fn_${fnName}(${callArgs})`;

  // Bytes returns need the length: keep the result in a temp and reuse
  // the param's _len variable.
  if (fn.returns === "bytes") {
    const lastBytes = Object.keys(fn.params).find((p) => fn.params[p] === "bytes");
    const lenExpr = lastBytes ? `${lastBytes}_len` : "0";
    return `  if (strcmp(name, "${fnName}") == 0) {
${extracts}
  const uint8_t *_out = ${retExpr};
  return wrap_result(jv_bytes_new(_out, ${lenExpr}));
  }`;
  }

  return `  if (strcmp(name, "${fnName}") == 0) {
${extracts}
${cReturnStmt(retExpr, fn.returns)}
  }`;
}

/** Shared boilerplate for C and C++ modules. */
function cModuleCore(manifest: NativeManifest, isCpp: boolean): string {
  const lines: string[] = [];
  lines.push(`// Auto-generated by AsiJS — DO NOT EDIT the FFI section below.`);
  lines.push(`// Your code: fill in the bodies of the functions marked with TODO.`);
  lines.push(`// Re-run "asi native scaffold ${manifest.lang}" to regenerate the FFI glue.`);
  lines.push(``);
  lines.push(`#include <stdint.h>`);
  lines.push(`#include <stdio.h>`);
  lines.push(`#include <stdlib.h>`);
  lines.push(`#include <string.h>`);
  lines.push(``);
  lines.push(JSON_HELPER);
  lines.push(``);
  lines.push(`static jval *jv_error(const char *msg) {`);
  lines.push(`  jval *obj = jv_alloc(5);`);
  lines.push(`  jval *okv = jv_alloc(1); okv->boolean = 0;`);
  lines.push(`  jv_set(obj, "ok", okv);`);
  lines.push(`  jv_set(obj, "error", jv_str_new(msg));`);
  lines.push(`  return obj;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`static jval *jv_bytes_new(const uint8_t *data, size_t len) {`);
  lines.push(`  jval *arr = jv_alloc(4);`);
  lines.push(`  size_t i;`);
  lines.push(`  for (i = 0; i < len; i++) {`);
  lines.push(`    jval *n = jv_alloc(2); n->num = (double)data[i];`);
  lines.push(`    jv_push(arr, n);`);
  lines.push(`  }`);
  lines.push(`  return arr;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`static jval *wrap_result(jval *result) {`);
  lines.push(`  jval *obj = jv_alloc(5);`);
  lines.push(`  jval *okv = jv_alloc(1); okv->boolean = 1;`);
  lines.push(`  jv_set(obj, "ok", okv);`);
  lines.push(`  jv_set(obj, "result", result);`);
  lines.push(`  return obj;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`// ====================================================================`);
  lines.push(`// Your functions — edit the bodies below (signatures are generated)`);
  lines.push(`// ====================================================================`);
  lines.push(``);

  for (const fn of manifest.functions) {
    lines.push(`static ${cTypeName(fn.returns).trim()} fn_${fn.name}(${cParams(fn)}) {`);
    lines.push(`  // TODO: implement the body of ${fn.name}`);
    switch (fn.returns) {
      case "string":
        lines.push(`  return "";`);
        break;
      case "number":
        lines.push(`  return 0.0;`);
        break;
      case "boolean":
        lines.push(`  return 0;`);
        break;
      case "bytes":
        lines.push(`  return NULL;`);
        break;
      case "json":
        lines.push(`  return jv_str_new("TODO");`);
        break;
    }
    lines.push(`}`);
    lines.push(``);
  }

  lines.push(`// ====================================================================`);
  lines.push(`// FFI boundary — DO NOT EDIT`);
  lines.push(`// ====================================================================`);
  if (isCpp) {
    lines.push(`extern "C" {`);
    lines.push(``);
  }
  lines.push(`static jval *dispatch(const char *name, jval *args) {`);
  for (const fn of manifest.functions) {
    lines.push(cDispatchCase(manifest, fn.name));
  }
  lines.push(`  return jv_error("unknown native function");`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`__attribute__((visibility("default")))`);
  lines.push(`char *asijs_call(const char *input) {`);
  lines.push(`  jval *req = jv_parse(input);`);
  lines.push(`  if (!req) return strdup("{\\"ok\\":false,\\"error\\":\\"invalid JSON\\"}");`);
  lines.push(`  jval *namev = jv_get(req, "fn");`);
  lines.push(`  jval *args = jv_get(req, "args");`);
  lines.push(`  if (!namev || namev->type != 3 || !args) {`);
  lines.push(`    jv_free(req);`);
  lines.push(`    return strdup("{\\"ok\\":false,\\"error\\":\\"missing fn/args\\"}");`);
  lines.push(`  }`);
  lines.push(`  jval *resp = dispatch(namev->str, args);`);
  lines.push(`  char *out = jv_serialize(resp);`);
  lines.push(`  jv_free(resp);`);
  lines.push(`  jv_free(req);`);
  lines.push(`  return out;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`__attribute__((visibility("default")))`);
  lines.push(`void asijs_free(char *ptr) {`);
  lines.push(`  free(ptr);`);
  lines.push(`}`);
  if (isCpp) {
    lines.push(``);
    lines.push(`}`);
  }
  lines.push(``);

  return lines.join("\n");
}

/** Generate lib.c for a C native module. */
export function generateCLib(manifest: NativeManifest): string {
  return cModuleCore(manifest, false);
}

/** Generate lib.cpp for a C++ native module (extern "C" wrappers). */
export function generateCppLib(manifest: NativeManifest): string {
  return cModuleCore(manifest, true);
}
