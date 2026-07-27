import { defineConfig } from "vitepress";

export default defineConfig({
  base: "/asijs/",
  title: "AsiJS",
  description: "Bun-first web framework — fast, type-safe, simple",
  lang: "en-US",

  head: [
    ["meta", { name: "theme-color", content: "#7c9cff" }],
    ["meta", { property: "og:title", content: "AsiJS — Bun-first Web Framework" }],
    ["meta", { property: "og:description", content: "Fast, type-safe, and simple Bun-first web framework with built-in OpenAPI, WebSocket, JSX, and more." }],
  ],

  themeConfig: {
    siteTitle: "AsiJS",

    nav: [
      { text: "Home", link: "/" },
      { text: "Getting Started", link: "/getting-started" },
      { text: "Guide", link: "/routing" },
      { text: "API", link: "/api-reference" },
      {
        text: "Resources",
        items: [
          { text: "Benchmarks", link: "/benchmarks/" },
          { text: "Migration Guide", link: "/migration/" },
          { text: "GitHub", link: "https://github.com/Baconana-chan/asijs" },
          { text: "npm", link: "https://www.npmjs.com/package/asijs" },
          { text: "JSR", link: "https://jsr.io/@baconana/asijs" },
        ],
      },
    ],

    sidebar: [
      {
        text: "Introduction",
        items: [
          { text: "What is AsiJS?", link: "/" },
          { text: "Getting Started", link: "/getting-started" },
        ],
      },
      {
        text: "Core Concepts",
        items: [
          { text: "Routing", link: "/routing" },
          { text: "Context & Middleware", link: "/context" },
          { text: "Validation", link: "/validation" },
          { text: "Error Handling", link: "/error-handling" },
          { text: "Plugins", link: "/plugins" },
        ],
      },
      {
        text: "Features",
        items: [
          { text: "Authentication", link: "/features/auth" },
          { text: "OpenAPI / Swagger", link: "/features/openapi" },
          { text: "WebSocket", link: "/features/websocket" },
          { text: "JSX Rendering", link: "/features/jsx" },
          { text: "Rate Limiting", link: "/features/rate-limiting" },
          { text: "Security Headers", link: "/features/security" },
          { text: "Response Caching", link: "/features/caching" },
          { text: "Observability", link: "/features/observability" },
          { text: "Scheduler", link: "/features/scheduler" },
          { text: "Graceful Shutdown", link: "/features/lifecycle" },
        ],
      },
      {
        text: "Advanced",
        items: [
          { text: "MCP Server", link: "/features/mcp" },
          { text: "RPC 2.0", link: "/features/rpc" },
          { text: "Server Actions", link: "/features/rpc#server-actions" },
          { text: "Workspace Dev", link: "/features/workspace" },
          { text: "Dev Mode", link: "/dev-mode" },
        ],
      },
      {
        text: "Migration",
        items: [
          { text: "Overview", link: "/migration/" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "API Reference", link: "/api-reference" },
          { text: "Benchmarks", link: "/benchmarks/" },
        ],
      },
    ],

    socialLinks: [
      { icon: "github", link: "https://github.com/Baconana-chan/asijs" },
    ],

    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © 2026 AsiJS",
    },

    editLink: {
      pattern: "https://github.com/Baconana-chan/asijs/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },

    search: {
      provider: "local",
    },
  },

  lastUpdated: true,
  cleanUrls: true,
});
