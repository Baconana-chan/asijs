/**
 * Bundle helpers.
 *
 * `buildClientBundle` bundles the client bootstrap (plus the react client
 * runtime) into a standalone ESM file for production — no dev-server module
 * resolution needed. `buildServerBundle` bundles the SSR server entry.
 *
 * Both use `Bun.build` (Bun-first, zero extra deps).
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RscBuildResult } from "./types";
import { CLIENT_BOOTSTRAP_SOURCE } from "./runtime";

export interface ClientBundleOptions {
  /** Output directory (default `"dist"`). */
  outDir?: string;
  /** Output file name (default `"client.js"`). */
  outFile?: string;
  /**
   * Custom client entry (default: the embedded asijs-react bootstrap).
   * Pass your own entry to add app-level client logic before hydration.
   */
  entry?: string;
}

/**
 * Build the client bundle: the bootstrap + `react-dom/client` +
 * `react-server-dom-webpack/client.browser` inlined into one file.
 *
 * Requires `react` / `react-dom` / `react-server-dom-webpack` installed.
 *
 * @example
 * ```ts
 * const res = await buildClientBundle({ outDir: "dist", outFile: "client.js" });
 * if (res.ok) console.log("client bundle at", res.outputPath);
 * ```
 */
export async function buildClientBundle(
  options: ClientBundleOptions = {},
): Promise<RscBuildResult> {
  const outDir = options.outDir ?? "dist";
  const outFile = options.outFile ?? "client.js";
  mkdirSync(outDir, { recursive: true });

  const tempEntry = options.entry ?? join(outDir, ".asijs-rsc-bootstrap.js");
  const createdTemp = !options.entry;
  if (createdTemp) {
    writeFileSync(tempEntry, CLIENT_BOOTSTRAP_SOURCE, "utf8");
  }

  try {
    const res = await Bun.build({
      entrypoints: [tempEntry],
      outdir: outDir,
      naming: outFile,
      target: "browser",
      format: "esm",
      sourcemap: false,
      minify: false,
      define: {},
    });
    if (!res.success) {
      return { ok: false, error: res.logs.map(String).join("\n") };
    }
    return { ok: true, outputPath: join(outDir, outFile) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (createdTemp) {
      try {
        rmSync(tempEntry, { force: true });
      } catch {
        // best effort
      }
    }
  }
}

export interface ServerBundleOptions {
  /** Server entry (e.g. `src/ssr.tsx`). */
  entry: string;
  /** Output directory (default `"dist"`). */
  outDir?: string;
  /** Output file name (default `"server.js"`). */
  outFile?: string;
  /** Packages left as imports (default: `["asijs", "react", "react-dom", "react-server-dom-webpack"]`). */
  external?: string[];
}

/**
 * Bundle the SSR server entry for production deployment.
 */
export async function buildServerBundle(
  options: ServerBundleOptions,
): Promise<RscBuildResult> {
  const outDir = options.outDir ?? "dist";
  const outFile = options.outFile ?? "server.js";
  mkdirSync(outDir, { recursive: true });
  const external =
    options.external ?? ["asijs", "react", "react-dom", "react-server-dom-webpack"];
  try {
    const res = await Bun.build({
      entrypoints: [options.entry],
      outdir: outDir,
      naming: outFile,
      target: "bun",
      format: "esm",
      sourcemap: false,
      external,
    });
    if (!res.success) {
      return { ok: false, error: res.logs.map(String).join("\n") };
    }
    return { ok: true, outputPath: join(outDir, outFile) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
