# Packages

AsiJS keeps its core in a single package (`asijs`) and ships integrations as separate packages. The core stays dependency-free and Bun-first; adapters and tools are opt-in.

## Ecosystem overview

| Package | npm name | Purpose | Docs |
|---|---|---|---|
| [Next.js Adapter](/packages/next) | `asijs-next` | Use AsiJS routing inside Next.js App Router & Pages Router | [→](/packages/next) |
| [Astro Adapter](/packages/astro) | `asijs-astro` | AsiJS endpoints & middleware inside Astro | [→](/packages/astro) |
| [Remix Adapter](/packages/remix) | `asijs-remix` | AsiJS loaders/actions inside Remix | [→](/packages/remix) |
| [SvelteKit Adapter](/packages/sveltekit) | `asijs-sveltekit` | AsiJS hooks & server routes inside SvelteKit | [→](/packages/sveltekit) |
| [MCP Server](/packages/mcp) | `asijs-mcp` | Model Context Protocol server (tools, resources, prompts, workflows) | [→](/packages/mcp) |
| [OpenTelemetry](/packages/opentelemetry) | `asijs-opentelemetry` | Traces, metrics & logs via OTel — one plugin | [→](/packages/opentelemetry) |
| [ESLint Plugin](/packages/eslint) | `eslint-plugin-asijs` | Route hygiene rules for AsiJS projects | [→](/packages/eslint) |
| [VS Code Extension](/packages/vscode) | `vscode-asijs` | Route explorer, snippets, templates, debugging, diagnostics | [→](/packages/vscode) |
| [Vite Dev Server](/packages/vite) | `asijs-vite` | AsiJS backend inside a Vite dev server — one port, HMR bridge, Rolldown SSR build | [→](/packages/vite) |
| [React (RSC)](/packages/react) | `asijs-react` | React Server Components for AsiJS — Flight, streaming SSR + hydration | [→](/packages/react) |
| [GraphQL](/packages/graphql) | `graphql-asijs` | Code-first GraphQL — TypeBox → SDL, WS subscriptions, Federation, DataLoader | [→](/packages/graphql) |
| [MiyoCSS](/packages/miyocss) | `miyocss` | SSR-first utility CSS + SVG engine (framework-agnostic) | [→](/packages/miyocss) |
| [TOON](/packages/toon) | `toon-asijs` | TOON (token-optimized LLM format) as a native DataFormat — `parseBody`/`setFormat` out of the box | [→](/packages/toon) |

## Design principles

1. **Framework adapters never re-implement AsiJS.** Each adapter converts the host framework's request into a standard `Request`, calls `app.handle()`, and maps the `Response` back. Every AsiJS feature — validation, middleware, plugins, error pages — works unchanged inside the host framework.

2. **Optional peer dependencies.** `asijs` itself has zero runtime dependencies. Integration packages only require what they actually use: `asijs-mcp` needs `asijs`, `asijs-opentelemetry` needs `@opentelemetry/api` (SDK packages are optional and degrade gracefully).

3. **The core is Bun-first; adapters are host-first.** If you use AsiJS with Next.js, you're still running Next.js — the adapter only owns the API surface you point at it.

## Installing a package

```bash
# Next.js
bun add asijs-next

# Astro
bun add asijs-astro

# Remix
bun add asijs-remix

# SvelteKit
bun add asijs-sveltekit

# MCP
bun add asijs-mcp

# OpenTelemetry
bun add asijs-opentelemetry @opentelemetry/api

# ESLint
bun add -d eslint-plugin-asijs

# Vite dev server
bun add asijs-vite

# React Server Components
bun add asijs-react react react-dom react-server-dom-webpack

# GraphQL
bun add graphql-asijs graphql

# MiyoCSS
bun add miyocss

# TOON (LLM-optimized data format)
bun add toon-asijs
```

The VS Code extension (`vscode-asijs`) is installed from the Marketplace, not npm — see [its page](/packages/vscode).
