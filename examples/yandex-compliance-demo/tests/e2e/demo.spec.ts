// End-to-end: the built demo, driven through every lifecycle moment Yandex moderation
// checks, on desktop, phone and tablet.
//
// Each test names the requirement it exercises (https://yandex.com/dev/games/doc/en/
// concepts/requirements). The SDK is the mock in mock-sdk.js, so these prove the game makes
// the documented calls at the documented moments — not that the real portal accepts them.
//
// Tab visibility is emulated by overriding document.visibilityState and dispatching the
// event: headless Chromium has no tab strip to switch away from. Everything else is real —
// real clicks, taps and key presses against the production bundle.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const MOCK_SDK = readFileSync(resolve(import.meta.dirname, "mock-sdk.js"), "utf8");

interface MockConfig {
  lang?: string;
  launchAdMs?: number;
  fullscreen?: "show" | "unshown" | "error" | "never";
  rewarded?: "complete" | "skip" | "error";
  adMs?: number;
  playerError?: boolean;
}

interface Session {
  readonly errors: string[];
  readonly requests: string[];
}

interface OpenOptions {
  readonly sdk?: MockConfig | "missing";
  /**
   * Every star spawns at the far right, so a centred basket misses them all. Otherwise every
   * star falls dead centre onto the untouched basket and a run never ends by itself — tests
   * about pausing or resizing must not race a game over on a slow machine.
   */
  readonly loseFast?: boolean;
}

async function open(page: Page, options: OpenOptions = {}): Promise<Session> {
  const session: Session = { errors: [], requests: [] };
  page.on("pageerror", (error) => session.errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") session.errors.push(`console: ${message.text()}`);
  });
  page.on("request", (request) => session.requests.push(request.url()));

  await page.route("**/sdk.js", (route) =>
    options.sdk === "missing"
      ? route.fulfill({ status: 404, body: "not found" })
      : route.fulfill({ contentType: "application/javascript", body: MOCK_SDK }),
  );
  await page.addInitScript(
    ({ config, loseFast }) => {
      (window as unknown as { __ysdkMockConfig: unknown }).__ysdkMockConfig = config;
      Math.random = loseFast ? () => 0.99 : () => 0.5;
    },
    { config: options.sdk === "missing" ? {} : (options.sdk ?? {}), loseFast: !!options.loseFast },
  );
  await page.goto("/");
  await expect(page.locator("#ui")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
  return session;
}

const calls = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    (window as unknown as { __ysdk: { calls: Array<{ name: string }> } }).__ysdk.calls.map(
      (call) => call.name,
    ),
  );

const count = async (page: Page, name: string): Promise<number> =>
  (await calls(page)).filter((call) => call === name).length;

function demo<T>(page: Page, field: string): Promise<T> {
  return page.evaluate(
    (key) => (window as unknown as { __demo__: Record<string, () => unknown> }).__demo__[key]!(),
    field,
  ) as Promise<T>;
}

const touch = (info: TestInfo): boolean => !!info.project.use.hasTouch;

async function press(page: Page, info: TestInfo, action: string): Promise<void> {
  const button = page.locator(`#ui button[data-action="${action}"]:visible`).first();
  await expect(button).toBeEnabled();
  if (touch(info)) await button.tap();
  else await button.click();
}

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

/** Fire a portal event through the mock, which also applies the portal's auto start/stop. */
async function portal(page: Page, event: "game_api_pause" | "game_api_resume"): Promise<void> {
  await page.evaluate((name) => {
    (window as unknown as { __ysdk: { fire: (event: string) => void } }).__ysdk.fire(name);
  }, event);
}

/** The portal's own view of GameplayAPI — the debug panel's gamepad indicator. */
const portalGameplay = (page: Page): Promise<boolean> =>
  page.evaluate(() => (window as unknown as { __ysdk: { gameplay: boolean } }).__ysdk.gameplay);

async function steerLeft(page: Page, info: TestInfo): Promise<void> {
  const box = (await page.locator("#game canvas").boundingBox())!;
  if (touch(info)) await page.touchscreen.tap(box.x + 5, box.y + box.height / 2);
  else await page.mouse.move(box.x + 5, box.y + box.height / 2);
}

async function playUntilOver(page: Page, info: TestInfo): Promise<void> {
  await press(page, info, "play");
  await expect.poll(() => demo<string>(page, "phase"), { timeout: 120_000 }).toBe("over");
}

const screen = (page: Page) => page.locator("#ui");

test.describe("boot and SDK lifecycle", () => {
  test("initialises the SDK and sends Game Ready once, with the menu interactive (1.19.2)", async ({
    page,
  }) => {
    const session = await open(page);
    const log = await page.evaluate(
      () =>
        (
          window as unknown as {
            __ysdk: { calls: Array<{ name: string; menuVisible?: boolean; bootGone?: boolean }> };
          }
        ).__ysdk.calls,
    );
    const names = log.map((call) => call.name);
    expect(names.filter((name) => name === "YaGames.init")).toHaveLength(1);
    expect(names.filter((name) => name === "LoadingAPI.ready")).toHaveLength(1);
    const ready = log.find((call) => call.name === "LoadingAPI.ready")!;
    expect(ready.menuVisible).toBe(true);
    expect(ready.bootGone).toBe(true);
    // Pause/resume subscribed before Game Ready — the launch ad can arrive at any time.
    expect(names.indexOf("on:game_api_pause")).toBeLessThan(names.indexOf("LoadingAPI.ready"));
    // No gameplay and no ad before the player has played.
    expect(names).not.toContain("GameplayAPI.start");
    expect(names).not.toContain("showFullscreenAdv");
    await expect(screen(page)).toHaveAttribute("data-screen", "menu");
    expect(session.errors).toEqual([]);
  });

  test("boots and plays without the SDK (script missing)", async ({ page }, info) => {
    const session = await open(page, { sdk: "missing" });
    await press(page, info, "play");
    await expect(screen(page)).toHaveAttribute("data-screen", "playing");
    expect(session.errors.filter((e) => !e.includes("404"))).toEqual([]);
  });

  test("holds the game through the portal's launch ad (sdk-events)", async ({ page }) => {
    // Long enough to outlast boot on any machine; the test ends the ad itself.
    await open(page, { sdk: { launchAdMs: 600_000 } });
    // The launch ad raised game_api_pause before any callback: the game is on hold.
    expect(await demo<boolean>(page, "foreground")).toBe(false);
    const frames = await page.evaluate(() => window.__wgf__!.framesRendered());
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__wgf__!.framesRendered())).toBe(frames);
    await portal(page, "game_api_resume");
    expect(await demo<boolean>(page, "foreground")).toBe(true);
    await expect
      .poll(() => page.evaluate(() => window.__wgf__!.framesRendered()))
      .toBeGreaterThan(frames);
  });

  test("makes no request outside its own origin (CSP, 8.4)", async ({ page }, info) => {
    const session = await open(page);
    await press(page, info, "play");
    await page.waitForTimeout(500);
    const origin = new URL(page.url()).origin;
    expect(session.requests.filter((url) => new URL(url).origin !== origin)).toEqual([]);
  });
});

test.describe("localisation (2.14)", () => {
  for (const [lang, locale, title] of [
    ["ru", "ru", "Звёздная корзина"],
    ["en", "en", "Starfall Basket"],
    ["kk", "ru", "Звёздная корзина"],
    ["tr", "en", "Starfall Basket"],
  ] as const) {
    test(`platform language ${lang} -> ${locale}`, async ({ page }) => {
      await open(page, { sdk: { lang } });
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.locator('section[data-screen="menu"] h1')).toHaveText(title);
      await expect(page).toHaveTitle(title);
    });
  }

  test("follows the portal, not the browser", async ({ browser }) => {
    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();
    await open(page, { sdk: { lang: "ru" } });
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
    await context.close();
  });
});

test("a locale file that fails to load shows English, never raw keys (1.14)", async ({ page }) => {
  await page.route("**/locales/*.json", (route) => route.fulfill({ status: 404, body: "" }));
  await open(page, { sdk: { lang: "ru" } });
  await expect(page.locator('section[data-screen="menu"] h1')).toHaveText("Starfall Basket");
  await expect(page.locator('#ui button[data-action="play"]')).toHaveText("Play");
});

test.describe("page behaviour (1.6.1.8, 1.6.2.7, 1.10.2)", () => {
  test("cancels the context menu and text selection", async ({ page }) => {
    await open(page);
    const cancelled = await page.evaluate(() => {
      const target = document.querySelector("#game canvas") ?? document.body;
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      const select = new Event("selectstart", { bubbles: true, cancelable: true });
      document.body.dispatchEvent(select);
      return { menu: event.defaultPrevented, select: select.defaultPrevented };
    });
    expect(cancelled).toEqual({ menu: true, select: true });
    const style = await page.evaluate(() => {
      const css = getComputedStyle(document.body);
      return { userSelect: css.userSelect, touchAction: css.touchAction };
    });
    expect(style).toEqual({ userSelect: "none", touchAction: "none" });
  });

  test("never scrolls the page", async ({ page }, info) => {
    await open(page);
    await press(page, info, "play");
    for (const key of ["ArrowDown", "Space", "ArrowUp", "PageDown"]) await page.keyboard.press(key);
    if (!touch(info)) await page.mouse.wheel(0, 800);
    else await page.touchscreen.tap(10, 10);
    const scroll = await page.evaluate(() => ({
      y: window.scrollY,
      over: document.documentElement.scrollHeight - window.innerHeight,
    }));
    expect(scroll.y).toBe(0);
    expect(scroll.over).toBeLessThanOrEqual(0);
  });

  test("fills the viewport and survives resizing and rotation (1.6.2.1, 1.10)", async ({
    page,
  }, info) => {
    await open(page);
    await press(page, info, "play");
    await expect(screen(page)).toHaveAttribute("data-screen", "playing");
    const size = page.viewportSize()!;
    for (const next of [
      { width: size.height, height: size.width },
      { width: 800, height: 600 },
      size,
    ]) {
      await page.setViewportSize(next);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const canvas = document.querySelector("#game canvas")!.getBoundingClientRect();
            return [Math.round(canvas.width), Math.round(canvas.height)];
          }),
        )
        .toEqual([next.width, next.height]);
      // Every visible control fits on screen (1.10.1, 1.10.3).
      const outside = await page.evaluate(
        () =>
          [...document.querySelectorAll("#ui button")]
            .filter((button) => (button as HTMLElement).offsetParent !== null)
            .filter((button) => {
              const box = button.getBoundingClientRect();
              return (
                box.left < 0 || box.top < 0 || box.right > innerWidth || box.bottom > innerHeight
              );
            }).length,
      );
      expect(outside).toBe(0);
    }
    expect(await demo<string>(page, "phase")).toBe("playing");
    // The same checks with the pause screen up: its buttons must fit after rotation too.
    await press(page, info, "pause");
    await page.setViewportSize({ width: size.height, height: size.width });
    await expect(screen(page)).toHaveAttribute("data-screen", "paused");
    const clipped = await page.evaluate(
      () =>
        [...document.querySelectorAll('section[data-screen="paused"] button')]
          .map((button) => button.getBoundingClientRect())
          .filter(
            (box) =>
              box.left < 0 || box.top < 0 || box.right > innerWidth || box.bottom > innerHeight,
          ).length,
    );
    expect(clipped).toBe(0);
  });

  test("buttons are big enough to hit (1.8)", async ({ page }) => {
    await open(page);
    const small = await page.evaluate(
      () =>
        [...document.querySelectorAll("#ui button")]
          .filter((button) => (button as HTMLElement).offsetParent !== null)
          .map((button) => button.getBoundingClientRect())
          .filter((box) => box.width < 44 || box.height < 44).length,
    );
    expect(small).toBe(0);
  });
});

test.describe("controls (1.6.1.5, 1.6.2.4)", () => {
  test("steers with the platform's primary input", async ({ page }, info) => {
    await open(page);
    await press(page, info, "play");
    const start = await demo<number>(page, "basketX");
    const box = (await page.locator("#game canvas").boundingBox())!;
    if (touch(info)) {
      await page.touchscreen.tap(box.x + 5, box.y + box.height / 2);
    } else {
      await page.mouse.move(box.x + 5, box.y + box.height / 2);
    }
    await expect.poll(() => demo<number>(page, "basketX")).toBeLessThan(start);
  });

  test("steers with the keyboard by physical key", async ({ page }, info) => {
    test.skip(touch(info), "keyboard is a desktop control");
    await open(page);
    await press(page, info, "play");
    const start = await demo<number>(page, "basketX");
    await page.keyboard.down("ArrowRight");
    await expect.poll(() => demo<number>(page, "basketX")).toBeGreaterThan(start);
    await page.keyboard.up("ArrowRight");
    const moved = await demo<number>(page, "basketX");
    // KeyA is the physical A key: a Russian layout types "ф" but must still steer.
    await page.keyboard.down("KeyA");
    await expect.poll(() => demo<number>(page, "basketX")).toBeLessThan(moved);
    await page.keyboard.up("KeyA");
  });
});

test.describe("gameplay markup and pause (1.19.3, 1.19.4, 1.3)", () => {
  test("GameplayAPI brackets exactly the time a run is on screen", async ({ page }, info) => {
    await open(page);
    expect(await count(page, "GameplayAPI.start")).toBe(0);

    await press(page, info, "play");
    await expect.poll(() => count(page, "GameplayAPI.start")).toBe(1);

    await press(page, info, "pause");
    await expect(screen(page)).toHaveAttribute("data-screen", "paused");
    await expect.poll(() => count(page, "GameplayAPI.stop")).toBe(1);

    await press(page, info, "resume");
    await expect.poll(() => count(page, "GameplayAPI.start")).toBe(2);

    await press(page, info, "pause");
    await press(page, info, "menu");
    await expect(screen(page)).toHaveAttribute("data-screen", "menu");
    const log = await calls(page);
    const markup = log.filter((name) => name.startsWith("GameplayAPI."));
    // Strictly alternating, ending stopped.
    expect(markup).toEqual([
      "GameplayAPI.start",
      "GameplayAPI.stop",
      "GameplayAPI.start",
      "GameplayAPI.stop",
    ]);
  });

  test("a hidden tab silences audio within 2 s and holds the run (1.3)", async ({ page }, info) => {
    await open(page);
    await press(page, info, "play");
    await expect.poll(() => demo<string>(page, "audio")).toBe("running");

    await setHidden(page, true);
    await expect.poll(() => demo<string>(page, "audio"), { timeout: 2_000 }).toBe("suspended");
    expect((await calls(page)).at(-1)).toBe("GameplayAPI.stop");
    const frames = await page.evaluate(() => window.__wgf__!.framesRendered());
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__wgf__!.framesRendered())).toBe(frames);

    await setHidden(page, false);
    // Back to the tab: the run waits for the player rather than resuming mid-fall.
    await expect(screen(page)).toHaveAttribute("data-screen", "paused");
    expect(await demo<string>(page, "audio")).toBe("suspended");
    await press(page, info, "resume");
    await expect.poll(() => demo<string>(page, "audio")).toBe("running");
    expect((await calls(page)).at(-1)).toBe("GameplayAPI.start");
  });

  test("game_api_pause from the portal pauses and mutes; resume waits for the player", async ({
    page,
  }, info) => {
    await open(page);
    await press(page, info, "play");
    await expect.poll(() => demo<string>(page, "audio")).toBe("running");

    await portal(page, "game_api_pause");
    await expect.poll(() => demo<string>(page, "audio"), { timeout: 2_000 }).toBe("suspended");
    await expect(screen(page)).toHaveAttribute("data-screen", "paused");

    await portal(page, "game_api_resume");
    await expect(screen(page)).toHaveAttribute("data-screen", "paused");
    // The portal restarts GameplayAPI on resume by itself; the game is still on its pause
    // screen, so the indicator must end up stopped (1.19.3).
    await expect.poll(() => portalGameplay(page)).toBe(false);
    await press(page, info, "resume");
    await expect.poll(() => demo<string>(page, "audio")).toBe("running");
    expect(await portalGameplay(page)).toBe(true);
  });
});

test.describe("saves (1.9)", () => {
  test("the record is written at game over and survives a reload", async ({ page }, info) => {
    await open(page, { loseFast: true });
    await press(page, info, "play");
    // Every star falls at the far right: hold right to catch one, then steer away to lose.
    await page.keyboard.down("ArrowRight");
    await expect.poll(() => demo<number>(page, "score"), { timeout: 90_000 }).toBeGreaterThan(0);
    await page.keyboard.up("ArrowRight");
    await steerLeft(page, info);
    await expect.poll(() => demo<string>(page, "phase"), { timeout: 120_000 }).toBe("over");

    const best = await demo<number>(page, "best");
    expect(best).toBeGreaterThan(0);
    await expect.poll(() => count(page, "setData")).toBeGreaterThan(0);

    // Clear the game's local mirror: the value must come back from the player data.
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("yandex-compliance-demo:")) localStorage.removeItem(key);
      }
    });
    await page.reload();
    await expect(page.locator("#ui")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
    expect(await demo<number>(page, "best")).toBe(best);
    await expect(page.locator('[data-role="menu-best"]')).toContainText(String(best));
  });

  test("keeps the record locally when the player cannot be fetched", async ({ page }, info) => {
    await open(page, { loseFast: true, sdk: { playerError: true } });
    await press(page, info, "play");
    await page.keyboard.down("ArrowRight");
    await expect.poll(() => demo<number>(page, "score"), { timeout: 90_000 }).toBeGreaterThan(0);
    await page.keyboard.up("ArrowRight");
    await steerLeft(page, info);
    await expect.poll(() => demo<string>(page, "phase"), { timeout: 120_000 }).toBe("over");
    const best = await demo<number>(page, "best");
    expect(await count(page, "setData")).toBe(0);

    await page.reload();
    await expect(page.locator("#ui")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
    expect(await demo<number>(page, "best")).toBe(best);
  });
});

test.describe("ads (4.4, 4.5, 4.7)", () => {
  test("interstitial only on 'play again', with sound and gameplay held", async ({
    page,
  }, info) => {
    await open(page, { loseFast: true, sdk: { adMs: 5_000 } });
    await playUntilOver(page, info);
    expect(await count(page, "showFullscreenAdv")).toBe(0);

    await press(page, info, "again");
    await expect.poll(() => count(page, "fullscreen:open")).toBe(1);
    // While the ad is up: no sound, no simulation, gameplay reported stopped.
    expect(await demo<string>(page, "audio")).not.toBe("running");
    const frames = await page.evaluate(() => window.__wgf__!.framesRendered());
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__wgf__!.framesRendered())).toBe(frames);
    const beforeClose = await calls(page);
    expect(beforeClose.filter((n) => n.startsWith("GameplayAPI.")).at(-1)).toBe("GameplayAPI.stop");

    await expect.poll(() => demo<string>(page, "phase"), { timeout: 30_000 }).toBe("playing");
    const log = await calls(page);
    expect(log.indexOf("GameplayAPI.start", log.indexOf("fullscreen:close"))).toBeGreaterThan(-1);
    await expect.poll(() => demo<string>(page, "audio")).toBe("running");
  });

  test("a failed interstitial never blocks the next run", async ({ page }, info) => {
    await open(page, { loseFast: true, sdk: { fullscreen: "error" } });
    await playUntilOver(page, info);
    await press(page, info, "again");
    await expect.poll(() => demo<string>(page, "phase")).toBe("playing");
  });

  test("rewarded continue grants one life only after the reward, once per run", async ({
    page,
  }, info) => {
    await open(page, { loseFast: true });
    await playUntilOver(page, info);
    const revive = page.locator('#ui button[data-action="revive"]');
    await expect(revive).toBeVisible();
    await expect(revive).toHaveClass(/\bad\b/);

    await press(page, info, "revive");
    await expect.poll(() => demo<string>(page, "phase"), { timeout: 30_000 }).toBe("playing");
    expect(await demo<number>(page, "lives")).toBe(1);
    const log = await calls(page);
    expect(log).toContain("rewarded:granted");

    await expect.poll(() => demo<string>(page, "phase"), { timeout: 120_000 }).toBe("over");
    await expect(revive).toBeHidden();
  });

  test("no reward when the rewarded ad is not finished", async ({ page }, info) => {
    await open(page, { loseFast: true, sdk: { rewarded: "skip" } });
    await playUntilOver(page, info);
    await press(page, info, "revive");
    await expect(page.locator('[data-role="note"]')).not.toBeEmpty({ timeout: 5_000 });
    expect(await demo<string>(page, "phase")).toBe("over");
    // Still free to play on without an ad (4.5.2: the reward is a bonus, not a gate).
    await press(page, info, "again");
    await expect.poll(() => demo<string>(page, "phase")).toBe("playing");
  });
});
