import { describe, it, expect, vi, beforeEach } from "vitest";
import { ErrorCode, OpenFeature, ProviderEvents, StandardResolutionReasons } from "@openfeature/server-sdk";
import { TogulClient } from "../src/client";
import { TogulProvider } from "../src/openfeature";

const BASE_URL = "http://localhost:8080";

function createClient() {
  return new TogulClient({ apiKey: "test-key", environment: "test", baseUrl: BASE_URL });
}

function mockEvaluate(body: Record<string, unknown>, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
}

function evalBody(overrides: Record<string, unknown> = {}) {
  return { flag_key: "f", enabled: true, value_type: "boolean", value: true, reason: "rule_match", ...overrides };
}

function sentContext(fetchMock: ReturnType<typeof mockEvaluate>): Record<string, string> {
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  return JSON.parse(init.body as string).context;
}

describe("TogulProvider", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("resolves a boolean with the mapped reason", async () => {
    mockEvaluate(evalBody());
    const details = await new TogulProvider(createClient()).resolveBooleanEvaluation("f", false, {});
    expect(details).toEqual({ value: true, reason: StandardResolutionReasons.TARGETING_MATCH });
  });

  it.each([
    ["default", StandardResolutionReasons.DEFAULT],
    ["something_new", StandardResolutionReasons.UNKNOWN],
  ])("maps reason %s", async (reason, expected) => {
    mockEvaluate(evalBody({ reason }));
    const details = await new TogulProvider(createClient()).resolveBooleanEvaluation("f", false, {});
    expect(details.reason).toBe(expected);
  });

  // Distinct flag keys: TogulClient caches by flag key + context.
  it("resolves string, number and object values", async () => {
    const provider = new TogulProvider(createClient());

    mockEvaluate(evalBody({ flag_key: "s", value_type: "string", value: "dark" }));
    expect((await provider.resolveStringEvaluation("s", "light", {})).value).toBe("dark");

    vi.restoreAllMocks();
    mockEvaluate(evalBody({ flag_key: "n", value_type: "number", value: 42 }));
    expect((await provider.resolveNumberEvaluation("n", 0, {})).value).toBe(42);

    vi.restoreAllMocks();
    mockEvaluate(evalBody({ flag_key: "o", value_type: "json", value: { theme: "dark" } }));
    expect((await provider.resolveObjectEvaluation("o", {}, {})).value).toEqual({ theme: "dark" });
  });

  it("returns the caller's default for a disabled flag", async () => {
    mockEvaluate(evalBody({ enabled: false, value: true, reason: "disabled" }));
    const details = await new TogulProvider(createClient()).resolveBooleanEvaluation("f", false, {});
    expect(details).toEqual({ value: false, reason: StandardResolutionReasons.DISABLED });
  });

  it("returns the caller's default when the flag value is null", async () => {
    mockEvaluate(evalBody({ value_type: "json", value: null, reason: "default" }));
    const details = await new TogulProvider(createClient()).resolveObjectEvaluation("f", { a: 1 }, {});
    expect(details).toEqual({ value: { a: 1 }, reason: StandardResolutionReasons.DEFAULT });
  });

  it("reports TYPE_MISMATCH instead of serving a wrong type", async () => {
    mockEvaluate(evalBody({ value_type: "string", value: "dark" }));
    const details = await new TogulProvider(createClient()).resolveBooleanEvaluation("f", false, {});
    expect(details.value).toBe(false);
    expect(details.reason).toBe(StandardResolutionReasons.ERROR);
    expect(details.errorCode).toBe(ErrorCode.TYPE_MISMATCH);
  });

  it("maps a missing flag to FLAG_NOT_FOUND and other failures to GENERAL", async () => {
    const provider = new TogulProvider(createClient());

    mockEvaluate({ code: "evaluate.flag_not_found", message: "Flag not found" }, 404);
    expect((await provider.resolveBooleanEvaluation("missing", true, {})).errorCode).toBe(ErrorCode.FLAG_NOT_FOUND);

    vi.restoreAllMocks();
    mockEvaluate({ code: "unauthorized", message: "nope" }, 401);
    const details = await provider.resolveBooleanEvaluation("locked", true, {});
    expect(details).toMatchObject({ value: true, reason: StandardResolutionReasons.ERROR, errorCode: ErrorCode.GENERAL });
  });

  it("flattens the context and sends the targeting key as user_id", async () => {
    const fetchMock = mockEvaluate(evalBody());
    await new TogulProvider(createClient()).resolveBooleanEvaluation("f", false, {
      targetingKey: "u1",
      country: "TR",
      beta: true,
      age: 42,
      signup: new Date("2026-01-02T03:04:05.000Z"),
      tags: ["a", "b"],
      missing: null as unknown as string,
    });
    expect(sentContext(fetchMock)).toEqual({
      user_id: "u1",
      country: "TR",
      beta: "true",
      age: "42",
      signup: "2026-01-02T03:04:05.000Z",
      tags: '["a","b"]',
    });
  });

  it("keeps an explicit user_id and honours a custom targeting attribute", async () => {
    let fetchMock = mockEvaluate(evalBody());
    await new TogulProvider(createClient()).resolveBooleanEvaluation("f", false, { targetingKey: "tk", user_id: "explicit" });
    expect(sentContext(fetchMock).user_id).toBe("explicit");

    vi.restoreAllMocks();
    fetchMock = mockEvaluate(evalBody());
    await new TogulProvider(createClient(), { targetingKeyAttribute: "account_id" }).resolveBooleanEvaluation("f", false, { targetingKey: "acc-1" });
    expect(sentContext(fetchMock)).toEqual({ account_id: "acc-1" });
  });

  it("re-emits cache invalidations as configuration changes until closed", async () => {
    const client = createClient();
    const provider = new TogulProvider(client);
    const handler = vi.fn();
    provider.events.addHandler(ProviderEvents.ConfigurationChanged, handler);

    client.invalidateFlag("f");
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));

    await provider.onClose();
    client.invalidateCache();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("works end to end through the OpenFeature API", async () => {
    mockEvaluate(evalBody({ value_type: "string", value: "dark" }));
    await OpenFeature.setProviderAndWait(new TogulProvider(createClient()));
    const value = await OpenFeature.getClient().getStringValue("f", "light", { targetingKey: "u1" });
    expect(value).toBe("dark");
    await OpenFeature.close();
  });
});
