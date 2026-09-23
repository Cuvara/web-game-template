// Playwright for the Yandex compliance demo.
//
// Runs against the production build through `vite preview`, never the dev server — the
// archive that would be uploaded is the thing under test. Build first:
//
//   pnpm demo:yandex:build && pnpm demo:yandex:e2e
//
// /sdk.js is served by the suite itself (tests/e2e/mock-sdk.js) through page.route(). The
// real SDK only exists on the portal; what the real portal does is checked in draft mode
// with the debug panel, which is a manual step in the compliance report.
//
// Three form factors, because Yandex tests every device type a draft declares (1.6):
// desktop with mouse and keyboard, a phone with touch, a tablet with touch in both
// orientations. All run in Chromium — it is the browser installed in CI, and WebKit
// emulation of an iPad in Chromium is a viewport-and-touch emulation, not Safari.

import { defineConfig, devices } from "@playwright/test";

// Several worktrees of this repository run their suites on one machine. A fixed port plus
// server reuse would let one worktree's tests run against another's build, so the port is
// configurable and an existing server is never reused.
const PORT = Number(process.env["YANDEX_DEMO_PORT"] ?? 4174);

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  // Generous on purpose. Headless Chromium renders WebGL in software; on a loaded machine
  // that is a few frames per second, and the game's simulation is clamped per frame, so a
  // run takes several times longer than it would on a phone. Timing-sensitive assertions
  // (sound off within 2 s) keep their own tight limits.
  timeout: 240_000,
  expect: { timeout: 20_000 },
  reporter: process.env["CI"] ? [["github"], ["list"]] : [["list"]],
  outputDir: "../../test-results/yandex-demo",
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
    {
      name: "tablet",
      use: {
        ...devices["iPad (gen 7)"],
        browserName: "chromium",
        defaultBrowserType: "chromium",
      },
    },
    {
      name: "tablet-landscape",
      use: {
        ...devices["iPad (gen 7) landscape"],
        browserName: "chromium",
        defaultBrowserType: "chromium",
      },
    },
  ],
  webServer: {
    command: `pnpm --dir ../.. demo:yandex:preview --port ${PORT}`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
