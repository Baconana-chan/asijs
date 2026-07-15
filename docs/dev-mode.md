# Development Mode

## Dev Dashboard

Access the dev dashboard at `http://localhost:3000/__dev`:

```typescript
import { devMode, debugLog, logBody, delay, chaos } from "asijs";

app.plugin(devMode({
  banner: true,    // Show dev banner
  dashboard: true, // Enable /__dev dashboard
}));
```

## Dev Middleware

```typescript
// Log all requests with a prefix
app.use(debugLog("API"));

// Log request bodies
app.use(logBody());

// Simulate network delay
app.use(delay(500));  // 500ms delay

// Chaos engineering — random failures
app.use(chaos(0.1, 500));  // 10% chance of 500 error
```

The dev dashboard shows:
- All registered routes with methods and paths
- Request history with timing
- Plugin list
- Server configuration
