// GameMonetize — LIVE SDK validation (the real api.gamemonetize.com/sdk.js, no mock).
//
// Loads the real script the way the adapter does — window.SDK_OPTIONS first, then
// <script id="gamemonetize-sdk"> — and records whether it loads, whether window.sdk exposes
// the documented showBanner(), and which documented events it raises by itself.
//
// Off-portal this proves the documented URL and surface are current. It cannot prove ad fill,
// SDK_GAME_PAUSE/SDK_GAME_START around a real ad, or GameMonetize's "Verify Game": those need
// a real Game ID, an uploaded build and the GameMonetize dashboard, and are BLOCKED here.
//
// The Game ID is WGF_GAMEMONETIZE_GAME_ID when set, else a placeholder. It is never written to
// the evidence file. showBanner() is never called: that would request a real ad.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = resolve(here, "../../../docs/audits/live/gamemonetize/sdk-load.json");
const BUILD_SHA = process.env["WGF_BUILD_SHA"] ?? "unknown";
const URL = "https://api.gamemonetize.com/sdk.js";
const DOCUMENTED_EVENTS = ["SDK_READY", "SDK_ERROR", "SDK_GAME_PAUSE", "SDK_GAME_START"];

test("GameMonetize real SDK loads and exposes its documented surface", async ({ page }) => {
  const configured = process.env["WGF_GAMEMONETIZE_GAME_ID"];
  const gameId = configured || "wgfliveprobe0000000000000000000";
  await page.goto("/"); // a real http origin, as a hosted game has

  const raw = await page.evaluate(
    async ({ url, gameId }) => {
      const out = {
        scriptLoaded: false,
        error: null as string | null,
        globalPresent: false,
        methodsFound: [] as string[],
        methodsMissing: [] as string[],
        events: [] as string[],
      };
      (window as unknown as { SDK_OPTIONS: unknown }).SDK_OPTIONS = {
        gameId,
        advertisementSettings: { autoplay: false },
        onEvent: (event: { name: string }) => out.events.push(String(event?.name)),
      };
      await new Promise<void>((resolve) => {
        const s = document.createElement("script");
        s.id = "gamemonetize-sdk";
        s.src = url;
        s.onload = () => {
          out.scriptLoaded = true;
          resolve();
        };
        s.onerror = () => {
          out.error = "script failed to load (unreachable or blocked)";
          resolve();
        };
        document.head.appendChild(s);
        setTimeout(() => {
          if (!out.scriptLoaded && !out.error) out.error = "timeout waiting for script";
          resolve();
        }, 15_000);
      });
      // Give the SDK time to raise SDK_READY / SDK_ERROR by itself.
      await new Promise((resolve) => setTimeout(resolve, 8_000));
      const sdk = (window as unknown as { sdk?: Record<string, unknown> }).sdk;
      out.globalPresent = sdk != null;
      if (sdk) {
        (typeof sdk["showBanner"] === "function" ? out.methodsFound : out.methodsMissing).push(
          "showBanner",
        );
      }
      return out;
    },
    { url: URL, gameId },
  );

  const status =
    raw.scriptLoaded && raw.globalPresent && raw.methodsMissing.length === 0 ? "PASS" : "FAIL";
  const documented = raw.events.filter((name) => DOCUMENTED_EVENTS.includes(name));

  mkdirSync(dirname(EVIDENCE), { recursive: true });
  writeFileSync(
    EVIDENCE,
    JSON.stringify(
      {
        platform: "gamemonetize",
        url: URL,
        scriptLoaded: raw.scriptLoaded,
        error: raw.error,
        globalName: "sdk",
        globalPresent: raw.globalPresent,
        methodsFound: raw.methodsFound,
        methodsMissing: raw.methodsMissing,
        gameIdSource: configured ? "WGF_GAMEMONETIZE_GAME_ID" : "placeholder",
        // Evidence, not a verdict: what the SDK raised by itself within 8s, off-portal.
        eventsObserved: documented,
        initOutcome: documented.includes("SDK_READY")
          ? "SDK_READY"
          : documented.includes("SDK_ERROR")
            ? "SDK_ERROR"
            : "none-within-8s",
        at: new Date().toISOString(),
        buildSha: BUILD_SHA,
        sdkLoadStatus: status,
        blocked: {
          ads: "showBanner fill and SDK_GAME_PAUSE/SDK_GAME_START around a real ad need a real Game ID and GameMonetize's ad server; not requested here",
          verify: "GameMonetize's 'Verify Game' runs in the dashboard against an uploaded build",
          activation: "REQUEST ACTIVATION is reviewed by GameMonetize's content manager",
        },
      },
      null,
      2,
    ) + "\n",
  );

  expect(raw.scriptLoaded, raw.error ?? "script should load").toBe(true);
  expect(raw.globalPresent, "window.sdk present").toBe(true);
  expect(raw.methodsMissing, "documented methods present").toEqual([]);
  console.warn(`[gamemonetize] SDK-load=${status} init=${documented.join(",") || "none"}`);
});
