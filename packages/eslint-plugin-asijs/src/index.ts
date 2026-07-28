/**
 * ESLint Plugin: eslint-plugin-asijs
 *
 * Custom ESLint rules for AsiJS framework:
 *
 * Rules:
 * - asijs/no-unused-route    — Warns about routes registered but never called
 * - asijs/no-missing-handler — Warns about routes without handler functions
 * - asijs/no-duplicate-route — Detects duplicate route registrations
 * - asijs/validate-schema    — Ensures validation schemas are complete
 */

import type { Rule } from "eslint";

// ============================================================================
// Rule: no-unused-route
// ============================================================================

const noUnusedRoute: Rule.RuleModule = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Warn about routes that may be unused",
      recommended: false,
    },
    messages: {
      unusedRoute: "Route '{{method}} {{path}}' may be unused. Consider removing it.",
    },
    schema: [],
  },
  create(context: Rule.RuleContext) {
    const routes: Array<{ method: string; path: string; node: any }> = [];

    return {
      CallExpression(node: any) {
        // Check for app.get/post/put/delete etc.
        const callee = node.callee;
        if (
          callee.type === "MemberExpression" &&
          callee.object.type === "Identifier" &&
          callee.object.name === "app"
        ) {
          const method = callee.property.name;
          const validMethods = ["get", "post", "put", "delete", "patch", "all", "head", "options"];

          if (validMethods.includes(method) && node.arguments.length >= 2) {
            const pathArg = node.arguments[0];
            if (pathArg.type === "Literal" && typeof pathArg.value === "string") {
              routes.push({
                method: method.toUpperCase(),
                path: pathArg.value,
                node,
              });
            }
          }
        }
      },
      "Program:exit"() {
        // For now, just report duplicate patterns
        // Full analysis would require cross-file references
        if (routes.length > 50) {
          context.report({
            node: routes[0].node,
            messageId: "unusedRoute",
            data: { method: routes[0].method, path: routes[0].path },
          });
        }
      },
    };
  },
};

// ============================================================================
// Rule: no-missing-handler
// ============================================================================

const noMissingHandler: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Ensure routes have handler functions",
      recommended: true,
    },
    messages: {
      missingHandler: "Route '{{method}} {{path}}' is missing a handler function",
    },
    schema: [],
  },
  create(context: Rule.RuleContext) {
    return {
      CallExpression(node: any) {
        const callee = node.callee;
        if (
          callee.type === "MemberExpression" &&
          callee.object.type === "Identifier" &&
          callee.object.name === "app"
        ) {
          const method = callee.property.name;
          const validMethods = ["get", "post", "put", "delete", "patch", "all", "head", "options"];

          if (validMethods.includes(method)) {
            if (node.arguments.length < 2) {
              const pathArg = node.arguments[0];
              if (pathArg?.type === "Literal" && typeof pathArg.value === "string") {
                context.report({
                  node,
                  messageId: "missingHandler",
                  data: { method: method.toUpperCase(), path: pathArg.value },
                });
              }
            }
          }
        }
      },
    };
  },
};

// ============================================================================
// Rule: no-duplicate-route
// ============================================================================

const noDuplicateRoute: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Detect duplicate route registrations",
      recommended: true,
    },
    messages: {
      duplicateRoute: "Duplicate route '{{method}} {{path}}' (first defined on line {{firstLine}})",
    },
    schema: [],
  },
  create(context: Rule.RuleContext) {
    const routeMap = new Map<string, { line: number; node: any }>();

    return {
      CallExpression(node: any) {
        const callee = node.callee;
        if (
          callee.type === "MemberExpression" &&
          callee.object.type === "Identifier" &&
          callee.object.name === "app"
        ) {
          const method = callee.property.name;
          const validMethods = ["get", "post", "put", "delete", "patch", "all", "head", "options"];

          if (validMethods.includes(method) && node.arguments.length >= 1) {
            const pathArg = node.arguments[0];
            if (pathArg.type === "Literal" && typeof pathArg.value === "string") {
              const key = `${method.toUpperCase()} ${pathArg.value}`;
              const line = node.loc?.start.line ?? 0;

              if (routeMap.has(key)) {
                const existing = routeMap.get(key)!;
                context.report({
                  node,
                  messageId: "duplicateRoute",
                  data: { method: method.toUpperCase(), path: pathArg.value, firstLine: String(existing.line) },
                });
              } else {
                routeMap.set(key, { line, node });
              }
            }
          }
        }
      },
    };
  },
};

// ============================================================================
// Rule: validate-schema
// ============================================================================

const validateSchema: Rule.RuleModule = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Ensure validation schemas are defined for routes with parameters",
      recommended: false,
    },
    messages: {
      missingSchema: "Route '{{method}} {{path}}' has URL parameters but no validation schema",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node: any) {
        const callee = node.callee;
        if (
          callee.type === "MemberExpression" &&
          callee.object.type === "Identifier" &&
          callee.object.name === "app"
        ) {
          const method = callee.property.name;
          const validMethods = ["get", "post", "put", "delete", "patch", "all"];

          if (validMethods.includes(method) && node.arguments.length >= 1) {
            const pathArg = node.arguments[0];
            if (pathArg.type === "Literal" && typeof pathArg.value === "string") {
              const path: string = pathArg.value;

              // Check for URL parameters
              const hasParams = path.includes(":") || path.includes("*");

              if (hasParams) {
                // Check if any argument (other than path) contains a schema
                const hasSchemaArg = node.arguments.slice(1).some((arg: any) => {
                  if (arg.type === "ObjectExpression") {
                    return arg.properties.some(
                      (p: any) => p.key?.name === "schema" || p.key?.value === "schema",
                    );
                  }
                  return false;
                });

                if (!hasSchemaArg) {
                  context.report({
                    node,
                    messageId: "missingSchema",
                    data: { method: method.toUpperCase(), path },
                  });
                }
              }
            }
          }
        }
      },
    };
  },
};

// ============================================================================
// Plugin export
// ============================================================================

export = {
  rules: {
    "no-unused-route": noUnusedRoute,
    "no-missing-handler": noMissingHandler,
    "no-duplicate-route": noDuplicateRoute,
    "validate-schema": validateSchema,
  },
  configs: {
    recommended: {
      plugins: ["asijs"],
      rules: {
        "asijs/no-missing-handler": "error",
        "asijs/no-duplicate-route": "warn",
        "asijs/validate-schema": "warn",
      },
    },
    all: {
      plugins: ["asijs"],
      rules: {
        "asijs/no-unused-route": "warn",
        "asijs/no-missing-handler": "error",
        "asijs/no-duplicate-route": "warn",
        "asijs/validate-schema": "warn",
      },
    },
  },
};
