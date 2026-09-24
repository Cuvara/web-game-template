// Pause and resume on tab visibility, for any game.
//
// Every portal wants the game stopped while its tab is hidden (Yandex 1.3, Poki and
// CrazyGames gameplayStop on hide), and bindPlatform does it for every game main.ts boots.
// Game-agnostic: it reads window.__wgf__.paused() and #hud[data-steps], never game markup.

import { expect, test, type Page } from "@playwright/test";

async function setVisibility(page: Page, state: "hidden" | "visible"): Promise<void> {
  // Headless tabs cannot really be hidden; overriding the two properties and raising the
  // event is exactly what the page's own listeners see on a real tab switch.
  await page.evaluate((next) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => next });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => next === "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

const paused = (page: Page): Promise<boolean> => page.evaluate(() => window.__wgf__!.paused());
const steps = (page: Page): Promise<number> => page.evaluate(() => window.__wgf__!.steps());

test("pauses while the tab is hidden and resumes when it returns @pause-resume", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("#hud")).toHaveAttribute("data-ready", "true", { timeout: 15_000 });

  // A game may sit paused on a menu of its own; hiding must pause it either way, and
  // returning must give back exactly the state it had.
  const before = await paused(page);

  await setVisibility(page, "hidden");
  expect(await paused(page)).toBe(true);
  const hiddenAt = await steps(page);
  await page.waitForTimeout(300);
  expect(await steps(page)).toBe(hiddenAt);

  await setVisibility(page, "visible");
  expect(await paused(page)).toBe(before);
  if (!before) await expect.poll(() => steps(page), { timeout: 5_000 }).toBeGreaterThan(hiddenAt);

  expect(errors).toEqual([]);
});
