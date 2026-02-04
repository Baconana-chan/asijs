/**
 * JSX Runtime for AsiJS
 *
 * This file provides the JSX runtime exports required by
 * the modern JSX transform ("jsx": "react-jsx" or "jsx": "react-jsxdev").
 *
 * Configure your tsconfig.json:
 * {
 *   "compilerOptions": {
 *     "jsx": "react-jsx",
 *     "jsxImportSource": "asijs"
 *   }
 * }
 */

export { jsx, jsxs, jsxDEV, Fragment } from "./jsx";
export type { JSX } from "./jsx";
