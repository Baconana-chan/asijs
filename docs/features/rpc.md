# RPC 2.0 & Server Actions

## Server Actions

Define typed server actions validated with TypeBox:

```typescript
import { serverAction, Asi } from "asijs";
import { Type } from "@sinclair/typebox";

const greet = serverAction(
  Type.Object({ name: Type.String({ minLength: 1 }) }),
  async ({ name }) => {
    return { message: `Hello, ${name}!` };
  },
);
```

## Register with App

```typescript
import { Asi, rpc } from "asijs";

const app = new Asi();

const api = rpc(app, {
  greet,
  ping: serverAction(Type.Object({}), async () => ({
    status: "ok",
    timestamp: Date.now(),
  })),
});

export type AppAPI = typeof api;
// Endpoints: POST /rpc/greet, POST /rpc/ping
```

## Client-Side Usage

```typescript
import { createRPCClient } from "asijs/client";
import type { AppAPI } from "./server";

const api = createRPCClient<AppAPI>("http://localhost:3000");

const result = await api.greet({ name: "World" });
//    ^? { message: string }
```

## Error Handling

```typescript
import { RPCActionError } from "asijs";

throw new RPCActionError("Insufficient funds", "INSUFFICIENT_FUNDS", {
  balance: 100,
  requested: 999,
});

// Client side:
try {
  await api.withdraw({ amount: 999999 });
} catch (error) {
  if (error instanceof RPCActionError) {
    console.log(error.code);    // "INSUFFICIENT_FUNDS"
    console.log(error.details); // { balance, requested }
  }
}
```

## Type Helpers

```typescript
import type { InferRPCInput, InferRPCOutput, InferRPCAPI } from "asijs";

type Input = InferRPCInput<typeof greet>;
type Output = InferRPCOutput<typeof greet>;
type All = InferRPCAPI<typeof api>;
```
