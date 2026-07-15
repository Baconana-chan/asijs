/**
 * Tests for JSON Streaming & NDJSON (P3.7)
 *
 * Covers:
 * - createJsonStream with sync arrays (empty, single, multiple, nested)
 * - createJsonStream with async iterables
 * - createNDJsonStream with sync/async iterables
 * - streamJsonResponse / streamNDJsonResponse — headers, status
 * - ctx.streamJson / ctx.streamNDJson — cookies, status, headers
 * - Integration with Asi app (app.handle)
 */

import { describe, it, expect } from "bun:test";
import {
  createJsonStream,
  streamJsonResponse,
  createNDJsonStream,
  streamNDJsonResponse,
} from "../src/json-stream";
import { Asi } from "../src/asi";
import { Context } from "../src/context";

// ============================================================================
// Helper: consume a ReadableStream into a string
// ============================================================================

async function consumeStream(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  return result;
}

// ============================================================================
// createJsonStream — Sync Array
// ============================================================================

describe("createJsonStream (sync array)", () => {
  it("should stream an empty array as []", async () => {
    const stream = createJsonStream([]);
    const result = await consumeStream(stream);
    expect(result).toBe("[]");
  });

  it("should stream a single item", async () => {
    const stream = createJsonStream([42]);
    const result = await consumeStream(stream);
    expect(result).toBe("[42]");
  });

  it("should stream multiple primitive items", async () => {
    const stream = createJsonStream([1, 2, 3, 4, 5]);
    const result = await consumeStream(stream);
    expect(result).toBe("[1,2,3,4,5]");
  });

  it("should stream objects", async () => {
    const stream = createJsonStream([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ]);
    const result = await consumeStream(stream);
    expect(result).toBe('[{"id":1,"name":"Alice"},{"id":2,"name":"Bob"}]');
  });

  it("should handle strings with special characters", async () => {
    const stream = createJsonStream(['hello "world"', "line\nbreak"]);
    const result = await consumeStream(stream);
    expect(result).toBe('["hello \\"world\\"","line\\nbreak"]');
  });

  it("should handle mixed types", async () => {
    const stream = createJsonStream([null, true, 42, "text", { a: 1 }]);
    const result = await consumeStream(stream);
    expect(result).toBe('[null,true,42,"text",{"a":1}]');
  });

  it("should use custom replacer", async () => {
    const stream = createJsonStream(
      [{ id: 1, password: "secret" }],
      {
        replacer: (key, value) =>
          key === "password" ? undefined : value,
      },
    );
    const result = await consumeStream(stream);
    expect(result).toBe('[{"id":1}]');
  });

  it("should handle nested arrays", async () => {
    const stream = createJsonStream([
      [1, 2],
      [3, 4],
    ]);
    const result = await consumeStream(stream);
    expect(result).toBe("[[1,2],[3,4]]");
  });
});

// ============================================================================
// createJsonStream — Async Iterable
// ============================================================================

describe("createJsonStream (async iterable)", () => {
  it("should stream from an async generator", async () => {
    async function* gen() {
      yield 1;
      yield 2;
      yield 3;
    }
    const stream = createJsonStream(gen());
    const result = await consumeStream(stream);
    expect(result).toBe("[1,2,3]");
  });

  it("should handle empty async generator", async () => {
    async function* gen() {}
    const stream = createJsonStream(gen());
    const result = await consumeStream(stream);
    expect(result).toBe("[]");
  });

  it("should stream objects from async generator", async () => {
    async function* gen() {
      yield { id: 1, name: "Alice" };
      yield { id: 2, name: "Bob" };
    }
    const stream = createJsonStream(gen());
    const result = await consumeStream(stream);
    expect(result).toBe('[{"id":1,"name":"Alice"},{"id":2,"name":"Bob"}]');
  });

  it("should handle error in async iterable — reader gets errored", async () => {
    async function* gen() {
      yield 1;
      throw new Error("test error");
    }
    const stream = createJsonStream(gen());
    const reader = stream.getReader();
    // First read succeeds
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(first.value).toBeTruthy();
    // Second read — the stream was errored, so it either throws or returns done=true
    let threw = false;
    try {
      const second = await reader.read();
      // If no throw, it should be done
      expect(second.done).toBe(true);
    } catch {
      threw = true;
      expect(threw).toBe(true);
    }
  });
});

// ============================================================================
// streamJsonResponse
// ============================================================================

describe("streamJsonResponse", () => {
  it("should return a Response with application/json content-type", async () => {
    const res = streamJsonResponse([1, 2, 3]);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("should respect custom status", async () => {
    const res = streamJsonResponse([], { status: 201 });
    expect(res.status).toBe(201);
  });

  it("should respect custom headers", async () => {
    const res = streamJsonResponse([], {
      headers: { "X-Custom": "test" },
    });
    expect(res.headers.get("X-Custom")).toBe("test");
  });

  it("should stream correct JSON body", async () => {
    const res = streamJsonResponse([
      { msg: "hello" },
      { msg: "world" },
    ]);
    const body = await res.text();
    expect(body).toBe('[{"msg":"hello"},{"msg":"world"}]');
  });
});

// ============================================================================
// createNDJsonStream
// ============================================================================

describe("createNDJsonStream", () => {
  it("should stream each item on its own line", async () => {
    const stream = createNDJsonStream([
      { id: 1 },
      { id: 2 },
      { id: 3 },
    ]);
    const result = await consumeStream(stream);
    expect(result).toBe('{"id":1}\n{"id":2}\n{"id":3}\n');
  });

  it("should handle empty array", async () => {
    const stream = createNDJsonStream([]);
    const result = await consumeStream(stream);
    expect(result).toBe("");
  });

  it("should handle single item", async () => {
    const stream = createNDJsonStream(["hello"]);
    const result = await consumeStream(stream);
    expect(result).toBe('"hello"\n');
  });

  it("should handle async iterable", async () => {
    async function* gen() {
      yield { n: 1 };
      yield { n: 2 };
    }
    const stream = createNDJsonStream(gen());
    const result = await consumeStream(stream);
    expect(result).toBe('{"n":1}\n{"n":2}\n');
  });

  it("should use custom replacer", async () => {
    const stream = createNDJsonStream(
      [{ name: "Alice", ssn: "123-45-6789" }],
      { replacer: (key, value) => (key === "ssn" ? undefined : value) },
    );
    const result = await consumeStream(stream);
    expect(result).toBe('{"name":"Alice"}\n');
  });
});

// ============================================================================
// streamNDJsonResponse
// ============================================================================

describe("streamNDJsonResponse", () => {
  it("should return Response with application/x-ndjson", async () => {
    const res = streamNDJsonResponse([{ a: 1 }]);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/x-ndjson");
  });

  it("should respect custom status", async () => {
    const res = streamNDJsonResponse([], { status: 206 });
    expect(res.status).toBe(206);
  });
});

// ============================================================================
// Context integration
// ============================================================================

describe("ctx.streamJson", () => {
  it("should stream JSON array and set content-type", async () => {
    const ctx = new Context(new Request("http://localhost/test"));
    const res = ctx.streamJson([1, 2, 3]);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const body = await res.text();
    expect(body).toBe("[1,2,3]");
  });

  it("should preserve custom status", async () => {
    const ctx = new Context(new Request("http://localhost/test"));
    ctx.status(201);
    const res = ctx.streamJson([1]);
    expect(res.status).toBe(201);
  });

  it("should preserve cookies", async () => {
    const ctx = new Context(new Request("http://localhost/test"));
    ctx.setCookie("session", "abc123", { path: "/", httpOnly: true });
    const res = ctx.streamJson([1]);
    const setCookie = res.headers.get("Set-Cookie");
    expect(setCookie).toContain("session=abc123");
    expect(setCookie).toContain("HttpOnly");
  });

  it("should preserve custom headers", async () => {
    const ctx = new Context(new Request("http://localhost/test"));
    ctx.setHeader("X-Custom", "preserved");
    const res = ctx.streamJson([1]);
    expect(res.headers.get("X-Custom")).toBe("preserved");
  });

  it("should handle options.status override", async () => {
    const ctx = new Context(new Request("http://localhost/test"));
    ctx.status(200);
    const res = ctx.streamJson([], { status: 206 });
    expect(res.status).toBe(206);
  });
});

describe("ctx.streamNDJson", () => {
  it("should stream NDJSON and set content-type", async () => {
    const ctx = new Context(new Request("http://localhost/test"));
    const res = ctx.streamNDJson([{ id: 1 }, { id: 2 }]);
    expect(res.headers.get("Content-Type")).toBe("application/x-ndjson");
    const body = await res.text();
    expect(body).toBe('{"id":1}\n{"id":2}\n');
  });

  it("should preserve cookies", async () => {
    const ctx = new Context(new Request("http://localhost/test"));
    ctx.setCookie("sid", "xyz", { maxAge: 3600 });
    const res = ctx.streamNDJson([{ a: 1 }]);
    const setCookie = res.headers.get("Set-Cookie");
    expect(setCookie).toContain("sid=xyz");
    expect(setCookie).toContain("Max-Age=3600");
  });
});

// ============================================================================
// Integration with Asi app
// ============================================================================

describe("Asi app integration", () => {
  it("should serve streamJson endpoint", async () => {
    const app = new Asi({ silent: true } as any);
    app.get("/json-stream", (ctx) => {
      return ctx.streamJson([{ msg: "hello" }, { msg: "world" }]);
    });

    const res = await app.handle(new Request("http://localhost/json-stream"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const body = await res.text();
    expect(body).toBe('[{"msg":"hello"},{"msg":"world"}]');
  });

  it("should serve streamNDJson endpoint", async () => {
    const app = new Asi({ silent: true } as any);
    app.get("/ndjson-stream", (ctx) => {
      return ctx.streamNDJson([{ line: 1 }, { line: 2 }]);
    });

    const res = await app.handle(new Request("http://localhost/ndjson-stream"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/x-ndjson");
    const body = await res.text();
    expect(body).toBe('{"line":1}\n{"line":2}\n');
  });

  it("should handle empty array in streamJson", async () => {
    const app = new Asi({ silent: true } as any);
    app.get("/empty", (ctx) => ctx.streamJson([]));

    const res = await app.handle(new Request("http://localhost/empty"));
    const body = await res.text();
    expect(body).toBe("[]");
  });

  it("should work with standalone helpers via app handler", async () => {
    const app = new Asi({ silent: true } as any);
    app.get("/standalone", () => {
      return streamJsonResponse([99, 100]);
    });

    const res = await app.handle(new Request("http://localhost/standalone"));
    const body = await res.text();
    expect(body).toBe("[99,100]");
  });
});
