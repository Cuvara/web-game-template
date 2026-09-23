// CrazyGames — LIVE SDK validation (real sdk.crazygames.com script, no mock).
//
// Off-portal a browser can prove the real SDK URL is current, loads, and exposes
// window.CrazyGames.SDK. It CANNOT prove init handshake, ad fill, or reward delivery — those
// need the CrazyGames QA tool / portal iframe and are reported BLOCKED. Use manual/index.html
// inside the CrazyGames QA tool to exercise them.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { PLATFORMS, classifySdkLoad, probeSdkLoad } from "../_probe.js";

const here = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = resolve(here, "../../../docs/audits/live/crazygames/sdk-load.json");
const BUILD_SHA = process.env["WGF_BUILD_SHA"] ?? "unknown";

test("CrazyGames real SDK loads and exposes its documented surface", async ({ page }) => {
  const d = PLATFORMS["crazygames"]!;
  const evidence = await probeSdkLoad(page, d, BUILD_SHA);
  const status = classifySdkLoad(d, evidence);

  mkdirSync(dirname(EVIDENCE), { recursive: true });
  writeFileSync(
    EVIDENCE,
    JSON.stringify(
      {
        ...evidence,
        sdkLoadStatus: status,
        blocked: {
          init: "requires the CrazyGames QA tool / portal iframe (no backend off-portal)",
          ads: "requires portal ad server",
          reward: "requires portal ad server",
          storage: "requires portal user context",
        },
      },
      null,
      2,
    ),
  );

  // Real evidence: the SDK script is reachable and its global surface is present.
  expect(evidence.scriptLoaded, evidence.error ?? "script should load").toBe(true);
  expect(evidence.globalPresent, `window.${d.globalName} present`).toBe(true);
  expect(evidence.methodsMissing, "documented methods present").toEqual([]);
  expect(status).toBe("PASS");
  // init off-portal is expected NOT to complete — recorded as evidence, not asserted PASS.
  console.warn(`[crazygames] SDK-load=${status}; init off-portal=${evidence.initOutcome}`);
});
