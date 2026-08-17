/**
 * miyocss core — purge-to-file (MiyoCSS TODO 1.2).
 *
 * The SSR collector emits exact inline `<style>` per render. When you have many
 * pages (SSG, CDN, a file server) you want **one** cached CSS file instead of
 * N inline tags. This module:
 *
 *  1. `PurgeCache` — accumulates utility classes across many renders/pages.
 *  2. `hashCss()` — content hash, so the filename changes exactly when the CSS
 *     changes (immutable caching on CDNs: `miyocss.a1b2c3.css` never mutates).
 *  3. `collectClassesFromHtml()` — scans `class="…"` attributes of finished
 *     HTML (for SPA / pure-static builds where there is no SSR tree-walk).
 *  4. `purgeToFile()` / `purgeDirectory()` — write one hashed CSS file, with
 *     optional rewriting of inline `<style data-miyocss>` tags into a `<link>`.
 *
 * Invalidation model: the content hash IS the invalidation. Old files are
 * simply not referenced anymore; `purgeDirectory` can prune stale
 * `name.*.css` siblings after writing the new one.
 *
 * Framework-agnostic: works with any SSR output, AsiJS SSG (`asi build --ssg`
 * then `miyocss build dist`), or a plain directory of static HTML.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

import { generateCSS } from "./variants";
import { resolveConfig, resolveDefaultConfig } from "./config";
import type { MiyoConfig, ResolvedConfig } from "./config";

// ===== Content hash =====

/** SHA-256 of the CSS, first 10 hex chars — the immutable cache key. */
export function hashCss(css: string): string {
  return createHash("sha256").update(css, "utf-8").digest("hex").slice(0, 10);
}

// ===== PurgeCache =====

/**
 * Accumulates utility classes across many renders and produces one CSS file.
 *
 * ```ts
 * const cache = new PurgeCache(config);
 * cache.add(collectClasses(pageTree));      // per page, from SSR tree-walk
 * cache.addFromHtml(htmlString);            // …or from finished HTML
 * const { href } = purgeToFile(cache, { dir: "dist" });
 * ```
 */
export class PurgeCache {
  readonly config: ResolvedConfig;
  private readonly classes = new Set<string>();

  constructor(config?: ResolvedConfig | MiyoConfig) {
    this.config = isResolvedConfig(config) ? config : resolveConfig(config);
  }

  /** Register class names (deduped). */
  add(classes: Iterable<string>): this {
    for (const name of classes) {
      if (name) this.classes.add(name);
    }
    return this;
  }

  /** Register classes found in `class="…"` attributes of an HTML string. */
  addFromHtml(html: string): this {
    return this.add(collectClassesFromHtml(html));
  }

  /** Unique class names collected so far. */
  get classNames(): string[] {
    return [...this.classes];
  }

  /** Number of unique classes. */
  get size(): number {
    return this.classes.size;
  }

  /** Generate the CSS for everything collected. */
  css(minify = true): string {
    const css = generateCSS(this.classes, this.config);
    return minify ? css.replace(/\n\s*/g, "\n") : css;
  }

  /** Content hash of the current CSS ("" when nothing collected). */
  hash(): string {
    return hashCss(this.css());
  }

  /** Clear all collected classes. */
  reset(): this {
    this.classes.clear();
    return this;
  }
}

function isResolvedConfig(config: unknown): config is ResolvedConfig {
  return (
    config !== null &&
    typeof config === "object" &&
    "utilities" in (config as object) &&
    "options" in (config as object)
  );
}

// ===== HTML scanning =====

const CLASS_ATTR_RE = /(?<![\w-])class\s*=\s*(["'])(.*?)\1/g;

/**
 * Extract every utility class from an HTML string.
 *
 * Matches `class="a b"` / `class='a b'` attributes and splits on whitespace.
 * Good for SPA builds / static output where there is no JSX tree to walk.
 */
export function collectClassesFromHtml(html: string): Set<string> {
  const out = new Set<string>();
  let match: RegExpExecArray | null;
  CLASS_ATTR_RE.lastIndex = 0;
  while ((match = CLASS_ATTR_RE.exec(html)) !== null) {
    for (const token of match[2].split(/\s+/)) {
      if (token) out.add(token);
    }
  }
  return out;
}

// ===== Writing =====

export interface PurgeResult {
  /** Absolute path of the written CSS file. */
  file: string;
  /** Basename, e.g. `miyocss.a1b2c3d4e5.css` — use as `href`. */
  href: string;
  /** Content hash (the cache key). */
  hash: string;
  /** Bytes written. */
  size: number;
  /** Unique classes collected. */
  classes: number;
  /** HTML files scanned (0 for a bare PurgeCache write). */
  files: number;
  /** CSS files pruned (stale `name.*.css` siblings removed). */
  pruned: number;
}

export interface PurgeToFileOptions {
  /** Directory to write the CSS into (created if missing). */
  dir: string;
  /** Filename stem (default: "miyocss"). */
  name?: string;
  /** Minify (default: true). */
  minify?: boolean;
  /** Prune stale `name.*.css` siblings after writing (default: true). */
  prune?: boolean;
}

/**
 * Write the cache's CSS to `<dir>/<name>.<hash>.css`.
 *
 * The hash is derived from the CSS content, so the file is immutable —
 * CDNs can cache it forever; invalidation = new hash = new filename.
 */
export function purgeToFile(
  cache: PurgeCache,
  options: PurgeToFileOptions,
): PurgeResult {
  const dir = resolve(options.dir);
  const name = options.name ?? "miyocss";
  const minify = options.minify ?? true;
  const prune = options.prune ?? true;

  const css = cache.css(minify);
  const hash = hashCss(css);
  const href = `${name}.${hash}.css`;
  const file = join(dir, href);

  mkdirSync(dir, { recursive: true });
  writeFileSync(file, css, "utf-8");

  // Prune stale siblings so the output dir doesn't accumulate dead files.
  let pruned = 0;
  if (prune && existsSync(dir)) {
    for (const entry of readdirSync(dir)) {
      if (entry === href || !entry.startsWith(`${name}.`) || !entry.endsWith(".css")) {
        continue;
      }
      const stale = join(dir, entry);
      try {
        if (statSync(stale).isFile()) {
          unlinkSync(stale);
          pruned++;
        }
      } catch {
        /* ignore — concurrent or already gone */
      }
    }
  }

  return { file, href, hash, size: css.length, classes: cache.size, files: 0, pruned };
}

// ===== Directory purge (SPA / static / SSG output) =====

export interface PurgeDirectoryOptions extends PurgeToFileOptions {
  /** Directory to scan recursively for HTML files. */
  dir: string;
  /** Output directory for the CSS (default: same as `dir`). */
  out?: string;
  /** Rewrite inline `<style data-miyocss>` tags into a single `<link>` (default: false). */
  rewrite?: boolean;
  /** Resolved config (default: built-in defaults). */
  config?: ResolvedConfig | MiyoConfig;
}

const STYLE_TAG_RE = /<style\s+data-miyocss[^>]*>[\s\S]*?<\/style>/g;

/**
 * Scan a directory of HTML files, collect every used utility class and emit
 * one content-hashed CSS file. Optionally rewrite inline `<style>` tags into
 * a `<link>` so the whole site shares a single cached stylesheet.
 *
 * @example
 * ```ts
 * const result = purgeDirectory({
 *   dir: "dist",           // asi build --ssg output, or a static folder
 *   rewrite: true,         // replace inline styles with <link>
 * });
 * // writes dist/miyocss.<hash>.css, returns { href, classes, files, … }
 * ```
 */
export function purgeDirectory(options: PurgeDirectoryOptions): PurgeResult {
  const dir = resolve(options.dir);
  const config = isResolvedConfig(options.config)
    ? options.config
    : resolveConfig(options.config);
  const cache = new PurgeCache(config);

  const htmlFiles = findHtmlFiles(dir);
  for (const file of htmlFiles) {
    cache.addFromHtml(readFileSync(file, "utf-8"));
  }

  const result = purgeToFile(cache, {
    dir: options.out ? resolve(options.out) : dir,
    name: options.name,
    minify: options.minify,
    prune: options.prune,
  });

  // Second pass: swap inline style tags for a <link> to the hashed file.
  let rewritten = 0;
  if (options.rewrite) {
    for (const file of htmlFiles) {
      const html = readFileSync(file, "utf-8");
      const next = html.replace(
        STYLE_TAG_RE,
        `<link rel="stylesheet" href="${result.href}">`,
      );
      if (next !== html) {
        writeFileSync(file, next, "utf-8");
        rewritten++;
      }
    }
  }

  return { ...result, files: htmlFiles.length, pruned: result.pruned };
}

/** Recursively collect `.html` files under a directory (sorted). */
export function findHtmlFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        if (entry === "node_modules" || entry === ".git") continue;
        walk(full);
      } else if (entry.endsWith(".html")) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out.sort();
}
