/**
 * Native / Polyglot Modules — public API
 *
 * Lets an AsiJS project embed functions written in other languages
 * (Rust first, then Go/C/Zig, then sidecar languages) with zero manual
 * glue: the manifest generates both the native stubs and the typed
 * `bun:ffi` wrapper, and `native()` middleware exposes them as
 * `ctx.native`.
 *
 * @example
 * ```ts
 * import { Asi } from "asijs";
 * import { native } from "asijs/native";
 *
 * const app = new Asi();
 * app.use(native({ cwd: process.cwd() }));
 *
 * app.get("/hash", async (ctx) => {
 *   return { hash: await ctx.native.sha256(ctx.query.input as string) };
 * });
 * ```
 */

export {
  parseManifest,
  validateManifest,
  loadManifest,
  writeManifest,
  findNativeRoot,
  detectLanguage,
  MANIFEST_FILE,
  DEFAULT_SOURCE_DIR,
  SIDECAR_LANGUAGES,
  EMBEDDED_LANGUAGES,
  isSidecarLanguage,
  isEmbeddedLanguage,
  type NativeManifest,
  type NativeFunction,
  type NativeLanguage,
  type NativeTypeName,
  type NativeValue,
} from "./manifest";

export {
  generateCargoToml,
  generateLibRs,
} from "./generate-rust";

export { generateGoMod, generateMainGo } from "./generate-go";
export { generateCLib, generateCppLib } from "./generate-c";
export { generateBuildZig, generateZigLib } from "./generate-zig";
export { generateNimLib } from "./generate-nim";
export { generateHaskellLib, generateHaskellDef } from "./generate-haskell";
export { generateLuaLib, generateLuaTsClient } from "./generate-lua";

export {
  generatePythonServer,
  generateRubyServer,
  generatePhpServer,
  generateSidecarTsClient,
} from "./generate-sidecar";

export {
  createSidecarClient,
  type SidecarOptions,
  type SidecarSpawn,
  type SidecarChild,
  type SidecarModule,
  type SidecarClient,
} from "./sidecar";

export {
  createLuaModule,
  findLuaLib,
  type LuaModule,
  type LuaModuleOptions,
  type LuaDLOpen,
} from "./lang/lua";

export {
  watchNativeModule,
  rebuildNativeModule,
  type NativeWatchOptions,
  type NativeWatchEvent,
  type NativeWatchEventType,
} from "./watch";

export {
  runNativeTest,
  sampleNativeArg,
  type NativeTestResult,
  type NativeTestOptions,
} from "./cli";

export {
  getGenerator,
  supportedLanguages,
  allGenerators,
  luaAvailable,
  type NativeGenerator,
  type GeneratorFile,
  type ToolchainCheck,
  type BuildCommand,
} from "./generators";

export {
  generateTsWrapper,
  defaultLibPathExpr,
  platformLibExt,
  libFileName,
} from "./generate-ts";

export {
  native,
  loadNativeModule,
  resolveLibPath,
  isStale,
  markBuilt,
  readCString,
  type NativeLoadOptions,
  type NativeModule,
} from "./runtime";

export { handleNative } from "./cli";
