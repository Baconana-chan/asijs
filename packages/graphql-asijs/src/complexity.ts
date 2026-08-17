/**
 * Query complexity & depth analysis.
 *
 * `calculateComplexity` walks a GraphQL operation AST (the graphql-js node
 * shape, or structurally-equivalent fakes) and computes a numeric complexity
 * plus the max field depth. `createComplexityRule` wraps the same logic in a
 * graphql validation rule for use in the executor's `validationRules`.
 */

export interface ComplexityConfig {
  /** Maximum allowed complexity (0 = unlimited). */
  maxComplexity?: number;
  /** Maximum allowed field depth (0 = unlimited). */
  maxDepth?: number;
  /** Per-field cost (default 1). Receive the field name for custom scoring. */
  scoreField?: (fieldName: string, path: string[]) => number;
}

export interface ComplexityReport {
  complexity: number;
  depth: number;
  violations: string[];
}

interface AstNode {
  kind: string;
  name?: { value: string };
  selectionSet?: { selections?: AstNode[] };
  selections?: AstNode[];
}

function selectionsOf(node: AstNode): AstNode[] {
  const set = node.selectionSet?.selections ?? node.selections;
  return set ?? [];
}

/**
 * Walk an operation AST and compute complexity + max depth.
 *
 * Cost model: depth-weighted — a field at depth `d` costs
 * `scoreField(name) * (1 + d)`, and nested selections are walked to count
 * every field. So a deep query is strictly more expensive than a flat one
 * with the same field count (standard anti-abuse property).
 */
export function calculateComplexity(
  operation: AstNode,
  config: ComplexityConfig = {},
): ComplexityReport {
  const score = config.scoreField ?? (() => 1);
  const violations: string[] = [];
  let maxDepth = 0;

  const walk = (node: AstNode, depth: number): number => {
    if (depth > maxDepth) maxDepth = depth;
    if (config.maxDepth && depth > config.maxDepth && depth > 0) {
      violations.push(`Query exceeds maximum depth of ${config.maxDepth} (got ${depth})`);
    }
    let total = 0;
    for (const sel of selectionsOf(node)) {
      if (sel.kind === "Field") {
        const name = sel.name?.value ?? "?";
        total += score(name, []) * (1 + depth);
        total += walk(sel, depth + 1);
      } else if (sel.kind === "InlineFragment" || sel.kind === "FragmentSpread") {
        total += walk(sel, depth + 1);
      }
    }
    return total;
  };

  const complexity = walk(operation, 0);
  if (config.maxComplexity && complexity > config.maxComplexity) {
    violations.push(
      `Query exceeds maximum complexity of ${config.maxComplexity} (got ${complexity})`,
    );
  }
  return { complexity, depth: maxDepth, violations };
}

/**
 * Create a graphql validation rule enforcing the complexity/depth limits.
 * Compatible with graphql-js `validate(schema, document, [rule])` and the
 * executor's `validationRules` option.
 */
export function createComplexityRule(config: ComplexityConfig): (context: unknown) => Record<string, (node: AstNode) => void> {
  const opPaths = new WeakMap<object, string[]>();
  return (context) => {
    const report = (message: string) => {
      (context as { reportError?: (error: unknown) => void }).reportError?.(
        new Error(message),
      );
    };
    return {
      OperationDefinition(node: AstNode) {
        const r = calculateComplexity(node, config);
        for (const v of r.violations) report(v);
      },
    };
  };
}
