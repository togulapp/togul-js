import { defineConfig } from "tsup";

// Two configs rather than one, because `format` is per-config and the edge
// entry must not emit CJS: edge runtimes load ESM only, and a CJS artifact
// there is dead weight that also invites the wrong `require` condition.
export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      "server/index": "src/server/index.ts",
    },
    format: ["cjs", "esm"],
    dts: true,
    splitting: true,
    sourcemap: true,
    clean: true,
    external: ["react", "next"],
  },
  {
    entry: {
      "edge/index": "src/edge/index.ts",
    },
    format: ["esm"],
    dts: true,
    splitting: true,
    sourcemap: true,
    // Must not clean: the first config has already written dist/ by now.
    clean: false,
    external: ["react", "next"],
  },
]);
