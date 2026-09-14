import { gzipSync } from "node:zlib";

import { EdgeVM } from "@edge-runtime/vm";
import { build } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";

import { TogulEdgeClient } from "../src/edge";

const API_KEY = "test-key";
const ENV = "test";
const BASE_URL = "https://api.test";

/**
 * Bundle the edge entry the way a bundler would for Cloudflare Workers or
 * Vercel Edge.
 *
 * `platform: "neutral"` is the load-bearing part: it tells esbuild to inject no
 * Node shims, so a Node built-in anywhere in the import graph fails the build
 * instead of quietly working. We bundle here rather than reading `dist/` so the
 * test does not depend on `npm run build` having run first — a test that skips
 * itself when an artifact is missing is a test that passes while proving
 * nothing.
 */
async function bundleForEdge(): Promise<string> {
  const result = await build({
    entryPoints: ["src/edge/index.ts"],
    bundle: true,
    format: "iife",
    globalName: "TogulEdge",
    platform: "neutral",
    target: "es2022",
    write: false,
  });
  return result.outputFiles[0].text;
}

/** An EdgeVM with a canned /api/v1/evaluate response and a call recorder. */
function createEdgeVM() {
  return new EdgeVM({
    extend: (context) => {
      (context as Record<string, unknown>).__calls = [];
      (context as Record<string, unknown>).fetch = async (url: unknown, init?: RequestInit) => {
        (context as { __calls: unknown[] }).__calls.push({
          url: String(url),
          apiKey: (init?.headers as Record<string, string> | undefined)?.["X-API-Key"],
        });
        return new (context as unknown as { Response: typeof Response }).Response(
          JSON.stringify({
            flag_key: "new-checkout",
            enabled: true,
            value_type: "boolean",
            value: true,
            reason: "rule_match",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      };
      return context;
    },
  });
}

describe("edge runtime compatibility", () => {
  let bundle: string;

  beforeAll(async () => {
    bundle = await bundleForEdge();
  }, 30_000);

  it("stays small enough to ship in an edge bundle", () => {
    // Edge platforms charge for bundle size and cold-start time, so this is a
    // budget, not trivia. Measured gzipped because that is what ships. The
    // entry is ~2.4 KB today; 10 KB is the documented ceiling, and the gap is
    // deliberate headroom rather than an invitation to fill it.
    const gzipped = gzipSync(Buffer.from(bundle, "utf8")).byteLength;
    expect(gzipped).toBeLessThan(10 * 1024);
  });

  it("bundles for a neutral platform without pulling in Node built-ins", () => {
    // esbuild would have thrown during beforeAll if it could not resolve a Node
    // built-in under platform: "neutral". Assert the output is also free of the
    // globals a Node-targeted bundle would carry.
    expect(bundle).not.toMatch(/\brequire\(/);
    expect(bundle).not.toMatch(/\bprocess\./);
    expect(bundle).not.toMatch(/\b__dirname\b/);
    expect(bundle).not.toMatch(/\bBuffer\b/);
  });

  it("runs in a sandbox that genuinely lacks Node globals", () => {
    const vm = createEdgeVM();
    // Without this, the rest of the suite would prove nothing: code with a Node
    // dependency passes fine under `node`.
    for (const nodeGlobal of ["process", "Buffer", "require", "__dirname", "global"]) {
      expect(vm.evaluate(`typeof globalThis.${nodeGlobal}`)).toBe("undefined");
    }
    // The Web APIs the client actually uses must all be present.
    for (const webGlobal of ["fetch", "AbortController", "TextDecoder", "ReadableStream"]) {
      expect(vm.evaluate(`typeof globalThis.${webGlobal}`)).not.toBe("undefined");
    }
  });

  it("evaluates a flag end to end inside the edge runtime", async () => {
    const vm = createEdgeVM();
    vm.evaluate(bundle);

    const result = await vm.evaluate(`
      (async () => {
        const c = new TogulEdge.TogulEdgeClient({
          apiKey: ${JSON.stringify(API_KEY)},
          environment: ${JSON.stringify(ENV)},
          baseUrl: ${JSON.stringify(BASE_URL)},
        });
        const r = await c.evaluate("new-checkout", { user_id: "u-1" });
        return {
          value: r.value,
          reason: r.reason,
          enabled: r.enabled,
          url: globalThis.__calls[0].url,
          apiKey: globalThis.__calls[0].apiKey,
        };
      })()
    `);

    expect(result.value).toBe(true);
    expect(result.reason).toBe("rule_match");
    expect(result.enabled).toBe(true);
    expect(result.url).toBe(`${BASE_URL}/api/v1/evaluate`);
    expect(result.apiKey).toBe(API_KEY);
  });

  it("serves the second evaluation from cache inside the edge runtime", async () => {
    const vm = createEdgeVM();
    vm.evaluate(bundle);

    const calls = await vm.evaluate(`
      (async () => {
        const c = new TogulEdge.TogulEdgeClient({
          apiKey: ${JSON.stringify(API_KEY)},
          environment: ${JSON.stringify(ENV)},
          baseUrl: ${JSON.stringify(BASE_URL)},
        });
        await c.evaluate("new-checkout", { user_id: "u-1" });
        await c.evaluate("new-checkout", { user_id: "u-1" });
        return globalThis.__calls.length;
      })()
    `);

    expect(calls).toBe(1);
  });
});

describe("TogulEdgeClient surface", () => {
  function createClient() {
    return new TogulEdgeClient({ apiKey: API_KEY, environment: ENV, baseUrl: BASE_URL });
  }

  it("exposes the edge-safe methods", () => {
    const client = createClient();
    expect(typeof client.evaluate).toBe("function");
    expect(typeof client.invalidateCache).toBe("function");
    expect(typeof client.invalidateFlag).toBe("function");
    expect(typeof client.onCacheInvalidated).toBe("function");
  });

  it("does not expose the stream API, which cannot work in a request-scoped isolate", () => {
    // An edge isolate is torn down once it has responded, so an SSE connection
    // dies with it. Offering these would let callers write code that silently
    // does nothing — the failure mode this facade exists to prevent.
    const client = createClient() as unknown as Record<string, unknown>;
    expect(client.startStream).toBeUndefined();
    expect(client.stopStream).toBeUndefined();
  });

  it("does not re-export TogulClient, which still carries the stream API", async () => {
    const edge = await import("../src/edge");
    expect(Object.keys(edge)).not.toContain("TogulClient");
  });
});
