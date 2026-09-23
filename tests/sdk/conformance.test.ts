// SDK conformance: one scenario matrix over every platform the Factory knows.
//
// Test names are the report. The suite is organised as
//
//     describe(<platform id>) > describe(<feature>) > it(<scenario>)
//
// and `pnpm sdk:conformance` writes vitest's JSON report to build/sdk-conformance.json, which
// the Factory's `sdk` step reads to build its sdk-report: a feature is `working` when every
// scenario under it passed, and a skipped scenario is never counted as passing. Renaming a
// describe block changes what the Factory reports, so feature names are fixed below.
//
// Everything runs against fake portal SDKs (tests/sdk/harness.ts). Nothing here loads a real
// portal script, makes a network request, or publishes anything.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Game, ManualScheduler } from "@wgf/game-core";
import { KNOWN_PLATFORM_IDS, createPlatform } from "@wgf/platform-sdk";
import { bindPlatform, withAdBreak } from "../../src/platform/bind.js";
import { HARNESSES, type Harness, type HarnessInstance } from "./harness.js";

/** The feature vocabulary the Factory's sdk-report uses. Do not rename casually. */
export const FEATURES = [
  "not-configured",
  "init",
  "sdk-unavailable",
  "init-failure",
  "loading",
  "gameplay-lifecycle",
  "pause-resume",
  "interstitial",
  "rewarded",
  "storage",
  "game-binding",
] as const;

let visibility: "visible" | "hidden" = "visible";

beforeEach(() => {
  visibility = "visible";
  const doc = new EventTarget();
  Object.defineProperty(doc, "visibilityState", { get: () => visibility });
  Object.assign(globalThis, { window: new EventTarget(), document: doc });
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { document?: unknown }).document;
});

function record(instance: HarnessInstance) {
  const seen: string[] = [];
  const events = ["ad:start", "ad:end", "foreground:lost", "foreground:gained"] as const;
  for (const event of events) instance.platform.on(event, () => seen.push(event));
  return seen;
}

async function ready(harness: Harness, sdk: "ok" | "unavailable" | "init-fails" = "ok") {
  const instance = await harness.create(sdk);
  await instance.platform.initialize();
  await instance.platform.signalReady();
  return instance;
}

function running(): Game {
  const game = new Game({ scheduler: new ManualScheduler() });
  game.start();
  return game;
}

it("covers every platform id the registry knows", () => {
  expect(HARNESSES.map((h) => h.id).sort()).toEqual([...KNOWN_PLATFORM_IDS].sort());
});

describe.each(HARNESSES)("$id", (harness) => {
  // A scenario that does not apply to the platform (no rewarded ads on GameVui, no SDK to
  // be unavailable on generic-web) is not registered; a feature left with none is marked
  // `todo` as "not applicable", which the Factory reports as not-required. A scenario that
  // applies but has no adapter to run against is registered as skipped, and the Factory
  // reports it as not-started — never as working.
  const exercised = harness.adapter === "implemented" || harness.adapter === "none";
  let registered = 0;
  const scenario = (name: string, fn: () => Promise<void> | void): void => {
    registered += 1;
    (exercised ? it : it.skip)(name, fn);
  };
  const when =
    (applies: boolean) =>
    (name: string, fn: () => Promise<void> | void): void => {
      if (applies) scenario(name, fn);
    };
  const feature = (name: (typeof FEATURES)[number], body: () => void): void => {
    describe(name, () => {
      const before = registered;
      body();
      if (registered === before) it.todo(`not applicable to ${harness.id}`);
    });
  };
  const offers = (kind: "interstitial" | "rewarded") => harness.ads.includes(kind);

  describe("not-configured", () => {
    if (harness.adapter === "implemented") {
      it("createPlatform builds this adapter", () => {
        expect(createPlatform(harness.id, { namespace: "conformance" }).id).toBe(harness.id);
      });
    } else {
      // Not a pass for the platform: the limitation is reported beside it.
      it(`createPlatform refuses loudly — ${harness.limitation}`, () => {
        expect(() => createPlatform(harness.id, { namespace: "conformance" })).toThrow(harness.id);
      });
    }
    it("an unknown platform id fails at startup instead of degrading", () => {
      expect(() => createPlatform("not-a-portal", { namespace: "conformance" })).toThrow(
        /Unknown platform/,
      );
    });
  });

  feature("init", () => {
    scenario("initialize resolves, is idempotent, and signalReady is reported once", async () => {
      const instance = await harness.create();
      await Promise.all([instance.platform.initialize(), instance.platform.initialize()]);
      await instance.platform.signalReady();
      expect(instance.platform.usage.signalReadyCalls).toBe(1);
      if (harness.id === "yandex") expect(instance.calls).toContain("LoadingAPI.ready");
      if (harness.id === "poki") expect(instance.calls).toContain("PokiSDK.gameLoadingFinished");
    });
  });

  feature("sdk-unavailable", () => {
    when(harness.hasSdk)("the game boots, ads are refused, storage still works", async () => {
      const { platform } = await ready(harness, "unavailable");
      await expect(platform.showInterstitial()).resolves.toMatchObject({ shown: false });
      await expect(platform.showRewarded()).resolves.toMatchObject({
        shown: false,
        rewarded: false,
      });
      await platform.storage.set("best", "3");
      await expect(platform.storage.get("best")).resolves.toBe("3");
    });
  });

  feature("init-failure", () => {
    when(harness.hasSdk)("a rejected init degrades instead of failing boot", async () => {
      const { platform } = await ready(harness, "init-fails");
      await expect(platform.showRewarded()).resolves.toMatchObject({ rewarded: false });
      platform.gameplayStart();
      platform.gameplayStop();
    });
  });

  feature("loading", () => {
    scenario("progress is accepted in any order and counted for release validation", async () => {
      const instance = await harness.create();
      await instance.platform.initialize();
      for (const fraction of [0, 0.5, 0.25, 1, 2])
        instance.platform.reportLoadingProgress(fraction);
      await instance.platform.signalReady();
      expect(instance.platform.usage.loadingProgressCalls).toBe(5);
    });
  });

  feature("gameplay-lifecycle", () => {
    scenario("start/stop are tracked and duplicates are not forwarded to the portal", async () => {
      const instance = await ready(harness);
      const { platform } = instance;
      platform.gameplayStart();
      platform.gameplayStart();
      expect(platform.gameplayActive).toBe(true);
      platform.gameplayStop();
      platform.gameplayStop();
      expect(platform.gameplayActive).toBe(false);
      const starts = instance.calls.filter((c) => /gameplayStart|GameplayAPI\.start/.test(c));
      const stops = instance.calls.filter((c) => /gameplayStop|GameplayAPI\.stop/.test(c));
      if (harness.hasSdk) {
        expect(starts).toHaveLength(1);
        expect(stops).toHaveLength(1);
      }
    });
  });

  feature("pause-resume", () => {
    when(harness.portalPauses)(
      "the portal's pause and resume become foreground signals, once each",
      async () => {
        const instance = await ready(harness);
        const seen = record(instance);
        instance.portalPause!();
        instance.portalPause!();
        expect(instance.platform.foreground).toBe(false);
        instance.portalResume!();
        instance.portalResume!();
        expect(instance.platform.foreground).toBe(true);
        expect(seen).toEqual(["foreground:lost", "foreground:gained"]);
      },
    );

    when(harness.ads.length > 0)("an ad takes the foreground and gives it back", async () => {
      const instance = await ready(harness);
      const seen = record(instance);
      await instance.platform.showRewarded();
      // Poki's adapter takes the foreground itself; Yandex's portal raises game_api_pause.
      // Either way the game sees it lost and regained, bracketing ad:start / ad:end.
      expect(seen).toContain("foreground:lost");
      expect(seen).toContain("foreground:gained");
      expect(seen.indexOf("ad:start")).toBeLessThan(seen.indexOf("ad:end"));
      expect(seen.indexOf("foreground:lost")).toBeLessThan(seen.lastIndexOf("foreground:gained"));
      expect(instance.platform.foreground).toBe(true);
    });

    when(!harness.portalPauses && harness.ads.length === 0)(
      "no portal: the foreground is always the game's",
      async () => {
        const { platform } = await ready(harness);
        expect(platform.foreground).toBe(true);
      },
    );
  });

  feature("interstitial", () => {
    when(offers("interstitial"))("plays when the portal fills it", async () => {
      const { platform } = await ready(harness);
      await expect(platform.showInterstitial()).resolves.toEqual({ shown: true });
    });
    when(offers("interstitial"))(
      "ad unavailable (no fill) resolves unshown, never throws",
      async () => {
        const instance = await ready(harness);
        instance.setAd("no-fill");
        await expect(instance.platform.showInterstitial()).resolves.toMatchObject({ shown: false });
      },
    );
    when(offers("interstitial"))("a portal error resolves unshown, never throws", async () => {
      const instance = await ready(harness);
      instance.setAd("error");
      await expect(instance.platform.showInterstitial()).resolves.toMatchObject({ shown: false });
    });
    when(offers("interstitial") && harness.id === "yandex")(
      "a second interstitial inside the profile interval is refused as too-soon",
      async () => {
        const instance = await ready(harness);
        await instance.platform.showInterstitial();
        await expect(instance.platform.showInterstitial()).resolves.toEqual({
          shown: false,
          reason: "too-soon",
        });
        instance.advance(60_000);
        await expect(instance.platform.showInterstitial()).resolves.toEqual({ shown: true });
      },
    );
    when(!offers("interstitial"))("the portal offers none: refused as unsupported", async () => {
      const { platform } = await ready(harness);
      await expect(platform.showInterstitial()).resolves.toEqual({
        shown: false,
        reason: "unsupported",
      });
    });
  });

  feature("rewarded", () => {
    when(offers("rewarded"))(
      "reward callback: granted only when the portal confirms it",
      async () => {
        const { platform } = await ready(harness);
        await expect(platform.showRewarded()).resolves.toMatchObject({
          shown: true,
          rewarded: true,
        });
      },
    );
    when(offers("rewarded"))("user closes the ad early: no reward", async () => {
      const instance = await ready(harness);
      instance.setAd("closed-early");
      await expect(instance.platform.showRewarded()).resolves.toMatchObject({ rewarded: false });
    });
    when(offers("rewarded"))("ad unavailable (no fill): no reward, never throws", async () => {
      const instance = await ready(harness);
      instance.setAd("no-fill");
      await expect(instance.platform.showRewarded()).resolves.toMatchObject({
        shown: false,
        rewarded: false,
      });
    });
    when(offers("rewarded"))("a portal error: no reward, never throws", async () => {
      const instance = await ready(harness);
      instance.setAd("error");
      await expect(instance.platform.showRewarded()).resolves.toMatchObject({ rewarded: false });
    });
    when(!offers("rewarded"))("the portal offers none: refused as unsupported", async () => {
      const { platform } = await ready(harness);
      await expect(platform.showRewarded()).resolves.toEqual({
        shown: false,
        rewarded: false,
        reason: "unsupported",
      });
    });
  });

  feature("storage", () => {
    scenario("set, get and remove round-trip", async () => {
      const { platform } = await ready(harness);
      await platform.storage.set("best", "42");
      await expect(platform.storage.get("best")).resolves.toBe("42");
      await platform.storage.remove("best");
      await expect(platform.storage.get("best")).resolves.toBeNull();
    });
    when(harness.cloudStorage && harness.id === "yandex")(
      "saves reach the portal's cloud storage",
      async () => {
        const instance = await ready(harness);
        await instance.platform.storage.set("best", "9");
        instance.advance(60_000);
        (instance.platform.storage as { flush?: () => void }).flush?.();
        await Promise.resolve();
        expect(instance.calls).toContain("player.setData");
      },
    );
  });

  feature("game-binding", () => {
    // A real game-core Game, wired the way src/main.ts wires it.
    when(offers("rewarded"))(
      "the game is paused for the whole ad and resumes after it",
      async () => {
        const instance = await ready(harness);
        const game = running();
        bindPlatform(game, instance.platform);
        instance.platform.gameplayStart();
        let pausedDuringAd = false;
        const result = await withAdBreak(game, instance.platform, () =>
          instance.platform.showRewarded({ onStart: () => (pausedDuringAd = game.paused) }),
        );
        expect(result.rewarded).toBe(true);
        expect(pausedDuringAd).toBe(true);
        expect(game.paused).toBe(false);
        expect(instance.platform.gameplayActive).toBe(true);
      },
    );

    when(offers("rewarded"))("an ad closed early resumes the game without a reward", async () => {
      const instance = await ready(harness);
      instance.setAd("closed-early");
      const game = running();
      bindPlatform(game, instance.platform);
      const result = await withAdBreak(game, instance.platform, () =>
        instance.platform.showRewarded(),
      );
      expect(result.rewarded).toBe(false);
      expect(game.paused).toBe(false);
    });

    when(harness.portalPauses)(
      "a portal pause pauses the game until the portal resumes",
      async () => {
        const instance = await ready(harness);
        const game = running();
        bindPlatform(game, instance.platform);
        instance.portalPause!();
        expect(game.paused).toBe(true);
        instance.portalResume!();
        expect(game.paused).toBe(false);
      },
    );

    scenario("a hidden tab pauses the game and stops reported gameplay", async () => {
      const instance = await ready(harness);
      const game = running();
      bindPlatform(game, instance.platform);
      instance.platform.gameplayStart();
      visibility = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
      expect(game.paused).toBe(true);
      expect(instance.platform.gameplayActive).toBe(false);
      visibility = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
      expect(game.paused).toBe(false);
      expect(instance.platform.gameplayActive).toBe(true);
    });
  });
});
