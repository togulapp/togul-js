export type FallbackMode = "fail-open" | "fail-closed";

export interface TogulConfig {
  /** Togul API base URL (e.g. https://api.togul.com) */
  baseUrl: string;
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
}

export type EvalContext = Record<string, string>;

export interface EvaluateRequest {
  flag_key: string;
  environment_key: string;
  context: EvalContext;
}

export interface EvaluateResponse {
  flag_key: string;
  enabled: boolean;
  value: boolean;
  reason: string;
}

export interface ApiErrorResponse {
  code: string;
  message: string;
}

export interface StreamEvent {
  type: string;
  flag_key?: string;
  environment_id?: string;
}

export interface CacheEntry {
  value: boolean;
  expiresAt: number;
}

export interface TogulClientOptions {
  /** Enable streaming for real-time cache invalidation (default: false) */
  stream?: boolean;
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
