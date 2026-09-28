// Pause and resume against the built bundle, for whichever engine it was built for.
//
// Every platform profile requires the game to actually stop during an ad break — Yandex
// lists audio and input leaking through one as a rejection cause — and `bindPlatform`
// implements that by pausing on a hidden tab. This drives the same path the portal does.
//
// It matters more once an engine ships a loop of its own: `@wgf/phaser-framework` stops
// Phaser's TimeStep at boot so that the simulation and the drawing have one clock, and a
// renderer that kept its own would keep stepping here while the game is paused.

import { expect, test, type Page } from "@playwright/test";

/** Replaces document.visibilityState and fires the event the binding listens for. */
async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((isHidden) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (isHidden ? "hidden" : "visible"),
    });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => isHidden });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

test("stops the simulation while the tab is hidden, and resumes with it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  const hud = page.locator("#hud");
  await expect(hud).toHaveAttribute("data-ready", "true", { timeout: 15_000 });

  const steps = async (): Promise<number> => Number(await hud.getAttribute("data-steps"));
  const frames = async (): Promise<number> =>
    page.evaluate(() => window.__wgf__?.framesRendered() ?? -1);

  await expect.poll(steps, { timeout: 5_000 }).toBeGreaterThan(0);

  await setHidden(page, true);
  // One frame's grace: the pause takes effect on the next scheduled frame, not inside the
  // event handler.
  await page.waitForTimeout(100);
  const stepsWhenHidden = await steps();
  const framesWhenHidden = await frames();

  await page.waitForTimeout(500);
  expect(await steps()).toBe(stepsWhenHidden);
  expect(await frames()).toBe(framesWhenHidden);

  await setHidden(page, false);
  await expect.poll(steps, { timeout: 5_000 }).toBeGreaterThan(stepsWhenHidden);
  expect(await frames()).toBeGreaterThan(framesWhenHidden);

  expect(errors).toEqual([]);
});
