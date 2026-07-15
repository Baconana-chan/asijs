# Response Caching

## ETag Middleware

```typescript
import { etag } from "asijs";

app.use(etag());  // Auto-generate ETags for all responses

// Supports If-None-Match → 304 Not Modified
```

## Cache Plugin

```typescript
import { cachePlugin, staticCache, apiCache, cdnCache } from "asijs";

app.plugin(cachePlugin(staticCache));  // 1 hour, public
app.plugin(cachePlugin(apiCache));     // 1 minute, private
app.plugin(cachePlugin(cdnCache));     // 1 day, public, immutable
```

## Per-Route Caching

```typescript
import { cache } from "asijs";

app.get("/heavy-report", handler, {
  afterHandle: cache({ ttl: "1h", private: false }),
});
```

## MemoryCache

```typescript
import { MemoryCache } from "asijs";

const cache = new MemoryCache<string>();
cache.set("key", "value", "5m");
cache.get("key");     // "value"
cache.has("key");     // true
cache.delete("key");
cache.destroy();
```

## Manual Cache Control

```typescript
import { parseTTL, buildCacheControl } from "asijs";

parseTTL("30s");   // 30
parseTTL("5m");    // 300
parseTTL("2h");    // 7200
parseTTL("1d");    // 86400

buildCacheControl({ ttl: "1h" });               // "public, max-age=3600"
buildCacheControl({ ttl: "5m", private: true }); // "private, max-age=300"
buildCacheControl({ noStore: true });             // "no-store"
```
