// GameVui — LIVE validation.
//
// GameVui publishes no public JS SDK (see docs/platforms/gamevui/ and the production-readiness
// audit). There is nothing to load, so SDK-level live validation is NOT_APPLICABLE, by design —
// a GameVui build runs on the generic-web adapter. What IS verifiable is the hosting
// environment a plain web/iframe host provides: local storage and viewport resize in a real
// browser. Full generic-web game boot/render is already covered by `pnpm test:e2e` and the
// generic-web ("GameVui build") cases in `pnpm test:sdk:browser`.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = resolve(here, "../../../docs/audits/live/gamevui/sdk-load.json");
const BUILD_SHA = process.env["WGF_BUILD_SHA"] ?? "unknown";

test("GameVui has no public SDK; hosting basics work in a real browser", async ({ page }) => {
  await page.goto("/"); // real http origin (localStorage is unavailable on about:blank)
  const host = await page.evaluate(() => {
    const out = { localStorage: false, resizeEvent: false, canvas: false };
    try {
      window.localStorage.setItem("__wgf_probe", "1");
      out.localStorage = window.localStorage.getItem("__wgf_probe") === "1";
      window.localStorage.removeItem("__wgf_probe");
    } catch {
      out.localStorage = false;
    }
    try {
      let fired = false;
      const h = () => (fired = true);
      window.addEventListener("resize", h);
      window.dispatchEvent(new Event("resize"));
      window.removeEventListener("resize", h);
      out.resizeEvent = fired;
    } catch {
      out.resizeEvent = false;
    }
    const c = document.createElement("canvas");
    out.canvas = !!(c.getContext("webgl2") || c.getContext("webgl") || c.getContext("2d"));
    return out;
  });

  mkdirSync(dirname(EVIDENCE), { recursive: true });
  writeFileSync(
    EVIDENCE,
    JSON.stringify(
      {
        platform: "gamevui",
        sdk: "UNAVAILABLE — no public GameVui JS SDK",
        adapter: "generic-web",
        ads: "UNSUPPORTED",
        storage: "local",
        sdkLoadStatus: "NOT_APPLICABLE",
        hostingBasics: host,
        gameBootCoveredBy: ["pnpm test:e2e", "pnpm test:sdk:browser (generic-web)"],
        at: new Date().toISOString(),
        buildSha: BUILD_SHA,
      },
      null,
      2,
    ),
  );

  expect(host.localStorage).toBe(true);
  expect(host.resizeEvent).toBe(true);
  expect(host.canvas).toBe(true);
  console.warn("[gamevui] SDK=NOT_APPLICABLE (no public SDK); hosting basics PASS");
});
