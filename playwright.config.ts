// Playwright configuration.
//
// E2E runs against the built bundle from a preview server, never against the dev server.
// The verification stage asserts things about the artifact that ships — a dev-server run
// proves nothing about the bundle a portal would receive.
//
// The mobile project is not optional decoration: several profiles are majority-mobile, and
// CrazyGames lists missing mobile support as a rejection cause.

import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  reporter: process.env["CI"] ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 5"] } },
  ],
  webServer: {
    command: `pnpm preview --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
  },
});
