// Playwright configuration.
//
// Everything here runs against the built bundle from a preview server, never against the
// dev server. Verification asserts things about the artifact that ships, and a dev-server
// run proves nothing about the bundle a portal would receive.
//
// Three projects, two purposes:
//   desktop, mobile — the smoke suite. Mobile is not decoration: several profiles are
//                     majority mobile and CrazyGames lists missing mobile support as a
//                     rejection cause.
//   verify          — measures package facts for release validation. Separate because it
//                     is slower, samples frame rate over seconds, and writes a file.

import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  reporter: process.env["CI"] ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop", testDir: "tests/e2e", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", testDir: "tests/e2e", use: { ...devices["Pixel 5"] } },
    {
      name: "verify",
      testDir: "tests/verify",
      // Measurement must not be retried: a retry would overwrite the facts file with a run
      // that had a warm cache, which is a different measurement.
      retries: 0,
      fullyParallel: false,
      workers: 1,
      timeout: 90_000,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `pnpm preview --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
  },
});
