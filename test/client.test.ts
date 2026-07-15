import { describe, expect, it } from "bun:test";
import { batchRequest, createClient, treaty, withRetry } from "../src";

describe("client.ts", () => {
  it("treaty() builds nested paths with params and query strings", async () => {
    let capturedUrl = "";

    const api = treaty("http://localhost:3000", {
      fetch: async (request) => {
        capturedUrl = request.url;
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    await api.users({ id: "123" }).posts.get({ query: { page: 2 } });

    expect(capturedUrl).toBe("http://localhost:3000/users/123/posts?page=2");
  });

  it("batchRequest() collects successes and failures", async () => {
    const client = createClient({
      baseUrl: "http://localhost:3000",
      fetch: async (request) => {
        const pathname = new URL(request.url).pathname;
        if (pathname === "/broken") {
          return new Response(JSON.stringify({ error: "boom" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ ok: pathname }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    const result = await batchRequest(client, [
      { method: "get", path: "/healthy" },
      { method: "get", path: "/broken" },
    ]);

    expect(result.successful).toBe(1);
    expect(result.failed).toBe(1);
    expect((result.results[0] as { data: { ok: string } }).data.ok).toBe(
      "/healthy",
    );
    expect((result.results[1] as { status: number }).status).toBe(500);
  });

  it("withRetry() retries transient failures before succeeding", async () => {
    let attempts = 0;

    const response = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) {
          throw { status: 503 };
        }

        return {
          data: { ok: true },
          status: 200,
          headers: new Headers(),
          response: new Response(null, { status: 200 }),
        };
      },
      {
        maxRetries: 2,
        baseDelay: 1,
        maxDelay: 5,
        jitter: 0,
      },
    );

    expect(attempts).toBe(3);
    expect(response.data).toEqual({ ok: true });
  });
});
