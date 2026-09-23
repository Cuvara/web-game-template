// Playwright configuration for the Poki compliance demo.
//
// Separate from playwright.config.ts because it runs a different artifact — the demo's own
// production build, from its own preview server — and because the Poki suite should not
// slow the template's smoke run. Like the smoke suite it never uses a dev server.
//
// Poki's SDK is never fetched from Poki's CDN here: every test routes the SDK URL to
// tests/poki/mock-poki-sdk.js (or aborts it, to play the part of an ad blocker).
//
// Three projects, because Poki requires all three: "Desktop, mobile, and tablet support."
// Only Chromium is installed in CI, so the tablet is an Android tablet profile; an iPad
// in Safari remains a manual check.

import { defineConfig, devices } from "@playwright/test";

// Not 4173/4174: other worktrees on the same machine preview their own builds there, and a
// suite that reuses a server it did not start tests someone else's game.
const PORT = Number(process.env["POKI_DEMO_PORT"] ?? 4391);

export default defineConfig({
  testDir: "tests/poki",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"]
    ? [["github"], ["html", { open: "never", outputFolder: "playwright-report/poki" }]]
    : [["list"]],
  outputDir: "test-results/poki",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 } },
    },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    { name: "tablet", use: { ...devices["Galaxy Tab S4"] } },
  ],
  webServer: {
    command: `pnpm --filter @wgf-examples/poki-compliance-demo preview --port ${PORT} --strictPort`,
    port: PORT,
    // Never reuse: a server already on the port is by definition not this build.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
