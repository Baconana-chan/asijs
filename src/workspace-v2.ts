/**
 * Workspace — Production Multi-App Server
 *
 * Runs multiple AsiJS apps on a single `Bun.serve()` with:
 * - Host-based routing (Host header -> app)
 * - Prefix-based routing (/api/* -> app)
 * - Unified dev dashboard at /__asi/workspace
 * - Unified OpenAPI docs at /__asi/docs
 *
 * @example
 * ```ts
 * import { Workspace, Asi } from "asijs";
 *
 * const ws = new Workspace();
 *
 * ws.app("api", { development: true }, (app) => {
 *   app.get("/users", () => ["Alice", "Bob"]);
 * });
 *
 * ws.app("web", { development: true }, (app) => {
 *   app.get("/", () => "Hello from Web!");
 * });
 *
 * ws.listen(3000);
 * ```
 */

import { Asi, type AsiConfig } from "./asi";
import { renderToString, jsx, type JSXElement } from "./jsx";

// ===== Types =====

export interface WorkspaceAppConfig {
  name: string;
  config?: AsiConfig;
  hostname?: string;
  prefix?: string;
  setup: (app: Asi) => void;
}

export interface WorkspaceOptions {
  port?: number;
  hostname?: string;
  dashboard?: boolean;
  dashboardPath?: string;
  openapi?: boolean;
  openapiPath?: string;
  onError?: (error: unknown, request: Request) => Response | Promise<Response>;
  verbose?: boolean;
}

interface RegisteredApp {
  name: string;
  hostname?: string;
  prefix?: string;
  app: Asi;
}

// ===== CSS =====

const DASHBOARD_CSS = [
  "* { box-sizing: border-box; margin: 0; padding: 0; }",
  "body {",
  "  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;",
  "  background: #0d1117;",
  "  color: #c9d1d9;",
  "  line-height: 1.5;",
  "}",
  ".container { max-width: 1200px; margin: 0 auto; padding: 20px; }",
  "header {",
  "  background: linear-gradient(135deg, #1f6feb 0%, #8957e5 100%);",
  "  padding: 30px 20px; margin-bottom: 30px; border-radius: 8px;",
  "}",
  "h1 { font-size: 2rem; color: white; }",
  "h2 {",
  "  font-size: 1.25rem; color: #58a6ff;",
  "  margin-bottom: 15px; padding-bottom: 10px;",
  "  border-bottom: 1px solid #30363d;",
  "}",
  ".card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; margin-bottom: 20px; }",
  "table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }",
  "th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #30363d; }",
  "th { color: #8b949e; font-weight: 500; }",
  "tr:hover { background: #1c2128; }",
  ".method { font-weight: bold; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; }",
  ".GET { background: #238636; color: white; }",
  ".POST { background: #1f6feb; color: white; }",
  ".PUT { background: #9e6a03; color: white; }",
  ".PATCH { background: #8957e5; color: white; }",
  ".DELETE { background: #da3633; color: white; }",
  "code { background: #0d1117; padding: 2px 6px; border-radius: 4px; font-family: 'SF Mono', Consolas, monospace; font-size: 0.8rem; }",
  ".stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 15px; margin-bottom: 20px; }",
  ".stat { background: #21262d; padding: 15px; border-radius: 8px; text-align: center; }",
  ".stat-value { font-size: 1.8rem; font-weight: bold; color: #58a6ff; }",
  ".stat-label { color: #8b949e; font-size: 0.85rem; }",
  ".app-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600; margin-right: 4px; }",
  ".tag-host { background: #1f6feb33; color: #58a6ff; }",
  ".tag-prefix { background: #9e6a0333; color: #d29922; }",
  ".empty { color: #8b949e; text-align: center; padding: 40px; }",
].join("\n");

// ===== Dashboard =====

function buildDashboard(apps: RegisteredApp[]): JSXElement {
  const totalRoutes = apps.reduce((s, a) => s + a.app.getRoutes().length, 0);
  const totalPlugins = apps.reduce((s, a) => s + a.app.getPlugins().length, 0);

  const routeRows: Array<{
    name: string;
    method: string;
    path: string;
    valid: string;
    mw: string;
  }> = [];

  for (const ra of apps) {
    for (const r of ra.app.getRoutes()) {
      routeRows.push({
        name: ra.name,
        method: r.method,
        path: r.path,
        valid: r.hasValidation ? "\u2713" : "\u2014",
        mw: r.hasMiddleware ? "\u2713" : "\u2014",
      });
    }
  }

  const body: JSXElement[] = [
    jsx("header", {
      children: jsx("h1", { children: "\uD83D\uDE80 AsiJS Workspace Dashboard" }),
    }),
    jsx("div", {
      className: "stats",
      children: [
        buildStat(String(apps.length), "Apps"),
        buildStat(String(totalRoutes), "Routes"),
        buildStat(String(totalPlugins), "Plugins"),
        buildStat(String(apps.filter((a) => !!a.hostname).length), "Host-based"),
        buildStat(String(apps.filter((a) => !!a.prefix).length), "Prefix-based"),
      ],
    }),
    jsx("div", {
      className: "card",
      children: [
        jsx("h2", { children: "\uD83D\uDCE6 Sub-Apps" }),
        ...apps.map((ra) => buildAppCard(ra)),
      ],
    }),
    jsx("div", {
      className: "card",
      children: [
        jsx("h2", { children: "\uD83D\uDCCD All Routes" }),
        routeRows.length > 0
          ? buildRouteTable(routeRows)
          : jsx("p", { className: "empty", children: "No routes registered" }),
      ],
    }),
  ];

  return jsx("html", {
    children: [
      jsx("head", {
        children: [
          jsx("title", { children: "AsiJS Workspace Dashboard" }),
          jsx("meta", { charset: "utf-8" }),
          jsx("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
          jsx("style", { children: DASHBOARD_CSS }),
        ],
      }),
      jsx("body", {
        children: jsx("div", { className: "container", children: body }),
      }),
    ],
  });
}

function buildStat(value: string, label: string): JSXElement {
  return jsx("div", {
    className: "stat",
    children: [
      jsx("div", { className: "stat-value", children: value }),
      jsx("div", { className: "stat-label", children: label }),
    ],
  });
}

function buildAppCard(ra: RegisteredApp): JSXElement {
  const info: JSXElement[] = [];

  info.push(
    jsx("div", {
      style: "display:flex;justify-content:space-between;align-items:center",
      children: [
        jsx("strong", { style: "color:#58a6ff;font-size:1rem", children: ra.name }),
        jsx("span", {
          style: "color:#8b949e;font-size:0.8rem",
          children: ra.app.getRoutes().length + " routes \u00B7 " + ra.app.getPlugins().length + " plugins",
        }),
      ],
    }),
  );

  if (ra.hostname) {
    info.push(
      jsx("div", { style: "margin-top:6px", children:
        jsx("span", { className: "app-badge tag-host", children: "Host: " + ra.hostname }),
      }),
    );
  }

  if (ra.prefix) {
    info.push(
      jsx("div", { style: "margin-top:4px", children:
        jsx("span", { className: "app-badge tag-prefix", children: "Prefix: " + ra.prefix }),
      }),
    );
  }

  return jsx("div", { style: "padding:12px;margin:8px 0;background:#21262d;border-radius:6px", children: info });
}

function buildRouteTable(rows: Array<{ name: string; method: string; path: string; valid: string; mw: string }>): JSXElement {
  return jsx("table", {
    children: [
      jsx("thead", {
        children: jsx("tr", {
          children: [
            jsx("th", { children: "App" }),
            jsx("th", { children: "Route" }),
            jsx("th", { children: "Val" }),
            jsx("th", { children: "Mw" }),
          ],
        }),
      }),
      jsx("tbody", {
        children: rows.map((r, i) =>
          jsx("tr", {
            children: [
              jsx("td", { children: jsx("code", { children: r.name }) }),
              jsx("td", {
                children: [
                  jsx("span", { className: "method " + r.method, children: r.method }),
                  " ",
                  jsx("code", { children: r.path }),
                ],
              }),
              jsx("td", { children: r.valid }),
              jsx("td", { children: r.mw }),
            ],
          }),
        ),
      }),
    ],
  });
}

// ===== OpenAPI =====

function buildOpenAPISpec(apps: RegisteredApp[]): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  const tags: Array<{ name: string }> = [];

  for (const ra of apps) {
    const prefix = ra.prefix || "";
    tags.push({ name: ra.name });

    for (const route of ra.app.getRoutes()) {
      const fullPath = prefix + route.path;
      const openPath = fullPath.replace(/:([^/]+)/g, "{$1}");
      const method = route.method.toLowerCase();

      if (!paths[openPath]) {
        paths[openPath] = {};
      }

      paths[openPath][method] = {
        operationId: ra.name + "_" + route.method + "_" + route.path.replace(/[^a-zA-Z0-9]/g, "_"),
        summary: route.method + " " + route.path,
        tags: [ra.name],
        responses: {
          "200": { description: "Successful response" },
          "400": { description: "Bad Request" },
          "500": { description: "Internal Server Error" },
        },
      };
    }
  }

  return {
    openapi: "3.0.3",
    info: {
      title: "Workspace API",
      version: "1.0.0",
      description: apps.length + " sub-app(s)",
    },
    tags,
    paths,
  };
}

function buildSwaggerHTML(jsonUrl: string, title: string): string {
  var lines = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<title>' + title + ' - Workspace API Docs</title>',
    '<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">',
    '<style>html{box-sizing:border-box;overflow-y:scroll}*,*:before,*:after{box-sizing:inherit}body{margin:0;background:#fafafa}.swagger-ui .topbar{display:none}</style>',
    '</head>',
    '<body>',
    '<div id="swagger-ui"></div>',
    '<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>',
    '<script>',
    'window.onload=function(){',
    "SwaggerUIBundle({",
    "url:'" + jsonUrl + "',",
    "dom_id:'#swagger-ui',",
    "deepLinking:true,",
    "presets:[SwaggerUIBundle.presets.apis,SwaggerUIBundle.SwaggerUIStandalonePreset],",
    "layout:'StandaloneLayout'",
    "})",
    "};",
    '</script>',
    '</body>',
    '</html>',
  ];
  return lines.join("\n");
}

// ===== Workspace Class =====

export class Workspace {
  private apps: RegisteredApp[] = [];
  private options: Required<WorkspaceOptions>;
  private server: any = null;

  constructor(options: WorkspaceOptions = {}) {
    this.options = {
      port: options.port ?? 3000,
      hostname: options.hostname ?? "0.0.0.0",
      dashboard: options.dashboard ?? true,
      dashboardPath: options.dashboardPath ?? "/__asi/workspace",
      openapi: options.openapi ?? true,
      openapiPath: options.openapiPath ?? "/__asi/docs",
      onError: options.onError ?? (() => new Response("Workspace Error", { status: 500 })),
      verbose: options.verbose ?? true,
    };
  }

  app(name: string, config: AsiConfig, setup: (app: Asi) => void): this {
    var asiApp = new Asi(config);
    setup(asiApp);
    this.apps.push({ name: name, app: asiApp });
    return this;
  }

  appWith(config: WorkspaceAppConfig): this {
    var asiApp = new Asi(config.config);
    config.setup(asiApp);
    this.apps.push({
      name: config.name,
      hostname: config.hostname,
      prefix: config.prefix,
      app: asiApp,
    });
    return this;
  }

  listen(portArg?: number, callback?: () => void): any {
    var port = portArg ?? this.options.port;
    var opts = this.options;

    for (var ra of this.apps) {
      ra.app.compile();
    }

    if (opts.verbose) {
      this.printBanner(port);
    }

    this.server = Bun.serve({
      port: port,
      hostname: opts.hostname,
      fetch: (request: Request) => this.handleRequest(request),
    });

    callback?.();
    return this.server;
  }

  private async handleRequest(request: Request): Promise<Response> {
    var url = new URL(request.url);
    var host = request.headers.get("host") || "";
    var path = url.pathname;
    var opts = this.options;

    // 1. Internal routes
    if (opts.dashboard || opts.openapi) {
      var internalResp = await this.tryInternal(path, request);
      if (internalResp) return internalResp;
    }

    // Helper: safely call app.handle with error fallback
    var safeHandle = async function(app: Asi, req: Request): Promise<Response> {
      try {
        return await app.handle(req);
      } catch (err) {
        return opts.onError(err, req);
      }
    };

    // 2. Match by hostname
    for (var ra of this.apps) {
      if (ra.hostname && (host === ra.hostname || host.startsWith(ra.hostname + ":"))) {
        return safeHandle(ra.app, request);
      }
    }

    // 3. Match by prefix
    for (var ra of this.apps) {
      if (ra.prefix && (path === ra.prefix || path.startsWith(ra.prefix + "/"))) {
        return safeHandle(ra.app, request);
      }
    }

    // 4. Default app (first without hostname/prefix)
    var defaultApp = this.apps.find(function(a) { return !a.hostname && !a.prefix; });
    if (defaultApp) return safeHandle(defaultApp.app, request);

    // 5. Error
    return opts.onError(
      new Error('No app for host="' + host + '" path="' + path + '"'),
      request,
    );
  }

  private async tryInternal(path: string, request: Request): Promise<Response | null> {
    var opts = this.options;

    // Dashboard HTML
    if (opts.dashboard && path === opts.dashboardPath) {
      var html = await renderToString(buildDashboard(this.apps));
      return new Response("<!DOCTYPE html>" + html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // OpenAPI JSON spec
    if (opts.openapi && (path === opts.openapiPath + ".json" || path === opts.openapiPath + "/openapi.json")) {
      var doc = buildOpenAPISpec(this.apps);
      return new Response(JSON.stringify(doc, null, 2), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // OpenAPI Swagger UI
    if (opts.openapi && path === opts.openapiPath) {
      var jsonUrl = new URL(opts.openapiPath + "/openapi.json", request.url).href;
      return new Response(buildSwaggerHTML(jsonUrl, "Workspace API"), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return null;
  }

  stop(): void {
    if (this.server) {
      this.server.stop();
      this.server = null;
    }
  }

  private printBanner(port: number): void {
    var opts = this.options;
    var total = this.apps.reduce(function(s, a) { return s + a.app.getRoutes().length; }, 0);

    console.log("");
    console.log("  \uD83C\uDFD7\uFE0F  Workspace \u2014 " + this.apps.length + " app(s), " + total + " routes");
    for (var ra of this.apps) {
      var routes = ra.app.getRoutes().length;
      var plugins = ra.app.getPlugins().length;
      var route = ra.hostname
        ? "host=" + ra.hostname
        : ra.prefix
          ? "prefix=" + ra.prefix
          : "port=" + port;
      console.log("     " + ra.name.padEnd(16) + " " + routes + "r " + plugins + "p  " + route);
    }
    if (opts.dashboard) {
      console.log("     " + "Dashboard".padEnd(16) + " http://localhost:" + port + opts.dashboardPath);
    }
    if (opts.openapi) {
      console.log("     " + "OpenAPI".padEnd(16) + " http://localhost:" + port + opts.openapiPath);
    }
    console.log("");
  }
}

export function createWorkspace(options?: WorkspaceOptions): Workspace {
  return new Workspace(options);
}
