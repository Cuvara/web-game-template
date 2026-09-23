// Readability at the iframe sizes CrazyGames lists as most important for its audience,
// at devicePixelRatio 1 as the gameplay requirements specify.
//
// https://docs.crazygames.com/requirements/gameplay/#basic-gameplay-requirements
//
// What is automated: the canvas fills the frame, nothing scrolls, every HUD and panel
// element is inside the viewport and not overlapping another, and text is at least
// MIN_FONT_PX. What is not: whether it *looks* good — that is a person's call, recorded as
// a manual check in the compliance report.

import type { Page } from "@playwright/test";
import { LIVE_SDK, boot, expect, test } from "./fixtures.js";

test.skip(LIVE_SDK, "layout does not depend on the SDK build");

const MIN_FONT_PX = 14;

// From the requirements page, verbatim.
export const CRAZYGAMES_IFRAME_SIZES = [
  { width: 907, height: 510, kind: "desktop" },
  { width: 1216, height: 684, kind: "desktop" },
  { width: 1077, height: 606, kind: "desktop" },
  { width: 821, height: 462, kind: "desktop" },
  { width: 1366, height: 768, kind: "desktop-fullscreen" },
  { width: 1920, height: 1080, kind: "desktop-fullscreen" },
  { width: 1536, height: 864, kind: "desktop-fullscreen" },
  { width: 1280, height: 720, kind: "desktop-fullscreen" },
  { width: 800, height: 450, kind: "mobile" },
  { width: 1080, height: 607, kind: "tablet" },
] as const;

// Not in CrazyGames' list: orientation is chosen in the submission and the site asks players
// to rotate. Checked anyway so that a portrait phone that ignores the prompt is still usable.
const EXTRA_SIZES = [{ width: 450, height: 800, kind: "mobile-portrait (extra)" }] as const;

for (const size of [...CRAZYGAMES_IFRAME_SIZES, ...EXTRA_SIZES]) {
  test(`${size.width}x${size.height} (${size.kind}) is readable and fits`, async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "desktop", "sizes are iterated once, in the desktop project");
    await page.setViewportSize({ width: size.width, height: size.height });
    await boot(page);

    const canvas = await page.locator("#game canvas").boundingBox();
    expect(canvas).not.toBeNull();
    expect(canvas!.width).toBeGreaterThanOrEqual(size.width - 1);
    expect(canvas!.height).toBeGreaterThanOrEqual(size.height - 1);

    const layout = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      scrollH: document.documentElement.scrollHeight,
      dpr: window.devicePixelRatio,
    }));
    expect(layout.dpr).toBe(1);
    expect(layout.scrollW).toBeLessThanOrEqual(size.width);
    expect(layout.scrollH).toBeLessThanOrEqual(size.height);

    await assertReadable(page, ["#hud-level", "#hud-caught", "#hud-coins"], size);

    // The level-complete panel, filled with its longest real strings.
    await page.evaluate(() => {
      const set = (id: string, text: string) => {
        const el = document.getElementById(id)!;
        el.textContent = text;
        el.hidden = false;
      };
      set("complete-title", "Level 12 complete!");
      set("complete-earned", "+39 coins");
      set("btn-next", "▶ Next level");
      set("btn-double-ad", "🎬 Watch ad: double coins");
      set("btn-double-coins", "🪙 Double for 15 coins");
      set("complete-note", "Ad-based bonuses are unavailable while an ad blocker is active.");
      document.getElementById("complete")!.hidden = false;
    });
    await assertReadable(
      page,
      [
        "#complete-title",
        "#complete-earned",
        "#btn-next",
        "#btn-double-ad",
        "#btn-double-coins",
        "#complete-note",
      ],
      size,
    );
  });
}

async function assertReadable(
  page: Page,
  selectors: string[],
  size: { width: number; height: number },
): Promise<void> {
  const boxes: { selector: string; x: number; y: number; w: number; h: number }[] = [];
  for (const selector of selectors) {
    const element = page.locator(selector);
    const box = await element.boundingBox();
    expect(box, `${selector} is rendered`).not.toBeNull();
    expect(box!.x, `${selector} left edge`).toBeGreaterThanOrEqual(0);
    expect(box!.y, `${selector} top edge`).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, `${selector} right edge`).toBeLessThanOrEqual(size.width + 0.5);
    expect(box!.y + box!.height, `${selector} bottom edge`).toBeLessThanOrEqual(size.height + 0.5);
    const fontPx = await element.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fontPx, `${selector} font size`).toBeGreaterThanOrEqual(MIN_FONT_PX);
    boxes.push({ selector, x: box!.x, y: box!.y, w: box!.width, h: box!.height });
  }
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      expect(overlap, `${a.selector} overlaps ${b.selector}`).toBe(false);
    }
  }
}
