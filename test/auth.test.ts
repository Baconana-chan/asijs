import { describe, expect, it } from "bun:test";
import { Asi, bearer, csrf, hashPassword, jwt, verifyPassword } from "../src";

describe("auth.ts", () => {
  it("jwt() signs and verifies tokens with configured claims", async () => {
    const helper = jwt({
      secret: "auth-test-secret",
      issuer: "asijs-tests",
      audience: "framework-users",
      expiresIn: "1h",
    });

    const token = await helper.sign({ sub: "user-123", role: "admin" });
    const payload = await helper.verify(token);

    expect(token.split(".")).toHaveLength(3);
    expect(payload.sub).toBe("user-123");
    expect(payload.role).toBe("admin");
    expect(payload.iss).toBe("asijs-tests");
    expect(payload.aud).toBe("framework-users");
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(3600);
  });

  it("bearer() protects routes and stores verified payload", async () => {
    const app = new Asi();
    const helper = jwt({ secret: "bearer-secret" });

    app.get(
      "/protected",
      (ctx) => ({ user: ctx.store.jwtPayload }),
      { beforeHandle: bearer({ jwt: helper }) },
    );

    const unauthorized = await app.handle(
      new Request("http://localhost/protected"),
    );
    expect(unauthorized.status).toBe(401);

    const token = await helper.sign({ sub: "42" });
    const authorized = await app.handle(
      new Request("http://localhost/protected", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toEqual({
      user: expect.objectContaining({ sub: "42" }),
    });
  });

  it("csrf() rejects mismatched tokens and allows matching ones", async () => {
    const app = new Asi();

    app.post("/submit", () => ({ ok: true }), {
      beforeHandle: csrf(),
    });

    const forbidden = await app.handle(
      new Request("http://localhost/submit", {
        method: "POST",
        headers: {
          Cookie: "_csrf=cookie-token",
          "X-CSRF-Token": "wrong-token",
        },
      }),
    );
    expect(forbidden.status).toBe(403);

    const allowed = await app.handle(
      new Request("http://localhost/submit", {
        method: "POST",
        headers: {
          Cookie: "_csrf=shared-token",
          "X-CSRF-Token": "shared-token",
        },
      }),
    );
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ ok: true });
  });

  it("hashPassword() and verifyPassword() round-trip passwords", async () => {
    const password = "S3cure!Passphrase";
    const hash = await hashPassword(password);

    expect(hash).not.toBe(password);
    expect(hash.length).toBeGreaterThan(50);
    expect(await verifyPassword(password, hash)).toBe(true);
    expect(await verifyPassword("incorrect-password", hash)).toBe(false);
  });
});
