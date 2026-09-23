// Playwright for the Neon Drift Arena example.
//
// Runs against the production build through `vite preview`, never the dev server, so the
// artifact under test is the one that would ship. Build first:
//
//   pnpm --filter @wgf/example-neon-drift-arena build
//   pnpm --filter @wgf/example-neon-drift-arena exec playwright test
//
// A fixed port with server reuse would let one worktree's tests hit another's build, so the
// port is configurable and an existing server is never reused.

import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env["NEON_DEMO_PORT"] ?? 4175);

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  // Generous: headless Chromium renders WebGL in software, so a run is slower than on a phone.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: process.env["CI"] ? [["github"], ["list"]] : [["list"]],
  outputDir: "../../test-results/neon-drift-arena",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 } },
    },
    { name: "mobile", use: { ...devices["Pixel 5"] } },
  ],
  webServer: {
    command: `vite preview --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
