/**
 * asijs-mcp — JSON-RPC 2.0 helpers
 */

import {
  JSONRPCErrorCodes,
  type JSONRPCNotification,
  type JSONRPCRequest,
  type JSONRPCResponse,
} from "./types";

/** Create a success response */
export function success(id: string | number | null, result: unknown): JSONRPCResponse {
  return { jsonrpc: "2.0", id, result };
}

/** Create an error response */
export function error(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JSONRPCResponse {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

/** Create a notification */
export function notification(method: string, params?: Record<string, unknown>): JSONRPCNotification {
  return { jsonrpc: "2.0", method, ...(params ? { params } : {}) };
}

/** True if the object looks like a JSON-RPC message */
export function isJSONRPC(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).jsonrpc === "2.0" &&
    typeof (value as Record<string, unknown>).method === "string"
  );
}

/** True if the message is a request (has an id) */
export function isRequest(msg: JSONRPCRequest | JSONRPCNotification): msg is JSONRPCRequest {
  return "id" in msg;
}

/** Parse a raw string/object into a JSON-RPC message */
export function parseMessage(
  raw: string | unknown,
): { message?: JSONRPCRequest | JSONRPCNotification; response?: JSONRPCResponse; batch?: Array<JSONRPCRequest | JSONRPCNotification> } {
  let value: unknown = raw;

  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return {
        response: error(null, JSONRPCErrorCodes.PARSE_ERROR, "Parse error"),
      };
    }
  }

  // Batch (array) of messages
  if (Array.isArray(value)) {
    const batch = value
      .map((item) => parseMessage(item))
      .map((parsed) => parsed.message)
      .filter((m): m is JSONRPCRequest | JSONRPCNotification => m !== undefined);
    return { batch };
  }

  if (!isJSONRPC(value)) {
    return { response: error(null, JSONRPCErrorCodes.INVALID_REQUEST, "Invalid Request") };
  }

  const hasId = "id" in value;
  const id = value.id as string | number | null;

  if (hasId && (typeof id !== "string" && typeof id !== "number")) {
    return { response: error(null, JSONRPCErrorCodes.INVALID_REQUEST, "Invalid Request: id must be a string or number") };
  }

  const message = value as unknown as JSONRPCRequest | JSONRPCNotification;
  return { message };
}

/** Validate that params is an object (if present) */
export function coerceParams(
  params: unknown,
): { ok: true; params: Record<string, unknown> } | { ok: false; response: JSONRPCResponse; id: string | number | null } {
  if (params === undefined || params === null) {
    return { ok: true, params: {} };
  }
  if (typeof params !== "object" || Array.isArray(params)) {
    return {
      ok: false,
      response: error(
        null,
        JSONRPCErrorCodes.INVALID_PARAMS,
        "Invalid params: expected an object",
      ),
      id: null,
    };
  }
  return { ok: true, params: params as Record<string, unknown> };
}
