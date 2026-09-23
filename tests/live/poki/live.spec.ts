// Poki — LIVE SDK validation (real game-cdn.poki.com script, no mock).
//
// Off-portal proves the real SDK URL loads and exposes window.PokiSDK with its documented
// methods. commercialBreak/rewardedBreak fill, mute-before-break, and the 60s-timeout /
// late-reward behavior need Poki's own environment (Poki Inspector / portal) and are BLOCKED
// here. Use manual/index.html inside the Poki Inspector to exercise them.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { PLATFORMS, classifySdkLoad, probeSdkLoad } from "../_probe.js";

const here = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = resolve(here, "../../../docs/audits/live/poki/sdk-load.json");
const BUILD_SHA = process.env["WGF_BUILD_SHA"] ?? "unknown";

test("Poki real SDK loads and exposes its documented surface", async ({ page }) => {
  const d = PLATFORMS["poki"]!;
  // Poki's init auto-detects its environment; attempting it off-portal can hang, so we record
  // load + surface and leave init to the manual/portal path.
  const evidence = await probeSdkLoad(page, d, BUILD_SHA, /* attemptInit */ false);
  const status = classifySdkLoad(d, evidence);

  mkdirSync(dirname(EVIDENCE), { recursive: true });
  writeFileSync(
    EVIDENCE,
    JSON.stringify(
      {
        ...evidence,
        sdkLoadStatus: status,
        blocked: {
          init: "Poki init/gameplay reporting needs the Poki environment (Inspector/portal)",
          ads: "commercialBreak/rewardedBreak need Poki's ad server",
          reward: "rewardedBreak resolution needs Poki's ad server",
          timeout: "the 60s break timeout can only be exercised against a real (stuck) break",
        },
      },
      null,
      2,
    ),
  );

  expect(evidence.scriptLoaded, evidence.error ?? "script should load").toBe(true);
  expect(evidence.globalPresent, `window.${d.globalName} present`).toBe(true);
  expect(evidence.methodsMissing, "documented methods present").toEqual([]);
  expect(status).toBe("PASS");
  console.warn(`[poki] SDK-load=${status}`);
});
