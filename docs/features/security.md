# Security Headers

```typescript
import { security, strictSecurity, relaxedSecurity, apiSecurity } from "asijs";

app.plugin(security());  // Default (good balance)

// Presets
app.plugin(security(strictSecurity));   // Maximum security
app.plugin(security(relaxedSecurity));  // More permissive
app.plugin(security(apiSecurity));      // API-focused (no CSP)
```

## Custom Security Options

```typescript
import { securityHeaders, generateNonce, nonceMiddleware } from "asijs";

app.use(securityHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", (ctx) => `'nonce-${generateNonce()}'`],
    styleSrc: ["'self'", "'unsafe-inline'"],
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
  referrerPolicy: "strict-origin-when-cross-origin",
  permissionsPolicy: { camera: false, microphone: false },
}));
```

## Nonce for Inline Scripts

```typescript
app.use(nonceMiddleware());

// Access nonce in handlers:
app.get("/", (ctx) => {
  const nonce = ctx.store.nonce;
  return ctx.html(`<script nonce="${nonce}">alert('safe')</script>`);
});
```
