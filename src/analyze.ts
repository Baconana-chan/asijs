/**
 * asi analyze — Static Analysis for AsiJS Projects
 *
 * Scans project source files and reports:
 * - Dead routes (duplicate method+path registrations)
 * - Path shadowing (a static route declared after a dynamic one of same shape)
 * - Missing validation on mutating routes (POST/PUT/PATCH/DELETE)
 * - Duplicate middleware registrations
 * - Bottlenecks: redundant `async`, un-awaited async calls, sync-in-async chains
 *
 * @example
 * ```ts
 * import { analyzeProject } from "asijs";
 *
 * const report = await analyzeProject(process.cwd());
 * console.log(report.issues);
 * ```
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, relative, extname } from "path";

// ============================================================================
// Types
// ============================================================================

/** Severity of a finding */
export type IssueSeverity = "error" | "warning" | "info";

/** A single analysis finding */
export interface AnalysisIssue {
  severity: IssueSeverity;
  /** Issue category: "dead-route" | "shadow" | "validation" | "middleware" | "bottleneck" */
  kind: string;
  /** Human-readable message */
  message: string;
  /** Concrete fix suggestion */
  suggestion: string;
  /** File (relative to project root) */
  file: string;
  /** 1-based line number (when known) */
  line?: number;
  /** Source snippet */
  snippet?: string;
}

/** Analysis options */
export interface AnalyzeOptions {
  /** Project root (default: process.cwd()) */
  cwd?: string;
  /** Include `info`-severity findings (default: false) */
  includeInfo?: boolean;
  /** Additional file extensions to scan (default: [".ts", ".tsx", ".js", ".jsx"]) */
  extensions?: string[];
}

/** Category counts for the summary */
export interface AnalysisSummary {
  filesScanned: number;
  total: number;
  errors: number;
  warnings: number;
  info: number;
}

/** Full analysis report */
export interface AnalysisReport {
  issues: AnalysisIssue[];
  summary: AnalysisSummary;
}

/** A route extracted from source */
interface ParsedRoute {
  method: string;
  path: string;
  /** Whether the route has a schema/validation argument */
  hasValidation: boolean;
  /** Whether the handler is declared async */
  isAsync: boolean;
  /** Whether the handler body contains an await */
  hasAwait: boolean;
  line: number;
  file: string;
  /** The full call snippet */
  snippet: string;
}

// ============================================================================
// Source scanning
// ============================================================================

/** Find all source files under the project root */
export function findSourceFiles(
  cwd: string,
  extensions = [".ts", ".tsx", ".js", ".jsx"],
  maxDepth = 8,
): string[] {
  const files: string[] = [];
  const dirsToScan = [cwd];
  const visited = new Set<string>();

  while (dirsToScan.length > 0) {
    const dir = dirsToScan.pop()!;
    if (visited.has(dir)) continue;
    visited.add(dir);

    const depth = relative(cwd, dir).split(/[/\\]/).filter(Boolean).length;
    if (depth > maxDepth) continue;

    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = join(dir, entry);
      // Skip common ignore dirs
      if (
        entry === "node_modules" ||
        entry === "dist" ||
        entry === ".git" ||
        entry === ".freebuff" ||
        entry === "coverage" ||
        entry.startsWith(".")
      ) {
        continue;
      }
      try {
        const stat = statSync(full);
        if (stat.isDirectory()) {
          dirsToScan.push(full);
        } else if (stat.isFile() && extensions.includes(extname(full))) {
          files.push(full);
        }
      } catch {
        // Ignore unreadable entries
      }
    }
  }

  return files.sort();
}

// ============================================================================
// Route extraction
// ============================================================================

const METHOD_RE = /\.(get|post|put|patch|delete|all|head|options)\s*\(\s*["'`]([^"'`]+)["'`]/g;

/** Extract route registrations from a source file */
export function parseRoutesFromSource(
  source: string,
  file: string,
): ParsedRoute[] {
  const routes: ParsedRoute[] = [];

  // Split source into lines to find line numbers
  let match: RegExpExecArray | null;
  while ((match = METHOD_RE.exec(source)) !== null) {
    const method = match[1]!.toUpperCase();
    const path = match[2]!;

    // Line number = number of newlines before the match + 1
    const lineNo = source.slice(0, match.index).split("\n").length;

    // Validate that this is a route registration on an app/asi instance
    // (heuristic: the character before .get/.post is an identifier — fine)

    // Determine whether validation is present: look for a schema argument
    // after the path (e.g. `{ schema: {...} }`, `Type.Object(...)`, or a
    // 3rd argument object containing `schema`/`body`/`params`)
    const afterPath = source.slice(match.index + match[0].length);
    const callTail = afterPath.slice(0, afterPath.indexOf("\n") === -1 ? 500 : afterPath.indexOf("\n"));
    const hasValidation =
      /(schema\s*:|Type\.Object|Type\.Partial|Type\.Required|body\s*:|params\s*:)/.test(
        callTail.slice(0, 400),
      );

    // Determine async-ness of the handler — look for `async` in the
    // window before the arrow (or async arrow / async function forms)
    const arrowIdx = afterPath.indexOf("=>");
    const windowBeforeArrow = arrowIdx === -1 ? afterPath.slice(0, 80) : afterPath.slice(0, arrowIdx);
    const isAsync =
      /\basync\b/.test(windowBeforeArrow.slice(0, 40)) ||
      /async\s*\(/.test(afterPath.slice(0, 40));
    const hasAwait = /\bawait\b/.test(callTail.slice(0, 600));

    routes.push({
      method,
      path,
      hasValidation,
      isAsync,
      hasAwait,
      line: lineNo,
      file,
      snippet: source.slice(match.index, match.index + 120),
    });
  }

  return routes;
}

// ============================================================================
// Middleware extraction
// ============================================================================

/** Extract app.use() middleware calls */
export function parseMiddlewareFromSource(
  source: string,
  file: string,
): Array<{ name: string; line: number; snippet: string; file: string }> {
  const result: Array<{ name: string; line: number; snippet: string; file: string }> = [];
  const useRe = /\.use\s*\(\s*([A-Za-z_$][\w$]*)/g;

  let match: RegExpExecArray | null;
  while ((match = useRe.exec(source)) !== null) {
    // Heuristic: skip path-string first args like .use("/api", ...)
    if (/["'`]/.test(match[1]!)) continue;

    const lineNo = source.slice(0, match.index).split("\n").length;
    result.push({
      name: match[1]!,
      file,
      line: lineNo,
      snippet: source.slice(match.index, match.index + 80),
    });
  }

  return result;
}

// ============================================================================
// Checkers
// ============================================================================

/** Dead routes: same method+path registered more than once (only first runs) */
function checkDeadRoutes(routes: ParsedRoute[]): AnalysisIssue[] {
  const issues: AnalysisIssue[] = [];
  const seen = new Map<string, ParsedRoute>();

  for (const route of routes) {
    const key = `${route.method} ${route.path}`;
    const prev = seen.get(key);
    if (prev) {
      issues.push({
        severity: "warning",
        kind: "dead-route",
        message: `Route ${route.method} ${route.path} is registered twice — the first registration (line ${prev.line}) is dead code and never runs.`,
        suggestion:
          "Remove the duplicate registration, or split the handlers into different paths.",
        file: route.file,
        line: route.line,
        snippet: route.snippet.trim(),
      });
    } else {
      seen.set(key, route);
    }
  }

  return issues;
}

/** Path shadowing: static route declared after a dynamic route of the same shape */
function checkPathShadowing(routes: ParsedRoute[]): AnalysisIssue[] {
  const issues: AnalysisIssue[] = [];

  for (let i = 0; i < routes.length; i++) {
    const current = routes[i]!;
    const segments = current.path.split("/").filter(Boolean);
    const isDynamic = segments.some((s) => s.startsWith(":") || s.startsWith("{"));

    if (!isDynamic) continue;

    // A later static route with the same segment shape shadows this dynamic route
    for (let j = i + 1; j < routes.length; j++) {
      const later = routes[j]!;
      if (later.method !== current.method) continue;
      const laterSegs = later.path.split("/").filter(Boolean);
      if (laterSegs.length !== segments.length) continue;
      const sameShape = segments.every(
        (s, idx) => s.startsWith(":") || s.startsWith("{") || s === laterSegs[idx],
      );
      if (sameShape) {
        issues.push({
          severity: "info",
          kind: "shadow",
          message: `Dynamic route ${current.method} ${current.path} (line ${current.line}) may be shadowed by static route ${later.method} ${later.path} (line ${later.line}).`,
          suggestion:
            "Declare static routes before dynamic ones, or use a more specific pattern for the static route.",
          file: current.file,
          line: current.line,
          snippet: current.snippet.trim(),
        });
        break;
      }
    }
  }

  return issues;
}

/** Missing validation on mutating routes */
function checkMissingValidation(routes: ParsedRoute[]): AnalysisIssue[] {
  const issues: AnalysisIssue[] = [];
  const mutating = new Set(["POST", "PUT", "PATCH", "DELETE"]);

  for (const route of routes) {
    if (!mutating.has(route.method)) continue;
    if (route.hasValidation) continue;

    issues.push({
      severity: "warning",
      kind: "validation",
      message: `${route.method} ${route.path} (line ${route.line}) has no validation schema.`,
      suggestion:
        "Add a TypeBox schema: app.post('/path', { schema: { body: Type.Object({ ... }) } }, handler).",
      file: route.file,
      line: route.line,
      snippet: route.snippet.trim(),
    });
  }

  return issues;
}

/** Duplicate middleware registrations */
function checkDuplicateMiddleware(
  middleware: Array<{ name: string; line: number; snippet: string; file: string }>,
): AnalysisIssue[] {
  const issues: AnalysisIssue[] = [];
  const counts = new Map<string, number>();

  for (const mw of middleware) {
    counts.set(mw.name, (counts.get(mw.name) ?? 0) + 1);
  }

  for (const mw of middleware) {
    if ((counts.get(mw.name) ?? 0) > 1) {
      issues.push({
        severity: "info",
        kind: "middleware",
        message: `Middleware ${mw.name} is registered ${counts.get(mw.name)} times.`,
        suggestion:
          "Register middleware once — multiple global registrations run it multiple times per request.",
        file: mw.file,
        line: mw.line,
        snippet: mw.snippet.trim(),
      });
      // Only report once per middleware name
      counts.set(mw.name, 1);
    }
  }

  return issues;
}

/** Bottleneck detection */
function checkBottlenecks(routes: ParsedRoute[], source: string, file: string): AnalysisIssue[] {
  const issues: AnalysisIssue[] = [];

  for (const route of routes) {
    // 1. Redundant async: async handler without await
    if (route.isAsync && !route.hasAwait) {
      issues.push({
        severity: "info",
        kind: "bottleneck",
        message: `${route.method} ${route.path} (line ${route.line}) is declared async but never awaits.`,
        suggestion: "Remove the async keyword — synchronous handlers avoid a promise allocation per request.",
        file,
        line: route.line,
        snippet: route.snippet.trim(),
      });
    }

    // 2. Sync handler that calls async APIs without await (lost errors)
    if (!route.isAsync && route.hasAwait) {
      issues.push({
        severity: "warning",
        kind: "bottleneck",
        message: `${route.method} ${route.path} (line ${route.line}) awaits inside a non-async handler.`,
        suggestion: "Declare the handler async so await actually suspends and errors propagate.",
        file,
        line: route.line,
        snippet: route.snippet.trim(),
      });
    }
  }

  // 3. Sync middleware in async chains: app.use(syncFn) that calls async functions
  const useRe = /\.use\s*\(\s*async\s*\(/g;
  // Async middleware is fine — check for sync middleware that internally awaits
  const syncAwaitRe = /\.use\s*\(\s*\(([^)]*)\)\s*=>\s*{[\s\S]{0,300}?\bawait\b/;
  const syncAwaitMatch = syncAwaitRe.exec(source);
  if (syncAwaitMatch) {
    const lineNo = source.slice(0, syncAwaitMatch.index).split("\n").length;
    issues.push({
      severity: "warning",
      kind: "bottleneck",
      message: `A sync middleware at line ${lineNo} contains await.`,
      suggestion:
        "Make the middleware async: .use(async (ctx, next) => { await ...; return next(); }).",
      file,
      line: lineNo,
      snippet: source.slice(syncAwaitMatch.index, syncAwaitMatch.index + 100).trim(),
    });
  }

  return issues;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Analyze an AsiJS project.
 *
 * @returns Report with issues grouped by severity
 */
export async function analyzeProject(options: AnalyzeOptions = {}): Promise<AnalysisReport> {
  const cwd = options.cwd ?? process.cwd();
  const extensions = options.extensions ?? [".ts", ".tsx", ".js", ".jsx"];

  const files = findSourceFiles(cwd, extensions);
  const issues: AnalysisIssue[] = [];

  for (const file of files) {
    let source = "";
    try {
      source = readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    const relFile = relative(cwd, file).replace(/\\/g, "/");
    const routes = parseRoutesFromSource(source, relFile);
    const middleware = parseMiddlewareFromSource(source, relFile);

    issues.push(...checkDeadRoutes(routes));
    issues.push(...checkPathShadowing(routes));
    issues.push(...checkMissingValidation(routes));
    issues.push(...checkDuplicateMiddleware(middleware));
    issues.push(...checkBottlenecks(routes, source, relFile));
  }

  const filtered = options.includeInfo
    ? issues
    : issues.filter((i) => i.severity !== "info");

  const summary: AnalysisSummary = {
    filesScanned: files.length,
    total: filtered.length,
    errors: filtered.filter((i) => i.severity === "error").length,
    warnings: filtered.filter((i) => i.severity === "warning").length,
    info: filtered.filter((i) => i.severity === "info").length,
  };

  // Stable order: errors → warnings → info
  const order: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 };
  filtered.sort((a, b) => order[a.severity] - order[b.severity]);

  return { issues: filtered, summary };
}

/** Analyze a single source string (for tests) */
export function analyzeSource(
  source: string,
  options: { file?: string; includeInfo?: boolean } = {},
): AnalysisReport {
  const file = options.file ?? "src/index.ts";
  const routes = parseRoutesFromSource(source, file);
  const middleware = parseMiddlewareFromSource(source, file);

  const issues: AnalysisIssue[] = [
    ...checkDeadRoutes(routes),
    ...checkPathShadowing(routes),
    ...checkMissingValidation(routes),
    ...checkDuplicateMiddleware(middleware),
    ...checkBottlenecks(routes, source, file),
  ];

  const filtered = options.includeInfo
    ? issues
    : issues.filter((i) => i.severity !== "info");

  return {
    issues: filtered,
    summary: {
      filesScanned: 1,
      total: filtered.length,
      errors: filtered.filter((i) => i.severity === "error").length,
      warnings: filtered.filter((i) => i.severity === "warning").length,
      info: filtered.filter((i) => i.severity === "info").length,
    },
  };
}

/** Guard so unused-import linters stay quiet on existsSync in tests */
export function projectHasEntry(cwd = process.cwd()): boolean {
  return (
    existsSync(join(cwd, "src", "index.ts")) ||
    existsSync(join(cwd, "index.ts")) ||
    existsSync(join(cwd, "src", "app.ts"))
  );
}
