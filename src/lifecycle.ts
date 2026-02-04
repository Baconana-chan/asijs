/**
 * Lifecycle Management for AsiJS
 * 
 * Graceful shutdown with signal handling, connection draining,
 * and cleanup hooks.
 * 
 * @example
 * ```ts
 * import { Asi, lifecycle } from "asijs";
 * 
 * const app = new Asi();
 * 
 * // Register cleanup handlers
 * app.plugin(lifecycle({
 *   onShutdown: [
 *     async () => {
 *       await db.close();
 *       console.log("Database closed");
 *     },
 *     async () => {
 *       await cache.flush();
 *       console.log("Cache flushed");
 *     }
 *   ],
 *   gracefulTimeout: 30_000, // 30s max for graceful shutdown
 * }));
 * 
 * app.listen(3000);
 * ```
 */

import { createPlugin, type AsiPlugin } from "./plugin";
import type { Asi } from "./asi";

// ===== Types =====

export type ShutdownHandler = () => void | Promise<void>;

export interface LifecycleOptions {
  /**
   * Handlers to run on shutdown (in order)
   */
  onShutdown?: ShutdownHandler[];
  
  /**
   * Maximum time to wait for graceful shutdown (ms)
   * @default 30000
   */
  gracefulTimeout?: number;
  
  /**
   * Whether to handle SIGTERM/SIGINT automatically
   * @default true
   */
  handleSignals?: boolean;
  
  /**
   * Custom signals to handle
   * @default ["SIGTERM", "SIGINT"]
   */
  signals?: NodeJS.Signals[];
  
  /**
   * Whether to log shutdown progress
   * @default true
   */
  verbose?: boolean;
}

// ===== Lifecycle Manager =====

export class LifecycleManager {
  private shutdownHandlers: ShutdownHandler[] = [];
  private isShuttingDown = false;
  private gracefulTimeout: number;
  private verbose: boolean;
  private app: Asi | null = null;
  private signalHandlers: Map<string, () => void> = new Map();
  
  constructor(options: LifecycleOptions = {}) {
    this.gracefulTimeout = options.gracefulTimeout ?? 30_000;
    this.verbose = options.verbose ?? true;
    
    if (options.onShutdown) {
      this.shutdownHandlers.push(...options.onShutdown);
    }
    
    if (options.handleSignals !== false) {
      const signals = options.signals ?? ["SIGTERM", "SIGINT"];
      this.setupSignalHandlers(signals);
    }
  }
  
  /**
   * Bind to an Asi app instance
   */
  bind(app: Asi): void {
    this.app = app;
  }
  
  /**
   * Register a shutdown handler
   */
  onShutdown(handler: ShutdownHandler): void {
    this.shutdownHandlers.push(handler);
  }
  
  /**
   * Setup signal handlers
   */
  private setupSignalHandlers(signals: NodeJS.Signals[]): void {
    for (const signal of signals) {
      const handler = () => {
        if (this.verbose) {
          console.log(`\n📥 Received ${signal}, starting graceful shutdown...`);
        }
        this.shutdown().then(() => {
          process.exit(0);
        }).catch((err) => {
          console.error("Shutdown error:", err);
          process.exit(1);
        });
      };
      
      this.signalHandlers.set(signal, handler);
      process.on(signal, handler);
    }
  }
  
  /**
   * Remove signal handlers (useful for tests)
   */
  removeSignalHandlers(): void {
    for (const [signal, handler] of this.signalHandlers) {
      process.removeListener(signal as NodeJS.Signals, handler);
    }
    this.signalHandlers.clear();
  }
  
  /**
   * Perform graceful shutdown
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      if (this.verbose) {
        console.log("⏳ Shutdown already in progress...");
      }
      return;
    }
    
    this.isShuttingDown = true;
    const startTime = Date.now();
    
    if (this.verbose) {
      console.log("🛑 Starting graceful shutdown...");
    }
    
    // Create timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Graceful shutdown timed out after ${this.gracefulTimeout}ms`));
      }, this.gracefulTimeout);
    });
    
    try {
      // Stop accepting new connections
      if (this.app) {
        if (this.verbose) {
          console.log("  → Stopping server...");
        }
        this.app.stop();
      }
      
      // Run shutdown handlers with timeout
      await Promise.race([
        this.runShutdownHandlers(),
        timeoutPromise,
      ]);
      
      const duration = Date.now() - startTime;
      if (this.verbose) {
        console.log(`✅ Graceful shutdown complete in ${duration}ms`);
      }
    } catch (error) {
      if (this.verbose) {
        console.error("❌ Graceful shutdown failed:", error);
      }
      throw error;
    } finally {
      this.isShuttingDown = false;
    }
  }
  
  /**
   * Run all shutdown handlers in sequence
   */
  private async runShutdownHandlers(): Promise<void> {
    for (let i = 0; i < this.shutdownHandlers.length; i++) {
      const handler = this.shutdownHandlers[i];
      if (this.verbose) {
        console.log(`  → Running shutdown handler ${i + 1}/${this.shutdownHandlers.length}...`);
      }
      await handler();
    }
  }
  
  /**
   * Check if shutdown is in progress
   */
  get shuttingDown(): boolean {
    return this.isShuttingDown;
  }
}

// ===== Lifecycle Plugin =====

/**
 * Create lifecycle management plugin
 */
export function lifecycle(options: LifecycleOptions = {}): AsiPlugin {
  const manager = new LifecycleManager(options);
  
  return createPlugin({
    name: "lifecycle",
    
    setup(app) {
      manager.bind(app);
      
      // Add lifecycle methods to app state
      app.setState("lifecycleManager", manager);
    },
    
    decorate: {
      lifecycle: manager,
      onShutdown: (handler: ShutdownHandler) => manager.onShutdown(handler),
      shutdown: () => manager.shutdown(),
    },
  });
}

// ===== Standalone Shutdown Helper =====

/**
 * Create a standalone shutdown controller (without plugin)
 */
export function createShutdownController(
  app: Asi,
  options: LifecycleOptions = {}
): LifecycleManager {
  const manager = new LifecycleManager(options);
  manager.bind(app);
  return manager;
}

// ===== Health Check Helper =====

export interface HealthCheckOptions {
  /** Path for health check endpoint */
  path?: string;
  /** Path for readiness check */
  readinessPath?: string;
  /** Path for liveness check */
  livenessPath?: string;
  /** Custom health check function */
  check?: () => Promise<{ healthy: boolean; details?: Record<string, unknown> }>;
}

/**
 * Add health check endpoints
 */
export function healthCheck(options: HealthCheckOptions = {}): AsiPlugin {
  const {
    path = "/health",
    readinessPath = "/ready",
    livenessPath = "/live",
    check,
  } = options;
  
  return createPlugin({
    name: "health-check",
    
    setup(app) {
      // Basic health check
      app.get(path, async () => {
        if (check) {
          const result = await check();
          return {
            status: result.healthy ? "healthy" : "unhealthy",
            timestamp: new Date().toISOString(),
            ...result.details,
          };
        }
        
        return {
          status: "healthy",
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
        };
      });
      
      // Kubernetes readiness probe
      app.get(readinessPath, async (ctx) => {
        // Check if shutdown is in progress
        const lifecycle = app.getState<LifecycleManager>("lifecycleManager");
        if (lifecycle?.shuttingDown) {
          ctx.setStatus(503);
          return { ready: false, reason: "shutting_down" };
        }
        
        if (check) {
          const result = await check();
          if (!result.healthy) {
            ctx.setStatus(503);
            return { ready: false, ...result.details };
          }
        }
        
        return { ready: true };
      });
      
      // Kubernetes liveness probe
      app.get(livenessPath, () => {
        return { alive: true };
      });
    },
  });
}
