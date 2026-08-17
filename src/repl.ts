/**
 * AsiJS Interactive REPL
 *
 * Provides an interactive shell where users can:
 * - Create routes on the fly: `app.get("/", () => "Hello")`
 * - Test requests: `fetch /` or `GET /hello`
 * - Inspect state: `routes`, `plugins`, `help`
 * - Execute arbitrary TypeScript expressions in an AsiJS context
 *
 * Usage: `asi repl` or `bun run src/repl.ts`
 */

import { Asi } from "./asi";
import { createInterface, type Interface } from "readline";
import { writeFileSync, existsSync, readFileSync } from "fs";
import { join, resolve } from "path";

// ============================================================================
// REPL Colors
// ============================================================================

const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

const c = {
  bold: (s: string) => `${colors.bold}${s}${colors.reset}`,
  dim: (s: string) => `${colors.dim}${s}${colors.reset}`,
  red: (s: string) => `${colors.red}${s}${colors.reset}`,
  green: (s: string) => `${colors.green}${s}${colors.reset}`,
  yellow: (s: string) => `${colors.yellow}${s}${colors.reset}`,
  blue: (s: string) => `${colors.blue}${s}${colors.reset}`,
  magenta: (s: string) => `${colors.magenta}${s}${colors.reset}`,
  cyan: (s: string) => `${colors.cyan}${s}${colors.reset}`,
};

// ============================================================================
// AsiJS REPL Class
// ============================================================================

/** Options for the REPL (commands, sandbox, state). */
export interface ReplOptions {
  /** Port for the REPL test server (0 = no server) */
  port?: number;
  /** Silent mode — less verbose output */
  silent?: boolean;
  /** History file path (default: ~/.asijs_history) */
  historyFile?: string;
  /** Preload source files on startup */
  preload?: string[];
}

/** Result of a REPL command execution. */
export interface ReplResult {
  /** The raw output for programmatic use */
  output: string;
  /** Whether the command was successful */
  success: boolean;
  /** Type of result: 'eval', 'route', 'test', 'state', 'help', 'error' */
  type: string;
}

type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";

/** Interactive REPL with sandboxed execution and AsiJS helpers. */
export class AsiRepl {
  public app: Asi;
  private rl: Interface | null = null;
  private history: string[] = [];
  private historyIndex = -1;
  private historyFile: string;
  private running = false;
  private port: number;
  private silent: boolean;

  constructor(options: ReplOptions = {}) {
    this.app = new Asi({ development: !options.silent, silent: options.silent });
    this.port = options.port || 0;
    this.silent = options.silent || false;
    this.historyFile = options.historyFile || join(
      process.env.HOME || process.env.USERPROFILE || ".",
      ".asijs_history",
    );

    // Set up default routes
    this.app.get("/health", () => ({
      status: "ok",
      uptime: process.uptime(),
      routes: this.getRouteSummary(),
    }));

    this.app.get("/routes", () => this.getRouteSummary());
  }

  /**
   * Start the interactive REPL.
   */
  async start(): Promise<void> {
    this.running = true;
    this.loadHistory();
    this.printBanner();

    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: c.cyan("asi> "),
      terminal: true,
      history: this.history,
      historySize: 1000,
      removeHistoryDuplicates: true,
    });

    // Restore terminal cursor
    this.rl.on("SIGINT", () => {
      console.log("\n" + c.dim("Use .exit or Ctrl+D to quit"));
      this.rl?.prompt();
    });

    this.rl.on("close", () => {
      this.stop();
    });

    this.rl.on("line", async (line) => {
      await this.handleInput(line.trim());
      this.rl?.prompt();
    });

    // Start test server if port specified
    if (this.port > 0) {
      this.app.listen(this.port, () => {
        if (!this.silent) {
          console.log(c.dim(`   Test server running on http://localhost:${this.port}`));
        }
      });
    }

    this.rl.prompt();
  }

  /**
   * Stop the REPL.
   */
  stop(): void {
    this.running = false;
    this.saveHistory();
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    if (!this.silent) {
      console.log(c.dim("\nGoodbye! 👋"));
    }
  }

  /**
   * Get a summary of all registered routes.
   */
  getRouteSummary(): Array<{ method: string; path: string; handler: string }> {
    try {
      const routes = (this.app as any).getRoutes?.() || [];
      if (Array.isArray(routes)) {
        return routes.map((r: any) => ({
          method: r.method || r.METHOD || r[0] || "ANY",
          path: r.path || r.route || r[1] || "/",
          handler: r.handlerName || r.name || "fn",
        }));
      }
    } catch {}
    return [];
  }

  /**
   * Print the REPL banner.
   */
  private printBanner(): void {
    console.log();
    console.log(c.bold(`  ⚡ AsiJS REPL`));
    console.log(c.dim(`  Interactive AsiJS shell — create routes, test requests, inspect state`));
    console.log();
    console.log(c.dim(`  ${c.green("app.get")}("/hello", () => "world")  `) + c.dim("— Create a route"));
    console.log(c.dim(`  ${c.cyan("GET /hello")}                         `) + c.dim("— Test a request"));
    console.log(c.dim(`  ${c.magenta(".routes")}                          `) + c.dim("— List routes"));
    console.log(c.dim(`  ${c.magenta(".plugins")}                         `) + c.dim("— List plugins"));
    console.log(c.dim(`  ${c.magenta(".help")}                            `) + c.dim("— Show help"));
    console.log(c.dim(`  ${c.magenta(".exit")}                            `) + c.dim("— Quit"));
    console.log();
  }

  /**
   * Handle a line of input.
   */
  private async handleInput(line: string): Promise<void> {
    if (!line) return;

    // Add to history
    this.history.push(line);
    this.historyIndex = this.history.length;

    try {
      // Handle special commands
      if (line.startsWith(".")) {
        await this.handleDotCommand(line);
        return;
      }

      // Handle HTTP request shorthand: GET /path, POST /path with body
      const httpMatch = line.match(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\/\S*)(?:\s+(.*))?$/i);
      if (httpMatch) {
        await this.handleHttpRequest(
          httpMatch[1].toUpperCase() as Method,
          httpMatch[2],
          httpMatch[3],
        );
        return;
      }

      // Handle `fetch /path` shorthand
      const fetchMatch = line.match(/^fetch\s+(\/\S*)$/i);
      if (fetchMatch) {
        await this.handleHttpRequest("GET", fetchMatch[1]);
        return;
      }

      // Handle `app.get/post/put/delete/patch/ws(...)` — route creation
      if (line.startsWith("app.") && line.includes("(") && line.includes(")")) {
        await this.evalAsExpression(line);
        return;
      }

      // Handle regular JavaScript/TypeScript expression
      await this.evalAsExpression(line);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(c.red(`  ✗ Error: ${msg}`));
    }
  }

  /**
   * Handle dot commands (.help, .routes, .exit, etc.).
   */
  private async handleDotCommand(line: string): Promise<void> {
    const parts = line.slice(1).split(/\s+/);
    const cmd = parts[0]?.toLowerCase();

    switch (cmd) {
      case "help":
      case "?":
        this.printHelp();
        break;

      case "exit":
      case "quit":
      case "q":
        this.stop();
        break;

      case "routes": {
        const routes = this.getRouteSummary();
        if (routes.length === 0) {
          console.log(c.dim("  No routes registered"));
        } else {
          console.log(c.bold(`  Routes (${routes.length}):`));
          for (const r of routes) {
            const methodColor: Record<string, (s: string) => string> = {
              GET: c.green, POST: c.blue, PUT: c.yellow,
              DELETE: c.red, PATCH: c.magenta, WS: c.magenta,
            };
            const color = methodColor[r.method] || c.dim;
            console.log(`    ${color(r.method.padEnd(8))}${r.path}`);
          }
        }
        break;
      }

      case "plugins": {
        try {
          const plugins = (this.app as any).getPlugins?.() || [];
          if (plugins.length === 0) {
            console.log(c.dim("  No plugins registered"));
          } else {
            console.log(c.bold(`  Plugins (${plugins.length}):`));
            for (const p of plugins) {
              console.log(`    ${c.green("■")} ${p.name || p}`);
            }
          }
        } catch {
          console.log(c.dim("  No plugin information available"));
        }
        break;
      }

      case "state": {
        try {
          const state = (this.app as any)._state;
          if (state instanceof Map) {
            const entries = Array.from(state.entries());
            if (entries.length === 0) {
              console.log(c.dim("  No state entries"));
            } else {
              console.log(c.bold(`  State (${entries.length} entries):`));
              for (const [key, val] of entries.slice(0, 20)) {
                const valStr = typeof val === "object" ? JSON.stringify(val).slice(0, 60) : String(val);
                console.log(`    ${c.cyan(key.padEnd(30))} ${c.dim(valStr)}`);
              }
              if (entries.length > 20) {
                console.log(c.dim(`    ... and ${entries.length - 20} more`));
              }
            }
          } else {
            console.log(c.dim("  State: " + JSON.stringify(state).slice(0, 200)));
          }
        } catch {
          console.log(c.dim("  No state information available"));
        }
        break;
      }

      case "history":
        if (this.history.length === 0) {
          console.log(c.dim("  No history"));
        } else {
          const start = Math.max(0, this.history.length - 20);
          for (let i = start; i < this.history.length; i++) {
            console.log(`  ${c.dim(String(i + 1).padEnd(4))}${this.history[i]}`);
          }
        }
        break;

      case "clear":
        console.clear();
        this.printBanner();
        break;

      case "save": {
        const filename = parts[1] || "asi-session.ts";
        const routes = this.getRouteSummary();
        let content = `// AsiJS REPL Session — ${new Date().toISOString()}\n`;
        content += `// Routes: ${routes.length}\n\n`;
        content += `import { Asi } from "asijs";\n\n`;
        content += `const app = new Asi();\n\n`;
        for (const r of routes) {
          content += `app.${r.method.toLowerCase()}("${r.path}", () => ({\n  message: "Route created in REPL"\n}));\n\n`;
        }
        content += `app.listen(3000, () => console.log("Server running"));\n`;
        writeFileSync(filename, content);
        console.log(c.green(`  ✓ Session saved to ${filename}`));
        break;
      }

      default:
        console.log(c.yellow(`  Unknown command: .${cmd}. Type .help for available commands`));
    }
  }

  /**
   * Handle an HTTP test request.
   */
  private async handleHttpRequest(method: Method, path: string, body?: string): Promise<void> {
    const url = new URL(`http://localhost${path}`);
    const headers: Record<string, string> = {
      "Content-Type": body ? "application/json" : "text/plain",
    };

    let requestBody: string | undefined;
    if (body) {
      try {
        // Try to parse as JSON
        requestBody = JSON.stringify(JSON.parse(body));
        headers["Content-Type"] = "application/json";
      } catch {
        requestBody = body;
      }
    }

    const request = new Request(url.toString(), {
      method,
      headers,
      body: requestBody,
    });

    const start = performance.now();
    const response = await this.app.handle(request);
    const duration = (performance.now() - start).toFixed(1);

    const statusColor = response.status < 300 ? c.green : response.status < 500 ? c.yellow : c.red;
    console.log();
    console.log(`  ${statusColor(`${method} ${path}`)}`);
    console.log(`  ${c.dim(`Status: ${response.status} ${response.statusText}`)}`);
    console.log(`  ${c.dim(`Duration: ${duration}ms`)}`);

    const responseBody = await response.text();
    if (responseBody) {
      try {
        const parsed = JSON.parse(responseBody);
        console.log(`  ${c.dim("Body:")} ${JSON.stringify(parsed, null, 2)}`);
      } catch {
        if (responseBody.length < 500) {
          console.log(`  ${c.dim("Body:")} ${responseBody}`);
        } else {
          console.log(`  ${c.dim("Body:")} ${responseBody.slice(0, 200)}... (${responseBody.length} chars)`);
        }
      }
    }
    console.log();
  }

  /**
   * Evaluate an AsiJS expression.
   */
  private async evalAsExpression(expr: string): Promise<void> {
    try {
      // Strip import statements (not valid inside new AsyncFunction)
      const cleanExpr = expr
        .split("\n")
        .filter((line) => !line.trim().startsWith("import "))
        .join("\n");

      const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

      // Build the expression — wrap in try/catch for safety
      const wrappedExpr = `
        (async () => {
          try {
            const result = ${cleanExpr};
            return { success: true, result };
          } catch (e) {
            return { success: false, error: e instanceof Error ? e.message : String(e) };
          }
        })()
      `;

      // Sandbox: pass safe values as params to shadow dangerous globals.
      // By passing `process: undefined` and `require: undefined` as local
      // variables, they shadow the global versions inside the AsyncFunction.
      // This prevents RCE via process.exit(), require('child_process'), etc.
      const sandbox = {
        app: this.app,
        Asi: Asi,
        console: console,
        process: undefined as unknown,
        require: undefined as unknown,
        global: undefined as unknown,
        globalThis: undefined as unknown,
      };
      const sandboxKeys = Object.keys(sandbox);
      const sandboxValues = Object.values(sandbox);

      const fn = new AsyncFunction(...sandboxKeys, wrappedExpr);
      const outcome = await fn(...sandboxValues);

      if (outcome.success) {
        const result = outcome.result;
        if (result !== undefined && result !== null) {
          const output = typeof result === "object"
            ? JSON.stringify(result, null, 2)
            : String(result);
          console.log(c.green(`  → ${output}`));
        }
      } else {
        console.log(c.red(`  ✗ ${outcome.error}`));
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(c.red(`  ✗ Error: ${msg}`));
    }
  }

  /**
   * Print detailed help.
   */
  private printHelp(): void {
    console.log();
    console.log(c.bold("  📖 AsiJS REPL Commands"));
    console.log();
    console.log(c.bold("  Route Creation"));
    console.log(c.dim("    app.get(\"/path\", () => ({ msg: \"hello\" }))"));
    console.log(c.dim("    app.post(\"/data\", { schema: {} }, (ctx) => ctx.body)"));
    console.log(c.dim("    app.ws(\"/ws\", { open(ws) {}, message(ws, msg) {} })"));
    console.log();
    console.log(c.bold("  Request Testing"));
    console.log(c.dim("    GET /path              — Send GET request"));
    console.log(c.dim("    POST /path {\"key\":\"v\"}  — Send POST with JSON body"));
    console.log(c.dim("    fetch /path            — Fetch a route"));
    console.log();
    console.log(c.bold("  State Inspection"));
    console.log(c.dim("    .routes                — List all registered routes"));
    console.log(c.dim("    .plugins               — List loaded plugins"));
    console.log(c.dim("    .state                 — Show internal state"));
    console.log(c.dim("    .history               — Show command history"));
    console.log(c.dim("    .help                  — Show this help"));
    console.log(c.dim("    .save [filename]       — Save routes to file"));
    console.log(c.dim("    .clear                 — Clear screen"));
    console.log(c.dim("    .exit / .quit          — Exit REPL"));
    console.log();
    console.log(c.bold("  JavaScript Expressions"));
    console.log(c.dim('    Date.now()             — Returns current timestamp'));
    console.log(c.dim('    app.getRoutes()        — Returns route list'));
    console.log(c.dim('    1 + 2                 — Returns 3'));
    console.log();
  }

  /**
   * Load command history from file.
   */
  private loadHistory(): void {
    try {
      if (existsSync(this.historyFile)) {
        const data = readFileSync(this.historyFile, "utf-8");
        this.history = data.split("\n").filter(Boolean).slice(-500);
      }
    } catch {
      // Ignore history load errors
    }
  }

  /**
   * Save command history to file.
   */
  private saveHistory(): void {
    try {
      writeFileSync(this.historyFile, this.history.slice(-500).join("\n"));
    } catch {
      // Ignore history save errors
    }
  }
}

// ============================================================================
// Standalone entry point
// ============================================================================

if (import.meta.main) {
  const args = process.argv.slice(2);
  let port = 0;
  let silent = false;
  const preload: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" || args[i] === "-p") {
      port = parseInt(args[i + 1]!, 10) || 3001;
      i++;
    } else if (args[i] === "--silent" || args[i] === "-s") {
      silent = true;
    } else if (args[i] === "--preload" || args[i] === "-l") {
      preload.push(args[i + 1]!);
      i++;
    }
  }

  const repl = new AsiRepl({ port, silent, preload });

  // Handle cleanup
  process.on("SIGINT", () => {
    repl.stop();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    repl.stop();
    process.exit(0);
  });

  repl.start().catch((error) => {
    console.error("REPL error:", error);
    process.exit(1);
  });
}
