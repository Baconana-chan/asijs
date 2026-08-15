/**
 * Tests: Async Error Boundary — structured error handling
 *
 * - Error classification (business / system / fatal / validation)
 * - ctx.errorBoundary + structured responses
 * - Reporting pipeline hooks
 * - Retry policies with backoff
 */

import { describe, expect, it } from "bun:test";
import { Asi } from "../src/asi";
import {
  BusinessError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  SystemError,
  FatalError,
  HttpError,
  classifyError,
  toErrorResponse,
  errorBoundary,
  retry,
  computeBackoff,
  defaultShouldRetry,
  tryCatch,
} from "../src/index";
import { ValidationException } from "../src/validation";

function request(path = "/", method = "GET"): Request {
  return new Request(`http://localhost${path}`, { method });
}

describe("error classification", () => {
  it("classifies BusinessError as 4xx business", () => {
    const err = new BusinessError("USER_NOT_FOUND", "User not found");
    const c = classifyError(err);
    expect(c.category).toBe("business");
    expect(c.status).toBe(400);
    expect(c.code).toBe("USER_NOT_FOUND");
    expect(c.retryable).toBe(false);
  });

  it("classifies NotFoundError as 404", () => {
    const c = classifyError(new NotFoundError());
    expect(c.status).toBe(404);
    expect(c.code).toBe("NOT_FOUND");
  });

  it("classifies SystemError as 500 system, retryable", () => {
    const c = classifyError(new SystemError("db down"));
    expect(c.category).toBe("system");
    expect(c.status).toBe(500);
    expect(c.retryable).toBe(true);
  });

  it("classifies plain errors as system 500", () => {
    const c = classifyError(new Error("boom"));
    expect(c.category).toBe("system");
    expect(c.status).toBe(500);
    expect(c.code).toBe("INTERNAL_ERROR");
  });

  it("classifies FatalError as fatal", () => {
    const fatal = new FatalError("OOM");
    const c = classifyError(fatal);
    expect(c.category).toBe("fatal");
    expect(c.original).toBe(fatal);
    expect(fatal.crash).toBe(true);
    expect(fatal.code).toBe("FATAL_ERROR");
  });

  it("classifies ValidationException as validation 400 with details", () => {
    const c = classifyError(new ValidationException([{ path: "name", message: "required" }]));
    expect(c.category).toBe("validation");
    expect(c.status).toBe(400);
    expect(c.code).toBe("VALIDATION_ERROR");
  });

  it("classifies generic HttpError 201 as system (not client)", () => {
    // 2xx isn't an error range — treated as system fallback
    const c = classifyError(new HttpError(201, "weird"));
    expect(c.category).toBe("system");
  });
});

describe("toErrorResponse", () => {
  it("builds structured JSON with category", async () => {
    const app = new Asi({ development: false, silent: true });
    const res = await app.handle(
      new Request("http://localhost/boom"),
    );
    void res;

    const ctx = new (await import("../src/context")).Context(request("/x"));
    ctx.store = { requestId: "req-123" };
    const response = toErrorResponse(ctx, new NotFoundError());
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({
      error: "Resource not found",
      code: "NOT_FOUND",
      category: "business",
      requestId: "req-123",
    });
  });
});

describe("ctx.errorBoundary", () => {
  it("catches errors and returns a fallback", async () => {
    const app = new Asi({ development: false, silent: true });
    app.plugin(errorBoundary({ logToConsole: false }));
    app.get("/risky", async (ctx: any) => {
      const result = await ctx.errorBoundary(
        () => {
          throw new Error("nope");
        },
        { fallback: { ok: false } },
      );
      return result;
    });

    const res = await app.handle(request("/risky"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false });
  });

  it("turns uncaught handler errors into structured 500", async () => {
    const app = new Asi({ development: false, silent: true });
    app.plugin(errorBoundary({ logToConsole: false }));
    app.get("/boom", () => {
      throw new Error("kaboom");
    });

    const res = await app.handle(request("/boom"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.category).toBe("system");
    expect(body.code).toBe("INTERNAL_ERROR");
  });

  it("returns business error status/code for thrown BusinessError", async () => {
    const app = new Asi({ development: false, silent: true });
    app.plugin(errorBoundary({ logToConsole: false }));
    app.get("/missing", () => {
      throw new NotFoundError("Post not found");
    });

    const res = await app.handle(request("/missing"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("NOT_FOUND");
    expect(body.error).toBe("Post not found");
  });

  it("supports onError callback with classified info", async () => {
    const app = new Asi({ development: false, silent: true });
    app.plugin(errorBoundary({ logToConsole: false }));
    let seen: unknown = null;
    app.get("/cb", async (ctx: any) => {
      return ctx.errorBoundary(
        () => {
          throw new BusinessError("LIMIT", "Too many");
        },
        {
          onError: (error) => {
            seen = { code: error.code, status: error.status };
            return { handled: true };
          },
        },
      );
    });

    const res = await app.handle(request("/cb"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ handled: true });
    expect(seen).toEqual({ code: "LIMIT", status: 400 });
  });

  it("attaches a requestId to the store", async () => {
    const app = new Asi({ development: false, silent: true });
    app.plugin(errorBoundary({ logToConsole: false }));
    let captured: string | undefined;
    app.get("/id", async (ctx: any) => {
      captured = ctx.store.requestId;
      return { id: captured };
    });

    await app.handle(request("/id"));
    expect(captured).toBeDefined();
    expect(captured!.length).toBeGreaterThan(10);
  });

  it("validation exceptions produce structured 400", async () => {
    const app = new Asi({ development: false, silent: true });
    app.plugin(errorBoundary({ logToConsole: false }));
    app.get("/v", () => {
      throw new ValidationException([{ path: "email", message: "invalid" }]);
    });

    const res = await app.handle(request("/v"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.category).toBe("validation");
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.details).toHaveLength(1);
  });
});

describe("reporting pipeline", () => {
  it("calls reporter hooks with classified info", async () => {
    const reports: any[] = [];
    const app = new Asi({ development: false, silent: true });
    app.plugin(
      errorBoundary({
        logToConsole: false,
        reporters: [
          (report) => {
            reports.push({
              code: report.classified.code,
              status: report.classified.status,
              path: report.ctx.path,
            });
          },
        ],
      }),
    );
    app.get("/fail", () => {
      throw new SystemError("db unavailable", { code: "DB_DOWN" });
    });

    await app.handle(request("/fail"));
    expect(reports).toHaveLength(1);
    expect(reports[0]).toEqual({ code: "DB_DOWN", status: 500, path: "/fail" });
  });

  it("does not report business errors below minCategory", async () => {
    let called = 0;
    const app = new Asi({ development: false, silent: true });
    app.plugin(
      errorBoundary({
        logToConsole: false,
        minCategory: "system",
        reporters: [() => called++],
      }),
    );
    app.get("/bad", () => {
      throw new BusinessError("BAD", "bad request");
    });

    await app.handle(request("/bad"));
    expect(called).toBe(0);
  });

  it("reports fatal errors", async () => {
    let called = 0;
    const app = new Asi({ development: false, silent: true });
    app.plugin(
      errorBoundary({
        logToConsole: false,
        minCategory: "system",
        reporters: [() => called++],
      }),
    );
    app.get("/fatal", () => {
      throw new FatalError("heap exhausted");
    });

    await app.handle(request("/fatal"));
    expect(called).toBe(1);
  });
});

describe("retry policies", () => {
  it("retries until success", async () => {
    let attempts = 0;
    const result = await retry(
      () => {
        attempts++;
        if (attempts < 3) throw new SystemError("temporary");
        return "ok";
      },
      { attempts: 4, delayMs: 1 },
    );
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("gives up after max attempts", async () => {
    let attempts = 0;
    await expect(
      retry(
        () => {
          attempts++;
          throw new SystemError("always fails");
        },
        { attempts: 3, delayMs: 1 },
      ),
    ).rejects.toThrow();
    expect(attempts).toBe(3);
  });

  it("does not retry non-retryable errors", async () => {
    let attempts = 0;
    await expect(
      retry(
        () => {
          attempts++;
          throw new BusinessError("BAD_INPUT", "bad");
        },
        { attempts: 3, delayMs: 1 },
      ),
    ).rejects.toThrow();
    expect(attempts).toBe(1);
  });

  it("computes exponential backoff with cap", () => {
    expect(computeBackoff(0, { backoff: "exponential", delayMs: 100, maxDelayMs: 1000, jitter: 0 })).toBe(100);
    expect(computeBackoff(1, { backoff: "exponential", delayMs: 100, maxDelayMs: 1000, jitter: 0 })).toBe(200);
    expect(computeBackoff(4, { backoff: "exponential", delayMs: 100, maxDelayMs: 1000, jitter: 0 })).toBe(1000);
    expect(computeBackoff(1, { backoff: "linear", delayMs: 100, maxDelayMs: 1000, jitter: 0 })).toBe(200);
    expect(computeBackoff(0, { backoff: "fixed", delayMs: 50, maxDelayMs: 1000, jitter: 0 })).toBe(50);
  });

  it("honors custom shouldRetry predicate", async () => {
    let attempts = 0;
    const result = await retry(
      () => {
        attempts++;
        if (attempts < 2) throw new Error("custom transient");
        return 42;
      },
      {
        attempts: 3,
        delayMs: 1,
        shouldRetry: (err) => err instanceof Error && err.message.includes("transient"),
      },
    );
    expect(result).toBe(42);
    expect(attempts).toBe(2);
  });

  it("defaultShouldRetry recognizes network errors", () => {
    expect(defaultShouldRetry(new SystemError("x"))).toBe(true);
    expect(defaultShouldRetry(new BusinessError("X"))).toBe(false);
    expect(defaultShouldRetry(new Error("fetch failed"))).toBe(true);
    expect(defaultShouldRetry(new Error("ECONNREFUSED"))).toBe(true);
    expect(defaultShouldRetry(new Error("plain"))).toBe(false);
  });
});

describe("tryCatch helper", () => {
  it("returns ok result", async () => {
    const r = await tryCatch(() => 7);
    expect(r).toEqual({ ok: true, value: 7 });
  });

  it("returns classified error", async () => {
    const r = await tryCatch(() => {
      throw new NotFoundError();
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.category).toBe("business");
      expect(r.error.status).toBe(404);
    }
  });
});

describe("shorthand errors", () => {
  it("has the right statuses", () => {
    expect(new UnauthorizedError().status).toBe(401);
    expect(new ForbiddenError().status).toBe(403);
    expect(new ConflictError().status).toBe(409);
    expect(new BusinessError("X").status).toBe(400);
    expect(new SystemError().status).toBe(500);
  });
});
