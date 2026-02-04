/**
 * Tracing & Observability Plugin for AsiJS
 * 
 * Request ID, timing, route pattern tracking with OpenTelemetry compatibility.
 * 
 * @example
 * ```ts
 * import { Asi, trace } from "asijs";
 * 
 * const app = new Asi();
 * 
 * // Basic tracing
 * app.plugin(trace());
 * 
 * // With custom options
 * app.plugin(trace({
 *   requestIdHeader: "X-Request-ID",
 *   logRequests: true,
 *   onRequest: (info) => {
 *     metrics.recordRequest(info);
 *   }
 * }));
 * ```
 */

import { createPlugin, type AsiPlugin } from "./plugin";
import type { Context } from "./context";
import type { Middleware } from "./types";

// ===== Types =====

export interface TraceInfo {
  /** Unique request ID */
  requestId: string;
  /** HTTP method */
  method: string;
  /** Request path */
  path: string;
  /** Matched route pattern (e.g., "/users/:id") */
  routePattern?: string;
  /** Request start time (high resolution) */
  startTime: number;
  /** Request duration in milliseconds */
  duration?: number;
  /** Response status code */
  status?: number;
  /** Client IP address */
  ip?: string;
  /** User agent */
  userAgent?: string;
  /** Request size in bytes */
  requestSize?: number;
  /** Response size in bytes */
  responseSize?: number;
  /** Any validation errors */
  validationErrors?: unknown[];
  /** Custom attributes */
  attributes: Map<string, unknown>;
  /** Span events */
  events: Array<{ name: string; timestamp: number; attributes?: Record<string, unknown> }>;
}

export interface TraceOptions {
  /**
   * Header name for request ID
   * @default "X-Request-ID"
   */
  requestIdHeader?: string;
  
  /**
   * Generate request ID if not provided
   * @default true
   */
  generateRequestId?: boolean;
  
  /**
   * Custom request ID generator
   */
  requestIdGenerator?: () => string;
  
  /**
   * Add timing headers to response
   * @default true
   */
  timingHeaders?: boolean;
  
  /**
   * Log requests to console
   * @default false
   */
  logRequests?: boolean;
  
  /**
   * Custom log formatter
   */
  logFormatter?: (info: TraceInfo) => string;
  
  /**
   * Callback on request start
   */
  onRequest?: (info: TraceInfo) => void | Promise<void>;
  
  /**
   * Callback on request end
   */
  onResponse?: (info: TraceInfo) => void | Promise<void>;
  
  /**
   * Skip tracing for certain paths
   */
  skip?: (ctx: Context) => boolean;
  
  /**
   * Paths to always skip (e.g., health checks)
   */
  skipPaths?: string[];
  
  /**
   * Enable Server-Timing header
   * @default true
   */
  serverTiming?: boolean;
  
  /**
   * Propagate trace context from incoming headers (W3C Trace Context)
   * @default true
   */
  propagateContext?: boolean;
}

// ===== Trace Context (W3C compatible) =====

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  sampled: boolean;
}

/**
 * Parse W3C traceparent header
 * Format: version-traceid-spanid-flags
 */
export function parseTraceparent(header: string): TraceContext | null {
  const parts = header.split("-");
  if (parts.length !== 4) return null;
  
  const [version, traceId, spanId, flags] = parts;
  
  // Version 00 is the only supported version
  if (version !== "00") return null;
  
  // Validate format
  if (traceId.length !== 32 || spanId.length !== 16) return null;
  
  return {
    traceId,
    spanId,
    sampled: (parseInt(flags, 16) & 0x01) === 0x01,
  };
}

/**
 * Generate a new trace context
 */
export function generateTraceContext(): TraceContext {
  return {
    traceId: generateTraceId(),
    spanId: generateSpanId(),
    sampled: true,
  };
}

/**
 * Generate trace ID (32 hex chars)
 */
export function generateTraceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Generate span ID (16 hex chars)
 */
export function generateSpanId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Generate simple request ID
 */
export function generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}`;
}

// ===== Trace Store (for async context) =====

// Using a simple Map for trace storage since Bun doesn't have AsyncLocalStorage yet
const traceStore = new Map<string, TraceInfo>();

/**
 * Get current trace info (by request ID)
 */
export function getCurrentTrace(requestId: string): TraceInfo | undefined {
  return traceStore.get(requestId);
}

/**
 * Add event to current trace
 */
export function addTraceEvent(
  requestId: string, 
  name: string, 
  attributes?: Record<string, unknown>
): void {
  const trace = traceStore.get(requestId);
  if (trace) {
    trace.events.push({
      name,
      timestamp: performance.now(),
      attributes,
    });
  }
}

/**
 * Set trace attribute
 */
export function setTraceAttribute(requestId: string, key: string, value: unknown): void {
  const trace = traceStore.get(requestId);
  if (trace) {
    trace.attributes.set(key, value);
  }
}

// ===== Pretty Logger =====

const statusColors: Record<number, string> = {
  2: "\x1b[32m", // Green for 2xx
  3: "\x1b[36m", // Cyan for 3xx
  4: "\x1b[33m", // Yellow for 4xx
  5: "\x1b[31m", // Red for 5xx
};

const methodColors: Record<string, string> = {
  GET: "\x1b[34m",    // Blue
  POST: "\x1b[32m",   // Green
  PUT: "\x1b[33m",    // Yellow
  PATCH: "\x1b[35m",  // Magenta
  DELETE: "\x1b[31m", // Red
  OPTIONS: "\x1b[36m", // Cyan
  HEAD: "\x1b[37m",   // White
};

const reset = "\x1b[0m";
const dim = "\x1b[2m";

function defaultLogFormatter(info: TraceInfo): string {
  const statusColor = statusColors[Math.floor((info.status ?? 0) / 100)] ?? "";
  const methodColor = methodColors[info.method] ?? "";
  const duration = info.duration?.toFixed(2) ?? "?";
  
  return `${dim}[${info.requestId}]${reset} ${methodColor}${info.method.padEnd(7)}${reset} ${info.path} ${statusColor}${info.status ?? "?"}${reset} ${dim}${duration}ms${reset}`;
}

// ===== Timing Helpers =====

export interface TimingMark {
  name: string;
  start: number;
  end?: number;
  description?: string;
}

export class Timing {
  private marks: Map<string, TimingMark> = new Map();
  private startTime: number;
  
  constructor() {
    this.startTime = performance.now();
  }
  
  start(name: string, description?: string): void {
    this.marks.set(name, {
      name,
      start: performance.now(),
      description,
    });
  }
  
  end(name: string): number {
    const mark = this.marks.get(name);
    if (mark) {
      mark.end = performance.now();
      return mark.end - mark.start;
    }
    return 0;
  }
  
  measure(name: string, fn: () => void, description?: string): void {
    this.start(name, description);
    fn();
    this.end(name);
  }
  
  async measureAsync<T>(name: string, fn: () => Promise<T>, description?: string): Promise<T> {
    this.start(name, description);
    try {
      return await fn();
    } finally {
      this.end(name);
    }
  }
  
  toServerTimingHeader(): string {
    const parts: string[] = [];
    
    for (const mark of this.marks.values()) {
      if (mark.end !== undefined) {
        const duration = (mark.end - mark.start).toFixed(2);
        const desc = mark.description ? `;desc="${mark.description}"` : "";
        parts.push(`${mark.name};dur=${duration}${desc}`);
      }
    }
    
    return parts.join(", ");
  }
  
  totalDuration(): number {
    return performance.now() - this.startTime;
  }
}

// ===== Trace Middleware =====

/**
 * Create tracing middleware
 */
export function traceMiddleware(options: TraceOptions = {}): Middleware {
  const {
    requestIdHeader = "X-Request-ID",
    generateRequestId: shouldGenerate = true,
    requestIdGenerator = generateRequestId,
    timingHeaders = true,
    logRequests = false,
    logFormatter = defaultLogFormatter,
    onRequest,
    onResponse,
    skip,
    skipPaths = ["/health", "/ready", "/live", "/metrics"],
    serverTiming = true,
    propagateContext = true,
  } = options;
  
  return async (ctx, next) => {
    // Skip if configured
    if (skip?.(ctx)) {
      return next();
    }
    
    // Skip health check paths
    if (skipPaths.includes(ctx.path)) {
      return next();
    }
    
    const startTime = performance.now();
    
    // Get or generate request ID
    let requestId = ctx.header(requestIdHeader);
    if (!requestId && shouldGenerate) {
      requestId = requestIdGenerator();
    }
    requestId = requestId ?? "unknown";
    
    // Parse trace context if propagating
    let traceContext: TraceContext | null = null;
    if (propagateContext) {
      const traceparent = ctx.header("traceparent");
      if (traceparent) {
        traceContext = parseTraceparent(traceparent);
      }
    }
    
    // Create trace info
    const traceInfo: TraceInfo = {
      requestId,
      method: ctx.method,
      path: ctx.path,
      startTime,
      ip: ctx.header("X-Forwarded-For") ?? ctx.header("X-Real-IP"),
      userAgent: ctx.header("User-Agent") ?? undefined,
      attributes: new Map(),
      events: [],
    };
    
    // Add trace context attributes
    if (traceContext) {
      traceInfo.attributes.set("trace.id", traceContext.traceId);
      traceInfo.attributes.set("trace.parent_span_id", traceContext.spanId);
    }
    
    // Store trace info
    traceStore.set(requestId, traceInfo);
    
    // Store timing for Server-Timing header
    const timing = new Timing();
    
    // Call onRequest hook
    if (onRequest) {
      await onRequest(traceInfo);
    }
    
    let response: Response | unknown;
    let status = 500;
    
    try {
      response = await next();
      
      if (response instanceof Response) {
        status = response.status;
        
        // Add headers to response
        const newHeaders = new Headers(response.headers);
        newHeaders.set(requestIdHeader, requestId);
        
        if (timingHeaders) {
          const duration = performance.now() - startTime;
          newHeaders.set("X-Response-Time", `${duration.toFixed(2)}ms`);
        }
        
        if (serverTiming) {
          const serverTimingValue = timing.toServerTimingHeader();
          if (serverTimingValue) {
            newHeaders.set("Server-Timing", serverTimingValue);
          }
        }
        
        response = new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders,
        });
      }
    } catch (error) {
      status = 500;
      throw error;
    } finally {
      const duration = performance.now() - startTime;
      
      // Update trace info
      traceInfo.duration = duration;
      traceInfo.status = status;
      
      // Get response size if available
      if (response instanceof Response) {
        const contentLength = (response as Response).headers.get("Content-Length");
        if (contentLength) {
          traceInfo.responseSize = parseInt(contentLength, 10);
        }
      }
      
      // Call onResponse hook
      if (onResponse) {
        await onResponse(traceInfo);
      }
      
      // Log if enabled
      if (logRequests) {
        console.log(logFormatter(traceInfo));
      }
      
      // Cleanup
      traceStore.delete(requestId);
    }
    
    return response as Response;
  };
}

// ===== Trace Plugin =====

/**
 * Create tracing plugin
 */
export function trace(options: TraceOptions = {}): AsiPlugin {
  return createPlugin({
    name: "trace",
    middleware: [traceMiddleware(options)],
    
    decorate: {
      getRequestId: (ctx: Context) => (ctx.store as Record<string, unknown>)["requestId"] as string | undefined,
      getTraceInfo: (ctx: Context) => (ctx.store as Record<string, unknown>)["traceInfo"] as TraceInfo | undefined,
      getTiming: (ctx: Context) => (ctx.store as Record<string, unknown>)["timing"] as Timing | undefined,
    },
  });
}

// ===== Metrics Helper =====

export interface RequestMetrics {
  totalRequests: number;
  totalDuration: number;
  statusCodes: Map<number, number>;
  methods: Map<string, number>;
  paths: Map<string, { count: number; totalDuration: number }>;
}

/**
 * Simple in-memory metrics collector
 */
export class MetricsCollector {
  private metrics: RequestMetrics = {
    totalRequests: 0,
    totalDuration: 0,
    statusCodes: new Map(),
    methods: new Map(),
    paths: new Map(),
  };
  
  record(info: TraceInfo): void {
    this.metrics.totalRequests++;
    this.metrics.totalDuration += info.duration ?? 0;
    
    // Status codes
    if (info.status) {
      const count = this.metrics.statusCodes.get(info.status) ?? 0;
      this.metrics.statusCodes.set(info.status, count + 1);
    }
    
    // Methods
    const methodCount = this.metrics.methods.get(info.method) ?? 0;
    this.metrics.methods.set(info.method, methodCount + 1);
    
    // Paths (use route pattern if available)
    const pathKey = info.routePattern ?? info.path;
    const pathStats = this.metrics.paths.get(pathKey) ?? { count: 0, totalDuration: 0 };
    pathStats.count++;
    pathStats.totalDuration += info.duration ?? 0;
    this.metrics.paths.set(pathKey, pathStats);
  }
  
  getMetrics(): RequestMetrics {
    return this.metrics;
  }
  
  getAverageResponseTime(): number {
    return this.metrics.totalRequests > 0
      ? this.metrics.totalDuration / this.metrics.totalRequests
      : 0;
  }
  
  getRequestsPerSecond(windowMs: number): number {
    // This is a simplified calculation
    return this.metrics.totalRequests / (windowMs / 1000);
  }
  
  toPrometheusFormat(): string {
    const lines: string[] = [];
    
    lines.push("# HELP http_requests_total Total HTTP requests");
    lines.push("# TYPE http_requests_total counter");
    lines.push(`http_requests_total ${this.metrics.totalRequests}`);
    
    lines.push("# HELP http_request_duration_seconds HTTP request duration");
    lines.push("# TYPE http_request_duration_seconds gauge");
    lines.push(`http_request_duration_seconds_sum ${this.metrics.totalDuration / 1000}`);
    lines.push(`http_request_duration_seconds_count ${this.metrics.totalRequests}`);
    
    return lines.join("\n");
  }
  
  reset(): void {
    this.metrics = {
      totalRequests: 0,
      totalDuration: 0,
      statusCodes: new Map(),
      methods: new Map(),
      paths: new Map(),
    };
  }
}

// ===== Pretty Trace (Dev Mode) =====

/**
 * Enable pretty request logging for development
 */
export function prettyTrace(): AsiPlugin {
  return trace({
    logRequests: true,
    serverTiming: true,
    timingHeaders: true,
  });
}
