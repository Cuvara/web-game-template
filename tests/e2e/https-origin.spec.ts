// The built bundle served from an https origin, the way every portal serves it.
//
// GAME-AGNOSTIC. "makes no insecure requests" in smoke.spec.ts runs on http://localhost and has
// to let the page's own http://localhost requests through. Here the same bytes come from
// https://game.wgf.test (each request answered from the preview server through page.route, so
// nothing leaves the machine) and nothing is exempt: every request the page makes must be
// https, and Chromium must report no mixed content - the protocol-relative and hard-coded
// http:// URLs that only show up on a secure origin.
//
// What this cannot check offline: the transport of a REAL portal script and what it pulls in
// (an ad SDK's bridge frame, say, which follows the page's protocol). The portal SDK here is
// the repository's mock, as in every e2e spec; the real scripts are exercised by the live
// suites (tests/live, `pnpm test:sdk:live`) and the portal's own QA, never by the smoke suite.

import { expect, test } from "@playwright/test";
import { stubPortalSdks } from "./portal-sdk.js";

const ORIGIN = "https://game.wgf.test";

test("served from an https origin, every request is https and none is mixed content @boot", async ({
  page,
  baseURL,
}) => {
  const insecure: string[] = [];
  const mixed: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("http://")) insecure.push(request.url());
  });
  page.on("console", (message) => {
    if (/mixed content/i.test(message.text())) mixed.push(message.text());
  });

  // The origin first: a route registered later wins, so the portal SDK stubs (Yandex's is
  // /sdk.js on this origin) take precedence over it.
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `${baseURL}${url.pathname}${url.search}` });
    await route.fulfill({ response });
  });
  const external = await stubPortalSdks(page, [new URL(ORIGIN).hostname]);

  await page.goto(`${ORIGIN}/`);
  await expect(page.locator("#hud")).toHaveAttribute("data-ready", "true", { timeout: 15_000 });
  expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
  await page.waitForTimeout(1_000);

  expect(insecure).toEqual([]);
  expect(mixed).toEqual([]);
  expect(external).toEqual([]);
});
