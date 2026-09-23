// End-to-end suite for the GameVui demo, against the production build (`vite preview`),
// never the dev server — the package a portal would receive is what gets tested.
//
// Chromium only, on every project: it is what CI installs. The tablet and phone projects
// take the device's viewport, pixel ratio and touch from Playwright's descriptors and swap
// the engine to Chromium, which is a viewport/input check, not a Safari check.
//
// The JSON report is what scripts/check-compliance.mjs reads. Tests carry `[probe:<name>]`
// in their titles; a probe passes only if every test carrying it passed in every project
// that ran it.

import { defineConfig, devices } from "@playwright/test";

// Not 4173/4174: other worktrees on this machine run the template's and other demos'
// preview servers there. A reused server would test someone else's build, so a server that
// is already listening is never reused — the run fails on the port instead. GV_DEMO_PORT
// moves it, for two runs side by side.
const PORT = Number(process.env["GV_DEMO_PORT"] ?? 4188);

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: 0,
  // The canvas renders through software WebGL in headless Chromium, which is CPU-bound. Too
  // many at once and frame pacing, not the game, decides whether a test passes.
  workers: 2,
  timeout: 60_000,
  reporter: [["list"], ["json", { outputFile: "../../build/gamevui-demo/e2e-results.json" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    locale: "vi-VN",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 5"] } },
    { name: "mobile-landscape", use: { ...devices["Pixel 5 landscape"] } },
    { name: "tablet", use: { ...devices["iPad (gen 7)"], browserName: "chromium" } },
  ],
  webServer: {
    command: `pnpm preview --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
