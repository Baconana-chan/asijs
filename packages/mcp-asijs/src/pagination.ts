/**
 * asijs-mcp — Cursor pagination
 *
 * `tools/list`, `resources/list` and `prompts/list` support cursor-based
 * pagination per the MCP spec. Cursors are opaque strings; the server
 * encodes the numeric offset.
 */

export interface Paginated<T> {
  items: T[];
  /** Opaque cursor for the next page — absent when this is the last page */
  nextCursor?: string;
}

const PREFIX = "asijs:";

/** Decode a cursor into an offset (1-based start index) */
export function decodeCursor(cursor?: string): number {
  if (!cursor) return 0;
  if (cursor.startsWith(PREFIX)) {
    const n = Number(cursor.slice(PREFIX.length));
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 0;
}

/** Encode an offset into an opaque cursor */
function encodeCursor(offset: number): string {
  return `${PREFIX}${offset}`;
}

/** Paginate an array — returns one page + next cursor */
export function paginate<T>(items: T[], cursor: string | undefined, pageSize: number): Paginated<T> {
  const size = Math.max(1, pageSize);
  const start = Math.min(decodeCursor(cursor), items.length);
  const page = items.slice(start, start + size);
  const nextCursor = start + page.length < items.length ? encodeCursor(start + page.length) : undefined;
  return { items: page, nextCursor };
}
