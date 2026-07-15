import { describe, expect, it } from "bun:test";
import {
  Asi,
  MemoryStore,
  TokenBucketStore,
  apiLimit,
  authLimit,
  rateLimitMiddleware,
  standardLimit,
  strictLimit,
} from "../src";

describe("ratelimit.ts", () => {
  it("MemoryStore implements sliding window counters", async () => {
    const store = new MemoryStore();

    expect((await store.increment("client-a", 60_000, 2)).remaining).toBe(1);
    expect((await store.increment("client-a", 60_000, 2)).remaining).toBe(0);
    expect((await store.increment("client-a", 60_000, 2)).remaining).toBe(-1);

    store.destroy();
  });

  it("TokenBucketStore allows bursts and then goes over limit", async () => {
    const store = new TokenBucketStore();

    expect((await store.increment("client-b", 60_000, 2)).remaining).toBe(1);
    expect((await store.increment("client-b", 60_000, 2)).remaining).toBe(0);

    const blocked = await store.increment("client-b", 60_000, 2);
    expect(blocked.remaining).toBeLessThan(0);
    expect(blocked.retryAfter).toBeGreaterThan(0);

    store.destroy();
  });

  it("rateLimitMiddleware() blocks over-limit requests", async () => {
    const app = new Asi();
    const key = `rate-limit-${Date.now()}`;

    app.get("/limited", () => "ok", {
      beforeHandle: rateLimitMiddleware({
        max: 2,
        windowMs: 60_000,
        keyGenerator: () => key,
        algorithm: "token-bucket",
      }),
    });

    expect(
      (await app.handle(new Request("http://localhost/limited"))).status,
    ).toBe(200);
    expect(
      (await app.handle(new Request("http://localhost/limited"))).status,
    ).toBe(200);

    const response = await app.handle(new Request("http://localhost/limited"));
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error).toBe("Too Many Requests");
  });

  it("preset factories expose expected limits", () => {
    expect(standardLimit()).toMatchObject({ max: 100, windowMs: 60_000 });
    expect(strictLimit()).toMatchObject({ max: 20, windowMs: 60_000 });
    expect(apiLimit()).toMatchObject({ max: 1000, windowMs: 3_600_000 });
    expect(authLimit()).toMatchObject({
      max: 5,
      windowMs: 900_000,
      message: "Too many authentication attempts, please try again later.",
    });
  });
});
