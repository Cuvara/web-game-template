// Tower Merge Rush, played in a browser against the built bundle.
//
// GOLDEN-RUN REPLAY. Ported from examples/tower-merge-rush/tests/e2e/smoke.spec.ts by the
// Factory's golden-run replay developer; not agent-written. Each test carries @aspect tags
// the verify step maps to gameplay aspects. Requests to anything but the preview server are
// aborted, so a portal SDK script is never fetched: the game must cope without it, and the
// suite never touches the network.
//
// Math.random is pinned to 0 before load so the first drop is deterministically level 1,
// which makes the scripted merge below reproducible.

import { expect, test, type Page } from "@playwright/test";

interface GameHooks {
  state: "start" | "playing" | "over";
  score: number;
  best: number;
  merges: number;
  steps: number;
  levelAt(col: number): number | null;
  dropAt(col: number): void;
  dropAnywhere(): void;
  continue(): Promise<boolean>;
  restart(): Promise<unknown>;
  pause(): void;
  resume(): void;
  paused(): boolean;
  gameplayActive(): boolean;
}

/** window, as the game's main.ts extends it. Local, so no global declaration
 * collides with the template examples' own suites in one typecheck. */
type W = { __game: GameHooks };

async function open(page: Page): Promise<{ errors: string[] }> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  await page.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, (route) => route.abort());
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
  await page.goto("/");
  await expect(page.locator("#hud")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
  return { errors };
}

async function state(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as W).__game.state);
}

async function fillUntilOver(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (let i = 0; i < 500 && (window as unknown as W).__game.state !== "over"; i++)
      (window as unknown as W).__game.dropAnywhere();
  });
}

test("boots with a canvas, loads, and shows the title @boot @loading", async ({ page }) => {
  const { errors } = await open(page);
  await expect(page.locator("#game canvas")).toBeVisible();
  await expect(page.locator("#hud")).toHaveAttribute("data-scene", "tower-merge-rush");
  await expect(page.locator('section[data-screen="start"]')).toBeVisible();
  expect(await state(page)).toBe("start");
  expect(errors).toEqual([]);
});

test("the play button starts a run and gameplay on first input @start @input", async ({ page }) => {
  await open(page);
  expect(await page.evaluate(() => (window as unknown as W).__game.gameplayActive())).toBe(false);
  await page.locator('[data-action="play"]').click();
  expect(await state(page)).toBe("playing");
  await expect
    .poll(() => page.evaluate(() => (window as unknown as W).__game.gameplayActive()))
    .toBe(true);
});

test("a tap on the board drops a piece @input @core-loop", async ({ page }) => {
  await open(page);
  await page.locator('[data-action="play"]').click();
  const box = await page.locator("#game").boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width * 0.5, box!.y + box!.height * 0.5);
  const filled = await page.evaluate(
    () =>
      [0, 1, 2, 3, 4, 5, 6].filter((c) => (window as unknown as W).__game.levelAt(c) !== null)
        .length,
  );
  expect(filled).toBeGreaterThanOrEqual(2);
});

test("a scripted merge increases the score @core-loop @progression", async ({ page }) => {
  await open(page);
  await page.evaluate(() => (window as unknown as W).__game.dropAt(0));
  const before = await page.evaluate(() => (window as unknown as W).__game.score);
  await page.evaluate(() => (window as unknown as W).__game.dropAt(1));
  expect(await page.evaluate(() => (window as unknown as W).__game.score)).toBeGreaterThan(before);
  expect(await page.evaluate(() => (window as unknown as W).__game.levelAt(0))).toBe(2);
  expect(await page.evaluate(() => (window as unknown as W).__game.merges)).toBe(1);
});

test("game over is reachable and records the personal best @game-over @progression", async ({
  page,
}) => {
  await open(page);
  await fillUntilOver(page);
  expect(await state(page)).toBe("over");
  await expect(page.locator('section[data-screen="over"]')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as W).__game.best))
    .toBe(await page.evaluate(() => (window as unknown as W).__game.score));
});

test("restart after game over resets the score @restart", async ({ page }) => {
  await open(page);
  await fillUntilOver(page);
  expect(await page.evaluate(() => (window as unknown as W).__game.score)).toBeGreaterThan(0);
  await page.evaluate(() => (window as unknown as W).__game.restart());
  await expect.poll(() => state(page)).toBe("start");
  expect(await page.evaluate(() => (window as unknown as W).__game.score)).toBe(0);
});

test("pausing stops the loop and resuming restarts it @pause-resume", async ({ page }) => {
  await open(page);
  await page.evaluate(() => (window as unknown as W).__game.dropAt(0));
  await page.evaluate(() => (window as unknown as W).__game.pause());
  expect(await page.evaluate(() => (window as unknown as W).__game.paused())).toBe(true);
  await expect(page.locator('section[data-screen="pause"]')).toBeVisible();
  const frozen = await page.evaluate(() => (window as unknown as W).__game.steps);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as unknown as W).__game.steps)).toBe(frozen);
  await page.evaluate(() => (window as unknown as W).__game.resume());
  expect(await page.evaluate(() => (window as unknown as W).__game.paused())).toBe(false);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as W).__game.steps))
    .toBeGreaterThan(frozen);
});

test("a rewarded continue without an ad is refused gracefully @game-over", async ({ page }) => {
  await open(page);
  await fillUntilOver(page);
  const granted = await page.evaluate(() => (window as unknown as W).__game.continue());
  expect(granted).toBe(false);
  expect(await state(page)).toBe("over");
  await expect(page.locator('[data-role="note"]')).not.toBeEmpty();
});

// The hooks drive the game identically on both projects; the mobile project is the phone.
test("drives through the hooks on every viewport @responsive", async ({ page }, info) => {
  await open(page);
  await page.evaluate(() => (window as unknown as W).__game.dropAt(2));
  expect(await state(page)).toBe("playing");
  expect(await page.evaluate(() => (window as unknown as W).__game.levelAt(2))).toBe(1);
  expect(info.project.name).toBeTruthy();
});

// The art guard. A golden build draws every tower from the design's art: an entity drawn as a
// primitive, or by no manifest asset, or by a stand-in, fails; so does an asset the runtime
// manifest lists that the game never fetched. A build with no runtime manifest at all is the
// greybox, before the assets step - there is no art to hold it to, and the test says so.
test("draws every tower from the runtime asset manifest and loads all of it @loading @core-loop", async ({
  page,
}) => {
  const fetched = new Set<string>();
  page.on("response", (response) => {
    if (response.ok()) fetched.add(new URL(response.url()).pathname);
  });
  const manifestResponse = await page.request.get("/assets/assets.json");
  const isManifest =
    manifestResponse.ok() && (manifestResponse.headers()["content-type"] ?? "").includes("json");
  test.skip(!isManifest, "no public/assets/assets.json: a greybox build has no art");
  const manifest = (await manifestResponse.json()) as {
    assets: Record<string, { url?: string; placeholder?: boolean; variants?: string[] }>;
  };
  const { errors } = await open(page);

  await page.locator('[data-action="play"]').click();
  const box = (await page.locator("#game").boundingBox())!;
  for (const col of [0, 2, 4, 6, 1]) {
    await page.mouse.click(box.x + ((col + 0.5) * box.width) / 7, box.y + box.height * 0.5);
  }
  const snap = await page.evaluate(() =>
    (
      window as unknown as {
        __wgf__: {
          play: {
            snapshot(): {
              entities: { id: string; asset: string | null; render: string }[];
              assets_loaded: string[];
            };
          };
        };
      }
    ).__wgf__.play.snapshot(),
  );

  expect(snap.entities.length).toBeGreaterThan(0);
  for (const entity of snap.entities) {
    expect(entity.render, `${entity.id} is drawn as ${entity.render}`).toBe("asset");
    expect(entity.asset, `${entity.id} names no runtime asset`).not.toBeNull();
    const entry = manifest.assets[entity.asset!];
    expect(entry, `${entity.id}: ${entity.asset} is not in assets.json`).toBeDefined();
    expect(entry!.placeholder, `${entity.id}: ${entity.asset} is a placeholder`).not.toBe(true);
  }

  // Every asset with a file was requested and loaded (a counted asset's own entry is its
  // first drawing, so its drawings stand for it). Sound streams in after the game is
  // interactive, so the last of it may still be arriving: wait for it, then hold it all.
  const withFiles = Object.entries(manifest.assets).filter(([, entry]) => entry.url);
  const loadedNow = (): Promise<string[]> =>
    page.evaluate(
      () =>
        (
          window as unknown as { __wgf__: { play: { snapshot(): { assets_loaded: string[] } } } }
        ).__wgf__.play.snapshot().assets_loaded,
    );
  await expect
    .poll(loadedNow, { timeout: 30_000 })
    .toEqual(expect.arrayContaining(withFiles.map(([id]) => id)));
  const loaded = await loadedNow();
  for (const [id, entry] of withFiles) {
    expect(fetched, `${entry.url} (${id}) was never fetched`).toContain(`/assets/${entry.url}`);
    expect(loaded, `${id} is not in the probe's assets_loaded`).toContain(id);
  }
  expect(snap.assets_loaded.length).toBeGreaterThan(0);

  // The UI is set in the bundled faces, never a system fallback.
  const faces = await page.evaluate(() =>
    [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, "")),
  );
  expect(faces).toContain("wgf-display");
  expect(faces).toContain("wgf-body");
  const family = await page
    .locator('[data-action="pause"]')
    .evaluate((el) => getComputedStyle(el).fontFamily);
  expect(family).toContain("wgf-display");
  expect(errors).toEqual([]);
});

// Sound: nothing before the first input; after it the play music is audible - the probe's
// level is measured from the master output - and the platform mute (a window blur) silences
// it. A build whose manifest has no music (a greybox) has nothing to hear.
test("plays its music after the first input and falls silent under the platform mute @audio", async ({
  page,
}) => {
  const manifestResponse = await page.request.get("/assets/assets.json");
  const isManifest =
    manifestResponse.ok() && (manifestResponse.headers()["content-type"] ?? "").includes("json");
  const manifest = isManifest
    ? ((await manifestResponse.json()) as { assets: Record<string, { type: string }> })
    : { assets: {} };
  test.skip(
    !Object.values(manifest.assets).some((a) => a.type === "music"),
    "no music in public/assets/assets.json",
  );
  await open(page);
  type Audio = { music: string | null; playing: boolean; level: number; muted: boolean };
  const audio = (): Promise<Audio> =>
    page.evaluate(
      () =>
        (
          window as unknown as { __wgf__: { play: { snapshot(): { audio: Audio } } } }
        ).__wgf__.play.snapshot().audio,
    );
  expect((await audio()).playing).toBe(false);
  expect((await audio()).level).toBe(0);
  await page.locator('[data-action="play"]').click();
  await expect.poll(async () => (await audio()).music, { timeout: 15_000 }).toBe("music-loop");
  await expect.poll(async () => (await audio()).level, { timeout: 10_000 }).toBeGreaterThan(0.005);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect.poll(async () => (await audio()).level, { timeout: 5_000 }).toBeLessThan(0.001);
  expect((await audio()).muted).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(async () => (await audio()).level, { timeout: 10_000 }).toBeGreaterThan(0.005);
});
