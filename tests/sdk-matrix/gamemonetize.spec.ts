// GameMonetize × PixiJS and Three.js in Chromium, through the adapter's real script loader.
//
// The page (gamemonetize.html) requests https://api.gamemonetize.com/sdk.js exactly as a
// production build does; this spec answers with the deterministic mock
// (tests/gamemonetize/mock-sdk.ts) or blocks it. Nothing reaches GameMonetize.
//
// A mock pass is not a live pass: docs/platforms/gamemonetize.md says what still needs the
// portal's own "Verify Game".

import { expect, test, type Page } from "@playwright/test";
import { MOCK_SDK_SOURCE } from "../gamemonetize/mock-sdk.js";

const SDK_URL = "https://api.gamemonetize.com/sdk.js";
// Shaped like a Game ID; never a real one.
const GAME_ID = "matrix0000000000000000000000000";
const ENGINES = ["pixijs", "threejs"] as const;

interface GmState {
  sdkState: string;
  configProblem: string | null;
  paused: boolean;
  gameplayActive: boolean;
  audioMuted: boolean;
  foreground: boolean;
  interstitial: string;
  rewarded: string;
  usage: { adsRequested: Record<string, number>; adsShown: Record<string, number> };
}

interface Boot {
  errors: string[];
  /** Every non-local request the page made. */
  external: string[];
}

interface MockConfig {
  sdk?: "ready" | "delayed" | "init-error" | "silent";
  ad?: string;
  readyDelayMs?: number;
  lateMs?: number;
  adMs?: number;
}

async function boot(page: Page, query: string, mock: MockConfig | "block" = {}): Promise<Boot> {
  const result: Boot = { errors: [], external: [] };
  page.on("pageerror", (error) => result.errors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).hostname !== "localhost") result.external.push(request.url());
  });
  if (mock !== "block") {
    await page.addInitScript((config) => {
      (window as unknown as { __gmMock: unknown }).__gmMock = config;
    }, mock);
  }
  await page.route(SDK_URL, (route) =>
    mock === "block"
      ? route.abort()
      : route.fulfill({ contentType: "text/javascript", body: MOCK_SDK_SOURCE }),
  );
  await page.goto(`/gamemonetize.html?${query}`);
  await expect(page.locator("#hud")).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
  return result;
}

const gm = <T>(page: Page, method: string): Promise<T> =>
  page.evaluate((m) => (window as unknown as { __gm: Record<string, () => T> }).__gm[m]!(), method);
const state = (page: Page): Promise<GmState> => gm<GmState>(page, "state");
const events = (page: Page): Promise<string[]> => gm<string[]>(page, "events");
const mockCalls = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __gmCalls?: string[] }).__gmCalls ?? []);
const emit = (page: Page, name: string): Promise<void> =>
  page.evaluate((n) => (window as unknown as { __gmEmit(n: string): void }).__gmEmit(n), name);
const steps = async (page: Page): Promise<number> =>
  Number(await page.locator("#hud").getAttribute("data-steps"));

async function advances(page: Page): Promise<boolean> {
  const before = await steps(page);
  await page.waitForTimeout(300);
  return (await steps(page)) > before;
}

const AD_PAIR = ["foreground:lost", "ad:start", "ad:end", "foreground:gained"];

for (const engine of ENGINES) {
  test.describe(`${engine} × gamemonetize`, () => {
    test("initializes through the documented SDK_OPTIONS and plays an interstitial", async ({
      page,
    }) => {
      // A 1.5s ad, long enough to observe the game held while it plays.
      const { errors, external } = await boot(page, `engine=${engine}&gameId=${GAME_ID}`, {
        adMs: 1_500,
      });
      await expect(page.locator("#game canvas")).toBeVisible();
      expect(
        await page.evaluate(() => (window as unknown as { SDK_OPTIONS: unknown }).SDK_OPTIONS),
      ).toMatchObject({ gameId: GAME_ID, advertisementSettings: { autoplay: false } });
      expect(
        await page.evaluate(() => document.querySelectorAll("script#gamemonetize-sdk").length),
      ).toBe(1);
      expect(await state(page)).toMatchObject({
        sdkState: "ready",
        interstitial: "available",
        rewarded: "unsupported",
      });
      expect(await mockCalls(page)).toEqual(["load:gameId"]);

      await page.locator("#game canvas").click({ position: { x: 40, y: 40 } });
      await expect.poll(async () => (await state(page)).gameplayActive).toBe(true);

      const pending = gm<{ shown: boolean }>(page, "interstitial");
      // While the ad plays the game is held and silent.
      await expect.poll(async () => (await state(page)).foreground).toBe(false);
      expect(await state(page)).toMatchObject({ paused: true, audioMuted: true });
      expect(await advances(page)).toBe(false);
      expect(await pending).toEqual({ shown: true });

      expect(await events(page)).toEqual(AD_PAIR);
      expect(await state(page)).toMatchObject({
        paused: false,
        audioMuted: false,
        foreground: true,
        gameplayActive: true,
      });
      expect(await advances(page)).toBe(true);
      expect(external).toEqual([SDK_URL]);
      expect(errors).toEqual([]);
    });

    test("rewarded is unsupported: refused without calling the SDK, never rewards", async ({
      page,
    }) => {
      await boot(page, `engine=${engine}&gameId=${GAME_ID}`);
      expect(await gm(page, "rewarded")).toEqual({
        shown: false,
        rewarded: false,
        reason: "unsupported",
      });
      expect(await mockCalls(page)).not.toContain("showBanner");
      expect((await state(page)).paused).toBe(false);
    });

    test("the SDK's own pause holds and mutes the game until SDK_GAME_START", async ({ page }) => {
      await boot(page, `engine=${engine}&gameId=${GAME_ID}`);
      await emit(page, "SDK_GAME_PAUSE");
      await emit(page, "SDK_GAME_PAUSE");
      expect(await state(page)).toMatchObject({
        paused: true,
        audioMuted: true,
        foreground: false,
      });
      expect(await advances(page)).toBe(false);
      await emit(page, "SDK_GAME_START");
      await emit(page, "SDK_GAME_START");
      expect(await state(page)).toMatchObject({
        paused: false,
        audioMuted: false,
        foreground: true,
      });
      expect(await events(page)).toEqual(["foreground:lost", "foreground:gained"]);
      expect(await advances(page)).toBe(true);
    });

    test("pause without resume: the game comes back after the ad deadline", async ({ page }) => {
      await boot(page, `engine=${engine}&gameId=${GAME_ID}&adMs=1500`);
      await emit(page, "SDK_GAME_PAUSE");
      expect((await state(page)).paused).toBe(true);
      await expect.poll(async () => (await state(page)).paused, { timeout: 5_000 }).toBe(false);
      expect(await advances(page)).toBe(true);
    });
  });
}

test.describe("gamemonetize ad errors and callbacks (pixijs)", () => {
  const Q = `engine=pixijs&gameId=${GAME_ID}`;

  test("ad error: resolves unshown and the game resumes unmuted", async ({ page }) => {
    await boot(page, Q, { ad: "error" });
    expect(await gm(page, "interstitial")).toEqual({ shown: false, reason: "error" });
    expect(await events(page)).toEqual([]);
    expect(await state(page)).toMatchObject({ paused: false, audioMuted: false });
    expect(await advances(page)).toBe(true);
  });

  test("ad unavailable (SDK_GAME_START without a pause): unshown, nothing muted", async ({
    page,
  }) => {
    await boot(page, Q, { ad: "no-fill" });
    expect(await gm(page, "interstitial")).toEqual({ shown: false, reason: "not-ready" });
    expect(await state(page)).toMatchObject({ paused: false, audioMuted: false });
  });

  test("showBanner throws: resolves as error, no page error", async ({ page }) => {
    const { errors } = await boot(page, Q, { ad: "throw" });
    expect(await gm(page, "interstitial")).toEqual({ shown: false, reason: "error" });
    expect((await state(page)).paused).toBe(false);
    expect(errors).toEqual([]);
  });

  test("duplicate callbacks: one result, one ad bracket", async ({ page }) => {
    await boot(page, Q, { ad: "duplicate" });
    expect(await gm(page, "interstitial")).toEqual({ shown: true });
    await page.waitForTimeout(200);
    expect(await events(page)).toEqual(AD_PAIR);
    expect((await state(page)).usage.adsShown["interstitial"]).toBe(1);
  });

  test("callback never arrives: the request gives up and the game resumes", async ({ page }) => {
    await boot(page, `${Q}&startMs=800`, { ad: "silent" });
    expect(await gm(page, "interstitial")).toEqual({ shown: false, reason: "not-ready" });
    expect(await state(page)).toMatchObject({ paused: false, audioMuted: false });
  });

  test("SDK_GAME_START lost mid-ad: the break ends at the deadline", async ({ page }) => {
    await boot(page, `${Q}&adMs=1000`, { ad: "stall" });
    expect(await gm(page, "interstitial")).toEqual({ shown: true });
    expect(await events(page)).toEqual(AD_PAIR);
    expect(await state(page)).toMatchObject({ paused: false, audioMuted: false, foreground: true });
  });

  test("late ad: the request gave up, the ad still holds the game when it opens", async ({
    page,
  }) => {
    await boot(page, `${Q}&startMs=500`, { ad: "late", lateMs: 1_000, adMs: 1_500 });
    expect(await gm(page, "interstitial")).toEqual({ shown: false, reason: "not-ready" });
    await expect.poll(async () => (await state(page)).foreground).toBe(false);
    expect(await state(page)).toMatchObject({ paused: true, audioMuted: true });
    await expect.poll(async () => (await state(page)).foreground).toBe(true);
    expect(await state(page)).toMatchObject({ paused: false, audioMuted: false });
    expect(await events(page)).toEqual(["foreground:lost", "foreground:gained"]);
  });

  test("repeated requests: a concurrent second one is busy, sequential ones all play", async ({
    page,
  }) => {
    await boot(page, Q);
    expect(await gm(page, "interstitialTwice")).toEqual([
      { shown: true },
      { shown: false, reason: "busy" },
    ]);
    for (let i = 0; i < 3; i += 1) expect(await gm(page, "interstitial")).toEqual({ shown: true });
    expect((await mockCalls(page)).filter((c) => c === "showBanner")).toHaveLength(4);
    expect((await state(page)).paused).toBe(false);
  });
});

test.describe("gamemonetize SDK conditions (pixijs)", () => {
  test("SDK blocked: boots and plays without ads", async ({ page }) => {
    const { errors } = await boot(page, `engine=pixijs&gameId=${GAME_ID}`, "block");
    expect(await state(page)).toMatchObject({ sdkState: "unavailable", interstitial: "disabled" });
    expect(await gm(page, "interstitial")).toEqual({ shown: false, reason: "not-ready" });
    expect(await advances(page)).toBe(true);
    expect(errors).toEqual([]);
  });

  test("missing Game ID: the SDK is never requested, the game plays", async ({ page }) => {
    const { external } = await boot(page, "engine=pixijs&gameId=none");
    expect(await state(page)).toMatchObject({
      sdkState: "not-configured",
      configProblem: "missing",
      interstitial: "disabled",
    });
    expect(external).toEqual([]);
    expect(await gm(page, "interstitial")).toEqual({ shown: false, reason: "not-ready" });
    expect(await advances(page)).toBe(true);
  });

  test("malformed Game ID: refused before any request", async ({ page }) => {
    const { external } = await boot(page, "engine=pixijs&gameId=your_game_id_here");
    expect((await state(page)).configProblem).toBe("the documented placeholder");
    expect(external).toEqual([]);
  });

  test("SDK_ERROR at init: plays on, ads refused as error", async ({ page }) => {
    await boot(page, `engine=pixijs&gameId=${GAME_ID}`, { sdk: "init-error" });
    expect(await state(page)).toMatchObject({ sdkState: "error", interstitial: "disabled" });
    expect(await gm(page, "interstitial")).toEqual({ shown: false, reason: "error" });
    expect(await advances(page)).toBe(true);
  });

  test("delayed SDK: boots at the deadline, ads work once SDK_READY arrives", async ({ page }) => {
    await boot(page, `engine=pixijs&gameId=${GAME_ID}&initMs=300`, {
      sdk: "delayed",
      readyDelayMs: 1_500,
    });
    expect((await state(page)).sdkState).toBe("unavailable");
    expect(await advances(page)).toBe(true);
    await expect.poll(async () => (await state(page)).sdkState).toBe("ready");
    expect(await gm(page, "interstitial")).toEqual({ shown: true });
  });

  test("SDK that never becomes ready: boots at the deadline", async ({ page }) => {
    await boot(page, `engine=pixijs&gameId=${GAME_ID}&initMs=300`, { sdk: "silent" });
    expect((await state(page)).sdkState).toBe("unavailable");
    expect(await advances(page)).toBe(true);
  });
});
