import {
  ErrorCode,
  OpenFeatureEventEmitter,
  ProviderEvents,
  StandardResolutionReasons,
} from "@openfeature/server-sdk";
import type {
  EvaluationContext,
  EvaluationContextValue,
  JsonValue,
  Provider,
  ResolutionDetails,
} from "@openfeature/server-sdk";
import type { TogulClient } from "../client";
import { TogulApiError } from "../errors";
import type { EvalContext, EvaluateResult } from "../types";

export interface TogulProviderOptions {
  /**
   * Context attribute the OpenFeature targeting key is sent as.
   * Default "user_id", matching the default rule "bucket_by".
   */
  targetingKeyAttribute?: string;
}

/**
 * OpenFeature server provider backed by TogulClient.
 *
 * Requires the optional "@openfeature/server-sdk" package. Caching, retries and
 * SSE invalidation all stay in TogulClient; this class only adapts the single
 * evaluate() call to OpenFeature's typed resolvers and never throws. Cache
 * invalidations are re-emitted as PROVIDER_CONFIGURATION_CHANGED.
 */
export class TogulProvider implements Provider {
  readonly metadata = { name: "Togul" } as const;
  readonly runsOn = "server" as const;
  readonly events = new OpenFeatureEventEmitter();

  private readonly targetingKeyAttribute: string;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly client: TogulClient,
    options: TogulProviderOptions = {},
  ) {
    this.targetingKeyAttribute = options.targetingKeyAttribute ?? "user_id";
    this.unsubscribe = client.onCacheInvalidated(() => {
      this.events.emit(ProviderEvents.ConfigurationChanged);
    });
  }

  getClient(): TogulClient {
    return this.client;
  }

  async onClose(): Promise<void> {
    this.unsubscribe();
  }

  resolveBooleanEvaluation(flagKey: string, defaultValue: boolean, context: EvaluationContext): Promise<ResolutionDetails<boolean>> {
    return this.resolve(flagKey, defaultValue, context, "boolean", (v) => typeof v === "boolean");
  }

  resolveStringEvaluation(flagKey: string, defaultValue: string, context: EvaluationContext): Promise<ResolutionDetails<string>> {
    return this.resolve(flagKey, defaultValue, context, "string", (v) => typeof v === "string");
  }

  resolveNumberEvaluation(flagKey: string, defaultValue: number, context: EvaluationContext): Promise<ResolutionDetails<number>> {
    return this.resolve(flagKey, defaultValue, context, "number", (v) => typeof v === "number" && Number.isFinite(v));
  }

  resolveObjectEvaluation<T extends JsonValue>(flagKey: string, defaultValue: T, context: EvaluationContext): Promise<ResolutionDetails<T>> {
    return this.resolve(flagKey, defaultValue, context, "object", (v) => typeof v === "object" && v !== null);
  }

  private async resolve<T>(
    flagKey: string,
    defaultValue: T,
    context: EvaluationContext,
    expectedType: string,
    matches: (value: unknown) => boolean,
  ): Promise<ResolutionDetails<T>> {
    let result: EvaluateResult;
    try {
      result = await this.client.evaluate(flagKey, this.toTogulContext(context));
    } catch (err) {
      const notFound = err instanceof TogulApiError && err.statusCode === 404 && err.code === "evaluate.flag_not_found";
      return this.error(defaultValue, notFound ? ErrorCode.FLAG_NOT_FOUND : ErrorCode.GENERAL, err);
    }

    // OpenFeature spec: a disabled flag resolves to the caller's default.
    if (!result.enabled) {
      return { value: defaultValue, reason: StandardResolutionReasons.DISABLED };
    }

    // A json flag created without a default stores null: nothing to serve.
    if (result.value === null || result.value === undefined) {
      return { value: defaultValue, reason: this.mapReason(result) };
    }

    if (!matches(result.value)) {
      return this.error(
        defaultValue,
        ErrorCode.TYPE_MISMATCH,
        `Flag "${flagKey}" has value_type "${result.valueType}", requested ${expectedType}`,
      );
    }

    return { value: result.value as T, reason: this.mapReason(result) };
  }

  private mapReason(result: EvaluateResult): string {
    switch (result.reason) {
      case "rule_match":
        return StandardResolutionReasons.TARGETING_MATCH;
      case "default":
        return StandardResolutionReasons.DEFAULT;
      case "disabled":
        return StandardResolutionReasons.DISABLED;
      default:
        return StandardResolutionReasons.UNKNOWN;
    }
  }

  /**
   * Togul evaluates against a flat map of strings, and TogulClient builds its
   * cache key by concatenating those values.
   */
  private toTogulContext(context: EvaluationContext): EvalContext {
    const out: EvalContext = {};
    for (const [key, value] of Object.entries(context)) {
      if (key === "targetingKey") continue;
      const stringValue = this.stringifyAttribute(value);
      if (stringValue !== null) out[key] = stringValue;
    }

    // An explicitly set attribute wins over the targeting key.
    const targetingKey = context.targetingKey;
    if (targetingKey && out[this.targetingKeyAttribute] === undefined) {
      out[this.targetingKeyAttribute] = targetingKey;
    }
    return out;
  }

  /**
   * Rules compare with plain string equality ("eq", "in", ...), so every
   * format must match what users type in the dashboard. Null drops the attribute.
   */
  private stringifyAttribute(value: EvaluationContextValue | undefined): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === "string") return value;
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
    if (value instanceof Date) return value.toISOString();
    return JSON.stringify(value);
  }

  private error<T>(defaultValue: T, errorCode: ErrorCode, cause: unknown): ResolutionDetails<T> {
    const errorMessage = cause instanceof Error ? cause.message : String(cause);
    return { value: defaultValue, reason: StandardResolutionReasons.ERROR, errorCode, errorMessage };
  }
}
