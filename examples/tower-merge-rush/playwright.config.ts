// Playwright for the Tower Merge Rush example.
//
// Runs against the production build through `vite preview`, never the dev server — the bundle
// that would ship is the thing under test. The config builds and previews the example on its
// own (via its package's own build/preview scripts) so it needs no root-level wiring:
//
//   pnpm --filter @wgf/example-tower-merge-rush build
//   pnpm exec playwright test -c examples/tower-merge-rush/playwright.config.ts
//
// Desktop (mouse + keyboard) and a phone (touch), both in Chromium — the browser CI installs.

import { defineConfig, devices } from "@playwright/test";

// A configurable port with no server reuse, so parallel worktrees never test each other's build.
const PORT = Number(process.env["TOWER_MERGE_PORT"] ?? 4175);

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  // Generous: headless Chromium renders WebGL in software, which is slow on a loaded machine.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: process.env["CI"] ? [["github"], ["list"]] : [["list"]],
  outputDir: "../../test-results/tower-merge-rush",
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
    // Build the example, then preview it on the fixed port. `--dir ../..` runs pnpm from the
    // workspace root so the package filter resolves; strictPort in vite.config keeps preview
    // on the port the tests expect.
    command:
      `pnpm --dir ../.. --filter @wgf/example-tower-merge-rush build && ` +
      `pnpm --dir ../.. --filter @wgf/example-tower-merge-rush preview -- --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
