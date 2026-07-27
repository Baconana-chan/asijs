/**
 * Plugin Registry & Community
 *
 * Provides:
 * - `asi plugin search [query]` — search plugins in the official registry
 * - `asi plugin install <name>` — install from npm + add to package.json
 * - `asi plugin create <name>` — scaffold a new plugin with template
 * - `asi plugin list` — list installed plugins
 *
 * Also exports the curated awesome-asijs plugin list for README generation.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import type { AsiPlugin } from "./plugin";

// ============================================================================
// Registry Types
// ============================================================================

/** A plugin entry in the official registry */
export interface RegistryPlugin {
  name: string;
  description: string;
  npmPackage: string;
  version?: string;
  author?: string;
  license?: string;
  tags?: string[];
  repository?: string;
  homepage?: string;
  /** Plugin category: auth, cache, db, security, etc. */
  category?: string;
}

/** Installed plugin info in the current project */
export interface InstalledPlugin {
  name: string;
  version: string;
  path: string;
  isLocal: boolean;
}

/** Scaffold options for asi plugin create */
export interface PluginScaffoldOptions {
  name: string;
  description?: string;
  author?: string;
  withTests?: boolean;
  withExample?: boolean;
  /** Base directory for the scaffold (default: process.cwd()) */
  baseDir?: string;
}

// ============================================================================
// Official Registry Data
// ============================================================================

/** Curated awesome-asijs plugin list */
export const AWESOME_PLUGINS: RegistryPlugin[] = [
  // ---------- Auth / Security ----------
  {
    name: "cors",
    description: "Cross-Origin Resource Sharing — configure allowed origins, methods, headers",
    npmPackage: "asijs",
    tags: ["security", "headers"],
    category: "auth",
  },
  {
    name: "jwt",
    description: "JWT authentication helpers — sign, verify, decode tokens",
    npmPackage: "asijs",
    tags: ["auth", "jwt", "tokens"],
    category: "auth",
  },
  {
    name: "bearer",
    description: "Bearer token middleware — protect routes with token verification",
    npmPackage: "asijs",
    tags: ["auth", "middleware"],
    category: "auth",
  },
  {
    name: "csrf",
    description: "CSRF protection — token generation, double-submit cookie pattern",
    npmPackage: "asijs",
    tags: ["security", "csrf"],
    category: "auth",
  },
  {
    name: "rateLimit",
    description: "Rate limiting — MemoryStore, TokenBucket, Redis, per-tenant presets",
    npmPackage: "asijs",
    tags: ["security", "rate-limiting", "performance"],
    category: "auth",
  },
  {
    name: "sessions",
    description: "Session management — MemoryStore, CookieStore, signed cookies, TTL",
    npmPackage: "asijs",
    tags: ["auth", "sessions", "cookies"],
    category: "auth",
  },

  // ---------- API / Docs ----------
  {
    name: "openapi",
    description: "OpenAPI / Swagger — auto-generate OpenAPI 3.0/3.1 spec from routes",
    npmPackage: "asijs",
    tags: ["api", "docs", "openapi", "swagger"],
    category: "api",
  },
  {
    name: "apiVersion",
    description: "API versioning — URL/header strategies, deprecation headers, fallback",
    npmPackage: "asijs",
    tags: ["api", "versioning"],
    category: "api",
  },
  {
    name: "apiDocs",
    description: "API Documentation Portal — interactive docs, code samples, try-it-out",
    npmPackage: "asijs",
    tags: ["api", "docs", "portal"],
    category: "api",
  },
  {
    name: "rpc",
    description: "RPC 2.0 — typed server actions, Eden client, batch requests",
    npmPackage: "asijs",
    tags: ["api", "rpc", "client"],
    category: "api",
  },

  // ---------- Performance ----------
  {
    name: "compression",
    description: "Response compression — gzip/brotli, threshold, content-type filter",
    npmPackage: "asijs",
    tags: ["performance", "compression"],
    category: "performance",
  },
  {
    name: "cache",
    description: "Response caching — ETag, MemoryCache, presets for common patterns",
    npmPackage: "asijs",
    tags: ["performance", "caching"],
    category: "performance",
  },
  {
    name: "deduplicate",
    description: "Request deduplication — parallel request coalescing, XFetch cache stampede protection",
    npmPackage: "asijs",
    tags: ["performance", "caching", "dedup"],
    category: "performance",
  },
  {
    name: "staticFiles",
    description: "Static file serving — ETag, cache headers, directory index, MIME types",
    npmPackage: "asijs",
    tags: ["static", "files", "assets"],
    category: "performance",
  },

  // ---------- Observability ----------
  {
    name: "requestLogger",
    description: "Request logging — colorized dev output, JSON structured logging",
    npmPackage: "asijs",
    tags: ["observability", "logging"],
    category: "observability",
  },
  {
    name: "structuredLogger",
    description: "Structured JSON logging — levels, child loggers, request middleware",
    npmPackage: "asijs",
    tags: ["observability", "logging", "structured"],
    category: "observability",
  },
  {
    name: "trace",
    description: "Distributed tracing — W3C traceparent, Server-Timing, OpenTelemetry compatible",
    npmPackage: "asijs",
    tags: ["observability", "tracing"],
    category: "observability",
  },
  {
    name: "metrics",
    description: "Prometheus / OTLP metrics — counters, histograms, gauges, exporters",
    npmPackage: "asijs",
    tags: ["observability", "metrics", "prometheus"],
    category: "observability",
  },
  {
    name: "sentry",
    description: "Sentry error tracking — event capture, breadcrumbs, release tracking",
    npmPackage: "asijs",
    tags: ["observability", "errors", "sentry"],
    category: "observability",
  },
  {
    name: "healthCheck",
    description: "Health check endpoints — /health, /ready, /live with custom checks",
    npmPackage: "asijs",
    tags: ["observability", "health"],
    category: "observability",
  },
  {
    name: "otelPlugin",
    description: "OpenTelemetry SDK — spans, metrics, logs, OTLP/Jaeger/Zipkin exporters",
    npmPackage: "@asijs/opentelemetry",
    tags: ["observability", "opentelemetry", "tracing"],
    category: "observability",
  },

  // ---------- Middleware / Utilities ----------
  {
    name: "lifecycle",
    description: "Graceful shutdown — drain connections, cleanup, signal handling",
    npmPackage: "asijs",
    tags: ["lifecycle", "shutdown"],
    category: "middleware",
  },
  {
    name: "scheduler",
    description: "Cron / interval scheduler — delayed jobs, retry, Redis queue backend",
    npmPackage: "asijs",
    tags: ["scheduling", "cron", "jobs"],
    category: "middleware",
  },
  {
    name: "sse",
    description: "Server-Sent Events — auto-reconnect, event IDs, retry configuration",
    npmPackage: "asijs",
    tags: ["realtime", "sse", "streaming"],
    category: "middleware",
  },
  {
    name: "i18n",
    description: "Internationalization — locale detection, message bundles, typed translations",
    npmPackage: "asijs",
    tags: ["i18n", "localization"],
    category: "middleware",
  },
  {
    name: "graphql",
    description: "GraphQL plugin — schema, resolvers, GraphiQL playground",
    npmPackage: "asijs",
    tags: ["graphql", "api"],
    category: "middleware",
  },
  {
    name: "webhook",
    description: "Webhook handling — signature verification, retry, event dispatching",
    npmPackage: "asijs",
    tags: ["webhooks", "events"],
    category: "middleware",
  },
  {
    name: "circuitBreaker",
    description: "Circuit breaker — CLOSED/OPEN/HALF_OPEN, timeout, sliding window, healthcheck",
    npmPackage: "asijs",
    tags: ["resilience", "circuit-breaker"],
    category: "middleware",
  },

  // ---------- Data / Storage ----------
  {
    name: "db",
    description: "Database helpers — Drizzle, Prisma, Kysely integrations",
    npmPackage: "asijs",
    tags: ["database", "orm", "sql"],
    category: "data",
  },
  {
    name: "upload",
    description: "File upload — multipart parsing, MIME validation, size limits, S3/R2",
    npmPackage: "asijs",
    tags: ["upload", "files", "storage"],
    category: "data",
  },
  {
    name: "uploadProvider",
    description: "Upload storage providers — local FS, S3, R2, with naming strategies",
    npmPackage: "asijs",
    tags: ["upload", "storage", "s3"],
    category: "data",
  },
  {
    name: "redis",
    description: "Redis utilities — rate limit store, queue, delayed jobs, pub-sub",
    npmPackage: "asijs",
    tags: ["redis", "cache", "queue"],
    category: "data",
  },

  // ---------- Integration / Migration ----------
  {
    name: "expressPlugin",
    description: "Express.js adapter — run Express middleware inside AsiJS",
    npmPackage: "asijs",
    tags: ["migration", "express", "compatibility"],
    category: "integration",
  },
  {
    name: "koaPlugin",
    description: "Koa adapter — run Koa middleware inside AsiJS",
    npmPackage: "asijs",
    tags: ["migration", "koa", "compatibility"],
    category: "integration",
  },
  {
    name: "codemod",
    description: "Framework codemods — auto-migrate from Elysia, Hono, Fastify, Express, Koa",
    npmPackage: "asijs",
    tags: ["migration", "codemod", "transformation"],
    category: "integration",
  },

  // ---------- Deployment ----------
  {
    name: "serverless",
    description: "Serverless optimization — cold start reduction, lazy imports, platform configs",
    npmPackage: "asijs",
    tags: ["deployment", "serverless", "cloudflare", "lambda"],
    category: "deployment",
  },
  {
    name: "nodeAdapter",
    description: "Node.js adapter — run AsiJS on Node.js with HTTP/WS support",
    npmPackage: "asijs",
    tags: ["runtime", "node", "compatibility"],
    category: "deployment",
  },
  {
    name: "edge",
    description: "Edge adapters — Cloudflare Workers, Deno, Vercel Edge, Lambda@Edge, Netlify",
    npmPackage: "asijs",
    tags: ["edge", "cloudflare", "deno", "lambda"],
    category: "deployment",
  },
];

// ============================================================================
// Registry
// ============================================================================

/** URL of the official plugin registry JSON */
const REGISTRY_URL = "https://raw.githubusercontent.com/Baconana-chan/asijs/main/registry.json";

/**
 * Plugin Registry class.
 * Handles searching, installing, and scaffolding plugins.
 */
export class PluginRegistry {
  private plugins: RegistryPlugin[] = [...AWESOME_PLUGINS];

  /**
   * Search plugins by name, description, or tags.
   */
  search(query?: string): RegistryPlugin[] {
    if (!query || query.trim() === "") {
      return this.plugins;
    }

    const q = query.toLowerCase().trim();
    return this.plugins.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        (p.tags || []).some((t) => t.toLowerCase().includes(q)) ||
        (p.category || "").toLowerCase().includes(q),
    );
  }

  /**
   * Get plugins by category.
   */
  getByCategory(category: string): RegistryPlugin[] {
    return this.plugins.filter((p) => p.category === category);
  }

  /**
   * Get all unique categories.
   */
  getCategories(): string[] {
    const cats = new Set(this.plugins.map((p) => p.category || "other"));
    return Array.from(cats).sort();
  }

  /**
   * Get a single plugin by name.
   */
  get(name: string): RegistryPlugin | undefined {
    return this.plugins.find((p) => p.name === name);
  }

  /**
   * Fetch the latest registry from GitHub (fallback to local on failure).
   */
  async fetchRemoteRegistry(): Promise<RegistryPlugin[]> {
    try {
      const response = await fetch(REGISTRY_URL);
      if (response.ok) {
        const remote = (await response.json()) as RegistryPlugin[];
        if (Array.isArray(remote) && remote.length > 0) {
          // Merge: local plugins override remote on name collision
          const merged = new Map<string, RegistryPlugin>();
          for (const p of remote) merged.set(p.name, p);
          for (const p of AWESOME_PLUGINS) merged.set(p.name, p);
          this.plugins = Array.from(merged.values());
          return this.plugins;
        }
      }
    } catch {
      // Network failure — use local
    }
    return this.plugins;
  }

  /**
   * Generate the awesome-asijs markdown list for README.
   */
  generateAwesomeMarkdown(): string {
    const lines: string[] = [];
    lines.push("## Awesome AsiJS Plugins");
    lines.push("");
    lines.push(
      "A curated list of AsiJS plugins and integrations. Most are built-in — just import and use.",
    );
    lines.push("");

    const categories = this.getCategories();
    for (const cat of categories) {
      const cap = cat.charAt(0).toUpperCase() + cat.slice(1);
      lines.push(`### ${cap}`);
      lines.push("");

      const catPlugins = this.getByCategory(cat);
      for (const p of catPlugins) {
        const npmLink = p.npmPackage === "asijs" ? "asijs" : `\`${p.npmPackage}\``;
        const tags = (p.tags || []).map((t) => `\`${t}\``).join(" ");
        lines.push(`- **${p.name}** — ${p.description} (${npmLink}) ${tags}`);
      }
      lines.push("");
    }

    lines.push("---");
    lines.push("");
    lines.push(
      "> Want to add your plugin? Open a PR on [github.com/Baconana-chan/asijs](https://github.com/Baconana-chan/asijs) or run `asi plugin create` to scaffold one.",
    );

    return lines.join("\n");
  }
}

// ============================================================================
// Install
// ============================================================================

/**
 * Install a plugin from npm and add it to package.json.
 * Returns the installed plugin info or an error message.
 */
export async function installPlugin(
  pluginName: string,
  options?: { cwd?: string; dev?: boolean; version?: string },
): Promise<{ success: boolean; message: string }> {
  const cwd = options?.cwd || process.cwd();
  const pkgPath = join(cwd, "package.json");

  if (!existsSync(pkgPath)) {
    return { success: false, message: "No package.json found in current directory" };
  }

  let pkg: any;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  } catch {
    return { success: false, message: "Invalid package.json" };
  }

  // Determine the npm package name from the registry
  const registry = new PluginRegistry();
  const plugin = registry.get(pluginName);
  const npmName = plugin?.npmPackage || pluginName;
  const versionSpec = options?.version || "latest";

  // Try to install via bun/npm
  const installCmd = options?.dev ? "bun add -d" : "bun add";
  const fullName = versionSpec === "latest" ? npmName : `${npmName}@${versionSpec}`;

  try {
    const proc = Bun.spawnSync(installCmd.split(" ").concat([fullName]), {
      cwd,
      env: { ...process.env },
    });

    if (!proc.success) {
      const stderr = proc.stderr.toString();
      return {
        success: false,
        message: `Installation failed: ${stderr.slice(0, 300)}`,
      };
    }

    return {
      success: true,
      message: `Installed ${fullName}${
        plugin ? ` (${plugin.description})` : ""
      }`,
    };
  } catch (e) {
    return {
      success: false,
      message: `Installation error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * Uninstall a plugin via bun/npm.
 */
export async function uninstallPlugin(
  pluginName: string,
  options?: { cwd?: string },
): Promise<{ success: boolean; message: string }> {
  const cwd = options?.cwd || process.cwd();
  const registry = new PluginRegistry();
  const plugin = registry.get(pluginName);
  const npmName = plugin?.npmPackage || pluginName;

  try {
    const proc = Bun.spawnSync(["bun", "remove", npmName], {
      cwd,
      env: { ...process.env },
    });

    if (!proc.success) {
      const stderr = proc.stderr.toString();
      return { success: false, message: `Uninstall failed: ${stderr.slice(0, 300)}` };
    }

    return { success: true, message: `Removed ${npmName}` };
  } catch (e) {
    return {
      success: false,
      message: `Uninstall error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * List installed plugins in the current project.
 * Scans package.json dependencies for known asi plugins.
 */
export function listInstalledPlugins(options?: { cwd?: string }): InstalledPlugin[] {
  const cwd = options?.cwd || process.cwd();
  const pkgPath = join(cwd, "package.json");
  const installed: InstalledPlugin[] = [];

  if (!existsSync(pkgPath)) return installed;

  let pkg: any;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  } catch {
    return installed;
  }

  const allDeps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  };

  const registry = new PluginRegistry();

  // Check all dependencies against the registry
  for (const [depName, depVersion] of Object.entries(allDeps)) {
    // Check if exact match
    const exact = registry.search(depName).find((p) => p.npmPackage === depName);
    if (exact) {
      installed.push({
        name: exact.name,
        version: String(depVersion),
        path: join(cwd, "node_modules", depName),
        isLocal: false,
      });
      continue;
    }

    // Check if it's an @asijs scoped package
    if (depName.startsWith("@asijs/")) {
      const shortName = depName.replace("@asijs/", "");
      const plugin = registry.get(shortName) || registry.search(shortName)[0];
      installed.push({
        name: plugin?.name || shortName,
        version: String(depVersion),
        path: join(cwd, "node_modules", depName),
        isLocal: false,
      });
    }
  }

  // Check for local plugins in the project
  const srcDir = join(cwd, "src");
  if (existsSync(srcDir)) {
    const files = readdirSync(srcDir);
    for (const file of files) {
      if (
        (file.endsWith(".ts") || file.endsWith(".tsx")) &&
        (file.includes("plugin") || file.includes("Plugin"))
      ) {
        installed.push({
          name: file.replace(/\.(ts|tsx)$/, ""),
          version: "local",
          path: join(srcDir, file),
          isLocal: true,
        });
      }
    }
  }

  return installed;
}

// ============================================================================
// Scaffold
// ============================================================================

/**
 * Scaffold a new plugin project.
 *
 * Creates:
 * - src/index.ts — main plugin entry with AsiPlugin export
 * - package.json — minimal package manifest
 * - tsconfig.json — TypeScript configuration
 * - README.md — plugin documentation template
 * - (optional) test/plugin.test.ts — test file
 * - (optional) examples/basic.ts — usage example
 */
export function scaffoldPlugin(options: PluginScaffoldOptions): {
  success: boolean;
  message: string;
  path: string;
} {
  const projectPath = resolve(options.baseDir || process.cwd(), options.name);

  if (existsSync(projectPath)) {
    return {
      success: false,
      message: `Directory "${options.name}" already exists`,
      path: projectPath,
    };
  }

  const pluginClassName = toPascalCase(options.name) + "Plugin";

  // Create directory structure
  mkdirSync(join(projectPath, "src"), { recursive: true });
  if (options.withTests) {
    mkdirSync(join(projectPath, "test"), { recursive: true });
  }
  if (options.withExample) {
    mkdirSync(join(projectPath, "examples"), { recursive: true });
  }

  // src/index.ts
  writeFileSync(
    join(projectPath, "src", "index.ts"),
    `/**
 * ${options.name} — ${options.description || "An AsiJS plugin"}
 *
 * @example
 * import { Asi } from "asijs";
 * import { ${pluginClassName} } from "${options.name}";
 *
 * const app = new Asi();
 * app.plugin(${pluginClassName}());
 */

import { createPlugin, type AsiPlugin, type Context } from "asijs";

export interface ${pluginClassName}Options {
  /** Greeting message (default: "Hello from ${options.name}!") */
  greeting?: string;
}

export function ${pluginClassName}(options: ${pluginClassName}Options = {}): AsiPlugin {
  const greeting = options.greeting || "Hello from ${options.name}!";

  return createPlugin({
    name: "${options.name}",

    setup(app) {
      // Add middleware
      app.use(async (ctx: Context, next: () => Promise<Response>) => {
        // Hook into request lifecycle
        return next();
      });

      // Add routes
      app.get("/${options.name}", () => ({
        message: greeting,
        version: "0.1.0",
      }));

      // Add health endpoint
      app.get("/${options.name}/health", () => ({
        status: "ok",
        plugin: "${options.name}",
      }));
    },
  });
}
`,
  );

  // package.json
  const pkgName = options.name.startsWith("@")
    ? options.name
    : options.name.startsWith("asijs-")
      ? options.name
      : `asijs-${options.name}`;

  writeFileSync(
    join(projectPath, "package.json"),
    JSON.stringify(
      {
        name: pkgName,
        version: "0.1.0",
        description: options.description || `AsiJS plugin: ${options.name}`,
        type: "module",
        main: "./dist/index.js",
        types: "./dist/index.d.ts",
        scripts: {
          build: "bun build src/index.ts --outdir dist --target bun --external asijs",
          dev: "bun run --hot src/index.ts",
          typecheck: "tsc --noEmit",
          ...(options.withTests ? { test: "bun test" } : {}),
        },
        keywords: ["asijs", "plugin", options.name],
        peerDependencies: {
          asijs: "latest",
        },
        devDependencies: {
          "typescript": "^5",
          "@types/bun": "latest",
        },
        ...(options.author ? { author: options.author } : {}),
      },
      null,
      2,
    ) + "\n",
  );

  // tsconfig.json
  writeFileSync(
    join(projectPath, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ESNext",
          module: "ESNext",
          moduleResolution: "bundler",
          strict: true,
          skipLibCheck: true,
          declaration: true,
          outDir: "./dist",
          rootDir: "./src",
        },
        include: ["src"],
      },
      null,
      2,
    ) + "\n",
  );

  // README.md
  writeFileSync(
    join(projectPath, "README.md"),
    `# ${options.name}

${options.description || `An AsiJS plugin — ${options.name}.`}

## Installation

\`\`\`bash
bun add ${pkgName}
\`\`\`

## Usage

\`\`\`typescript
import { Asi } from "asijs";
import { ${pluginClassName} } from "${pkgName}";

const app = new Asi();
app.plugin(${pluginClassName}({
  greeting: "Custom greeting",
}));

app.listen(3000);
\`\`\`

## API

### \`${pluginClassName}(options?)\`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| \`greeting\` | \`string\` | \`"Hello from ${options.name}!"\` | Custom greeting message |

## Routes

| Path | Method | Description |
|------|--------|-------------|
| \`/${options.name}\` | GET | Returns plugin info |
| \`/${options.name}/health\` | GET | Health check |

${options.withTests ? "## Tests\n\n```bash\nbun test\n```\n" : ""}
## License

MIT
`,
  );

  // .gitignore
  writeFileSync(join(projectPath, ".gitignore"), "node_modules\ndist\n.env\n*.log\n");

  // Optional: test file
  if (options.withTests) {
    writeFileSync(
      join(projectPath, "test", "plugin.test.ts"),
      `import { describe, test, expect } from "bun:test";
import { ${pluginClassName} } from "../src/index";

describe("${pluginClassName}", () => {
  test("plugin has correct name", () => {
    const plugin = ${pluginClassName}();
    expect(plugin.name).toBe("${options.name}");
  });

  test("plugin config has setup function", () => {
    const plugin = ${pluginClassName}();
    expect(plugin.config).toBeDefined();
    expect(typeof plugin.config.setup).toBe("function");
  });
});
`,
    );
  }

  // Optional: example file
  if (options.withExample) {
    writeFileSync(
      join(projectPath, "examples", "basic.ts"),
      `import { Asi } from "asijs";
import { ${pluginClassName} } from "../src/index";

const app = new Asi({ development: true });
app.plugin(${pluginClassName}());

app.listen(3000, () => {
  console.log("🚀 Example running at http://localhost:3000");
});
`,
    );
  }

  return {
    success: true,
    message: `Created plugin "${options.name}" at ${projectPath}`,
    path: projectPath,
  };
}

// ============================================================================
// Helper
// ============================================================================

function toPascalCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
}
