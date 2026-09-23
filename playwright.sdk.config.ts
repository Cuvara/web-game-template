// SDK browser smoke: the template game, built once per engine × platform by
// scripts/verify/sdk-smoke-build.mjs, booted in a real browser with each portal's SDK script
// replaced by a local mock. Proves the adapters work inside the actual PixiJS and Three.js
// builds, not only against fakes in node. Makes no request to any portal.
//
//   pnpm test:sdk:browser     (builds first)

import { defineConfig, devices } from "@playwright/test";

const PORT = 4176;

export default defineConfig({
  testDir: "tests/sdk-browser",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? [["github"]] : [["list"]],
  outputDir: "test-results/sdk-browser",
  use: { baseURL: `http://localhost:${PORT}`, trace: "on-first-retry" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `pnpm exec vite preview --outDir build/sdk-smoke --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
  },
});
