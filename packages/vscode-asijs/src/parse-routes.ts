/**
 * Route parser for AsiJS source code.
 *
 * Scans TypeScript/JavaScript source for app.get/post/put/delete/patch/all/head/options/ws
 * calls and extracts route metadata for the Route Explorer webview and hover provider.
 */

export interface RouteInfo {
  method: string;
  path: string;
  line: number;
  hasValidation: boolean;
  isWebSocket: boolean;
}

/**
 * Parse AsiJS routes from TypeScript source code.
 */
export function parseRoutes(source: string): RouteInfo[] {
  const routes: RouteInfo[] = [];
  const routePattern =
    /app\.(get|post|put|delete|patch|all|head|options|ws)\(\s*['"`]([^'"`]+)['"`]/g;

  let match: RegExpExecArray | null;
  while ((match = routePattern.exec(source)) !== null) {
    const rawMethod = match[1]!;
    const method = rawMethod.toUpperCase();
    const routePath = match[2]!;
    const line = source.slice(0, match.index).split("\n").length;

    // Look ahead up to 300 chars for schema definition
    const remaining = source.slice(match.index, match.index + 300);
    const hasValidation = /schema\s*:|Type\.Object\s*\(/.test(remaining);

    routes.push({
      method: method === "WS" ? "WS" : method,
      path: routePath,
      line,
      hasValidation,
      isWebSocket: rawMethod === "ws",
    });
  }

  return routes;
}
