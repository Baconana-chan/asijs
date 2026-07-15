/**
 * Sessions Middleware for AsiJS
 *
 * Provides session management with pluggable stores:
 * - SessionMemoryStore: in-memory (default, for development)
 * - CookieStore: signed cookies (stateless, no server-side storage)
 *
 * @example
 * ```ts
 * import { Asi, sessions, SessionMemoryStore } from "asijs";
 *
 * const app = new Asi();
 *
 * // Use sessions middleware
 * app.use(sessions({
 *   secret: "my-secret-key",
 *   name: "app.sid",
 *   ttl: 86400, // 1 day
 * }));
 *
 * app.get("/", (ctx) => {
 *   const visits = ((ctx as any).session.get("visits") ?? 0) as number + 1;
 *   (ctx as any).session.set("visits", visits);
 *   return { visits };
 * });
 *
 * app.listen(3000);
 * ```
 */

import type { Context } from "./context";

// ===== Types =====

/** Session store interface — pluggable storage backends */
export interface SessionStore {
  /** Get session data by ID */
  get(sid: string): Promise<Record<string, unknown> | null>;
  /** Set session data with TTL (seconds) */
  set(sid: string, data: Record<string, unknown>, ttl: number): Promise<void>;
  /** Delete session by ID */
  delete(sid: string): Promise<void>;
  /** Reset TTL on existing session */
  touch(sid: string, ttl: number): Promise<void>;
}

/** Options for sessions() middleware */
export interface SessionOptions {
  /** Secret key for cookie signing (required for CookieStore, recommended for all) */
  secret: string;

  /** Cookie name (default: "session") */
  name?: string;

  /** Session TTL in seconds (default: 86400 = 1 day) */
  ttl?: number;

  /** Session store (default: SessionMemoryStore) */
  store?: SessionStore;

  /** Cookie options */
  cookie?: {
    /** Cookie path (default: "/") */
    path?: string;
    /** Cookie domain */
    domain?: string;
    /** Secure flag (default: auto-detect from request) */
    secure?: boolean;
    /** HttpOnly flag (default: true) */
    httpOnly?: boolean;
    /** SameSite (default: "Lax") */
    sameSite?: "Strict" | "Lax" | "None";
  };

  /** Generate a session ID (default: crypto.randomUUID) */
  generateId?: () => string;

  /** Called when session is created */
  onCreated?: (sid: string) => void;
}

/** Session object available via ctx.session */
export class Session {
  private data: Record<string, unknown> = {};
  private store: SessionStore;
  private sid: string;
  private ttl: number;
  private changed = false;
  private destroyed = false;

  constructor(options: {
    store: SessionStore;
    sid: string;
    ttl: number;
    data?: Record<string, unknown>;
  }) {
    this.store = options.store;
    this.sid = options.sid;
    this.ttl = options.ttl;
    this.data = options.data ?? {};
  }

  /** Get a value from the session */
  get<T = unknown>(key: string): T | undefined {
    return this.data[key] as T | undefined;
  }

  /** Set a value in the session */
  set<T = unknown>(key: string, value: T): void {
    this.data[key] = value;
    this.changed = true;
  }

  /** Delete a key from the session */
  delete(key: string): void {
    if (key in this.data) {
      delete this.data[key];
      this.changed = true;
    }
  }

  /** Clear all session data */
  clear(): void {
    const keys = Object.keys(this.data);
    if (keys.length > 0) {
      this.data = {};
      this.changed = true;
    }
  }

  /** Regenerate session ID (creates new SID, copies data) */
  async regenerate(): Promise<void> {
    const oldSid = this.sid;
    this.sid = crypto.randomUUID();

    // Copy data to new session
    await this.store.set(this.sid, { ...this.data }, this.ttl);

    // Delete old session
    await this.store.delete(oldSid);

    this.changed = false;
  }

  /** Destroy the session (delete from store) */
  async destroy(): Promise<void> {
    await this.store.delete(this.sid);
    this.data = {};
    this.changed = false;
    this.destroyed = true;
  }

  /** Get all data as plain object */
  toJSON(): Record<string, unknown> {
    return { ...this.data };
  }

  /** Get the current session ID */
  get id(): string {
    return this.sid;
  }

  /** Check if session was modified */
  get isChanged(): boolean {
    return this.changed;
  }

  /** Check if session was destroyed */
  get isDestroyed(): boolean {
    return this.destroyed;
  }

  /** Save session to store (called automatically on response) */
  async save(): Promise<void> {
    if (this.destroyed) return;
    if (this.changed) {
      await this.store.set(this.sid, this.data, this.ttl);
      this.changed = false;
    } else {
      // Just touch the TTL
      await this.store.touch(this.sid, this.ttl);
    }
  }
}

// ===== Cookie Signing Helpers =====

function base64UrlEncode(data: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...data));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  return new Uint8Array([...binary].map((c) => c.charCodeAt(0)));
}

function textEncode(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function textDecode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

async function signData(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncode(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    textEncode(data) as BufferSource,
  );
  return base64UrlEncode(new Uint8Array(signature));
}

async function verifySignature(
  data: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      textEncode(secret) as BufferSource,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const sigBytes = base64UrlDecode(signature);
    return crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes as BufferSource,
      textEncode(data) as BufferSource,
    );
  } catch {
    return false;
  }
}

// ===== MemoryStore =====

interface MemoryEntry {
  data: Record<string, unknown>;
  expires: number;
}

/**
 * In-memory session store with automatic TTL cleanup.
 *
 * Sessions are stored in a Map with expiry timestamps.
 * A periodic cleanup interval removes expired entries.
 *
 * @example
 * ```ts
 * const store = new SessionMemoryStore();
 * store.startCleanup(); // Start periodic cleanup (optional)
 *
 * app.use(sessions({
 *   secret: "key",
 *   store, // Use custom store instance
 * }));
 * ```
 */
export class SessionMemoryStore implements SessionStore {
  private store = new Map<string, MemoryEntry>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  async get(sid: string): Promise<Record<string, unknown> | null> {
    const entry = this.store.get(sid);
    if (!entry) return null;

    // Check expiry
    if (entry.expires < Date.now()) {
      this.store.delete(sid);
      return null;
    }

    return { ...entry.data };
  }

  async set(
    sid: string,
    data: Record<string, unknown>,
    ttl: number,
  ): Promise<void> {
    this.store.set(sid, {
      data: { ...data },
      expires: Date.now() + ttl * 1000,
    });
  }

  async delete(sid: string): Promise<void> {
    this.store.delete(sid);
  }

  async touch(sid: string, ttl: number): Promise<void> {
    const entry = this.store.get(sid);
    if (entry) {
      entry.expires = Date.now() + ttl * 1000;
    }
  }

  /** Get the number of active sessions */
  get size(): number {
    return this.store.size;
  }

  /**
   * Start periodic cleanup of expired sessions.
   * @param intervalMs Cleanup interval (default: 60000 = 1 minute)
   */
  startCleanup(intervalMs = 60000): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [sid, entry] of this.store) {
        if (entry.expires < now) {
          this.store.delete(sid);
        }
      }
    }, intervalMs);

    // Allow the process to exit even if the timer is still running
    if (this.cleanupTimer && typeof this.cleanupTimer === "object") {
      (this.cleanupTimer as any).unref?.();
    }
  }

  /** Stop periodic cleanup */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

// ===== CookieStore =====

/**
 * Cookie-based session store (stateless).
 *
 * Serializes session data into a signed cookie. No server-side storage
 * needed. The cookie value is: `base64(json) "." signature`
 *
 * Limitations:
 * - Max cookie size (~4KB) limits session data
 * - All session data is sent on every request
 * - Not suitable for sensitive data (only integrity, not confidentiality)
 *
 * @example
 * ```ts
 * app.use(sessions({
 *   secret: "my-secret",
 *   store: new CookieStore({ secret: "my-secret" }),
 * }));
 * ```
 */
export class CookieStore implements SessionStore {
  private secret: string;

  constructor(options: { secret: string }) {
    this.secret = options.secret;
  }

  /**
   * Parse and verify a signed cookie value.
   * The `sid` parameter is the raw cookie value (not used as lookup key).
   */
  async get(sid: string): Promise<Record<string, unknown> | null> {
    if (!sid) return null;

    // Format: <base64-payload>.<base64-signature>
    const dotIdx = sid.lastIndexOf(".");
    if (dotIdx <= 0) return null;

    const payload = sid.slice(0, dotIdx);
    const signature = sid.slice(dotIdx + 1);

    // Verify signature
    const valid = await verifySignature(payload, signature, this.secret);
    if (!valid) return null;

    // Decode payload
    try {
      const json = textDecode(base64UrlDecode(payload));
      return JSON.parse(json) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /**
   * Serialize session data into a signed cookie.
   * The `sid` parameter is ignored — all data goes into the cookie value.
   */
  async set(
    _sid: string,
    data: Record<string, unknown>,
    _ttl: number,
  ): Promise<void> {
    // Nothing to do — the cookie value is written as Set-Cookie header
    // by the middleware, not stored server-side
  }

  /** Delete session — cookie is cleared by the middleware */
  async delete(_sid: string): Promise<void> {
    // Nothing to do — cookie will be cleared by middleware via Set-Cookie: maxAge=0
  }

  /** Touch — no-op for cookie store (no server-side expiry) */
  async touch(_sid: string, _ttl: number): Promise<void> {
    // Cookie TTL is managed by the Set-Cookie Max-Age
  }

  /**
   * Encode session data into a signed cookie string.
   * Called internally by the middleware.
   */
  async encode(data: Record<string, unknown>): Promise<string> {
    const payload = base64UrlEncode(textEncode(JSON.stringify(data)));
    const signature = await signData(payload, this.secret);
    return `${payload}.${signature}`;
  }

  /**
   * Generate an empty signed session cookie value (for new sessions).
   */
  async emptyCookie(): Promise<string> {
    return this.encode({});
  }
}

// ===== RedisSessionStore =====

let ioredisModule: any = null;

async function ensureRedis(): Promise<boolean> {
  if (ioredisModule) return true;
  try {
    ioredisModule = await import("ioredis");
    return true;
  } catch {
    return false;
  }
}

/** Minimal interface for Redis-like clients (ioredis, @upstash/redis, etc.) */
export interface RedisLikeClient {
  get(key: string): Promise<string | Buffer | null>;
  set(key: string, value: string): Promise<unknown>;
  setex?(key: string, ttl: number, value: string): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  expire?(key: string, ttl: number): Promise<number>;
}

/**
 * Redis-backed session store for production use.
 *
 * Uses Redis SETEX/GET/DEL/EXPIRE for session storage with automatic TTL.
 * Requires the `ioredis` package to be installed (optional dependency).
 *
 * Accepts any Redis-compatible client with `get`, `set`, `del`, `expire`
 * methods, so it works with both `ioredis` and `@upstash/redis`.
 *
 * @example with ioredis
 * ```ts
 * import { Redis } from "ioredis";
 * const redis = new Redis({ host: "localhost", port: 6379 });
 *
 * app.use(sessions({
 *   secret: "my-secret",
 *   store: new RedisSessionStore({ client: redis }),
 * }));
 * ```
 *
 * @example with @upstash/redis
 * ```ts
 * import { Redis } from "@upstash/redis";
 * const redis = new Redis({ url: "...", token: "..." });
 *
 * app.use(sessions({
 *   secret: "my-secret",
 *   store: new RedisSessionStore({ client: redis }),
 * }));
 * ```
 */
export class RedisSessionStore implements SessionStore {
  private client: RedisLikeClient;

  constructor(options: {
    /** Redis client instance (ioredis, @upstash/redis, or compatible) */
    client: RedisLikeClient;
  }) {
    this.client = options.client;
  }

  async get(sid: string): Promise<Record<string, unknown> | null> {
    try {
      const raw = await this.client.get(sid);
      if (!raw) return null;
      const str = typeof raw === "string" ? raw : raw.toString();
      return JSON.parse(str) as Record<string, unknown>;
    } catch (err) {
      console.warn("[Asi RedisSessionStore] get error:", err);
      return null;
    }
  }

  async set(
    sid: string,
    data: Record<string, unknown>,
    ttl: number,
  ): Promise<void> {
    try {
      const serialized = JSON.stringify(data);
      // Prefer setex (atomic SET + EXPIRE), fallback to set + expire
      if (typeof this.client.setex === "function") {
        await this.client.setex(sid, ttl, serialized);
      } else {
        await this.client.set(sid, serialized);
        if (typeof this.client.expire === "function") {
          await this.client.expire(sid, ttl);
        }
      }
    } catch (err) {
      console.warn("[Asi RedisSessionStore] set error:", err);
    }
  }

  async delete(sid: string): Promise<void> {
    try {
      await this.client.del(sid);
    } catch (err) {
      console.warn("[Asi RedisSessionStore] delete error:", err);
    }
  }

  async touch(sid: string, ttl: number): Promise<void> {
    try {
      if (typeof this.client.expire === "function") {
        await this.client.expire(sid, ttl);
      }
    } catch (err) {
      console.warn("[Asi RedisSessionStore] touch error:", err);
    }
  }

  /**
   * Create a RedisSessionStore that auto-connects using ioredis.
   * Useful for quick setup without manually creating a Redis client.
   *
   * @example
   * ```ts
   * const store = await RedisSessionStore.connect({ host: "localhost", port: 6379 });
   * app.use(sessions({ secret: "key", store }));
   * ```
   */
  static async connect(
    options: {
      host?: string;
      port?: number;
      url?: string;
      username?: string;
      password?: string;
      db?: number;
      tls?: boolean;
      maxRetriesPerRequest?: number;
      enableReadyCheck?: boolean;
      lazyConnect?: boolean;
      retryStrategy?: (times: number) => number | void | null;
    } = {},
  ): Promise<RedisSessionStore> {
    const loaded = await ensureRedis();
    if (!loaded) {
      throw new Error(
        "RedisSessionStore.connect() requires the 'ioredis' package to be installed. " +
          "Run: bun add ioredis",
      );
    }

    const Redis = ioredisModule.default || ioredisModule.Redis;
    const client = new Redis(options);
    return new RedisSessionStore({ client });
  }
}

// ===== Sessions Middleware Factory =====

/**
 * Create session middleware.
 *
 * Adds `ctx.session` to every request. The session is automatically
 * loaded from the store on request and saved on response.
 *
 * @example
 * ```ts
 * import { Asi, sessions, SessionMemoryStore } from "asijs";
 *
 * const app = new Asi();
 *
 * // Basic usage (SessionMemoryStore default)
 * app.use(sessions({ secret: "my-secret" }));
 *
 * // Custom store
 * const store = new SessionMemoryStore();
 * store.startCleanup();
 * app.use(sessions({ secret: "key", store }));
 *
 * // Cookie store (stateless, all data in signed cookie)
 * app.use(sessions({
 *   secret: "key",
 *   store: new CookieStore({ secret: "key" }),
 * }));
 *
 * // Redis store (production, distributed)
 * import { Redis } from "ioredis";
 * const redis = new Redis();
 * app.use(sessions({
 *   secret: "key",
 *   store: new RedisSessionStore({ client: redis }),
 * }));
 *
 * app.get("/counter", (ctx) => {
 *   const session = (ctx as any).session;
 *   const count = (session.get("count") ?? 0) as number + 1;
 *   session.set("count", count);
 *   return { count };
 * });
 * ```
 */
export function sessions(options: SessionOptions) {
  const {
    secret,
    name = "session",
    ttl = 86400, // 1 day
    cookie: cookieOpts,
    generateId = () => crypto.randomUUID(),
    onCreated,
  } = options;

  // Determine store
  const store: SessionStore = options.store ?? new SessionMemoryStore();

  // Auto-start cleanup for default store
  if (!options.store) {
    (store as SessionMemoryStore).startCleanup();
  }

  // Middleware
  return async (ctx: Context, next: () => Promise<Response>): Promise<Response> => {
    // Parse session cookie
    const rawCookie = ctx.cookie(name) ?? null;

    // Load session data from store
    let sid: string;
    let data: Record<string, unknown> | null = null;

    if (rawCookie) {
      // Existing session — load from store
      sid = rawCookie;
      data = await store.get(rawCookie);

      if (!data) {
        // Session expired or invalid — create new
        sid = generateId();
        onCreated?.(sid);
      }
    } else {
      // No session cookie — create new
      sid = generateId();
      onCreated?.(sid);
    }

    // Create Session object
    const session = new Session({
      store,
      sid,
      ttl,
      data: data ?? {},
    });

    // Attach to context
    Object.defineProperty(ctx, "session", {
      get: () => session,
      configurable: true,
      enumerable: true,
    });

    // Execute the handler
    const response = await next();

    if (session.isDestroyed) {
      // Session was destroyed — clear cookie
      ctx.deleteCookie(name, { path: cookieOpts?.path ?? "/" });
    } else {
      // Save session
      await session.save();

      // Determine cookie value
      let cookieValue: string;
      if (store instanceof CookieStore) {
        cookieValue = await store.encode(session.toJSON());
      } else {
        cookieValue = sid;
      }

      // Set session cookie
      ctx.setCookie(name, cookieValue, {
        maxAge: ttl,
        path: cookieOpts?.path ?? "/",
        domain: cookieOpts?.domain,
        secure: cookieOpts?.secure,
        httpOnly: cookieOpts?.httpOnly ?? true,
        sameSite: cookieOpts?.sameSite ?? "Lax",
      });
    }

    return response;
  };
}
