// Yandex — LIVE SDK validation.
//
// Yandex's SDK is served by the portal at the origin-relative path "/sdk.js" (requirement
// 1.7). A browser outside the portal cannot resolve it, and init()/ads/rewarded/storage all
// need the portal's own iframe + player backend. So off-portal live validation is BLOCKED by
// construction — not a failure of the adapter. The manual tester page, opened inside a Yandex
// Games draft/dev build in the Yandex console, is the path to exercise the real flows.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { PLATFORMS, classifySdkLoad, probeSdkLoad } from "../_probe.js";

const here = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = resolve(here, "../../../docs/audits/live/yandex/sdk-load.json");
const BUILD_SHA = process.env["WGF_BUILD_SHA"] ?? "unknown";

test("Yandex live SDK is BLOCKED off-portal (portal-served /sdk.js)", async ({ page }) => {
  const d = PLATFORMS["yandex"]!;
  // Attempt anyway to capture honest evidence that the portal-relative path does not resolve.
  const evidence = await probeSdkLoad(page, d, BUILD_SHA, /* attemptInit */ false);
  const status = classifySdkLoad(d, evidence); // BLOCKED — portalServed

  mkdirSync(dirname(EVIDENCE), { recursive: true });
  writeFileSync(
    EVIDENCE,
    JSON.stringify(
      {
        ...evidence,
        sdkLoadStatus: status,
        reason:
          "SDK is origin-relative /sdk.js served only inside the Yandex portal iframe; " +
          "init, interstitial, rewarded, pause/resume and player storage require the portal backend.",
        exercisedBy: "manual tester page opened in a Yandex Games draft build in the developer console",
      },
      null,
      2,
    ),
  );

  expect(status).toBe("BLOCKED");
  // Confirm the honest fact: the relative script did not load off-portal.
  expect(evidence.scriptLoaded).toBe(false);
  console.warn(`[yandex] SDK-load=${status} (portal-served; off-portal unreachable as expected)`);
});
