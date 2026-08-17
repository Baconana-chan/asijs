/**
 * graphql-asijs — GraphQL Plugin v2 for AsiJS
 *
 * Code-first schema (TypeBox → SDL), HTTP + WebSocket (graphql-ws)
 * transports, Apollo Federation subgraphs, DataLoader and query complexity
 * analysis — `graphql` and `@sinclair/typebox` are optional peers, loaded
 * lazily.
 *
 * @example
 * ```ts
 * import { Asi } from "asijs";
 * import { Type } from "@sinclair/typebox";
 * import { graphql, defineSchema } from "graphql-asijs";
 *
 * const app = new Asi();
 * app.plugin(graphql({
 *   schema: defineSchema({
 *     types: { User: Type.Object({ id: Type.String(), name: Type.String() }) },
 *     queries: {
 *       users: { type: ["User"], resolve: () => db.users() },
 *     },
 *     subscriptions: {
 *       userCreated: { type: "User", subscribe: () => events },
 *     },
 *   }),
 *   complexity: { maxDepth: 8 },
 * }));
 * app.listen(3000);
 * ```
 */

export { defineSchema, typeboxToSDL, fieldTypeToSDL, emitObjectType, applyResolvers, createDefaultExecutor } from "./schema";
export type { BuiltSchema, SchemaConfig, GraphQLFieldConfig, ResolverMap, GraphQLContext, GraphQLExecutor, GraphQLRequestParams, GraphQLExecutionResult, GraphQLError, TypeBoxSchema, FieldType, AsijsAppLike } from "./types";

export { createGraphQLHandler, createGraphQLWSTransport } from "./transport";
export type { GraphQLHTTPOptions, GraphQLWSOptions, GraphQLWSHandlers } from "./transport";

export { calculateComplexity, createComplexityRule } from "./complexity";
export type { ComplexityConfig, ComplexityReport } from "./complexity";

export { DataLoader } from "./dataloader";
export type { DataLoaderOptions } from "./dataloader";

export { federationSubgraph, extractEntityKeys, resolveEntities } from "./federation";
export type { FederationOptions, FederatedSchema } from "./federation";

export { renderPlaygroundHTML } from "./playground";
export type { PlaygroundOptions } from "./playground";

export { graphql, withComplexityValidation } from "./plugin";
export type { GraphQLPluginOptions } from "./plugin";
