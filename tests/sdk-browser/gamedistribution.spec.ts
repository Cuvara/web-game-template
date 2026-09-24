// GameDistribution in the real template builds (PixiJS and Three.js), in Chromium, with
// https://html5.api.gamedistribution.com/main.min.js replaced by tests/gamedistribution/
// mock-gd-sdk.js — or blocked, the way an ad blocker would. Bundles come from
// scripts/verify/sdk-smoke-build.mjs, built against a game.config whose required platform is
// gamedistribution with a test Game ID.
//
// Covered here: the documented snippet (GD_OPTIONS before the script, id
// gamedistribution-jssdk, loaded once, the configured Game ID), SDK_READY / SDK_ERROR / a
// missing, late or doubled SDK_READY, the SDK_GAME_PAUSE / SDK_GAME_START pair holding and
// releasing the real game loop, and what the SDK sees of its hosting — top-level local
// development, and the self-hosted wrapper (scripts/release/gamedistribution-wrapper.mjs)
// framing the game with gd_sdk_referrer_url. Ads through a real renderer are in
// tests/sdk-matrix/; the template game itself requests none.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Frame, type Page } from "@playwright/test";
// @ts-expect-error — plain ESM script without type declarations.
import { wrapperHtml } from "../../scripts/release/gamedistribution-wrapper.mjs";

const ENGINES = ["pixijs", "threejs"] as const;
const GD_SDK_URL = "https://html5.api.gamedistribution.com/main.min.js";
const TEST_GAME_ID = "0123456789abcdef0123456789abcdef";
const MOCK_GD = readFileSync(
  resolve(import.meta.dirname, "..", "gamedistribution", "mock-gd-sdk.js"),
  "utf8",
);

interface GdMock {
  boot?: "ready" | "twice" | "error" | "never" | "late";
  lateMs?: number;
}

declare global {
  interface Window {
    __gdMock?: GdMock;
    __gdCalls?: string[];
    __gdEvents?: string[];
    __gdViolations?: string[];
    __gdContext?: { search: string; framed: boolean };
    __gdFire?: (name: string) => void;
  }
}

async function serveSdk(page: Page, mode: "mock" | "block", mock: GdMock = {}): Promise<void> {
  await page.addInitScript((m) => (window.__gdMock = m), mock);
  await page.route(GD_SDK_URL, (route) =>
    mode === "block"
      ? route.abort()
      : route.fulfill({ contentType: "text/javascript", body: MOCK_GD }),
  );
}

async function boot(
  page: Page,
  engine: string,
  mode: "mock" | "block" = "mock",
  mock: GdMock = {},
): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await serveSdk(page, mode, mock);
  await page.goto(`/${engine}-gamedistribution/`);
  await expect(page.locator("#hud")).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
  return errors;
}

const elapsed = (target: Page | Frame): Promise<number> =>
  target.evaluate(() => window.__wgf__!.elapsedMs());

async function advances(target: Page | Frame): Promise<boolean> {
  const before = await elapsed(target);
  await new Promise((r) => setTimeout(r, 400));
  return (await elapsed(target)) > before;
}

for (const engine of ENGINES) {
  test.describe(`${engine} × gamedistribution`, () => {
    test("loads the SDK the documented way, once, with the configured Game ID", async ({
      page,
    }) => {
      const errors = await boot(page, engine);
      expect(await page.evaluate(() => window.__wgf__!.platformId)).toBe("gamedistribution");
      expect(await page.evaluate(() => window.GD_OPTIONS?.gameId)).toBe(TEST_GAME_ID);
      expect(await page.locator("script#gamedistribution-jssdk").count()).toBe(1);
      await expect.poll(() => page.evaluate(() => window.__gdEvents ?? [])).toContain("SDK_READY");
      // The rewarded check the Rewarded-Ads page recommends; no ad without the player.
      await expect
        .poll(() => page.evaluate(() => window.__gdCalls ?? []))
        .toEqual(["preloadAd:rewarded"]);
      expect(await page.evaluate(() => window.__gdViolations)).toEqual([]);
      await expect(page.locator("#game canvas")).toBeVisible();
      expect(await advances(page)).toBe(true);
      expect(errors).toEqual([]);
    });

    test("SDK_GAME_PAUSE holds the game until SDK_GAME_START", async ({ page }) => {
      const errors = await boot(page, engine);
      await expect.poll(() => page.evaluate(() => window.__gdEvents ?? [])).toContain("SDK_READY");
      await page.evaluate(() => window.__gdFire!("SDK_GAME_PAUSE"));
      await page.evaluate(() => window.__gdFire!("SDK_GAME_PAUSE"));
      expect(await page.evaluate(() => document.documentElement.dataset["audioMuted"])).toBe(
        "true",
      );
      expect(await advances(page)).toBe(false);
      await page.evaluate(() => window.__gdFire!("SDK_GAME_START"));
      expect(await page.evaluate(() => document.documentElement.dataset["audioMuted"])).toBe(
        "false",
      );
      expect(await advances(page)).toBe(true);
      // A resume with no pause before it — the SDK sends those — changes nothing.
      await page.evaluate(() => window.__gdFire!("SDK_GAME_START"));
      expect(await advances(page)).toBe(true);
      expect(errors).toEqual([]);
    });

    test("SDK_READY twice: boots once, no violation", async ({ page }) => {
      const errors = await boot(page, engine, "mock", { boot: "twice" });
      await expect
        .poll(() => page.evaluate(() => (window.__gdEvents ?? []).filter((e) => e === "SDK_READY")))
        .toHaveLength(2);
      expect(await page.evaluate(() => window.__gdCalls)).toEqual(["preloadAd:rewarded"]);
      expect(await page.evaluate(() => window.__gdViolations)).toEqual([]);
      expect(await advances(page)).toBe(true);
      expect(errors).toEqual([]);
    });

    test("SDK blocked: the game still boots and runs", async ({ page }) => {
      const errors = await boot(page, engine, "block");
      expect(await advances(page)).toBe(true);
      expect(errors).toEqual([]);
    });

    test("SDK_ERROR at init: the game still boots and runs", async ({ page }) => {
      const errors = await boot(page, engine, "mock", { boot: "error" });
      expect(await page.evaluate(() => window.__gdEvents)).toContain("SDK_ERROR");
      expect(await advances(page)).toBe(true);
      expect(errors).toEqual([]);
    });

    test("SDK_READY never comes: the game boots after the init deadline", async ({ page }) => {
      const started = Date.now();
      const errors = await boot(page, engine, "mock", { boot: "never" });
      expect(Date.now() - started).toBeGreaterThanOrEqual(4_000);
      expect(await advances(page)).toBe(true);
      expect(errors).toEqual([]);
    });

    test("SDK_READY late: the game boots first, the SDK is taken up when it arrives", async ({
      page,
    }) => {
      const errors = await boot(page, engine, "mock", { boot: "late", lateMs: 6_000 });
      await expect
        .poll(() => page.evaluate(() => window.__gdCalls ?? []), { timeout: 10_000 })
        .toEqual(["preloadAd:rewarded"]);
      expect(await page.evaluate(() => window.__gdViolations)).toEqual([]);
      expect(await advances(page)).toBe(true);
      expect(errors).toEqual([]);
    });

    test("local development: top level, no gd_sdk_referrer_url, nothing invented", async ({
      page,
    }) => {
      await boot(page, engine);
      expect(await page.evaluate(() => window.__gdContext)).toEqual({ search: "", framed: false });
    });

    test("self-hosted: the wrapper frames the game with the embedding page's URL", async ({
      page,
      baseURL,
    }) => {
      // The game "lives" at an https origin, as game.config.yaml requires, served from the
      // local build; the wrapper is embedded by a publisher page on another origin.
      const gameUrl = `https://gd-selfhost.test/${engine}-gamedistribution/`;
      await serveSdk(page, "mock");
      await page.route("https://gd-selfhost.test/**", async (route) => {
        const local = route.request().url().replace("https://gd-selfhost.test", baseURL!);
        await route.fulfill({ response: await route.fetch({ url: local }) });
      });
      await page.route("https://gd-wrapper.test/index.html", (route) =>
        route.fulfill({ contentType: "text/html", body: wrapperHtml(gameUrl) }),
      );
      await page.route("https://publisher.test/play", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: '<iframe id="w" src="https://gd-wrapper.test/index.html" style="width:800px;height:600px"></iframe>',
        }),
      );

      await page.goto("https://publisher.test/play");
      const isGame = (f: Frame): boolean => f.url().startsWith("https://gd-selfhost.test/");
      await expect.poll(() => page.frames().some(isGame)).toBe(true);
      const game = page.frames().find(isGame)!;
      await expect
        .poll(() => game.evaluate(() => document.getElementById("hud")?.dataset["ready"] ?? ""), {
          timeout: 20_000,
        })
        .toBe("true");

      const context = await game.evaluate(() => window.__gdContext!);
      expect(context.framed).toBe(true);
      const referrer = new URLSearchParams(context.search).get("gd_sdk_referrer_url");
      // Cross-origin, Chromium's default referrer policy sends the origin: the publisher's.
      expect(referrer).toMatch(/^https:\/\/publisher\.test\//);
      expect(await game.evaluate(() => window.__gdViolations)).toEqual([]);
      expect(await advances(game)).toBe(true);
    });
  });
}
