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
    public readonly value: unknown,
    public readonly reason: string,
  ) {}
}

export interface CacheEntry {
  result: EvaluateResult;
  expiresAt: number;
}

