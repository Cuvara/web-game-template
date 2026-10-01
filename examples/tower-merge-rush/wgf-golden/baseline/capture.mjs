// Captures the visual baseline of the 2D golden port from a running production build.
//
// GOLDEN-RUN FIXTURE, not game code. Plays the built game through real input only - mouse
// clicks and keys on desktop, touch taps on the Pixel 5 profile - and saves, per viewport,
// title / gameplay / merge / near-full / game-over / retry screenshots, the play probe's
// snapshot at each, and every request the game made under /assets/.
//
//   node baseline/capture.mjs <base-url> <out-dir>
//   (resolve @playwright/test from a game checkout: NODE_PATH=<game>/node_modules)

/* global window, document, URL, process */

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(join(process.cwd(), "package.json"));
const { chromium, devices } = require("@playwright/test");

const base = process.argv[2] ?? "http://localhost:4310/";
const out = process.argv[3] ?? "baseline";
const COLUMNS = 7;
const say = (line) => process.stdout.write(line + "\n");

const viewports = {
  desktop: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  mobile: { ...devices["Pixel 5"] },
};

async function snapshot(page) {
  return page.evaluate(() => window.__wgf__.play.snapshot());
}

async function board(page) {
  return page.evaluate(() => ({
    board: window.__game.board,
    level: window.__game.dropLevel,
    state: window.__game.state,
  }));
}

/** A real press at a page point: a mouse click on desktop, a touch tap on the phone. */
async function press(page, touch, x, y) {
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

async function pressButton(page, touch, selector) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} is not on screen`);
  await press(page, touch, box.x + box.width / 2, box.y + box.height / 2);
}

async function dropAt(page, touch, col) {
  const box = await page.locator("#game").boundingBox();
  await press(page, touch, box.x + ((col + 0.5) * box.width) / COLUMNS, box.y + box.height * 0.55);
}

/** The open column that merges with the piece about to drop, if any. */
function merging({ board, level }) {
  const open = board.flatMap((c, i) => (c === null ? [i] : []));
  return open.find((c) => board[c - 1] === level || board[c + 1] === level);
}

/** An open column that does not merge, if any. */
function quiet({ board, level }) {
  const open = board.flatMap((c, i) => (c === null ? [i] : []));
  return open.find((c) => board[c - 1] !== level && board[c + 1] !== level) ?? open.at(-1);
}

async function run(name, options) {
  const dir = join(out, name);
  mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const touch = Boolean(options.hasTouch);
  // Never contact a portal: a build's SDK script is aborted, as in the golden harness.
  await page.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, (route) => route.abort());
  const requests = [];
  page.on("response", (r) => {
    const url = new URL(r.url());
    if (
      url.pathname.startsWith("/assets/") &&
      !url.pathname.endsWith(".js") &&
      !url.pathname.endsWith(".map")
    ) {
      requests.push({ url: url.pathname, status: r.status(), type: r.request().resourceType() });
    }
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("requestfailed", (r) => errors.push(`request failed: ${r.url()}`));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const probes = {};
  const shot = async (state) => {
    // CSS pixels: a phone baseline at its layout size, not its 2.75x device raster.
    await page.screenshot({ path: join(dir, `${state}.png`), scale: "css" });
    probes[state] = await snapshot(page);
    say(`${name}/${state}: ${probes[state].state}, ${probes[state].entities.length} entities`);
  };

  await page.goto(base);
  await page.locator('#hud[data-ready="true"]').waitFor({ timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  await shot("title");

  await pressButton(page, touch, '[data-action="play"]');
  await page.waitForTimeout(300);
  // Play to merge: the oracle's choice, by hand.
  for (let i = 0; i < 9; i++) {
    const b = await board(page);
    await dropAt(page, touch, merging(b) ?? quiet(b));
    await page.waitForTimeout(450);
  }
  await shot("gameplay");

  // A merge, caught mid-burst.
  let b = await board(page);
  let col = merging(b);
  for (let i = 0; col === undefined && i < 6; i++) {
    await dropAt(page, touch, quiet(b));
    await page.waitForTimeout(450);
    b = await board(page);
    col = merging(b);
  }
  if (col !== undefined) {
    await dropAt(page, touch, col);
    await page.waitForTimeout(110);
    await shot("merge");
    await page.waitForTimeout(700);
  }

  // Pause and back, through the pause button and the keyboard / resume button.
  await pressButton(page, touch, '[data-action="pause"]');
  await page.waitForTimeout(350);
  await shot("paused");
  await pressButton(page, touch, '[data-action="resume"]');
  await page.waitForTimeout(300);

  // Fill the track without merging: near full, then over.
  for (let i = 0; i < 40; i++) {
    b = await board(page);
    if (b.state !== "playing") break;
    const filled = b.board.filter((c) => c !== null).length;
    if (filled === COLUMNS - 1 && !probes["near-full"]) {
      await page.waitForTimeout(300);
      await shot("near-full");
    }
    await dropAt(page, touch, quiet(b));
    await page.waitForTimeout(380);
  }
  await page.waitForTimeout(700);
  await shot("game-over");

  await pressButton(page, touch, '[data-action="restart"]');
  await page.locator('section[data-screen="start"]:not([hidden])').waitFor();
  await pressButton(page, touch, '[data-action="play"]');
  await page.waitForTimeout(250);
  await dropAt(page, touch, 3);
  await page.waitForTimeout(500);
  await shot("retry-playing");

  writeFileSync(join(dir, "probe.json"), JSON.stringify(probes, null, 2) + "\n");
  writeFileSync(
    join(dir, "network-assets.json"),
    JSON.stringify({ base, requests, errors }, null, 2) + "\n",
  );
  await browser.close();
  return { requests, errors };
}

for (const [name, options] of Object.entries(viewports)) {
  const { requests, errors } = await run(name, options);
  say(`${name}: ${requests.length} /assets/ responses, ${errors.length} errors`);
  for (const e of errors) say(`  error: ${e}`);
}
