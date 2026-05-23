# Togul JS SDK

Official JavaScript / Next.js SDK for [Togul](https://github.com/togulapp/togul) feature flags with built-in caching, retry logic, and real-time streaming.

## Install

```bash
npm install @togul/js
```

## Quick Start

```typescript
import { TogulClient } from "@togul/js";

const client = new TogulClient({
  apiKey: "your-environment-api-key",
  environment: "production",
});

const result = await client.evaluate("new-dashboard", {
  user_id: "user-123",
  country: "TR",
});

console.log(result.enabled);   // boolean — whether the flag is active
console.log(result.value);     // unknown — evaluated value (boolean, string, number, json)
console.log(result.valueType); // "boolean" | "string" | "number" | "json"
console.log(result.reason);    // "rule_match" | "default" | "disabled"
```

Server-side (Next.js App Router, API routes):

```typescript
import { TogulClient } from "@togul/js/server";

const client = new TogulClient({
  apiKey: process.env.TOGUL_API_KEY!,
  environment: "production",
});

const result = await client.evaluate("show-banner").catch(() => null);
const showBanner = result?.enabled && result.value === true;
```

## EvaluateResult

| Field | Type | Description |
|-------|------|-------------|
| `flagKey` | `string` | Flag identifier |
| `enabled` | `boolean` | Whether the flag record is active |
| `value` | `unknown` | Evaluated value after rules — boolean, string, number, or JSON |
| `valueType` | `"boolean" \| "string" \| "number" \| "json"` | Value type |
| `reason` | `string` | Evaluation reason: `"rule_match"`, `"default"`, `"disabled"` |

> `enabled` only indicates whether the flag is active. Always check `value` for the actual evaluated result.

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | *required* | Environment API key |
| `environment` | `string` | *required* | Environment identifier |
| `timeout` | `number` | `5000` | Request timeout (ms) |
| `cacheTtl` | `number` | `30000` | Cache TTL (ms) — used only with the built-in in-memory cache |
| `retryCount` | `number` | `2` | Retry count for 429/5xx |
| `baseUrl` | `string` | `https://api.togul.io` | Override base URL (optional, for testing) |
| `cacheAdapter` | `CacheAdapter` | `undefined` | External cache backend (e.g. Redis). Falls back to in-memory when omitted. |

Passing an empty `apiKey` or `environment` throws `TogulConfigError` immediately — before any network call is made.

## Flag Evaluation

### Boolean flag

```typescript
const result = await client.evaluate("new-checkout-flow");

if (result.enabled && result.value === true) {
  showNewCheckout();
} else {
  showLegacyCheckout();
}
```

### String flag

```typescript
const result = await client.evaluate("ui-theme");

if (result.valueType === "string") {
  applyTheme(result.value as string); // "dark" | "light" | "system"
}
```

### Number flag

```typescript
const result = await client.evaluate("rate-limit-per-minute");

if (result.valueType === "number") {
  applyRateLimit(result.value as number); // e.g. 100
}
```

### JSON flag

```typescript
const result = await client.evaluate("pricing-config");

if (result.valueType === "json") {
  const config = result.value as { plan: string; limit: number };
  console.log(config.plan);  // "pro"
  console.log(config.limit); // 500
}
```

## Evaluation Context

Pass a context object to enable rule-based targeting. All values must be strings.

```typescript
const result = await client.evaluate("beta-dashboard", {
  user_id: "user-123",
  plan: "pro",
  country: "TR",
});
```

The cache key is derived from `flagKey + environment + context`, so different contexts produce separate cache entries.

## Multiple Flags

Use `Promise.all` for parallel evaluation:

```typescript
const [themeResult, navResult, searchResult] = await Promise.all([
  client.evaluate("ui-theme", { user_id: userId }),
  client.evaluate("beta-nav", { user_id: userId }),
  client.evaluate("new-search", { user_id: userId }),
]);
```

## Cache Management

By default each `TogulClient` instance uses an in-memory cache. Pass a `cacheAdapter` to share the cache across processes (e.g. multiple Node.js workers or k8s pods).

```typescript
// Invalidate all cached results
client.invalidateCache();

// Invalidate a single flag (all context variants)
client.invalidateFlag("new-checkout-flow");

// Subscribe to invalidation events
const unsubscribe = client.onCacheInvalidated(() => {
  // re-evaluate your flags here
});

unsubscribe(); // stop listening
```

### External Cache Adapter (Redis)

Implement the `CacheAdapter` interface to plug in any shared cache:

```typescript
import type { CacheAdapter, EvaluateResult } from "@togul/js";

export interface CacheAdapter {
  get(key: string): Promise<EvaluateResult | null>;
  set(key: string, result: EvaluateResult, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  deleteByPrefix(prefix: string): Promise<void>;
}
```

Example Redis adapter using [ioredis](https://github.com/redis/ioredis):

```typescript
import Redis from "ioredis";
import { EvaluateResult } from "@togul/js";
import type { CacheAdapter } from "@togul/js";

export function createRedisCacheAdapter(redis: Redis): CacheAdapter {
  return {
    async get(key) {
      const raw = await redis.get(`togul:${key}`);
      if (!raw) return null;
      const d = JSON.parse(raw);
      return new EvaluateResult(d.flagKey, d.enabled, d.valueType, d.value, d.reason);
    },
    async set(key, result, ttlMs) {
      await redis.set(`togul:${key}`, JSON.stringify(result), "PX", ttlMs);
    },
    async delete(key) {
      await redis.del(`togul:${key}`);
    },
    async clear() {
      const keys = await redis.keys("togul:*");
      if (keys.length) await redis.del(...keys);
    },
    async deleteByPrefix(prefix) {
      const keys = await redis.keys(`togul:${prefix}*`);
      if (keys.length) await redis.del(...keys);
    },
  };
}
```

Pass the adapter when creating the client:

```typescript
import { TogulClient } from "@togul/js/server";
import { createRedisCacheAdapter } from "./redis-cache";
import redis from "./redis";

const client = new TogulClient({
  apiKey: process.env.TOGUL_API_KEY!,
  environment: "production",
  cacheAdapter: createRedisCacheAdapter(redis),
});
```

## Streaming (SSE)

Enable real-time cache invalidation. The stream calls `invalidateCache()` on every `data:` line received from the server.

```typescript
const client = new TogulClient({ ... });

await client.startStream(); // idempotent — safe to call multiple times

const unsubscribe = client.onCacheInvalidated(async () => {
  const result = await client.evaluate("feature-x");
  console.log("Updated value:", result.value);
});

// Cleanup
client.stopStream();
unsubscribe();
```

The SSE connection uses exponential backoff on disconnection (starting at 1s, up to 30s max). Authentication errors (401/403) abort the stream without retrying.

## Error Handling

```typescript
import { TogulApiError, TogulConfigError } from "@togul/js";

try {
  const result = await client.evaluate("my-flag");
} catch (err) {
  if (err instanceof TogulApiError) {
    console.error(err.statusCode); // HTTP status code
    console.error(err.code);       // API error code string
  }
  if (err instanceof TogulConfigError) {
    // Invalid client configuration
  }
}
```

Requests are retried automatically on `429` and `5xx` errors. Client errors (`4xx` except 429) fail immediately.

Fail-open pattern (recommended for non-critical flags):

```typescript
const result = await client.evaluate("my-flag").catch(() => null);
const isEnabled = result?.enabled === true && result.value === true;
```

## Server-Side Usage

### Next.js Server Component

```typescript
// app/dashboard/page.tsx
import { TogulClient } from "@togul/js/server";

const client = new TogulClient({
  apiKey: process.env.TOGUL_API_KEY!,
  environment: "production",
});

export default async function DashboardPage() {
  const result = await client.evaluate("new-dashboard-layout").catch(() => null);
  const showNewLayout = result?.enabled && result.value === true;

  return showNewLayout ? <NewLayout /> : <OldLayout />;
}
```

### Next.js API Route

```typescript
// app/api/feature/route.ts
import { TogulClient } from "@togul/js/server";
import { NextRequest, NextResponse } from "next/server";

const client = new TogulClient({
  apiKey: process.env.TOGUL_API_KEY!,
  environment: "production",
});

export async function GET(req: NextRequest) {
  const userId = req.headers.get("x-user-id") ?? "";
  const result = await client.evaluate("new-feature", { user_id: userId }).catch(() => null);

  return NextResponse.json({
    enabled: result?.enabled ?? false,
    value: result?.value ?? null,
  });
}
```

### Singleton (module-level cache)

Each `TogulClient` carries its own cache. A module-level singleton lets the cache persist across requests instead of being discarded on every call.

```typescript
// lib/togul.ts
import { TogulClient } from "@togul/js/server";

let _client: TogulClient | null = null;

export function getTogulClient(): TogulClient {
  if (!_client) {
    _client = new TogulClient({
      apiKey: process.env.TOGUL_API_KEY!,
      environment: process.env.TOGUL_ENV ?? "production",
    });
  }
  return _client;
}
```

## Exports

```
@togul/js        - TogulClient, EvaluateResult, TogulApiError, TogulConfigError, CacheAdapter, types
@togul/js/server - TogulClient, types
```

## License

MIT
