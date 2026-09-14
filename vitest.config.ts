import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pinned deliberately. This SDK targets Node, edge runtimes and browsers,
    // but its tests are plain Node: `fetch` is stubbed, and the edge-runtime
    // suite builds its own sandbox with `@edge-runtime/vm` rather than relying
    // on the ambient test environment. Leaving this unset made the runner
    // resolve to `jsdom` and fail at startup once a stale dependency tree was
    // pruned — an environment the tests never needed and no config asked for.
    environment: "node",
  },
});
