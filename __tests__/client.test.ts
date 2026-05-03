import { describe, it, expect, vi, beforeEach } from "vitest";
import { TogulClient } from "../src/client";
import { TogulApiError, TogulConfigError } from "../src/errors";
import type { TogulConfig } from "../src/types";

const BASE_URL = "http://localhost:8080";
const API_KEY = "test-key";
const ENV = "test";

function createClient(overrides: Partial<TogulConfig> = {}) {
  return new TogulClient({
    apiKey: API_KEY,
    environment: ENV,
    baseUrl: BASE_URL,
    ...overrides,
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function boolResponse(enabled: boolean, flagKey = "test") {
  return jsonResponse({
    flag_key: flagKey,
    enabled,
    value_type: "boolean",
    value: enabled,
    reason: "rule_match",
  });
}

describe("TogulClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should throw TogulConfigError when required fields are missing", () => {
    expect(() => new TogulClient({ apiKey: "", environment: "e" })).toThrow(TogulConfigError);
    expect(() => new TogulClient({ apiKey: "k", environment: "" })).toThrow(TogulConfigError);
  });

  it("should return flag value on successful evaluation", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      jsonResponse({ flag_key: "test", enabled: true, value_type: "boolean", value: true, reason: "rule_match" })
    );

    const client = createClient();
    const result = await client.isEnabled("test", { user_id: "u1" });

    expect(result).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/v1/evaluate`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-API-Key": API_KEY,
        }),
      })
    );
  });

  it("should cache flag values", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(() =>
      Promise.resolve(jsonResponse({ value: true }))
    );

    const client = createClient();
    await client.isEnabled("test", { user_id: "u1" });
    await client.isEnabled("test", { user_id: "u1" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("should use different cache keys for different contexts", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(() =>
      Promise.resolve(jsonResponse({ value: true }))
    );

    const client = createClient({ retryCount: 1 });
    await client.isEnabled("test", { user_id: "u1" });
    await client.isEnabled("test", { user_id: "u2" });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("should return false on error with fail-closed mode", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("Network error"));

    const client = createClient({ fallbackMode: "fail-closed", retryCount: 1 });
    const result = await client.isEnabled("test");

    expect(result).toBe(false);
  });

  it("should throw on error with fail-open mode", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("Network error"));

    const client = createClient({ fallbackMode: "fail-open", retryCount: 1 });

    await expect(client.isEnabled("test")).rejects.toThrow();
  });

  it("should retry on 429 responses", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(boolResponse(true));

    const client = createClient({ retryCount: 2 });
    const result = await client.isEnabled("test");

    expect(result).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("should retry on 5xx responses", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(boolResponse(false));

    const client = createClient({ retryCount: 2 });
    const result = await client.isEnabled("test");

    expect(result).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("should not retry on 403 responses", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(() =>
      Promise.resolve(jsonResponse({ code: "forbidden", message: "Access denied" }, 403))
    );

    const client = createClient({ retryCount: 3, fallbackMode: "fail-open" });

    await expect(client.isEnabled("test")).rejects.toThrow(TogulApiError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("should invalidate all cache entries", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(() =>
      Promise.resolve(jsonResponse({ value: true }))
    );

    const client = createClient({ retryCount: 1 });
    await client.isEnabled("test", { user_id: "u1" });
    client.invalidateCache();
    await client.isEnabled("test", { user_id: "u1" });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("should invalidate specific flag cache entries", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(() =>
      Promise.resolve(jsonResponse({ value: true }))
    );

    const client = createClient({ retryCount: 1 });
    await client.isEnabled("flag-a", { user_id: "u1" });
    await client.isEnabled("flag-b", { user_id: "u1" });

    client.invalidateFlag("flag-a");
    await client.isEnabled("flag-a", { user_id: "u1" });
    await client.isEnabled("flag-b", { user_id: "u1" });

    // flag-a fetched twice, flag-b once (cached after invalidateFlag("flag-a"))
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
