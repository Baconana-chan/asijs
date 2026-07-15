import { describe, it, expect } from "bun:test";
import { Asi, graphql, yogaGraphQLAdapter, mercuriusGraphQLAdapter } from "../src";

describe("GraphQL Plugin/Adapters", () => {
  it("graphql() should execute typed GraphQL payload", async () => {
    const app = new Asi();

    await app.plugin(
      graphql<{
        data: { echo: string; by: string };
      }, { userId: string }, { msg: string }>({
        path: "/graphql",
        context: () => ({ userId: "u-1" }),
        execute: ({ variables, context }) => ({
          data: {
            echo: variables?.msg ?? "",
            by: context.userId,
          },
        }),
      }),
    );

    const res = await app.handle(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "query Echo($msg: String!) { echo(msg: $msg) }",
          variables: { msg: "hello" },
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: {
        echo: "hello",
        by: "u-1",
      },
    });
  });

  it("yogaGraphQLAdapter() should delegate request to yoga.fetch", async () => {
    const app = new Asi();
    let seenMethod = "";
    let seenContext: { tenant: string } | undefined;

    await app.plugin(
      yogaGraphQLAdapter({
        yoga: {
          fetch: async (request, context) => {
            seenMethod = request.method;
            seenContext = context;
            return new Response(JSON.stringify({ data: { ok: true } }), {
              headers: { "Content-Type": "application/json" },
            });
          },
        },
        context: () => ({ tenant: "acme" }),
      }),
    );

    const res = await app.handle(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "{ ok }" }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { ok: true } });
    expect(seenMethod).toBe("POST");
    expect(seenContext).toEqual({ tenant: "acme" });
  });

  it("mercuriusGraphQLAdapter() should support mercurius.graphql signature", async () => {
    const app = new Asi();

    await app.plugin(
      mercuriusGraphQLAdapter<
        { data: { value: string; operationName?: string; role?: string } },
        { role: string },
        { value: string }
      >({
        mercurius: {
          graphql: (query, context, variables, operationName) => {
            return {
              data: {
                value: `${query}:${variables?.value ?? ""}`,
                operationName,
                role: context?.role,
              },
            };
          },
        },
        context: () => ({ role: "admin" }),
      }),
    );

    const res = await app.handle(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "query Ping($value: String!) { ping(value: $value) }",
          operationName: "Ping",
          variables: { value: "pong" },
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: {
        value: "query Ping($value: String!) { ping(value: $value) }:pong",
        operationName: "Ping",
        role: "admin",
      },
    });
  });
});

