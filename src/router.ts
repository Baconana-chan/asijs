import type {
  Route,
  RouteMatch,
  RouteMethod,
  Handler,
  Middleware,
} from "./types";
import {
  getDefaultPathCache,
  internString,
  parsePathCached,
  type PathSegmentsCache,
} from "./router-perf";

/**
 * Router — простой роутер с поддержкой параметров :id и wildcard *
 *
 * Использует Trie-структуру для быстрого поиска
 */

interface TrieNode {
  handlers: Map<
    RouteMethod,
    { handler: Handler; middlewares: Middleware[]; path: string }
  >;
  children: Map<string, TrieNode>;
  paramChild: { name: string; node: TrieNode } | null;
  wildcardHandler: {
    handler: Handler;
    middlewares: Middleware[];
    path: string;
  } | null;
}

function createNode(): TrieNode {
  return {
    handlers: new Map(),
    children: new Map(),
    paramChild: null,
    wildcardHandler: null,
  };
}

export class Router {
  private root: TrieNode = createNode();
  private pathCache: PathSegmentsCache | null;
  /** Inline bypass — static paths mapped directly (no segment walk) */
  private staticRoutes: Map<
    string,
    Map<
      RouteMethod,
      { handler: Handler; middlewares: Middleware[]; path: string }
    >
  > = new Map();

  constructor(options: { pathCache?: PathSegmentsCache | false } = {}) {
    this.pathCache =
      options.pathCache === false
        ? null
        : (options.pathCache ?? getDefaultPathCache());
  }

  /**
   * Добавить роут
   */
  add(
    method: RouteMethod,
    path: string,
    handler: Handler,
    middlewares: Middleware[] = [],
  ): void {
    const segments = parsePathCached(path, this.pathCache);

    // Inline static bypass — register fully-static paths in a direct map
    let isStatic = true;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg === "*" || seg.startsWith(":")) {
        isStatic = false;
        break;
      }
    }
    if (isStatic) {
      let methods = this.staticRoutes.get(path);
      if (!methods) {
        methods = new Map();
        this.staticRoutes.set(path, methods);
      }
      methods.set(method, { handler, middlewares, path });
    }

    let node = this.root;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];

      // Wildcard — конец пути
      if (segment === "*") {
        node.wildcardHandler = { handler, middlewares, path };
        return;
      }

      // Параметр :name — интернируем имя для reuse
      if (segment.startsWith(":")) {
        const paramName = internString(segment.slice(1));
        if (!node.paramChild) {
          node.paramChild = { name: paramName, node: createNode() };
        }
        node = node.paramChild.node;
        continue;
      }

      // Статический сегмент
      if (!node.children.has(segment)) {
        node.children.set(segment, createNode());
      }
      node = node.children.get(segment)!;
    }

    node.handlers.set(method, { handler, middlewares, path });
  }

  /**
   * Найти роут по методу и пути
   */
  find(method: RouteMethod, path: string): RouteMatch | null {
    // Inline bypass: static path — direct Map lookup, no parsePath, no walk
    const staticMethods = this.staticRoutes.get(path);
    if (staticMethods) {
      const route =
        staticMethods.get(method) ??
        staticMethods.get("ALL" as RouteMethod);
      if (route) {
        return {
          path: route.path,
          handler: route.handler,
          params: {},
          middlewares: route.middlewares,
        };
      }
    }

    const segments = parsePathCached(path, this.pathCache);
    const params: Record<string, string> = {};

    const result = this.findNode(this.root, segments, 0, params, method);

    if (result) {
      return {
        path: result.path,
        handler: result.handler,
        params,
        middlewares: result.middlewares,
      };
    }

    return null;
  }

  private findNode(
    node: TrieNode,
    segments: string[],
    index: number,
    params: Record<string, string>,
    method: RouteMethod,
  ): { handler: Handler; middlewares: Middleware[]; path: string } | null {
    // Достигли конца пути
    if (index === segments.length) {
      // Проверяем точное совпадение метода
      const exact = node.handlers.get(method);
      if (exact) return exact;

      // Проверяем ALL
      const all = node.handlers.get("ALL");
      if (all) return all;

      return null;
    }

    const segment = segments[index];

    // 1. Статический путь (приоритет)
    const staticChild = node.children.get(segment);
    if (staticChild) {
      const result = this.findNode(
        staticChild,
        segments,
        index + 1,
        params,
        method,
      );
      if (result) return result;
    }

    // 2. Параметр :name (мутация + backtracking, без аллокаций)
    if (node.paramChild) {
      const paramName = node.paramChild.name;
      params[paramName] = segment;

      const result = this.findNode(
        node.paramChild.node,
        segments,
        index + 1,
        params,
        method,
      );
      if (result) {
        return result;
      }

      // Backtrack: откатить параметр если не нашли
      delete params[paramName];
    }

    // 3. Wildcard *
    if (node.wildcardHandler) {
      return node.wildcardHandler;
    }

    return null;
  }
}
