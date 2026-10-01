// GOLDEN-RUN FIXTURE, not game code: captures the 3D golden port's visual baseline.
//
// Plays the built Neon Drift Arena in headless Chromium (WebGL through SwiftShader) with real
// keyboard, mouse and touch input, and screenshots each state, with the play probe's snapshot
// at each and every /assets/ response, into <outDir>/<viewport>/evidence.json.
//   node baseline/capture.mjs <baseUrl> <outDir> <desktop|mobile>
//   (run from a game checkout, so @playwright/test resolves from its node_modules)
/* global window, document, process, getComputedStyle, Element */

import { chromium, devices } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const [base, outRoot, viewport] = process.argv.slice(2);
const out = `${outRoot}/${viewport}`;
mkdirSync(out, { recursive: true });
const mobile = viewport === "mobile";
const say = (...parts) => process.stdout.write(parts.join(" ") + "\n");

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const context = await browser.newContext(
  mobile ? { ...devices["Pixel 5"] } : { viewport: { width: 1280, height: 720 } },
);
const page = await context.newPage();
const requests = [];
const errors = [];
page.on("request", (r) => requests.push(r.url()));
page.on("response", (r) => {
  if (r.url().includes("/assets/")) requests.push(`${r.status()} ${r.url()}`);
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));

const probes = {};
const snap = () => page.evaluate(() => window.__wgf__.play.snapshot());
const game = (expr) => page.evaluate(`window.__game.${expr}`);
async function shot(name, settle = 120) {
  if (settle) await page.waitForTimeout(settle);
  probes[name] = await snap();
  await page.screenshot({ path: `${out}/${name}.png`, scale: "css" });
  say(viewport, name, probes[name].state, JSON.stringify(probes[name].metrics));
}

/** Hold a steer: keyboard on desktop, a held touch on mobile (CDP touch events). */
let cdp = null;
async function holdSteer(side, ms, during) {
  if (!mobile) {
    const key = side < 0 ? "ArrowLeft" : "ArrowRight";
    await page.keyboard.down(key);
    if (during) await during();
    else await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    return;
  }
  cdp ??= await context.newCDPSession(page);
  const size = page.viewportSize();
  const x = side < 0 ? size.width * 0.1 : size.width * 0.9;
  const y = size.height * 0.6;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  if (during) await during();
  else await page.waitForTimeout(ms);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
async function press(selector) {
  const box = await page.locator(selector).boundingBox();
  if (mobile) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

// As the game's own browser suite does: nothing but the local server is reachable, so no
// portal SDK script is fetched and every request listed is the game's own.
await page.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, (route) => route.abort());
await page.goto(`${base}?wgf-probe=1`);
await page.waitForFunction(() => document.querySelector("#hud")?.dataset.ready === "true", null, {
  timeout: 90_000,
});
await page.waitForTimeout(800);
await shot("title");

await press("#play");
await page.waitForFunction(() => window.__game.phase === "playing");
// Let the first walls come in.
await page.waitForFunction(() => window.__game.snapshot()?.obstacles?.some((o) => o.z < 22), null, {
  timeout: 30_000,
});
await shot("playing");

// A steer, the way the probe oracle says is safe, captured mid-bank.
{
  const s = await snap();
  const side = s.oracle?.input?.x < page.viewportSize().width / 2 ? -1 : 1;
  await holdSteer(side, 0, async () => {
    await page.waitForTimeout(250);
    await shot("steer", 0);
  });
}

// A close wall, then the near-miss call-out: dodge with real input, following the game's own
// probe oracle (?wgf-probe=1: the steer that keeps the craft out of the next wall).
const closeWall = () => {
  const s = window.__game.snapshot();
  return !!s?.obstacles.some((o) => {
    const gap = Math.abs(o.x - s.playerX) - o.halfWidth - 0.5;
    return o.z > 0.3 && o.z < 2.6 && gap > 0.05 && gap < 1.2;
  });
};
const callout = () => !document.querySelector("#callout")?.hidden;
// Both moments, over as many runs as it takes (a crash restarts through the real button).
const want = new Map([
  ["close-wall", closeWall],
  ["near-miss", callout],
]);
for (let run = 0; run < 8 && want.size; run++) {
  if ((await game("phase")) === "over") {
    await page.waitForTimeout(700);
    await press("#restart");
    await page.waitForFunction(() => window.__game.phase === "playing", null, { timeout: 30_000 });
  }
  const end = Date.now() + 30_000;
  while (want.size && Date.now() < end && (await game("phase")) === "playing") {
    for (const [name, predicate] of want) {
      if (await page.evaluate(predicate)) {
        await shot(name, 0);
        want.delete(name);
      }
    }
    const s = await snap();
    const side = s.oracle?.input?.x < page.viewportSize().width / 2 ? -1 : 1;
    await holdSteer(side, 110);
  }
}

// Crash: steer into the nearest wall ahead until the run ends.
for (let i = 0; i < 80 && (await game("phase")) === "playing"; i++) {
  const s = await page.evaluate(() => window.__game.snapshot());
  const ahead = s.obstacles.filter((o) => o.z > 0).sort((a, b) => a.z - b.z)[0];
  const side = ahead ? (ahead.x > s.playerX ? 1 : -1) : 1;
  await holdSteer(side, 120);
}
// The crash frame is the moment before the result card, which enters 650 ms after the crash
// (CSS); the frame is taken 60 ms in, under the crash flash. A slow renderer (SwiftShader at
// the phone's pixel ratio) can take longer than 650 ms to screenshot, so the card's own
// animations are held for this one frame - nothing else is - and a frame with the card
// showing is refused.
await page.waitForFunction(() => window.__game.phase === "over", null, {
  timeout: 30_000,
  polling: "raf",
});
const held = await page.evaluate(() => {
  const card = document
    .getAnimations()
    .filter((a) => a.effect?.target instanceof Element && a.effect.target.closest("#over"));
  card.forEach((a) => a.pause());
  window.__heldCard = card;
  return card.length;
});
await page.waitForTimeout(60);
const card = await page.evaluate(() => {
  const over = document.getElementById("over");
  return over && !over.hidden ? Number(getComputedStyle(over).opacity) : 0;
});
if (card > 0.1) throw new Error(`the result card is up (opacity ${card}): no crash frame`);
await page.screenshot({ path: `${out}/crash.png`, scale: "css" });
await page.evaluate(() => window.__heldCard.forEach((a) => a.play()));
say(viewport, "crash", `(${held} card animation(s) held for the frame)`);
probes["crash"] = await snap();
await page.waitForTimeout(900);
await shot("game-over");

await press("#restart");
await page.waitForFunction(() => window.__game.phase === "playing", null, { timeout: 30_000 });
await page.waitForTimeout(1500);
await shot("retry-playing");

// Pause through the real button.
await press("#pause");
await page.waitForFunction(() => window.__game.paused());
await shot("paused");

const assets = requests.filter((u) => u.includes("/assets/"));
writeFileSync(
  `${out}/evidence.json`,
  JSON.stringify({ viewport, base, errors, asset_requests: assets, probes }, null, 2),
);
say(
  viewport,
  "errors",
  errors.length,
  "asset responses",
  assets.filter((a) => /^\d/.test(a)).length,
);
await browser.close();
