import { describe, expect, it } from "bun:test";
import { Asi, OpenAPIGenerator, Type, openapi } from "../src";

describe("openapi.ts", () => {
  it("OpenAPIGenerator generates paths, params, bodies, and security schemes", () => {
    const generator = new OpenAPIGenerator({
      title: "AsiJS Test API",
      version: "1.0.0",
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
      security: [{ bearerAuth: [] }],
    });

    generator.addRoute({
      method: "GET",
      path: "/users/:id",
      schemas: {
        params: Type.Object({ id: Type.String() }),
        response: Type.Object({ id: Type.String(), name: Type.String() }),
      },
      docs: {
        summary: "Get user",
        tags: ["users"],
      },
    });

    generator.addRoute({
      method: "POST",
      path: "/users",
      schemas: {
        body: Type.Object({
          name: Type.String(),
          email: Type.String(),
        }),
      },
    });

    const doc = generator.generate();

    expect(doc.openapi).toBe("3.0.3");
    expect(doc.paths["/users/{id}"].get?.parameters).toHaveLength(1);
    expect(doc.paths["/users"].post?.requestBody).toBeDefined();
    expect(doc.components?.securitySchemes?.bearerAuth).toBeDefined();
    expect(doc.security).toEqual([{ bearerAuth: [] }]);
  });

  it("openapi() serves the generated spec from app state", async () => {
    const app = new Asi();
    await app.plugin(
      openapi({
        title: "Plugin API",
        version: "2.0.0",
      }),
    );

    app.setState("openapi:routes", [
      {
        method: "GET",
        path: "/posts/:postId",
        schemas: {
          params: Type.Object({ postId: Type.String() }),
        },
      },
    ]);

    const response = await app.handle(
      new Request("http://localhost/openapi.json"),
    );
    const spec = await response.json();

    expect(response.status).toBe(200);
    expect(spec.info.title).toBe("Plugin API");
    expect(spec.paths["/posts/{postId}"].get).toBeDefined();
  });

  it("openapi() serves Swagger UI at /docs", async () => {
    const app = new Asi();
    await app.plugin(
      openapi({
        title: "Docs API",
        version: "1.0.0",
      }),
    );

    const response = await app.handle(new Request("http://localhost/docs"));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(html).toContain("SwaggerUIBundle");
    expect(html).toContain("http://localhost/openapi.json");
  });
});
