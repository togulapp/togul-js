export type FallbackMode = "fail-open" | "fail-closed";

const DEFAULT_BASE_URL = "https://api.togul.io";

export interface TogulConfig {
  /** Environment API key */
  apiKey: string;
  /** Environment identifier (e.g. "production", "staging") */
  environment: string;
  /** HTTP request timeout in ms (default: 5000) */
  timeout?: number;
  /** Cache TTL in ms (default: 30000) */
  cacheTtl?: number;
  /** Fallback behavior on error (default: "fail-closed") */
  fallbackMode?: FallbackMode;
  /** Max retry count for 429/5xx (default: 2) */
  retryCount?: number;
  /** Override default base URL (optional, for testing) */
  baseUrl?: string;
}

export function getBaseUrl(config: TogulConfig): string {
  return config.baseUrl?.replace(/\/+$/, "") ?? DEFAULT_BASE_URL;
}

export type EvalContext = Record<string, string>;

export type ValueType = "boolean" | "string" | "number" | "json";

export interface EvaluateRequest {
  flag_key: string;
  environment_key: string;
  context: EvalContext;
}

export interface EvaluateResponse {
  flag_key: string;
  enabled: boolean;
  value_type: ValueType;
  value: unknown;
  reason: string;
}

export interface ApiErrorResponse {
  code: string;
  message: string;
}

export class EvaluateResult {
  constructor(
    public readonly flagKey: string,
    public readonly enabled: boolean,
    public readonly valueType: ValueType | "",
    private readonly rawValue: unknown,
    public readonly reason: string,
  ) {}

  /** Returns the flag value as boolean, or fallback if disabled or type mismatch. */
  boolValue(fallback = false): boolean {
    if (!this.enabled || this.valueType !== "boolean") return fallback;
    return typeof this.rawValue === "boolean" ? this.rawValue : fallback;
  }

  /** Returns the flag value as string, or fallback if disabled or type mismatch. */
  stringValue(fallback = ""): string {
    if (!this.enabled || this.valueType !== "string") return fallback;
    return typeof this.rawValue === "string" ? this.rawValue : fallback;
  }

  /** Returns the flag value as number, or fallback if disabled or type mismatch. */
  numberValue(fallback = 0): number {
    if (!this.enabled || this.valueType !== "number") return fallback;
    return typeof this.rawValue === "number" ? this.rawValue : fallback;
  }

  /** Returns the flag value as T (JSON object/array), or fallback if disabled or type mismatch. */
  jsonValue<T = unknown>(fallback: T): T {
    if (!this.enabled || this.valueType !== "json") return fallback;
    return this.rawValue != null ? (this.rawValue as T) : fallback;
  }
}

export interface CacheEntry {
  result: EvaluateResult;
  expiresAt: number;
}

export interface UseFeatureFlagOptions {
  /** Override default fallback value when loading or on error */
  fallback?: boolean;
  /** User evaluation context */
  context?: EvalContext;
  /** Disable automatic fetching (default: false) */
  disabled?: boolean;
}

export interface UseFeatureFlagResult {
  /** Whether the flag is enabled */
  enabled: boolean;
  /** Whether the initial fetch is still loading */
  isLoading: boolean;
  /** Error if the evaluation failed */
  error: Error | null;
  /** Manually refetch the flag value */
  refetch: () => Promise<void>;
}

export interface UseFeatureFlagsOptions {
  /** Override default fallback value when loading or on error */
  fallback?: boolean;
  /** User evaluation context */
  context?: EvalContext;
  /** Disable automatic fetching (default: false) */
  disabled?: boolean;
}

export interface UseFeatureFlagsResult {
  /** Map of flag key to enabled state */
  flags: Record<string, boolean>;
  /** Whether the initial fetch is still loading */
  isLoading: boolean;
  /** Error if any evaluation failed */
  error: Error | null;
  /** Manually refetch all flag values */
  refetch: () => Promise<void>;
}
