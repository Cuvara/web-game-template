// Playwright config for LIVE portal validation — real SDKs, no mocks.
//
// This is deliberately NOT part of the default test run. It reaches out to real portal CDNs
// and is gated behind WGF_LIVE=1 (enforced by scripts/verify/live-portal.mjs, the intended
// entry point: `pnpm test:sdk:live`). Running it does not touch any mock; there is no mock
// under tests/live/. It writes sanitized evidence to docs/audits/live/<platform>/.

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  // A real http origin so localStorage/origin checks behave as they do on a hosted game
  // (about:blank has an opaque origin where storage is unavailable). Serves a blank page.
  use: { baseURL: "http://127.0.0.1:4180" },
  webServer: {
    command:
      "node -e \"require('http').createServer((q,s)=>{s.setHeader('content-type','text/html');s.end('<!doctype html><html><head></head><body></body></html>')}).listen(4180)\"",
    url: "http://127.0.0.1:4180",
    reuseExistingServer: false,
    timeout: 20_000,
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
});
