/**
 * Apollo Federation subgraph support.
 *
 * `federationSubgraph` wraps a code-first schema SDL with the federation
 * boilerplate (`_service`, `_entities`, `@key` directives) and produces the
 * resolvers the gateway calls. Pure TS — no graphql import needed.
 */

export interface FederationOptions {
  /** Subgraph name (used for diagnostics). */
  name?: string;
  /** The subgraph's own SDL (e.g. from `defineSchema`). */
  sdl: string;
  /** Optional reference resolvers per entity type: (representation, context) → entity. */
  references?: Record<string, (representation: Record<string, unknown>, context: unknown) => unknown>;
  /** Resolvers to merge into the subgraph (your own Query/Mutation resolvers). */
  resolvers?: Record<string, unknown>;
  /** Federation version for the @link directive (default "2.3"). */
  federationVersion?: string;
}

export interface FederatedSchema {
  sdl: string;
  resolvers: Record<string, unknown>;
  /** Entity types discovered from `@key` directives. */
  entities: string[];
}

const FEDERATION_IMPORTS = [
  "@key",
  "@shareable",
  "@external",
  "@requires",
  "@provides",
  "@extends",
  "@tag",
];

/** Extract entity type names that declare `@key`. */
export function extractEntityKeys(sdl: string): string[] {
  const names: string[] = [];
  const re = /type\s+([A-Za-z_][A-Za-z0-9_]*)[^{]*?@key/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sdl)) !== null) {
    names.push(m[1]);
  }
  return [...new Set(names)];
}

/** Resolve federation representations (`_entities`). */
export function resolveEntities(
  representations: Array<Record<string, unknown>>,
  references: FederationOptions["references"] = {},
): unknown[] {
  return representations.map((representation) => {
    const typename = representation.__typename as string | undefined;
    if (typename && typeof references[typename] === "function") {
      return references[typename](representation, undefined);
    }
    // No reference resolver — return the representation as-is.
    return representation;
  });
}

/**
 * Build a federation subgraph: the original SDL plus the `_service` /
 * `_entities` boilerplate and matching resolvers.
 */
export function federationSubgraph(options: FederationOptions): FederatedSchema {
  const { sdl, references = {}, resolvers = {} } = options;
  const version = options.federationVersion ?? "2.3";
  const entities = extractEntityKeys(sdl);
  const imports = `@link(url: "https://specs.apollo.dev/federation/v${version}", import: [${FEDERATION_IMPORTS.map(
    (i) => `"${i}"`,
  ).join(", ")}])`;

  const parts: string[] = [
    `extend schema ${imports}`,
    `scalar _FieldSet`,
    `type _Service {\n  sdl: String!\n}`,
    `extend type Query {\n  _service: _Service!\n}`,
  ];

  const mergedResolvers: Record<string, unknown> = {
    ...resolvers,
    Query: {
      ...((resolvers.Query as Record<string, unknown>) ?? {}),
      _service: () => ({ sdl }),
    },
  };

  if (entities.length > 0) {
    parts.push(
      `scalar _Any`,
      `union _Entity = ${entities.join(" | ")}`,
      `extend type Query {\n  _entities(representations: [_Any!]!): [_Entity]!\n}`,
    );
    (mergedResolvers.Query as Record<string, unknown>)._entities = (
      _parent: unknown,
      args: { representations: Array<Record<string, unknown>> },
    ) => resolveEntities(args.representations, references);
  }

  return {
    sdl: `${parts.join("\n\n")}\n\n${sdl.trim()}\n`,
    resolvers: mergedResolvers,
    entities,
  };
}
