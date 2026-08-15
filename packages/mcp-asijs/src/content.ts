/**
 * asijs-mcp — Content block helpers (v2025-03-26+ content types)
 *
 * Tools can return plain values (auto-wrapped as text) or build rich
 * results with `image`, `audio`, `blob`, `resource` content blocks.
 */

import type { ContentBlock, ToolCallResult } from "./types";

/** Wrap text */
export function textContent(text: string): ContentBlock {
  return { type: "text", text };
}

/** Wrap a base64-encoded image (data is raw base64, no data: prefix) */
export function imageContent(data: string, mimeType: string): ContentBlock {
  return { type: "image", data, mimeType };
}

/** Wrap a base64-encoded audio clip */
export function audioContent(data: string, mimeType: string): ContentBlock {
  return { type: "audio", data, mimeType };
}

/** Wrap base64-encoded binary data */
export function blobContent(data: string, mimeType: string): ContentBlock {
  return { type: "blob", data, mimeType };
}

/** Wrap a reference to a resource */
export function resourceContent(uri: string, text?: string, mimeType?: string): ContentBlock {
  return { type: "resource", resource: { uri, text, mimeType } };
}

/** Serialize any value into a readable text block */
export function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Build a `tools/call` result from any handler return value.
 * Strings become text; everything else is JSON-serialized and also
 * exposed as `structuredContent`.
 */
export function toolResult(value: unknown, isError = false): ToolCallResult {
  if (value !== null && typeof value === "object" && "content" in value && Array.isArray((value as ToolCallResult).content)) {
    const existing = value as ToolCallResult;
    return { ...existing, isError: isError || existing.isError === true };
  }

  const text = stringify(value);
  return {
    content: [textContent(text)],
    structuredContent: value,
    isError,
  };
}

/** Build an error result for a failed tool call */
export function errorResult(message: string): ToolCallResult {
  return {
    content: [textContent(message)],
    isError: true,
  };
}
