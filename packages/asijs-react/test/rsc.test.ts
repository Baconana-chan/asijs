import { describe, expect, test } from "bun:test";
import {
  createRSCHandler,
  createRscPlugin,
  buildClientManifest,
  isClientModule,
  scanExports,
  moduleRef,
  buildClientBundle,
  loadRuntime,
  CLIENT_BOOTSTRAP_SOURCE,
} from "../src/index";
import type { RscRenderer } from "../src/index";

// ============================================================================
// Helpers
// ============================================================================

function streamFrom(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

function fakeRenderer(body = "<div>ssr content</div>"): RscRenderer {
  return {
    async flight(root, manifest) {
      return streamFrom(JSON.stringify({ root: "flight", manifest }));
    },
    async html() {
      return streamFrom(body);
    },
  };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += new TextDecoder().decode(value);
  }
  return out;
}

const hasReact = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react-dom/server");
    return true;
  } catch {
    return false;
  }
})();

const REACT_MISSING = !hasReact;

// ============================================================================
// Server/client boundaries
// ============================================================================

describe("asijs-react — client boundaries", () => {
  test("isClientModule detects the directive in all forms", () => {
    expect(isClientModule('"use client";\nimport { useState } from "react";')).toBe(true);
    expect(isClientModule("'use client'\nconst x = 1")).toBe(true);
    expect(isClientModule("/* header */\n\"use client\"\nexport default function C() {}")).toBe(true);
    expect(isClientModule("// comment\n'use client'")).toBe(true);
  });

  test("isClientModule rejects non-client modules", () => {
    expect(isClientModule('import { useState } from "react";')).toBe(false);
    expect(isClientModule("export default function C() {}")).toBe(false);
    expect(isClientModule('"use server";')).toBe(false);
    expect(isClientModule("")).toBe(false);
  });

  test("scanExports finds function/const/class/named/default exports", () => {
    const src = `
      export function Counter() {}
      export const label = "x";
      export class Widget {}
      export { Counter as C, label };
      export default function App() {}
    `;
    const names = scanExports(src);
    expect(names).toContain("Counter");
    expect(names).toContain("label");
    expect(names).toContain("Widget");
    expect(names).toContain("C");
    expect(names).toContain("default");
  });

  test("buildClientManifest includes only \"use client\" modules with export records", () => {
    const manifest = buildClientManifest([
      { id: "/client/Counter.tsx", path: "x", source: '"use client";\nexport default function Counter() {}\nexport const label = "hi";' },
      { id: "/server/Data.tsx", path: "y", source: "export default function Data() {}" },
      { id: "/client/NoExports.tsx", path: "z", source: '"use client";\nconst hidden = 1;' },
    ]);
    expect(Object.keys(manifest).sort()).toEqual([
      "/client/Counter.tsx",
      "/client/NoExports.tsx",
    ]);
    const counter = manifest["/client/Counter.tsx"];
    expect(counter.default).toMatchObject({ id: "/client/Counter.tsx", name: "default", async: true });
    expect(counter.label).toMatchObject({ name: "label" });
    // module with no detected exports still gets a default reference
    expect(manifest["/client/NoExports.tsx"].default).toBeDefined();
  });

  test("moduleRef returns a tagged reference without react-server-dom-webpack", () => {
    const ref = moduleRef("/client/Counter.tsx", "default") as { __asijsClientRef?: unknown };
    expect(ref.__asijsClientRef).toMatchObject({
      moduleId: "/client/Counter.tsx",
      exportName: "default",
    });
  });
});

// ============================================================================
// Handler routing
// ============================================================================

describe("asijs-react — createRSCHandler routing", () => {
  test("HTML shell at / streams SSR content with bootstrap", async () => {
    const handler = createRSCHandler({
      root: "APP",
      renderer: fakeRenderer("<p>hello</p>"),
      title: "My App",
    });
    const res = await handler(new Request("http://localhost/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const body = await readAll(res.body as ReadableStream<Uint8Array>);
    expect(body).toContain("<p>hello</p>");
    expect(body).toContain('id="__asijs_rsc_root"');
    expect(body).toContain('<title>My App</title>');
    expect(body).toContain('src="/__rsc/client.js"');
    expect(body).toContain('window.__ASIJS_RSC__');
  });

  test("html shell body is consumable via res.text() (Bun stream fix)", async () => {
    const handler = createRSCHandler({ root: "APP", renderer: fakeRenderer() });
    const res = await handler(new Request("http://localhost/"));
    const text = await Promise.race([
      res.text(),
      new Promise<string>((r) => setTimeout(() => r("__HANG__"), 3000)),
    ]);
    expect(text).not.toBe("__HANG__");
    expect(text).toContain("ssr content");
  });

  test("Flight payload at /__rsc is text/x-component and streams", async () => {
    const handler = createRSCHandler({
      root: "APP",
      renderer: fakeRenderer(),
    });
    const res = await handler(new Request("http://localhost/__rsc"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/x-component; charset=utf-8");
    expect(res.headers.get("X-RSC")).toBe("1");
    const body = await readAll(res.body as ReadableStream<Uint8Array>);
    expect(body).toContain('"flight"');
  });

  test("RSC: 1 header on / answers with Flight instead of HTML", async () => {
    const handler = createRSCHandler({
      root: "APP",
      renderer: fakeRenderer(),
    });
    const res = await handler(
      new Request("http://localhost/", { headers: { RSC: "1" } }),
    );
    expect(res.headers.get("Content-Type")).toBe("text/x-component; charset=utf-8");
  });

  test("RSC header negotiation can be disabled", async () => {
    const handler = createRSCHandler({
      root: "APP",
      renderer: fakeRenderer(),
      rscHeader: false,
    });
    const res = await handler(
      new Request("http://localhost/", { headers: { RSC: "1" } }),
    );
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });

  test("client bootstrap module served at /__rsc/client.js", async () => {
    const handler = createRSCHandler({ root: "APP", renderer: fakeRenderer() });
    const res = await handler(new Request("http://localhost/__rsc/client.js"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/javascript");
    const body = await readAll(res.body as ReadableStream<Uint8Array>);
    expect(body).toContain("createFromFetch");
    expect(body).toContain("hydrateRoot");
  });

  test("custom client source is served", async () => {
    const handler = createRSCHandler({
      root: "APP",
      renderer: fakeRenderer(),
      clientSource: "custom-bootstrap();",
    });
    const res = await handler(new Request("http://localhost/__rsc/client.js"));
    const body = await readAll(res.body as ReadableStream<Uint8Array>);
    expect(body).toBe("custom-bootstrap();");
  });

  test("custom paths work", async () => {
    const handler = createRSCHandler({
      root: "APP",
      renderer: fakeRenderer(),
      htmlPath: "/home",
      rscPath: "/rsc",
      clientPath: "/assets/rsc.js",
    });
    expect((await handler(new Request("http://localhost/home"))).status).toBe(200);
    expect((await handler(new Request("http://localhost/rsc"))).headers.get("Content-Type")).toBe(
      "text/x-component; charset=utf-8",
    );
    expect((await handler(new Request("http://localhost/assets/rsc.js"))).status).toBe(200);
  });

  test("unknown paths return 404", async () => {
    const handler = createRSCHandler({ root: "APP", renderer: fakeRenderer() });
    expect((await handler(new Request("http://localhost/nope"))).status).toBe(404);
  });

  test("root may be a render function (per-request)", async () => {
    let calls = 0;
    const handler = createRSCHandler({
      root: () => {
        calls++;
        return "APP";
      },
      renderer: fakeRenderer(),
    });
    await handler(new Request("http://localhost/__rsc"));
    await handler(new Request("http://localhost/__rsc"));
    expect(calls).toBe(2);
  });

  test("onError handles renderer failures", async () => {
    const handler = createRSCHandler({
      root: "APP",
      renderer: {
        async flight() {
          throw new Error("boom");
        },
        async html() {
          throw new Error("boom");
        },
      },
      onError: (error) =>
        new Response(JSON.stringify({ handled: error.message }), { status: 503 }),
    });
    const res = await handler(new Request("http://localhost/__rsc"));
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("boom");
  });

  test("renderer failure without onError returns 500 JSON", async () => {
    const handler = createRSCHandler({
      root: "APP",
      renderer: {
        async flight() {
          throw new Error("kaboom");
        },
        async html() {
          throw new Error("kaboom");
        },
      },
    });
    const res = await handler(new Request("http://localhost/__rsc"));
    expect(res.status).toBe(500);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(await res.text()).toContain("kaboom");
  });

  test("html shell stream is a ReadableStream (streaming SSR)", async () => {
    const handler = createRSCHandler({ root: "APP", renderer: fakeRenderer() });
    const res = await handler(new Request("http://localhost/"));
    expect(res.body).toBeInstanceOf(ReadableStream);
  });
});

// ============================================================================
// Missing-react degradation
// ============================================================================

describe("asijs-react — graceful degradation", () => {
  test.skipIf(!REACT_MISSING)("loadRuntime throws a descriptive install hint", () => {
    try {
      loadRuntime();
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as Error).message).toContain("react-server-dom-webpack");
      expect((error as Error).message).toContain("bun add react");
    }
  });

  test.skipIf(!REACT_MISSING)("createRSCHandler without react answers 500 with the hint", async () => {
    const handler = createRSCHandler({ root: "APP" });
    const res = await handler(new Request("http://localhost/"));
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).toContain("asijs-react");
  });

  test.skipIf(!REACT_MISSING)("buildClientBundle fails gracefully without react", async () => {
    const res = await buildClientBundle({ outDir: "/tmp/asijs-react-test-bundle" });
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });
});

// ============================================================================
// Plugin
// ============================================================================

describe("asijs-react — createRscPlugin", () => {
  test("registers html/rsc/client routes and returns Responses", async () => {
    const routes = new Map<string, (ctx: { request: Request }) => unknown>();
    const app = {
      get(path: string, handler: (ctx: { request: Request }) => unknown) {
        routes.set(path, handler);
      },
    };
    const plugin = createRscPlugin({ root: "APP", renderer: fakeRenderer() });
    expect(plugin.name).toBe("asijs-react");
    plugin.apply(app);

    expect(routes.has("/")).toBe(true);
    expect(routes.has("/__rsc")).toBe(true);
    expect(routes.has("/__rsc/client.js")).toBe(true);

    const htmlRes = await routes.get("/")!({
      request: new Request("http://localhost/"),
    });
    expect(htmlRes).toBeInstanceOf(Response);
    expect((htmlRes as Response).status).toBe(200);
  });

  test("custom paths and plugin name", () => {
    const routes = new Map<string, unknown>();
    const plugin = createRscPlugin({
      root: "APP",
      renderer: fakeRenderer(),
      name: "rsc-app",
      htmlPath: "/home",
      rscPath: "/rsc",
      clientPath: "/assets/rsc.js",
    });
    expect(plugin.name).toBe("rsc-app");
    plugin.apply({ get: (p) => routes.set(p, true) } as never);
    expect(routes.has("/home")).toBe(true);
    expect(routes.has("/rsc")).toBe(true);
    expect(routes.has("/assets/rsc.js")).toBe(true);
  });
});

// ============================================================================
// Misc
// ============================================================================

describe("asijs-react — internals", () => {
  test("CLIENT_BOOTSTRAP_SOURCE references the RSC fetch + hydration", () => {
    expect(CLIENT_BOOTSTRAP_SOURCE).toContain("RSC");
    expect(CLIENT_BOOTSTRAP_SOURCE).toContain("__asijs_rsc_root");
  });
});
