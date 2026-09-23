// End-to-end smoke test: the built game, driven through its window hooks.
//
// Everything asserted here goes through the same App and platform wiring a player hits — the
// hooks write nothing the rules would not allow. The platform is generic-web, so ad requests
// answer {shown:false}; the flow is still exercised, and the game handles the miss gracefully.
//
// Math.random is pinned to 0 before load so the first drop is deterministically level 1 (see
// MergeGame.dropLevel), which makes the scripted merge below reproducible.

import { expect, test, type Page, type TestInfo } from "@playwright/test";

interface GameHooks {
  state: "start" | "playing" | "over";
  score: number;
  merges: number;
  dropLevel: number;
  board: Array<number | null>;
  levelAt(col: number): number | null;
  dropAt(col: number): void;
  dropAnywhere(): void;
  continue(): Promise<boolean>;
  doubleScore(): Promise<boolean>;
  restart(): Promise<unknown>;
  paused(): boolean;
  gameplayActive(): boolean;
}

interface Session {
  readonly errors: string[];
}

async function open(page: Page): Promise<Session> {
  const session: Session = { errors: [] };
  page.on("pageerror", (error) => session.errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") session.errors.push(`console: ${message.text()}`);
  });
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
  await page.goto("/");
  await expect(page.locator("#ui")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
  return session;
}

// Each helper opens its own evaluate so the __game lookup runs in the browser, not Node.
const state = (page: Page): Promise<string> =>
  page.evaluate(() => (window as unknown as { __game: GameHooks }).__game.state);
const score = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { __game: GameHooks }).__game.score);
const merges = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { __game: GameHooks }).__game.merges);
const gameplayActive = (page: Page): Promise<boolean> =>
  page.evaluate(() => (window as unknown as { __game: GameHooks }).__game.gameplayActive());
const levelAt = (page: Page, col: number): Promise<number | null> =>
  page.evaluate((c) => (window as unknown as { __game: GameHooks }).__game.levelAt(c), col);

async function drop(page: Page, col: number): Promise<void> {
  await page.evaluate((c) => (window as unknown as { __game: GameHooks }).__game.dropAt(c), col);
}

async function fillUntilOver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const hooks = (window as unknown as { __game: GameHooks }).__game;
    for (let i = 0; i < 500 && hooks.state !== "over"; i++) hooks.dropAnywhere();
  });
}

test("loads with a canvas and no fatal errors", async ({ page }) => {
  const session = await open(page);
  await expect(page.locator("#game canvas")).toBeVisible();
  expect(session.errors).toEqual([]);
  expect(await state(page)).toBe("start");
});

test("the first input starts gameplay (gameplayStart on input, not load)", async ({ page }) => {
  await open(page);
  // Before any input: on the start screen, gameplay not reported.
  expect(await gameplayActive(page)).toBe(false);

  await drop(page, 0);
  expect(await state(page)).toBe("playing");
  await expect.poll(() => gameplayActive(page)).toBe(true);
});

test("a scripted merge increases the score", async ({ page }) => {
  await open(page);
  await drop(page, 0); // level 1 at column 0
  const before = await score(page);
  await drop(page, 1); // level 1 at column 1 -> merges into level 2 at column 0
  expect(await score(page)).toBeGreaterThan(before);
  expect(await levelAt(page, 0)).toBe(2);
  expect(await merges(page)).toBe(1);
});

test("game over is reachable by filling the track", async ({ page }) => {
  await open(page);
  await fillUntilOver(page);
  expect(await state(page)).toBe("over");
  await expect(page.locator('section[data-screen="over"]')).toBeVisible();
});

test("restart resets the score to zero", async ({ page }) => {
  await open(page);
  await fillUntilOver(page);
  expect(await score(page)).toBeGreaterThan(0);

  // Restart goes through withAdBreak -> showInterstitial (generic-web: {shown:false}), then
  // resets. The unfilled ad must not block the restart.
  await page.evaluate(() => (window as unknown as { __game: GameHooks }).__game.restart());
  await expect.poll(() => state(page)).toBe("start");
  expect(await score(page)).toBe(0);
});

test("a rewarded continue is refused gracefully when no ad is available", async ({ page }) => {
  await open(page);
  await fillUntilOver(page);
  // generic-web grants no reward: continue resolves false and the game stays over, no crash.
  const granted = await page.evaluate(() =>
    (window as unknown as { __game: GameHooks }).__game.continue(),
  );
  expect(granted).toBe(false);
  expect(await state(page)).toBe("over");
  await expect(page.locator('[data-role="note"]')).not.toBeEmpty();
});

// The hooks drive the game identically on both projects, which is the point of testing
// through them; info is read so the desktop/mobile split stays meaningful.
test("drives through the hooks on every project", async ({ page }, info: TestInfo) => {
  await open(page);
  await drop(page, 2);
  expect(await state(page)).toBe("playing");
  expect(await levelAt(page, 2)).toBe(1);
  expect(info.project.name).toBeTruthy();
});
