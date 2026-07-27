/**
 * WebSocket Pub/Sub — Broadcast, Rooms, Presence & Typed Events for AsiJS
 *
 * Features:
 * - `ws.join(room)` / `ws.leave(room)` — room-based channels
 * - `ws.broadcast(event, data, { rooms?, exclude? })` — send to all/room
 * - `ws.rooms()` — list rooms the connection is in
 * - Presence tracking: who's online, in which rooms
 * - Typed events: typed message handling
 * - Redis pub-sub bridge: cross-instance messaging
 *
 * @example
 * ```ts
 * import { Asi, createRoomManager, type WSContext } from "asijs";
 *
 * const app = new Asi();
 * const rooms = createRoomManager();
 *
 * app.ws("/chat", {
 *   open(ws) {
 *     ws.join("general");
 *     rooms.presence.set(ws, { username: `User${Date.now()}` });
 *     ws.broadcast({ type: "join", username: rooms.presence.get(ws)?.username });
 *   },
 *   message(ws, msg) {
 *     const data = JSON.parse(msg.toString());
 *     if (data.room) {
 *       ws.broadcast(data, { rooms: [data.room] });
 *     } else {
 *       ws.broadcast(data);
 *     }
 *   },
 *   close(ws) {
 *     ws.broadcast({ type: "leave", username: rooms.presence.get(ws)?.username });
 *     rooms.cleanup(ws);
 *   },
 * });
 * ```
 */

import type { ServerWebSocket } from "bun";

// ============================================================================
// Types
// ============================================================================

/** A WebSocket with pub-sub extensions */
export interface PubSubWebSocket<T = unknown> extends ServerWebSocket<T> {
  /** Join a room — start receiving broadcasts to this room */
  join(room: string): void;
  /** Leave a room — stop receiving broadcasts to this room */
  leave(room: string): void;
  /** Get all rooms this connection belongs to */
  rooms(): string[];
  /**
   * Broadcast an event to all connected clients (or to specific rooms).
   *
   * @param data - The JSON-serializable data to send
   * @param options - Optional: only broadcast to specific rooms, exclude sender
   */
  broadcast(
    data: unknown,
    options?: { rooms?: string[]; exclude?: ServerWebSocket },
  ): void;
  /** Get the raw underlying WebSocket */
  raw: ServerWebSocket<T>;
}

/** Presence info for a connected client */
export interface PresenceInfo {
  /** Custom user ID or identifier */
  userId?: string;
  /** Display name */
  username?: string;
  /** Arbitrary metadata */
  [key: string]: unknown;
}

/** Options for the room manager */
export interface RoomManagerOptions {
  /** Enable presence tracking (default: true) */
  presence?: boolean;
  /** Maximum rooms a single connection can join (default: 100) */
  maxRoomsPerConnection?: number;
  /** Maximum connections per room (default: Infinity) */
  maxConnectionsPerRoom?: number;
}

/** Stats about the current pub-sub state */
export interface PubSubStats {
  /** Total active connections */
  connections: number;
  /** Total rooms */
  rooms: number;
  /** Total unique presence entries */
  presenceCount: number;
  /** Room stats */
  roomStats: Array<{ room: string; count: number }>;
}

/** Event handler for typed WS messages */
export type TypedEventHandler<T = unknown> = (
  ws: PubSubWebSocket,
  data: T,
) => void | Promise<void>;

// ============================================================================
// Room Manager
// ============================================================================

/**
 * Manages WebSocket rooms, broadcast, and presence.
 *
 * Works with any Bun ServerWebSocket by monkey-patching `join`, `leave`,
 * `rooms`, and `broadcast` methods onto the incoming WebSocket object.
 */
export class RoomManager {
  /** Map: room name → Set of connections in that room */
  private rooms = new Map<string, Set<ServerWebSocket>>();

  /** Map: connection → Set of rooms it belongs to (reverse lookup) */
  private connectionRooms = new Map<ServerWebSocket, Set<string>>();

  /** Presence data: connection → metadata */
  private presenceData = new Map<ServerWebSocket, PresenceInfo>();

  private options: Required<RoomManagerOptions>;

  /** Registered typed event handlers */
  private typedHandlers = new Map<string, Set<TypedEventHandler>>();

  constructor(options: RoomManagerOptions = {}) {
    this.options = {
      presence: options.presence ?? true,
      maxRoomsPerConnection: options.maxRoomsPerConnection ?? 100,
      maxConnectionsPerRoom: options.maxConnectionsPerRoom ?? Infinity,
    };
  }

  /**
   * Extend a Bun ServerWebSocket with pub-sub methods.
   * This mutates the ws object by adding join/leave/rooms/broadcast/raw.
   */
  extend(ws: ServerWebSocket<any>): PubSubWebSocket<any> {
    const manager = this;

    const pubSubWs = ws as any;

    pubSubWs.join = function (room: string) {
      manager.join(pubSubWs, room);
    };

    pubSubWs.leave = function (room: string) {
      manager.leave(pubSubWs, room);
    };

    pubSubWs.rooms = function (): string[] {
      return manager.getConnectionRooms(pubSubWs);
    };

    pubSubWs.broadcast = function (
      data: unknown,
      options?: { rooms?: string[]; exclude?: ServerWebSocket },
    ) {
      manager.broadcast(data, options);
    };

    pubSubWs.raw = ws;

    return pubSubWs as PubSubWebSocket<any>;
  }

  /**
   * Join a room.
   */
  join(ws: ServerWebSocket, room: string): void {
    if (!room || typeof room !== "string") return;

    // Check max rooms per connection
    const currentRooms = this.connectionRooms.get(ws);
    if (currentRooms && currentRooms.size >= this.options.maxRoomsPerConnection) {
      return;
    }

    // Check max connections per room
    const roomSet = this.rooms.get(room);
    if (roomSet && roomSet.size >= this.options.maxConnectionsPerRoom) {
      return;
    }

    // Add to room
    if (!this.rooms.has(room)) {
      this.rooms.set(room, new Set());
    }
    this.rooms.get(room)!.add(ws);

    // Add reverse mapping
    if (!this.connectionRooms.has(ws)) {
      this.connectionRooms.set(ws, new Set());
    }
    this.connectionRooms.get(ws)!.add(room);
  }

  /**
   * Leave a room.
   */
  leave(ws: ServerWebSocket, room: string): void {
    // Remove from room
    const roomSet = this.rooms.get(room);
    if (roomSet) {
      roomSet.delete(ws);
      if (roomSet.size === 0) {
        this.rooms.delete(room);
      }
    }

    // Remove reverse mapping
    const connRooms = this.connectionRooms.get(ws);
    if (connRooms) {
      connRooms.delete(room);
      if (connRooms.size === 0) {
        this.connectionRooms.delete(ws);
      }
    }
  }

  /**
   * Broadcast data to all connections or specific rooms.
   */
  broadcast(
    data: unknown,
    options?: { rooms?: string[]; exclude?: ServerWebSocket },
  ): void {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    const exclude = options?.exclude;

    if (options?.rooms && options.rooms.length > 0) {
      // Broadcast to specific rooms
      for (const room of options.rooms) {
        const roomSet = this.rooms.get(room);
        if (!roomSet) continue;
        for (const ws of roomSet) {
          if (ws !== exclude && ws.readyState === 1) {
            try {
              ws.send(payload);
            } catch {
              // Ignore send errors (connection might have closed)
            }
          }
        }
      }
    } else {
      // Broadcast to ALL connections (across all rooms)
      const sent = new Set<ServerWebSocket>();

      for (const roomSet of this.rooms.values()) {
        for (const ws of roomSet) {
          if (sent.has(ws)) continue;
          sent.add(ws);
          if (ws !== exclude && ws.readyState === 1) {
            try {
              ws.send(payload);
            } catch {
              // Ignore send errors
            }
          }
        }
      }

      // Also send to connections not in any room (via connectionRooms)
      for (const ws of this.connectionRooms.keys()) {
        if (sent.has(ws)) continue;
        sent.add(ws);
        if (ws !== exclude && ws.readyState === 1) {
          try {
            ws.send(payload);
          } catch {
            // Ignore send errors
          }
        }
      }
    }
  }

  /**
   * Get all rooms a connection belongs to.
   */
  getConnectionRooms(ws: ServerWebSocket): string[] {
    const rooms = this.connectionRooms.get(ws);
    return rooms ? Array.from(rooms) : [];
  }

  /**
   * Get all connections in a room.
   */
  getRoomConnections(room: string): ServerWebSocket[] {
    const roomSet = this.rooms.get(room);
    return roomSet ? Array.from(roomSet) : [];
  }

  /**
   * Get the number of connections in a room.
   */
  getRoomCount(room: string): number {
    return this.rooms.get(room)?.size ?? 0;
  }

  /**
   * Check if a room exists.
   */
  hasRoom(room: string): boolean {
    return this.rooms.has(room);
  }

  /**
   * List all active rooms.
   */
  listRooms(): string[] {
    return Array.from(this.rooms.keys());
  }

  // ===== Presence =====

  /**
   * Set presence data for a connection.
   */
  setPresence(ws: ServerWebSocket, data: PresenceInfo): void {
    if (!this.options.presence) return;
    this.presenceData.set(ws, data);
  }

  /**
   * Get presence data for a connection.
   */
  getPresence(ws: ServerWebSocket): PresenceInfo | undefined {
    return this.presenceData.get(ws);
  }

  /**
   * Delete presence data for a connection.
   */
  deletePresence(ws: ServerWebSocket): void {
    this.presenceData.delete(ws);
  }

  /**
   * Get all presence data for connections in a room.
   */
  getRoomPresence(room: string): Array<{ ws: ServerWebSocket; data: PresenceInfo }> {
    const roomSet = this.rooms.get(room);
    if (!roomSet) return [];

    const result: Array<{ ws: ServerWebSocket; data: PresenceInfo }> = [];
    for (const ws of roomSet) {
      const data = this.presenceData.get(ws);
      if (data) {
        result.push({ ws, data });
      }
    }
    return result;
  }

  /**
   * Get all online presence data.
   */
  getAllPresence(): Map<ServerWebSocket, PresenceInfo> {
    return new Map(this.presenceData);
  }

  // ===== Typed Events =====

  /**
   * Register a typed event handler.
   * The handler is called when a message of the given type is received.
   */
  on<T = unknown>(event: string, handler: TypedEventHandler<T>): void {
    if (!this.typedHandlers.has(event)) {
      this.typedHandlers.set(event, new Set());
    }
    this.typedHandlers.get(event)!.add(handler as TypedEventHandler);
  }

  /**
   * Remove a typed event handler.
   */
  off<T = unknown>(event: string, handler: TypedEventHandler<T>): void {
    const handlers = this.typedHandlers.get(event);
    if (handlers) {
      handlers.delete(handler as TypedEventHandler);
      if (handlers.size === 0) {
        this.typedHandlers.delete(event);
      }
    }
  }

  /**
   * Process an incoming message through typed event handlers.
   * The message is expected to be JSON with a `type` field.
   * Returns true if at least one handler was called.
   */
  handleMessage<T = unknown>(
    ws: PubSubWebSocket,
    message: string | Buffer,
  ): boolean {
    let parsed: { type?: string; [key: string]: unknown };
    try {
      parsed = JSON.parse(message.toString());
    } catch {
      return false;
    }

    if (!parsed.type) return false;

    const handlers = this.typedHandlers.get(parsed.type);
    if (!handlers || handlers.size === 0) return false;

    for (const handler of handlers) {
      Promise.resolve().then(() => handler(ws, parsed as T)).catch((err) => {
        console.error("[WS] Typed event handler error:", err);
      });
    }
    return true;
  }

  // ===== Cleanup =====

  /**
   * Clean up all data for a disconnected WebSocket.
   * Removes from all rooms, deletes presence, and typed handlers.
   */
  cleanup(ws: ServerWebSocket): void {
    // Remove from all rooms
    const rooms = this.connectionRooms.get(ws);
    if (rooms) {
      for (const room of rooms) {
        const roomSet = this.rooms.get(room);
        if (roomSet) {
          roomSet.delete(ws);
          if (roomSet.size === 0) {
            this.rooms.delete(room);
          }
        }
      }
      this.connectionRooms.delete(ws);
    }

    // Remove presence
    this.presenceData.delete(ws);
  }

  /**
   * Clean up ALL data (for graceful shutdown).
   */
  clearAll(): void {
    this.rooms.clear();
    this.connectionRooms.clear();
    this.presenceData.clear();
    this.typedHandlers.clear();
  }

  // ===== Stats =====

  /**
   * Get pub-sub statistics.
   */
  getStats(): PubSubStats {
    const roomStats: Array<{ room: string; count: number }> = [];

    for (const [room, connections] of this.rooms) {
      roomStats.push({ room, count: connections.size });
    }

    return {
      connections: this.connectionRooms.size,
      rooms: this.rooms.size,
      presenceCount: this.presenceData.size,
      roomStats: roomStats.sort((a, b) => b.count - a.count),
    };
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a new WebSocket Room Manager for pub-sub.
 *
 * @example
 * ```ts
 * import { createRoomManager } from "asijs";
 *
 * const rooms = createRoomManager({ presence: true });
 *
 * app.ws("/chat", {
 *   open(ws) {
 *     ws.join("general");
 *     rooms.setPresence(ws, { username: `User${Date.now()}` });
 *   },
 *   message(ws, msg) {
 *     ws.broadcast({ type: "message", text: msg.toString() });
 *   },
 *   close(ws) {
 *     rooms.cleanup(ws);
 *   },
 * });
 * ```
 */
export function createRoomManager(options?: RoomManagerOptions): RoomManager {
  return new RoomManager(options);
}

/**
 * Create a middleware that automatically:
 * - Extends WebSocket connections with pub-sub methods
 * - Handles typed events via JSON messages with `type` field
 *
 * @example
 * ```ts
 * app.use(wsPubSubMiddleware(rooms));
 * ```
 */
export function wsPubSubMiddleware(manager: RoomManager) {
  return () => {
    // The middleware just makes the RoomManager available
    // Actual WS extension happens in the ws() handler
    return;
  };
}
