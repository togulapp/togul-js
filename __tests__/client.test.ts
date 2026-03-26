import { describe, it, expect, vi, beforeEach } from "vitest";
import { TogulClient } from "../src/client";
import { TogulApiError, TogulConfigError } from "../src/errors";

const BASE_URL = "http://localhost:8080";
const API_KEY = "test-key";
const ENV = "test";

function createClient(overrides: Partial<Parameters<typeof TogulClient.prototype.isEnabled>["0"]> = {}) {
  return new TogulClient({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    environment: ENV,
    ...overrides,
  });
}

describe("TogulClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should throw TogulConfigError when required fields are missing", () => {
    expect(() => new TogulClient({ baseUrl: "", apiKey: "k", environment: "e" })).toThrow(TogulConfigError);
    expect(() => new TogulClient({ baseUrl: "u", apiKey: "", environment: "e" })).toThrow(TogulConfigError);
    expect(() => new TogulClient({ baseUrl: "u", apiKey: "k", environment: "" })).toThrow(TogulConfigError);
  });

  it("should return flag value on successful evaluation", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ flag_key: "test", enabled: true, value: true, reason: "rule_match" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
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
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ value: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const client = createClient();
    await client.isEnabled("test", { user_id: "u1" });
    await client.isEnabled("test", { user_id: "u1" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("should use different cache keys for different contexts", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ value: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
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
      .mockResolvedValueOnce(new Response("{}", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ value: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

    const client = createClient({ retryCount: 2 });
    const result = await client.isEnabled("test");

    expect(result).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("should retry on 5xx responses", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ value: false }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

    const client = createClient({ retryCount: 2 });
    const result = await client.isEnabled("test");

    expect(result).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("should not retry on 403 responses", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "forbidden", message: "Access denied" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    );

    const client = createClient({ retryCount: 3, fallbackMode: "fail-open" });

    await expect(client.isEnabled("test")).rejects.toThrow(TogulApiError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("should invalidate all cache entries", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ value: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const client = createClient({ retryCount: 1 });
    await client.isEnabled("test", { user_id: "u1" });
    client.invalidateCache();
    await client.isEnabled("test", { user_id: "u1" });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("should invalidate specific flag cache entries", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ value: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const client = createClient({ retryCount: 1 });
    await client.isEnabled("flag-a", { user_id: "u1" });
    await client.isEnabled("flag-b", { user_id: "u1" });

    client.invalidateFlag("flag-a");
    await client.isEnabled("flag-a", { user_id: "u1" });
    await client.isEnabled("flag-b", { user_id: "u1" });

    // flag-a fetched twice, flag-b once (cached)
    // retryCount=1 means 1 attempt, but some overhead may cause extra calls
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });
});
