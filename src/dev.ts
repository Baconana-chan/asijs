/**
 * Dev Mode Plugin for AsiJS
 * 
 * Development utilities including hot-reload, dev dashboard,
 * request inspector, and debug helpers.
 * 
 * @example
 * ```ts
 * import { Asi, devMode } from "asijs";
 * 
 * const app = new Asi();
 * 
 * if (process.env.NODE_ENV !== "production") {
 *   app.plugin(devMode({
 *     dashboard: true,      // Enable /__dev dashboard
 *     inspector: true,      // Enable request inspector
 *     timing: true,         // Show timing info
 *   }));
 * }
 * ```
 */

import { createPlugin, type AsiPlugin } from "./plugin";
import type { Context } from "./context";
import type { Middleware } from "./types";
import { jsx, renderToString, Fragment, type JSXElement } from "./jsx";

// ===== Types =====

export interface DevModeOptions {
  /**
   * Enable dev dashboard at /__dev
   * @default true
   */
  dashboard?: boolean;
  
  /**
   * Dashboard path
   * @default "/__dev"
   */
  dashboardPath?: string;
  
  /**
   * Enable request inspector (stores recent requests)
   * @default true
   */
  inspector?: boolean;
  
  /**
   * Max requests to keep in inspector
   * @default 100
   */
  maxInspectorRequests?: number;
  
  /**
   * Enable route list at /__dev/routes
   * @default true
   */
  routeList?: boolean;
  
  /**
   * Enable state viewer at /__dev/state
   * @default true
   */
  stateViewer?: boolean;
  
  /**
   * Enable live reload via WebSocket
   * @default false
   */
  liveReload?: boolean;
  
  /**
   * Live reload WebSocket port
   * @default 35729
   */
  liveReloadPort?: number;
  
  /**
   * Show banner on startup
   * @default true
   */
  banner?: boolean;
}

// ===== Request Inspector =====

export interface InspectedRequest {
  id: string;
  timestamp: Date;
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body?: unknown;
  status: number;
  duration: number;
  responseHeaders: Record<string, string>;
  error?: string;
}

class RequestInspector {
  private requests: InspectedRequest[] = [];
  private maxRequests: number;
  
  constructor(maxRequests = 100) {
    this.maxRequests = maxRequests;
  }
  
  add(request: InspectedRequest): void {
    this.requests.unshift(request);
    if (this.requests.length > this.maxRequests) {
      this.requests.pop();
    }
  }
  
  getAll(): InspectedRequest[] {
    return [...this.requests];
  }
  
  get(id: string): InspectedRequest | undefined {
    return this.requests.find(r => r.id === id);
  }
  
  clear(): void {
    this.requests = [];
  }
  
  get count(): number {
    return this.requests.length;
  }
}

// ===== Dev Dashboard HTML =====

function generateDashboardHTML(
  routes: Array<{ method: string; path: string }>,
  state: Record<string, unknown>,
  requests: InspectedRequest[],
  options: { port?: number }
): JSXElement {
  return jsx("html", {
    children: [
      jsx("head", {
        children: [
          jsx("title", { children: "AsiJS Dev Dashboard" }),
          jsx("meta", { charset: "utf-8" }),
          jsx("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
          jsx("style", {
            children: `
              * { box-sizing: border-box; margin: 0; padding: 0; }
              body { 
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                background: #0d1117;
                color: #c9d1d9;
                line-height: 1.5;
              }
              .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
              header { 
                background: linear-gradient(135deg, #238636 0%, #1f6feb 100%);
                padding: 30px 20px;
                margin-bottom: 30px;
                border-radius: 8px;
              }
              h1 { font-size: 2rem; color: white; }
              h2 { 
                font-size: 1.25rem; 
                color: #58a6ff; 
                margin-bottom: 15px;
                padding-bottom: 10px;
                border-bottom: 1px solid #30363d;
              }
              .card {
                background: #161b22;
                border: 1px solid #30363d;
                border-radius: 8px;
                padding: 20px;
                margin-bottom: 20px;
              }
              table { width: 100%; border-collapse: collapse; }
              th, td { 
                text-align: left; 
                padding: 10px 12px;
                border-bottom: 1px solid #30363d;
              }
              th { color: #8b949e; font-weight: 500; }
              tr:hover { background: #1c2128; }
              .method { 
                font-weight: bold; 
                padding: 2px 8px; 
                border-radius: 4px;
                font-size: 0.75rem;
              }
              .GET { background: #238636; color: white; }
              .POST { background: #1f6feb; color: white; }
              .PUT { background: #9e6a03; color: white; }
              .PATCH { background: #8957e5; color: white; }
              .DELETE { background: #da3633; color: white; }
              .status { font-weight: bold; }
              .status-2xx { color: #3fb950; }
              .status-3xx { color: #58a6ff; }
              .status-4xx { color: #d29922; }
              .status-5xx { color: #f85149; }
              .duration { color: #8b949e; font-size: 0.875rem; }
              code { 
                background: #0d1117;
                padding: 2px 6px;
                border-radius: 4px;
                font-family: "SF Mono", Consolas, monospace;
                font-size: 0.875rem;
              }
              .tabs { display: flex; gap: 10px; margin-bottom: 20px; }
              .tab {
                padding: 8px 16px;
                background: #21262d;
                border: 1px solid #30363d;
                border-radius: 6px;
                color: #c9d1d9;
                cursor: pointer;
                text-decoration: none;
              }
              .tab:hover, .tab.active { 
                background: #30363d; 
                border-color: #8b949e;
              }
              pre { 
                background: #0d1117;
                padding: 15px;
                border-radius: 6px;
                overflow-x: auto;
                font-size: 0.875rem;
              }
              .stats { 
                display: grid; 
                grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
                gap: 15px;
                margin-bottom: 20px;
              }
              .stat {
                background: #21262d;
                padding: 15px;
                border-radius: 8px;
                text-align: center;
              }
              .stat-value { font-size: 2rem; font-weight: bold; color: #58a6ff; }
              .stat-label { color: #8b949e; font-size: 0.875rem; }
              .empty { color: #8b949e; text-align: center; padding: 40px; }
            `
          }),
        ]
      }),
      jsx("body", {
        children: [
          jsx("div", {
            className: "container",
            children: [
              jsx("header", {
                children: jsx("h1", { children: "🚀 AsiJS Dev Dashboard" })
              }),
              
              // Stats
              jsx("div", {
                className: "stats",
                children: [
                  jsx("div", {
                    className: "stat",
                    children: [
                      jsx("div", { className: "stat-value", children: String(routes.length) }),
                      jsx("div", { className: "stat-label", children: "Routes" }),
                    ]
                  }),
                  jsx("div", {
                    className: "stat",
                    children: [
                      jsx("div", { className: "stat-value", children: String(requests.length) }),
                      jsx("div", { className: "stat-label", children: "Recent Requests" }),
                    ]
                  }),
                  jsx("div", {
                    className: "stat",
                    children: [
                      jsx("div", { className: "stat-value", children: String(Object.keys(state).length) }),
                      jsx("div", { className: "stat-label", children: "State Keys" }),
                    ]
                  }),
                ]
              }),
              
              // Routes
              jsx("div", {
                className: "card",
                children: [
                  jsx("h2", { children: "📍 Routes" }),
                  routes.length > 0
                    ? jsx("table", {
                        children: [
                          jsx("thead", {
                            children: jsx("tr", {
                              children: [
                                jsx("th", { children: "Method" }),
                                jsx("th", { children: "Path" }),
                              ]
                            })
                          }),
                          jsx("tbody", {
                            children: routes.map((route, i) =>
                              jsx("tr", {
                                key: String(i),
                                children: [
                                  jsx("td", {
                                    children: jsx("span", {
                                      className: `method ${route.method}`,
                                      children: route.method
                                    })
                                  }),
                                  jsx("td", { children: jsx("code", { children: route.path }) }),
                                ]
                              })
                            )
                          })
                        ]
                      })
                    : jsx("p", { className: "empty", children: "No routes registered" })
                ]
              }),
              
              // Recent Requests
              jsx("div", {
                className: "card",
                children: [
                  jsx("h2", { children: "📝 Recent Requests" }),
                  requests.length > 0
                    ? jsx("table", {
                        children: [
                          jsx("thead", {
                            children: jsx("tr", {
                              children: [
                                jsx("th", { children: "Time" }),
                                jsx("th", { children: "Method" }),
                                jsx("th", { children: "Path" }),
                                jsx("th", { children: "Status" }),
                                jsx("th", { children: "Duration" }),
                              ]
                            })
                          }),
                          jsx("tbody", {
                            children: requests.slice(0, 20).map((req, i) => {
                              const statusClass = `status-${Math.floor(req.status / 100)}xx`;
                              return jsx("tr", {
                                key: String(i),
                                children: [
                                  jsx("td", { 
                                    children: jsx("code", { 
                                      children: req.timestamp.toLocaleTimeString() 
                                    }) 
                                  }),
                                  jsx("td", {
                                    children: jsx("span", {
                                      className: `method ${req.method}`,
                                      children: req.method
                                    })
                                  }),
                                  jsx("td", { children: jsx("code", { children: req.path }) }),
                                  jsx("td", {
                                    children: jsx("span", {
                                      className: `status ${statusClass}`,
                                      children: String(req.status)
                                    })
                                  }),
                                  jsx("td", {
                                    className: "duration",
                                    children: `${req.duration.toFixed(2)}ms`
                                  }),
                                ]
                              });
                            })
                          })
                        ]
                      })
                    : jsx("p", { className: "empty", children: "No requests yet" })
                ]
              }),
              
              // State
              jsx("div", {
                className: "card",
                children: [
                  jsx("h2", { children: "🗄️ App State" }),
                  Object.keys(state).length > 0
                    ? jsx("pre", {
                        children: JSON.stringify(state, replacer, 2)
                      })
                    : jsx("p", { className: "empty", children: "No state" })
                ]
              }),
            ]
          })
        ]
      })
    ]
  });
}

// JSON replacer for circular refs and special types
function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) {
    return Object.fromEntries(value);
  }
  if (value instanceof Set) {
    return Array.from(value);
  }
  if (typeof value === "function") {
    return `[Function: ${value.name || "anonymous"}]`;
  }
  return value;
}

// ===== Dev Middleware =====

function devMiddleware(
  inspector: RequestInspector,
  options: DevModeOptions
): Middleware {
  return async (ctx, next) => {
    const startTime = performance.now();
    const requestId = Math.random().toString(36).substring(2, 10);
    
    // Capture request info
    const requestInfo: Partial<InspectedRequest> = {
      id: requestId,
      timestamp: new Date(),
      method: ctx.method,
      path: ctx.path,
      query: ctx.query as Record<string, string>,
      headers: {},
    };
    
    // Capture headers
    ctx.request.headers.forEach((value, key) => {
      requestInfo.headers![key] = value;
    });
    
    let response: Response | unknown;
    let status = 500;
    
    try {
      response = await next();
      
      if (response instanceof Response) {
        status = response.status;
        
        // Capture response headers
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });
        requestInfo.responseHeaders = responseHeaders;
      }
    } catch (error) {
      requestInfo.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      const duration = performance.now() - startTime;
      
      // Store in inspector
      inspector.add({
        ...requestInfo,
        status,
        duration,
        responseHeaders: requestInfo.responseHeaders ?? {},
      } as InspectedRequest);
    }
    
    return response;
  };
}

// ===== Dev Mode Plugin =====

/**
 * Create dev mode plugin
 */
export function devMode(options: DevModeOptions = {}): AsiPlugin {
  const {
    dashboard = true,
    dashboardPath = "/__dev",
    inspector: enableInspector = true,
    maxInspectorRequests = 100,
    routeList = true,
    stateViewer = true,
    banner = true,
  } = options;
  
  const inspector = new RequestInspector(maxInspectorRequests);
  
  return createPlugin({
    name: "dev-mode",
    
    setup(app) {
      if (banner) {
        console.log("\n🔧 \x1b[33mDev Mode Enabled\x1b[0m");
        console.log(`   Dashboard: http://localhost:${(app as any).config?.port ?? 3000}${dashboardPath}`);
        console.log("");
      }
      
      // Dashboard route
      if (dashboard) {
        app.get(dashboardPath, async (ctx) => {
          // Collect route info
          const routes: Array<{ method: string; path: string }> = [];
          const routeMetadata = (app as any).routeMetadata ?? [];
          
          for (const route of routeMetadata) {
            routes.push({
              method: route.method.toUpperCase(),
              path: route.path,
            });
          }
          
          // Collect state
          const state: Record<string, unknown> = {};
          const stateMap = (app as any)._state as Map<string, unknown>;
          if (stateMap) {
            for (const [key, value] of stateMap) {
              state[key] = value;
            }
          }
          
          // Generate HTML
          const html = await renderToString(
            generateDashboardHTML(routes, state, inspector.getAll(), {
              port: (app as any).config?.port,
            })
          );
          
          return new Response("<!DOCTYPE html>" + html, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        });
      }
      
      // Routes API
      if (routeList) {
        app.get(`${dashboardPath}/routes`, () => {
          const routes: Array<{ method: string; path: string }> = [];
          const routeMetadata = (app as any).routeMetadata ?? [];
          
          for (const route of routeMetadata) {
            routes.push({
              method: route.method.toUpperCase(),
              path: route.path,
            });
          }
          
          return routes;
        });
      }
      
      // State API
      if (stateViewer) {
        app.get(`${dashboardPath}/state`, () => {
          const state: Record<string, unknown> = {};
          const stateMap = (app as any)._state as Map<string, unknown>;
          if (stateMap) {
            for (const [key, value] of stateMap) {
              if (typeof value !== "function") {
                state[key] = value;
              }
            }
          }
          return state;
        });
      }
      
      // Request inspector API
      if (enableInspector) {
        app.get(`${dashboardPath}/requests`, () => {
          return inspector.getAll();
        });
        
        app.get(`${dashboardPath}/requests/:id`, (ctx) => {
          const request = inspector.get(ctx.params.id);
          if (!request) {
            ctx.setStatus(404);
            return { error: "Request not found" };
          }
          return request;
        });
        
        app.delete(`${dashboardPath}/requests`, () => {
          inspector.clear();
          return { cleared: true };
        });
      }
    },
    
    middleware: enableInspector ? [devMiddleware(inspector, options)] : [],
    
    decorate: {
      devInspector: inspector,
    },
  });
}

// ===== Debug Helpers =====

/**
 * Log middleware for debugging
 */
export function debugLog(prefix = "DEBUG"): Middleware {
  return async (ctx, next) => {
    const start = performance.now();
    console.log(`[${prefix}] → ${ctx.method} ${ctx.path}`);
    
    try {
      const response = await next();
      const duration = (performance.now() - start).toFixed(2);
      
      if (response instanceof Response) {
        console.log(`[${prefix}] ← ${response.status} (${duration}ms)`);
      } else {
        console.log(`[${prefix}] ← OK (${duration}ms)`);
      }
      
      return response;
    } catch (error) {
      console.log(`[${prefix}] ← ERROR: ${error}`);
      throw error;
    }
  };
}

/**
 * Request body logger
 */
export function logBody(): Middleware {
  return async (ctx, next) => {
    if (ctx.method !== "GET" && ctx.method !== "HEAD") {
      try {
        const body = await ctx.body;
        console.log("[BODY]", JSON.stringify(body, null, 2));
      } catch {
        // Ignore body parsing errors
      }
    }
    return next();
  };
}

/**
 * Delay middleware for testing slow responses
 */
export function delay(ms: number): Middleware {
  return async (_, next) => {
    await new Promise(resolve => setTimeout(resolve, ms));
    return next();
  };
}

/**
 * Random failure middleware for chaos testing
 */
export function chaos(failureRate = 0.1, statusCode = 500): Middleware {
  return async (ctx, next) => {
    if (Math.random() < failureRate) {
      ctx.setStatus(statusCode);
      return { error: "Chaos monkey strikes!" };
    }
    return next();
  };
}
