// Boot -> SDK init -> Loading -> First gameplay -> Gameplay state -> Ad -> Resume -> Save,
// driven through the built demo with real input, and every branch the ad requirements name.
//
// Runs in the desktop, mobile and tablet projects. Touch devices steer by tapping.
//
// Midgame ads begin after level 3 (main.ts MIDGAME_FROM_LEVEL), so ad tests start from a
// seeded save at level 3 rather than replaying the early levels each time.

import {
  LIVE_SDK,
  PAST_EARLY_LEVELS,
  SDK_URL,
  boot,
  callNames,
  expect,
  expectCompletePanel,
  nextLevel,
  playLevel,
  sdkCalls,
  seedSave,
  snapshot,
  test,
} from "./fixtures.js";
import { MOCK_SDK_SOURCE } from "./mock-sdk.js";

test.skip(LIVE_SDK, "mock-driven; the live SDK has its own spec");

const touchOf = (info: { project: { use: { hasTouch?: boolean } } }): boolean =>
  info.project.use.hasTouch === true;

test.describe("boot and first gameplay", () => {
  test("lands directly in gameplay with no click, in the documented order", async ({ page }) => {
    await boot(page);
    const names = await callNames(page);
    expect(names.slice(0, 4)).toEqual(["init", "loadingStart", "loadingStop", "gameplayStart"]);

    const state = await snapshot(page);
    expect(state.phase).toBe("playing");
    expect(state.sdkMode).toBe("sdk");
    await expect.poll(async () => (await snapshot(page)).elapsedMs).toBeGreaterThan(200);
  });

  test("reaches gameplayStart quickly", async ({ page }) => {
    await boot(page);
    const start = (await sdkCalls(page)).find((call) => call.name === "gameplayStart");
    expect(start, "gameplayStart was reported").toBeDefined();
    // Local preview, warm disk: this is a regression guard, not the portal's measurement.
    expect(start!.t).toBeLessThan(8_000);
  });

  test("shows controls onboarding inside gameplay, then gets out of the way", async ({ page }) => {
    await boot(page);
    await expect(page.locator("#hint")).not.toHaveAttribute("hidden");
    await expect(page.locator("#hint")).toContainText(/Catch the orbs/);
    await expect(page.locator("#hint-keys")).toContainText("← →");
    await expect(page.locator("#hint")).toHaveAttribute("hidden", "", { timeout: 10_000 });
  });

  test("requests no midgame before level 3 is done", async ({ page }, info) => {
    test.setTimeout(120_000);
    await boot(page);
    await nextLevel(page, touchOf(info));
    await nextLevel(page, touchOf(info));
    expect((await snapshot(page)).level).toBe(3);
    expect(await callNames(page)).not.toContain("requestAd:midgame");
  });
});

test.describe("gameplay -> stop -> ad -> resume", () => {
  test("midgame at the level break: paused, input blocked, muted only while playing", async ({
    page,
  }, info) => {
    test.setTimeout(90_000);
    await seedSave(page, PAST_EARLY_LEVELS);
    // A slow auction, so the requested-but-not-started window is wide enough to observe.
    await boot(page, "cgAdDelayMs=1500&cgAdMs=1000");
    await playLevel(page, { touch: touchOf(info) });
    await expectCompletePanel(page);

    let names = await callNames(page);
    expect(names).toContain("gameplayStop");
    expect(names.lastIndexOf("gameplayStop")).toBeLessThan(
      names.lastIndexOf("data.setItem:orb-catcher.progress"),
    );
    expect((await snapshot(page)).lastSaveOk).toBe(true);

    await page.locator("#btn-next").click();

    // Requested but not yet started: game held still, no audio blip.
    await expect.poll(async () => (await snapshot(page)).phase).toBe("ad");
    const requested = await snapshot(page);
    expect(requested.paused).toBe(true);
    expect(requested.muted).toBe(false);
    await expect(page.locator("#ad-shield")).toBeVisible();

    // Playing: muted, still paused, simulation not advancing.
    await page.waitForFunction(
      () => (window as never as { __cgMock__: { adPlaying: boolean } }).__cgMock__.adPlaying,
    );
    const playing = await snapshot(page);
    expect(playing.muted).toBe(true);
    expect(playing.gain).toBe(0);
    expect(playing.paused).toBe(true);
    await page.waitForTimeout(250);
    expect((await snapshot(page)).elapsedMs).toBe(playing.elapsedMs);

    // Input during the ad reaches nothing.
    await page.mouse.click(10, 10);
    await page.keyboard.press("ArrowLeft");

    // Finished: unmuted, next level live, gameplay reported again.
    await expect.poll(async () => (await snapshot(page)).phase, { timeout: 5_000 }).toBe("playing");
    const resumed = await snapshot(page);
    expect(resumed.muted).toBe(false);
    expect(resumed.paused).toBe(false);
    expect(resumed.level).toBe(4);
    await expect(page.locator("#ad-shield")).toBeHidden();

    names = await callNames(page);
    const tail = names.slice(names.indexOf("requestAd:midgame"));
    expect(tail).toEqual(["requestAd:midgame", "adStarted", "adFinished", "gameplayStart"]);
  });

  for (const [mode, code] of [
    ["unfilled", "unfilled"],
    ["cooldown", "adCooldown"],
    ["basic", "adsDisabledBasicLaunch"],
  ] as const) {
    test(`an ${code} midgame never mutes and the game continues`, async ({ page }, info) => {
      test.setTimeout(90_000);
      await seedSave(page, PAST_EARLY_LEVELS);
      await boot(page, `cgAd=${mode}`);
      await nextLevel(page, touchOf(info));
      const state = await snapshot(page);
      expect(state.level).toBe(4);
      expect(state.muted).toBe(false);
      expect(await callNames(page)).toContain(`adError:${code}`);
      if (mode === "basic") expect(state.launchStage).toBe("basic");
    });
  }

  test("a lost ad callback cannot freeze the game", async ({ page }, info) => {
    test.setTimeout(120_000);
    await seedSave(page, PAST_EARLY_LEVELS);
    await boot(page, "cgAd=never");
    await playLevel(page, { touch: touchOf(info) });
    await page.locator("#btn-next").click();
    // The adapter's watchdog gives up on an ad that never starts after 30 s.
    await expect
      .poll(async () => (await snapshot(page)).phase, { timeout: 40_000 })
      .toBe("playing");
  });

  test("an ad that starts after the watchdog still pauses the game it lands on", async ({
    page,
  }, info) => {
    test.setTimeout(150_000);
    await seedSave(page, PAST_EARLY_LEVELS);
    await boot(page, "cgAdDelayMs=33000&cgAdMs=1500");
    await playLevel(page, { touch: touchOf(info) });
    await page.locator("#btn-next").click();
    await expect
      .poll(async () => (await snapshot(page)).phase, { timeout: 40_000 })
      .toBe("playing");

    await page.waitForFunction(
      () => (window as never as { __cgMock__: { adPlaying: boolean } }).__cgMock__.adPlaying,
      undefined,
      { timeout: 15_000 },
    );
    const during = await snapshot(page);
    expect(during.paused).toBe(true);
    expect(during.muted).toBe(true);
    await expect(page.locator("#ad-shield")).toBeVisible();

    await expect.poll(async () => (await snapshot(page)).paused, { timeout: 10_000 }).toBe(false);
    expect((await snapshot(page)).muted).toBe(false);
    const names = await callNames(page);
    const tail = names.slice(names.indexOf("adStarted"));
    expect(tail).toEqual(["adStarted", "gameplayStop", "adFinished", "gameplayStart"]);
  });
});

test.describe("rewarded", () => {
  test("offered only after an answered ad, same size as declining, rewards on finish, no chained midgame", async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    await seedSave(page, { level: 3, coins: 0, levelsSinceOffer: 2 });
    await boot(page);

    await playLevel(page, { touch: touchOf(info) });
    await expectCompletePanel(page);
    // No ad has been answered yet this session: no rewarded offer, whatever the counter says.
    await expect(page.locator("#btn-double-ad")).toBeHidden();
    await page.locator("#btn-next").click();
    await expect.poll(async () => (await snapshot(page)).phase, { timeout: 5_000 }).toBe("playing");

    await playLevel(page, { touch: touchOf(info) });
    await expectCompletePanel(page);
    const offer = page.locator("#btn-double-ad");
    await expect(offer).toBeVisible();
    await expect(offer).toContainText("🎬");
    await expect(offer).toContainText(/ad/i);

    const next = await page.locator("#btn-next").boundingBox();
    const ad = await offer.boundingBox();
    expect(ad!.width).toBeCloseTo(next!.width, 0);
    expect(ad!.height).toBeCloseTo(next!.height, 0);
    const style = (selector: string) =>
      page.locator(selector).evaluate((el) => {
        const s = getComputedStyle(el);
        return [s.fontSize, s.fontWeight, s.backgroundColor, s.color].join("|");
      });
    expect(await style("#btn-double-ad")).toBe(await style("#btn-next"));

    const coinsBefore = (await snapshot(page)).coins;
    const earned = 15; // level 4 goal
    await offer.click();
    await expect(page.locator("#complete-note")).toHaveText(/doubled/i, { timeout: 5_000 });
    expect((await snapshot(page)).coins).toBe(coinsBefore + earned);
    await expect(offer).toBeHidden();

    await page.locator("#btn-next").click();
    await expect.poll(async () => (await snapshot(page)).phase).toBe("playing");
    const names = await callNames(page);
    const afterRewarded = names.slice(names.indexOf("requestAd:rewarded"));
    expect(afterRewarded).not.toContain("requestAd:midgame");
  });

  test("a declined offer does not come back at the next break", async ({ page }, info) => {
    test.setTimeout(180_000);
    await seedSave(page, { level: 3, coins: 0, levelsSinceOffer: 2 });
    await boot(page);
    await nextLevel(page, touchOf(info)); // level 3 done; the midgame answers

    await playLevel(page, { touch: touchOf(info) }); // level 4 done: offer shown
    await expect(page.locator("#btn-double-ad")).toBeVisible();
    await page.locator("#btn-next").click(); // declined
    await expect.poll(async () => (await snapshot(page)).phase).toBe("playing");

    await playLevel(page, { touch: touchOf(info) }); // level 5 done: no offer
    await expectCompletePanel(page);
    await expect(page.locator("#btn-double-ad")).toBeHidden();
    expect(await callNames(page)).not.toContain("requestAd:rewarded");
  });

  test("an unfilled rewarded ad grants nothing and says so", async ({ page }, info) => {
    test.setTimeout(180_000);
    await seedSave(page, { level: 3, coins: 0, levelsSinceOffer: 2 });
    await boot(page, "cgAd=unfilled");
    await nextLevel(page, touchOf(info));
    await playLevel(page, { touch: touchOf(info) });

    const coinsBefore = (await snapshot(page)).coins;
    await page.locator("#btn-double-ad").click();
    await expect(page.locator("#complete-note")).toHaveText(/No ad available/i);
    expect((await snapshot(page)).coins).toBe(coinsBefore);
    expect((await snapshot(page)).muted).toBe(false);
  });

  test("Basic Launch: no rewarded button ever appears once ads are known to be off", async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    await seedSave(page, { level: 3, coins: 0, levelsSinceOffer: 2 });
    await boot(page, "cgAd=basic");
    await nextLevel(page, touchOf(info));
    await playLevel(page, { touch: touchOf(info) });
    await expectCompletePanel(page);
    await expect(page.locator("#btn-double-ad")).toBeHidden();
    expect((await snapshot(page)).rewardedAvailability).toBe("disabled");
    expect(await callNames(page)).not.toContain("requestAd:rewarded");
  });

  test("with an ad blocker the game stays fully playable and explains the missing bonus", async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    await seedSave(page, { level: 3, coins: 0, levelsSinceOffer: 2 });
    await boot(page, "cgAdblock=1&cgAd=adblock");
    await nextLevel(page, touchOf(info));
    await playLevel(page, { touch: touchOf(info) });
    await expect(page.locator("#btn-double-ad")).toBeHidden();
    await expect(page.locator("#complete-note")).toHaveText(/ad blocker/i);
    await expect(page.locator("#btn-next")).toBeEnabled();
  });
});

test.describe("level-complete panel input guard", () => {
  test("a tap already in flight when the panel appears does not press its buttons", async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    await seedSave(page, PAST_EARLY_LEVELS);
    // Page time is driven by hand (Playwright's clock), so the 350 ms guard is still up when
    // a real tap/click reaches "Next" — which at level 3 would request a midgame. No reliance
    // on how fast this machine is.
    await page.clock.install();
    await boot(page);
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000);

    const viewport = page.viewportSize()!;
    for (let i = 0; i < 4_000; i++) {
      const state = await snapshot(page);
      if (state.phase === "level-complete" && (await page.locator("#complete").isVisible())) break;
      if (state.nextOrbX !== null) {
        await page.mouse.move(Math.round(state.nextOrbX * viewport.width), viewport.height * 0.96);
      }
      await page.clock.runFor(state.phase === "level-complete" ? 5 : 50);
    }
    await expect(page.locator("#complete")).toHaveAttribute("inert");

    const box = (await page.locator("#btn-next").boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    if (touchOf(info)) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);

    await page.clock.runFor(500);
    await expect(page.locator("#complete")).not.toHaveAttribute("inert");
    expect((await snapshot(page)).phase).toBe("level-complete");
    expect(await callNames(page)).not.toContain("requestAd:midgame");

    // Control: once the guard has lifted, the same press works.
    if (touchOf(info)) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
    await page.clock.runFor(50);
    await expect.poll(async () => callNames(page)).toContain("requestAd:midgame");
  });
});

test.describe("settings, data, degraded SDK", () => {
  test("tells the player when the data module refuses a save", async ({ page }, info) => {
    await boot(page, "cgData=disabled");
    await playLevel(page, { touch: touchOf(info) });
    await expectCompletePanel(page);
    expect((await snapshot(page)).lastSaveOk).toBe(false);
    await expect(page.locator("#complete-note")).toHaveText(/could not be saved/i);
  });

  test("muteAudio from the portal wins, and an ad ending does not unmute it", async ({
    page,
  }, info) => {
    test.setTimeout(90_000);
    await seedSave(page, PAST_EARLY_LEVELS);
    await boot(page, "cgMute=1");
    expect((await snapshot(page)).muted).toBe(true);

    await nextLevel(page, touchOf(info));
    expect(await callNames(page)).toContain("adFinished");
    expect((await snapshot(page)).muted).toBe(true);

    await page.evaluate(() =>
      (
        window as never as { __cgMock__: { setMuteAudio(v: boolean): void } }
      ).__cgMock__.setMuteAudio(false),
    );
    expect((await snapshot(page)).muted).toBe(false);
  });

  test("progress survives a reload through the data module", async ({ page }, info) => {
    await boot(page);
    await playLevel(page, { touch: touchOf(info) });
    const saved = await snapshot(page);
    expect(saved.level).toBe(2);
    expect(saved.coins).toBe(6);

    await page.reload();
    await expect(page.locator("#hud")).toHaveAttribute("data-phase", "playing");
    const restored = await snapshot(page);
    expect(restored.level).toBe(2);
    expect(restored.coins).toBe(6);
    await expect(page.locator("#hud-level")).toHaveText("Level 2");
  });

  test("on a non-CrazyGames domain (disabled SDK) nothing calls the SDK and the game plays", async ({
    page,
  }, info) => {
    await boot(page, "cgEnv=disabled");
    const state = await snapshot(page);
    expect(state.sdkMode).toBe("disabled");
    expect(await callNames(page)).toEqual(["init"]);
    await playLevel(page, { touch: touchOf(info) });
    expect((await snapshot(page)).lastSaveOk).toBe(true);
  });

  test("with the SDK script blocked the game still boots and plays", async ({ page }, info) => {
    await page.unroute(SDK_URL);
    await page.route(SDK_URL, (route) => route.abort("blockedbyclient"));
    await boot(page);
    expect((await snapshot(page)).sdkMode).toBe("unavailable");
    await nextLevel(page, touchOf(info));
    expect((await snapshot(page)).level).toBe(2);
  });

  test("progress made with the SDK blocked survives turning the blocker off", async ({
    page,
  }, info) => {
    await page.unroute(SDK_URL);
    await page.route(SDK_URL, (route) => route.abort("blockedbyclient"));
    await boot(page);
    await playLevel(page, { touch: touchOf(info) });
    expect((await snapshot(page)).level).toBe(2);

    // The player disables the blocker and refreshes — the flow CrazyGames describes.
    await page.unroute(SDK_URL);
    await page.route(SDK_URL, (route) =>
      route.fulfill({ contentType: "text/javascript", body: MOCK_SDK_SOURCE }),
    );
    await page.reload();
    await expect(page.locator("#hud")).toHaveAttribute("data-phase", "playing");
    const restored = await snapshot(page);
    expect(restored.sdkMode).toBe("sdk");
    expect(restored.level).toBe(2);
    expect(restored.coins).toBe(6);
  });

  test("a hidden tab pauses the game without reporting gameplayStop", async ({ page }) => {
    await boot(page);
    const before = (await callNames(page)).filter((n) => n === "gameplayStop").length;
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect((await snapshot(page)).paused).toBe(true);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect((await snapshot(page)).paused).toBe(false);
    const after = (await callNames(page)).filter((n) => n === "gameplayStop").length;
    expect(after).toBe(before);
  });
});

test.describe("network and content", () => {
  test("requests nothing but its own files and the CrazyGames SDK", async ({
    page,
    requests,
  }, info) => {
    await boot(page);
    await playLevel(page, { touch: touchOf(info) });
    const origin = new URL(page.url()).origin;
    const foreign = requests.filter((url) => !url.startsWith(origin) && url !== SDK_URL);
    expect(foreign).toEqual([]);
    expect(requests.filter((url) => url.startsWith("http://") && !url.startsWith(origin))).toEqual(
      [],
    );
  });

  test("has no fullscreen button, no links out, no cross-promotion", async ({ page }) => {
    await boot(page);
    await expect(page.locator("a[href]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /full ?screen/i })).toHaveCount(0);
    await expect(page.locator("iframe")).toHaveCount(0);
  });
});
