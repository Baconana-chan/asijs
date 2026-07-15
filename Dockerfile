# ===== Stage 1: Install & Build =====
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy dependency manifests
COPY package.json bun.lock* ./

# Install ALL dependencies (including devDependencies for build)
RUN bun install --frozen-lockfile

# Copy source code
COPY tsconfig.json tsconfig.build.json ./
COPY src/ ./src/

# Build the project (TypeScript → dist/)
RUN bun run build

# Prune devDependencies — keep only runtime deps
RUN bun install --frozen-lockfile --production

# ===== Stage 2: Production Image =====
FROM oven/bun:1-slim AS production

WORKDIR /app

# Create non-root user (Alpine-compatible)
RUN addgroup -S -g 1001 asijs && \
    adduser -S -u 1001 -G asijs asijs

# Copy production artifacts from builder
COPY --from=builder --chown=asijs:asijs /app/dist ./dist
COPY --from=builder --chown=asijs:asijs /app/node_modules ./node_modules
COPY --from=builder --chown=asijs:asijs /app/package.json ./

# Switch to non-root user
USER asijs

# Expose the application port
EXPOSE 3000

# Healthcheck — pings the /health endpoint every 30s
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:${PORT:-3000}/health').then(r => r.status === 200 ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start with proper signal handling for graceful shutdown
CMD ["bun", "run", "dist/index.js"]
