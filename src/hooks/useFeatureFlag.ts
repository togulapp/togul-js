"use client";

import { useState, useEffect, useCallback } from "react";
import { useTogulClient } from "../provider/TogulProvider";
import type { UseFeatureFlagOptions, UseFeatureFlagResult } from "../types";

export function useFeatureFlag(
  flagKey: string,
  options: UseFeatureFlagOptions = {}
): UseFeatureFlagResult {
  const client = useTogulClient();
  const { fallback = false, context = {}, disabled = false } = options;

  const [enabled, setEnabled] = useState<boolean>(fallback);
  const [isLoading, setIsLoading] = useState(!disabled);
  const [error, setError] = useState<Error | null>(null);

  const fetchFlag = useCallback(async () => {
    if (disabled) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await client.evaluate(flagKey, context);
      setEnabled(result.enabled);
    } catch (err) {
      setError(err as Error);
      setEnabled(fallback);
    } finally {
      setIsLoading(false);
    }
  }, [client, flagKey, JSON.stringify(context), disabled, fallback]);

  useEffect(() => {
    fetchFlag();

    const unsubscribe = client.onCacheInvalidated(() => {
      fetchFlag();
    });

    return unsubscribe;
  }, [fetchFlag, client]);

  return { enabled, isLoading, error, refetch: fetchFlag };
}
