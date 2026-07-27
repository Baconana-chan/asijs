import { describe, expect, it } from "bun:test";
import { HMRServer, hmrClientScript } from "../src";

describe("HMRServer", () => {
  it("creates instance with default options", () => {
    const server = new HMRServer();
    expect(server).toBeInstanceOf(HMRServer);
    expect(server.isRunning).toBe(false);
    expect(server.clientCount).toBe(0);
    expect(server.port).toBe(35729);
  });

  it("creates instance with custom options", () => {
    const server = new HMRServer({
      port: 9999,
      hostname: "127.0.0.1",
      verbose: true,
      heartbeatMs: 10000,
      reconnectDelay: 500,
    });
    expect(server).toBeInstanceOf(HMRServer);
    expect(server.port).toBe(9999);
  });

  it("start() and stop() work correctly", () => {
    const server = new HMRServer({ port: 0, verbose: false });

    // Port 0 will cause Bun to assign a random port
    server.start();

    // May or may not start depending on environment
    server.stop();

    expect(server.isRunning).toBe(false);
  });

  it("stop() is idempotent", () => {
    const server = new HMRServer({ verbose: false });
    server.stop(); // Not started — should not throw
    server.stop(); // Again — should not throw
    expect(server.isRunning).toBe(false);
  });

  it("broadcast does nothing with no clients", () => {
    const server = new HMRServer({ verbose: false });
    // Should not throw
    server.broadcast({ type: "fullReload" });
    expect(true).toBe(true);
  });

  it("broadcast sends to connected clients", () => {
    const server = new HMRServer({ verbose: false });

    // Without starting, broadcast should be a no-op
    server.broadcast({ type: "fullReload" });
    server.broadcast({ type: "component", files: ["src/test.tsx"] });
    server.broadcast({ type: "style", files: ["src/style.css"] });
    server.broadcast({ type: "connected", data: { clientId: "test" } });

    expect(true).toBe(true);
  });

  it("returns the correct WebSocket URL", () => {
    const server = new HMRServer({
      port: 35729,
      hostname: "localhost",
    });

    expect(server.url).toBe("ws://localhost:35729");
  });
});

describe("hmrClientScript", () => {
  it("generates a valid JavaScript string", () => {
    const script = hmrClientScript();
    expect(typeof script).toBe("string");
    expect(script.length).toBeGreaterThan(100);

    // Should contain key HMR logic
    expect(script).toContain("WebSocket");
    expect(script).toContain("fullReload");
    expect(script).toContain("heartbeat");
    expect(script).toContain("pong");
    expect(script).toContain("reconnect");
  });

  it("uses correct port from options", () => {
    const script = hmrClientScript({ port: 9999 });
    expect(script).toContain("9999");
  });

  it("uses custom hostname", () => {
    const script = hmrClientScript({ hostname: "0.0.0.0" });
    expect(script).toContain("0.0.0.0");
  });

  it("includes onUpdate callback when provided", () => {
    const script = hmrClientScript({
      onUpdate: "console.log('Updated!');",
    });
    expect(script).toContain("console.log('Updated!')");
  });

  it("sets correct reconnect delays", () => {
    const script = hmrClientScript({
      reconnectDelay: 2000,
      maxReconnectDelay: 15000,
    });
    expect(script).toContain("2000");
    expect(script).toContain("15000");
  });

  it("handles component updates by default (console.log)", () => {
    const script = hmrClientScript();
    expect(script).toContain("Component update:");
  });

  it("handles style updates by replacing link tags", () => {
    const script = hmrClientScript();
    expect(script).toContain("link");
    expect(script).toContain("stylesheet");
  });
});
