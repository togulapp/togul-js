"use client";

import { useState, useEffect, useCallback } from "react";
import { useTogulClient } from "../provider/TogulProvider";
import type { UseFeatureFlagsOptions, UseFeatureFlagsResult } from "../types";

export function useFeatureFlags(
  flagKeys: string[],
  options: UseFeatureFlagsOptions = {}
): UseFeatureFlagsResult {
  const client = useTogulClient();
  const { fallback = false, context = {}, disabled = false } = options;

  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(!disabled);
  const [error, setError] = useState<Error | null>(null);

  const fetchFlags = useCallback(async () => {
    if (disabled) return;

    setIsLoading(true);
    setError(null);

    try {
      const results = await Promise.all(
        flagKeys.map(async (key) => {
          const value = await client.isEnabled(key, context);
          return [key, value] as const;
        })
      );

      setFlags(Object.fromEntries(results));
    } catch (err) {
      setError(err as Error);
      setFlags(Object.fromEntries(flagKeys.map((key) => [key, fallback])));
    } finally {
      setIsLoading(false);
    }
  }, [client, flagKeys.join(","), JSON.stringify(context), disabled, fallback]);

  useEffect(() => {
    fetchFlags();

    const unsubscribe = client.onCacheInvalidated(() => {
      fetchFlags();
    });

    return unsubscribe;
  }, [fetchFlags, client]);

  return { flags, isLoading, error, refetch: fetchFlags };
}
