/**
 * GraphQL Plugin/Adapters for AsiJS
 *
 * Supports:
 * - Generic GraphQL executor plugin
 * - Yoga adapter (request passthrough)
 * - Mercurius adapter (execute/graphql mapping)
 */

import type { Context } from "./context";
import { createPlugin, type AsiPlugin } from "./plugin";

export type GraphQLVariables = Record<string, unknown>;

export interface GraphQLRequestPayload<
  TVariables extends GraphQLVariables = GraphQLVariables,
> {
  query: string;
  variables?: TVariables;
  operationName?: string;
  extensions?: Record<string, unknown>;
}

export type GraphQLContextFactory<TContext> = (
  ctx: Context,
) => TContext | Promise<TContext>;

export interface GraphQLPluginOptions<
  TResult = unknown,
  TContext = unknown,
  TVariables extends GraphQLVariables = GraphQLVariables,
> {
  /** Plugin name */
  name?: string;
  /** GraphQL endpoint path */
  path?: string;
  /** Enable simple GraphiQL-like landing page */
  graphiql?: boolean;
  /** Context factory for each request */
  context?: GraphQLContextFactory<TContext>;
  /** GraphQL execute function */
  execute: (request: {
    ctx: Context;
    query: string;
    variables?: TVariables;
    operationName?: string;
    context: TContext;
  }) => TResult | Promise<TResult>;
}

export interface YogaLikeServer<TYogaContext = unknown> {
  fetch: (
    request: Request,
    context?: TYogaContext,
  ) => Response | Promise<Response>;
}

export interface YogaGraphQLAdapterOptions<TYogaContext = unknown> {
  name?: string;
  path?: string;
  graphiql?: boolean;
  yoga: YogaLikeServer<TYogaContext>;
  context?: GraphQLContextFactory<TYogaContext>;
}

export interface MercuriusExecuteRequest<
  TContext = unknown,
  TVariables extends GraphQLVariables = GraphQLVariables,
> {
  query: string;
  variables?: TVariables;
  operationName?: string;
  context: TContext;
}

export interface MercuriusExecutorLike<
  TResult = unknown,
  TContext = unknown,
  TVariables extends GraphQLVariables = GraphQLVariables,
> {
  execute: (
    request: MercuriusExecuteRequest<TContext, TVariables>,
  ) => TResult | Promise<TResult>;
}

export interface MercuriusInstanceLike<
  TResult = unknown,
  TContext = unknown,
  TVariables extends GraphQLVariables = GraphQLVariables,
> {
  graphql: (
    query: string,
    context?: TContext,
    variables?: TVariables,
    operationName?: string,
  ) => TResult | Promise<TResult>;
}

export interface MercuriusGraphQLAdapterOptions<
  TResult = unknown,
  TContext = unknown,
  TVariables extends GraphQLVariables = GraphQLVariables,
> {
  name?: string;
  path?: string;
  graphiql?: boolean;
  context?: GraphQLContextFactory<TContext>;
  mercurius?: MercuriusInstanceLike<TResult, TContext, TVariables>;
  executor?: MercuriusExecutorLike<TResult, TContext, TVariables>;
}

function graphiqlLandingPage(path: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AsiJS GraphQL</title>
  </head>
  <body style="font-family: sans-serif; margin: 2rem;">
    <h1>GraphQL Endpoint</h1>
    <p>Send GraphQL requests to <code>${path}</code> using POST JSON:</p>
    <pre>{ "query": "query { hello }", "variables": {} }</pre>
  </body>
</html>`;
}

function parseVariables(
  raw: unknown,
): Record<string, unknown> | undefined | never {
  if (raw === undefined || raw === null || raw === "") return undefined;

  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      throw new Error("variables must be an object");
    } catch {
      throw new Error("Invalid GraphQL variables JSON");
    }
  }

  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }

  throw new Error("GraphQL variables must be an object");
}

async function readGraphQLPayload<
  TVariables extends GraphQLVariables = GraphQLVariables,
>(ctx: Context): Promise<GraphQLRequestPayload<TVariables>> {
  if (ctx.method === "GET") {
    const query = ctx.query.query;
    const operationName = ctx.query.operationName;
    const variables = parseVariables(ctx.query.variables) as TVariables;

    if (!query) {
      throw new Error("GraphQL query is required");
    }

    return {
      query,
      operationName: operationName || undefined,
      variables,
    };
  }

  if (ctx.method !== "POST") {
    throw new Error("Only GET and POST methods are supported");
  }

  const payload = await ctx.json<GraphQLRequestPayload<TVariables>>();
  if (!payload || typeof payload.query !== "string" || payload.query === "") {
    throw new Error("GraphQL query is required");
  }

  return payload;
}

/**
 * Generic GraphQL plugin with typed execute() contract.
 */
export function graphql<
  TResult = unknown,
  TContext = unknown,
  TVariables extends GraphQLVariables = GraphQLVariables,
>(options: GraphQLPluginOptions<TResult, TContext, TVariables>): AsiPlugin {
  const path = options.path ?? "/graphql";
  const name = options.name ?? "graphql";
  const graphiql = options.graphiql ?? false;

  return createPlugin({
    name,
    setup(app) {
      app.all(path, async (ctx) => {
        if (ctx.method === "GET" && graphiql && !ctx.query.query) {
          return ctx.html(graphiqlLandingPage(path));
        }

        try {
          const payload = await readGraphQLPayload<TVariables>(ctx);
          const context = options.context
            ? await options.context(ctx)
            : ({} as TContext);

          const result = await options.execute({
            ctx,
            query: payload.query,
            variables: payload.variables,
            operationName: payload.operationName,
            context,
          });

          return ctx.jsonResponse(result);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Invalid GraphQL request";
          return ctx.status(400).jsonResponse({
            errors: [{ message }],
          });
        }
      });
    },
  });
}

/**
 * Adapter for GraphQL Yoga-like servers.
 */
export function yogaGraphQLAdapter<TYogaContext = unknown>(
  options: YogaGraphQLAdapterOptions<TYogaContext>,
): AsiPlugin {
  const path = options.path ?? "/graphql";
  const name = options.name ?? "graphql:yoga";
  const graphiql = options.graphiql ?? false;

  return createPlugin({
    name,
    setup(app) {
      app.all(path, async (ctx) => {
        if (ctx.method === "GET" && graphiql && !ctx.query.query) {
          return ctx.html(graphiqlLandingPage(path));
        }

        const yogaContext = options.context
          ? await options.context(ctx)
          : undefined;

        return options.yoga.fetch(ctx.request, yogaContext);
      });
    },
  });
}

/**
 * Adapter for Mercurius-like execute/graphql contracts.
 */
export function mercuriusGraphQLAdapter<
  TResult = unknown,
  TContext = unknown,
  TVariables extends GraphQLVariables = GraphQLVariables,
>(
  options: MercuriusGraphQLAdapterOptions<TResult, TContext, TVariables>,
): AsiPlugin {
  if (!options.executor && !options.mercurius) {
    throw new Error(
      "mercuriusGraphQLAdapter requires either `executor` or `mercurius`",
    );
  }

  return graphql<TResult, TContext, TVariables>({
    name: options.name ?? "graphql:mercurius",
    path: options.path,
    graphiql: options.graphiql,
    context: options.context,
    execute: async ({ query, variables, operationName, context }) => {
      if (options.executor) {
        return options.executor.execute({
          query,
          variables,
          operationName,
          context,
        });
      }

      return (
        options.mercurius as MercuriusInstanceLike<
          TResult,
          TContext,
          TVariables
        >
      ).graphql(query, context, variables, operationName);
    },
  });
}

