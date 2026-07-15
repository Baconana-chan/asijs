# Authentication

## JWT

```typescript
import { Asi, jwt } from "asijs";

app.plugin(jwt({ secret: "your-secret-key" }));

// JWT helper available as ctx.jwt
app.get("/verify", (ctx) => {
  const payload = ctx.jwt;  // Decoded JWT payload
  return { user: payload.sub };
});

// Sign custom tokens
app.post("/login", async (ctx) => {
  const { username } = await ctx.json();
  const token = await ctx.jwt.sign({ sub: username, role: "user" });
  return { token };
});
```

## Bearer Auth

```typescript
import { bearer } from "asijs";

app.get("/protected", handler, {
  beforeHandle: bearer({ header: "Authorization" }),
});
```

## Password Hashing

```typescript
import { hashPassword, verifyPassword } from "asijs";

const hash = await hashPassword("user-password");
const valid = await verifyPassword("user-password", hash);
```

## CSRF Protection

```typescript
import { generateCsrfToken, csrf } from "asijs";

const token = generateCsrfToken();

// Use csrf middleware to validate
app.post("/secure", handler, {
  beforeHandle: csrf({ secret: "csrf-secret" }),
});
```
