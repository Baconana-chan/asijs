/**
 * Shared types for graphql-asijs.
 *
 * `graphql` and `@sinclair/typebox` are optional peers: nothing is imported
 * at module top-level. The schema builder inspects TypeBox schemas
 * structurally (plain JSON-ish objects), and the executor is injected
 * (defaulting to a lazy `require("graphql")`).
 */

/** A TypeBox schema object (structural — `T` from @sinclair/typebox). */
export type TypeBoxSchema = Record<string, unknown> & {
  type?: string;
  properties?: Record<string, TypeBoxSchema>;
  items?: TypeBoxSchema;
  anyOf?: TypeBoxSchema[];
  const?: unknown;
  required?: string[];
  optional?: boolean;
  patternProperties?: Record<string, TypeBoxSchema>;
};

/** A field type reference: a named type, a TypeBox schema, or an array thereof. */
export type FieldType = string | TypeBoxSchema | string[] | { arrayOf: FieldType };

/** Resolver signature — matches graphql-js field resolvers. */
export type Resolver = (
  parent: unknown,
  args: Record<string, unknown>,
  context: GraphQLContext,
  info: unknown,
) => unknown;

/** Subscription resolver: must return an AsyncIterable (or a Promise of one). */
export type SubscribeResolver = (
  parent: unknown,
  args: Record<string, unknown>,
  context: GraphQLContext,
  info: unknown,
) => AsyncIterable<unknown> | Promise<AsyncIterable<unknown>>;

/** A single GraphQL field definition in the code-first schema. */
export interface GraphQLFieldConfig {
  /** Result type: named type, TypeBox schema, `["User"]`, or `{ arrayOf: "User" }`. */
  type: FieldType;
  /** Field arguments: name → type reference. */
  args?: Record<string, FieldType>;
  /** Field resolver (defaults to property lookup). */
  resolve?: Resolver;
  /** Subscription source (only valid in `subscriptions`). */
  subscribe?: SubscribeResolver;
  /** SDL description. */
  description?: string;
}

/** Code-first schema configuration. */
export interface SchemaConfig {
  /** Named object types: name → TypeBox object schema. */
  types?: Record<string, TypeBoxSchema>;
  /** Custom scalars: name → SDL definition (e.g. `"scalar DateTime"`). */
  scalars?: Record<string, string>;
  /** Enums: name → value → GraphQL name. */
  enums?: Record<string, Record<string, string>>;
  /** Query fields. */
  queries?: Record<string, GraphQLFieldConfig>;
  /** Mutation fields. */
  mutations?: Record<string, GraphQLFieldConfig>;
  /** Subscription fields. */
  subscriptions?: Record<string, GraphQLFieldConfig>;
}

/** Standard resolver map (graphql-tools style). */
export type ResolverMap = Record<
  string,
  Record<string, Resolver | { resolve?: Resolver; subscribe?: SubscribeResolver }>
>;

/** The built code-first schema: SDL + resolver map. */
export interface BuiltSchema {
  sdl: string;
  resolvers: ResolverMap;
}

/** Per-request GraphQL context (the AsiJS request is always included). */
export interface GraphQLContext {
  request: Request;
  [key: string]: unknown;
}

/** A GraphQL execution result (structural — compatible with graphql-js). */
export interface GraphQLExecutionResult {
  data?: unknown;
  errors?: GraphQLError[];
  extensions?: Record<string, unknown>;
}

export interface GraphQLError {
  message: string;
  path?: Array<string | number>;
  locations?: Array<{ line: number; column: number }>;
  extensions?: Record<string, unknown>;
}

/** What an executor receives. */
export interface GraphQLRequestParams {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
  context?: GraphQLContext;
}

/**
 * Executes a GraphQL operation. Returns a single result for queries /
 * mutations, or an AsyncIterable of results for subscriptions.
 */
export type GraphQLExecutor = (
  params: GraphQLRequestParams,
) => Promise<GraphQLExecutionResult> | AsyncIterable<GraphQLExecutionResult>;

/** Minimal AsiJS app shape (structural). */
export interface AsijsAppLike {
  all?(path: string, handler: (ctx: { request: Request }) => unknown): unknown;
  get?(path: string, handler: (ctx: { request: Request }) => unknown): unknown;
  ws?(
    path: string,
    handlers: {
      open?(ws: unknown): void | Promise<void>;
      message?(ws: unknown, message: string | Uint8Array): void | Promise<void>;
      close?(ws: unknown): void | Promise<void>;
    },
  ): unknown;
  [key: string]: unknown;
}
