import type {
  TogulConfig,
  EvalContext,
  EvaluateRequest,
  EvaluateResponse,
  ApiErrorResponse,
  CacheEntry,
} from "./types";
import { getBaseUrl } from "./types";
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
      fallbackMode: config.fallbackMode ?? "fail-closed",
      retryCount: config.retryCount ?? 2,
    };
  }

  async isEnabled(flagKey: string, context: EvalContext = {}): Promise<boolean> {
    const cacheKey = this.cacheKey(flagKey, context);
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() < cached.expiresAt) {
      return cached.value;
    }

    if (cached) {
      this.cache.delete(cacheKey);
    }

    try {
      const value = await this.evaluate(flagKey, context);
      this.cache.set(cacheKey, {
        value,
        expiresAt: Date.now() + this.config.cacheTtl,
      });
      return value;
    } catch (err) {
      if (this.config.fallbackMode === "fail-open") {
        throw err;
      }
      return false;
    }
  }

  private async evaluate(flagKey: string, context: EvalContext): Promise<boolean> {
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
        return data.value;
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
