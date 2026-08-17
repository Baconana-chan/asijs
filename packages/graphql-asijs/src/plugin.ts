/**
 * AsiJS GraphQL plugin.
 *
 * Mounts the GraphQL endpoint (HTTP GET/POST), the WebSocket subscription
 * transport (graphql-ws protocol) and an optional playground on one AsiJS
 * app.
 *
 * ```ts
 * const app = new Asi();
 * app.plugin(graphql({
 *   schema: defineSchema({ queries: { ... } }),
 *   path: "/graphql",
 * }));
 * ```
 */
import type {
  AsijsAppLike,
  BuiltSchema,
  GraphQLContext,
  GraphQLExecutionResult,
  GraphQLExecutor,
  ResolverMap,
} from "./types";
import { createDefaultExecutor } from "./schema";
import { createGraphQLHandler, createGraphQLWSTransport } from "./transport";
import type { GraphQLHTTPOptions, GraphQLWSHandlers } from "./transport";
import { renderPlaygroundHTML } from "./playground";
import type { PlaygroundOptions } from "./playground";
import { createComplexityRule } from "./complexity";
import type { ComplexityConfig } from "./complexity";
import { federationSubgraph } from "./federation";

export interface GraphQLPluginOptions {
  /** Code-first schema (from `defineSchema`). */
  schema: BuiltSchema;
  /** Extra resolvers to merge (overrides schema resolvers). */
  resolvers?: ResolverMap;
  /** HTTP endpoint (default "/graphql"). */
  path?: string;
  /** WebSocket endpoint (default "/graphql/ws"). */
  wsPath?: string;
  /** Playground route (default "/graphql/playground"). */
  playgroundPath?: string;
  /** Disable the playground. */
  playground?: boolean;
  /** Playground page options. */
  playgroundOptions?: PlaygroundOptions;
  /** Custom executor (default: lazy graphql via `createDefaultExecutor`). */
  executor?: GraphQLExecutor;
  /** Per-request context builder. */
  context?: (request: Request) => Record<string, unknown> | undefined;
  /** Complexity / depth limits (enforced via graphql validation rules). */
  complexity?: ComplexityConfig;
  /** Wrap the schema as an Apollo Federation subgraph. */
  federation?: {
    name?: string;
    references?: Record<string, (rep: Record<string, unknown>, ctx: unknown) => unknown>;
  };
  /** HTTP transport options. */
  http?: Omit<GraphQLHTTPOptions, "executor" | "context">;
  /** WebSocket transport options (keepAlive etc.). */
  ws?: Omit<Parameters<typeof createGraphQLWSTransport>[0], "executor" | "context">;
  /** Plugin name (default "graphql"). */
  name?: string;
  /** Verbose logging. */
  verbose?: boolean;
}

interface GqlLike {
  buildSchema: (sdl: string) => unknown;
  parse: (source: string) => unknown;
  validate: (schema: unknown, document: unknown, rules?: unknown[]) => Array<{ message: string }>;
}

/**
 * Wrap an executor with graphql validation enforcing the complexity/depth
 * limits. Lazily loads `graphql`; if it is unavailable, falls back to the
 * base executor (limits are best-effort without the validation engine).
 */
export function withComplexityValidation(
  base: GraphQLExecutor,
  schema: BuiltSchema,
  config: ComplexityConfig,
): GraphQLExecutor {
  let gql: GqlLike | null = null;
  let gqlSchema: unknown = null;
  const rule = createComplexityRule(config);
  return async (params): Promise<GraphQLExecutionResult> => {
    if (!gql) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        gql = require("graphql") as GqlLike;
        gqlSchema = gql.buildSchema(schema.sdl);
      } catch {
        return (await base(params)) as GraphQLExecutionResult;
      }
    }
    try {
      const doc = gql.parse(params.query);
      const errors = gql.validate(gqlSchema, doc, [rule]);
      if (errors.length > 0) {
        return { errors: errors.map((e) => ({ message: e.message })) };
      }
    } catch {
      // parse/validate failed — let the executor surface the real error
    }
    return (await base(params)) as GraphQLExecutionResult;
  };
}

/**
 * Create the AsiJS GraphQL plugin.
 */
export function graphql(options: GraphQLPluginOptions): {
  name: string;
  config: Record<string, unknown>;
  apply(app: AsijsAppLike): Promise<void> | void;
} {
  const path = options.path ?? "/graphql";
  const wsPath = options.wsPath ?? "/graphql/ws";
  const playgroundPath = options.playgroundPath ?? "/graphql/playground";
  const verbose = options.verbose ?? false;

  // Federation wrapper
  let schema = options.schema;
  let resolvers = options.resolvers;
  if (options.federation) {
    const fed = federationSubgraph({
      name: options.federation.name,
      sdl: options.schema.sdl,
      resolvers: options.resolvers,
      references: options.federation.references,
    });
    schema = { sdl: fed.sdl, resolvers: {} };
    resolvers = fed.resolvers as ResolverMap;
  }

  let executor: GraphQLExecutor = options.executor
    ? options.executor
    : createDefaultExecutor(schema, resolvers);

  if (options.complexity && (options.complexity.maxComplexity || options.complexity.maxDepth)) {
    executor = withComplexityValidation(executor, schema, options.complexity);
  }

  const handler = createGraphQLHandler({
    executor,
    context: options.context,
    verbose,
    ...options.http,
  });

  const wsHandlers: GraphQLWSHandlers = createGraphQLWSTransport({
    executor,
    context: options.context as ((ws: unknown) => Record<string, unknown> | undefined) | undefined,
    verbose,
    ...options.ws,
  });

  return {
    name: options.name ?? "graphql",
    config: {},
    apply(app) {
      const ctxHandler = (ctx: { request: Request }) => handler(ctx.request);
      if (typeof app.all === "function") {
        app.all(path, ctxHandler);
      } else {
        app.get?.(path, ctxHandler);
      }
      if (typeof app.ws === "function") {
        app.ws(wsPath, {
          open: (ws) => wsHandlers.open?.(ws),
          message: (ws, msg) => wsHandlers.message?.(ws, msg),
          close: (ws) => wsHandlers.close?.(ws),
        });
      }
      if (options.playground !== false && typeof app.get === "function") {
        app.get(playgroundPath, () => {
          const html = renderPlaygroundHTML({
            endpoint: path,
            wsEndpoint: wsPath,
            ...options.playgroundOptions,
          });
          return new Response(html, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        });
      }
    },
  };
}

export type { GraphQLContext };
