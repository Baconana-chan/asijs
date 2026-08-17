/**
 * Code-first schema builder.
 *
 * `defineSchema` turns TypeBox schemas + resolvers into an SDL string and a
 * resolver map — no `graphql` import needed (everything here inspects
 * TypeBox schemas structurally). `createDefaultExecutor` lazily binds the
 * SDL to the `graphql` package for execution.
 */
import type {
  BuiltSchema,
  FieldType,
  GraphQLExecutionResult,
  GraphQLExecutor,
  ResolverMap,
  SchemaConfig,
  TypeBoxSchema,
} from "./types";

const INSTALL_HINT =
  "graphql-asijs needs the `graphql` package to execute. Run: bun add graphql";

const BUILTIN_SCALARS = new Set(["String", "Int", "Float", "Boolean", "ID"]);

/** Internal builder state. */
interface BuildCtx {
  namedTypes: Map<string, TypeBoxSchema>;
  enums: Record<string, Record<string, string>>;
  scalars: Record<string, string>;
  sdlTypes: string[];
  anonCount: number;
}

function anonName(ctx: BuildCtx, prefix = "Anon"): string {
  return `__${prefix}${ctx.anonCount++}`;
}

/** Fresh builder state (used when functions are called without a ctx). */
function makeCtx(): BuildCtx {
  return {
    namedTypes: new Map<string, TypeBoxSchema>(),
    enums: {},
    scalars: {},
    sdlTypes: [],
    anonCount: 0,
  };
}

/** Map a TypeBox schema to an SDL type reference. */
export function typeboxToSDL(t: TypeBoxSchema, ctx?: BuildCtx): string {
  const c = ctx ?? makeCtx();

  if (t.anyOf) {
    const consts = t.anyOf.filter((m) => m.const !== undefined);
    if (consts.length === t.anyOf.length) {
      throw new Error(
        "graphql-asijs: inline enum (Type.Enum / anyOf of literals) is not supported — define it in `enums`",
      );
    }
    const members = t.anyOf.map((m) => typeboxToSDL(m, c));
    const unionName = anonName(c, "Union");
    c.sdlTypes.push(`union ${unionName} = ${members.join(" | ")}`);
    return unionName;
  }

  // Literals map to their primitive type (Int for integer literals)
  if (t.const !== undefined) {
    if (typeof t.const === "string") return "String";
    if (typeof t.const === "number") return Number.isInteger(t.const) ? "Int" : "Float";
    if (typeof t.const === "boolean") return "Boolean";
  }

  switch (t.type) {
    case "string":
      return "String";
    case "integer":
      return "Int";
    case "number":
      return "Float";
    case "boolean":
      return "Boolean";
    case "null":
      throw new Error("graphql-asijs: Type.Null() has no GraphQL equivalent");
    case "array":
      return `[${typeboxToSDL(t.items ?? {}, c)}]`;
    case "object": {
      const name = anonName(c);
      c.sdlTypes.push(emitObjectType(name, t, c));
      return name;
    }
    default:
      throw new Error(
        `graphql-asijs: unsupported TypeBox schema ${JSON.stringify(t)}`,
      );
  }
}

/** Map a field type reference (string / TypeBox / array forms) to SDL. */
export function fieldTypeToSDL(t: FieldType, ctx?: BuildCtx): string {
  const c = ctx ?? makeCtx();
  if (Array.isArray(t)) {
    return `[${fieldTypeToSDL(t[0], c)}]`;
  }
  if (t && typeof t === "object" && "arrayOf" in t) {
    return `[${fieldTypeToSDL((t as { arrayOf: FieldType }).arrayOf, c)}]`;
  }
  if (typeof t === "string") {
    if (c.enums[t] || c.scalars[t] || c.namedTypes.has(t) || BUILTIN_SCALARS.has(t)) {
      return t;
    }
    throw new Error(
      `graphql-asijs: unknown type reference "${t}" — define it in types/enums/scalars`,
    );
  }
  return typeboxToSDL(t, c);
}

/** Emit an SDL object type from a TypeBox object schema. */
export function emitObjectType(name: string, schema: TypeBoxSchema, ctx?: BuildCtx): string {
  const c = ctx ?? makeCtx();
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const lines: string[] = [];
  for (const [fname, ft] of Object.entries(props)) {
    const base = typeboxToSDL(ft, c);
    const nonNull = required.has(fname) ? "!" : "";
    lines.push(`  ${fname}: ${base}${nonNull}`);
  }
  return `type ${name} {\n${lines.join("\n")}\n}`;
}

/**
 * Build a code-first schema: named types / enums / scalars + Query, Mutation
 * and Subscription root fields → SDL string + resolver map.
 *
 * @example
 * ```ts
 * const schema = defineSchema({
 *   types: { User: Type.Object({ id: Type.String(), name: Type.String() }) },
 *   queries: {
 *     users: { type: ["User"], resolve: () => db.users() },
 *     user: { type: "User", args: { id: Type.String() }, resolve: (_, a) => db.user(a.id) },
 *   },
 *   mutations: {
 *     createUser: { type: "User", args: { name: Type.String() }, resolve: (_, a) => db.create(a) },
 *   },
 *   subscriptions: {
 *     userCreated: { type: "User", subscribe: () => events },
 *   },
 * });
 * ```
 */
export function defineSchema(config: SchemaConfig): BuiltSchema {
  const ctx: BuildCtx = {
    namedTypes: new Map(Object.entries(config.types ?? {})),
    enums: config.enums ?? {},
    scalars: config.scalars ?? {},
    sdlTypes: [],
    anonCount: 0,
  };

  // Named object types
  for (const [name, schema] of ctx.namedTypes) {
    ctx.sdlTypes.push(emitObjectType(name, schema, ctx));
  }
  // Enums
  for (const [name, values] of Object.entries(ctx.enums)) {
    const valueLines = Object.values(values).join("\n");
    ctx.sdlTypes.push(`enum ${name} {\n${valueLines}\n}`);
  }
  // Custom scalars
  for (const [name, def] of Object.entries(ctx.scalars)) {
    const trimmed = def.trim();
    ctx.sdlTypes.push(/^scalar\b/.test(trimmed) ? trimmed : `scalar ${name}`);
  }

  const resolvers: ResolverMap = {};
  const roots: Array<[string, SchemaConfig["queries"]]> = [
    ["Query", config.queries],
    ["Mutation", config.mutations],
    ["Subscription", config.subscriptions],
  ];

  for (const [rootName, fields] of roots) {
    if (!fields || Object.keys(fields).length === 0) continue;
    const lines: string[] = [];
    const map: Record<string, unknown> = {};
    for (const [fname, cfg] of Object.entries(fields)) {
      const type = fieldTypeToSDL(cfg.type, ctx);
      const args = cfg.args
        ? `(${Object.entries(cfg.args)
            .map(([n, t]) => `${n}: ${fieldTypeToSDL(t, ctx)}`)
            .join(", ")})`
        : "";
      if (cfg.description) {
        for (const dl of cfg.description.split("\n")) lines.push(`  """${dl}"""`);
      }
      lines.push(`  ${fname}${args}: ${type}`);
      if (rootName === "Subscription") {
        const entry: { resolve?: unknown; subscribe?: unknown } = {};
        if (cfg.resolve) entry.resolve = cfg.resolve;
        if (cfg.subscribe) entry.subscribe = cfg.subscribe;
        map[fname] = entry;
      } else if (cfg.resolve) {
        map[fname] = cfg.resolve;
      }
    }
    ctx.sdlTypes.push(`type ${rootName} {\n${lines.join("\n")}\n}`);
    resolvers[rootName] = map as ResolverMap[string];
  }

  return { sdl: ctx.sdlTypes.join("\n\n") + "\n", resolvers };
}

/**
 * Attach a resolver map to a graphql-js schema object (sets `field.resolve`
 * / `field.subscribe` in place). Operates on the structural shape only, so
 * it can be tested without the graphql package.
 */
export function applyResolvers(schema: unknown, resolvers: ResolverMap): void {
  const root = schema as {
    getTypeMap?: () => Record<string, unknown>;
    [key: string]: unknown;
  };
  const typeMap =
    (typeof root.getTypeMap === "function" ? root.getTypeMap() : root) as Record<
      string,
      { getFields?: () => Record<string, { resolve?: unknown; subscribe?: unknown }> }
    >;
  for (const [typeName, fieldMap] of Object.entries(resolvers)) {
    const type = typeMap[typeName];
    if (!type?.getFields) continue;
    const fields = type.getFields();
    for (const [fieldName, resolver] of Object.entries(fieldMap)) {
      const field = fields[fieldName];
      if (!field) continue;
      if (typeof resolver === "function") {
        field.resolve = resolver;
      } else if (resolver && typeof resolver === "object") {
        const entry = resolver as { resolve?: unknown; subscribe?: unknown };
        if (entry.resolve) field.resolve = entry.resolve;
        if (entry.subscribe) field.subscribe = entry.subscribe;
      }
    }
  }
}

/**
 * Create the default executor: lazily loads `graphql`, builds the schema
 * from SDL (or accepts a ready graphql-js schema), applies resolvers and
 * runs `graphql()` per request.
 */
export function createDefaultExecutor(
  schema: BuiltSchema | unknown,
  resolvers?: ResolverMap,
): GraphQLExecutor {
  let gql: { buildSchema?: (sdl: string) => unknown; graphql?: (opts: unknown) => unknown } | null = null;
  let gqlSchema: unknown | null = null;
  return async (params) => {
    if (!gql) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        gql = require("graphql");
      } catch {
        throw new Error(INSTALL_HINT);
      }
      if (!gql) throw new Error(INSTALL_HINT);
    }
    if (!gqlSchema) {
      const maybeBuilt = schema as BuiltSchema;
      if (
        schema &&
        typeof schema === "object" &&
        typeof (schema as { getTypeMap?: unknown }).getTypeMap === "function"
      ) {
        gqlSchema = schema;
      } else if (typeof gql.buildSchema === "function") {
        gqlSchema = gql.buildSchema(maybeBuilt.sdl);
      } else {
        throw new Error("graphql-asijs: no schema to execute");
      }
      if (resolvers) applyResolvers(gqlSchema, resolvers);
    }
    if (typeof gql.graphql !== "function") {
      throw new Error(INSTALL_HINT);
    }
    return (await gql.graphql({
      schema: gqlSchema,
      source: params.query,
      variableValues: params.variables,
      operationName: params.operationName,
      contextValue: params.context,
    })) as GraphQLExecutionResult;
  };
}
