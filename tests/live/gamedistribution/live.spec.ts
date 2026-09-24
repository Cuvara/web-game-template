// GameDistribution — LIVE SDK validation (the real html5.api.gamedistribution.com script, no
// mock).
//
// Off-portal a browser can prove the documented loader URL is current, that the script runs
// when loaded the documented way (window.GD_OPTIONS first, script id gamedistribution-jssdk),
// that it defines window.gdsdk with showAd/preloadAd, and which of SDK_READY / SDK_ERROR it
// raises on this origin. It cannot prove ad fill, SDK_GAME_PAUSE/START around a real ad, or
// SDK_REWARDED_WATCH_COMPLETE: those need a registered Game ID on an approved domain and GD's
// ad server, and are reported BLOCKED.
//
// The Game ID is the template's test ID, which belongs to no title: the probe must not send
// sessions to someone else's game (the example IDs in GD's docs are real titles).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { PLATFORMS, classifySdkLoad, type SdkLoadEvidence } from "../_probe.js";

const here = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = resolve(here, "../../../docs/audits/live/gamedistribution/sdk-load.json");
const BUILD_SHA = process.env["WGF_BUILD_SHA"] ?? "unknown";
const TEST_GAME_ID = "0123456789abcdef0123456789abcdef";

test("GameDistribution real SDK loads the documented way and exposes gdsdk", async ({ page }) => {
  const d = PLATFORMS["gamedistribution"]!;
  // A real http origin, and a page that declares UTF-8 as every game page must: main.min.js
  // is served without a charset and contains non-ASCII regular expressions, so on a page
  // without one Chromium decodes it as windows-1252 and it throws "Invalid regular
  // expression" before defining gdsdk (observed 2026-09-24). The template's index.html
  // declares <meta charset="utf-8">.
  await page.route("**/gd-probe", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>',
    }),
  );
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 200)));
  await page.goto("/gd-probe");
  const raw = await page.evaluate(
    async ({ url, gameId, methods }) => {
      const events: string[] = [];
      const out = {
        scriptLoaded: false,
        error: null as string | null,
        globalPresent: false,
        methodsFound: [] as string[],
        methodsMissing: [] as string[],
        events,
        version: null as string | null,
      };
      (window as unknown as { GD_OPTIONS: unknown }).GD_OPTIONS = {
        gameId,
        onEvent: (event: { name?: string }) => events.push(String(event?.name ?? "")),
      };
      await new Promise<void>((resolve) => {
        const s = document.createElement("script");
        s.id = "gamedistribution-jssdk";
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
      const g = (window as unknown as { gdsdk?: Record<string, unknown> }).gdsdk;
      out.globalPresent = g != null;
      if (g)
        for (const m of methods)
          (typeof g[m] === "function" ? out.methodsFound : out.methodsMissing).push(m);
      // Wait for the SDK's own boot verdict on this origin.
      const until = Date.now() + 10_000;
      while (Date.now() < until && !events.includes("SDK_READY") && !events.includes("SDK_ERROR")) {
        await new Promise((r) => setTimeout(r, 100));
      }
      return out;
    },
    { url: d.url, gameId: TEST_GAME_ID, methods: [...d.methods] },
  );

  const initOutcome: SdkLoadEvidence["initOutcome"] = raw.events.includes("SDK_READY")
    ? "resolved"
    : raw.events.includes("SDK_ERROR")
      ? "rejected"
      : "timeout";
  const evidence: SdkLoadEvidence = {
    platform: d.platform,
    url: d.url,
    globalName: d.globalName,
    scriptLoaded: raw.scriptLoaded,
    error: raw.error,
    globalPresent: raw.globalPresent,
    methodsFound: raw.methodsFound,
    methodsMissing: raw.methodsMissing,
    initOutcome,
    initDetail:
      `events on ${new URL(page.url()).host}: ${[...new Set(raw.events)].join(", ") || "none"}` +
      (pageErrors.length ? `; page errors: ${pageErrors.join(" | ")}` : ""),
    at: new Date().toISOString(),
    buildSha: BUILD_SHA,
  };
  const status = classifySdkLoad(d, evidence);

  mkdirSync(dirname(EVIDENCE), { recursive: true });
  writeFileSync(
    EVIDENCE,
    JSON.stringify(
      {
        ...evidence,
        gameId: "template test ID (belongs to no title)",
        sdkLoadStatus: status,
        blocked: {
          ads: "showAd fill needs a registered Game ID on an approved domain and GD's ad server",
          pauseResume: "SDK_GAME_PAUSE / SDK_GAME_START around a real ad need a real ad",
          reward: "SDK_REWARDED_WATCH_COMPLETE needs a filled rewarded ad and the rewarded flag",
          activation: "the developer panel's pre-roll activation needs a publisher account",
          selfHosted:
            "a self-hosted wrapper on GameDistribution needs GD's agreement (Guidelines §3.1)",
        },
      },
      null,
      2,
    ) + "\n",
  );

  expect(evidence.scriptLoaded, evidence.error ?? "script should load").toBe(true);
  expect(evidence.globalPresent, "window.gdsdk present").toBe(true);
  expect(evidence.methodsMissing, "documented methods present").toEqual([]);
  expect(status).toBe("PASS");
  console.warn(`[gamedistribution] SDK-load=${status}; boot=${evidence.initDetail}`);
});

// The template's own GameDistribution build (scripts/verify/sdk-smoke-build.mjs) against the
// REAL SDK: proves the adapter's loader, GD_OPTIONS and event wiring work with the script
// GameDistribution actually serves, not only with the mock. Read-only instrumentation: the
// page's GD_OPTIONS.onEvent and gdsdk.preloadAd are wrapped to record, then passed through.
const BUNDLE = resolve(here, "../../../build/sdk-smoke/pixijs-gamedistribution");
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
  ".png": "image/png",
};

test("GameDistribution real SDK drives the template's gamedistribution build", async ({ page }) => {
  const evidencePath = resolve(
    here,
    "../../../docs/audits/live/gamedistribution/adapter-boot.json",
  );
  if (!existsSync(resolve(BUNDLE, "index.html"))) {
    writeFileSync(
      evidencePath,
      JSON.stringify(
        { status: "BLOCKED", reason: "run node scripts/verify/sdk-smoke-build.mjs first" },
        null,
        2,
      ) + "\n",
    );
    test.skip(true, "build/sdk-smoke/pixijs-gamedistribution is not built");
    return;
  }
  await page.route("**/game/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/game\/?/, "") || "index.html";
    const file = resolve(BUNDLE, path);
    if (!file.startsWith(BUNDLE) || !existsSync(file)) return route.fulfill({ status: 404 });
    return route.fulfill({
      contentType: CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
      body: readFileSync(file),
    });
  });
  await page.addInitScript(() => {
    const record: { events: string[]; calls: string[] } = { events: [], calls: [] };
    (window as unknown as { __live: typeof record }).__live = record;
    let options: { onEvent?: (e: { name: string }) => void } | undefined;
    Object.defineProperty(window, "GD_OPTIONS", {
      configurable: true,
      get: () => options,
      set: (value) => {
        const onEvent = value?.onEvent;
        options = {
          ...value,
          onEvent: (e: { name: string }) => {
            record.events.push(e?.name);
            onEvent?.(e);
          },
        };
      },
    });
    let sdk: Record<string, (...a: unknown[]) => unknown> | undefined;
    Object.defineProperty(window, "gdsdk", {
      configurable: true,
      get: () => sdk,
      set: (value) => {
        sdk = value;
        const preload = value?.preloadAd?.bind(value);
        if (preload) {
          value.preloadAd = (...args: unknown[]) => {
            record.calls.push(`preloadAd:${String(args[0])}`);
            return preload(...args);
          };
        }
      },
    });
  });
  // Errors are attributed by stack: the SDK pulls in GameDistribution's ad stack, whose own
  // errors are evidence about it, not failures of the game.
  const gameErrors: string[] = [];
  const sdkErrors: string[] = [];
  page.on("pageerror", (error) => {
    const message = error.message.slice(0, 200);
    (/\/game\//.test(error.stack ?? "") ? gameErrors : sdkErrors).push(message);
  });
  await page.goto("/game/");
  await expect(page.locator("#hud")).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  await expect
    .poll(
      () =>
        page.evaluate(() => (window as unknown as { __live: { calls: string[] } }).__live.calls),
      {
        timeout: 15_000,
      },
    )
    .toContain("preloadAd:rewarded");
  const live = await page.evaluate(() => (window as unknown as { __live: unknown }).__live);
  const before = await page.evaluate(() => window.__wgf__!.elapsedMs());
  await page.waitForTimeout(500);
  const advancing = (await page.evaluate(() => window.__wgf__!.elapsedMs())) > before;
  const platformId = await page.evaluate(() => window.__wgf__!.platformId);

  const scriptTags = await page.locator("script#gamedistribution-jssdk").count();
  const pass =
    platformId === "gamedistribution" && scriptTags === 1 && advancing && gameErrors.length === 0;
  const evidence = {
    status: pass ? "PASS" : "FAIL",
    what:
      "template pixijs-gamedistribution build, real main.min.js, Chromium, 127.0.0.1:4180; " +
      "adapter received the real SDK_READY and called the real gdsdk.preloadAd",
    platformId,
    gameLoopAdvancing: advancing,
    scriptTags,
    sdk: live,
    gamePageErrors: gameErrors,
    sdkPageErrors: sdkErrors,
    at: new Date().toISOString(),
    buildSha: BUILD_SHA,
    notObserved: "ads, pause/resume around an ad, reward — see sdk-load.json `blocked`",
  };
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + "\n");
  expect(platformId).toBe("gamedistribution");
  expect(scriptTags).toBe(1);
  expect(advancing).toBe(true);
  expect(gameErrors).toEqual([]);
});
