import { describe, expect, it } from "bun:test";
import {
  Asi,
  MemoryCache,
  apiCache,
  cdnCache,
  etag,
  parseTTL,
  staticCache,
} from "../src";

describe("cache.ts", () => {
  it("parseTTL() converts supported units to seconds", () => {
    expect(parseTTL(30)).toBe(30);
    expect(parseTTL("45s")).toBe(45);
    expect(parseTTL("5m")).toBe(300);
    expect(parseTTL("2h")).toBe(7200);
    expect(parseTTL("1d")).toBe(86400);
  });

  it("MemoryCache stores values and metadata", () => {
    const cache = new MemoryCache<string>();

    cache.set("greeting", "hello", "1h", '"etag-1"');

    expect(cache.get("greeting")).toBe("hello");
    expect(cache.getWithMeta("greeting")).toEqual({
      value: "hello",
      expires: expect.any(Number),
      etag: '"etag-1"',
    });
    expect(cache.has("greeting")).toBe(true);

    cache.destroy();
  });

  it("etag() adds ETag and returns 304 for matching If-None-Match", async () => {
    const app = new Asi();
    app.use(etag());
    app.get(
      "/text",
      () =>
        new Response("framework docs", {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
    );

    const first = await app.handle(new Request("http://localhost/text"));
    const etagValue = first.headers.get("ETag");

    expect(first.status).toBe(200);
    expect(etagValue).toBeString();

    const second = await app.handle(
      new Request("http://localhost/text", {
        headers: { "If-None-Match": etagValue! },
      }),
    );

    expect(second.status).toBe(304);
    expect(second.headers.get("ETag")).toBe(etagValue);
  });

  it("cache presets expose intended defaults", () => {
    expect(staticCache).toMatchObject({
      ttl: "365d",
      immutable: true,
      private: false,
    });
    expect(apiCache).toMatchObject({
      ttl: "1m",
      private: true,
      mustRevalidate: true,
    });
    expect(cdnCache).toMatchObject({
      ttl: "1h",
      private: false,
      staleWhileRevalidate: "5m",
      staleIfError: "1d",
    });
  });
});
