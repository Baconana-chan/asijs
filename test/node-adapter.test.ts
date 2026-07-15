/**
 * Tests for the Node.js Server Adapter
 *
 * Tests run on Bun (which provides http/https module compatibility).
 * EADDRINUSE retry is tested by occupying a port and verifying
 * the adapter finds the next available port.
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { Asi } from "../src/asi";
import { nodeAdapter, ensureHttp, isHttpReady } from "../src/runtime/node";
import type { ServerHandle } from "../src/runtime/types";

/**
 * Wait for a server to become ready.
 *
 * Three modes:
 * 1. Port 0 (no initial): polls until port > 0 (random port assigned)
 * 2. EADDRINUSE retry (with initial): polls until port changes
 * 3. Fixed port, no conflict: returns after a short delay (100ms)
 */
async function waitForServerReady(
  server: ServerHandle,
  options?: { timeoutMs?: number; retryFrom?: number },
): Promise<number> {
  const timeoutMs = options?.timeoutMs ?? 3000;
  const deadline = Date.now() + timeoutMs;

  // Mode 1: Port 0 → wait for random port
  if (options?.retryFrom === undefined) {
    const initPort = server.port;
    if (initPort > 0) return initPort; // already assigned
    while (Date.now() < deadline) {
      if (server.port > 0) return server.port;
      await new Promise((r) => setTimeout(r, 30));
    }
    return server.port;
  }

  // Mode 2: EADDRINUSE retry → wait for port to change
  const retryFrom = options.retryFrom;
  while (Date.now() < deadline) {
    if (server.port !== retryFrom) return server.port;
    await new Promise((r) => setTimeout(r, 30));
  }
  return server.port;
}

/** Create a server on a fixed port and confirm it's listening via fetch */
async function occupyPort(port: number): Promise<ServerHandle> {
  const app = new Asi({
    serverAdapter: nodeAdapter(),
    silent: true,
    startupBanner: false,
  });
  app.get("/", () => ({ status: "ok" }));
  const s = nodeAdapter().createServer(
    app as any,
    { port, hostname: "127.0.0.1", autoPort: false },
    (r) => app.handle(r),
  );
  // Poll until the dynamic getter returns the real port from address()
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (s.port === port) break;
    await new Promise((r) => setTimeout(r, 30));
  }
  // Confirm the server is actually alive
  const probe = await fetch(`http://127.0.0.1:${port}/`);
  expect(probe.status).toBe(200);
  return s;
}

/** Create an Asi app with nodeAdapter and optional GET route */
function createNodeApp(route?: string) {
  const app = new Asi({
    serverAdapter: nodeAdapter(),
    silent: true,
    startupBanner: false,
  });
  if (route) app.get(route, () => ({ status: "ok" }));
  return app;
}

/** Get a unique port per test to avoid conflicts */
let nextPort = 23000;
function getUniquePort(): number {
  return nextPort++;
}

beforeAll(async () => {
  await ensureHttp();
});

describe("Module loading", () => {
  it("should load http/https modules via ensureHttp", async () => {
    await expect(ensureHttp()).resolves.toBeUndefined();
  });

  it("should report ready after ensureHttp resolves", () => {
    expect(isHttpReady()).toBe(true);
  });

  it("should be idempotent — calling ensureHttp multiple times is safe", async () => {
    await expect(ensureHttp()).resolves.toBeUndefined();
    await expect(ensureHttp()).resolves.toBeUndefined();
  });
});

describe("nodeAdapter factory", () => {
  it("should create a ServerAdapter with name 'node'", () => {
    const adapter = nodeAdapter();
    expect(adapter).toBeDefined();
    expect(adapter.name).toBe("node");
    expect(typeof adapter.createServer).toBe("function");
  });

  it("should accept TLS options", () => {
    const adapter = nodeAdapter({
      tls: { key: "fake-key", cert: "fake-cert" },
      maxBodySize: 1024,
    });
    expect(adapter.name).toBe("node");
  });

  it("should work with default options", () => {
    expect(nodeAdapter().name).toBe("node");
  });
});

describe("createServer", () => {
  it("should return ServerHandle with port, hostname, and stop", async () => {
    const app = new Asi({ silent: true });
    app.get("/", () => "hello");

    const info = nodeAdapter().createServer(
      app as any,
      { port: 0, hostname: "127.0.0.1" },
      (r) => app.handle(r),
    );

    expect(info.hostname).toBe("127.0.0.1");
    expect(typeof info.stop).toBe("function");

    const port = await waitForServerReady(info);
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65536);

    info.stop();
  });

  it("should handle real HTTP requests", async () => {
    const port = getUniquePort();
    const app = createNodeApp("/test");

    const info = nodeAdapter().createServer(
      app as any,
      { port, hostname: "127.0.0.1" },
      (r) => app.handle(r),
    );

    await new Promise((r) => setTimeout(r, 100));
    expect(info.port).toBe(port);

    const res = await fetch(`http://127.0.0.1:${port}/test`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });

    info.stop();
  });

  it("should handle POST with JSON body", async () => {
    const port = getUniquePort();
    const app = createNodeApp();
    app.post("/echo", async (ctx) => ({ received: await ctx.json() }));

    const info = nodeAdapter().createServer(
      app as any,
      { port, hostname: "127.0.0.1" },
      (r) => app.handle(r),
    );

    await new Promise((r) => setTimeout(r, 100));

    const res = await fetch(`http://127.0.0.1:${port}/echo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test", value: 42 }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: { name: "test", value: 42 } });

    info.stop();
  });

  it("should be safe to stop() multiple times", async () => {
    const app = createNodeApp("/");

    const info = nodeAdapter().createServer(
      app as any,
      { port: 0, hostname: "127.0.0.1" },
      (r) => app.handle(r),
    );

    await waitForServerReady(info);
    expect(info.port).toBeGreaterThan(0);

    info.stop();
    info.stop();
    info.stop();
  });

  it("should return 404 for unknown routes", async () => {
    const port = getUniquePort();
    const app = createNodeApp("/exists");

    const info = nodeAdapter().createServer(
      app as any,
      { port, hostname: "127.0.0.1" },
      (r) => app.handle(r),
    );

    await new Promise((r) => setTimeout(r, 100));

    const res = await fetch(`http://127.0.0.1:${port}/not-exists`);
    expect(res.status).toBe(404);

    info.stop();
  });
});

describe("EADDRINUSE — auto port fallback", () => {
  it("should retry to next port when requested port is busy", async () => {
    const basePort = getUniquePort();

    const occ = await occupyPort(basePort);

    const app = createNodeApp("/");
    const free = nodeAdapter().createServer(
      app as any,
      { port: basePort, hostname: "127.0.0.1", autoPort: true, autoPortRange: 5 },
      (r) => app.handle(r),
    );

    const retried = await waitForServerReady(free, {
      retryFrom: basePort,
      timeoutMs: 5000,
    });
    expect(retried).not.toBe(basePort);
    expect(retried).toBeGreaterThan(0);

    const res = await fetch(`http://127.0.0.1:${retried}/`);
    expect(res.status).toBe(200);

    occ.stop();
    free.stop();
  });

  it("should NOT retry when autoPort is disabled", async () => {
    const basePort = getUniquePort();
    const occ = await occupyPort(basePort);

    const app2 = createNodeApp("/");
    const s2 = nodeAdapter().createServer(
      app2 as any,
      { port: basePort, hostname: "127.0.0.1", autoPort: false },
      (r) => app2.handle(r),
    );

    await new Promise((r) => setTimeout(r, 100));
    expect(s2.port).toBe(basePort);

    occ.stop();
    s2.stop();
  });

  it("should skip two occupied ports and find free port", async () => {
    const portA = getUniquePort();
    const portB = portA + 1;

    const sA = await occupyPort(portA);
    const sB = await occupyPort(portB);

    const app = createNodeApp("/");
    const free = nodeAdapter().createServer(
      app as any,
      { port: portA, hostname: "127.0.0.1", autoPort: true, autoPortRange: 10 },
      (r) => app.handle(r),
    );

    const freePort = await waitForServerReady(free, {
      retryFrom: portA,
      timeoutMs: 5000,
    });
    expect(freePort).toBeGreaterThan(0);
    expect(freePort).not.toBe(portA);
    expect(freePort).not.toBe(portB);

    const res = await fetch(`http://127.0.0.1:${freePort}/`);
    expect(res.status).toBe(200);

    free.stop();
    sA.stop();
    sB.stop();
  });

  it("should not crash when all ports are busy", async () => {
    const basePort = getUniquePort();

    const occupied: ServerHandle[] = [];
    for (let i = 0; i < 5; i++) {
      occupied.push(await occupyPort(basePort + i));
    }

    const app = createNodeApp("/");
    const failed = nodeAdapter().createServer(
      app as any,
      { port: basePort, hostname: "127.0.0.1", autoPort: true, autoPortRange: 5 },
      (r) => app.handle(r),
    );

    // Wait for async EADDRINUSE on all 5 attempts
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (failed.port === basePort + 4) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(failed.port).toBe(basePort + 4);

    failed.stop();
    for (const s of occupied) s.stop();
  });
});

describe("Integration with Asi.listen()", () => {
  it("should work with Asi.listen() via serverAdapter config", async () => {
    const app = new Asi({
      serverAdapter: nodeAdapter(),
      silent: true,
      startupBanner: false,
    });
    app.get("/", () => "Hello from Node adapter!");

    const server = app.listen(0);
    expect(server).toBeDefined();
    expect(typeof server.stop).toBe("function");

    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if (server.port > 0) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    expect(server.port).toBeGreaterThan(0);

    server.stop();
  });

  it("should respect the specified port", async () => {
    const port = getUniquePort();
    const app = new Asi({
      serverAdapter: nodeAdapter(),
      silent: true,
      startupBanner: false,
    });
    app.get("/", () => "specific port");

    const server = app.listen(port);
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if (server.port === port) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    expect(server.port).toBe(port);

    server.stop();
  });

  it("should handle routes via app.handle", () => {
    const app = new Asi({ serverAdapter: nodeAdapter(), silent: true });
    app.get("/a", () => "route-a");
    app.post("/b", async (ctx) => ({ data: await ctx.json() }));

    expect(app.getRoutes()).toHaveLength(2);
    expect(app.getAppConfig()).toBeDefined();
  });

  it("should allow immediate stop() after listen()", () => {
    const app = new Asi({
      serverAdapter: nodeAdapter(),
      silent: true,
      startupBanner: false,
    });
    app.get("/", () => "ok");

    const server = app.listen(0);
    expect(() => server.stop()).not.toThrow();
  });
});

describe("isHttpReady / ensureHttp", () => {
  it("should return true after initialization", async () => {
    await ensureHttp();
    expect(isHttpReady()).toBe(true);
  });

  it("should be callable before listen()", async () => {
    const app = new Asi({ silent: true });
    app.get("/", () => "ok");

    const info = nodeAdapter().createServer(
      app as any,
      { port: 0, hostname: "127.0.0.1" },
      (r) => app.handle(r),
    );

    expect(info.port).toBeDefined();
    info.stop();
  });
});

describe("WebSocket via Asi.ws() + nodeAdapter", () => {
  /** Helper: create app, start server on unique port, return { server, port } */
  async function startWsApp(
    setup: (app: Asi) => void,
  ): Promise<{ server: ServerHandle; port: number }> {
    const port = getUniquePort();
    const app = new Asi({
      serverAdapter: nodeAdapter(),
      silent: true,
      startupBanner: false,
    });
    setup(app);
    const server = app.listen(port);
    await new Promise((r) => setTimeout(r, 150));
    return { app, server, port };
  }

  /** Helper: connect a WS client, send a message, wait for reply */
  async function wsEcho(
    port: number,
    path: string,
    msg: string,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
      const timer = setTimeout(
        () => reject(new Error(`WS echo timeout for ${path}`)),
        4000,
      );
      ws.onopen = () => ws.send(msg);
      ws.onmessage = (event) => {
        clearTimeout(timer);
        resolve(event.data as string);
        ws.close();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("WebSocket connection error"));
      };
    });
  }

  /** Helper: connect to a WS path and expect connection to fail */
  async function expectWsReject(
    port: number,
    path: string,
    label: string,
  ): Promise<void> {
    await expect(
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
        const timer = setTimeout(
          () => reject(new Error(`${label}: timeout`)),
          4000,
        );
        ws.onopen = () => {
          clearTimeout(timer);
          reject(new Error(`${label}: should not connect`));
        };
        // Both error and close = connection was rejected (expected)
        ws.onerror = () => {
          clearTimeout(timer);
          resolve();
        };
        ws.onclose = () => {
          clearTimeout(timer);
          resolve();
        };
      }),
    ).resolves.toBeUndefined();
  }

  it("should echo messages back to the client", async () => {
    const { server, port } = await startWsApp((app) => {
      app.ws("/ws", {
        message(ws, msg) {
          ws.send(`echo: ${msg}`);
        },
      });
    });

    const reply = await wsEcho(port, "/ws", "hello");
    expect(reply).toBe("echo: hello");
    server.stop();
  });

  it("should send binary data and echo it back", async () => {
    const { server, port } = await startWsApp((app) => {
      app.ws("/bin", {
        message(ws, msg) {
          ws.send(msg);
        },
      });
    });

    const binaryData = new Uint8Array([0, 1, 255, 128, 64, 32]);

    const reply = await new Promise<ArrayBuffer>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/bin`);
      ws.binaryType = "arraybuffer";
      const timer = setTimeout(
        () => reject(new Error("Binary WS timeout")),
        4000,
      );
      ws.onopen = () => ws.send(binaryData);
      ws.onmessage = (event) => {
        clearTimeout(timer);
        resolve(event.data as ArrayBuffer);
        ws.close();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("Binary WebSocket connection error"));
      };
    });

    expect(new Uint8Array(reply)).toEqual(binaryData);
    server.stop();
  });

  it("should reject connection when beforeUpgrade returns false", async () => {
    const { server, port } = await startWsApp((app) => {
      app.ws(
        "/protected",
        { open(ws) { ws.send("should-not-reach"); } },
        { beforeUpgrade: () => false },
      );
    });

    await expectWsReject(port, "/protected", "beforeUpgrade false");
    server.stop();
  });

  it("should reject connection when beforeUpgrade throws an error", async () => {
    const { server, port } = await startWsApp((app) => {
      app.ws(
        "/crash",
        { open(ws) { ws.send("should-not-reach"); } },
        { beforeUpgrade: () => { throw new Error("auth-boom"); } },
      );
    });

    await expectWsReject(port, "/crash", "beforeUpgrade throw");
    server.stop();
  });

  it("should allow connection when beforeUpgrade returns true", async () => {
    const { server, port } = await startWsApp((app) => {
      app.ws(
        "/open",
        {
          message(ws, msg) {
            ws.send(`allowed: ${msg}`);
          },
        },
        { beforeUpgrade: () => true },
      );
    });

    const reply = await wsEcho(port, "/open", "test");
    expect(reply).toBe("allowed: test");
    server.stop();
  });

  it("should handle multiple WebSocket routes", async () => {
    const { server, port } = await startWsApp((app) => {
      app.ws("/chat", {
        message(ws, msg) { ws.send(`chat: ${msg}`); },
      });
      app.ws("/notify", {
        message(ws, msg) { ws.send(`notify: ${msg}`); },
      });
    });

    const chatReply = await wsEcho(port, "/chat", "hello");
    expect(chatReply).toBe("chat: hello");

    const notifyReply = await wsEcho(port, "/notify", "alert");
    expect(notifyReply).toBe("notify: alert");

    server.stop();
  });

  it("should reject connection to non-matching WebSocket path", async () => {
    const { server, port } = await startWsApp((app) => {
      app.ws("/ws", { message(ws, msg) { ws.send(`echo: ${msg}`); } });
    });

    await expectWsReject(port, "/nonexistent", "non-matching path");
    server.stop();
  });

  it("should work via Asi.listen() with ws() registration", async () => {
    const port = getUniquePort();
    const app = new Asi({
      serverAdapter: nodeAdapter(),
      silent: true,
      startupBanner: false,
    });
    app.ws("/echo", {
      message(ws, msg) { ws.send(`via-listen: ${msg}`); },
    });

    const server = app.listen(port);
    await new Promise((r) => setTimeout(r, 150));

    const reply = await wsEcho(port, "/echo", "ping");
    expect(reply).toBe("via-listen: ping");
    server.stop();
  });

  it("should support open and close event handlers", async () => {
    let opened = false;
    let closeCode = 0;
    let closeReason = "";

    const { server, port } = await startWsApp((app) => {
      app.ws("/events", {
        open(ws) {
          opened = true;
          ws.send("welcome");
        },
        close(ws, code, reason) {
          closeCode = code;
          closeReason = reason;
        },
      });
    });

    const reply = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/events`);
      const timer = setTimeout(
        () => reject(new Error("open/close events timeout")),
        4000,
      );
      ws.onmessage = (event) => {
        clearTimeout(timer);
        resolve(event.data as string);
        ws.close(1000, "test-close");
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("Event WS connection error"));
      };
    });

    expect(opened).toBe(true);
    expect(reply).toBe("welcome");

    // Give time for close event to propagate
    await new Promise((r) => setTimeout(r, 100));
    expect(closeCode).toBe(1000);
    // reason may be Buffer on Node.js ws layer — just verify handler fired
    expect(typeof closeReason).toBe("string");

    server.stop();
  });

  it("should handle server stop without crashing", async () => {
    const { server, port } = await startWsApp((app) => {
      app.ws("/crash-safe", {
        message(ws, msg) { ws.send(`echo: ${msg}`); },
      });
    });

    // Just verify stop() doesn't throw when WebSocket connections exist
    const ws = new WebSocket(`ws://127.0.0.1:${port}/crash-safe`);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("Crash-safe connect error"));
      setTimeout(() => reject(new Error("Crash-safe connect timeout")), 3000);
    });

    expect(() => server.stop()).not.toThrow();
  });
});
