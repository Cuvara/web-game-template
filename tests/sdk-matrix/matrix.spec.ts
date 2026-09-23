// The realistic SDK test: a PixiJS game and a Three.js game, each booted on every portal
// adapter in a real browser — real renderer, real game loop, real bindPlatform — with only
// the portal SDK mocked. Also each adapter with its SDK missing and failing to initialize.
//
// What it cannot show is how a real portal reacts; docs/sdk.md lists what still needs the
// portal's own QA tool or draft upload.

import { expect, test, type Page } from "@playwright/test";

const ENGINES = ["pixijs", "threejs"] as const;
const PORTALS = ["yandex", "crazygames", "poki", "gamevui"] as const;

interface MatrixState {
  paused: boolean;
  gameplayActive: boolean;
  audioMuted: boolean;
  foreground: boolean;
  rewardedAvailability: string;
}

async function boot(page: Page, query: string): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Nothing may leave the page: every portal SDK is mocked in-process.
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname !== "localhost") errors.push(`external request: ${request.url()}`);
  });
  await page.goto(`/?${query}`);
  await expect(page.locator("#hud")).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
  return errors;
}

const state = (page: Page): Promise<MatrixState> =>
  page.evaluate(() =>
    (window as unknown as { __matrix: { state(): MatrixState } }).__matrix.state(),
  );
const calls = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __matrix: { calls(): string[] } }).__matrix.calls());
const steps = async (page: Page): Promise<number> =>
  Number(await page.locator("#hud").getAttribute("data-steps"));
const run = <T>(page: Page, method: string, arg?: unknown): Promise<T> =>
  page.evaluate(
    ([m, a]) =>
      (window as unknown as { __matrix: Record<string, (x?: unknown) => T> }).__matrix[
        m as string
      ]!(a),
    [method, arg] as const,
  );

async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((h) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (h ? "hidden" : "visible"),
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

for (const engine of ENGINES) {
  for (const portal of PORTALS) {
    test.describe(`${engine} × ${portal}`, () => {
      test("boots, renders, starts gameplay on first input, and runs an ad break", async ({
        page,
      }) => {
        const errors = await boot(page, `engine=${engine}&portal=${portal}`);
        const hasSdk = portal !== "gamevui";

        await expect(page.locator("#hud")).toHaveAttribute("data-engine", engine);
        await expect(page.locator("#game canvas")).toBeVisible();
        await expect.poll(() => steps(page), { timeout: 5_000 }).toBeGreaterThan(0);

        // Loading reported, gameplay not yet: it waits for the player.
        expect(await calls(page)).toEqual(hasSdk ? expect.arrayContaining(["init", "ready"]) : []);
        expect(await calls(page)).not.toContain("gameplayStart");

        await page.locator("#game canvas").click({ position: { x: 40, y: 40 } });
        await expect.poll(async () => (await state(page)).gameplayActive).toBe(true);
        expect((await calls(page)).filter((c) => c === "gameplayStart")).toHaveLength(
          hasSdk ? 1 : 0,
        );

        const interstitial = await run<{ shown: boolean }>(page, "interstitial");
        expect(interstitial.shown).toBe(hasSdk);
        await expect(page.locator("#hud")).toHaveAttribute("data-break-muted", "false");
        const after = await state(page);
        expect(after.paused).toBe(false);
        expect(after.gameplayActive).toBe(true);

        const rewarded = await run<{ rewarded: boolean }>(page, "rewarded");
        expect(rewarded.rewarded).toBe(hasSdk);

        // The loop is still stepping after the breaks.
        const before = await steps(page);
        await expect.poll(() => steps(page)).toBeGreaterThan(before);

        expect(await run<string | null>(page, "save", "best")).toBe("42");
        expect(errors).toEqual([]);
      });

      test("pauses on a hidden tab and resumes on return", async ({ page }) => {
        await boot(page, `engine=${engine}&portal=${portal}`);
        await page.locator("#game canvas").click({ position: { x: 40, y: 40 } });
        await setHidden(page, true);
        const hidden = await state(page);
        expect(hidden.paused).toBe(true);
        expect(hidden.audioMuted).toBe(true);
        const frozen = await steps(page);
        await page.waitForTimeout(300);
        expect(await steps(page)).toBe(frozen);
        await setHidden(page, false);
        expect((await state(page)).paused).toBe(false);
        await expect.poll(() => steps(page)).toBeGreaterThan(frozen);
      });

      test("never rewards a closed ad, and survives no fill", async ({ page }) => {
        await boot(page, `engine=${engine}&portal=${portal}&ad=closed-early`);
        expect((await run<{ rewarded: boolean }>(page, "rewarded")).rewarded).toBe(false);
        await run(page, "setAd", "no-fill");
        const result = await run<{ shown: boolean; rewarded: boolean }>(page, "rewarded");
        expect(result).toMatchObject({ shown: false, rewarded: false });
        expect((await state(page)).paused).toBe(false);
      });
    });
  }
}

for (const portal of PORTALS.filter((p) => p !== "gamevui")) {
  for (const sdk of ["missing", "init-fails"] as const) {
    test(`pixijs × ${portal} with the SDK ${sdk}: plays on, offers no ads`, async ({ page }) => {
      const errors = await boot(page, `engine=pixijs&portal=${portal}&sdk=${sdk}`);
      await expect.poll(() => steps(page)).toBeGreaterThan(0);
      expect((await state(page)).rewardedAvailability).not.toBe("available");
      expect((await run<{ rewarded: boolean }>(page, "rewarded")).rewarded).toBe(false);
      expect(await run<string | null>(page, "save", "best")).toBe("42");
      expect(errors).toEqual([]);
    });
  }
}

test("yandex: the portal's own pause holds the game and its sound (4.7)", async ({ page }) => {
  await boot(page, "engine=threejs&portal=yandex");
  await run(page, "portalPause");
  expect(await state(page)).toMatchObject({ paused: true, audioMuted: true, foreground: false });
  await run(page, "portalResume");
  expect(await state(page)).toMatchObject({ paused: false, audioMuted: false, foreground: true });
});

test("crazygames: the portal's muteAudio setting wins", async ({ page }) => {
  await boot(page, "engine=pixijs&portal=crazygames");
  await run(page, "setPortalMute", true);
  await expect(page.locator("#hud")).toHaveAttribute("data-audio-muted", "true");
  await run(page, "setPortalMute", false);
  await expect(page.locator("#hud")).toHaveAttribute("data-audio-muted", "false");
});
