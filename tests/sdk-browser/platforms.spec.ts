// The template game in a real browser, once per engine × platform, with each portal's SDK
// replaced by a local mock (or blocked, the way an ad blocker would). Bundles come from
// scripts/verify/sdk-smoke-build.mjs.
//
// What this adds over tests/sdk/: the adapters run inside the real PixiJS and Three.js
// builds, through src/main.ts's boot order and src/platform/bind.ts, with a real document,
// real script loading and real visibility. What it cannot show: how the real portal behaves.
// That is draft/QA mode on each portal, which is a release-pipeline step, not a test.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { MOCK_SDK_SOURCE as MOCK_CRAZYGAMES } from "../crazygames/mock-sdk.js";
import { MOCK_SDK_SOURCE as MOCK_GAMEMONETIZE } from "../gamemonetize/mock-sdk.js";

const ENGINES = ["pixijs", "threejs"] as const;
const POKI_SDK_URL = "https://game-cdn.poki.com/scripts/v2/poki-sdk.js";
const CRAZYGAMES_SDK_URL = "https://sdk.crazygames.com/crazygames-sdk-v3.js";
const GAMEMONETIZE_SDK_URL = "https://api.gamemonetize.com/sdk.js";
const MOCK_YANDEX = readFileSync(resolve(import.meta.dirname, "mock-yandex-sdk.js"), "utf8");
const MOCK_POKI = readFileSync(
  resolve(import.meta.dirname, "..", "poki", "mock-poki-sdk.js"),
  "utf8",
);

type Sdk = "mock" | "block";

// window.__wgf__ is declared by src/core/probe.ts.
declare global {
  interface Window {
    __yaCalls?: string[];
    __yaFire?: (event: string) => void;
    __pokiCalls?: string[];
    __pokiViolations?: string[];
    __cgCalls__?: { name: string }[];
    __gmCalls?: string[];
    __gmEmit?: (name: string) => void;
  }
}

async function boot(page: Page, bundle: string, sdk: Sdk = "mock"): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/sdk.js", (route) =>
    sdk === "block"
      ? route.abort()
      : route.fulfill({ contentType: "text/javascript", body: MOCK_YANDEX }),
  );
  await page.route(POKI_SDK_URL, (route) =>
    sdk === "block"
      ? route.abort()
      : route.fulfill({ contentType: "text/javascript", body: MOCK_POKI }),
  );
  await page.route(CRAZYGAMES_SDK_URL, (route) =>
    sdk === "block"
      ? route.abort()
      : route.fulfill({ contentType: "text/javascript", body: MOCK_CRAZYGAMES }),
  );
  // Registered after "**/sdk.js" (Yandex's), which would also match this URL: the route
  // registered last wins.
  await page.route(GAMEMONETIZE_SDK_URL, (route) =>
    sdk === "block"
      ? route.abort()
      : route.fulfill({ contentType: "text/javascript", body: MOCK_GAMEMONETIZE }),
  );
  await page.goto(`/${bundle}/`);
  await expect(page.locator("#hud")).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
  return errors;
}

const elapsed = (page: Page): Promise<number> => page.evaluate(() => window.__wgf__!.elapsedMs());

async function advances(page: Page): Promise<boolean> {
  const before = await elapsed(page);
  await page.waitForTimeout(400);
  return (await elapsed(page)) > before;
}

for (const engine of ENGINES) {
  test.describe(engine, () => {
    test(`generic-web boots, renders and runs (the GameVui build)`, async ({ page }) => {
      const external: string[] = [];
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (
          url.hostname !== "localhost" &&
          !url.protocol.startsWith("data") &&
          !url.protocol.startsWith("blob")
        ) {
          external.push(request.url());
        }
      });
      const errors = await boot(page, `${engine}-generic-web`);
      const probe = await page.evaluate(() => ({
        id: window.__wgf__!.platformId,
        engine: window.__wgf__!.engine,
      }));
      expect(probe).toEqual({ id: "generic-web", engine });
      await expect(page.locator("#game canvas")).toBeVisible();
      expect(await advances(page)).toBe(true);
      expect(external).toEqual([]);
      expect(errors).toEqual([]);
    });

    test(`yandex: SDK init, Game Ready, portal pause and resume`, async ({ page }) => {
      const errors = await boot(page, `${engine}-yandex`);
      expect(await page.evaluate(() => window.__wgf__!.platformId)).toBe("yandex");
      const calls = await page.evaluate(() => window.__yaCalls!);
      expect(calls[0]).toBe("YaGames.init");
      expect(calls.filter((c) => c === "LoadingAPI.ready")).toHaveLength(1);
      expect(await advances(page)).toBe(true);

      // game_api_pause — the portal's ad, or its own overlay — must stop the game.
      await page.evaluate(() => window.__yaFire!("game_api_pause"));
      expect(await advances(page)).toBe(false);
      await page.evaluate(() => window.__yaFire!("game_api_resume"));
      expect(await advances(page)).toBe(true);
      expect(errors).toEqual([]);
    });

    test(`yandex: the game still boots when /sdk.js is blocked`, async ({ page }) => {
      await boot(page, `${engine}-yandex`, "block");
      expect(await advances(page)).toBe(true);
    });

    test(`poki: SDK init and loading finished, no sequencing violations`, async ({ page }) => {
      const errors = await boot(page, `${engine}-poki`);
      expect(await page.evaluate(() => window.__wgf__!.platformId)).toBe("poki");
      await expect
        .poll(() => page.evaluate(() => window.__pokiCalls ?? []))
        .toContain("gameLoadingFinished");
      // The first input starts gameplay, not the load (Poki's rule).
      await page.mouse.click(10, 10);
      await expect.poll(() => page.evaluate(() => window.__pokiCalls!)).toContain("gameplayStart");
      expect(await page.evaluate(() => window.__pokiViolations!)).toEqual([]);
      expect(errors).toEqual([]);
    });

    test(`poki: the game still boots when the SDK is blocked`, async ({ page }) => {
      await boot(page, `${engine}-poki`, "block");
      expect(await advances(page)).toBe(true);
    });

    test(`crazygames: SDK init, loading reported, gameplay on first input, no focus-loss report`, async ({
      page,
    }) => {
      const errors = await boot(page, `${engine}-crazygames`);
      expect(await page.evaluate(() => window.__wgf__!.platformId)).toBe("crazygames");
      const names = () => page.evaluate(() => (window.__cgCalls__ ?? []).map((c) => c.name));
      expect((await names()).slice(0, 3)).toEqual(["init", "loadingStart", "loadingStop"]);
      await page.mouse.click(10, 10);
      await expect.poll(names).toContain("gameplayStart");
      expect(await advances(page)).toBe(true);

      // CrazyGames handles focus loss itself and asks games not to report it.
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => "hidden",
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(await advances(page)).toBe(false);
      expect(await names()).not.toContain("gameplayStop");
      expect(errors).toEqual([]);
    });

    test(`crazygames: the game still boots when the SDK is blocked`, async ({ page }) => {
      await boot(page, `${engine}-crazygames`, "block");
      expect(await advances(page)).toBe(true);
    });

    test(`gamemonetize: SDK init with the configured Game ID, portal pause and resume`, async ({
      page,
    }) => {
      const errors = await boot(page, `${engine}-gamemonetize`);
      expect(await page.evaluate(() => window.__wgf__!.platformId)).toBe("gamemonetize");
      expect(await page.evaluate(() => window.__gmCalls)).toEqual(["load:gameId"]);
      expect(
        await page.evaluate(
          () => (window as unknown as { SDK_OPTIONS: { gameId: string } }).SDK_OPTIONS.gameId,
        ),
      ).toBe("smoke000000000000000000000000000");
      expect(await advances(page)).toBe(true);

      // SDK_GAME_PAUSE — an ad is about to play — must stop the game until SDK_GAME_START.
      await page.evaluate(() => window.__gmEmit!("SDK_GAME_PAUSE"));
      expect(await advances(page)).toBe(false);
      await expect(page.locator("html")).toHaveAttribute("data-audio-muted", "true");
      await page.evaluate(() => window.__gmEmit!("SDK_GAME_START"));
      expect(await advances(page)).toBe(true);
      await expect(page.locator("html")).toHaveAttribute("data-audio-muted", "false");
      expect(errors).toEqual([]);
    });

    test(`gamemonetize: the game still boots when the SDK is blocked`, async ({ page }) => {
      await boot(page, `${engine}-gamemonetize`, "block");
      expect(await advances(page)).toBe(true);
    });

    test(`gamemonetize: a build without a Game ID never requests the SDK`, async ({ page }) => {
      const requested: string[] = [];
      page.on("request", (request) => {
        if (new URL(request.url()).hostname !== "localhost") requested.push(request.url());
      });
      const errors = await boot(page, `${engine}-gamemonetize-no-game-id`);
      expect(await page.evaluate(() => window.__wgf__!.platformId)).toBe("gamemonetize");
      expect(await advances(page)).toBe(true);
      expect(requested).toEqual([]);
      expect(errors).toEqual([]);
    });
  });
}
