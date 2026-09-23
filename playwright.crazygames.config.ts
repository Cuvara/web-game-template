// Playwright configuration for the CrazyGames compliance demo.
//
// Separate from playwright.config.ts because it serves a different artifact — the demo's
// own build on its own port — and a game built from this template has no reason to start
// that server.
//
// Three device classes, matching the ones CrazyGames distinguishes in systemInfo:
//   desktop — mouse and keyboard, and the one project that iterates every official iframe
//             size in layout.spec.ts.
//   mobile  — 800x450 landscape with touch, the mobile size the requirements list.
//   tablet  — 1080x607 with touch, the tablet size the requirements list.
//
// Every project runs the built bundle; `pnpm build:crazygames-demo` first.

import { defineConfig, devices } from "@playwright/test";

// Overridable, because another checkout may already hold the default port.
const PORT = Number(process.env["CG_DEMO_PORT"] ?? 4174);

export default defineConfig({
  testDir: "tests/crazygames",
  // Its own output directory: each Playwright run clears its outputDir on start, and a shared
  // test-results/ lets one run delete another's traces mid-flight.
  outputDir: process.env["PW_OUTPUT_DIR"] ?? "test-results/crazygames",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  timeout: 60_000,
  reporter: process.env["CI"]
    ? [["github"], ["html", { open: "never", outputFolder: "playwright-report/crazygames" }]]
    : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    deviceScaleFactor: 1,
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: "mobile",
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 800, height: 450 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "tablet",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1080, height: 607 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: `pnpm --filter @wgf/example-crazygames-compliance-demo preview --port ${PORT}`,
    port: PORT,
    // Never reuse a server that happens to be on the port: it may be another checkout's
    // build, and the suite would then pass or fail on code that is not this code. With
    // strictPort in the demo's preview config, a busy port fails loudly instead.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
