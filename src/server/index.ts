import { TogulClient } from "../client";
import type { TogulConfig, EvalContext } from "../types";

export async function evaluateFlag(
  config: TogulConfig,
  flagKey: string,
  context: EvalContext = {}
): Promise<boolean> {
  const client = new TogulClient(config);
  return client.isEnabled(flagKey, context);
}

export async function evaluateFlags(
  config: TogulConfig,
  flagKeys: string[],
  context: EvalContext = {}
): Promise<Record<string, boolean>> {
  const client = new TogulClient(config);
  const results = await Promise.all(
    flagKeys.map(async (key) => {
      const value = await client.isEnabled(key, context);
      return [key, value] as const;
    })
  );
  return Object.fromEntries(results);
}

export { TogulClient } from "../client";
export type { TogulConfig, EvalContext } from "../types";
