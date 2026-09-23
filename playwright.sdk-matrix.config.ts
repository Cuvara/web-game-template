// Playwright configuration for the SDK matrix: PixiJS and Three.js games × every portal
// adapter, each over a mocked portal SDK (tests/sdk/portals.ts). No portal script is ever
// fetched and nothing is published.
//
// playwright.sdk.config.ts is the other browser suite: the template game itself, built per
// platform. This one covers every portal adapter, including CrazyGames and GameVui.
//
// Runs the harness's production build from a preview server, like the other suites.
// Desktop and mobile, because every portal here is majority- or half-mobile.

import { defineConfig, devices } from "@playwright/test";

// Not 4173 or 4391: other suites and other worktrees preview their own builds there.
const PORT = Number(process.env["SDK_MATRIX_PORT"] ?? 4417);

export default defineConfig({
  testDir: "tests/sdk-matrix",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"]
    ? [["github"], ["html", { open: "never", outputFolder: "playwright-report/sdk-matrix" }]]
    : [["list"]],
  outputDir: "test-results/sdk-matrix",
  use: { baseURL: `http://localhost:${PORT}`, trace: "on-first-retry" },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 } },
    },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command:
      "pnpm exec vite build --config tests/sdk-matrix/vite.config.ts && " +
      `pnpm exec vite preview --config tests/sdk-matrix/vite.config.ts --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
