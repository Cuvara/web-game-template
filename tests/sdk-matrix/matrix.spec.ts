// The SDK matrix: every platform adapter, under both engines, in a real browser.
//
// tests/sdk/ proves the adapters against scripted fakes; this proves the built bundles.
// Each (engine, platform) build of examples/sdk-matrix boots against its portal's mock
// SDK - the same stand-ins the portal compliance suites use - and is played: first input,
// an interstitial, a rewarded ad in each outcome, the portal's own pause, a save across a
// reload, and a portal SDK that never arrives. Mocks are an independent referee, not a
// portal: passing here says the integration follows the documented contract, not that a
// portal has accepted the game.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const ROOT = resolve(import.meta.dirname, "../..");
const YANDEX_MOCK = readFileSync(
  resolve(ROOT, "examples/yandex-compliance-demo/tests/e2e/mock-sdk.js"),
  "utf8",
);
const POKI_MOCK = readFileSync(resolve(ROOT, "tests/poki/mock-poki-sdk.js"), "utf8");
const POKI_SDK_URL = "https://game-cdn.poki.com/scripts/v2/poki-sdk.js";

const ENGINES = ["pixijs", "threejs"] as const;
const PLATFORMS = ["generic-web", "yandex", "poki", "gamevui"] as const;
type PlatformId = (typeof PLATFORMS)[number];

interface Session {
  readonly external: string[];
  readonly errors: string[];
}

interface Options {
  /** window.__ysdkMockConfig / window.__pokiMock for this page. */
  readonly mock?: Record<string, unknown>;
  /** Abort the portal's SDK script, as an ad blocker does. */
  readonly blockSdk?: boolean;
}

async function open(page: Page, build: string, platform: PlatformId, options: Options = {}) {
  const session: Session = { external: [], errors: [] };
  page.on("pageerror", (error) => session.errors.push(error.message));
  if (options.mock) {
    const key = platform === "poki" ? "__pokiMock" : "__ysdkMockConfig";
    await page.addInitScript(
      ([name, value]) => Object.assign(window, { [name as string]: value }),
      [key, options.mock] as const,
    );
  }
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (url === POKI_SDK_URL) {
      if (platform !== "poki") session.external.push(url);
      if (options.blockSdk || platform !== "poki") return route.abort();
      return route.fulfill({ contentType: "text/javascript", body: POKI_MOCK });
    }
    if (url.startsWith("http://localhost")) {
      if (new URL(url).pathname === "/sdk.js") {
        if (platform !== "yandex") session.external.push(url);
        if (options.blockSdk || platform !== "yandex") return route.abort();
        return route.fulfill({ contentType: "text/javascript", body: YANDEX_MOCK });
      }
      return route.continue();
    }
    session.external.push(url);
    return route.abort();
  });
  await page.goto(`/${build}/`);
  await expect(page.locator("#hud")).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
  return session;
}

const hud = (page: Page) => page.locator("#hud");
const lastAd = async (page: Page) =>
  JSON.parse((await hud(page).getAttribute("data-last-ad")) ?? "null") as {
    shown: boolean;
    rewarded?: boolean;
    reason?: string;
  } | null;

async function tapToPlay(page: Page): Promise<void> {
  await page.locator("#game").click({ position: { x: 20, y: 20 } });
  await expect(hud(page)).toHaveAttribute("data-gameplay", "true");
}

async function clickAd(page: Page, id: "interstitial" | "rewarded") {
  const before = await hud(page).getAttribute("data-last-ad");
  await page.locator(`#${id}`).click();
  await expect
    .poll(
      async () => {
        const now = await hud(page).getAttribute("data-last-ad");
        return now !== null && now !== before;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return lastAd(page);
}

const hasAds = (platform: PlatformId): boolean => platform === "yandex" || platform === "poki";

for (const engine of ENGINES) {
  for (const platform of PLATFORMS) {
    const build = `${engine}-${platform}`;

    test.describe(build, () => {
      test("boots, steps, reports gameplay on first input, and loads only its own portal", async ({
        page,
      }) => {
        const session = await open(page, build, platform);
        await expect(hud(page)).toHaveAttribute("data-platform", platform);
        await expect(hud(page)).toHaveAttribute("data-engine", engine);
        await expect(page.locator("#game canvas")).toBeVisible();
        const steps = Number(await hud(page).getAttribute("data-steps"));
        await expect
          .poll(async () => Number(await hud(page).getAttribute("data-steps")))
          .toBeGreaterThan(steps);
        await expect(hud(page)).toHaveAttribute("data-gameplay", "false");
        await tapToPlay(page);

        const usage = await page.evaluate(() => window.__wgf__!.usage());
        expect(usage.signalReadyCalls).toBeGreaterThan(0);
        if (platform === "gamevui") await expect(hud(page)).toHaveAttribute("data-locale", "vi");
        if (platform === "yandex") {
          const calls = await page.evaluate(() =>
            (window as unknown as { __ysdk: { calls: { name: string }[] } }).__ysdk.calls.map(
              (c) => c.name,
            ),
          );
          expect(calls).toContain("LoadingAPI.ready");
          expect(calls).toContain("GameplayAPI.start");
        }
        if (platform === "poki") {
          const calls = await page.evaluate(
            () => (window as unknown as { __pokiCalls: string[] }).__pokiCalls,
          );
          expect(calls.slice(0, 3)).toEqual(["init", "gameLoadingFinished", "gameplayStart"]);
        }
        expect(session.external).toEqual([]);
        expect(session.errors).toEqual([]);
      });

      test("keeps a save across a reload", async ({ page }) => {
        await open(page, build, platform);
        await page.locator("#save").click();
        await expect(hud(page)).toHaveAttribute("data-saved", "0");
        await page.reload();
        await expect(hud(page)).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
        await expect(hud(page)).toHaveAttribute("data-loaded", "0");
      });

      test("survives its portal's SDK never arriving", async ({ page }) => {
        const session = await open(page, build, platform, { blockSdk: true });
        await tapToPlay(page);
        const result = await clickAd(page, "rewarded");
        expect(result).toMatchObject({ shown: false, rewarded: false });
        await expect(hud(page)).toHaveAttribute("data-rewards", "0");
        await expect(hud(page)).toHaveAttribute("data-paused", "false");
        expect(session.errors).toEqual([]);
      });

      if (!hasAds(platform)) {
        test("offers no ads and says so", async ({ page }) => {
          await open(page, build, platform);
          await tapToPlay(page);
          expect(await clickAd(page, "interstitial")).toEqual({
            shown: false,
            reason: "unsupported",
          });
          expect(await clickAd(page, "rewarded")).toEqual({
            shown: false,
            rewarded: false,
            reason: "unsupported",
          });
          await expect(hud(page)).toHaveAttribute("data-gameplay", "true");
        });
        return;
      }

      const outcomes =
        platform === "yandex"
          ? {
              reward: { rewarded: "complete" },
              closed: { rewarded: "skip" },
              error: { rewarded: "error" },
            }
          : {
              reward: { rewarded: "reward" },
              closed: { rewarded: "no-reward" },
              error: { rewarded: "error" },
            };

      test("grants a reward only when the ad was watched to the end", async ({ page }) => {
        const session = await open(page, build, platform, {
          mock: { ...outcomes.reward, adMs: 200 },
        });
        await tapToPlay(page);
        expect(await clickAd(page, "rewarded")).toEqual({ shown: true, rewarded: true });
        await expect(hud(page)).toHaveAttribute("data-rewards", "1");
        await expect(hud(page)).toHaveAttribute("data-score", "10");
        // Back in gameplay, unpaused, foreground returned.
        await expect(hud(page)).toHaveAttribute("data-paused", "false");
        await expect(hud(page)).toHaveAttribute("data-foreground", "true");
        await expect(hud(page)).toHaveAttribute("data-gameplay", "true");
        // The reward survives a reload once saved.
        await page.locator("#save").click();
        await expect(hud(page)).toHaveAttribute("data-saved", "10");
        await page.reload();
        await expect(hud(page)).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
        await expect(hud(page)).toHaveAttribute("data-loaded", "10");
        if (platform === "poki") {
          expect(
            await page.evaluate(
              () => (window as unknown as { __pokiViolations: string[] }).__pokiViolations,
            ),
          ).toEqual([]);
        }
        expect(session.external).toEqual([]);
        expect(session.errors).toEqual([]);
      });

      test("grants nothing when the player closes the ad early", async ({ page }) => {
        await open(page, build, platform, { mock: { ...outcomes.closed, adMs: 200 } });
        await tapToPlay(page);
        const result = await clickAd(page, "rewarded");
        expect(result?.rewarded).toBe(false);
        await expect(hud(page)).toHaveAttribute("data-rewards", "0");
        await expect(hud(page)).toHaveAttribute("data-paused", "false");
      });

      test("grants nothing and keeps playing when the ad fails", async ({ page }) => {
        const session = await open(page, build, platform, {
          mock: { ...outcomes.error, adMs: 200 },
        });
        await tapToPlay(page);
        const result = await clickAd(page, "rewarded");
        expect(result).toMatchObject({ rewarded: false });
        await expect(hud(page)).toHaveAttribute("data-rewards", "0");
        await expect(hud(page)).toHaveAttribute("data-gameplay", "true");
        expect(session.errors).toEqual([]);
      });

      test("pauses for an interstitial and comes back", async ({ page }) => {
        await open(page, build, platform, { mock: { adMs: 400 } });
        await tapToPlay(page);
        await page.locator("#interstitial").click();
        await expect(hud(page)).toHaveAttribute("data-paused", "true");
        await expect.poll(() => lastAd(page), { timeout: 15_000 }).not.toBeNull();
        await expect(hud(page)).toHaveAttribute("data-paused", "false");
        await expect(hud(page)).toHaveAttribute("data-gameplay", "true");
      });

      if (platform === "yandex") {
        test("pauses while the portal holds the foreground (game_api_pause / resume)", async ({
          page,
        }) => {
          await open(page, build, platform);
          await tapToPlay(page);
          const fire = (event: string) =>
            page.evaluate(
              (name) =>
                (window as unknown as { __ysdk: { fire(e: string): void } }).__ysdk.fire(name),
              event,
            );
          await fire("game_api_pause");
          await expect(hud(page)).toHaveAttribute("data-paused", "true");
          await expect(hud(page)).toHaveAttribute("data-foreground", "false");
          await fire("game_api_resume");
          await expect(hud(page)).toHaveAttribute("data-paused", "false");
        });

        test("starts paused under a launch ad, and plays once it ends", async ({ page }) => {
          await page.addInitScript(() =>
            Object.assign(window, { __ysdkMockConfig: { launchAdMs: 1500 } }),
          );
          await open(page, build, platform);
          await expect(hud(page)).toHaveAttribute("data-foreground", "true", { timeout: 10_000 });
          await expect(hud(page)).toHaveAttribute("data-paused", "false");
        });
      }
    });
  }
}
