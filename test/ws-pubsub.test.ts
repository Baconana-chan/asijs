import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import {
  RoomManager,
  createRoomManager,
  type PubSubWebSocket,
} from "../src/ws-pubsub";

/** Create a mock ServerWebSocket for testing */
function mockWs(id = "ws-" + Math.random().toString(36).slice(2)): any {
  return {
    id,
    readyState: 1, // OPEN
    send: (data: string) => {},
    close: () => {},
    terminate: () => {},
    data: {},
    remoteAddress: "127.0.0.1",
    binaryType: "arraybuffer",
  };
}

describe("RoomManager", () => {
  let manager: RoomManager;

  beforeEach(() => {
    manager = createRoomManager();
  });

  afterEach(() => {
    manager.clearAll();
  });

  describe("join / leave", () => {
    it("should join a room", () => {
      const ws = mockWs();
      manager.join(ws, "general");

      expect(manager.getConnectionRooms(ws)).toContain("general");
      expect(manager.getRoomCount("general")).toBe(1);
      expect(manager.hasRoom("general")).toBe(true);
    });

    it("should join multiple rooms", () => {
      const ws = mockWs();
      manager.join(ws, "room1");
      manager.join(ws, "room2");
      manager.join(ws, "room3");

      expect(manager.getConnectionRooms(ws).length).toBe(3);
      expect(manager.getRoomCount("room1")).toBe(1);
      expect(manager.getRoomCount("room2")).toBe(1);
    });

    it("should leave a room", () => {
      const ws = mockWs();
      manager.join(ws, "general");
      manager.join(ws, "random");
      manager.leave(ws, "general");

      expect(manager.getConnectionRooms(ws)).not.toContain("general");
      expect(manager.getConnectionRooms(ws)).toContain("random");
      expect(manager.hasRoom("general")).toBe(false);
    });

    it("should handle multiple connections in same room", () => {
      const ws1 = mockWs();
      const ws2 = mockWs();
      const ws3 = mockWs();

      manager.join(ws1, "general");
      manager.join(ws2, "general");
      manager.join(ws3, "general");

      expect(manager.getRoomCount("general")).toBe(3);

      manager.leave(ws2, "general");
      expect(manager.getRoomCount("general")).toBe(2);
    });

    it("should ignore invalid room names", () => {
      const ws = mockWs();
      manager.join(ws, "");
      manager.join(ws, null as any);
      manager.join(ws, undefined as any);

      expect(manager.getConnectionRooms(ws).length).toBe(0);
    });
  });

  describe("extend method", () => {
    it("should extend a WebSocket with pub-sub methods", () => {
      const ws = mockWs();
      const extended = manager.extend(ws);

      expect(typeof extended.join).toBe("function");
      expect(typeof extended.leave).toBe("function");
      expect(typeof extended.rooms).toBe("function");
      expect(typeof extended.broadcast).toBe("function");
      expect(extended.raw).toBe(ws);
    });

    it("extended ws should join/leave rooms via methods", () => {
      const ws = mockWs();
      const extended = manager.extend(ws);

      extended.join("general");
      expect(extended.rooms()).toContain("general");

      extended.join("random");
      expect(extended.rooms().length).toBe(2);

      extended.leave("general");
      expect(extended.rooms()).not.toContain("general");
    });

    it("extended ws should have raw property", () => {
      const ws = mockWs("test-123");
      const extended = manager.extend(ws);
      expect(extended.raw.data).toEqual(ws.data);
    });
  });

  describe("broadcast", () => {
    it("should broadcast to all connections", () => {
      const ws1 = mockWs();
      const ws2 = mockWs();
      const ws3 = mockWs();

      const sent: string[] = [];
      ws1.send = (d: string) => sent.push("ws1:" + d);
      ws2.send = (d: string) => sent.push("ws2:" + d);
      ws3.send = (d: string) => sent.push("ws3:" + d);

      manager.join(ws1, "general");
      manager.join(ws2, "general");
      manager.join(ws3, "random");

      manager.broadcast({ type: "test", message: "hello" });

      // ws3 is in a different room but should still receive (broadcast to ALL)
      expect(sent.length).toBeGreaterThanOrEqual(3);
    });

    it("should broadcast to specific rooms only", () => {
      const ws1 = mockWs();
      const ws2 = mockWs();
      const ws3 = mockWs();

      const sent: string[] = [];
      ws1.send = (d: string) => sent.push("ws1:" + d);
      ws2.send = (d: string) => sent.push("ws2:" + d);
      ws3.send = (d: string) => sent.push("ws3:" + d);

      manager.join(ws1, "general");
      manager.join(ws2, "general");
      manager.join(ws3, "random");

      manager.broadcast("room-only", { rooms: ["general"] });

      expect(sent.length).toBe(2);
      expect(sent.some((s) => s.startsWith("ws1:"))).toBe(true);
      expect(sent.some((s) => s.startsWith("ws2:"))).toBe(true);
      expect(sent.some((s) => s.startsWith("ws3:"))).toBe(false);
    });

    it("should exclude sender when specified", () => {
      const ws1 = mockWs();
      const ws2 = mockWs();
      const ws3 = mockWs();

      const sent: string[] = [];
      ws1.send = (d: string) => sent.push("ws1:" + d);
      ws2.send = (d: string) => sent.push("ws2:" + d);
      ws3.send = (d: string) => sent.push("ws3:" + d);

      manager.join(ws1, "general");
      manager.join(ws2, "general");
      manager.join(ws3, "general");

      manager.broadcast("exclude-test", { exclude: ws2 });

      expect(sent.some((s) => s.startsWith("ws1:"))).toBe(true);
      expect(sent.some((s) => s.startsWith("ws2:"))).toBe(false);
      expect(sent.some((s) => s.startsWith("ws3:"))).toBe(true);
    });
  });

  describe("presence", () => {
    it("should set and get presence data", () => {
      const ws = mockWs();
      const presence = { userId: "user-1", username: "Alice" };

      manager.setPresence(ws, presence);
      expect(manager.getPresence(ws)).toEqual(presence);
    });

    it("should delete presence data", () => {
      const ws = mockWs();
      manager.setPresence(ws, { username: "Bob" });
      manager.deletePresence(ws);
      expect(manager.getPresence(ws)).toBeUndefined();
    });

    it("should get room presence", () => {
      const ws1 = mockWs();
      const ws2 = mockWs();

      manager.join(ws1, "general");
      manager.join(ws2, "general");
      manager.setPresence(ws1, { username: "Alice" });
      manager.setPresence(ws2, { username: "Bob" });

      const presence = manager.getRoomPresence("general");
      expect(presence.length).toBe(2);
      expect(presence.find((p) => p.data.username === "Alice")).toBeTruthy();
      expect(presence.find((p) => p.data.username === "Bob")).toBeTruthy();
    });

    it("should get all presence data", () => {
      const ws1 = mockWs();
      const ws2 = mockWs();
      manager.setPresence(ws1, { userId: "1" });
      manager.setPresence(ws2, { userId: "2" });

      const all = manager.getAllPresence();
      expect(all.size).toBe(2);
    });
  });

  describe("typed events", () => {
    it("should handle typed events via on/off", async () => {
      const ws = mockWs();
      const extended = manager.extend(ws);
      const received: any[] = [];

      const handler = (w: any, data: any) => {
        received.push(data);
      };

      manager.on("chat", handler);
      const handled = manager.handleMessage(extended, JSON.stringify({
        type: "chat",
        text: "Hello!",
      }));

      // Wait for promise resolution
      await new Promise((r) => setTimeout(r, 10));
      expect(handled).toBe(true);
      expect(received.length).toBe(1);
      expect(received[0].text).toBe("Hello!");
    });

    it("should not handle messages without type field", () => {
      const ws = mockWs();
      const extended = manager.extend(ws);

      const handled = manager.handleMessage(extended, JSON.stringify({
        text: "no type",
      }));
      expect(handled).toBe(false);
    });

    it("should not handle invalid JSON", () => {
      const ws = mockWs();
      const extended = manager.extend(ws);

      const handled = manager.handleMessage(extended, "not-json");
      expect(handled).toBe(false);
    });

    it("should remove handlers via off()", () => {
      const ws = mockWs();
      const extended = manager.extend(ws);
      let called = false;

      const handler = () => { called = true; };
      manager.on("test", handler);
      manager.off("test", handler);

      manager.handleMessage(extended, JSON.stringify({ type: "test" }));
      expect(called).toBe(false);
    });
  });

  describe("cleanup", () => {
    it("should clean up all data for a disconnected ws", () => {
      const ws = mockWs();

      manager.join(ws, "room1");
      manager.join(ws, "room2");
      manager.setPresence(ws, { username: "Test" });

      manager.cleanup(ws);

      expect(manager.getConnectionRooms(ws).length).toBe(0);
      expect(manager.getPresence(ws)).toBeUndefined();
      expect(manager.hasRoom("room1")).toBe(false);
      expect(manager.hasRoom("room2")).toBe(false);
    });

    it("should clear all data", () => {
      const ws1 = mockWs();
      const ws2 = mockWs();

      manager.join(ws1, "room1");
      manager.join(ws2, "room2");
      manager.setPresence(ws1, { username: "A" });
      manager.setPresence(ws2, { username: "B" });

      manager.clearAll();

      expect(manager.getStats().connections).toBe(0);
      expect(manager.getStats().rooms).toBe(0);
      expect(manager.getStats().presenceCount).toBe(0);
    });
  });

  describe("stats", () => {
    it("should return correct stats", () => {
      const ws1 = mockWs();
      const ws2 = mockWs();

      manager.join(ws1, "general");
      manager.join(ws2, "general");
      manager.join(ws2, "random");
      manager.setPresence(ws1, { username: "A" });

      const stats = manager.getStats();
      expect(stats.connections).toBe(2);
      expect(stats.rooms).toBe(2);
      expect(stats.presenceCount).toBe(1);
      expect(stats.roomStats.length).toBe(2);

      // Most populated room first
      expect(stats.roomStats[0].room).toBe("general");
      expect(stats.roomStats[0].count).toBe(2);
    });
  });

  describe("createRoomManager factory", () => {
    it("should create a RoomManager with default options", () => {
      const rm = createRoomManager();
      expect(rm).toBeInstanceOf(RoomManager);
    });

    it("should create with custom options", () => {
      const rm = createRoomManager({
        presence: false,
        maxRoomsPerConnection: 5,
        maxConnectionsPerRoom: 10,
      });
      expect(rm).toBeInstanceOf(RoomManager);

      // Should still work
      const ws = mockWs();
      rm.join(ws, "test");
      expect(rm.getRoomCount("test")).toBe(1);
    });

    it("should limit maxRoomsPerConnection", () => {
      const rm = createRoomManager({ maxRoomsPerConnection: 2 });
      const ws = mockWs();

      rm.join(ws, "room1");
      rm.join(ws, "room2");
      rm.join(ws, "room3"); // should be rejected

      expect(rm.getConnectionRooms(ws).length).toBe(2);
    });
  });
});
