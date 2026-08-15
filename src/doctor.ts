/**
 * asi doctor — Project Diagnostics for AsiJS
 *
 * Checks:
 * - Configuration files (asi.config.ts / asi.config.js / package.json)
 * - Dependencies (asijs installed, version, peer deps present)
 * - TypeScript strict mode
 * - Security best practices (validation on mutations, rate limiting, auth)
 *
 * @example
 * ```ts
 * import { runDoctor } from "asijs";
 *
 * const report = await runDoctor(process.cwd());
 * for (const check of report.checks) console.log(check.status, check.name);
 * ```
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";

// ============================================================================
// Types
// ============================================================================

export type CheckStatus = "pass" | "warn" | "fail" | "skip" | "info";

export interface DoctorCheck {
  /** Unique check name */
  name: string;
  /** Human-readable label */
  label: string;
  /** Check category */
  category: "config" | "dependencies" | "typescript" | "security";
  status: CheckStatus;
  /** Detail / reason (shown on fail or warn) */
  detail?: string;
  /** Fix suggestion */
  suggestion?: string;
}

export interface DoctorReport {
  /** Project root that was analyzed */
  cwd: string;
  checks: DoctorCheck[];
  /** Counts by status */
  summary: { pass: number; warn: number; fail: number; skip: number; info: number };
  /** True when everything passed */
  healthy: boolean;
}

export interface DoctorOptions {
  cwd?: string;
  /** Skip network checks (npm registry version lookup). Default: true (offline) */
  offline?: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

interface PkgJson {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  [key: string]: unknown;
}

function readPkg(cwd: string): PkgJson | null {
  const path = join(cwd, "package.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as PkgJson;
  } catch {
    return null;
  }
}

function readTsconfig(cwd: string): Record<string, unknown> | null {
  for (const name of ["tsconfig.json", "tsconfig.build.json"]) {
    const path = join(cwd, name);
    if (existsSync(path)) {
      try {
        return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function readFileSafe(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

// ============================================================================
// Check builders
// ============================================================================

function configChecks(cwd: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  // 1. package.json exists and is valid JSON
  const pkg = readPkg(cwd);
  if (!pkg) {
    checks.push({
      name: "package.json",
      label: "package.json exists and is valid",
      category: "config",
      status: "fail",
      detail: "No valid package.json found in the project root.",
      suggestion: "Run `bun init` or `bunx asijs create <name>` to scaffold a project.",
    });
  } else {
    checks.push({
      name: "package.json",
      label: "package.json exists and is valid",
      category: "config",
      status: "pass",
      detail: `package.json v${pkg.version ?? "?"}`,
    });
  }

  // 2. Config file (asi.config.ts / asi.config.js)
  const hasAsiConfig =
    existsSync(join(cwd, "asi.config.ts")) ||
    existsSync(join(cwd, "asi.config.js"));
  if (hasAsiConfig) {
    checks.push({
      name: "asi-config",
      label: "AsiJS config file",
      category: "config",
      status: "pass",
      detail: "Found asi.config.ts/asi.config.js",
    });
  } else {
    checks.push({
      name: "asi-config",
      label: "AsiJS config file",
      category: "config",
      status: "skip",
      detail: "No asi.config file — using defaults (this is fine).",
    });
  }

  // 3. Entry file
  const entry =
    join(cwd, "src", "index.ts") ||
    join(cwd, "index.ts");
  const hasEntry =
    existsSync(join(cwd, "src", "index.ts")) ||
    existsSync(join(cwd, "src", "app.ts")) ||
    existsSync(join(cwd, "index.ts"));
  checks.push({
    name: "entry",
    label: "Entry point found",
    category: "config",
    status: hasEntry ? "pass" : "fail",
    detail: hasEntry ? "Found src/index.ts, src/app.ts or index.ts" : "No entry file found",
    suggestion: hasEntry ? undefined : "Create src/index.ts with `const app = new Asi()` and routes.",
  });
  void entry;

  return checks;
}

function dependencyChecks(cwd: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const pkg = readPkg(cwd);

  if (!pkg) {
    checks.push({
      name: "deps",
      label: "Dependencies",
      category: "dependencies",
      status: "skip",
      detail: "No package.json to inspect.",
    });
    return checks;
  }

  const allDeps = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
    ...(pkg.peerDependencies ?? {}),
  };

  // asijs installed?
  const asijsVersion = allDeps.asijs;
  if (asijsVersion) {
    checks.push({
      name: "asijs",
      label: "asijs dependency",
      category: "dependencies",
      status: "pass",
      detail: `asijs: ${asijsVersion}`,
    });
  } else {
    checks.push({
      name: "asijs",
      label: "asijs dependency",
      category: "dependencies",
      status: "fail",
      detail: "asijs is not listed in dependencies.",
      suggestion: "Run `bun add asijs`.",
    });
  }

  // typescript installed?
  const ts = allDeps.typescript;
  checks.push({
    name: "typescript",
    label: "TypeScript installed",
    category: "dependencies",
    status: ts ? "pass" : "warn",
    detail: ts ? `typescript: ${ts}` : "typescript not found",
    suggestion: ts ? undefined : "Run `bun add -d typescript`.",
  });

  // @types/bun
  const bunTypes = allDeps["@types/bun"];
  checks.push({
    name: "@types/bun",
    label: "@types/bun installed",
    category: "dependencies",
    status: bunTypes ? "pass" : "skip",
    detail: bunTypes ? `@types/bun: ${bunTypes}` : "Not required when using bun-types via bun's built-in types.",
  });

  // Scripts present?
  const hasDev = !!pkg.scripts?.dev;
  checks.push({
    name: "dev-script",
    label: "dev script",
    category: "dependencies",
    status: hasDev ? "pass" : "warn",
    detail: hasDev ? `dev: ${pkg.scripts!.dev}` : "No `dev` script in package.json",
    suggestion: hasDev ? undefined : 'Add "dev": "bun run --hot src/index.ts" to scripts.',
  });

  return checks;
}

function typescriptChecks(cwd: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const tsconfig = readTsconfig(cwd);

  if (!tsconfig) {
    checks.push({
      name: "tsconfig",
      label: "tsconfig.json exists",
      category: "typescript",
      status: "warn",
      detail: "No tsconfig.json found.",
      suggestion: "Create a tsconfig.json with strict: true for type safety.",
    });
    return checks;
  }

  checks.push({
    name: "tsconfig",
    label: "tsconfig.json exists",
    category: "typescript",
    status: "pass",
    detail: "Found tsconfig.json",
  });

  const compilerOptions = (tsconfig.compilerOptions ?? {}) as Record<string, unknown>;
  const strict = compilerOptions.strict === true;

  checks.push({
    name: "strict",
    label: "TypeScript strict mode",
    category: "typescript",
    status: strict ? "pass" : "fail",
    detail: strict ? "strict: true" : `strict: ${String(compilerOptions.strict ?? "false")}`,
    suggestion: strict ? undefined : 'Set "compilerOptions": { "strict": true } in tsconfig.json.',
  });

  // moduleResolution bundler recommended for Bun
  const mr = compilerOptions.moduleResolution;
  checks.push({
    name: "module-resolution",
    label: "Bundler module resolution",
    category: "typescript",
    status: mr === "bundler" || mr === "node" ? "pass" : "info",
    detail: `moduleResolution: ${String(mr ?? "not set")}`,
    suggestion: mr === "bundler" ? undefined : 'Consider "moduleResolution": "bundler" for Bun projects.',
  });

  return checks;
}

function securityChecks(cwd: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const srcDir = join(cwd, "src");
  const entryFiles = [
    join(cwd, "src", "index.ts"),
    join(cwd, "src", "app.ts"),
    join(cwd, "index.ts"),
    join(cwd, "app.ts"),
  ];
  const sources = entryFiles.map((f) => readFileSafe(f)).join("\n");

  if (!sources.trim()) {
    checks.push({
      name: "security-source",
      label: "Security scan (source code)",
      category: "security",
      status: "skip",
      detail: "No entry source found to scan.",
    });
    return checks;
  }
  void srcDir;

  // Rate limiting present?
  const hasRateLimit = /rateLimit|rate-limit|limiter/i.test(sources);
  checks.push({
    name: "rate-limit",
    label: "Rate limiting",
    category: "security",
    status: hasRateLimit ? "pass" : "warn",
    detail: hasRateLimit ? "Rate limiting detected" : "No rate limiting detected",
    suggestion: hasRateLimit ? undefined : "Consider adding app.plugin(rateLimit({ max: 100, windowMs: 60_000 })).",
  });

  // Validation on mutating routes
  const hasMutation = /\.(post|put|patch|delete)\s*\(/.test(sources);
  const hasSchema = /schema\s*:|Type\.Object/.test(sources);
  if (!hasMutation) {
    checks.push({
      name: "mutation-validation",
      label: "Validation on mutating routes",
      category: "security",
      status: "skip",
      detail: "No mutating routes (POST/PUT/PATCH/DELETE) found.",
    });
  } else if (hasSchema) {
    checks.push({
      name: "mutation-validation",
      label: "Validation on mutating routes",
      category: "security",
      status: "pass",
      detail: "Validation schemas detected",
    });
  } else {
    checks.push({
      name: "mutation-validation",
      label: "Validation on mutating routes",
      category: "security",
      status: "warn",
      detail: "Mutating routes found without validation schemas",
      suggestion: "Add TypeBox schemas to POST/PUT/PATCH/DELETE routes.",
    });
  }

  // Security headers / plugin
  const hasSecurity = /security\s*\(|autoEscape|csp|Content-Security-Policy/i.test(sources);
  checks.push({
    name: "security-headers",
    label: "Security headers",
    category: "security",
    status: hasSecurity ? "pass" : "info",
    detail: hasSecurity ? "Security headers detected" : "No security plugin detected",
    suggestion: hasSecurity ? undefined : "Consider app.plugin(security()) for OWASP headers and XSS protection.",
  });

  // Hard-coded secrets
  const secrets = [
    { re: /(api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"']+["']/i, name: "hard-coded credentials" },
    { re: /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/, name: "hard-coded bearer token" },
  ];
  for (const { re, name } of secrets) {
    if (re.test(sources)) {
      checks.push({
        name: "secrets",
        label: "Hard-coded secrets",
        category: "security",
        status: "fail",
        detail: `Possible ${name} detected in entry source.`,
        suggestion: "Move secrets to environment variables (.env) and read via process.env.",
      });
      break;
    }
  }
  if (!checks.some((c) => c.name === "secrets")) {
    checks.push({
      name: "secrets",
      label: "Hard-coded secrets",
      category: "security",
      status: "pass",
      detail: "No obvious hard-coded secrets found",
    });
  }

  // Auth on admin routes (heuristic)
  const hasAdmin = /\/admin/.test(sources);
  const hasAuth = /auth|jwt|bearer|session/i.test(sources);
  if (hasAdmin && !hasAuth) {
    checks.push({
      name: "admin-auth",
      label: "Auth on admin routes",
      category: "security",
      status: "warn",
      detail: "Admin routes found without auth",
      suggestion: "Protect /admin* routes with JWT or session auth.",
    });
  } else {
    checks.push({
      name: "admin-auth",
      label: "Auth on admin routes",
      category: "security",
      status: hasAdmin ? "pass" : "skip",
      detail: hasAdmin ? "Admin routes + auth detected" : "No admin routes detected",
    });
  }

  return checks;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Run all diagnostic checks on a project.
 *
 * @returns Full report with per-check statuses and a summary.
 */
export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  const cwd = options.cwd ?? process.cwd();

  const checks: DoctorCheck[] = [
    ...configChecks(cwd),
    ...dependencyChecks(cwd),
    ...typescriptChecks(cwd),
    ...securityChecks(cwd),
  ];

  const summary = {
    pass: checks.filter((c) => c.status === "pass").length,
    warn: checks.filter((c) => c.status === "warn").length,
    fail: checks.filter((c) => c.status === "fail").length,
    skip: checks.filter((c) => c.status === "skip").length,
    info: checks.filter((c) => c.status === "info").length,
  };

  return {
    cwd,
    checks,
    summary,
    healthy: summary.fail === 0 && summary.warn === 0,
  };
}
