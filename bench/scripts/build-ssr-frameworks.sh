#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# build-ssr-frameworks.sh — Install & build the SSR benchmark
# framework apps (bench/frameworks/*).
#
# Usage:
#   bash scripts/build-ssr-frameworks.sh
#   or: bun run bench:ssr:build
#
# Builds (production only, Bun-compatible):
#   - sveltekit  → @sveltejs/adapter-node  → build/index.js
#   - astro      → @astrojs/node standalone → dist/server/entry.mjs
#   - nuxt       → nitro "bun" preset      → .output/server/index.mjs
#
# Then run the benchmark: bun run bench:ssr
# ─────────────────────────────────────────────────────────────
set -euo pipefail

cd "$(dirname "$0")/.." # → bench/

FRAMEWORKS=(sveltekit astro nuxt)

for FRAMEWORK in "${FRAMEWORKS[@]}"; do
  echo ""
  echo "  ┌──────────────────────────────────────────────"
  echo "  │ 📦  frameworks/$FRAMEWORK"
  echo "  └──────────────────────────────────────────────"
  (cd "frameworks/$FRAMEWORK" && bun install && bun run build)
done

echo ""
echo "  ✅ SSR frameworks built — run: bun run bench:ssr"
