// GameDistribution release side: the self-hosted wrapper page, the package it goes into, and
// the SDK integration artifact.
//
// The wrapper's script is run here in a sandbox with a stand-in window/document, once per
// way it can be reached, so what the GD SDK would receive as gd_sdk_referrer_url is pinned —
// not just the HTML's shape. tests/sdk-browser/gamedistribution.spec.ts runs the same page
// in Chromium around a real build.

import { runInNewContext } from "node:vm";
import * as sdk from "@wgf/platform-sdk";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain ESM script without type declarations.
import { checkGameUrl, wrapperHtml } from "../../scripts/release/gamedistribution-wrapper.mjs";
// @ts-expect-error — plain ESM script without type declarations.
import { isGameDistributionSelfHosted } from "../../scripts/release/package.mjs";
// @ts-expect-error — plain ESM script without type declarations.
import { buildIntegration } from "../../scripts/sdk/prepare-integration.mjs";
import { TEST_GD_GAME_ID } from "../gamedistribution/fake-sdk.js";

const GAME_URL = "https://games.example.com/my-game/";

/** Run the wrapper's inline script; return the iframe src it set. */
function frameSrc(options: { href: string; referrer?: string; framed?: boolean }): URL {
  const html = wrapperHtml(GAME_URL) as string;
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
  const iframe: { src?: string } = {};
  const location = { href: options.href, toString: () => options.href };
  const window = {} as { location: unknown; parent: { location: unknown } };
  window.location = location;
  window.parent = { location: options.framed ? { href: "https://parent.example/" } : location };
  runInNewContext(script, {
    URL,
    window,
    document: {
      location,
      referrer: options.referrer ?? "",
      getElementById: (id: string) => (id === "container" ? iframe : null),
    },
  });
  return new URL(iframe.src!);
}

const referrerOf = (src: URL): string | null => src.searchParams.get("gd_sdk_referrer_url");

describe("GameDistribution self-hosted wrapper", () => {
  it("frames game_url with gd_sdk_referrer_url set to the wrapper's own URL at top level", () => {
    const src = frameSrc({ href: "https://html5.gamedistribution.com/abc/" });
    expect(src.origin + src.pathname).toBe(GAME_URL);
    expect(referrerOf(src)).toBe("https://html5.gamedistribution.com/abc/");
  });

  it("uses the embedding page (document.referrer) when the wrapper is itself framed", () => {
    const src = frameSrc({
      href: "https://html5.gamedistribution.com/abc/",
      referrer: "https://publisher.example/games/my-game?utm=x&y=1",
      framed: true,
    });
    // Encoded, so the publisher's own query survives intact.
    expect(referrerOf(src)).toBe("https://publisher.example/games/my-game?utm=x&y=1");
  });

  it("passes an incoming gd_sdk_referrer_url through, matched case-insensitively", () => {
    const src = frameSrc({
      href: "https://html5.gamedistribution.com/abc/?GD_SDK_REFERRER_URL=https%3A%2F%2Fportal.example%2Fp",
    });
    expect(referrerOf(src)).toBe("https://portal.example/p");
  });

  it("maps a localhost referrer to https://gamedistribution.com/, as index_iframe.html does", () => {
    const src = frameSrc({
      href: "https://html5.gamedistribution.com/abc/",
      referrer: "http://localhost:5173/",
      framed: true,
    });
    expect(referrerOf(src)).toBe("https://gamedistribution.com/");
  });

  it("keeps a query game_url already has, and sets the parameter exactly once", () => {
    const html = wrapperHtml("https://games.example.com/g/?build=7") as string;
    expect(html).toContain('"https://games.example.com/g/?build=7"');
    const src = frameSrc({ href: "https://w.example/" });
    expect([...src.searchParams.keys()].filter((k) => k === "gd_sdk_referrer_url")).toHaveLength(1);
  });

  it("refuses a malformed, insecure or pre-referred game_url", () => {
    expect(() => checkGameUrl("games.example.com/g")).toThrow(/absolute URL/);
    expect(() => checkGameUrl("http://games.example.com/g/")).toThrow(/https/);
    expect(() =>
      checkGameUrl("https://games.example.com/g/?gd_sdk_referrer_url=https://x.example/"),
    ).toThrow(/wrapper sets it/);
  });

  it("escapes game_url into the script as data, never as code", () => {
    const html = wrapperHtml('https://games.example.com/g/?q=";alert(1);"') as string;
    expect(html).not.toContain('";alert(1);"');
  });

  it("packages only the wrapper for a self-hosted GameDistribution target", () => {
    expect(isGameDistributionSelfHosted({ id: "gamedistribution", hosting: "self-hosted" })).toBe(
      true,
    );
    expect(isGameDistributionSelfHosted({ id: "gamedistribution" })).toBe(false);
    expect(isGameDistributionSelfHosted({ id: "poki", hosting: "self-hosted" })).toBe(false);
  });
});

describe("GameDistribution SDK integration artifact", () => {
  it("names the adapter, the runtime-loaded SDK URL and both ad kinds", () => {
    const { integration, problems } = buildIntegration(
      {
        game: { id: "gd-game", name: "GD", version: "1.0.0" },
        engine: { type: "threejs" },
        platforms: [
          {
            id: "gamedistribution",
            profile: "gamedistribution@1.0.0",
            role: "required",
            game_id: TEST_GD_GAME_ID,
          },
        ],
        monetization: { ad_kinds: ["interstitial", "rewarded"], iap: false },
      },
      sdk,
      { commitSha: "abc", now: new Date("2026-09-24T00:00:00Z") },
    );
    expect(problems).toEqual([]);
    expect(integration.platforms[0]).toMatchObject({
      id: "gamedistribution",
      adapter: "GameDistributionPlatform",
      sdk: { source: sdk.GAMEDISTRIBUTION_SDK_URL, loaded: "runtime" },
      unserved_ad_kinds: [],
    });
  });

  it("a banner declared for GameDistribution is flagged, not silently dropped", () => {
    const { problems } = buildIntegration(
      {
        game: { id: "gd-game", name: "GD", version: "1.0.0" },
        engine: { type: "pixijs" },
        platforms: [
          {
            id: "gamedistribution",
            profile: "gamedistribution@1.0.0",
            role: "required",
            game_id: TEST_GD_GAME_ID,
          },
        ],
        monetization: { ad_kinds: ["banner"], iap: false },
      },
      sdk,
    );
    expect(problems).toEqual([
      'gamedistribution: the title declares "banner" ads, which the adapter cannot show',
    ]);
  });
});
