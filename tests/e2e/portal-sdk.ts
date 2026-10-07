// Every portal SDK a built bundle can load, served from the repository's own stand-ins.
//
// GAME-AGNOSTIC. The e2e suite runs against whichever platform the bundle was built for
// (dist/ is the target platform's build), so it cannot know in advance which SDK the page will
// ask for: it serves all of them, and the one the active adapter loads is the one that
// answers. A run must not depend on the network, and must not send test traffic - ad
// requests, impressions, a real Game ID - to a portal or an ad network (the real Poki SDK, for
// one, pulls in Google IMA and its ad calls, whose transport even follows the page's protocol).
// Each mock is the one the platform's own suite uses, so its documented surface is pinned there.
//
// Specs import `test` and `expect` from here instead of from @playwright/test. The `external`
// fixture is automatic: every page is stubbed before the spec's first `page.goto`, and the
// fixture's value lists every request that still went to another host, and the fixture fails
// the test if any did - so every spec, not only the one that looks, proves it stayed off the
// network.
//
// A portal SDK the adapters can load with no mock here fails "every portal SDK has a mock"
// in smoke.spec.ts, which reads packages/platform-sdk/sdk-signatures.json - so adding an
// adapter cannot quietly put live portal traffic back into the smoke suite.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test as base, type Page } from "@playwright/test";
import {
  CRAZYGAMES_SDK_URL,
  GAMEDISTRIBUTION_SDK_URL,
  GAMEMONETIZE_SDK_URL,
  GAMEPIX_SDK_URL,
  POKI_SDK_URL,
  Y8_SDK_URL,
  YANDEX_SDK_URL,
} from "@wgf/platform-sdk";
import { MOCK_SDK_SOURCE as MOCK_CRAZYGAMES } from "../crazygames/mock-sdk.js";
import { MOCK_SDK_SOURCE as MOCK_GAMEMONETIZE } from "../gamemonetize/mock-sdk.js";
import { MOCK_SDK_SOURCE as MOCK_GAMEPIX } from "../gamepix/mock-sdk.js";
import { createY8Mock } from "../y8/mock-y8-sdk.js";

export { expect } from "@playwright/test";

const TESTS = resolve(import.meta.dirname, "..");
const read = (...path: string[]): string => readFileSync(resolve(TESTS, ...path), "utf8");

// The node suites' Y8 mock, served as the CDN script; options from window.__y8Mock.
const MOCK_Y8 = `(() => {
  window.__y8 = (${createY8Mock.toString()})(window, window.__y8Mock || {});
})();`;

export interface PortalSdkMock {
  /** The platform id, as in game.config.yaml and sdk-signatures.json. */
  readonly platform: string;
  /** The adapter's script URL. Yandex's is origin-relative: `/sdk.js` on the page's origin. */
  readonly url: string;
  readonly source: string;
}

/**
 * In registration order: the route registered last wins, and GameMonetize's URL also ends in
 * /sdk.js, so Yandex's same-origin path comes first.
 */
export const PORTAL_SDK_MOCKS: readonly PortalSdkMock[] = [
  { platform: "yandex", url: YANDEX_SDK_URL, source: read("sdk-browser", "mock-yandex-sdk.js") },
  { platform: "poki", url: POKI_SDK_URL, source: read("poki", "mock-poki-sdk.js") },
  { platform: "crazygames", url: CRAZYGAMES_SDK_URL, source: MOCK_CRAZYGAMES },
  {
    platform: "gamedistribution",
    url: GAMEDISTRIBUTION_SDK_URL,
    source: read("gamedistribution", "mock-gd-sdk.js"),
  },
  { platform: "gamemonetize", url: GAMEMONETIZE_SDK_URL, source: MOCK_GAMEMONETIZE },
  { platform: "gamepix", url: GAMEPIX_SDK_URL, source: MOCK_GAMEPIX },
  { platform: "y8", url: Y8_SDK_URL, source: MOCK_Y8 },
];

const ABSOLUTE = PORTAL_SDK_MOCKS.map((mock) => mock.url).filter((url) => /^https?:/.test(url));

/**
 * Serve every portal SDK from its repository mock, on this page. Returns, live, every request
 * that went to a host other than the page's own (localhost, or `ownHosts`) anyway.
 */
export async function stubPortalSdks(
  page: Page,
  ownHosts: readonly string[] = ["localhost"],
): Promise<string[]> {
  for (const mock of PORTAL_SDK_MOCKS) {
    const body = { contentType: "text/javascript", body: mock.source };
    if (/^https?:/.test(mock.url)) {
      await page.route(mock.url, (route) => route.fulfill(body));
    } else {
      await page.route(
        (url) => url.pathname === mock.url,
        (route) => route.fulfill(body),
      );
    }
  }

  const external: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (!/^https?:/.test(url) || ABSOLUTE.includes(url)) return;
    if (!ownHosts.includes(new URL(url).hostname)) external.push(url);
  });
  return external;
}

/** `test` with every page's portal SDK stubbed; `external` lists what left the machine. */
export const test = base.extend<{ external: string[] }>({
  external: [
    async ({ page }, use) => {
      const external = await stubPortalSdks(page);
      await use(external);
      // Every spec, not only the one that looks: nothing may have left the machine.
      expect(external, "requests that left the machine").toEqual([]);
    },
    { auto: true },
  ],
});
