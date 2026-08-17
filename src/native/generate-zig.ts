/**
 * Native / Polyglot Modules — Zig stub generator (2.1)
 *
 * Generates a Zig shared-library module from a manifest:
 *   - `native/build.zig` — build script
 *   - `native/src/lib.zig` — `export fn` FFI entry + JSON dispatcher
 *
 * Zig ships std.json, so no embedded parser is needed. The dispatcher
 * reads `{ "fn": ..., "args": {...} }`, calls the user function, and
 * returns a JSON response.
 *
 * Build: `zig build -Doptimize=ReleaseFast` in the native root.
 *
 * The user edits ONLY the function bodies (marked `// TODO: implement`).
 */

import type { NativeManifest, NativeTypeName } from "./manifest";

/** Zig type for a boundary type. */
export function zigTypeName(t: NativeTypeName): string {
  switch (t) {
    case "string":
      return "[]const u8";
    case "number":
      return "f64";
    case "boolean":
      return "bool";
    case "bytes":
      return "[]const u8";
    case "json":
      return "std.json.Value";
  }
}

/** build.zig for a shared library (Zig >= 0.15 API). */
export function generateBuildZig(manifest: NativeManifest): string {
  return `const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});
    const lib = b.addLibrary(.{
        .linkage = .dynamic,
        .name = "${manifest.name}",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/lib.zig"),
            .target = target,
            .optimize = optimize,
            // the FFI boundary uses std.heap.c_allocator + C string helpers
            .link_libc = true,
        }),
    });
    b.installArtifact(lib);
}
`;
}

/** Param extraction snippet for a Zig dispatcher case. */
function zigParamExtract(
  paramName: string,
  type: NativeTypeName,
  fnName: string,
): string {
  const target = zigTypeName(type);
  switch (type) {
    case "string":
      return `        const ${paramName}: ${target} = if (args.get("${paramName}")) |v| switch (v) {
            .string => |s| s,
            else => return jvError("[${fnName}] param \\"${paramName}\\": expected string"),
        } else return jvError("[${fnName}] param \\"${paramName}\\": missing");`;
    case "number":
      return `        const ${paramName}: ${target} = if (args.get("${paramName}")) |v| switch (v) {
            .float => |n| n,
            .integer => |i| @floatFromInt(i),
            .number_string => |s| std.fmt.parseFloat(f64, s) catch return jvError("[${fnName}] param \\"${paramName}\\": bad number"),
            else => return jvError("[${fnName}] param \\"${paramName}\\": expected number"),
        } else return jvError("[${fnName}] param \\"${paramName}\\": missing");`;
    case "boolean":
      return `        const ${paramName}: ${target} = if (args.get("${paramName}")) |v| switch (v) {
            .bool => |b| b,
            else => return jvError("[${fnName}] param \\"${paramName}\\": expected boolean"),
        } else return jvError("[${fnName}] param \\"${paramName}\\": missing");`;
    case "bytes":
      return `        const ${paramName}: ${target} = if (args.get("${paramName}")) |v| switch (v) {
            .array => |arr| blk: {
                const buf = allocator.alloc(u8, arr.items.len) catch return jvError("[${fnName}] param \\"${paramName}\\": OOM");
                for (arr.items, 0..) |item, i| {
                    buf[i] = switch (item) {
                        .integer => |n| @intCast(n),
                        else => return jvError("[${fnName}] param \\"${paramName}\\": byte is not a number"),
                    };
                }
                break :blk buf;
            },
            else => return jvError("[${fnName}] param \\"${paramName}\\": expected byte array"),
        } else return jvError("[${fnName}] param \\"${paramName}\\": missing");`;
    case "json":
      return `        const ${paramName}: ${target} = if (args.get("${paramName}")) |v| v else .null;`;
  }
}

/** Zig value constructor for a return value. */
function zigReturnExpr(expr: string, type: NativeTypeName): string {
  switch (type) {
    case "string":
      return `std.json.Value{ .string = ${expr} }`;
    case "number":
      return `std.json.Value{ .float = ${expr} }`;
    case "boolean":
      return `std.json.Value{ .bool = ${expr} }`;
    case "bytes":
      // built inline in the dispatch case (needs the value) — placeholder
      return `std.json.Value{ .array = std.json.Array.init(allocator) }`;
    case "json":
      return `${expr}`;
  }
}

/** Dispatch case for one function. */
function zigDispatchCase(manifest: NativeManifest, fnName: string): string {
  const fn = manifest.functions.find((f) => f.name === fnName);
  if (!fn) return "";
  const extracts = Object.keys(fn.params)
    .map((p) => zigParamExtract(p, fn.params[p]!, fnName))
    .join("\n");
  const callArgs = Object.keys(fn.params).join(", ");
  const retExpr =
    fn.returns === "bytes"
      ? `arr_blk: {
            var arr = std.json.Array.init(allocator);
            for (out) |byte| {
                arr.append(std.json.Value{ .integer = byte }) catch return jvError("OOM");
            }
            break :arr_blk std.json.Value{ .array = arr };
        }`
      : zigReturnExpr("out", fn.returns);
  return `    if (std.mem.eql(u8, fn_name, "${fnName}")) {
${extracts}
        return std.json.Value{ .object = blk: {
            var map = std.json.ObjectMap.init(allocator, &.{}, &.{}) catch return jvError("OOM");
            const out = ${fnName}(${callArgs});
            map.put(allocator, "ok", std.json.Value{ .bool = true }) catch return jvError("OOM");
            map.put(allocator, "result", ${retExpr}) catch return jvError("OOM");
            break :blk map;
        } };
    }`;
}

/** Generate src/lib.zig with stubs + dispatcher. */
export function generateZigLib(manifest: NativeManifest): string {
  const lines: string[] = [];
  lines.push(`// Auto-generated by AsiJS — DO NOT EDIT the FFI section below.`);
  lines.push(`// Your code: fill in the bodies of the functions marked with TODO.`);
  lines.push(`// Re-run "asi native scaffold ${manifest.lang}" to regenerate the FFI glue.`);
  lines.push(`const std = @import("std");`);
  lines.push(`const allocator = std.heap.c_allocator;`);
  lines.push(``);
  lines.push(`// ====================================================================`);
  lines.push(`// Your functions — edit the bodies below (signatures are generated)`);
  lines.push(`// ====================================================================`);
  lines.push(``);

  for (const fn of manifest.functions) {
    const params = Object.entries(fn.params)
      .map(([name, type]) => `${name}: ${zigTypeName(type)}`)
      .join(", ");
    lines.push(`pub fn ${fn.name}(${params}) ${zigTypeName(fn.returns)} {`);
    lines.push(`    // TODO: implement the body of ${fn.name}`);
    // zig errors on unused function parameters — silence the TODO stubs
    for (const [name] of Object.entries(fn.params)) {
      lines.push(`    _ = ${name};`);
    }
    switch (fn.returns) {
      case "string":
      case "bytes":
        lines.push(`    return "";`);
        break;
      case "number":
        lines.push(`    return 0;`);
        break;
      case "boolean":
        lines.push(`    return false;`);
        break;
      case "json":
        lines.push(`    return .null;`);
        break;
    }
    lines.push(`}`);
    lines.push(``);
  }

  lines.push(`// ====================================================================`);
  lines.push(`// FFI boundary — DO NOT EDIT`);
  lines.push(`// ====================================================================`);
  lines.push(`fn jvError(msg: []const u8) std.json.Value {`);
  lines.push(`    var map = std.json.ObjectMap.init(allocator, &.{}, &.{}) catch return .null;`);
  lines.push(`    map.put(allocator, "ok", std.json.Value{ .bool = false }) catch {};`);
  lines.push(`    map.put(allocator, "error", std.json.Value{ .string = msg }) catch {};`);
  lines.push(`    return std.json.Value{ .object = map };`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`fn dispatch(fn_name: []const u8, args: std.json.ObjectMap) std.json.Value {`);
  for (const fn of manifest.functions) {
    lines.push(zigDispatchCase(manifest, fn.name));
  }
  lines.push(`    return jvError("unknown native function");`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`export fn asijs_call(input: [*:0]const u8) ?[*:0]u8 {`);
  lines.push(`    const parsed = std.json.parseFromSlice(std.json.Value, allocator, std.mem.span(input), .{}) catch {`);
  lines.push(`        const err = "{\\"ok\\":false,\\"error\\":\\"invalid JSON\\"}";`);
  lines.push(`        const out = allocator.allocSentinel(u8, err.len, 0) catch return null;`);
  lines.push(`        @memcpy(out, err);`);
  lines.push(`        return out;`);
  lines.push(`    };`);
  lines.push(`    defer parsed.deinit();`);
  lines.push(`    const req = parsed.value;`);
  lines.push(`    const fn_val = req.object.get("fn") orelse return null;`);
  lines.push(`    const name: []const u8 = switch (fn_val) {`);
  lines.push(`        .string => |s| s,`);
  lines.push(`        else => return null,`);
  lines.push(`    };`);
  lines.push(`    const args_val = req.object.get("args") orelse return null;`);
  lines.push(`    const args: std.json.ObjectMap = switch (args_val) {`);
  lines.push(`        .object => |o| o,`);
  lines.push(`        else => return null,`);
  lines.push(`    };`);
  lines.push(`    const resp = dispatch(name, args);`);
  lines.push(`    const json_str = std.json.Stringify.valueAlloc(allocator, resp, .{}) catch return null;`);
  lines.push(`    defer allocator.free(json_str);`);
  lines.push(`    const out = allocator.allocSentinel(u8, json_str.len, 0) catch return null;`);
  lines.push(`    @memcpy(out, json_str);`);
  lines.push(`    return out;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`export fn asijs_free(ptr: [*:0]u8) void {`);
  lines.push(`    allocator.free(std.mem.span(ptr));`);
  lines.push(`}`);
  lines.push(``);

  return lines.join("\n");
}
