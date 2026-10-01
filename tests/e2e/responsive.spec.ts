// Layout follows the viewport, for any game.
//
// The Factory's responsive-layout requirement: correct from a 360x640 phone in portrait to
// desktop, resize handled, nothing cropped off-screen. main.ts resizes the renderer on
// window and visual-viewport changes; this checks the canvas actually follows and that the
// page never scrolls sideways. Game-agnostic: reads only #game and its canvas.

import { expect, test, type Page } from "@playwright/test";

const SIZES = [
  { width: 360, height: 640 },
  { width: 640, height: 360 },
  { width: 1280, height: 720 },
];

async function layout(page: Page) {
  return page.evaluate(() => {
    const container = document.getElementById("game")!.getBoundingClientRect();
    const canvas = document.querySelector("#game canvas")!.getBoundingClientRect();
    const root = document.documentElement;
    return {
      container: { width: Math.round(container.width), height: Math.round(container.height) },
      canvas: { width: Math.round(canvas.width), height: Math.round(canvas.height) },
      overflowX: root.scrollWidth - root.clientWidth,
    };
  });
}

test("the canvas follows viewport resizes without horizontal overflow @responsive", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("#hud")).toHaveAttribute("data-ready", "true", { timeout: 15_000 });

  for (const size of SIZES) {
    await page.setViewportSize(size);
    await expect
      .poll(async () => {
        const { container, canvas } = await layout(page);
        return (
          Math.abs(canvas.width - container.width) <= 1 &&
          Math.abs(canvas.height - container.height) <= 1
        );
      })
      .toBe(true);
    const { canvas, overflowX } = await layout(page);
    expect(canvas.width).toBeGreaterThan(0);
    expect(canvas.width).toBeLessThanOrEqual(size.width);
    expect(overflowX).toBeLessThanOrEqual(0);
  }

  expect(errors).toEqual([]);
});
