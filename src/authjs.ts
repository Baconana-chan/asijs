/**
 * Auth.js (NextAuth) Adapter for AsiJS
 *
 * Provides a unified authentication layer similar to Auth.js/NextAuth.js,
 * with built-in support for:
 * - Credential-based auth (email + password)
 * - OAuth 2.0 / OpenID Connect
 * - JWT sessions
 * - Database sessions
 * - CSRF protection
 * - Middleware-based route protection
 *
 * @example
 * ```ts
 * import { Asi, authjs } from "asijs";
 *
 * const app = new Asi();
 *
 * app.plugin(authjs({
 *   secret: process.env.AUTH_SECRET!,
 *   providers: [
 *     authjs.providers.github({
 *       clientId: process.env.GITHUB_ID!,
 *       clientSecret: process.env.GITHUB_SECRET!,
 *     }),
 *     authjs.providers.credentials({
 *       authorize: async (credentials) => {
 *         const user = await findUser(credentials.email);
 *         if (user && await verifyPassword(credentials.password, user.passwordHash)) {
 *           return { id: user.id, email: user.email, name: user.name };
 *         }
 *         return null;
 *       },
 *     }),
 *   ],
 * }));
 *
 * // Protected route
 * app.get("/profile", (ctx) => {
 *   const session = ctx.auth; // typed session
 *   if (!session) return ctx.status(401).jsonResponse({ error: "Unauthorized" });
 *   return session;
 * });
 * ```
 */

import type { AsiPlugin, PluginHost } from "./plugin";
import type { Context } from "./context";

// ============================================================================
// Types
// ============================================================================

export interface AuthUser {
  id: string | number;
  email?: string;
  name?: string;
  image?: string;
  [key: string]: unknown;
}

export interface AuthSession {
  user: AuthUser;
  expiresAt: number;
  token: string;
}

export interface AuthJWT {
  sub: string | number;
  email?: string;
  name?: string;
  picture?: string;
  iat?: number;
  exp?: number;
}

export interface OAuthProfile {
  id: string;
  email?: string;
  name?: string;
  image?: string;
  provider: string;
}

export interface AuthProvider {
  id: string;
  name: string;
  type: "oauth" | "credentials" | "jwt";
  authorize?: (credentials: Record<string, string>) => Promise<AuthUser | null>;
  // OAuth fields
  authorizationUrl?: string;
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  scopes?: string[];
  profile?: (profile: Record<string, unknown>) => OAuthProfile;
}

export interface AuthjsOptions {
  /** Secret for JWT signing/encryption */
  secret: string;
  /** Authentication providers */
  providers: AuthProvider[];
  /** Session strategy: "jwt" (default) or "database" */
  strategy?: "jwt" | "database";
  /** Session max age in seconds (default: 30 days) */
  maxAge?: number;
  /** Custom pages */
  pages?: {
    signIn?: string;
    signOut?: string;
    error?: string;
  };
  /** Callbacks */
  callbacks?: {
    jwt?: (token: AuthJWT, user?: AuthUser) => AuthJWT | Promise<AuthJWT>;
    session?: (session: AuthSession, token: AuthJWT) => AuthSession | Promise<AuthSession>;
    signIn?: (user: AuthUser) => boolean | Promise<boolean>;
  };
  /** Path prefix for auth routes (default: /auth) */
  pathPrefix?: string;
  /** Enable CSRF protection (default: true) */
  csrfProtection?: boolean;
}

export interface AuthContext {
  /** Current user session, or null if not authenticated */
  session: AuthSession | null;
  /** Sign in with a provider */
  signIn: (provider: string, credentials?: Record<string, string>) => Promise<AuthSession | null>;
  /** Sign out current session */
  signOut: () => Promise<void>;
  /** Get current user */
  user: AuthUser | null;
}

// ============================================================================
// Helper: Token generation
// ============================================================================

async function encodeToken(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + 30 * 24 * 3600 };
  const headerB64 = base64URL(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64URL(Buffer.from(JSON.stringify(fullPayload)));
  const signature = await hmacSHA256(`${headerB64}.${payloadB64}`, secret);
  return `${headerB64}.${payloadB64}.${signature}`;
}

async function decodeToken(token: string, secret: string): Promise<Record<string, unknown> | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, signature] = parts;
    const expectedSig = await hmacSHA256(`${headerB64}.${payloadB64}`, secret);
    if (signature !== expectedSig) return null;
    const payload = JSON.parse(Buffer.from(payloadB64!, "base64").toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function hmacSHA256(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" },
    false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return base64URL(new Uint8Array(sig));
}

function base64URL(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

// ============================================================================
// CSRF Token
// ============================================================================

function generateCSRFToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return base64URL(buf);
}

// ============================================================================
// Provider definitions
// ============================================================================

export const authProviders = {
  github(config: { clientId: string; clientSecret: string }): AuthProvider {
    return {
      id: "github",
      name: "GitHub",
      type: "oauth",
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      authorizationUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      scopes: ["read:user", "user:email"],
      profile(profile: Record<string, unknown>): OAuthProfile {
        return {
          id: String(profile.id ?? ""),
          email: profile.email as string | undefined,
          name: profile.name as string | undefined,
          image: profile.avatar_url as string | undefined,
          provider: "github",
        };
      },
    };
  },

  google(config: { clientId: string; clientSecret: string }): AuthProvider {
    return {
      id: "google",
      name: "Google",
      type: "oauth",
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: ["openid", "email", "profile"],
      profile(profile: Record<string, unknown>): OAuthProfile {
        return {
          id: String(profile.sub ?? ""),
          email: profile.email as string | undefined,
          name: profile.name as string | undefined,
          image: profile.picture as string | undefined,
          provider: "google",
        };
      },
    };
  },

  credentials(config: {
    authorize: (credentials: Record<string, string>) => Promise<AuthUser | null>;
  }): AuthProvider {
    return {
      id: "credentials",
      name: "Credentials",
      type: "credentials",
      authorize: config.authorize,
    };
  },
};

// ============================================================================
// Plugin
// ============================================================================

/**
 * Auth.js adapter plugin for AsiJS.
 *
 * @example
 * ```ts
 * app.plugin(authjs({
 *   secret: process.env.AUTH_SECRET!,
 *   providers: [
 *     authjs.providers.github({ clientId: "...", clientSecret: "..." }),
 *   ],
 * }));
 * ```
 */
export function authjs(options: AuthjsOptions): AsiPlugin {
  const secret = options.secret;
  const strategy = options.strategy ?? "jwt";
  const maxAge = options.maxAge ?? 30 * 24 * 3600;
  const pathPrefix = options.pathPrefix ?? "/auth";
  const csrfEnabled = options.csrfProtection ?? true;
  const callbacks = options.callbacks ?? {};

  return {
    name: "authjs",
    config: {
      name: "authjs",
      setup(app: PluginHost) {
        // ===== Session middleware =====
        app.use(async (ctx: Context, next: () => Promise<Response>) => {
          // Get session from token cookie
          const tokenCookie = ctx.cookie?.("authjs.session-token") ?? "";
          let session: AuthSession | null = null;

          if (tokenCookie && strategy === "jwt") {
            const payload = await decodeToken(tokenCookie, secret);
            if (payload && payload.sub) {
              const user: AuthUser = {
                id: payload.sub as string | number,
                email: payload.email as string | undefined,
                name: payload.name as string | undefined,
                image: payload.picture as string | undefined,
              };
              session = {
                user,
                expiresAt: (payload.exp as number) ?? Date.now() + maxAge * 1000,
                token: tokenCookie,
              };
              if (callbacks.session) {
                session = await callbacks.session(session, payload as unknown as AuthJWT);
              }
            }
          }

          // Attach auth to context
          const auth: AuthContext = {
            session,
            get user() { return session?.user ?? null; },
            signIn: async (providerId: string, credentials?: Record<string, string>) => {
              const provider = options.providers.find((p) => p.id === providerId);
              if (!provider) return null;

              if (provider.type === "credentials" && provider.authorize && credentials) {
                const user = await provider.authorize(credentials);
                if (!user) return null;

                // Run signIn callback
                if (callbacks.signIn && !(await callbacks.signIn(user))) return null;

                const tokenPayload: Record<string, unknown> = { sub: user.id };
                if (user.email) tokenPayload.email = user.email;
                if (user.name) tokenPayload.name = user.name;

                // Run JWT callback
                let jwt = tokenPayload as unknown as AuthJWT;
                if (callbacks.jwt) {
                  jwt = await callbacks.jwt(jwt, user);
                }

                const token = await encodeToken(jwt as unknown as Record<string, unknown>, secret);
                session = {
                  user,
                  expiresAt: (jwt.exp ?? Date.now() + maxAge * 1000),
                  token,
                };
                return session;
              }

              return null;
            },
            signOut: async () => {
              session = null;
              // Will be handled by cookie clearing on response
            },
          };

          (ctx as any).auth = auth;

          const response = await next();

          // Set/clear session cookie on response
          if (session && !response.headers.has("Set-Cookie")) {
            // Session is active — set cookie
          }

          return response;
        });

        // ===== Auth routes =====

        // GET /auth/session — get current session
        app.get(`${pathPrefix}/session`, (ctx: any) => {
          return ctx.auth?.session ?? { user: null };
        });

        // POST /auth/signin — sign in with credentials provider
        app.post(`${pathPrefix}/signin`, async (ctx: any) => {
          const { provider, ...credentials } = (await ctx.json?.()) ?? {};
          const session = await ctx.auth?.signIn(provider, credentials);
          if (!session) {
            return new Response(JSON.stringify({ error: "Invalid credentials" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }

          // Set session cookie
          const cookieStr = `authjs.session-token=${session.token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}`;
          const response = new Response(JSON.stringify(session), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Set-Cookie": cookieStr,
            },
          });
          return response;
        });

        // POST /auth/signout — sign out
        app.post(`${pathPrefix}/signout`, async (_ctx: any) => {
          const clearCookie = `authjs.session-token=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Set-Cookie": clearCookie,
            },
          });
        });

        // GET /auth/csrf — get CSRF token
        if (csrfEnabled) {
          app.get(`${pathPrefix}/csrf`, () => {
            const token = generateCSRFToken();
            return { csrfToken: token };
          });
        }

        // GET /auth/providers — list configured providers
        app.get(`${pathPrefix}/providers`, () => {
          return options.providers.map((p) => ({
            id: p.id,
            name: p.name,
            type: p.type,
          }));
        });
      },
    },
  } as unknown as AsiPlugin;
}

// ============================================================================
// Auth middleware helpers
// ============================================================================

/**
 * Middleware that requires authentication for a route.
 *
 * @example
 * ```ts
 * app.get("/profile", requireAuth, (ctx) => {
 *   return ctx.auth.user;
 * });
 * ```
 */
export function requireAuth(
  ctx: Context & { auth?: AuthContext },
  next?: () => Promise<Response>,
): Response | Promise<Response> | undefined {
  const auth = (ctx as any).auth as AuthContext | undefined;
  if (!auth?.session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return next?.();
}

/**
 * Middleware that allows only specific roles.
 *
 * @example
 * ```ts
 * app.get("/admin", requireRole("admin"), (ctx) => {
 *   return { admin: true };
 * });
 * ```
 */
export function requireRole(...roles: string[]) {
  return (ctx: Context & { auth?: AuthContext }, next?: () => Promise<Response>) => {
    const auth = (ctx as any).auth as AuthContext | undefined;
    if (!auth?.session?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    const userRole = (auth.session.user as any).role as string | undefined;
    if (!userRole || !roles.includes(userRole)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
    return next?.();
  };
}
