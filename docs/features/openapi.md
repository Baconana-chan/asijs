# OpenAPI / Swagger

```typescript
import { Asi, openapi } from "asijs";

app.plugin(openapi({
  info: {
    title: "My API",
    version: "1.0.0",
    description: "API documentation",
  },
  servers: [{ url: "http://localhost:3000" }],
}));
```

Access Swagger UI at `/docs` or `/swagger` (configurable via `path` option).
OpenAPI spec available at `/docs/openapi.json` or `/docs/openapi.yaml`.
