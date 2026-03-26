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
  const { enabled, isLoading, error } = useFeatureFlag("new-dashboard", {
    context: { user_id: "user-123" },
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
  const { flags, isLoading } = useFeatureFlags(
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
```

## Exports

```
@togul/js           - TogulProvider, useTogulClient, types
@togul/js/hooks     - useFeatureFlag, useFeatureFlags
@togul/js/server    - TogulClient, evaluateFlag, evaluateFlags
```

## License

MIT
