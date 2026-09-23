// Shared setup for the CrazyGames browser suite.
//
// Every test runs the BUILT demo from `vite preview`, with sdk.crazygames.com answered by
// the mock unless CG_LIVE_SDK=1. Every request the page makes is recorded, and a test fails
// on any uncaught page error — a reviewer's console is part of the review.

import { test as base, expect, type Page } from "@playwright/test";
import { MOCK_SDK_SOURCE } from "./mock-sdk.js";

export const SDK_URL = "https://sdk.crazygames.com/crazygames-sdk-v3.js";
export const LIVE_SDK = process.env["CG_LIVE_SDK"] === "1";

export interface DemoSnapshot {
  phase: "loading" | "playing" | "level-complete" | "ad";
  paused: boolean;
  elapsedMs: number;
  framesRendered: number;
  muted: boolean;
  gain: number;
  level: number;
  coins: number;
  caught: number;
  goal: number;
  paddleX: number;
  nextOrbX: number | null;
  lastSaveOk: boolean | null;
  rewardedAvailability: string;
  platformId: string;
  sdkMode: string | null;
  launchStage: string | null;
  usage: { gameplayStartCalls: number; gameplayStopCalls: number };
}

export interface SdkCall {
  name: string;
  t: number;
}

interface Fixtures {
  requests: string[];
  pageErrors: string[];
}

export const test = base.extend<Fixtures>({
  requests: async ({ page }, use) => {
    const seen: string[] = [];
    page.on("request", (request) => seen.push(request.url()));
    await use(seen);
  },
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await use(errors);
      expect(errors, "uncaught page errors").toEqual([]);
    },
    { auto: true },
  ],
  page: async ({ page }, use) => {
    if (!LIVE_SDK) {
      await page.route(SDK_URL, (route) =>
        route.fulfill({ contentType: "text/javascript", body: MOCK_SDK_SOURCE }),
      );
    }
    await use(page);
  },
});

export { expect };

export async function boot(page: Page, query = ""): Promise<void> {
  await page.goto(`/${query ? `?${query}` : ""}`);
  // The server must be serving THIS demo, not whatever else is on the port.
  await expect(page).toHaveTitle(/Orb Catcher/);
  await expect(page.locator("#hud")).toHaveAttribute("data-phase", "playing", {
    timeout: 20_000,
  });
}

export function snapshot(page: Page): Promise<DemoSnapshot> {
  return page.evaluate(() => {
    const probe = (window as unknown as { __cgdemo__?: { snapshot(): unknown } }).__cgdemo__;
    if (!probe) throw new Error("demo probe not installed");
    return probe.snapshot() as DemoSnapshot;
  });
}

export function sdkCalls(page: Page): Promise<SdkCall[]> {
  return page.evaluate(() => (window as unknown as { __cgCalls__?: SdkCall[] }).__cgCalls__ ?? []);
}

export async function callNames(page: Page): Promise<string[]> {
  return (await sdkCalls(page)).map((call) => call.name);
}

/** Seed the mock's cloud save before the page boots. */
export async function seedSave(
  page: Page,
  progress: { level: number; coins: number; levelsSinceOffer: number },
): Promise<void> {
  await page.addInitScript((value) => {
    if (sessionStorage.getItem("__seeded__")) return;
    sessionStorage.setItem("__seeded__", "1");
    localStorage.setItem(
      "__cgmock_data__",
      JSON.stringify({ "orb-catcher.progress": JSON.stringify({ version: 1, ...value }) }),
    );
  }, progress);
}

/**
 * Actually play: steer the paddle under the lowest orb until the level completes. Uses the
 * mouse on desktop and taps on touch devices — the real input paths, not a test hook.
 */
export async function playLevel(page: Page, { touch = false } = {}): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const deadline = Date.now() + 60_000;
  for (;;) {
    const state = await snapshot(page);
    if (state.phase === "level-complete") return;
    if (Date.now() > deadline) throw new Error(`level not completed: ${JSON.stringify(state)}`);
    if (state.nextOrbX !== null) {
      const x = Math.round(state.nextOrbX * viewport.width);
      // Near the paddle, below where the level-complete panel appears, so a tap racing the
      // end of the level cannot land on one of its buttons.
      const y = Math.round(viewport.height * 0.96);
      if (touch) await page.touchscreen.tap(x, y);
      else await page.mouse.move(x, y);
    }
    await page.waitForTimeout(60);
  }
}

/** A player past the point where midgame ads begin (level 3), with the offer counter set. */
export const PAST_EARLY_LEVELS = { level: 3, coins: 30, levelsSinceOffer: 0 } as const;

/** Complete the current level, press Next, and wait until the next level is live. */
export async function nextLevel(page: Page, touch: boolean): Promise<void> {
  await playLevel(page, { touch });
  await expectCompletePanel(page);
  await page.locator("#btn-next").click();
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 10_000 }).toBe("playing");
}

export async function expectCompletePanel(page: Page): Promise<void> {
  await expect(page.locator("#complete")).toBeVisible();
  // The panel ignores input briefly after appearing (main.ts PANEL_INPUT_GUARD_MS).
  await expect(page.locator("#complete")).not.toHaveAttribute("inert");
  await expect(page.locator("#btn-next")).toBeEnabled();
}
