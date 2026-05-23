# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build        # tsup → dist/ (CJS + ESM + .d.ts)
npm run dev          # tsup --watch
npm run test         # vitest run (single pass)
npm run test:watch   # vitest interactive
npm run lint         # tsc --noEmit (type-check only, no emit)
```

Run a single test file:
```bash
npx vitest run __tests__/client.test.ts
```

## Architecture

### Entry Points

Two published subpaths, one underlying class:

| Import | Entry | Purpose |
|--------|-------|---------|
| `@togul/js` | `src/index.ts` | Universal — exports `TogulClient`, `EvaluateResult`, `TogulApiError`, `TogulConfigError`, types |
| `@togul/js/server` | `src/server/index.ts` | Server-only alias — re-exports `TogulClient` and types from `../client` |

`tsup`'s `splitting: true` extracts shared code into a chunk so `client.ts` isn't duplicated across CJS/ESM bundles.

### Core Files

- `src/client.ts` — `TogulClient`: all logic lives here (HTTP, cache, SSE stream, retry)
- `src/types.ts` — all interfaces + `EvaluateResult` class + `getBaseUrl` helper
- `src/errors.ts` — `TogulApiError` (HTTP errors) and `TogulConfigError` (bad constructor args)

### TogulClient internals

**Cache:** `Map<string, CacheEntry>` keyed as `flagKey:environment:key=val:key=val` (context keys sorted for determinism). A `valueType === ""` sentinel marks stale/invalid entries as cache misses without deleting them eagerly.

**Retry:** Only `429` and `5xx` are retried (linear backoff: `attempt * 100ms`). All other `4xx` throw immediately without retry.

**SSE stream:** `startStream()` opens `/api/v1/stream` and calls `invalidateCache()` on every `data:` line. On disconnect, exponential backoff starting at 1s, capped at 30s. Auth errors (401/403) abort without retrying. `onCacheInvalidated()` returns an unsubscribe function — consumers use this to re-evaluate flags.

### API Contract

Evaluate endpoint: `POST /api/v1/evaluate`  
Auth: `X-API-Key` header (not `Authorization`).  
Request body: `{ flag_key, environment_key, context }`.  
Response: `{ flag_key, enabled, value_type, value, reason }`.

`enabled` indicates whether the flag record is active; `value` holds the actual evaluated result. Always check `value` — a flag can be `enabled: false` yet still carry a fallback value.

### Testing

Tests mock `global.fetch` via `vi.spyOn`. The `createClient()` helper always passes `baseUrl: "http://localhost:8080"` to avoid hitting production. No test fixtures or setup files — test helpers are defined inline in `__tests__/client.test.ts`.
