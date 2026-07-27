/**
 * Plugin Dependency Manager
 *
 * Handles dependency graph construction, cycle detection,
 * topological sorting for plugin initialization order,
 * and lazy init (waiting for dependencies to be ready).
 *
 * @example
 * ```ts
 * const mgr = new PluginDependencyManager();
 * mgr.addPlugin("sessions", [], { lazy: true });
 * mgr.addPlugin("auth", ["sessions", "cors"]);
 * mgr.addPlugin("cors", []);
 *
 * mgr.resolveOrder(); // ["cors", "sessions", "auth"]
 * ```
 */

import type { AsiPlugin, PluginHooks } from "./plugin";

// ============================================================================
// Types
// ============================================================================

export interface PluginNode {
  name: string;
  plugin: AsiPlugin | null;
  dependencies: string[];
  status: PluginStatus;
  hooks: PluginHooks;
  metadata: PluginMetadata;
}

export type PluginStatus =
  | "registered"  // Added to graph, not yet initialized
  | "pending"     // Waiting for dependencies
  | "ready"       // Dependencies satisfied, waiting for init
  | "initializing"
  | "initialized"
  | "error";

export interface PluginMetadata {
  version?: string;
  description?: string;
  lazy: boolean;
}

export interface PluginGraphEdge {
  from: string;
  to: string;
}

export interface PluginGraphInfo {
  nodes: PluginNode[];
  edges: PluginGraphEdge[];
  initOrder: string[];
  hasCycle: boolean;
  cyclePath: string[] | null;
}

export interface PluginInitQueueItem {
  name: string;
  plugin: AsiPlugin;
  hooks: PluginHooks;
  metadata: PluginMetadata;
}

// ============================================================================
// Cycle detection error
// ============================================================================

export class CyclicDependencyError extends Error {
  constructor(public readonly cycle: string[]) {
    super(
      `Cyclic plugin dependency detected: ${cycle.join(" → ")}`,
    );
    this.name = "CyclicDependencyError";
  }
}

export class MissingDependencyError extends Error {
  constructor(
    public readonly plugin: string,
    public readonly dependency: string,
  ) {
    super(
      `Plugin "${plugin}" depends on "${dependency}" which is not registered`,
    );
    this.name = "MissingDependencyError";
  }
}

// ============================================================================
// PluginDependencyManager
// ============================================================================

export class PluginDependencyManager {
  private nodes = new Map<string, PluginNode>();
  private adjacency = new Map<string, Set<string>>();

  /**
   * Register a plugin in the dependency graph.
   */
  addPlugin(
    name: string,
    dependencies: string[],
    plugin: AsiPlugin | null = null,
    hooks: Partial<PluginHooks> = {},
    metadata: Partial<PluginMetadata> = {},
  ): void {
    if (this.nodes.has(name)) return;

    const node: PluginNode = {
      name,
      plugin,
      dependencies,
      status: "registered",
      hooks: {
        onBeforeInit: hooks.onBeforeInit,
        onAfterInit: hooks.onAfterInit,
        onBeforeRoute: hooks.onBeforeRoute,
      },
      metadata: {
        version: metadata.version,
        description: metadata.description,
        lazy: metadata.lazy ?? false,
      },
    };

    this.nodes.set(name, node);
    this.adjacency.set(name, new Set(dependencies));

    // Build reverse adjacency for downstream tracking
    for (const dep of dependencies) {
      if (!this.adjacency.has(dep)) {
        this.adjacency.set(dep, new Set());
      }
    }
  }

  /**
   * Check if a plugin is registered.
   */
  hasPlugin(name: string): boolean {
    return this.nodes.has(name);
  }

  /**
   * Get a plugin node by name.
   */
  getPlugin(name: string): PluginNode | undefined {
    return this.nodes.get(name);
  }

  /**
   * Update plugin status.
   */
  setStatus(name: string, status: PluginStatus): void {
    const node = this.nodes.get(name);
    if (node) {
      node.status = status;
    }
  }

  /**
   * Update plugin hooks.
   */
  setHooks(name: string, hooks: Partial<PluginHooks>): void {
    const node = this.nodes.get(name);
    if (node) {
      if (hooks.onBeforeInit) node.hooks.onBeforeInit = hooks.onBeforeInit;
      if (hooks.onAfterInit) node.hooks.onAfterInit = hooks.onAfterInit;
      if (hooks.onBeforeRoute) node.hooks.onBeforeRoute = hooks.onBeforeRoute;
    }
  }

  /**
   * Detect cyclic dependencies using DFS.
   * Returns the cycle path if found, null otherwise.
   */
  detectCycle(): string[] | null {
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    const parent = new Map<string, string | null>();

    for (const name of this.nodes.keys()) {
      color.set(name, WHITE);
      parent.set(name, null);
    }

    const dfs = (u: string): string[] | null => {
      color.set(u, GRAY);

      const deps = this.adjacency.get(u);
      if (deps) {
        for (const v of deps) {
          if (!this.nodes.has(v)) continue; // Skip unregistered (will be caught separately)

          if (color.get(v) === GRAY) {
            // Found a back edge — reconstruct cycle
            const cycle: string[] = [v, u];
            let p = parent.get(u);
            // Use != null to narrow both null and undefined
            while (p != null && p !== v) {
              cycle.push(p);
              p = parent.get(p);
            }
            cycle.push(v);
            cycle.reverse();
            return cycle;
          }

          if (color.get(v) === WHITE) {
            parent.set(v, u);
            const result = dfs(v);
            if (result) return result;
          }
        }
      }

      color.set(u, BLACK);
      return null;
    };

    for (const name of this.nodes.keys()) {
      if (color.get(name) === WHITE) {
        const result = dfs(name);
        if (result) return result;
      }
    }

    return null;
  }

  /**
   * Resolve plugin initialization order using topological sort (Kahn's algorithm).
   * Throws CyclicDependencyError if a cycle is detected.
   * Throws MissingDependencyError if dependencies are not registered.
   */
  resolveOrder(): string[] {
    // Check for missing dependencies
    for (const [name, node] of this.nodes) {
      for (const dep of node.dependencies) {
        if (!this.nodes.has(dep)) {
          throw new MissingDependencyError(name, dep);
        }
      }
    }

    // Check for cycles
    const cycle = this.detectCycle();
    if (cycle) {
      throw new CyclicDependencyError(cycle);
    }

    // Kahn's algorithm
    const inDegree = new Map<string, number>();
    const adjCopy = new Map<string, string[]>();

    for (const [name] of this.nodes) {
      inDegree.set(name, 0);
      adjCopy.set(name, []);
    }

    for (const [name, node] of this.nodes) {
      for (const dep of node.dependencies) {
        // Edge: dep → name (dep must be initialized before name)
        const edgeList = adjCopy.get(dep);
        if (edgeList) {
          edgeList.push(name);
        }
        inDegree.set(name, (inDegree.get(name) ?? 0) + 1);
      }
    }

    const queue: string[] = [];
    for (const [name, degree] of inDegree) {
      if (degree === 0) {
        queue.push(name);
      }
    }

    const result: string[] = [];
    while (queue.length > 0) {
      const nodeName = queue.shift()!;
      result.push(nodeName);

      for (const neighbor of adjCopy.get(nodeName) || []) {
        const currentDegree = inDegree.get(neighbor) ?? 0;
        const newDegree = currentDegree - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          queue.push(neighbor);
        }
      }
    }

    return result;
  }

  /**
   * Check if a plugin's dependencies are all initialized.
   */
  areDependenciesReady(name: string): boolean {
    const node = this.nodes.get(name);
    if (!node) return false;
    if (node.dependencies.length === 0) return true;

    return node.dependencies.every((dep) => {
      const depNode = this.nodes.get(dep);
      return depNode?.status === "initialized";
    });
  }

  /**
   * Get plugins that are ready to initialize (dependencies satisfied).
   */
  getReadyPlugins(): PluginNode[] {
    const ready: PluginNode[] = [];
    for (const node of this.nodes.values()) {
      if (
        (node.status === "registered" || node.status === "pending") &&
        this.areDependenciesReady(node.name)
      ) {
        ready.push(node);
      }
    }
    return ready;
  }

  /**
   * Visualize the dependency graph for inspection / CLI.
   */
  getGraphInfo(): PluginGraphInfo {
    const nodes = Array.from(this.nodes.values());
    const edges: PluginGraphEdge[] = [];
    const cycle = this.detectCycle();

    for (const [name, node] of this.nodes) {
      for (const dep of node.dependencies) {
        if (this.nodes.has(dep)) {
          edges.push({ from: name, to: dep });
        }
      }
    }

    let initOrder: string[] = [];
    try {
      initOrder = this.resolveOrder();
    } catch {
      initOrder = [];
    }

    return {
      nodes,
      edges,
      initOrder,
      hasCycle: cycle !== null,
      cyclePath: cycle,
    };
  }

  /**
   * Get a DOT graph representation for debugging.
   */
  toDot(): string {
    const lines: string[] = ["digraph PluginDeps {"];
    lines.push("  rankdir=LR;");
    lines.push("  node [shape=box, style=rounded];");

    for (const [name, node] of this.nodes) {
      const statusColor: Record<PluginStatus, string> = {
        registered: "#f0f0f0",
        pending: "#fff3cd",
        ready: "#d4edda",
        initializing: "#cce5ff",
        initialized: "#28a745",
        error: "#f8d7da",
      };
      const color = statusColor[node.status] || "#f0f0f0";
      lines.push(`  "${name}" [fillcolor="${color}", style="filled,rounded"];`);
    }

    for (const [name, node] of this.nodes) {
      for (const dep of node.dependencies) {
        if (this.nodes.has(dep)) {
          lines.push(`  "${name}" -> "${dep}";`);
        }
      }
    }

    lines.push("}");
    return lines.join("\n");
  }
}
