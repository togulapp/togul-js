import { describe, it, expect, vi, beforeEach } from "vitest";
import { TogulClient } from "../src/client";
import { TogulApiError, TogulConfigError } from "../src/errors";
import type { TogulConfig } from "../src/types";

const BASE_URL = "http://localhost:8080";
const API_KEY = "test-key";
const ENV = "test";

function createClient(overrides: Partial<TogulConfig> = {}) {
  return new TogulClient({ apiKey: API_KEY, environment: ENV, baseUrl: BASE_URL, ...overrides });
}

function mockResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function evalBody(overrides: Record<string, unknown> = {}) {
  return {
    flag_key: "test-flag",
    enabled: true,
    value_type: "boolean",
    value: true,
    reason: "rule_match",
    ...overrides,
  };
}

describe("TogulClient", () => {
  beforeEach(() => vi.restoreAllMocks());

  // ── Constructor ──────────────────────────────────────────────────────────
  describe("constructor", () => {
    it("throws TogulConfigError when apiKey is empty", () => {
      expect(() => new TogulClient({ apiKey: "", environment: "e" })).toThrow(TogulConfigError);
    });

    it("throws TogulConfigError when environment is empty", () => {
      expect(() => new TogulClient({ apiKey: "k", environment: "" })).toThrow(TogulConfigError);
    });
  });

  // ── evaluate ─────────────────────────────────────────────────────────────
  describe("evaluate", () => {
    it("returns full result for boolean flag", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        mockResponse(evalBody({ value_type: "boolean", value: true }))
      );
      const result = await createClient().evaluate("test-flag", { user_id: "u1" });
      expect(result.flagKey).toBe("test-flag");
      expect(result.enabled).toBe(true);
      expect(result.valueType).toBe("boolean");
      expect(result.value).toBe(true);
      expect(result.reason).toBe("rule_match");
    });

    it("returns full result for string flag", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        mockResponse(evalBody({ value_type: "string", value: "dark_mode" }))
      );
      const result = await createClient().evaluate("ui-theme");
      expect(result.valueType).toBe("string");
      expect(result.value).toBe("dark_mode");
    });

    it("returns full result for number flag", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        mockResponse(evalBody({ value_type: "number", value: 55 }))
      );
      const result = await createClient().evaluate("threshold");
      expect(result.valueType).toBe("number");
      expect(result.value).toBe(55);
    });

    it("returns full result for json flag", async () => {
      const jsonVal = { plan: "pro", limit: 100 };
      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        mockResponse(evalBody({ value_type: "json", value: jsonVal }))
      );
      const result = await createClient().evaluate("config");
      expect(result.valueType).toBe("json");
      expect(result.value).toEqual(jsonVal);
    });

    it("returns value even when flag is disabled", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        mockResponse(evalBody({ enabled: false, value: "onur", reason: "disabled" }))
      );
      const result = await createClient().evaluate("test-flag");
      expect(result.enabled).toBe(false);
      expect(result.value).toBe("onur");
      expect(result.reason).toBe("disabled");
    });

    it("sends correct method, url, headers and body", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(
        mockResponse(evalBody())
      );
      const ctx = { user_id: "u1", plan: "pro" };
      await createClient().evaluate("my-flag", ctx);

      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/api/v1/evaluate`);
      expect(init?.method).toBe("POST");
      const headers = init?.headers as Record<string, string>;
      expect(headers["X-API-Key"]).toBe(API_KEY);
      expect(headers["Content-Type"]).toBe("application/json");
      const body = JSON.parse(init?.body as string);
      expect(body.flag_key).toBe("my-flag");
      expect(body.environment_key).toBe(ENV);
      expect(body.context).toEqual(ctx);
    });

    it("does not send Authorization header", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(
        mockResponse(evalBody())
      );
      await createClient().evaluate("flag");
      const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers["Authorization"]).toBeUndefined();
    });

    it("throws TogulApiError on non-ok response", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        mockResponse({ code: "evaluate.flag_not_found", message: "Flag not found" }, 404)
      );
      await expect(createClient().evaluate("missing")).rejects.toThrow(TogulApiError);
    });

    it("parses API error code, status and message", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        mockResponse({ code: "billing.evaluation_blocked", message: "Subscription does not allow evaluations" }, 403)
      );
      const err = await createClient().evaluate("flag").catch((e) => e) as TogulApiError;
      expect(err).toBeInstanceOf(TogulApiError);
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe("billing.evaluation_blocked");
    });
  });

  // ── Cache ─────────────────────────────────────────────────────────────────
  describe("cache", () => {
    it("returns cached result on second call", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(() =>
        Promise.resolve(mockResponse(evalBody()))
      );
      const client = createClient();
      await client.evaluate("flag", { user_id: "u1" });
      await client.evaluate("flag", { user_id: "u1" });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("uses separate cache entries for different contexts", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(() =>
        Promise.resolve(mockResponse(evalBody()))
      );
      const client = createClient();
      await client.evaluate("flag", { user_id: "u1" });
      await client.evaluate("flag", { user_id: "u2" });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("uses separate cache entries for different flags", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(() =>
        Promise.resolve(mockResponse(evalBody()))
      );
      const client = createClient();
      await client.evaluate("flag-a");
      await client.evaluate("flag-b");
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("invalidateCache clears all entries", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(() =>
        Promise.resolve(mockResponse(evalBody()))
      );
      const client = createClient();
      await client.evaluate("flag");
      client.invalidateCache();
      await client.evaluate("flag");
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("invalidateFlag only clears the target flag", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(() =>
        Promise.resolve(mockResponse(evalBody()))
      );
      const client = createClient();
      await client.evaluate("flag-a");
      await client.evaluate("flag-b");
      client.invalidateFlag("flag-a");
      await client.evaluate("flag-a"); // cache miss — refetched
      await client.evaluate("flag-b"); // cache hit — not refetched
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it("notifies registered listeners on cache invalidation", () => {
      const client = createClient();
      const listener = vi.fn();
      client.onCacheInvalidated(listener);
      client.invalidateCache();
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("unsubscribing removes the listener", () => {
      const client = createClient();
      const listener = vi.fn();
      const unsub = client.onCacheInvalidated(listener);
      unsub();
      client.invalidateCache();
      expect(listener).not.toHaveBeenCalled();
    });
  });

  // ── Retry ─────────────────────────────────────────────────────────────────
  describe("retry", () => {
    it("retries on 429 and succeeds on second attempt", async () => {
      const fetchSpy = vi.spyOn(global, "fetch")
        .mockResolvedValueOnce(mockResponse({}, 429))
        .mockResolvedValueOnce(mockResponse(evalBody()));
      const result = await createClient({ retryCount: 2 }).evaluate("flag");
      expect(result.enabled).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("retries on 500 and succeeds on second attempt", async () => {
      const fetchSpy = vi.spyOn(global, "fetch")
        .mockResolvedValueOnce(mockResponse({}, 500))
        .mockResolvedValueOnce(mockResponse(evalBody({ enabled: false })));
      const result = await createClient({ retryCount: 2 }).evaluate("flag");
      expect(result.enabled).toBe(false);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("does not retry on 4xx client errors", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
        mockResponse({ code: "forbidden", message: "Access denied" }, 403)
      );
      await expect(createClient({ retryCount: 3 }).evaluate("flag")).rejects.toThrow(TogulApiError);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("throws after all retries are exhausted", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue(mockResponse({}, 500));
      await expect(createClient({ retryCount: 2 }).evaluate("flag")).rejects.toThrow();
    });
  });
});
