import { describe, it, expect } from "bun:test";
import { 
  Asi, 
  jwt, 
  bearer, 
  auth,
  hashPassword,
  verifyPassword,
  generateToken,
  rateLimit,
  rateLimitMiddleware,
  MemoryStore,
  TokenBucketStore,
  openapi,
  OpenAPIGenerator,
  Type,
  // Client
  createClient,
  treaty,
  withRetry,
  // JSX
  jsx,
  Fragment,
  html,
  stream,
  renderToString,
  escapeHtml,
  htmlTemplate,
  when,
  each,
} from "../src";

describe("Phase 5 Features", () => {
  describe("JWT", () => {
    const secret = "test-secret-key-for-testing-only";
    
    it("should sign and verify a token", async () => {
      const jwtHelper = jwt({ secret });
      
      const token = await jwtHelper.sign({ userId: "123", role: "admin" });
      expect(token).toBeString();
      expect(token.split(".")).toHaveLength(3);
      
      const payload = await jwtHelper.verify(token);
      expect(payload.userId).toBe("123");
      expect(payload.role).toBe("admin");
      expect(payload.iat).toBeNumber();
    });
    
    it("should set expiration time", async () => {
      const jwtHelper = jwt({ secret, expiresIn: "1h" });
      
      const token = await jwtHelper.sign({ userId: "123" });
      const payload = await jwtHelper.verify(token);
      
      expect(payload.exp).toBeNumber();
      expect(payload.exp! - payload.iat!).toBe(3600); // 1 hour
    });
    
    it("should reject expired tokens", async () => {
      const jwtHelper = jwt({ secret });
      
      // Create token that's already expired
      const token = await jwtHelper.sign({ 
        userId: "123", 
        exp: Math.floor(Date.now() / 1000) - 10 // 10 seconds ago
      });
      
      await expect(jwtHelper.verify(token)).rejects.toThrow("expired");
    });
    
    it("should reject invalid signature", async () => {
      const jwtHelper1 = jwt({ secret: "secret1" });
      const jwtHelper2 = jwt({ secret: "secret2" });
      
      const token = await jwtHelper1.sign({ userId: "123" });
      
      await expect(jwtHelper2.verify(token)).rejects.toThrow("signature");
    });
    
    it("should decode token without verification", async () => {
      const jwtHelper = jwt({ secret });
      
      const token = await jwtHelper.sign({ userId: "123" });
      const decoded = jwtHelper.decode(token);
      
      expect(decoded).not.toBeNull();
      expect(decoded!.header.alg).toBe("HS256");
      expect(decoded!.payload.userId).toBe("123");
    });
    
    it("should set issuer and audience", async () => {
      const jwtHelper = jwt({ 
        secret, 
        issuer: "my-app",
        audience: "my-audience",
      });
      
      const token = await jwtHelper.sign({ userId: "123" });
      const payload = await jwtHelper.verify(token);
      
      expect(payload.iss).toBe("my-app");
      expect(payload.aud).toBe("my-audience");
    });
  });
  
  describe("Bearer Auth Middleware", () => {
    it("should protect routes with Bearer token", async () => {
      const app = new Asi();
      const jwtHelper = jwt({ secret: "test-secret" });
      
      app.get("/protected", (ctx) => {
        return { user: ctx.store.jwtPayload };
      }, {
        beforeHandle: bearer({ jwt: jwtHelper })
      });
      
      // Without token
      const res1 = await app.handle(new Request("http://localhost/protected"));
      expect(res1.status).toBe(401);
      
      // With valid token
      const token = await jwtHelper.sign({ userId: "123" });
      const res2 = await app.handle(new Request("http://localhost/protected", {
        headers: { Authorization: `Bearer ${token}` }
      }));
      expect(res2.status).toBe(200);
      
      const body = await res2.json();
      expect(body.user.userId).toBe("123");
    });
    
    it("should support skip function", async () => {
      const app = new Asi();
      const jwtHelper = jwt({ secret: "test-secret" });
      
      app.get("/public", () => "public", {
        beforeHandle: bearer({ 
          jwt: jwtHelper,
          skip: (ctx) => ctx.path === "/public"
        })
      });
      
      const res = await app.handle(new Request("http://localhost/public"));
      expect(res.status).toBe(200);
    });
  });
  
  describe("Password Hashing", () => {
    it("should hash and verify passwords", async () => {
      const password = "my-secret-password";
      const hash = await hashPassword(password);
      
      expect(hash).not.toBe(password);
      expect(hash.length).toBeGreaterThan(50);
      
      const valid = await verifyPassword(password, hash);
      expect(valid).toBe(true);
      
      const invalid = await verifyPassword("wrong-password", hash);
      expect(invalid).toBe(false);
    });
  });
  
  describe("Token Generation", () => {
    it("should generate secure random tokens", () => {
      const token1 = generateToken();
      const token2 = generateToken();
      
      expect(token1).not.toBe(token2);
      expect(token1.length).toBeGreaterThan(20);
    });
    
    it("should generate tokens of specified length", () => {
      const token = generateToken(64);
      // Base64url encoding increases length
      expect(token.length).toBeGreaterThan(64);
    });
  });
  
  describe("Rate Limiting", () => {
    it("should limit requests with MemoryStore", async () => {
      const store = new MemoryStore();
      
      // First 3 requests should succeed (remaining goes 2, 1, 0)
      for (let i = 0; i < 3; i++) {
        const info = await store.increment("test-key-mem", 60000, 3);
        expect(info.remaining).toBe(3 - (i + 1)); // 2, 1, 0
      }
      
      // 4th request should be rate limited (remaining goes negative)
      const info = await store.increment("test-key-mem", 60000, 3);
      expect(info.remaining).toBe(-1); // Over limit
      
      store.destroy();
    });
    
    it("should limit requests with TokenBucketStore", async () => {
      const store = new TokenBucketStore();
      
      // First 3 requests should succeed
      for (let i = 0; i < 3; i++) {
        const info = await store.increment("test-key", 60000, 3);
        expect(info.remaining).toBeGreaterThanOrEqual(0);
      }
      
      store.destroy();
    });
    
    it("should integrate with Asi as beforeHandle", async () => {
      const app = new Asi();
      const uniqueKey = `integration-test-${Date.now()}`;
      
      app.get("/limited", () => "ok", {
        beforeHandle: rateLimitMiddleware({
          max: 2,
          windowMs: 60000,
          keyGenerator: () => uniqueKey, // Unique key for this test
        })
      });
      
      // First 2 requests should succeed
      const res1 = await app.handle(new Request("http://localhost/limited"));
      expect(res1.status).toBe(200);
      
      const res2 = await app.handle(new Request("http://localhost/limited"));
      expect(res2.status).toBe(200);
      
      // 3rd request should be rate limited
      const res3 = await app.handle(new Request("http://localhost/limited"));
      expect(res3.status).toBe(429);
      expect(res3.headers.get("X-RateLimit-Limit")).toBe("2");
      expect(res3.headers.get("X-RateLimit-Remaining")).toBe("0");
      
      const body = await res3.json();
      expect(body.error).toBe("Too Many Requests");
    });
  });
  
  describe("OpenAPI Generator", () => {
    it("should generate basic OpenAPI document", () => {
      const generator = new OpenAPIGenerator({
        title: "Test API",
        version: "1.0.0",
        description: "Test API description",
      });
      
      generator.addRoute({
        method: "GET",
        path: "/users",
        docs: {
          summary: "Get all users",
          tags: ["users"],
        },
      });
      
      generator.addRoute({
        method: "GET",
        path: "/users/:id",
        schemas: {
          params: Type.Object({ id: Type.String() }),
          response: Type.Object({ id: Type.String(), name: Type.String() }),
        },
        docs: {
          summary: "Get user by ID",
          tags: ["users"],
        },
      });
      
      const doc = generator.generate();
      
      expect(doc.openapi).toBe("3.0.3");
      expect(doc.info.title).toBe("Test API");
      expect(doc.info.version).toBe("1.0.0");
      expect(doc.paths["/users"]).toBeDefined();
      expect(doc.paths["/users/{id}"]).toBeDefined();
      expect(doc.paths["/users/{id}"].get?.parameters).toHaveLength(1);
    });
    
    it("should convert path parameters to OpenAPI format", () => {
      const generator = new OpenAPIGenerator({
        title: "Test",
        version: "1.0.0",
      });
      
      generator.addRoute({
        method: "GET",
        path: "/users/:userId/posts/:postId",
      });
      
      const doc = generator.generate();
      
      expect(doc.paths["/users/{userId}/posts/{postId}"]).toBeDefined();
      expect(doc.paths["/users/{userId}/posts/{postId}"].get?.parameters).toHaveLength(2);
    });
    
    it("should include request body for POST/PUT/PATCH", () => {
      const generator = new OpenAPIGenerator({
        title: "Test",
        version: "1.0.0",
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
      
      expect(doc.paths["/users"].post?.requestBody).toBeDefined();
      expect(doc.paths["/users"].post?.requestBody?.content["application/json"]).toBeDefined();
    });
    
    it("should add security schemes", () => {
      const generator = new OpenAPIGenerator({
        title: "Test",
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
      
      const doc = generator.generate();
      
      expect(doc.components?.securitySchemes?.bearerAuth).toBeDefined();
      expect(doc.security).toHaveLength(1);
    });
  });

  describe("Typed Client", () => {
    it("should create a basic client", () => {
      const client = createClient({ baseUrl: "http://localhost:3000" });
      
      expect(client.get).toBeDefined();
      expect(client.post).toBeDefined();
      expect(client.put).toBeDefined();
      expect(client.patch).toBeDefined();
      expect(client.delete).toBeDefined();
    });
    
    it("should build URLs with query params", async () => {
      let capturedUrl = "";
      
      const client = createClient({
        baseUrl: "http://localhost:3000",
        fetch: async (req) => {
          capturedUrl = req.url;
          return new Response(JSON.stringify({ ok: true }), {
            headers: { "Content-Type": "application/json" }
          });
        },
      });
      
      await client.get("/users", { query: { page: 1, limit: 10 } });
      
      expect(capturedUrl).toBe("http://localhost:3000/users?page=1&limit=10");
    });
    
    it("should handle POST with JSON body", async () => {
      let capturedBody = "";
      
      const client = createClient({
        baseUrl: "http://localhost:3000",
        fetch: async (req) => {
          capturedBody = await req.text();
          return new Response(JSON.stringify({ id: 1 }), {
            headers: { "Content-Type": "application/json" }
          });
        },
      });
      
      const result = await client.post("/users", { body: { name: "John" } });
      
      expect(capturedBody).toBe('{"name":"John"}');
      expect(result.data).toEqual({ id: 1 });
    });
    
    it("should create treaty proxy client", () => {
      const api = treaty("http://localhost:3000");
      
      // Should be a proxy that allows any property access
      expect(api).toBeDefined();
      expect(api.users).toBeDefined();
      expect(api.users.get).toBeDefined();
    });
  });

  describe("JSX Runtime", () => {
    it("should create JSX elements", () => {
      const element = jsx("div", { className: "test", children: "Hello" });
      
      expect(element.type).toBe("div");
      expect(element.props.className).toBe("test");
      expect(element.props.children).toBe("Hello");
    });
    
    it("should render simple element to string", async () => {
      const element = jsx("div", { children: "Hello World" });
      const result = await renderToString(element);
      
      expect(result).toBe("<div>Hello World</div>");
    });
    
    it("should render nested elements", async () => {
      const element = jsx("div", {
        children: [
          jsx("h1", { children: "Title" }),
          jsx("p", { children: "Paragraph" }),
        ]
      });
      
      const result = await renderToString(element);
      expect(result).toBe("<div><h1>Title</h1><p>Paragraph</p></div>");
    });
    
    it("should handle attributes", async () => {
      const element = jsx("a", { 
        href: "/test", 
        className: "link",
        children: "Click" 
      });
      
      const result = await renderToString(element);
      expect(result).toBe('<a href="/test" class="link">Click</a>');
    });
    
    it("should escape HTML in text content", async () => {
      const element = jsx("div", { children: "<script>alert('xss')</script>" });
      const result = await renderToString(element);
      
      expect(result).toBe("<div>&lt;script&gt;alert(&#x27;xss&#x27;)&lt;/script&gt;</div>");
    });
    
    it("should handle void elements", async () => {
      const element = jsx("br", {});
      const result = await renderToString(element);
      
      expect(result).toBe("<br />");
    });
    
    it("should handle Fragment", async () => {
      const element = jsx(Fragment, {
        children: [
          jsx("span", { children: "A" }),
          jsx("span", { children: "B" }),
        ]
      });
      
      const result = await renderToString(element);
      expect(result).toBe("<span>A</span><span>B</span>");
    });
    
    it("should render function components", async () => {
      function Greeting({ name }: { name: string }) {
        return jsx("h1", { children: `Hello, ${name}!` });
      }
      
      const element = jsx(Greeting, { name: "World" });
      const result = await renderToString(element);
      
      expect(result).toBe("<h1>Hello, World!</h1>");
    });
    
    it("should return HTML response", async () => {
      const element = jsx("html", {
        children: jsx("body", { children: "Test" })
      });
      
      const response = await html(element);
      
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
      
      const body = await response.text();
      expect(body).toBe("<!DOCTYPE html><html><body>Test</body></html>");
    });
    
    it("should return streaming HTML response", async () => {
      const element = jsx("html", {
        children: jsx("body", { children: "Streamed" })
      });
      
      const response = stream(element);
      
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
      
      const body = await response.text();
      expect(body).toBe("<!DOCTYPE html><html><body>Streamed</body></html>");
    });
    
    it("should escape HTML with escapeHtml", () => {
      expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
      expect(escapeHtml("a & b")).toBe("a &amp; b");
      expect(escapeHtml('"quote"')).toBe("&quot;quote&quot;");
    });
    
    it("should use htmlTemplate tagged literal", () => {
      const name = "<script>evil</script>";
      const result = htmlTemplate`<h1>Hello ${name}!</h1>`;
      
      expect(result).toBe("<h1>Hello &lt;script&gt;evil&lt;/script&gt;!</h1>");
    });
    
    it("should render with when helper", () => {
      const trueCase = when(true, () => jsx("span", { children: "yes" }));
      const falseCase = when(false, () => jsx("span", { children: "no" }));
      
      expect(trueCase).not.toBeNull();
      expect(falseCase).toBeNull();
    });
    
    it("should render lists with each helper", () => {
      const items = ["a", "b", "c"];
      const elements = each(
        items, 
        (item, i) => jsx("li", { children: item }),
        (item) => item
      );
      
      expect(elements).toHaveLength(3);
      expect(elements[0].type).toBe("li");
      expect(elements[0].key).toBe("a");
    });
  });
});
