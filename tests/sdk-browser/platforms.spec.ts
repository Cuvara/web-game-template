// The template game in a real browser, once per engine × platform, with each portal's SDK
// replaced by a local mock (or blocked, the way an ad blocker would). Bundles come from
// scripts/verify/sdk-smoke-build.mjs.
//
// What this adds over tests/sdk/: the adapters run inside the real PixiJS and Three.js
// builds, through src/main.ts's boot order and src/platform/bind.ts, with a real document,
// real script loading and real visibility. What it cannot show: how the real portal behaves.
// That is draft/QA mode on each portal, which is a release-pipeline step, not a test.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const ENGINES = ["pixijs", "threejs"] as const;
const POKI_SDK_URL = "https://game-cdn.poki.com/scripts/v2/poki-sdk.js";
const MOCK_YANDEX = readFileSync(resolve(import.meta.dirname, "mock-yandex-sdk.js"), "utf8");
const MOCK_POKI = readFileSync(
  resolve(import.meta.dirname, "..", "poki", "mock-poki-sdk.js"),
  "utf8",
);

type Sdk = "mock" | "block";

// window.__wgf__ is declared by src/core/probe.ts.
declare global {
  interface Window {
    __yaCalls?: string[];
    __yaFire?: (event: string) => void;
    __pokiCalls?: string[];
    __pokiViolations?: string[];
  }
}

async function boot(page: Page, bundle: string, sdk: Sdk = "mock"): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/sdk.js", (route) =>
    sdk === "block"
      ? route.abort()
      : route.fulfill({ contentType: "text/javascript", body: MOCK_YANDEX }),
  );
  await page.route(POKI_SDK_URL, (route) =>
    sdk === "block"
      ? route.abort()
      : route.fulfill({ contentType: "text/javascript", body: MOCK_POKI }),
  );
  await page.goto(`/${bundle}/`);
  await expect(page.locator("#hud")).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
  return errors;
}

const elapsed = (page: Page): Promise<number> => page.evaluate(() => window.__wgf__!.elapsedMs());

async function advances(page: Page): Promise<boolean> {
  const before = await elapsed(page);
  await page.waitForTimeout(400);
  return (await elapsed(page)) > before;
}

for (const engine of ENGINES) {
  test.describe(engine, () => {
    test(`generic-web boots, renders and runs (the GameVui build)`, async ({ page }) => {
      const external: string[] = [];
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (
          url.hostname !== "localhost" &&
          !url.protocol.startsWith("data") &&
          !url.protocol.startsWith("blob")
        ) {
          external.push(request.url());
        }
      });
      const errors = await boot(page, `${engine}-generic-web`);
      const probe = await page.evaluate(() => ({
        id: window.__wgf__!.platformId,
        engine: window.__wgf__!.engine,
      }));
      expect(probe).toEqual({ id: "generic-web", engine });
      await expect(page.locator("#game canvas")).toBeVisible();
      expect(await advances(page)).toBe(true);
      expect(external).toEqual([]);
      expect(errors).toEqual([]);
    });

    test(`yandex: SDK init, Game Ready, portal pause and resume`, async ({ page }) => {
      const errors = await boot(page, `${engine}-yandex`);
      expect(await page.evaluate(() => window.__wgf__!.platformId)).toBe("yandex");
      const calls = await page.evaluate(() => window.__yaCalls!);
      expect(calls[0]).toBe("YaGames.init");
      expect(calls.filter((c) => c === "LoadingAPI.ready")).toHaveLength(1);
      expect(await advances(page)).toBe(true);

      // game_api_pause — the portal's ad, or its own overlay — must stop the game.
      await page.evaluate(() => window.__yaFire!("game_api_pause"));
      expect(await advances(page)).toBe(false);
      await page.evaluate(() => window.__yaFire!("game_api_resume"));
      expect(await advances(page)).toBe(true);
      expect(errors).toEqual([]);
    });

    test(`yandex: the game still boots when /sdk.js is blocked`, async ({ page }) => {
      await boot(page, `${engine}-yandex`, "block");
      expect(await advances(page)).toBe(true);
    });

    test(`poki: SDK init and loading finished, no sequencing violations`, async ({ page }) => {
      const errors = await boot(page, `${engine}-poki`);
      expect(await page.evaluate(() => window.__wgf__!.platformId)).toBe("poki");
      await expect
        .poll(() => page.evaluate(() => window.__pokiCalls ?? []))
        .toContain("gameLoadingFinished");
      // The first input starts gameplay, not the load (Poki's rule).
      await page.mouse.click(10, 10);
      await expect.poll(() => page.evaluate(() => window.__pokiCalls!)).toContain("gameplayStart");
      expect(await page.evaluate(() => window.__pokiViolations!)).toEqual([]);
      expect(errors).toEqual([]);
    });

    test(`poki: the game still boots when the SDK is blocked`, async ({ page }) => {
      await boot(page, `${engine}-poki`, "block");
      expect(await advances(page)).toBe(true);
    });
  });
}
