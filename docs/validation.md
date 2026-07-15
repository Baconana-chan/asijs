# Validation

AsiJS uses **TypeBox** for runtime validation with full TypeScript type inference. No code generation needed — types flow automatically.

## Basic Validation

```typescript
import { Asi, Type } from "asijs";

app.post(
  "/users",
  (ctx) => {
    // ctx.query is typed: { page?: number }
    // ctx.body is typed: { name: string; email: string }
    return { user: ctx.body, page: ctx.query.page };
  },
  {
    body: Type.Object({
      name: Type.String({ minLength: 1 }),
      email: Type.String({ format: "email" }),
    }),
    query: Type.Object({
      page: Type.Optional(Type.Number()),
    }),
  },
);
```

## TypeBox Types

All TypeBox types are re-exported from AsiJS:

```typescript
import { Type } from "asijs";

const schema = Type.Object({
  name: Type.String(),
  age: Type.Number(),
  isActive: Type.Boolean(),
  tags: Type.Array(Type.String()),
  role: Type.Enum({ admin: "admin", user: "user" }),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Any())),
  createdAt: Type.String({ format: "date-time" }),
});
```

## String Formats

```typescript
Type.String({ format: "email" });
Type.String({ format: "uri" });
Type.String({ format: "date-time" });
Type.String({ format: "date" });
Type.String({ format: "time" });
Type.String({ format: "ipv4" });
Type.String({ format: "ipv6" });
Type.String({ format: "uuid" });
```

## Validation Functions

```typescript
import { validate, validateAndCoerce, createValidator } from "asijs";

const schema = Type.Object({ name: Type.String() });

// Basic validation
const result = validate(schema, { name: "Alice" });
if (result.success) {
  console.log(result.data); // Typed as { name: string }
}

// With coercion (string "123" → number 123)
const coerced = validateAndCoerce(
  Type.Object({ age: Type.Number() }),
  { age: "25" },
);
// coerced.data.age is number 25

// Create reusable validator
const validator = createValidator(schema);
const check = validator({ name: "Bob" });
```

## Error Handling

Validation errors return 400 with detailed messages:

```json
{
  "error": "Validation Error",
  "details": [
    {
      "path": "body.name",
      "message": "Expected string",
      "expected": "string",
      "received": "number"
    }
  ]
}
```
