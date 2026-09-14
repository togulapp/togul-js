import { TogulClient } from "../client";
import type { EvalContext, EvaluateResult, TogulConfig } from "../types";

/**
 * Togul client for request-scoped edge runtimes — Cloudflare Workers, Vercel
 * Edge Functions, Next.js middleware, Deno Deploy.
 *
 * This is a thin facade over {@link TogulClient}, not a separate implementation:
 * evaluation, caching and retry all run the same code the Node client runs. What
 * it changes is the *surface*.
 *
 * `startStream()` and `stopStream()` are deliberately absent. An edge isolate is
 * torn down once it has produced a response, so a long-lived SSE connection
 * cannot survive it — the connection dies with the isolate and no invalidation
 * event ever arrives. Exposing those methods here would let callers write code
 * that silently does nothing, which is worse than not offering them at all.
 *
 * Two consequences worth knowing before you rely on this:
 *
 * 1. **No real-time invalidation.** A flag change reaches this client only when
 *    its cached entry expires. `cacheTtl` is your staleness budget, not a
 *    refresh interval backed by a stream.
 * 2. **The cache is ephemeral and per-isolate.** Isolates are short-lived and
 *    geographically distributed, so a given request may well start cold. Under
 *    Node a `cacheTtl` of 30s means roughly one request per 30s; at the edge it
 *    means one request per new isolate. Size your evaluation quota accordingly.
 */
export class TogulEdgeClient {
  private readonly client: TogulClient;

  constructor(config: TogulConfig) {
    this.client = new TogulClient(config);
  }

  /** Evaluate a flag and return the full result mirroring the API response. */
  evaluate(flagKey: string, context: EvalContext = {}): Promise<EvaluateResult> {
    return this.client.evaluate(flagKey, context);
  }

  /** Drop every cached evaluation. */
  invalidateCache(): void {
    this.client.invalidateCache();
  }

  /** Drop the cached evaluations for one flag. */
  invalidateFlag(flagKey: string): void {
    this.client.invalidateFlag(flagKey);
  }

  /**
   * Observe invalidations. At the edge these fire only for your own
   * `invalidateCache()` / `invalidateFlag()` calls — there is no stream to
   * trigger them on the server's behalf.
   *
   * @returns an unsubscribe function.
   */
  onCacheInvalidated(listener: () => void): () => void {
    return this.client.onCacheInvalidated(listener);
  }
}

export { TogulApiError, TogulConfigError } from "../errors";
export { EvaluateResult } from "../types";
export type { CacheAdapter, EvalContext, TogulConfig, ValueType } from "../types";
