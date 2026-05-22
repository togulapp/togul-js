import { TogulClient } from "../client";
import type { TogulConfig, EvalContext } from "../types";

const clientCache = new Map<string, TogulClient>();

function getClient(config: TogulConfig): TogulClient {
  const key = `${config.apiKey}:${config.environment}:${String(config.baseUrl ?? "")}`;
  let client = clientCache.get(key);
  if (!client) {
    client = new TogulClient(config);
    clientCache.set(key, client);
  }
  return client;
}

export async function evaluateFlag(
  config: TogulConfig,
  flagKey: string,
  context: EvalContext = {}
): Promise<boolean> {
  const client = getClient(config);
  const result = await client.evaluate(flagKey, context);
  return result.enabled;
}

export async function evaluateFlags(
  config: TogulConfig,
  flagKeys: string[],
  context: EvalContext = {}
): Promise<Record<string, boolean>> {
  const client = getClient(config);
  const results = await Promise.all(
    flagKeys.map(async (key) => {
      const result = await client.evaluate(key, context);
      return [key, result.enabled] as const;
    })
  );
  return Object.fromEntries(results);
}

export { TogulClient } from "../client";
export type { TogulConfig, EvalContext } from "../types";
