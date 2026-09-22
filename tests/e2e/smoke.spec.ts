// Smoke test against the built bundle.
//
// `verification.smoke_test` in game.config.yaml is what this satisfies, and the scaffolding
// stage requires it green before any game code exists. It asserts the boot sequence
// completed and the loop is actually stepping — a page that renders once and freezes would
// otherwise pass any "did it load" check.

import { expect, test } from "@playwright/test";

test("boots and steps the simulation", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");

  const hud = page.locator("#hud");
  await expect(hud).toHaveAttribute("data-ready", "true", { timeout: 15_000 });
  await expect(hud).toHaveAttribute("data-scene", "boot");

  const readSteps = async (): Promise<number> => Number(await hud.getAttribute("data-steps"));

  await expect.poll(readSteps, { timeout: 5_000 }).toBeGreaterThan(0);
  const first = await readSteps();
  await page.waitForTimeout(500);
  expect(await readSteps()).toBeGreaterThan(first);

  expect(errors).toEqual([]);
});

test("renders a canvas", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#game canvas")).toBeVisible();
});

test("makes no insecure requests", async ({ page }) => {
  // Every platform profile sets https_only, and Yandex asserts insecure_requests == 0.
  const insecure: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.startsWith("http://") && !url.startsWith("http://localhost")) insecure.push(url);
  });

  await page.goto("/");
  await expect(page.locator("#hud")).toHaveAttribute("data-ready", "true", { timeout: 15_000 });

  expect(insecure).toEqual([]);
});
