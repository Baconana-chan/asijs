# Plugins

## Using Plugins

```typescript
import { Asi, cors, jwt, rateLimit, openapi, security } from "asijs";

const app = new Asi();

app.plugin(cors({ origin: "*" }));
app.plugin(jwt({ secret: "my-secret" }));
app.plugin(rateLimit({ max: 100, windowMs: 60_000 }));
app.plugin(openapi({ info: { title: "My API", version: "1.0.0" } }));
app.plugin(security());
app.plugin(lifecycle());
app.plugin(trace());
```

## Creating Plugins

```typescript
import { createPlugin, AsiPlugin } from "asijs";

const myPlugin: AsiPlugin = createPlugin({
  name: "my-plugin",

  // Optional: plugin dependencies
  dependencies: ["cors"],

  setup(app) {
    app.get("/from-plugin", () => "Hello from plugin!");
    app.setState("myPluginData", { initialized: true });
  },
});

app.plugin(myPlugin);
```

## Plugin with Decorators

```typescript
const helperPlugin = createPlugin({
  name: "helpers",
  setup(app) {
    app.decorate("now", () => new Date());
    app.decorate("randomId", () => crypto.randomUUID());
  },
});

app.plugin(helperPlugin);

// Later in a handler:
const id = app.decorator("randomId");  // Use decorator
```
