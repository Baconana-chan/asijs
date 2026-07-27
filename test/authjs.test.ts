import { describe, expect, it } from "bun:test";
import { Asi } from "../src";
import {
  authjs,
  authProviders,
  authjsRequireAuth,
  requireRole,
} from "../src";
import type { AuthUser, AuthSession } from "../src";

// ============================================================================
// Auth Providers
// ============================================================================

describe("authProviders", () => {
  it("github() returns correct provider shape", () => {
    const p = authProviders.github({
      clientId: "gh-id",
      clientSecret: "gh-secret",
    });
    expect(p.id).toBe("github");
    expect(p.name).toBe("GitHub");
    expect(p.type).toBe("oauth");
    expect(p.clientId).toBe("gh-id");
    expect(p.clientSecret).toBe("gh-secret");
    expect(p.scopes).toContain("read:user");
    expect(p.authorizationUrl).toContain("github.com");
    expect(p.tokenUrl).toContain("github.com");
  });

  it("github() profile maps fields correctly", () => {
    const p = authProviders.github({
      clientId: "id",
      clientSecret: "secret",
    });
    const profile = p.profile!({
      id: 12345,
      email: "user@github.com",
      name: "Test User",
      avatar_url: "https://avatars.githubusercontent.com/u/12345",
    });
    expect(profile.id).toBe("12345");
    expect(profile.email).toBe("user@github.com");
    expect(profile.name).toBe("Test User");
    expect(profile.image).toBe(
      "https://avatars.githubusercontent.com/u/12345",
    );
    expect(profile.provider).toBe("github");
  });

  it("google() returns correct provider shape", () => {
    const p = authProviders.google({
      clientId: "google-id",
      clientSecret: "google-secret",
    });
    expect(p.id).toBe("google");
    expect(p.name).toBe("Google");
    expect(p.type).toBe("oauth");
    expect(p.scopes).toEqual(["openid", "email", "profile"]);
  });

  it("google() profile maps fields correctly", () => {
    const p = authProviders.google({
      clientId: "id",
      clientSecret: "secret",
    });
    const profile = p.profile!({
      sub: "abc123",
      email: "user@gmail.com",
      name: "Google User",
      picture: "https://lh3.googleusercontent.com/a/photo",
    });
    expect(profile.id).toBe("abc123");
    expect(profile.email).toBe("user@gmail.com");
    expect(profile.name).toBe("Google User");
    expect(profile.image).toBe(
      "https://lh3.googleusercontent.com/a/photo",
    );
    expect(profile.provider).toBe("google");
  });

  it("credentials() returns correct provider shape", () => {
    const authorize = async () => null;
    const p = authProviders.credentials({ authorize });
    expect(p.id).toBe("credentials");
    expect(p.name).toBe("Credentials");
    expect(p.type).toBe("credentials");
    expect(p.authorize).toBe(authorize);
  });
});

// ============================================================================
// requireAuth / requireRole middleware
// ============================================================================

describe("authjsRequireAuth", () => {
  it("returns 401 when no session", () => {
    const ctx = { auth: { session: null } } as any;
    const response = authjsRequireAuth(ctx);
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(401);
  });

  it("calls next when session exists", async () => {
    const ctx = {
      auth: {
        session: { user: { id: "1" }, token: "tok" },
      },
    } as any;
    const next = async () => new Response("ok", { status: 200 });
    const result = authjsRequireAuth(ctx, next);
    expect(result).toBeInstanceOf(Promise);
    const response = await result;
    expect(response.status).toBe(200);
  });

  it("works as route guard via beforeHandle", async () => {
    const app = new Asi();

    app.get("/profile", () => ({ name: "test" }), {
      beforeHandle: authjsRequireAuth,
    });

    // Without session — 401
    const noAuth = await app.handle(
      new Request("http://localhost/profile"),
    );
    expect(noAuth.status).toBe(401);
  });
});

describe("requireRole", () => {
  it("returns 401 when no user", () => {
    const guard = requireRole("admin");
    const ctx = { auth: { session: null } } as any;
    const response = guard(ctx);
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(401);
  });

  it("returns 403 when user has wrong role", () => {
    const guard = requireRole("admin");
    const ctx = {
      auth: {
        session: {
          user: { id: "1", role: "user" },
        },
      },
    } as any;
    const response = guard(ctx);
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(403);
  });

  it("calls next when user has correct role", async () => {
    const guard = requireRole("admin");
    const ctx = {
      auth: {
        session: {
          user: { id: "1", role: "admin" },
        },
      },
    } as any;
    const next = async () => new Response("ok", { status: 200 });
    const result = guard(ctx, next);
    expect(result).toBeInstanceOf(Promise);
    const response = await result;
    expect(response.status).toBe(200);
  });

  it("supports multiple roles", async () => {
    const guard = requireRole("admin", "moderator");
    const ctx = {
      auth: {
        session: {
          user: { id: "1", role: "moderator" },
        },
      },
    } as any;
    const next = async () => new Response("ok", { status: 200 });
    const result = guard(ctx, next);
    const response = await (result as Promise<Response>);
    expect(response.status).toBe(200);
  });
});

// ============================================================================
// Plugin Integration
// ============================================================================

describe("authjs plugin", () => {
  it("registers auth routes on default path prefix", async () => {
    const app = new Asi();
    app.plugin(
      authjs({
        secret: "test-secret-key-for-jwt",
        providers: [
          authProviders.credentials({
            authorize: async (creds) => {
              if (creds.email === "test@example.com" && creds.password === "pass") {
                return { id: "1", email: creds.email, name: "Test" };
              }
              return null;
            },
          }),
        ],
      }),
    );

    // GET /auth/session — no session
    const sessionRes = await app.handle(
      new Request("http://localhost/auth/session"),
    );
    expect(sessionRes.status).toBe(200);
    const sessionBody = await sessionRes.json();
    expect(sessionBody.user).toBeNull();
  });

  it("GET /auth/providers returns provider list", async () => {
    const app = new Asi();
    app.plugin(
      authjs({
        secret: "test-secret",
        providers: [
          authProviders.github({ clientId: "x", clientSecret: "y" }),
        ],
      }),
    );

    const res = await app.handle(
      new Request("http://localhost/auth/providers"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("github");
    expect(body[0].type).toBe("oauth");
  });

  it("GET /auth/csrf returns a CSRF token", async () => {
    const app = new Asi();
    app.plugin(
      authjs({
        secret: "test-secret",
        providers: [],
      }),
    );

    const res = await app.handle(
      new Request("http://localhost/auth/csrf"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.csrfToken).toBeDefined();
    expect(typeof body.csrfToken).toBe("string");
    expect(body.csrfToken.length).toBeGreaterThan(10);
  });

  it("POST /auth/signin with valid credentials returns session + cookie", async () => {
    const app = new Asi();
    app.plugin(
      authjs({
        secret: "test-secret-key",
        providers: [
          authProviders.credentials({
            authorize: async (creds) => {
              if (creds.email === "a@b.com") {
                return { id: "42", email: creds.email, name: "Alice" };
              }
              return null;
            },
          }),
        ],
      }),
    );

    const res = await app.handle(
      new Request("http://localhost/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "credentials",
          email: "a@b.com",
          password: "secret",
        }),
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toBeDefined();
    expect(body.user.id).toBe("42");
    expect(body.user.email).toBe("a@b.com");
    expect(body.token).toBeDefined();
    expect(body.token.split(".")).toHaveLength(3);

    // Cookie should be set
    const cookie = res.headers.get("Set-Cookie");
    expect(cookie).toContain("authjs.session-token");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("POST /auth/signin with invalid credentials returns 401", async () => {
    const app = new Asi();
    app.plugin(
      authjs({
        secret: "test-secret",
        providers: [
          authProviders.credentials({
            authorize: async () => null,
          }),
        ],
      }),
    );

    const res = await app.handle(
      new Request("http://localhost/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "credentials",
          email: "bad@user.com",
          password: "wrong",
        }),
      }),
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Invalid credentials");
  });

  it("POST /auth/signout clears cookie", async () => {
    const app = new Asi();
    app.plugin(
      authjs({
        secret: "test-secret",
        providers: [],
      }),
    );

    const res = await app.handle(
      new Request("http://localhost/auth/signout", { method: "POST" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    const cookie = res.headers.get("Set-Cookie");
    expect(cookie).toContain("authjs.session-token=");
    expect(cookie).toContain("Max-Age=0");
  });

  it("supports custom path prefix", async () => {
    const app = new Asi();
    app.plugin(
      authjs({
        secret: "test-secret",
        pathPrefix: "/api/auth",
        providers: [],
      }),
    );

    const res = await app.handle(
      new Request("http://localhost/api/auth/providers"),
    );
    expect(res.status).toBe(200);

    // Default path should 404
    const defaultRes = await app.handle(
      new Request("http://localhost/auth/providers"),
    );
    expect(defaultRes.status).toBe(404);
  });

  it("session is persisted on subsequent requests via cookie", async () => {
    const app = new Asi();

    app.plugin(
      authjs({
        secret: "session-persist-secret",
        providers: [
          authProviders.credentials({
            authorize: async () => ({ id: "1", email: "test@test.com" }),
          }),
        ],
      }),
    );

    // Sign in and capture the cookie
    const signInRes = await app.handle(
      new Request("http://localhost/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "credentials",
          email: "test@test.com",
          password: "pass",
        }),
      }),
    );

    const cookie = signInRes.headers.get("Set-Cookie") || "";
    const tokenMatch = cookie.match(/authjs\.session-token=([^;]+)/);
    expect(tokenMatch).not.toBeNull();

    const token = tokenMatch![1];

    // Now make a request with the session cookie
    const sessionRes = await app.handle(
      new Request("http://localhost/auth/session", {
        headers: { Cookie: `authjs.session-token=${token}` },
      }),
    );

    expect(sessionRes.status).toBe(200);
    const sessionBody = await sessionRes.json();
    expect(sessionBody.user).not.toBeNull();
    expect(sessionBody.user.id).toBe("1");
  });

  it("calls signIn callback when configured", async () => {
    const signInMock = async (user: AuthUser) => {
      if (user.email === "blocked@test.com") return false;
      return true;
    };

    const app = new Asi();
    app.plugin(
      authjs({
        secret: "callback-secret",
        providers: [
          authProviders.credentials({
            authorize: async (creds) => ({
              id: "1",
              email: creds.email,
              name: "Test",
            }),
          }),
        ],
        callbacks: { signIn: signInMock },
      }),
    );

    // This user should be blocked by signIn callback
    const blockedRes = await app.handle(
      new Request("http://localhost/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "credentials",
          email: "blocked@test.com",
          password: "pass",
        }),
      }),
    );
    expect(blockedRes.status).toBe(401);

    // This user should be allowed
    const allowedRes = await app.handle(
      new Request("http://localhost/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "credentials",
          email: "good@test.com",
          password: "pass",
        }),
      }),
    );
    expect(allowedRes.status).toBe(200);
  });

  it("calls jwt callback when configured", async () => {
    const jwtCallback = async (token: any, user?: AuthUser) => {
      return { ...token, role: "admin" };
    };

    const app = new Asi();
    app.plugin(
      authjs({
        secret: "jwt-cb-secret",
        providers: [
          authProviders.credentials({
            authorize: async () => ({
              id: "1",
              email: "test@test.com",
              name: "Test",
            }),
          }),
        ],
        callbacks: { jwt: jwtCallback },
      }),
    );

    const res = await app.handle(
      new Request("http://localhost/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "credentials",
          email: "test@test.com",
          password: "pass",
        }),
      }),
    );

    expect(res.status).toBe(200);
  });

  it("supports csrfProtection: false", async () => {
    const app = new Asi();
    app.plugin(
      authjs({
        secret: "test-secret",
        providers: [],
        csrfProtection: false,
      }),
    );

    const res = await app.handle(
      new Request("http://localhost/auth/csrf"),
    );
    expect(res.status).toBe(404);
  });
});
