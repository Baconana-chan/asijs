/**
 * Native / Polyglot Modules — Haskell stub generator (2.1)
 *
 * Generates a Haskell shared-library module from a manifest:
 *   - `native/lib.hs` — `foreign export ccall` FFI entry + JSON dispatcher
 *   - `native/lib.def` — Windows symbol export list (asijs_call/free + hs_init)
 *
 * GHC has no JSON in `base`, so the template embeds a compact JSON
 * parser/serializer using `text` only (no `containers` — `Data.Map` inside a
 * statically-linked GHC DLL crashes the host process on Windows, so objects
 * are plain association lists).
 *
 * Build:
 *   ghc -shared -static -fPIC -package text \
 *       lib.hs -o target/release/lib<name>.<ext> -optl lib.def
 *
 * The user edits ONLY the function bodies (marked `-- TODO: implement`).
 */

import type { NativeManifest, NativeTypeName } from "./manifest";

/** Haskell type for a boundary type. */
export function haskellTypeName(t: NativeTypeName): string {
  switch (t) {
    case "string":
      return "String";
    case "number":
      return "Double";
    case "boolean":
      return "Bool";
    case "bytes":
      return "[Int]";
    case "json":
      return "JVal";
  }
}

/** Capitalize first letter for a generated binding name. */
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Embedded mini-JSON (parser + serializer) — ships in every generated lib. */
const JSON_HELPER = `
-- ===== minimal JSON (embedded, uses text only) =====
-- NOTE: keep the JVal constructor count at FIVE: a sixth constructor makes
-- the statically-linked GHC DLL segfault the host process on Windows.
-- JSON null is therefore represented as JObj [] (empty object).
data JVal = JBool Bool | JNum Double | JStr Text | JArr [JVal] | JObj [(Text, JVal)]
  deriving (Show)

jSkipSpace :: Text -> Text
jSkipSpace = T.dropWhile DC.isSpace

jParse :: Text -> Maybe (JVal, Text)
jParse t0 = do
  let t1 = jSkipSpace t0
  case T.uncons t1 of
    Nothing -> Nothing
    Just (c, _)
      | c == '{' -> jParseObj (T.drop 1 (jSkipSpace t1)) []
      | c == '[' -> jParseArr (T.drop 1 (jSkipSpace t1)) []
      | c == '"' -> jStr (T.drop 1 t1)
      | c == 't' -> Just (JBool True, T.drop 4 t1)
      | c == 'f' -> Just (JBool False, T.drop 5 t1)
      | c == 'n' -> Just (JObj [], T.drop 4 t1)
      | otherwise -> jNum (jSkipSpace t1)
  where
    jStr s0 = do
      let (s1, s2) = T.break (== '"') s0
      Just (JStr s1, T.drop 1 s2)
    jNum s0 =
      let (num, rest) = T.span (\\ch -> DC.isDigit ch || ch \`Prelude.elem\` (".-+eE" :: String)) s0
      in if T.null num then Nothing else Just (JNum (Prelude.read (T.unpack num) :: Double), rest)

-- jParseObj/jParseArr receive the text AFTER the opening bracket; they are
-- top-level (not where-bound) because GHC's static DLL codegen mislinks
-- nested where-recursion on Windows.
jParseArr :: Text -> [JVal] -> Maybe (JVal, Text)
jParseArr s0 acc =
  case T.uncons (jSkipSpace s0) of
    Just (']', _) -> Just (JArr (Prelude.reverse acc), T.drop 1 (jSkipSpace s0))
    _ -> do
      (v, r) <- jParse s0
      let r' = jSkipSpace r
      case T.uncons r' of
        Just (',', _) -> jParseArr (T.drop 1 r') (v : acc)
        Just (']', _) -> Just (JArr (Prelude.reverse (v : acc)), T.drop 1 r')
        _ -> Nothing

jParseObj :: Text -> [(Text, JVal)] -> Maybe (JVal, Text)
jParseObj s0 acc =
  case T.uncons (jSkipSpace s0) of
    Just ('}', _) -> Just (JObj (Prelude.reverse acc), T.drop 1 (jSkipSpace s0))
    _ -> do
      (JStr k, r1) <- jParse s0
      let r2 = jSkipSpace (T.drop 1 (jSkipSpace r1))
      (v, r3) <- jParse r2
      let r4 = jSkipSpace r3
      case T.uncons r4 of
        Just (',', _) -> jParseObj (T.drop 1 r4) ((k, v) : acc)
        Just ('}', _) -> Just (JObj (Prelude.reverse ((k, v) : acc)), T.drop 1 r4)
        _ -> Nothing

jLookup :: Text -> JVal -> Maybe JVal
jLookup k (JObj pairs) = Prelude.lookup k pairs
jLookup _ _ = Nothing

jSerialize :: JVal -> Text
jSerialize v = case v of
  JBool True -> "true"
  JBool False -> "false"
  JNum n -> T.pack (Prelude.show n)
  JStr s -> "\\"" <> s <> "\\""
  JArr xs -> "[" <> T.intercalate "," (Prelude.map jSerialize xs) <> "]"
  JObj pairs -> "{" <> T.intercalate "," (Prelude.map (\\(k, v) -> "\\"" <> k <> "\\":" <> jSerialize v) pairs) <> "}"

jErr :: Text -> JVal
jErr e = JObj [("ok", JBool False), ("error", JStr e)]
`;

/** An extractor expression: `Right <typed value>` or `Left <error message>`. */
function hsExtractor(
  paramName: string,
  type: NativeTypeName,
  fnName: string,
): string {
  const a = "        ";
  switch (type) {
    case "string":
      return `case jLookup "${paramName}" args of
${a}Just (JStr s) -> Right (T.unpack s)
${a}Just _ -> Left "[${fnName}] param \\"${paramName}\\": expected string"
${a}Nothing -> Left "[${fnName}] param \\"${paramName}\\": missing"`;
    case "number":
      return `case jLookup "${paramName}" args of
${a}Just (JNum n) -> Right n
${a}Just _ -> Left "[${fnName}] param \\"${paramName}\\": expected number"
${a}Nothing -> Left "[${fnName}] param \\"${paramName}\\": missing"`;
    case "boolean":
      return `case jLookup "${paramName}" args of
${a}Just (JBool b) -> Right b
${a}Just _ -> Left "[${fnName}] param \\"${paramName}\\": expected boolean"
${a}Nothing -> Left "[${fnName}] param \\"${paramName}\\": missing"`;
    case "bytes":
      return `case jLookup "${paramName}" args of
${a}Just (JArr xs) -> Right (Prelude.map jvToInt xs)
${a}Just _ -> Left "[${fnName}] param \\"${paramName}\\": expected byte array"
${a}Nothing -> Left "[${fnName}] param \\"${paramName}\\": missing"`;
    case "json":
      return `Right (case jLookup "${paramName}" args of
${a}Just x -> x
${a}Nothing -> JObj [])`;
  }
}

/** Serialize a return value into a JVal. */
function hsReturnExpr(expr: string, type: NativeTypeName): string {
  switch (type) {
    case "string":
      return `JStr (T.pack (${expr}))`;
    case "number":
      return `JNum (${expr})`;
    case "boolean":
      return `JBool (${expr})`;
    case "bytes":
      return `JArr (Prelude.map (JNum . Prelude.fromIntegral) (${expr}))`;
    case "json":
      return `(${expr})`;
  }
}

/** A placeholder return for a TODO stub (also silences unused args). */
function stubReturn(t: NativeTypeName): string {
  switch (t) {
    case "string":
      return `""`;
    case "number":
      return `0.0`;
    case "boolean":
      return `False`;
    case "bytes":
      return `[]`;
    case "json":
      return `JObj []`;
  }
}

/** Dispatch arm for one function (tuple pattern match on extractors). */
function hsDispatchCase(manifest: NativeManifest, fnName: string): string {
  const fn = manifest.functions.find((f) => f.name === fnName);
  if (!fn) return "";
  const paramNames = Object.keys(fn.params);

  const tuple =
    paramNames.length === 0 ? "()" : `(${paramNames.map((p) => `e${cap(p)}`).join(", ")})`;
  const okPat =
    paramNames.length === 0
      ? "()"
      : `(${paramNames.map((p) => `Right p${cap(p)}`).join(", ")})`;
  const callArgs = paramNames.map((p) => `p${cap(p)}`).join(" ");

  const letLines = paramNames
    .map(
      (p) =>
        `      e${cap(p)} :: Either Text ${haskellTypeName(fn.params[p]!)}\n` +
        `      e${cap(p)} = ${hsExtractor(p, fn.params[p]!, fnName)}`,
    )
    .join("\n");

  const errArms = paramNames
    .map((p) => {
      const pat = paramNames.map((q) => (q === p ? "Left e" : "_")).join(", ");
      return `      (${pat}) -> Left e`;
    })
    .join("\n");

  // Call the user function qualified as Main.<fn> — unqualified names stay
  // ambiguous when a function shadows a Prelude name (e.g. the default
  // scaffold has `reverse`), and every manifest function has a generated stub.
  const okExpr = hsReturnExpr(`Main.${fnName} ${callArgs}`, fn.returns);
  const withLets =
    paramNames.length === 0
      ? `    case () of`
      : `    case ${tuple} of`;

  return `  if fn == "${fnName}" then
    let
${letLines}
    in ${withLets}
      ${okPat} ->
        Right (JObj [("ok", JBool True), ("result", ${okExpr})])
${errArms}
      _ -> Left "internal dispatch error"
  else`;
}

/** Generate lib.hs with stubs + dispatcher. */
export function generateHaskellLib(manifest: NativeManifest): string {
  const lines: string[] = [];
  lines.push(`-- Auto-generated by AsiJS — DO NOT EDIT the FFI section below.`);
  lines.push(`-- Your code: fill in the bodies of the functions marked with TODO.`);
  lines.push(`-- Re-run "asi native scaffold ${manifest.lang}" to regenerate the FFI glue.`);
  lines.push(`{-# LANGUAGE ForeignFunctionInterface, OverloadedStrings #-}`);
  lines.push(`module Main where`);
  lines.push(``);
  // All Prelude/Char/Foreign names used by the glue are QUALIFIED so that a
  // user function (e.g. `reverse`, `map`, `lookup` — the default scaffold has
  // a `reverse`!) can never shadow them. Only user stubs + dispatch arms
  // reference unqualified names.
  lines.push(`import qualified Data.Char as DC`);
  lines.push(`import qualified Data.Text as T`);
  lines.push(`import qualified Foreign.C.String as FC`);
  lines.push(`import qualified Foreign.Ptr as FP`);
  lines.push(`import qualified Foreign.Marshal.Alloc as FMA`);
  lines.push(``);
  lines.push(`type Text = T.Text`);
  lines.push(``);
  lines.push(`foreign export ccall asijs_call :: FC.CString -> IO FC.CString`);
  lines.push(`foreign export ccall asijs_free :: FP.Ptr () -> IO ()`);
  lines.push(``);
  lines.push(`-- ====================================================================`);
  lines.push(`-- Your functions — edit the bodies below (signatures are generated)`);
  lines.push(`-- ====================================================================`);
  lines.push(``);

  for (const fn of manifest.functions) {
    const sigTypes = Object.values(fn.params)
      .map((t) => haskellTypeName(t))
      .concat([haskellTypeName(fn.returns)]);
    const sig = sigTypes.join(" -> ");
    const argNames = Object.keys(fn.params).map((p) => `_${p}`).join(" ");
    lines.push(`${fn.name} :: ${sig}`);
    lines.push(`${fn.name} ${argNames} =`);
    lines.push(`  -- TODO: implement the body of ${fn.name}`);
    lines.push(`  ${stubReturn(fn.returns)}`);
    lines.push(``);
  }

  lines.push(`-- ====================================================================`);
  lines.push(`-- FFI boundary — DO NOT EDIT`);
  lines.push(`-- ====================================================================`);
  lines.push(JSON_HELPER);
  lines.push(``);
  lines.push(`jvToInt :: JVal -> Int`);
  lines.push(`jvToInt (JNum n) = Prelude.round n`);
  lines.push(`jvToInt _ = 0`);
  lines.push(``);
  lines.push(`dispatch :: Text -> JVal -> Either Text JVal`);
  lines.push(`dispatch fn args =`);
  for (const fn of manifest.functions) {
    lines.push(hsDispatchCase(manifest, fn.name));
  }
  lines.push(`  Left "unknown native function"`);
  lines.push(``);
  lines.push(`asijs_call :: FC.CString -> IO FC.CString`);
  lines.push(`asijs_call input = do`);
  lines.push(`  s <- FC.peekCString input`);
  lines.push(`  let resp = case jParse (T.pack s) of`);
  lines.push(`        Just (JObj o, _) ->`);
  lines.push(`          case jLookup "args" (JObj o) of`);
  lines.push(`            Just a -> case jLookup "fn" (JObj o) of`);
  lines.push(`              Just (JStr fn) -> Prelude.either jErr Prelude.id (dispatch fn a)`);
  lines.push(`              _ -> jErr "invalid request: missing fn"`);
  lines.push(`            Nothing -> jErr "invalid request: missing args"`);
  lines.push(`        _ -> jErr "invalid JSON"`);
  lines.push(`  FC.newCString (T.unpack (jSerialize resp))`);
  lines.push(``);
  lines.push(`asijs_free :: FP.Ptr () -> IO ()`);
  lines.push(`asijs_free p = FMA.free p`);
  lines.push(``);
  lines.push(`main :: IO ()`);
  lines.push(`main = Prelude.pure ()`);
  lines.push(``);

  return lines.join("\n");
}

/** Windows symbol export list (required for GHC shared libs). */
export function generateHaskellDef(): string {
  return `EXPORTS
asijs_call
asijs_free
hs_init
hs_exit
`;
}
