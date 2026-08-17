/**
 * Dev Error Page — Beautiful error pages for development mode
 *
 * Inspired by Laravel Ignition and Phoenix's error pages.
 * Shows stack trace with code context, request variables, and route suggestions.
 *
 * @example
 * ```ts
 * import { Asi } from "asijs";
 *
 * const app = new Asi({ development: true });
 * // Error pages are automatically enhanced in dev mode
 * ```
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// ===== Types =====

/** Context for the pretty dev-mode error page. */
export interface DevErrorPageContext {
  /** HTTP status code */
  status: number;
  /** HTTP method */
  method: string;
  /** Request path */
  path: string;
  /** Request headers */
  headers?: Record<string, string>;
  /** Query parameters */
  query?: Record<string, string>;
  /** Request body (as string) */
  body?: string;
  /** Route suggestions (for 404) */
  suggestions?: string[];
}

/** One parsed stack frame for display. */
export interface StackFrame {
  /** Function name */
  function: string;
  /** File path */
  file: string;
  /** Line number */
  line: number;
  /** Column number */
  column: number;
  /** Whether this is a user frame (inside project, not node_modules) */
  isUserFrame: boolean;
  /** Source code lines around this frame */
  codeContext?: CodeContext;
}

/** Source snippet around an error location. */
export interface CodeContext {
  /** Lines before the error */
  before: Array<{ line: number; content: string }>;
  /** The line where the error occurred */
  line: { line: number; content: string };
  /** Lines after the error */
  after: Array<{ line: number; content: string }>;
}

// ===== Stack Trace Parsing =====

/** Parse a V8-style stack trace into frames */
function parseStackFrames(stack: string): StackFrame[] {
  const lines = stack.split("\n");
  const frames: StackFrame[] = [];

  for (const line of lines) {
    // Match: "at functionName (/path/to/file.ts:line:col)"
    // or: "at /path/to/file.ts:line:col"
    const match = line.match(
      /^\s+at\s+(?:(.+?)\s+\()?(?:(.+?):(\d+):(\d+))\)?$/,
    );

    if (match) {
      const [, funcName, filePath, lineStr, colStr] = match;
      const file = filePath || "";
      const line = parseInt(lineStr, 10) || 0;
      const column = parseInt(colStr, 10) || 0;
      const isUserFrame =
        file.includes(process.cwd()) &&
        !file.includes("node_modules") &&
        !file.includes("bun.run") &&
        !file.includes("<anonymous>");

      frames.push({
        function: funcName?.trim() || "<anonymous>",
        file,
        line,
        column,
        isUserFrame,
      });
    } else {
      // Try to match: "at async functionName (/path)"
      const asyncMatch = line.match(
        /^\s+at\s+async\s+(?:(.+?)\s+\()?(?:(.+?):(\d+):(\d+))\)?$/,
      );
      if (asyncMatch) {
        const [, funcName, filePath, lineStr, colStr] = asyncMatch;
        frames.push({
          function: `async ${funcName?.trim() || "<anonymous>"}`,
          file: filePath || "",
          line: parseInt(lineStr, 10) || 0,
          column: parseInt(colStr, 10) || 0,
          isUserFrame:
            (filePath || "").includes(process.cwd()) &&
            !(filePath || "").includes("node_modules"),
        });
      }
    }
  }

  return frames;
}

/** Read source code context around a specific line */
function readCodeContext(
  filePath: string,
  lineNumber: number,
  contextLines = 5,
): CodeContext | null {
  try {
    const resolvedPath = resolve(filePath);
    if (!existsSync(resolvedPath)) return null;

    const content = readFileSync(resolvedPath, "utf-8");
    const lines = content.split("\n");
    const idx = lineNumber - 1; // zero-based

    if (idx < 0 || idx >= lines.length) return null;

    const beforeStart = Math.max(0, idx - contextLines);
    const afterEnd = Math.min(lines.length - 1, idx + contextLines);

    const before: Array<{ line: number; content: string }> = [];
    for (let i = beforeStart; i < idx; i++) {
      before.push({ line: i + 1, content: lines[i] });
    }

    const after: Array<{ line: number; content: string }> = [];
    for (let i = idx + 1; i <= afterEnd; i++) {
      after.push({ line: i + 1, content: lines[i] });
    }

    return {
      before,
      line: { line: lineNumber, content: lines[idx] },
      after,
    };
  } catch {
    return null;
  }
}

// ===== HTML Sanitization =====

/** Escape HTML special characters */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/** Highlight code syntax (basic TypeScript highlighting) */
function highlightCode(code: string): string {
  // Simple keyword-based syntax highlighting
  return code
    .replace(
      /\b(import|export|from|const|let|var|function|async|await|return|if|else|for|while|class|type|interface|extends|implements|new|throw|try|catch|finally|true|false|null|undefined)\b/g,
      '<span class="kw">$1</span>',
    )
    .replace(
      /\/\/.*$/gm,
      (m) => `<span class="cm">${escapeHtml(m)}</span>`,
    )
    .replace(
      /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g,
      (m) => `<span class="str">${escapeHtml(m)}</span>`,
    )
    .replace(
      /\b(\d+(?:\.\d+)?)\b/g,
      '<span class="num">$1</span>',
    )
    .replace(
      /(\/\*[\s\S]*?\*\/)/g,
      (m) => `<span class="cm">${escapeHtml(m)}</span>`,
    );
}

// ===== CSS Styles =====

const ERROR_PAGE_STYLES = `
* { box-sizing: border-box; margin: 0; padding: 0; }
html { font-size: 16px; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  background: #0a0e14;
  color: #e6e1cf;
  line-height: 1.6;
  min-height: 100vh;
}

/* Error Header */
.error-header {
  background: linear-gradient(135deg, #1a0a0a 0%, #2d0a0a 50%, #1a0a1a 100%);
  border-bottom: 1px solid rgba(255, 60, 60, 0.2);
  padding: 40px 32px;
  position: relative;
  overflow: hidden;
}

.error-header::before {
  content: "";
  position: absolute;
  top: -50%;
  right: -20%;
  width: 400px;
  height: 400px;
  background: radial-gradient(circle, rgba(255, 60, 60, 0.06) 0%, transparent 70%);
  border-radius: 50%;
}

.error-header .badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(255, 60, 60, 0.15);
  border: 1px solid rgba(255, 60, 60, 0.3);
  color: #ff6b6b;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  margin-bottom: 16px;
}

.error-header h1 {
  font-size: clamp(1.5rem, 4vw, 2.5rem);
  font-weight: 800;
  letter-spacing: -0.03em;
  color: #ffe0e0;
  margin-bottom: 8px;
  position: relative;
}

.error-header .error-message {
  font-size: 1rem;
  color: rgba(255, 224, 224, 0.7);
  font-family: "SF Mono", "JetBrains Mono", "Fira Code", monospace;
  word-break: break-word;
  max-width: 800px;
}

/* Error meta row */
.error-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 16px 32px;
  background: rgba(255, 255, 255, 0.02);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.error-meta .tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 13px;
  font-family: "SF Mono", "JetBrains Mono", monospace;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(230, 225, 207, 0.8);
}

.error-meta .tag .label {
  color: rgba(230, 225, 207, 0.4);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.error-meta .method-GET { background: rgba(35, 134, 54, 0.2); border-color: rgba(35, 134, 54, 0.3); color: #3fb950; }
.error-meta .method-POST { background: rgba(31, 111, 235, 0.2); border-color: rgba(31, 111, 235, 0.3); color: #58a6ff; }
.error-meta .method-PUT { background: rgba(158, 106, 3, 0.2); border-color: rgba(158, 106, 3, 0.3); color: #d29922; }
.error-meta .method-DELETE { background: rgba(218, 54, 51, 0.2); border-color: rgba(218, 54, 51, 0.3); color: #f85149; }
.error-meta .method-PATCH { background: rgba(137, 87, 229, 0.2); border-color: rgba(137, 87, 229, 0.3); color: #a371f7; }

/* Content layout */
.content {
  display: grid;
  grid-template-columns: 1fr 360px;
  gap: 0;
  min-height: calc(100vh - 160px);
}

@media (max-width: 900px) {
  .content {
    grid-template-columns: 1fr;
  }
}

/* Stack Trace Panel */
.stack-panel {
  padding: 24px 32px;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  overflow-x: auto;
}

.stack-panel h2 {
  font-size: 14px;
  font-weight: 600;
  color: rgba(230, 225, 207, 0.5);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 16px;
}

/* Stack Frame */
.frame {
  margin-bottom: 8px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  overflow: hidden;
  transition: border-color 0.2s;
}

.frame:hover {
  border-color: rgba(255, 255, 255, 0.12);
}

.frame.user-frame {
  border-color: rgba(124, 156, 255, 0.15);
}

.frame.user-frame:hover {
  border-color: rgba(124, 156, 255, 0.3);
}

.frame-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.02);
  user-select: none;
  transition: background 0.15s;
}

.frame-header:hover {
  background: rgba(255, 255, 255, 0.04);
}

.frame-header .func-name {
  flex: 1;
  font-family: "SF Mono", "JetBrains Mono", monospace;
  font-size: 13px;
  color: #e6e1cf;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.frame-header .file-location {
  font-family: "SF Mono", "JetBrains Mono", monospace;
  font-size: 12px;
  color: rgba(230, 225, 207, 0.4);
  white-space: nowrap;
}

.frame-header .line-no {
  color: rgba(230, 225, 207, 0.6);
  font-weight: 600;
}

.frame-header .expand-icon {
  color: rgba(230, 225, 207, 0.3);
  transition: transform 0.2s;
  font-size: 12px;
}

.frame-header .expand-icon.expanded {
  transform: rotate(90deg);
}

/* Code Context */
.code-context {
  display: none;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  background: #0d1117;
  overflow-x: auto;
}

.code-context.expanded {
  display: block;
}

.code-context table {
  width: 100%;
  border-collapse: collapse;
  font-family: "SF Mono", "JetBrains Mono", "Fira Code", monospace;
  font-size: 13px;
  line-height: 1.5;
}

.code-context td {
  padding: 0;
  vertical-align: top;
  white-space: pre;
}

.code-context .line-num {
  width: 60px;
  min-width: 60px;
  padding: 0 12px 0 16px;
  text-align: right;
  color: rgba(230, 225, 207, 0.2);
  user-select: none;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
}

.code-context .line-code {
  padding: 0 16px;
  color: rgba(230, 225, 207, 0.6);
}

.code-context .line-error {
  background: rgba(255, 60, 60, 0.1);
}

.code-context .line-error .line-num {
  color: #ff6b6b;
  background: rgba(255, 60, 60, 0.15);
  border-right-color: rgba(255, 60, 60, 0.3);
}

.code-context .line-error .line-code {
  color: #ffe0e0;
}

.code-context .kw { color: #c9a0ff; }
.code-context .str { color: #99d066; }
.code-context .num { color: #d4874a; }
.code-context .cm { color: rgba(230, 225, 207, 0.3); font-style: italic; }

/* Sidebar */
.sidebar {
  background: rgba(255, 255, 255, 0.02);
  padding: 24px;
  overflow-y: auto;
}

.sidebar-section {
  margin-bottom: 24px;
}

.sidebar-section h3 {
  font-size: 12px;
  font-weight: 600;
  color: rgba(230, 225, 207, 0.4);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.sidebar-section .detail-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  font-size: 13px;
}

.sidebar-section .detail-row .key {
  color: rgba(230, 225, 207, 0.4);
}

.sidebar-section .detail-row .value {
  color: rgba(230, 225, 207, 0.8);
  font-family: "SF Mono", monospace;
  font-size: 12px;
  text-align: right;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-section .header-table {
  width: 100%;
  font-size: 12px;
  font-family: "SF Mono", monospace;
  border-collapse: collapse;
}

.sidebar-section .header-table td {
  padding: 3px 0;
  vertical-align: top;
}

.sidebar-section .header-table .h-key {
  color: rgba(230, 225, 207, 0.4);
  padding-right: 12px;
  white-space: nowrap;
}

.sidebar-section .header-table .h-value {
  color: rgba(230, 225, 207, 0.6);
  word-break: break-all;
}

.sidebar-section .suggestion-list {
  list-style: none;
}

.sidebar-section .suggestion-list li {
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(124, 156, 255, 0.08);
  border: 1px solid rgba(124, 156, 255, 0.15);
  font-family: "SF Mono", monospace;
  font-size: 12px;
  color: #7c9cff;
  margin-bottom: 4px;
}

.sidebar-section .body-preview {
  background: #0d1117;
  border-radius: 6px;
  padding: 12px;
  font-family: "SF Mono", monospace;
  font-size: 12px;
  color: rgba(230, 225, 207, 0.6);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 200px;
  overflow-y: auto;
}

/* Copy button */
.copy-btn {
  position: absolute;
  top: 16px;
  right: 32px;
  padding: 6px 14px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(230, 225, 207, 0.6);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.copy-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #e6e1cf;
}

.copy-btn.copied {
  background: rgba(35, 134, 54, 0.2);
  border-color: rgba(35, 134, 54, 0.3);
  color: #3fb950;
}

/* 404 specific */
.not-found-header {
  background: linear-gradient(135deg, #0a0a1a 0%, #0a1a2d 50%, #0a0a1a 100%);
  border-bottom: 1px solid rgba(124, 156, 255, 0.15);
}

.not-found-header .badge {
  background: rgba(124, 156, 255, 0.15);
  border-color: rgba(124, 156, 255, 0.3);
  color: #7c9cff;
}

.not-found-header h1 {
  color: #d0dcff;
}

.not-found-header .error-message {
  color: rgba(208, 220, 255, 0.6);
}

/* Environment info */
.env-info {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 32px;
  background: rgba(255, 255, 255, 0.01);
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.env-info .env-tag {
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.04);
  font-size: 11px;
  font-family: "SF Mono", monospace;
  color: rgba(230, 225, 207, 0.3);
}
`;

// ===== JavaScript for Interactivity =====

const ERROR_PAGE_SCRIPT = `
function toggleFrame(header) {
  const codeContext = header.nextElementSibling;
  const icon = header.querySelector('.expand-icon');
  if (codeContext) {
    codeContext.classList.toggle('expanded');
    icon.classList.toggle('expanded');
  }
}

function copyErrorInfo() {
  const text = document.getElementById('error-text')?.textContent || '';
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copy-btn');
    if (btn) {
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = 'Copy error';
        btn.classList.remove('copied');
      }, 2000);
    }
  }).catch(() => {});
}

// Auto-expand user frames on load
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.frame.user-frame .frame-header').forEach(h => {
    const codeContext = h.nextElementSibling;
    const icon = h.querySelector('.expand-icon');
    if (codeContext) {
      codeContext.classList.add('expanded');
      if (icon) icon.classList.add('expanded');
    }
  });
});
`;

// ===== Render Functions =====

/** Format stack frame file path — shorten to relative */
function shortenPath(file: string): string {
  const cwd = process.cwd();
  if (file.startsWith(cwd)) {
    return "." + file.slice(cwd.length);
  }
  if (file.includes("node_modules")) {
    const parts = file.split("node_modules/");
    return `node_modules/${parts[parts.length - 1]}`;
  }
  return file;
}

/** Render a single stack frame as HTML */
function renderFrameHtml(frame: StackFrame, index: number): string {
  const userClass = frame.isUserFrame ? "user-frame" : "";
  const codeHtml = frame.codeContext
    ? renderCodeContext(frame.codeContext)
    : "";

  const funcName = escapeHtml(frame.function);
  const filePath = escapeHtml(shortenPath(frame.file));
  const hasCode = codeHtml ? "" : "";

  return `
    <div class="frame ${userClass}">
      <div class="frame-header" onclick="toggleFrame(this)">
        <span class="func-name" title="${escapeHtml(frame.file)}:${frame.line}:${frame.column}">${funcName}</span>
        <span class="file-location">
          ${filePath}:<span class="line-no">${frame.line}</span>
        </span>
        <span class="expand-icon">▶</span>
      </div>
      ${codeHtml ? `<div class="code-context">${codeHtml}</div>` : ""}
    </div>
  `;
}

/** Render code context as an HTML table */
function renderCodeContext(ctx: CodeContext): string {
  let html = '<table>';

  for (const line of ctx.before) {
    html += `<tr>
      <td class="line-num">${line.line}</td>
      <td class="line-code">${highlightCode(escapeHtml(line.content))}</td>
    </tr>`;
  }

  // Error line — highlighted
  html += `<tr class="line-error">
    <td class="line-num">${ctx.line.line}</td>
    <td class="line-code">${highlightCode(escapeHtml(ctx.line.content))}</td>
  </tr>`;

  for (const line of ctx.after) {
    html += `<tr>
      <td class="line-num">${line.line}</td>
      <td class="line-code">${highlightCode(escapeHtml(line.content))}</td>
    </tr>`;
  }

  html += "</table>";
  return html;
}

/** Render request headers table */
function renderHeadersHtml(headers: Record<string, string>): string {
  const entries = Object.entries(headers);
  if (entries.length === 0) return '<span style="color: rgba(230,225,207,0.3); font-size: 12px;">No headers</span>';

  let html = '<table class="header-table">';
  for (const [key, value] of entries) {
    html += `<tr>
      <td class="h-key">${escapeHtml(key)}</td>
      <td class="h-value">${escapeHtml(value)}</td>
    </tr>`;
  }
  html += "</table>";
  return html;
}

/** Render route suggestions */
function renderSuggestions(suggestions: string[]): string {
  if (!suggestions || suggestions.length === 0) return "";

  let html = '<div class="sidebar-section"><h3>Similar Routes</h3><ul class="suggestion-list">';
  for (const s of suggestions) {
    html += `<li>${escapeHtml(s)}</li>`;
  }
  html += "</ul></div>";
  return html;
}

/** Format error text for clipboard */
function formatErrorText(
  error: Error,
  frames: StackFrame[],
  ctx: DevErrorPageContext,
): string {
  let text = `${error.name}: ${error.message}\n\n`;

  for (const frame of frames) {
    text += `  at ${frame.function} (${frame.file}:${frame.line}:${frame.column})\n`;
  }

  text += `\n${ctx.method} ${ctx.path} — ${ctx.status}`;
  return text;
}

// ===== Main Export =====

/**
 * Render a pretty dev error page for 500 errors
 */
export function renderDevErrorPage(
  error: Error,
  ctx: DevErrorPageContext,
): Response {
  const stack = error.stack || "";
  const frames = parseStackFrames(stack);

  // Read code context for user frames
  for (const frame of frames) {
    if (frame.isUserFrame) {
      frame.codeContext = readCodeContext(frame.file, frame.line) ?? undefined;
    }
  }

  const errorText = formatErrorText(error, frames, ctx);
  const methodClass = `method-${ctx.method}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${ctx.status} — ${escapeHtml(error.name)}</title>
  <style>${ERROR_PAGE_STYLES}</style>
</head>
<body>
  <div class="error-header">
    <div class="badge">⚠️ AsiJS Dev Error</div>
    <h1>${escapeHtml(error.name)}</h1>
    <div class="error-message" id="error-text">${escapeHtml(error.message)}</div>
    <button class="copy-btn" id="copy-btn" onclick="copyErrorInfo()">Copy error</button>
  </div>

  <div class="error-meta">
    <span class="tag ${methodClass}">
      <span class="label">Method</span> ${ctx.method}
    </span>
    <span class="tag">
      <span class="label">Path</span> ${escapeHtml(ctx.path)}
    </span>
    <span class="tag">
      <span class="label">Status</span> ${ctx.status}
    </span>
    <span class="tag">
      <span class="label">Time</span> ${new Date().toLocaleTimeString()}
    </span>
  </div>

  <div class="env-info">
    <span class="env-tag">Bun ${typeof Bun !== "undefined" ? Bun.version : "N/A"}</span>
    <span class="env-tag">AsiJS v1.1.1</span>
    <span class="env-tag">${process.cwd()}</span>
  </div>

  <div class="content">
    <div class="stack-panel">
      <h2>Stack Trace (${frames.length} frames)</h2>
      ${frames.map((frame, i) => renderFrameHtml(frame, i)).join("")}
      ${frames.length === 0 ? '<p style="color: rgba(230,225,207,0.3);">No stack trace available</p>' : ""}
    </div>

    <div class="sidebar">
      ${ctx.suggestions && ctx.suggestions.length > 0 ? renderSuggestions(ctx.suggestions) : ""}

      <div class="sidebar-section">
        <h3>Query Parameters</h3>
        ${ctx.query && Object.keys(ctx.query).length > 0
          ? renderHeadersHtml(ctx.query)
          : '<span style="color: rgba(230,225,207,0.3); font-size: 12px;">No query parameters</span>'}
      </div>

      <div class="sidebar-section">
        <h3>Request Headers</h3>
        ${ctx.headers ? renderHeadersHtml(ctx.headers) : '<span style="color: rgba(230,225,207,0.3); font-size: 12px;">No headers</span>'}
      </div>

      ${ctx.body
        ? `<div class="sidebar-section">
            <h3>Request Body</h3>
            <div class="body-preview">${escapeHtml(ctx.body)}</div>
          </div>`
        : ""}

      <div class="sidebar-section">
        <h3>Environment</h3>
        <div class="detail-row">
          <span class="key">Runtime</span>
          <span class="value">${typeof Bun !== "undefined" ? `Bun ${Bun.version}` : typeof process !== "undefined" ? `Node.js ${process.versions?.node || "?"}` : "Unknown"}</span>
        </div>
        <div class="detail-row">
          <span class="key">CWD</span>
          <span class="value" title="${escapeHtml(process.cwd())}">${escapeHtml(shortenPath(process.cwd()))}</span>
        </div>
        <div class="detail-row">
          <span class="key">Platform</span>
          <span class="value">${typeof process !== "undefined" ? process.platform : "?"}</span>
        </div>
      </div>
    </div>
  </div>

  <script>${ERROR_PAGE_SCRIPT}</script>
</body>
</html>`;

  return new Response(html, {
    status: ctx.status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

/**
 * Render a pretty dev not-found (404) page with route suggestions
 */
export function renderDevNotFoundPage(ctx: DevErrorPageContext): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>404 — Not Found</title>
  <style>${ERROR_PAGE_STYLES}</style>
</head>
<body>
  <div class="error-header not-found-header">
    <div class="badge">🔍 AsiJS Dev — 404 Not Found</div>
    <h1>Page not found</h1>
    <div class="error-message">No matching route for <strong>${escapeHtml(ctx.method)} ${escapeHtml(ctx.path)}</strong></div>
  </div>

  <div class="error-meta">
    <span class="tag ${`method-${ctx.method}`}">
      <span class="label">Method</span> ${ctx.method}
    </span>
    <span class="tag">
      <span class="label">Path</span> ${escapeHtml(ctx.path)}
    </span>
    <span class="tag">
      <span class="label">Status</span> 404
    </span>
  </div>

  <div class="content">
    <div class="stack-panel">
      <h2>${ctx.suggestions && ctx.suggestions.length > 0 ? "Did you mean one of these routes?" : "No similar routes found"}</h2>

      ${ctx.suggestions && ctx.suggestions.length > 0
        ? ctx.suggestions.map((s, i) => `
          <div class="frame user-frame">
            <div class="frame-header">
              <span class="func-name" style="color: #7c9cff;">${escapeHtml(s)}</span>
              <span class="file-location" style="color: rgba(124, 156, 255, 0.4);">suggestion ${i + 1}</span>
            </div>
          </div>
        `).join("")
        : '<p style="color: rgba(230,225,207,0.3);">The server has no registered routes matching this path and method. Check your route definitions.</p>'}
    </div>

    <div class="sidebar">
      <div class="sidebar-section">
        <h3>Request Info</h3>
        <div class="detail-row">
          <span class="key">Method</span>
          <span class="value">${ctx.method}</span>
        </div>
        <div class="detail-row">
          <span class="key">Path</span>
          <span class="value">${escapeHtml(ctx.path)}</span>
        </div>
        <div class="detail-row">
          <span class="key">Timestamp</span>
          <span class="value">${new Date().toLocaleTimeString()}</span>
        </div>
      </div>

      <div class="sidebar-section">
        <h3>Query Parameters</h3>
        ${ctx.query && Object.keys(ctx.query).length > 0
          ? renderHeadersHtml(ctx.query)
          : '<span style="color: rgba(230,225,207,0.3); font-size: 12px;">No query parameters</span>'}
      </div>

      <div class="sidebar-section">
        <h3>Request Headers</h3>
        ${ctx.headers ? renderHeadersHtml(ctx.headers) : '<span style="color: rgba(230,225,207,0.3); font-size: 12px;">No headers</span>'}
      </div>

      <div class="sidebar-section">
        <h3>Tips</h3>
        <ul class="suggestion-list" style="list-style: none; font-size: 13px; color: rgba(230,225,207,0.5);">
          <li style="padding: 6px 0;">✓ Check that the route is registered with the correct HTTP method</li>
          <li style="padding: 6px 0;">✓ Verify the path spelling (case-sensitive)</li>
          <li style="padding: 6px 0;">✓ For dynamic routes, ensure the parameter format matches</li>
        </ul>
      </div>
    </div>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}
