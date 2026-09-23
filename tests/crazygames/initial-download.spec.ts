// Initial download as CrazyGames defines it: bytes loaded between the start of loading and
// the first `gameplayStart`. Measured on a cold cache from the resource timing entries the
// browser recorded up to that call, and written to build/crazygames-runtime.json for the
// audit to pick up.
//
// This is an APPROXIMATION of the portal's own measurement, never a PASS in its place: the
// portal measures through its CDN (compressed transfer, its own SDK version and ad scripts),
// and the mock SDK here is a few KB. The bytes that belong to the game — HTML, JS, locales —
// are counted exactly; the SDK's own share is reported separately.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { LIVE_SDK, boot, expect, sdkCalls, test } from "./fixtures.js";

const OUT = resolve(import.meta.dirname, "../../build/crazygames-runtime.json");
const DIST_INDEX = resolve(
  import.meta.dirname,
  "../../examples/crazygames-compliance-demo/dist/index.html",
);

test("initial download up to the first gameplayStart", async ({ page, requests }, info) => {
  test.skip(info.project.name !== "desktop", "measured once");
  await boot(page);

  const start = (await sdkCalls(page)).find((call) => call.name === "gameplayStart");
  const measured = await page.evaluate((gameplayStartAt) => {
    const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const nav = performance.getEntriesByType("navigation")[0] as
      PerformanceNavigationTiming | undefined;
    const beforeStart = entries.filter(
      (entry) => gameplayStartAt === null || entry.responseEnd <= gameplayStartAt,
    );
    const isSdk = (entry: PerformanceResourceTiming): boolean =>
      entry.name.includes("sdk.crazygames.com");
    const own = beforeStart.filter((entry) => !isSdk(entry));
    const sum = (list: PerformanceResourceTiming[], key: "decodedBodySize" | "encodedBodySize") =>
      list.reduce((total, entry) => total + (entry[key] || 0), 0);
    return {
      // Decoded = the bytes of the files themselves; encoded = what crossed the wire, which
      // vite preview may have gzipped. The portal's CDN compresses too, so the true figure
      // sits between them; the larger one is compared against the limits.
      decodedBytes: (nav?.decodedBodySize ?? 0) + sum(own, "decodedBodySize"),
      encodedBytes: (nav?.encodedBodySize ?? 0) + sum(own, "encodedBodySize"),
      sdkBytes: sum(beforeStart.filter(isSdk), "decodedBodySize"),
      ownFiles: own.map((entry) => entry.name.replace(location.origin, "")),
      loadedAfterStart: entries.length - beforeStart.length,
    };
  }, start?.t ?? null);

  const initialBytes = Math.max(measured.decodedBytes, measured.encodedBytes);
  const report = {
    status: "APPROXIMATION",
    measured_at: new Date().toISOString(),
    method:
      "Chromium resource timing, cold cache, local vite preview, mock SDK. Game-owned bytes " +
      "(decoded, i.e. uncompressed) loaded before the first gameplayStart call.",
    build_dir: "examples/crazygames-compliance-demo/dist",
    // Ties the measurement to one build: index.html names every hashed entry chunk, so a
    // rebuild changes it and the audit stops trusting this file.
    index_html_sha256: createHash("sha256").update(readFileSync(DIST_INDEX)).digest("hex"),
    live_sdk: LIVE_SDK,
    gameplay_start_ms: start ? Math.round(start.t) : null,
    initial_download_bytes: initialBytes,
    initial_download_mb: Number((initialBytes / 1_000_000).toFixed(3)),
    initial_download_wire_bytes: measured.encodedBytes,
    sdk_bytes_observed: measured.sdkBytes,
    files_before_gameplay_start: ["/", ...measured.ownFiles],
    files_after_gameplay_start: measured.loadedAfterStart,
    // Every request that left the page's origin during boot, for the audit's network check.
    external_requests: requests.filter((url) => !url.startsWith(new URL(page.url()).origin)),
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n");

  expect(start).toBeDefined();
  // Official limits: 50 MB to be accepted, 20 MB for the mobile homepage.
  expect(initialBytes).toBeLessThan(20 * 1024 * 1024);
});
