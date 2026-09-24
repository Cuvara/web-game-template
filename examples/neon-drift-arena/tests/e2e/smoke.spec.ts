// Smoke test for Neon Drift Arena, driven through the window.__game probe.
//
// It never reads pixels: the deterministic probe exposes score, state and the pure-sim hooks
// (tick/steer/spawnObstacleAt/restart), so play is scripted and asserted exactly. It does
// assert a real WebGL canvas exists and that nothing throws — the Three.js half has to boot.

import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";

/** The probe surface the game installs on window. */
interface GameProbe {
  score: number;
  best: number;
  state: string;
  phase: string;
  playerX: number;
  runId: number;
  gameplayActive(): boolean;
  play(): void;
  tick(dt: number): void;
  steer(dir: number): void;
  spawnObstacleAt(x: number, z: number, halfWidth?: number): unknown;
  restart(): Promise<void>;
  revive(): Promise<boolean>;
}

declare global {
  interface Window {
    __game: GameProbe;
  }
}

const STEP = 1000 / 60;

/** Fail on any uncaught exception or console error, not just on a bad assertion. */
function guard(page: Page): { errors: string[] } {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });
  return { errors };
}

async function boot(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  await page.waitForFunction(() => typeof window.__game !== "undefined");
}

test("page loads with a WebGL canvas and no fatal errors", async ({ page }) => {
  const { errors } = guard(page);
  await boot(page);

  const canvas = page.locator("#game canvas");
  await expect(canvas).toHaveCount(1);

  const hasWebGl = await page.evaluate(() => {
    const c = document.querySelector("#game canvas") as HTMLCanvasElement | null;
    if (!c) return false;
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  });
  expect(hasWebGl).toBe(true);
  expect(errors).toEqual([]);
});

test("first input starts gameplay (gameplayStart, not on load)", async ({ page }) => {
  await boot(page);

  // On load the game is on the menu and gameplay has NOT been reported to the platform.
  // gameplayActive() reads Platform.gameplayActive through the abstraction — the exact flag
  // bindPlatform toggles — so this proves gameplayStart did not fire at load.
  expect(await page.evaluate(() => window.__game.phase)).toBe("menu");
  expect(await page.evaluate(() => window.__game.gameplayActive())).toBe(false);

  // Interact the way a real player does. The menu overlay covers #game, so click its visible
  // Drive control rather than the covered canvas. The click is a genuine pointer event, which
  // is what bindPlatform's first-input listener reports gameplayStart on.
  await page.locator("#play").click();

  // Gameplay is now running AND the platform was told so on that first input.
  expect(await page.evaluate(() => window.__game.phase)).toBe("playing");
  expect(await page.evaluate(() => window.__game.gameplayActive())).toBe(true);
});

test("keyboard first input also starts gameplay", async ({ page }) => {
  await boot(page);
  expect(await page.evaluate(() => window.__game.gameplayActive())).toBe(false);

  // Space is a real keydown: the menu starts a run on it, and bindPlatform reports
  // gameplayStart on the first keydown. Both react to the same first input.
  await page.locator("body").press("Space");

  expect(await page.evaluate(() => window.__game.phase)).toBe("playing");
  expect(await page.evaluate(() => window.__game.gameplayActive())).toBe(true);
});

test("scripted play increases the score", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__game.play());

  const start = await page.evaluate(() => window.__game.score);
  await page.evaluate((step) => {
    window.__game.steer(0);
    for (let i = 0; i < 240; i++) window.__game.tick(step); // ~4 seconds of survival
  }, STEP);
  const after = await page.evaluate(() => window.__game.score);
  expect(after).toBeGreaterThan(start);
});

test("a collision reaches game over", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__game.play());

  await page.evaluate((step) => {
    // Player is centred; drop a wide obstacle dead ahead and drive into it.
    window.__game.steer(0);
    window.__game.spawnObstacleAt(0, 1, 0.8);
    for (let i = 0; i < 60 && window.__game.phase === "playing"; i++) {
      window.__game.tick(step);
    }
  }, STEP);

  expect(await page.evaluate(() => window.__game.phase)).toBe("over");
});

test("restart resets the run and score", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__game.play());
  const firstRunId = await page.evaluate(() => window.__game.runId);

  // Build a substantial score, then crash.
  await page.evaluate((step) => {
    window.__game.steer(0);
    for (let i = 0; i < 600; i++) window.__game.tick(step); // ~10 s of survival
    window.__game.spawnObstacleAt(0, 1, 0.8);
    for (let i = 0; i < 60 && window.__game.phase === "playing"; i++) {
      window.__game.tick(step);
    }
  }, STEP);
  const crashScore = await page.evaluate(() => window.__game.score);
  expect(await page.evaluate(() => window.__game.phase)).toBe("over");
  expect(crashScore).toBeGreaterThan(50);

  // Restart runs an interstitial through the abstraction (no-op on generic-web) then a fresh
  // run. The live RAF loop advances the new run's time-based score by a frame or two between
  // the phase flip and this read, so an exact `=== 0` would be a race with the render loop.
  // Instead prove the reset two ways that no live frame can fake:
  //   1. runId incremented — this is a genuinely new run, not the old one continued.
  //   2. the score collapsed back near zero — far below the pre-crash score, which is only
  //      possible if the simulation itself was reset (the unit suite proves a new Simulation
  //      starts at score 0; this confirms the live restart path builds one).
  await page.evaluate(() => window.__game.restart());
  await page.waitForFunction(() => window.__game.phase === "playing");

  expect(await page.evaluate(() => window.__game.runId)).toBe(firstRunId + 1);
  const afterScore = await page.evaluate(() => window.__game.score);
  expect(afterScore).toBeLessThan(5);
  expect(afterScore).toBeLessThan(crashScore);
});

test("rewarded revive is declined gracefully on a platform with no ads", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__game.play());

  await page.evaluate((step) => {
    window.__game.steer(0);
    window.__game.spawnObstacleAt(0, 1, 0.8);
    for (let i = 0; i < 60 && window.__game.phase === "playing"; i++) {
      window.__game.tick(step);
    }
  }, STEP);
  expect(await page.evaluate(() => window.__game.phase)).toBe("over");

  // generic-web has no rewarded ad, so revive resolves false and the game stays over.
  const granted = await page.evaluate(() => window.__game.revive());
  expect(granted).toBe(false);
  expect(await page.evaluate(() => window.__game.phase)).toBe("over");
});
