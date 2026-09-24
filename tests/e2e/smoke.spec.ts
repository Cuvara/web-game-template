// Smoke test against the built bundle.
//
// `verification.smoke_test` in game.config.yaml is what this satisfies, and the scaffolding
// stage requires it green before any game code exists. It asserts the boot sequence
// completed and the loop is actually stepping — a page that renders once and freezes would
// otherwise pass any "did it load" check.
//
// GAME-AGNOSTIC: every game made from the template inherits this file unchanged. It reads
// only what main.ts publishes for any game (#hud[data-ready|data-scene|data-steps|
// data-engine|data-platform], window.__wgf__), never a scene id or a game's own markup. The
// @tags are the aspects the Factory's verification maps to Playwright specs.

import { expect, test, type Page } from "@playwright/test";

async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("#hud")).toHaveAttribute("data-ready", "true", { timeout: 15_000 });
  return errors;
}

const readSteps = async (page: Page): Promise<number> =>
  Number(await page.locator("#hud").getAttribute("data-steps"));

test("boots and reports loading through the platform @boot @loading", async ({ page }) => {
  const errors = await boot(page);
  const hud = page.locator("#hud");
  await expect(hud).toHaveAttribute("data-engine", /^(pixijs|threejs)$/);
  await expect(hud).toHaveAttribute("data-platform", /.+/);

  const probe = await page.evaluate(() => {
    const wgf = window.__wgf__!;
    return {
      engine: wgf.engine,
      platformId: wgf.platformId,
      target: wgf.target,
      usage: wgf.usage(),
      tti: wgf.timeToInteractiveMs,
    };
  });
  expect(probe.engine).toBe(await hud.getAttribute("data-engine"));
  expect(probe.platformId).toBe(await hud.getAttribute("data-platform"));
  expect(probe.target).not.toBe("");
  // Progress reported during boot, then ready exactly once: the portal loading contract.
  expect(probe.usage.loadingProgressCalls).toBeGreaterThan(0);
  expect(probe.usage.signalReadyCalls).toBe(1);
  expect(probe.tti).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("enters a scene and steps the simulation @boot @core-loop", async ({ page }) => {
  const errors = await boot(page);
  const hud = page.locator("#hud");

  // Whatever the game calls its scene: present, and the one the probe reports.
  await expect(hud).toHaveAttribute("data-scene", /.+/);
  const scene = await hud.getAttribute("data-scene");
  expect(scene).not.toBe("none");
  expect(await page.evaluate(() => window.__wgf__!.scene())).toBe(scene);

  await expect.poll(() => readSteps(page), { timeout: 5_000 }).toBeGreaterThan(0);
  const first = await readSteps(page);
  await expect.poll(() => readSteps(page), { timeout: 5_000 }).toBeGreaterThan(first);
  expect(await page.evaluate(() => window.__wgf__!.steps())).toBeGreaterThan(first);

  expect(errors).toEqual([]);
});

test("renders a canvas @boot", async ({ page }) => {
  // Boot first, with the same allowance as the boot test: the canvas appears only once the
  // renderer has initialised, which a loaded runner can take longer than 5 s to reach.
  await boot(page);
  await expect(page.locator("#game canvas")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__wgf__!.framesRendered())).toBeGreaterThan(0);
});

test("makes no insecure requests @boot", async ({ page }) => {
  // Every platform profile sets https_only, and Yandex asserts insecure_requests == 0.
  const insecure: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.startsWith("http://") && !url.startsWith("http://localhost")) insecure.push(url);
  });

  await boot(page);

  expect(insecure).toEqual([]);
});
