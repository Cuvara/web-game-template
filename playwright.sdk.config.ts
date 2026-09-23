// Playwright configuration for the SDK matrix: examples/sdk-matrix built once per
// (engine, platform) by `pnpm sdk:matrix:build`, served from one preview server, each build
// played against its portal's mock SDK. No test reaches a portal: every portal script URL is
// routed to a local mock or aborted, and any other request leaving localhost fails the test.

import { defineConfig, devices } from "@playwright/test";

// Its own port: other suites and other worktrees preview their builds on 4173-4391.
const PORT = Number(process.env["SDK_MATRIX_PORT"] ?? 4395);

export default defineConfig({
  testDir: "tests/sdk-matrix",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"]
    ? [["github"], ["html", { open: "never", outputFolder: "playwright-report/sdk" }]]
    : [["list"]],
  outputDir: "test-results/sdk",
  use: { baseURL: `http://localhost:${PORT}`, trace: "on-first-retry" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 5"] } },
  ],
  webServer: {
    command: `pnpm exec vite preview --outDir examples/sdk-matrix/dist --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
