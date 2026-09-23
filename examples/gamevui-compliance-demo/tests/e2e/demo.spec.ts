// The demo, driven the way a player and a portal would drive it.
//
// `[probe:<name>]` in a title ties the test to a requirement in compliance/requirements.mjs.
// `measure:<name>` annotations record values for requirements whose threshold is UNKNOWN —
// they are reported, never compared against an invented limit.

import { expect, test, type Frame, type Page } from "@playwright/test";

type Target = Page | Frame;

const probe = <T>(target: Target, expression: string): Promise<T> =>
  target.evaluate(`window.__gvdemo__.${expression}`) as Promise<T>;

async function ready(target: Target): Promise<void> {
  await expect(target.locator("body")).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
}

async function startRound(target: Target): Promise<void> {
  await target.locator("#play").click();
  await expect.poll(() => probe<string>(target, "phase()")).toBe("playing");
}

function measure(name: string, value: number): void {
  test.info().annotations.push({ type: `measure:${name}`, description: String(value) });
}

test("[probe:boots] boots in the browser with no errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/");
  await ready(page);
  await expect(page.locator("#game canvas")).toBeVisible();
  await expect(page.locator("#title-screen")).toBeVisible();

  measure("time_to_interactive_ms", Math.round(await probe<number>(page, "timeToInteractiveMs")));
  expect(await probe<string>(page, "platformId")).toBe("generic-web");
  expect(errors).toEqual([]);
});

test("[probe:loading_screen] shows loading progress, then clears it", async ({ page }) => {
  // Hold the string table back so the loading screen is observable, not a one-frame flash.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/locales/*.json", async (route) => {
    await held;
    await route.continue();
  });

  await page.goto("/");
  await expect(page.locator("#loading")).toBeVisible();
  await expect
    .poll(async () =>
      page.locator("#loading-bar").evaluate((el) => parseFloat(getComputedStyle(el).width)),
    )
    .toBeGreaterThan(0);
  release();

  await ready(page);
  await expect(page.locator("#loading")).toBeHidden();
});

test("[probe:vi_default] Vietnamese by default, English on request", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "vi");
  await expect(page.locator("#title-heading")).toHaveText("Hứng Sao");
  await expect(page.locator("#play")).toHaveText("Chơi");

  await page.goto("/?lang=en");
  await ready(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("#title-heading")).toHaveText("Star Catcher");
});

test("[probe:round_cycle] a round starts, ends and restarts", async ({ page }) => {
  // A round is a few seconds of simulated time, but software WebGL on a loaded machine can
  // drop the frame rate far enough that simulated time crawls.
  test.setTimeout(150_000);
  await page.goto("/?seed=7");
  await ready(page);
  await startRound(page);

  // Park the basket in a corner so stars get missed and the round ends quickly.
  const viewport = page.viewportSize()!;
  await page.mouse.move(2, viewport.height / 2);

  await expect.poll(() => probe<string>(page, "phase()"), { timeout: 100_000 }).toBe("over");
  await expect(page.locator("#over-screen")).toBeVisible();
  expect(await probe<number>(page, "lives()")).toBe(0);

  await page.locator("#again").click();
  await expect.poll(() => probe<string>(page, "phase()")).toBe("playing");
  expect(await probe<number>(page, "lives()")).toBe(3);
  expect(await probe<number>(page, "score()")).toBe(0);
});

/**
 * Apply one `input` during a round and return targetX before and after it — every input
 * event sets targetX synchronously. A narrow phone basket can lose a round in a few
 * seconds, and a loaded CI machine can take a second per input, so if the round was not
 * running on both sides of the input, start another and try again rather than read a value
 * the input never reached.
 */
async function steer(
  page: Page,
  input: () => Promise<void>,
): Promise<{ before: number; after: number }> {
  const read = (): Promise<{ phase: string; target: number }> =>
    page.evaluate(() => ({
      phase: window.__gvdemo__!.phase(),
      target: window.__gvdemo__!.targetX(),
    }));
  for (let attempt = 0; attempt < 8; attempt++) {
    const before = await read();
    if (before.phase !== "playing") {
      await page.locator("#again:visible, #play:visible").first().click();
      continue;
    }
    await input();
    const after = await read();
    if (after.phase === "playing") return { before: before.target, after: after.target };
  }
  throw new Error("the round kept ending before the input landed");
}

test("[probe:mouse_steer] the mouse steers the basket", async ({ page, isMobile }) => {
  test.skip(isMobile, "mouse input is a desktop check");
  await page.goto("/?seed=1");
  await ready(page);
  await startRound(page);
  const { width, height } = await probe<{ width: number; height: number }>(page, "world()");

  // The basket easing toward targetX is covered by the unit tests.
  const left = await steer(page, () => page.mouse.move(width * 0.1, height / 2));
  expect(left.after).toBeLessThan(width * 0.3);
  const right = await steer(page, () => page.mouse.move(width * 0.9, height / 2));
  expect(right.after).toBeGreaterThan(width * 0.7);
});

test("[probe:keyboard_steer] arrow keys steer the basket", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard input is a desktop check");
  await page.goto("/?seed=1");
  await ready(page);
  await startRound(page);
  const { width } = await probe<{ width: number; height: number }>(page, "world()");

  // One press moves the target 6% of the width, from the centre where a round starts.
  const right = await steer(page, () => page.keyboard.press("ArrowRight"));
  expect(right.after - right.before).toBeGreaterThan(width * 0.03);
  const left = await steer(page, () => page.keyboard.press("ArrowLeft"));
  expect(left.after - left.before).toBeLessThan(-width * 0.03);
});

test("[probe:touch_steer] touch steers the basket", async ({ page, hasTouch }) => {
  test.skip(!hasTouch, "touch input is a phone and tablet check");
  await page.goto("/?seed=1");
  await ready(page);
  await page.locator("#play").tap();
  await expect.poll(() => probe<string>(page, "phase()")).toBe("playing");
  const { width, height } = await probe<{ width: number; height: number }>(page, "world()");

  const left = await steer(page, () => page.touchscreen.tap(width * 0.08, height * 0.6));
  expect(left.after).toBeLessThan(width * 0.35);
  const right = await steer(page, () => page.touchscreen.tap(width * 0.92, height * 0.6));
  expect(right.after).toBeGreaterThan(width * 0.65);
});

test("[probe:layout_fits] fills the viewport without scrolling, and follows rotation", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  const viewport = page.viewportSize()!;

  const fits = async (): Promise<void> => {
    const { width, height } = page.viewportSize()!;
    const box = await page.locator("#game canvas").boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round(box!.width)).toBe(width);
    expect(Math.round(box!.height)).toBe(height);
    const scroll = await page.evaluate(() => ({
      x: document.documentElement.scrollWidth,
      y: document.documentElement.scrollHeight,
    }));
    expect(scroll.x).toBeLessThanOrEqual(width);
    expect(scroll.y).toBeLessThanOrEqual(height);
    const button = await page.locator("#play").boundingBox();
    expect(button!.x).toBeGreaterThanOrEqual(0);
    expect(button!.y).toBeGreaterThanOrEqual(0);
    expect(button!.x + button!.width).toBeLessThanOrEqual(width);
    expect(button!.y + button!.height).toBeLessThanOrEqual(height);
    // Big enough to hit with a thumb.
    expect(button!.height).toBeGreaterThanOrEqual(44);
  };

  await fits();
  await page.setViewportSize({ width: viewport.height, height: viewport.width });
  await expect
    .poll(() => probe<{ width: number; height: number }>(page, "world()"))
    .toEqual({ width: viewport.height, height: viewport.width });
  await fits();
});

test("[probe:tablet] plays on a tablet", async ({ page }, info) => {
  test.skip(info.project.name !== "tablet", "tablet project only");
  await page.goto("/?seed=3");
  await ready(page);
  await page.locator("#play").tap();
  await expect.poll(() => probe<string>(page, "phase()")).toBe("playing");
  const first = await probe<number>(page, "steps()");
  await expect.poll(() => probe<number>(page, "steps()")).toBeGreaterThan(first + 10);
  await expect.poll(() => probe<number>(page, "stars()")).toBeGreaterThan(0);
});

test("[probe:pause_hidden] a hidden tab pauses the round and resumes it", async ({ page }) => {
  await page.goto("/?seed=5");
  await ready(page);
  await startRound(page);

  const setVisibility = (state: "hidden" | "visible"): Promise<void> =>
    page.evaluate((value) => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });
      document.dispatchEvent(new Event("visibilitychange"));
    }, state);

  // Frames, not round steps: the loop is what pauses, and a round can end on its own.
  await setVisibility("hidden");
  expect(await probe<boolean>(page, "paused()")).toBe(true);
  const frozen = await probe<number>(page, "framesRendered()");
  await page.waitForTimeout(400);
  expect(await probe<number>(page, "framesRendered()")).toBe(frozen);

  await setVisibility("visible");
  expect(await probe<boolean>(page, "paused()")).toBe(false);
  await expect.poll(() => probe<number>(page, "framesRendered()")).toBeGreaterThan(frozen);
});

test("[probe:network_same_origin] [probe:no_insecure] every request stays on the package's origin", async ({
  page,
  baseURL,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));

  await page.goto("/");
  await ready(page);
  await startRound(page);
  await page.waitForTimeout(1500);

  const origin = new URL(baseURL!).origin;
  const inline = (url: string): boolean => url.startsWith("data:") || url.startsWith("blob:");
  const foreign = requests.filter((url) => !inline(url) && new URL(url).origin !== origin);
  expect(foreign).toEqual([]);

  // localhost is plain http in the preview server; anything else over http is insecure.
  const insecure = requests.filter(
    (url) => url.startsWith("http://") && new URL(url).origin !== origin,
  );
  expect(insecure).toEqual([]);

  const adHosts = /googlesyndication|doubleclick|adsbygoogle|realclick|gamevui/;
  const ads = requests.filter((url) => adHosts.test(url)).length;
  measure("ads_requested", ads);
  expect(ads).toBe(0);
});

test("[probe:no_personal_data] no cookies, no forms, only the best score stored", async ({
  page,
  context,
}) => {
  test.setTimeout(150_000);
  await page.goto("/?seed=9");
  await ready(page);
  await startRound(page);
  await page.mouse.move(2, 10);
  await expect.poll(() => probe<string>(page, "phase()"), { timeout: 100_000 }).toBe("over");

  expect(await context.cookies()).toEqual([]);
  expect(await page.locator("input, textarea, select, form").count()).toBe(0);
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys.every((key) => key === "gamevui-compliance-demo:best")).toBe(true);
});

test("[probe:iframe_subpath] boots two frames deep under a GameVui-style path and query", async ({
  page,
  baseURL,
}) => {
  // Stand-ins for the portal page, its account/app wrapper and its game host, in the nesting
  // observed on gamevui.vn: page → #giframe (no allow, no sandbox) → game document. Nothing
  // here contacts GameVui: every hostname uses the reserved .test TLD and is answered by
  // these routes, which serve the local preview build under the observed sub-path shape.
  const gamePrefix = "https://e.gamevui.test/web/2026/09/hung-sao/";
  const gameUrl =
    `${gamePrefix}?gid=9999&returnurl=https%3a%2f%2fgamevui.test%2fhung-sao%2fgame` +
    `&ratedages=0&token=header.payload.signature`;
  const wrapperUrl = `https://gamevui.test/account/app?gameurl=${encodeURIComponent(gameUrl)}`;
  const frameStyle = "border:0;width:100%;height:100%;display:block";

  await page.route("https://gamevui.test/**", (route) => {
    const isWrapper = new URL(route.request().url()).pathname === "/account/app";
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
        <style>html,body{margin:0;height:100%}</style>
        <iframe ${isWrapper ? "" : 'id="giframe"'} src="${isWrapper ? gameUrl : wrapperUrl}"
        style="${frameStyle}"></iframe>`,
    });
  });
  await page.route(`${gamePrefix}**`, async (route) => {
    const path = new URL(route.request().url()).pathname.slice(new URL(gamePrefix).pathname.length);
    const response = await route.fetch({ url: new URL(path || "/", baseURL).href });
    await route.fulfill({ response });
  });

  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));

  await page.goto("https://gamevui.test/hung-sao/game");
  const inner = page.frameLocator("#giframe").frameLocator("iframe");
  await expect(inner.locator("body")).toHaveAttribute("data-ready", "true", { timeout: 20_000 });

  const game = page.frames().find((candidate) => candidate.url().startsWith(gamePrefix))!;
  expect(game.parentFrame()?.url()).toContain("/account/app");
  await game.locator("#play").click();
  await expect.poll(() => probe<string>(game, "phase()")).toBe("playing");
  const first = await probe<number>(game, "framesRendered()");
  await expect.poll(() => probe<number>(game, "framesRendered()")).toBeGreaterThan(first);

  const outside = requests.filter(
    (url) =>
      !url.startsWith("https://gamevui.test/") &&
      !url.startsWith(gamePrefix) &&
      !url.startsWith("data:"),
  );
  expect(outside).toEqual([]);
  expect(errors).toEqual([]);
});

test("[probe:wrapper_tolerance] survives GameVui's observed in-frame script behaviour", async ({
  page,
  isMobile,
}) => {
  test.skip(
    isMobile,
    "keyboard behaviour is a desktop check; the viewport half runs in layout_fits",
  );
  // What gamevui.vn/games/services/score.min.js was observed to do to a hosted game,
  // re-created here — no GameVui code is loaded: overwrite the viewport meta, and swallow
  // Up/Down/Space/Backspace keydowns outside inputs.
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      document
        .querySelector('head>meta[name="viewport"]')
        ?.setAttribute("content", "width=device-width, initial-scale=1.0");
    });
    document.addEventListener("keydown", (event) => {
      const target = event.target as HTMLElement;
      if (
        [40, 38, 32, 8].includes(event.keyCode) &&
        !["INPUT", "TEXTAREA"].includes(target.tagName)
      ) {
        event.preventDefault();
      }
    });
  });

  await page.goto("/?seed=13");
  await ready(page);
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    "content",
    "width=device-width, initial-scale=1.0",
  );
  const { width, height } = page.viewportSize()!;
  const box = await page.locator("#game canvas").boundingBox();
  expect([Math.round(box!.width), Math.round(box!.height)]).toEqual([width, height]);

  // Space on the focused Play button is swallowed; Enter still starts the round.
  await page.locator("#play").focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => probe<string>(page, "phase()")).toBe("playing");

  const right = await steer(page, () => page.keyboard.press("ArrowRight"));
  expect(right.after - right.before).toBeGreaterThan(width * 0.03);
});

test("[probe:fps] frame rate while playing (measured, no GameVui threshold exists)", async ({
  page,
}) => {
  await page.goto("/?seed=11");
  await ready(page);
  await startRound(page);
  const viewport = page.viewportSize()!;
  await page.mouse.move(viewport.width / 2, viewport.height / 2);

  const before = await probe<number>(page, "framesRendered()");
  const started = Date.now();
  await page.waitForTimeout(2000);
  const frames = (await probe<number>(page, "framesRendered()")) - before;
  const fps = Math.round((frames / ((Date.now() - started) / 1000)) * 10) / 10;

  measure("fps", fps);
  expect(frames).toBeGreaterThan(0);
});
