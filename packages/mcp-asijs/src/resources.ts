/**
 * asijs-mcp — Built-in resources & dynamic documentation
 *
 * Resources expose live application data (`asijs://routes`, …) plus
 * documentation. When `docsDir` is configured, every markdown file in that
 * directory becomes a `docs://<slug>` resource — replacing the old
 * hard-coded docs approach. Without a `docsDir`, a built-in AsiJS cheat
 * sheet is served as `asijs://docs`.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative, extname, sep } from "path";
import { ASIJS_DOCS } from "asijs";
import type { MCPServer } from "./server";
import { stringify } from "./content";
import type { MCPResource, MCPResourceTemplate } from "./types";

// ============================================================================
// Docs scanning
// ============================================================================

export interface DocsFile {
  /** URI of the doc resource */
  uri: string;
  /** Slug (path relative to docsDir, no extension) */
  slug: string;
  /** Absolute file path */
  path: string;
}

/** Recursively find all markdown files under a directory */
export function findMarkdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  const walk = (current: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        if (entry.startsWith(".") || entry === "node_modules") continue;
        walk(full);
      } else if (extname(entry).toLowerCase() === ".md") {
        results.push(full);
      }
    }
  };
  walk(dir);
  return results.sort();
}

/** Build `docs://` resources from a directory of markdown files */
export function loadDocsResources(docsDir: string): { resources: MCPResource[]; template: MCPResourceTemplate; files: DocsFile[] } {
  const files = findMarkdownFiles(docsDir).map((path) => {
    const rel = relative(docsDir, path).split(sep).join("/");
    const slug = rel.replace(/\.md$/i, "").replace(/\/index$/, "");
    return { uri: `docs://${slug}`, slug, path };
  });

  const readFile = (path: string): string => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return `# ${path}\n\n(File could not be read)`;
    }
  };

  const fileResources: MCPResource[] = files.map((f) => ({
    uri: f.uri,
    name: f.slug.split("/").pop() ?? f.slug,
    description: `Documentation: ${f.slug}`,
    mimeType: "text/markdown",
    contents: () => readFile(f.path),
  }));

  const index: MCPResource = {
    uri: "docs://index",
    name: "Documentation Index",
    description: "Index of all documentation files",
    mimeType: "text/markdown",
    contents: () =>
      files
        .map((f) => `- [${f.slug}](${f.uri})`)
        .join("\n") || "# Documentation\n\n(no files found)",
  };

  const all: MCPResource = {
    uri: "docs://all",
    name: "All Documentation",
    description: "Concatenation of all documentation files",
    mimeType: "text/markdown",
    contents: () =>
      files.map((f) => `---\n# ${f.slug}\n\n${readFile(f.path)}`).join("\n\n") ||
      "# Documentation\n\n(no files found)",
  };

  const template: MCPResourceTemplate = {
    uriTemplate: "docs://{slug}",
    name: "Documentation File",
    description: "Read a specific documentation file by slug",
    mimeType: "text/markdown",
    resolve: (uri) => {
      if (!uri.startsWith("docs://")) return null;
      const slug = uri.slice("docs://".length);
      const file = files.find((f) => f.slug === slug);
      if (!file) return null;
      return {
        uri,
        name: slug.split("/").pop() ?? slug,
        description: `Documentation: ${slug}`,
        mimeType: "text/markdown",
        contents: () => readFile(file.path),
      };
    },
  };

  return { resources: [...fileResources, index, all], template, files };
}

// ============================================================================
// Built-in resources
// ============================================================================

export function createBuiltinResources(server: MCPServer, docsDir?: string): MCPResource[] {
  const runtime = server.runtimeBridge;

  const resources: MCPResource[] = [
    {
      uri: "asijs://routes",
      name: "Application Routes",
      description: "All registered routes in the AsiJS application",
      mimeType: "application/json",
      contents: () => stringify(runtime.routes()),
    },
    {
      uri: "asijs://openapi",
      name: "OpenAPI Specification",
      description: "OpenAPI spec generated from the application routes",
      mimeType: "application/json",
      contents: () => stringify(runtime.openAPI()),
    },
    {
      uri: "asijs://plugins",
      name: "Plugin Dependency Graph",
      description: "Registered plugins, statuses, dependencies and init order",
      mimeType: "application/json",
      contents: () => stringify(runtime.pluginGraph()),
    },
    {
      uri: "asijs://config",
      name: "Application Configuration",
      description: "Public app configuration (port, hostname, development mode)",
      mimeType: "application/json",
      contents: () => stringify(runtime.appState()),
    },
    {
      uri: "asijs://circuit-breakers",
      name: "Circuit Breaker Health",
      description: "All circuit breakers with current state and metrics",
      mimeType: "application/json",
      contents: () => stringify(runtime.circuitBreakers()),
    },
    {
      uri: "asijs://ws-rooms",
      name: "WebSocket Rooms",
      description: "WebSocket pub-sub rooms, connections and presence",
      mimeType: "application/json",
      contents: () => stringify(runtime.wsRooms()),
    },
    {
      uri: "asijs://runtime",
      name: "Runtime Snapshot",
      description: "Combined snapshot of routes, plugins, circuit breakers, rooms, SSG paths and serverless state",
      mimeType: "application/json",
      contents: async () =>
        stringify({
          state: runtime.appState(),
          circuitBreakers: runtime.circuitBreakers(),
          wsRooms: runtime.wsRooms(),
          hotReload: runtime.hotReload(),
          serverless: runtime.serverlessStatus(),
          ssgPaths: runtime.ssgPaths(),
        }),
    },
  ];

  // Documentation resource — dynamic (docsDir) or built-in fallback
  if (docsDir && existsSync(docsDir)) {
    const { resources: docs, template } = loadDocsResources(docsDir);
    resources.push(...docs);
    server.addResourceTemplate(template);
  } else {
    resources.push({
      uri: "asijs://docs",
      name: "AsiJS Documentation",
      description: "Built-in AsiJS framework cheat sheet",
      mimeType: "text/markdown",
      text: ASIJS_DOCS,
    });
  }

  return resources;
}
