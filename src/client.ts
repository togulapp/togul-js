import type {
  TogulConfig,
  EvalContext,
  EvaluateRequest,
  EvaluateResponse,
  ApiErrorResponse,
  CacheEntry,
} from "./types";
import { EvaluateResult, getBaseUrl } from "./types";
import { TogulApiError, TogulConfigError } from "./errors";

export class TogulClient {
  private readonly config: Required<Omit<TogulConfig, "baseUrl">> & { baseUrl: string };
  private cache = new Map<string, CacheEntry>();
  private streamController: AbortController | null = null;
  private listeners = new Set<() => void>();

  constructor(config: TogulConfig) {
    if (!config.apiKey) throw new TogulConfigError("apiKey is required");
    if (!config.environment) throw new TogulConfigError("environment is required");

    this.config = {
      baseUrl: getBaseUrl(config),
      apiKey: config.apiKey,
      environment: config.environment,
      timeout: config.timeout ?? 5000,
      cacheTtl: config.cacheTtl ?? 30000,
      retryCount: config.retryCount ?? 2,
    };
  }

  /** Evaluate a flag and return the full result mirroring the API response. */
  async evaluate(flagKey: string, context: EvalContext = {}): Promise<EvaluateResult> {
    const cacheKey = this.cacheKey(flagKey, context);
    const cached = this.cache.get(cacheKey);

    // Empty valueType means stale/invalid entry — treat as cache miss.
    if (cached && Date.now() < cached.expiresAt && cached.result.valueType !== "") {
      return cached.result;
    }

    if (cached) {
      this.cache.delete(cacheKey);
    }

    const result = await this.fetchEvaluation(flagKey, context);
    this.cache.set(cacheKey, {
      result,
      expiresAt: Date.now() + this.config.cacheTtl,
    });
    return result;
  }

  private async fetchEvaluation(flagKey: string, context: EvalContext): Promise<EvaluateResult> {
    const body: EvaluateRequest = {
      flag_key: flagKey,
      environment_key: this.config.environment,
      context,
    };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.retryCount; attempt++) {
      if (attempt > 0) {
        await this.sleep(attempt * 100);
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeout);

        const response = await fetch(`${this.config.baseUrl}/api/v1/evaluate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": this.config.apiKey,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          const apiError = await this.parseError(response);

          if (response.status === 429 || response.status >= 500) {
            lastError = apiError;
            continue;
          }

          throw apiError;
        }

        const data: EvaluateResponse = await response.json();
        return new EvaluateResult(data.flag_key, data.enabled, data.value_type, data.value, data.reason);
      } catch (err) {
        if (err instanceof TogulApiError) throw err;
        lastError = err as Error;
      }
    }

    throw lastError ?? new Error("@togul/js: all retries failed");
  }

  invalidateCache(): void {
    this.cache.clear();
    this.notifyListeners();
  }

  invalidateFlag(flagKey: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${flagKey}:`)) {
        this.cache.delete(key);
      }
    }
    this.notifyListeners();
  }

  async startStream(): Promise<void> {
    if (this.streamController) return;

    this.streamController = new AbortController();
    await this.stream(this.streamController.signal);
  }

  stopStream(): void {
    this.streamController?.abort();
    this.streamController = null;
  }

  onCacheInvalidated(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async stream(signal: AbortSignal): Promise<void> {
    let backoff = 1000;

    while (!signal.aborted) {
      try {
        await this.streamOnce(signal);
        backoff = 1000;
      } catch (err) {
        if (signal.aborted) return;

        const apiErr = err as TogulApiError;
        if (apiErr.statusCode === 401 || apiErr.statusCode === 403) {
          throw err;
        }

        await this.sleep(backoff);
        backoff = Math.min(backoff * 2, 30000);
      }
    }
  }

  private async streamOnce(signal: AbortSignal): Promise<void> {
    const response = await fetch(`${this.config.baseUrl}/api/v1/stream`, {
      headers: {
        Accept: "text/event-stream",
        "X-API-Key": this.config.apiKey,
      },
      signal,
    });

    if (!response.ok) {
      throw await this.parseError(response);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            this.invalidateCache();
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private cacheKey(flagKey: string, context: EvalContext): string {
    const keys = Object.keys(context).sort();
    const parts = [flagKey, this.config.environment];
    for (const key of keys) {
      parts.push(`${key}=${context[key]}`);
    }
    return parts.join(":");
  }

  private async parseError(response: Response): Promise<TogulApiError> {
    try {
      const data: ApiErrorResponse = await response.json();
      return new TogulApiError(response.status, data.code, data.message);
    } catch {
      return new TogulApiError(response.status, "", "");
    }
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
