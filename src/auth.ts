/**
 * JWT & Auth Helpers for AsiJS
 *
 * Provides JWT signing/verification, Bearer auth middleware,
 * and common authentication patterns.
 *
 * @example
 * ```ts
 * import { Asi, jwt, bearer, auth } from "asijs";
 *
 * const app = new Asi();
 *
 * // Create JWT helper
 * const jwtHelper = jwt({ secret: process.env.JWT_SECRET! });
 *
 * // Login route
 * app.post("/login", async (ctx) => {
 *   const { email, password } = await ctx.json();
 *   // ... validate credentials ...
 *   const token = await jwtHelper.sign({ userId: "123", role: "admin" });
 *   return { token };
 * });
 *
 * // Protected routes
 * app.group("/api", (api) => {
 *   api.use(bearer({ jwt: jwtHelper }));
 *   api.get("/profile", (ctx) => {
 *     const payload = ctx.store.jwtPayload;
 *     return { userId: payload.userId };
 *   });
 * });
 * ```
 */

import { createPlugin, type AsiPlugin } from "./plugin";
import type { BeforeHandler, Middleware } from "./types";
import type { Context } from "./context";

// ===== Types =====

export interface JWTOptions {
  /** Secret key for HS256/HS384/HS512 */
  secret?: string;

  /** Algorithm to use */
  algorithm?: "HS256" | "HS384" | "HS512";

  /** Token expiration time (e.g., "1h", "7d", "30m") or seconds */
  expiresIn?: string | number;

  /** Token issuer */
  issuer?: string;

  /** Token audience */
  audience?: string | string[];

  /** Clock tolerance in seconds for exp/nbf validation */
  clockTolerance?: number;
}

export interface JWTPayload {
  /** Subject (usually user ID) */
  sub?: string;
  /** Issuer */
  iss?: string;
  /** Audience */
  aud?: string | string[];
  /** Expiration time (Unix timestamp) */
  exp?: number;
  /** Not before (Unix timestamp) */
  nbf?: number;
  /** Issued at (Unix timestamp) */
  iat?: number;
  /** JWT ID */
  jti?: string;
  /** Custom claims */
  [key: string]: unknown;
}

export interface JWTHeader {
  alg: string;
  typ: "JWT";
}

export interface JWTHelper {
  /** Sign a payload and return a JWT token */
  sign(payload: JWTPayload): Promise<string>;

  /** Verify a token and return the payload */
  verify(token: string): Promise<JWTPayload>;

  /** Decode a token without verification (unsafe!) */
  decode(token: string): { header: JWTHeader; payload: JWTPayload } | null;
}

export interface BearerOptions {
  /** JWT helper instance */
  jwt: JWTHelper;

  /** Header name to look for the token */
  header?: string;

  /** Cookie name to look for the token (fallback) */
  cookie?: string;

  /** Query parameter name to look for the token (fallback) */
  query?: string;

  /** Key to store the payload in ctx.store */
  storeKey?: string;

  /** Custom error handler */
  onError?: (ctx: Context, error: Error) => Response | Promise<Response>;

  /** Skip authentication for certain requests */
  skip?: (ctx: Context) => boolean | Promise<boolean>;
}

// ===== JWT Implementation =====

function base64UrlEncode(data: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...data));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  // Add padding
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  return new Uint8Array([...binary].map((c) => c.charCodeAt(0)));
}

function jsonEncode(obj: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(obj)));
}

function jsonDecode<T>(str: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(str)));
}

async function createHmacKey(
  secret: string,
  algorithm: string,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);

  const hashAlg =
    algorithm === "HS384"
      ? "SHA-384"
      : algorithm === "HS512"
        ? "SHA-512"
        : "SHA-256";

  return crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: hashAlg },
    false,
    ["sign", "verify"],
  );
}

async function hmacSign(data: string, key: CryptoKey): Promise<string> {
  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return base64UrlEncode(new Uint8Array(signature));
}

async function hmacVerify(
  data: string,
  signature: string,
  key: CryptoKey,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const signatureBytes = base64UrlDecode(signature);
  return crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes as BufferSource,
    encoder.encode(data),
  );
}

function parseExpiresIn(expiresIn: string | number): number {
  if (typeof expiresIn === "number") {
    return expiresIn;
  }

  const match = expiresIn.match(/^(\d+)(s|m|h|d|w)$/);
  if (!match) {
    throw new Error(`Invalid expiresIn format: ${expiresIn}`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case "s":
      return value;
    case "m":
      return value * 60;
    case "h":
      return value * 3600;
    case "d":
      return value * 86400;
    case "w":
      return value * 604800;
    default:
      return value;
  }
}

// ===== JWT Helper Factory =====

/**
 * Create a JWT helper with the given options
 *
 * @example
 * ```ts
 * const jwtHelper = jwt({
 *   secret: process.env.JWT_SECRET!,
 *   expiresIn: "7d",
 *   issuer: "my-app",
 * });
 *
 * const token = await jwtHelper.sign({ userId: "123" });
 * const payload = await jwtHelper.verify(token);
 * ```
 */
export function jwt(options: JWTOptions): JWTHelper {
  const {
    secret,
    algorithm = "HS256",
    expiresIn,
    issuer,
    audience,
    clockTolerance = 0,
  } = options;

  if (!secret) {
    throw new Error("JWT secret is required");
  }

  let keyPromise: Promise<CryptoKey> | null = null;

  const getKey = async (): Promise<CryptoKey> => {
    if (!keyPromise) {
      keyPromise = createHmacKey(secret, algorithm);
    }
    return keyPromise;
  };

  return {
    async sign(payload: JWTPayload): Promise<string> {
      const now = Math.floor(Date.now() / 1000);

      const claims: JWTPayload = {
        ...payload,
        iat: payload.iat ?? now,
      };

      if (expiresIn && !payload.exp) {
        claims.exp = now + parseExpiresIn(expiresIn);
      }

      if (issuer && !payload.iss) {
        claims.iss = issuer;
      }

      if (audience && !payload.aud) {
        claims.aud = audience;
      }

      const header: JWTHeader = { alg: algorithm, typ: "JWT" };
      const headerEncoded = jsonEncode(header);
      const payloadEncoded = jsonEncode(claims);

      const data = `${headerEncoded}.${payloadEncoded}`;
      const key = await getKey();
      const signature = await hmacSign(data, key);

      return `${data}.${signature}`;
    },

    async verify(token: string): Promise<JWTPayload> {
      const parts = token.split(".");
      if (parts.length !== 3) {
        throw new Error("Invalid JWT format");
      }

      const [headerEncoded, payloadEncoded, signature] = parts;

      // Verify signature
      const data = `${headerEncoded}.${payloadEncoded}`;
      const key = await getKey();
      const valid = await hmacVerify(data, signature, key);

      if (!valid) {
        throw new Error("Invalid JWT signature");
      }

      // Decode and validate
      const header = jsonDecode<JWTHeader>(headerEncoded);
      const payload = jsonDecode<JWTPayload>(payloadEncoded);

      if (header.alg !== algorithm) {
        throw new Error(
          `Invalid algorithm: expected ${algorithm}, got ${header.alg}`,
        );
      }

      const now = Math.floor(Date.now() / 1000);

      // Check expiration
      if (payload.exp !== undefined && now > payload.exp + clockTolerance) {
        throw new Error("JWT has expired");
      }

      // Check not before
      if (payload.nbf !== undefined && now < payload.nbf - clockTolerance) {
        throw new Error("JWT is not yet valid");
      }

      // Check issuer
      if (issuer && payload.iss !== issuer) {
        throw new Error(
          `Invalid issuer: expected ${issuer}, got ${payload.iss}`,
        );
      }

      // Check audience
      if (audience) {
        const aud = Array.isArray(audience) ? audience : [audience];
        const payloadAud = Array.isArray(payload.aud)
          ? payload.aud
          : [payload.aud];
        const hasValidAudience = aud.some((a) => payloadAud.includes(a));
        if (!hasValidAudience) {
          throw new Error("Invalid audience");
        }
      }

      return payload;
    },

    decode(token: string): { header: JWTHeader; payload: JWTPayload } | null {
      try {
        const parts = token.split(".");
        if (parts.length !== 3) return null;

        return {
          header: jsonDecode<JWTHeader>(parts[0]),
          payload: jsonDecode<JWTPayload>(parts[1]),
        };
      } catch {
        return null;
      }
    },
  };
}

// ===== Bearer Auth Middleware =====

/**
 * Create Bearer authentication middleware
 *
 * @example
 * ```ts
 * const jwtHelper = jwt({ secret: "..." });
 *
 * // As beforeHandle
 * app.get("/protected", handler, {
 *   beforeHandle: bearer({ jwt: jwtHelper })
 * });
 *
 * // As middleware for group
 * app.group("/api", (api) => {
 *   api.use(bearerMiddleware({ jwt: jwtHelper }));
 *   api.get("/me", ...);
 * });
 * ```
 */
export function bearer(options: BearerOptions): BeforeHandler {
  const {
    jwt: jwtHelper,
    header = "Authorization",
    cookie,
    query,
    storeKey = "jwtPayload",
    onError,
    skip,
  } = options;

  return async (ctx: Context): Promise<void | Response> => {
    // Skip if configured
    if (skip && (await skip(ctx))) {
      return;
    }

    let token: string | null = null;

    // Try Authorization header
    const authHeader = ctx.header(header);
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.slice(7);
    }

    // Try cookie fallback
    if (!token && cookie) {
      token = ctx.cookie(cookie) ?? null;
    }

    // Try query fallback
    if (!token && query) {
      token = (ctx.query[query] as string) ?? null;
    }

    if (!token) {
      const error = new Error("No authorization token provided");
      if (onError) {
        return onError(ctx, error);
      }
      return new Response(
        JSON.stringify({
          error: "Unauthorized",
          message: "No authorization token provided",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    try {
      const payload = await jwtHelper.verify(token);
      ctx.store[storeKey] = payload;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (onError) {
        return onError(ctx, error);
      }
      return new Response(
        JSON.stringify({
          error: "Unauthorized",
          message: error.message,
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  };
}

/**
 * Create Bearer authentication as middleware
 */
export function bearerMiddleware(options: BearerOptions): Middleware {
  const beforeHandle = bearer(options);

  return async (ctx, next) => {
    const result = await beforeHandle(ctx);
    if (result instanceof Response) {
      return result;
    }
    return next();
  };
}

// ===== Auth Plugin =====

/**
 * Create authentication plugin with JWT support
 *
 * @example
 * ```ts
 * app.plugin(auth({
 *   secret: process.env.JWT_SECRET!,
 *   expiresIn: "7d",
 *   exclude: ["/login", "/register", "/public/*"],
 * }));
 * ```
 */
export function auth(
  options: JWTOptions & {
    /** Paths to exclude from authentication */
    exclude?: string[];
    /** Cookie name for token (optional) */
    cookie?: string;
  },
): AsiPlugin {
  const jwtHelper = jwt(options);
  const excludePaths = options.exclude ?? [];

  const skip = (ctx: Context): boolean => {
    const path = ctx.path;
    return excludePaths.some((pattern) => {
      if (pattern.endsWith("/*")) {
        return path.startsWith(pattern.slice(0, -2));
      }
      return path === pattern;
    });
  };

  return createPlugin({
    name: "auth",

    decorate: {
      jwt: jwtHelper,
    },

    beforeHandle: bearer({
      jwt: jwtHelper,
      cookie: options.cookie,
      skip,
    }),
  });
}

// ===== Utility Functions =====

/**
 * Hash a password using Bun's built-in hasher
 */
export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, {
    algorithm: "argon2id",
    memoryCost: 4,
    timeCost: 3,
  });
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return Bun.password.verify(password, hash);
}

/**
 * Generate a secure random token
 */
export function generateToken(length = 32): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/**
 * Generate a CSRF token
 */
export function generateCsrfToken(): string {
  return generateToken(32);
}

/**
 * Create a CSRF protection middleware
 */
export function csrf(
  options: {
    /** Cookie name for CSRF token */
    cookie?: string;
    /** Header name for CSRF token */
    header?: string;
    /** Methods to protect */
    methods?: string[];
  } = {},
): BeforeHandler {
  const {
    cookie = "_csrf",
    header = "X-CSRF-Token",
    methods = ["POST", "PUT", "PATCH", "DELETE"],
  } = options;

  return async (ctx: Context): Promise<void | Response> => {
    // Skip safe methods
    if (!methods.includes(ctx.method)) {
      return;
    }

    const cookieToken = ctx.cookie(cookie);
    const headerToken = ctx.header(header);

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      return new Response(
        JSON.stringify({
          error: "Forbidden",
          message: "Invalid CSRF token",
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  };
}
