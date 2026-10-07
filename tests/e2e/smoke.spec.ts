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

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Page } from "@playwright/test";
// Whichever portal the bundle was built for, its SDK is the repository's mock (portal-sdk.ts):
// the suite never reaches a portal or an ad network, and `external` records anything that
// still would.
import { PORTAL_SDK_MOCKS, expect, test } from "./portal-sdk.js";
import { ENGINES } from "../../src/core/game-config.js";

// Read from the one list rather than repeating it here. A second copy goes stale the moment
// the template implements another engine, and it fails as "the engine is wrong" on a build
// that is in fact correct.
const ENGINE_PATTERN = new RegExp(`^(${ENGINES.join("|")})$`);

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
  await expect(hud).toHaveAttribute("data-engine", ENGINE_PATTERN);
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

test("boots without reaching the network: the portal SDK is the repository's mock @boot", async ({
  page,
  external,
}) => {
  await boot(page);
  // A moment past ready, so a portal script that fetches after init has had the chance to.
  await page.waitForTimeout(1_000);
  expect(external).toEqual([]);
});

test("every portal SDK the adapters can load has a mock here", () => {
  // sdk-signatures.json lists, per platform, the hosts its SDK is fetched from (Yandex's is
  // same-origin and named by its global instead). A host with no mock would be live traffic.
  const signatures = JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, "../../packages/platform-sdk/sdk-signatures.json"),
      "utf8",
    ),
  ) as Record<string, string[]>;
  const isHost = (needle: string): boolean => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(needle);
  const mocked = new Map(PORTAL_SDK_MOCKS.map((mock) => [mock.platform, mock.url]));
  for (const [platform, needles] of Object.entries(signatures)) {
    for (const host of needles.filter(isHost)) {
      const url = mocked.get(platform);
      expect(url, `${platform}: no mock for its SDK host ${host}`).toBeDefined();
      expect(new URL(url!).hostname.endsWith(host), `${platform}: mock URL vs ${host}`).toBe(true);
    }
  }
  expect(mocked.get("yandex")).toBe("/sdk.js");
});
