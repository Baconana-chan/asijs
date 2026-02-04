import type {
  Route,
  RouteMatch,
  RouteMethod,
  Handler,
  Middleware,
} from "./types";

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

  /**
   * Добавить роут
   */
  add(
    method: RouteMethod,
    path: string,
    handler: Handler,
    middlewares: Middleware[] = [],
  ): void {
    const segments = this.parsePath(path);
    let node = this.root;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];

      // Wildcard — конец пути
      if (segment === "*") {
        node.wildcardHandler = { handler, middlewares, path };
        return;
      }

      // Параметр :name
      if (segment.startsWith(":")) {
        const paramName = segment.slice(1);
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
    const segments = this.parsePath(path);
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

  private parsePath(path: string): string[] {
    // Fast path for root
    if (path === "/" || path === "") {
      return [];
    }

    // Оптимизированный split без filter
    const segments: string[] = [];
    let start = 0;
    const len = path.length;

    for (let i = 0; i <= len; i++) {
      if (i === len || path[i] === "/") {
        if (i > start) {
          segments.push(path.slice(start, i));
        }
        start = i + 1;
      }
    }

    return segments;
  }
}
