// Y8 — LIVE SDK validation (the real cdn.y8.com script, no mock).
//
// Off the Y8 site a browser can prove: the documented URL is current and loads, it defines
// window.y8 with sdk() and emitReadyEvent(), the documented race cure works against the real
// script (listen for y8sdk.ready, then emitReadyEvent() after the script already ran), and
// y8.sdk() exposes every method the adapter calls. It CANNOT prove init against a real game,
// ad fill, reward delivery or Cloud Storage: those need a real App ID / Game ID (never in
// this repository), a signed-in Y8 account, and — for ads — a game in review or live on Y8.
// init() is deliberately NOT called: with no real App ID it would count a play against no
// game and send test traffic to Y8. Those cells are BLOCKED, never PASS.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { PLATFORMS, classifySdkLoad, probeSdkLoad } from "../_probe.js";

const here = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = resolve(here, "../../../docs/audits/live/y8/sdk-load.json");
const BUILD_SHA = process.env["WGF_BUILD_SHA"] ?? "unknown";

/** Every SDK method packages/platform-sdk/src/adapters/y8/sdk.ts types and the adapter calls. */
const INSTANCE_METHODS = [
  "init",
  "onAuth",
  "getUser",
  "showAd",
  "saveData",
  "loadData",
  "removeData",
  "getPlatformLocale",
];

test("Y8 real SDK loads, announces itself on request, and exposes the documented surface", async ({
  page,
}) => {
  const d = PLATFORMS["y8"]!;
  await page.goto("/"); // a real http origin, as a hosted game has
  const evidence = await probeSdkLoad(page, d, BUILD_SHA, /* attemptInit */ false);
  const status = classifySdkLoad(d, evidence);

  // The race the docs warn about, against the real script: it has already run and fired
  // y8sdk.ready with nobody listening. Listening now and calling emitReadyEvent() must bring
  // a second announcement.
  const race = await page.evaluate(async (methods) => {
    const w = window as unknown as {
      y8?: { sdk(): Record<string, unknown>; emitReadyEvent(): void };
    };
    const readyAgain = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 5000);
      window.addEventListener(
        "y8sdk.ready",
        () => {
          clearTimeout(timer);
          resolve(true);
        },
        { once: true },
      );
      w.y8?.emitReadyEvent();
    });
    const instance = w.y8?.sdk();
    const sameInstance = instance !== undefined && instance === w.y8?.sdk();
    return {
      readyAgain,
      sameInstance,
      instanceMethodsFound: methods.filter((m) => typeof instance?.[m] === "function"),
      instanceMethodsMissing: methods.filter((m) => typeof instance?.[m] !== "function"),
    };
  }, INSTANCE_METHODS);

  const surfaceOk =
    status === "PASS" &&
    race.readyAgain &&
    race.sameInstance &&
    race.instanceMethodsMissing.length === 0;

  mkdirSync(dirname(EVIDENCE), { recursive: true });
  writeFileSync(
    EVIDENCE,
    JSON.stringify(
      {
        ...evidence,
        readyEventOnEmit: race.readyAgain,
        sdkSingleton: race.sameInstance,
        instanceMethodsFound: race.instanceMethodsFound,
        instanceMethodsMissing: race.instanceMethodsMissing,
        sdkLoadStatus: surfaceOk ? "PASS" : "FAIL",
        blocked: {
          init: "needs a real App ID (never committed); init off a registered origin is not attempted",
          ads: "needs a real Game ID and a game in review/live on Y8 (test creatives are served only then)",
          reward: "needs Y8's ad system to fill a rewarded break",
          storage: "Cloud Storage needs a signed-in Y8 account",
          auth: "auto sign-in only happens on the game's own Y8 page",
        },
      },
      null,
      2,
    ),
  );

  expect(evidence.scriptLoaded, evidence.error ?? "script should load").toBe(true);
  expect(evidence.globalPresent, "window.y8 present").toBe(true);
  expect(evidence.methodsMissing, "y8.sdk / y8.emitReadyEvent present").toEqual([]);
  expect(race.readyAgain, "emitReadyEvent re-dispatches y8sdk.ready").toBe(true);
  expect(race.sameInstance, "y8.sdk() returns one instance").toBe(true);
  expect(race.instanceMethodsMissing, "documented SDK methods present").toEqual([]);
  expect(status).toBe("PASS");
  console.warn("[y8] SDK-load=PASS (surface + ready race); init/ads/reward/storage=BLOCKED");
});
