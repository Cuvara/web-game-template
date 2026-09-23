// The Poki compliance demo, driven end to end against its production build.
//
// Every test runs on desktop, mobile and tablet (see playwright.poki.config.ts). The mock
// SDK referees Poki's sequencing rules independently of the adapter, and afterEach fails
// any test that produced a violation, a page error, or a request that left the page's
// origin for anywhere but Poki's SDK URL.
//
// Deaths are made deterministic by fixing Math.random: at 0.5 every block falls on the
// player's starting column, at 0 every block falls down the left edge and misses.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const SDK_URL = "https://game-cdn.poki.com/scripts/v2/poki-sdk.js";
const MOCK_SDK = readFileSync(resolve(import.meta.dirname, "mock-poki-sdk.js"), "utf8");

interface MockConfig {
  init?: "resolve" | "reject" | "hang";
  commercial?: "play" | "none" | "error";
  rewarded?: "reward" | "no-reward" | "none" | "error";
  adMs?: number;
  adClick?: boolean;
}

interface BootOptions {
  mock?: MockConfig;
  /** "block" plays an ad blocker: the SDK request fails. */
  sdk?: "mock" | "block";
  /** Fixed Math.random. 0.5 kills an idle player quickly; 0 never hits them. */
  random?: number;
  /** Simulated private browsing: every storage API throws. */
  restrictedStorage?: boolean;
}

const pageErrors = new WeakMap<Page, string[]>();
const externalRequests = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page, baseURL }) => {
  const errors: string[] = [];
  const external: string[] = [];
  pageErrors.set(page, errors);
  externalRequests.set(page, external);
  page.on("pageerror", (error) => errors.push(error.message));
  // Any console output at all counts: Poki asks for a clean build, and the audit can only
  // say that library logging exists, not that it never runs. This is where "never" is shown.
  page.on("console", (message) => {
    // Chromium's own GPU driver notices (headless software GL) are the browser talking,
    // not the game.
    if (/^\[\.WebGL-[0-9a-fx]+\]GL Driver Message/.test(message.text())) return;
    errors.push(`console.${message.type()}: ${message.text()}`);
  });
  page.on("request", (request) => {
    const url = request.url();
    if (url.startsWith(baseURL!) || url.startsWith("data:") || url.startsWith("blob:")) return;
    if (url === SDK_URL) return;
    external.push(url);
  });
});

test.afterEach(async ({ page }) => {
  const violations = await page.evaluate(
    () => (window as { __pokiViolations?: string[] }).__pokiViolations ?? [],
  );
  expect(violations, "Poki sequencing violations").toEqual([]);
  // The ad-block test aborts the SDK on purpose; that one failed request is expected.
  const errors = (pageErrors.get(page) ?? []).filter(
    (e) => !/ERR_BLOCKED_BY_CLIENT|Failed to load resource/.test(e),
  );
  expect(errors, "page errors").toEqual([]);
  expect(externalRequests.get(page), "requests leaving the origin").toEqual([]);
});

async function boot(page: Page, options: BootOptions = {}): Promise<void> {
  await page.addInitScript((config) => {
    (window as { __pokiMock?: unknown }).__pokiMock = config;
  }, options.mock ?? {});

  if (options.random !== undefined) {
    await page.addInitScript((value) => {
      Math.random = () => value;
    }, options.random);
  }

  if (options.restrictedStorage) {
    await page.addInitScript(() => {
      const deny = (): never => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      };
      for (const name of ["localStorage", "sessionStorage", "indexedDB"]) {
        Object.defineProperty(window, name, { configurable: true, get: deny });
      }
      Object.defineProperty(Document.prototype, "cookie", {
        configurable: true,
        get: deny,
        set: deny,
      });
    });
  }

  await page.route(SDK_URL, (route) =>
    options.sdk === "block"
      ? route.abort("blockedbyclient")
      : route.fulfill({ contentType: "application/javascript", body: MOCK_SDK }),
  );

  await page.goto("/");
  await expect(hud(page)).toHaveAttribute("data-state", "title", { timeout: 20_000 });
}

const hud = (page: Page) => page.locator("#hud");
const calls = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as { __pokiCalls?: string[] }).__pokiCalls ?? []);
const adSnapshots = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as {
          __pokiAdSnapshots?: Array<{
            kind: string;
            audio: string;
            state: string;
            gameInert: boolean;
            adInert: boolean;
          }>;
        }
      ).__pokiAdSnapshots ?? [],
  );

/** Tap on touch devices, click elsewhere — the input each device really produces. */
async function press(page: Page, selector: string): Promise<void> {
  const target = page.locator(selector);
  if (test.info().project.use.hasTouch) await target.tap();
  else await target.click();
}

async function playUntilDeath(page: Page): Promise<void> {
  await press(page, "#play");
  await expect(hud(page)).toHaveAttribute("data-state", "playing");
  await expect(hud(page)).toHaveAttribute("data-state", "gameover", { timeout: 15_000 });
}

test.describe("SDK lifecycle", () => {
  test("the title screen is interactive within 5 seconds", async ({ page }) => {
    const started = Date.now();
    await boot(page);
    // Wall clock from navigation to an interactive title, served locally. The Factory's Poki
    // profile warns above 5 s; real networks add download time, which Poki Inspector reports.
    expect(Date.now() - started).toBeLessThan(5_000);
    await expect(page.locator("#play")).toBeEnabled();
  });

  test("loading finishes before any gameplay, and gameplay waits for the first input", async ({
    page,
  }) => {
    await boot(page);
    expect(await calls(page)).toEqual(["init", "gameLoadingFinished"]);

    // Idle on the title screen: still no gameplayStart.
    await page.waitForTimeout(500);
    expect(await calls(page)).toEqual(["init", "gameLoadingFinished"]);

    await press(page, "#play");
    await expect.poll(() => calls(page)).toEqual(["init", "gameLoadingFinished", "gameplayStart"]);
  });

  test("pause and resume: gameplayStop -> commercialBreak -> gameplayStart", async ({ page }) => {
    await boot(page, { random: 0 });
    await press(page, "#play");
    await expect(hud(page)).toHaveAttribute("data-state", "playing");

    if (test.info().project.use.hasTouch) await press(page, "#pause-button");
    else await page.keyboard.press("Escape");
    await expect(hud(page)).toHaveAttribute("data-state", "paused");

    await press(page, "#resume");
    await expect(hud(page)).toHaveAttribute("data-state", "playing");
    await expect
      .poll(() => calls(page))
      .toEqual([
        "init",
        "gameLoadingFinished",
        "gameplayStart",
        "gameplayStop",
        "commercialBreak",
        "gameplayStart",
      ]);
  });

  test("death and restart: gameplayStop -> commercialBreak -> gameplayStart", async ({ page }) => {
    await boot(page, { random: 0.5 });
    await playUntilDeath(page);
    await press(page, "#restart");
    await expect(hud(page)).toHaveAttribute("data-state", "playing");
    await expect
      .poll(() => calls(page))
      .toEqual([
        "init",
        "gameLoadingFinished",
        "gameplayStart",
        "gameplayStop",
        "commercialBreak",
        "gameplayStart",
      ]);
  });

  test("a hidden tab stops gameplay and does not restart it on return", async ({ page }) => {
    await boot(page, { random: 0 });
    await press(page, "#play");
    await expect(hud(page)).toHaveAttribute("data-state", "playing");

    const setVisibility = (state: "hidden" | "visible") =>
      page.evaluate((value) => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => value,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      }, state);

    await setVisibility("hidden");
    await expect(hud(page)).toHaveAttribute("data-state", "paused");
    await setVisibility("visible");
    await expect(hud(page)).toHaveAttribute("data-state", "paused");
    expect((await calls(page)).slice(-1)).toEqual(["gameplayStop"]);
  });
});

test.describe("ads", () => {
  test("a commercial break mutes audio and blocks input for its whole length", async ({ page }) => {
    await boot(page, { random: 0.5, mock: { adClick: true } });
    await playUntilDeath(page);
    await expect(hud(page)).toHaveAttribute("data-audio", "running");

    await press(page, "#restart");
    await expect(hud(page)).toHaveAttribute("data-ad", "commercial");
    await expect(page.locator("#mock-ad")).toBeVisible();

    // Input during the ad reaches nothing of the game's: its nodes are inert, and keys that
    // would pause or move are ignored.
    expect(await page.locator("#game").evaluate((el) => (el as HTMLElement).inert)).toBe(true);
    await page.keyboard.press("Escape");
    await page.keyboard.press("ArrowLeft");
    await expect(hud(page)).toHaveAttribute("data-ad", "commercial");

    // The ad itself stays usable: it is drawn in this document, like Poki's, and ends only
    // when its button is pressed.
    await press(page, "#mock-ad-close");
    await expect(hud(page)).toHaveAttribute("data-ad", "none", { timeout: 5_000 });
    await expect(hud(page)).toHaveAttribute("data-state", "playing");
    await expect(hud(page)).toHaveAttribute("data-audio", "running");
    expect(await page.locator("#game").evaluate((el) => (el as HTMLElement).inert)).toBe(false);

    const [snapshot] = await adSnapshots(page);
    expect(snapshot).toMatchObject({
      kind: "commercial",
      audio: "muted",
      gameInert: true,
      adInert: false,
    });
  });

  test("rewarded revive grants the reward only after Poki confirms it", async ({ page }) => {
    await boot(page, { random: 0.5, mock: { rewarded: "reward", adClick: true } });
    await playUntilDeath(page);

    // Poki's layout rules: the standard option is visible with the rewarded one, is at
    // least as large, sits above it, the rewarded one carries 🎬 and is not green.
    const restart = await page.locator("#restart").boundingBox();
    const revive = await page.locator("#revive").boundingBox();
    expect(restart && revive).toBeTruthy();
    expect(restart!.y).toBeLessThan(revive!.y);
    expect(restart!.width * restart!.height).toBeGreaterThanOrEqual(revive!.width * revive!.height);
    await expect(page.locator("#revive")).toContainText("🎬");
    const reviveColour = await page
      .locator("#revive")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    const [r, g, b] = reviveColour.match(/\d+/g)!.map(Number);
    expect(g! > r! && g! > b!, `revive button must not be green, got ${reviveColour}`).toBe(false);

    await press(page, "#revive");
    await expect(page.locator("#mock-ad")).toBeVisible();
    await press(page, "#mock-ad-close");
    await expect(hud(page)).toHaveAttribute("data-state", "playing");
    await expect(hud(page)).toHaveAttribute("data-revives", "1");
    await expect(page.locator("#toast")).toHaveAttribute("data-visible", "true");
    await expect
      .poll(() => calls(page))
      .toEqual([
        "init",
        "gameLoadingFinished",
        "gameplayStart",
        "gameplayStop",
        "rewardedBreak",
        "gameplayStart",
      ]);
    const [snapshot] = await adSnapshots(page);
    expect(snapshot).toMatchObject({
      kind: "rewarded",
      audio: "muted",
      gameInert: true,
      adInert: false,
    });

    // One revive per run: the offer is gone at the next death.
    await expect(hud(page)).toHaveAttribute("data-state", "gameover", { timeout: 15_000 });
    await expect(page.locator("#revive")).toBeHidden();
  });

  test("a rewarded ad closed early grants nothing and does not restart gameplay", async ({
    page,
  }) => {
    await boot(page, { random: 0.5, mock: { rewarded: "no-reward" } });
    await playUntilDeath(page);
    await press(page, "#revive");
    await expect(page.locator("#revive")).toBeHidden();
    await expect(hud(page)).toHaveAttribute("data-state", "gameover");
    expect(await hud(page).getAttribute("data-revives")).toBeNull();
    expect((await calls(page)).slice(-2)).toEqual(["gameplayStop", "rewardedBreak"]);
    // Play again still works.
    await press(page, "#restart");
    await expect(hud(page)).toHaveAttribute("data-state", "playing");
  });

  test("an unavailable ad (no fill) still resumes the game", async ({ page }) => {
    await boot(page, { random: 0.5, mock: { commercial: "none" } });
    await playUntilDeath(page);
    await press(page, "#restart");
    await expect(hud(page)).toHaveAttribute("data-state", "playing");
    await expect(hud(page)).toHaveAttribute("data-audio", "running");
  });

  test("a failing ad SDK call still resumes the game", async ({ page }) => {
    await boot(page, { random: 0.5, mock: { commercial: "error", rewarded: "error" } });
    await playUntilDeath(page);
    await press(page, "#revive");
    await expect(page.locator("#revive")).toBeHidden();
    await press(page, "#restart");
    await expect(hud(page)).toHaveAttribute("data-state", "playing");
  });
});

test.describe("ad blocker", () => {
  test("the game boots and stays playable when the SDK script is blocked", async ({ page }) => {
    let sdkRequests = 0;
    page.on("request", (request) => {
      if (request.url() === SDK_URL) sdkRequests += 1;
    });
    await boot(page, { sdk: "block", random: 0.5 });
    // Blocked once is enough: the adapter does not ask again for a script the page's own
    // <head> tag already failed to load.
    expect(sdkRequests).toBe(1);
    await expect(hud(page)).toHaveAttribute("data-sdk", "unavailable");
    await playUntilDeath(page);
    await press(page, "#revive");
    // No reward without an ad, and no custom "ad blocked" message — Poki handles that.
    await expect(page.locator("#revive")).toBeHidden();
    await expect(page.locator("body")).not.toContainText(/ad ?block/i);
    await press(page, "#restart");
    await expect(hud(page)).toHaveAttribute("data-state", "playing");
  });

  test("the game boots when the SDK loads but never finishes initialising", async ({ page }) => {
    test.setTimeout(45_000);
    // Poki: "Players tend to move to another game if loading takes more than 10 seconds."
    // A stalled SDK must not take the game past that on its own.
    const started = Date.now();
    await boot(page, { mock: { init: "hang" } });
    expect(Date.now() - started).toBeLessThan(10_000);
    await expect(hud(page)).toHaveAttribute("data-sdk", "unavailable");
    await press(page, "#play");
    await expect(hud(page)).toHaveAttribute("data-state", "playing");
  });

  test("the game boots when init rejects", async ({ page }) => {
    await boot(page, { mock: { init: "reject" }, random: 0.5 });
    await playUntilDeath(page);
    await press(page, "#restart");
    await expect(hud(page)).toHaveAttribute("data-state", "playing");
  });
});

test.describe("storage", () => {
  test("progress is saved and loaded", async ({ page }) => {
    await boot(page, { random: 0 });
    await press(page, "#play");
    await expect
      .poll(async () => Number(await hud(page).getAttribute("data-score")), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(2);

    // Walk into the blocks falling down the left edge.
    if (test.info().project.use.hasTouch) {
      await page.locator("#touch-left").dispatchEvent("pointerdown");
    } else {
      await page.keyboard.down("ArrowLeft");
    }
    await expect(hud(page)).toHaveAttribute("data-state", "gameover", { timeout: 15_000 });
    const best = Number(await hud(page).getAttribute("data-best"));
    expect(best).toBeGreaterThanOrEqual(2);

    await page.reload();
    await expect(hud(page)).toHaveAttribute("data-state", "title", { timeout: 20_000 });
    await expect(hud(page)).toHaveAttribute("data-best", String(best));
    await expect(hud(page)).toHaveAttribute("data-runs", "1");
    await expect(page.locator("#save-notice")).toBeHidden();
  });

  test("private browsing: storage that throws does not stop the game", async ({ page }) => {
    await boot(page, { restrictedStorage: true, random: 0.5 });
    await expect(hud(page)).toHaveAttribute("data-persistent", "false");
    // Poki: "clearly inform players when progress won't persist".
    await expect(page.locator("#save-notice")).toBeVisible();
    await playUntilDeath(page);
    await press(page, "#restart");
    await expect(hud(page)).toHaveAttribute("data-state", "playing");
  });
});

test.describe("layout and input", () => {
  test("the canvas covers the viewport and the page never scrolls", async ({ page }) => {
    await boot(page);
    const viewport = page.viewportSize()!;
    const box = (await page.locator("#game canvas").boundingBox())!;
    expect(Math.round(box.width)).toBe(viewport.width);
    expect(Math.round(box.height)).toBe(viewport.height);
    const scroll = await page.evaluate(() => ({
      width: document.scrollingElement!.scrollWidth,
      height: document.scrollingElement!.scrollHeight,
    }));
    expect(scroll.width).toBeLessThanOrEqual(viewport.width);
    expect(scroll.height).toBeLessThanOrEqual(viewport.height);
  });

  test("the control scheme matches the device", async ({ page }) => {
    await boot(page);
    const touch = !!test.info().project.use.hasTouch;
    await expect(hud(page)).toHaveAttribute("data-scheme", touch ? "touch" : "keyboard");
    await expect(page.locator("#touch-controls")).toHaveAttribute("data-visible", String(touch));
  });
});

test.describe("desktop", () => {
  test.beforeEach(() => {
    test.skip(!!test.info().project.use.hasTouch, "desktop only");
  });

  for (const [width, height] of [
    [640, 360],
    [836, 470],
    [1031, 580],
    [1280, 720],
    [1920, 1080],
  ] as const) {
    test(`16:9 at ${width}x${height} fills the frame with a 1280x720 world`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await boot(page);
      // 836x470 is 16:9 to within a pixel, so the world may be a unit wider.
      const [worldWidth, worldHeight] = (await hud(page).getAttribute("data-world"))!
        .split("x")
        .map(Number);
      expect(Math.abs(worldWidth! - 1280)).toBeLessThanOrEqual(2);
      expect(worldHeight).toBe(720);
      const box = (await page.locator("#game canvas").boundingBox())!;
      expect(Math.round(box.width)).toBe(width);
      expect(Math.round(box.height)).toBe(height);
      await expect(page.locator("#play")).toBeInViewport();
    });
  }

  test("Space and the arrow keys do not scroll the host page, nor does the wheel", async ({
    page,
  }) => {
    await boot(page);
    const prevented = await page.evaluate(() => {
      const fire = (event: Event): boolean => {
        window.dispatchEvent(event);
        return event.defaultPrevented;
      };
      return {
        space: fire(new KeyboardEvent("keydown", { key: " ", cancelable: true })),
        down: fire(new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true })),
        up: fire(new KeyboardEvent("keydown", { key: "ArrowUp", cancelable: true })),
        wheel: fire(new WheelEvent("wheel", { deltaY: 100, cancelable: true })),
      };
    });
    expect(prevented).toEqual({ space: true, down: true, up: true, wheel: true });
  });

  test("the keyboard moves the player", async ({ page }) => {
    await boot(page, { random: 0 });
    await page.keyboard.press("Enter");
    await expect(hud(page)).toHaveAttribute("data-state", "playing");
    const start = Number(await hud(page).getAttribute("data-player-x"));
    await page.keyboard.down("ArrowRight");
    await expect
      .poll(async () => Number(await hud(page).getAttribute("data-player-x")))
      .toBeGreaterThan(start + 50);
    await page.keyboard.up("ArrowRight");
  });
});

test.describe("mobile and tablet", () => {
  test.beforeEach(() => {
    test.skip(!test.info().project.use.hasTouch, "touch devices only");
  });

  test("touch buttons move the player", async ({ page }) => {
    await boot(page, { random: 0 });
    await press(page, "#play");
    await expect(hud(page)).toHaveAttribute("data-state", "playing");
    const start = Number(await hud(page).getAttribute("data-player-x"));
    await page.locator("#touch-right").dispatchEvent("pointerdown");
    await expect
      .poll(async () => Number(await hud(page).getAttribute("data-player-x")))
      .toBeGreaterThan(start + 50);
    await page.locator("#touch-right").dispatchEvent("pointerup");
  });

  test("rotating between portrait and landscape keeps the frame covered", async ({ page }) => {
    await boot(page);
    const portrait = page.viewportSize()!;
    for (const size of [{ width: portrait.height, height: portrait.width }, portrait]) {
      await page.setViewportSize(size);
      await expect
        .poll(async () => {
          const box = (await page.locator("#game canvas").boundingBox())!;
          return [Math.round(box.width), Math.round(box.height)];
        })
        .toEqual([size.width, size.height]);
      await expect(hud(page)).toHaveAttribute("data-viewport", `${size.width}x${size.height}`);
      await expect(page.locator("#play")).toBeInViewport();
    }
  });

  test("audio starts on the first tap", async ({ page }) => {
    await boot(page);
    await expect(hud(page)).toHaveAttribute("data-audio", "locked");
    await press(page, "#play");
    await expect(hud(page)).toHaveAttribute("data-audio", "running");
  });
});

test.describe("external requests", () => {
  // Poki enforces its external-resources policy with a Content-Security-Policy. The exact
  // policy is Poki's; this one is at least as strict where it matters: nothing but this
  // origin and Poki's SDK host, and no eval.
  const CSP = [
    "default-src 'self'",
    "script-src 'self' https://game-cdn.poki.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "font-src 'self'",
    "media-src 'self' blob:",
  ].join("; ");

  test("the game runs under a strict CSP without 'unsafe-eval'", async ({ page, baseURL }) => {
    await page.addInitScript(() => {
      const seen: string[] = ((window as { __csp?: string[] }).__csp = []);
      document.addEventListener("securitypolicyviolation", (event) =>
        seen.push(`${event.violatedDirective} ${event.blockedURI}`),
      );
    });
    await page.route(`${baseURL}/`, async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: { ...response.headers(), "content-security-policy": CSP },
      });
    });

    await boot(page, { random: 0.5 });
    await playUntilDeath(page);
    await press(page, "#restart");
    await expect(hud(page)).toHaveAttribute("data-state", "playing");
    expect(await page.evaluate(() => (window as { __csp?: string[] }).__csp)).toEqual([]);

    // Control: the policy really was in force, so the run above proved something.
    // page.evaluate bypasses CSP, so the probe is a script element the page itself adds —
    // an inline script, which this policy forbids. Its expected console error is dropped.
    const errors = pageErrors.get(page)!;
    const errorsBefore = errors.length;
    const inlineRan = await page.evaluate(async () => {
      const script = document.createElement("script");
      script.textContent = "window.__inlineRan = true";
      document.head.appendChild(script);
      await new Promise((resolve) => setTimeout(resolve, 50));
      return (window as { __inlineRan?: boolean }).__inlineRan === true;
    });
    expect(inlineRan, "CSP was not enforced — the test proved nothing").toBe(false);
    expect(errors.slice(errorsBefore).every((e) => e.includes("Content Security Policy"))).toBe(
      true,
    );
    errors.splice(errorsBefore);
  });
});
