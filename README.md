# Togul JS SDK

Official JavaScript / Next.js SDK for [Togul](https://github.com/togulapp/togul) feature flags with built-in caching, retry logic, and React hooks.

## Install

```bash
npm install @togul/js
```

## Quick Start

### Server-side (Node.js / API Routes)

```typescript
import { TogulClient } from "@togul/js/server";

const client = new TogulClient({
  baseUrl: "https://api.togul.com",
  apiKey: "your-environment-api-key",
  environment: "production",
});

const enabled = await client.isEnabled("new-dashboard", {
  user_id: "user-123",
  country: "TR",
});
```

Or use the standalone helper functions (no client instance needed):

```typescript
import { evaluateFlag, evaluateFlags } from "@togul/js/server";

const enabled = await evaluateFlag(config, "new-dashboard", { user_id: "user-123" });

const results = await evaluateFlags(config, ["dark-mode", "beta-nav"], { user_id: "user-123" });
// results => { "dark-mode": true, "beta-nav": false }
```

### Client-side (React / Next.js)

Wrap your app with `TogulProvider`:

```tsx
// app/providers.tsx
"use client";

import { TogulProvider } from "@togul/js";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <TogulProvider
      config={{
        baseUrl: process.env.NEXT_PUBLIC_TOGUL_URL!,
        apiKey: process.env.NEXT_PUBLIC_TOGUL_KEY!,
        environment: "production",
      }}
      stream // enable real-time cache invalidation via SSE
    >
      {children}
    </TogulProvider>
  );
}
```

Use the `useFeatureFlag` hook:

```tsx
"use client";

import { useFeatureFlag } from "@togul/js/hooks";

export function Dashboard() {
  const { enabled, isLoading, error, refetch } = useFeatureFlag("new-dashboard", {
    context: { user_id: "user-123" },
    fallback: false, // value to use while loading or on error
  });

  if (isLoading) return <p>Loading...</p>;
  if (error) return <p>Error: {error.message}</p>;

  return enabled ? <NewDashboard /> : <OldDashboard />;
}
```

Evaluate multiple flags at once:

```tsx
"use client";

import { useFeatureFlags } from "@togul/js/hooks";

export function FeaturePanel() {
  const { flags, isLoading, error, refetch } = useFeatureFlags(
    ["dark-mode", "beta-nav", "new-search"],
    { context: { user_id: "user-123" } }
  );

  return (
    <div>
      {flags["dark-mode"] && <DarkModeToggle />}
      {flags["beta-nav"] && <BetaNavigation />}
      {flags["new-search"] && <NewSearchBar />}
    </div>
  );
}
```

Disable automatic fetching and trigger manually:

```tsx
const { enabled, refetch } = useFeatureFlag("new-dashboard", {
  disabled: true, // won't fetch on mount
});

// fetch when ready
await refetch();
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `baseUrl` | `string` | *required* | Togul API base URL |
| `apiKey` | `string` | *required* | Environment API key |
| `environment` | `string` | *required* | Environment identifier |
| `timeout` | `number` | `5000` | Request timeout (ms) |
| `cacheTtl` | `number` | `30000` | Cache TTL (ms) |
| `fallbackMode` | `"fail-open" \| "fail-closed"` | `"fail-closed"` | Behavior on error |
| `retryCount` | `number` | `2` | Retry count for 429/5xx |

## Hook Options

Both `useFeatureFlag` and `useFeatureFlags` accept the same options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `context` | `Record<string, string>` | `{}` | User evaluation context |
| `fallback` | `boolean` | `false` | Value returned while loading or on error |
| `disabled` | `boolean` | `false` | Disable automatic fetching |

## Streaming (SSE)

Enable real-time cache invalidation via `TogulProvider` or manually:

```typescript
const client = new TogulClient({ ... });

// Start listening for flag changes
await client.startStream();

// Stop streaming
client.stopStream();

// Manual cache invalidation
client.invalidateCache();
client.invalidateFlag("specific-flag");

// Subscribe to cache invalidation events
const unsubscribe = client.onCacheInvalidated(() => {
  console.log("Cache was invalidated, re-fetch your flags");
});

// Call unsubscribe() to stop listening
unsubscribe();
```

The SSE connection uses exponential backoff on disconnection (starting at 1s, up to 30s max). Authentication errors (401/403) will permanently abort the stream without retrying.

## Error Handling

The SDK exports two error classes:

```typescript
import { TogulApiError, TogulConfigError } from "@togul/js";

try {
  const enabled = await client.isEnabled("my-flag");
} catch (err) {
  if (err instanceof TogulApiError) {
    console.error(err.statusCode); // HTTP status code (e.g. 404, 500)
    console.error(err.code);       // API error code string
  }
  if (err instanceof TogulConfigError) {
    // Invalid client configuration
  }
}
```

Retry behavior: requests are retried automatically on `429` (rate limit) and `5xx` (server) errors. Client errors (`4xx`, except 429) fail immediately without retry.

## Exports

```
@togul/js        - TogulClient, TogulApiError, TogulConfigError,
                   TogulProvider, useTogulClient, types
@togul/js/hooks  - useFeatureFlag, useFeatureFlags
@togul/js/server - TogulClient, evaluateFlag, evaluateFlags, types
```

## License

MIT
