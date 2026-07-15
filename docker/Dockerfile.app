# ===== AsiJS App Dockerfile — Copy this into your project =====
#
# Multi-stage build:
#   Stage 1 — Install deps + build TypeScript
#   Stage 2 — Minimal production image with non-root user
#
# Usage:
#   docker build -t my-app -f Dockerfile.app .
#   docker run -p 3000:3000 my-app

# ===== Stage 1: Build =====
FROM oven/bun:1 AS builder

WORKDIR /app

# 1. Install dependencies (layer cached unless package.json changes)
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# 2. Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# 3. Build (outputs to dist/)
RUN bun build src/index.ts --outdir dist --target bun --minify

# Prune dev dependencies
RUN rm -rf node_modules && \
    bun install --frozen-lockfile --production

# ===== Stage 2: Production =====
FROM oven/bun:1-slim AS production

WORKDIR /app

# Create non-root user (Alpine-compatible)
RUN addgroup -S -g 1001 asijs && \
    adduser -S -u 1001 -G asijs asijs

# Copy only what's needed at runtime
COPY --from=builder --chown=asijs:asijs /app/dist ./dist
COPY --from=builder --chown=asijs:asijs /app/node_modules ./node_modules
COPY --from=builder --chown=asijs:asijs /app/package.json ./

# Security: run as non-root
USER asijs

EXPOSE 3000

# Healthcheck — requires /health route
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:\${PORT:-3000}/health').then(r => r.status === 200 ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Graceful shutdown via Bun's built-in SIGTERM handling
CMD ["bun", "run", "dist/index.js"]
