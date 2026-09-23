// Unit tests only. The e2e suite (tests/e2e/*.spec.ts) is Playwright's, and vitest's default
// include pattern would otherwise pick it up.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.{ts,mjs}"],
    environment: "node",
  },
});
