import { defineConfig } from "astro/config";
import node from "@astrojs/node";

// mode: "standalone" → dist/server/entry.mjs exports `app` (app.render(request))
// for in-process benchmarking and auto-starts a server when run directly.
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
});
