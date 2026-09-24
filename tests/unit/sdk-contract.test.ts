// One contract, four portals.
//
// Every scenario the SDK module promises runs against every portal adapter, each over a
// mock of its own SDK (tests/sdk/portals.ts): initialization, loading, game start, ads,
// the reward callback, the player closing an ad, no fill, storage, pause/resume, an SDK
// that is missing or fails to initialize, and a platform nobody configured. A portal
// behaving differently from the others is either documented in docs/sdk.md as a known
// limitation or a bug.
//
// Per-portal detail (call order, timeouts, retries) lives in each adapter's own test file.
// This file is the cross-portal promise game code relies on.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Game, ManualScheduler } from "@wgf/game-core";
import { KNOWN_PLATFORM_IDS, createPlatform, type AdKind, type Platform } from "@wgf/platform-sdk";
import { validateGameConfig } from "../../src/core/game-config.js";
import { bindPlatform, withAdBreak } from "../../src/platform/bind.js";
import { PORTALS, createHarness, type PortalHarness } from "../sdk/portals.js";

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

async function booted(harness: PortalHarness): Promise<PortalHarness> {
  await harness.platform.initialize();
  await harness.platform.signalReady();
  return harness;
}

function recordEvents(platform: Platform): string[] {
  const seen: string[] = [];
  for (const event of ["ad:start", "ad:end", "foreground:lost", "foreground:gained"] as const) {
    platform.on(event, () => seen.push(event));
  }
  return seen;
}

const count = (calls: readonly string[], name: string): number =>
  calls.filter((call) => call === name).length;

describe.each(PORTALS)("%s", (portal) => {
  describe("initialization and loading", () => {
    it("initializes once and reports loading finished exactly once", async () => {
      const harness = createHarness(portal);
      await Promise.all([harness.platform.initialize(), harness.platform.initialize()]);
      await harness.platform.signalReady();
      await harness.platform.signalReady();
      expect(count(harness.calls, "init")).toBe(harness.hasSdk ? 1 : 0);
      const forwards = harness.forwardsLifecycle ?? harness.hasSdk;
      expect(count(harness.calls, "ready")).toBe(forwards ? 1 : 0);
      expect(harness.platform.usage.signalReadyCalls).toBe(2);
    });

    it("accepts loading progress without throwing, clamped to [0, 1]", async () => {
      const { platform } = createHarness(portal);
      await platform.initialize();
      for (const fraction of [-1, 0, 0.5, 2]) platform.reportLoadingProgress(fraction);
      expect(platform.usage.loadingProgressCalls).toBe(4);
    });
  });

  describe("game start", () => {
    it("forwards gameplay transitions, not repeats", async () => {
      const harness = await booted(createHarness(portal));
      const { platform, calls } = harness;
      const forwards = harness.forwardsLifecycle ?? harness.hasSdk;
      platform.gameplayStart();
      platform.gameplayStart();
      expect(platform.gameplayActive).toBe(true);
      platform.gameplayStop();
      platform.gameplayStop();
      expect(platform.gameplayActive).toBe(false);
      expect(count(calls, "gameplayStart")).toBe(forwards ? 1 : 0);
      expect(count(calls, "gameplayStop")).toBe(forwards ? 1 : 0);
      if (!forwards) {
        // Nothing to forward to: the transitions are only counted, once each.
        expect(platform.usage.gameplayStartCalls).toBe(1);
        expect(platform.usage.gameplayStopCalls).toBe(1);
      }
    });
  });

  describe("ads", () => {
    it("plays an interstitial with the onStart hook and one ad:start/ad:end pair", async () => {
      const { platform, calls, hasSdk } = await booted(createHarness(portal));
      const events = recordEvents(platform);
      let hook = 0;
      const result = await platform.showInterstitial({ onStart: () => (hook += 1) });
      if (!hasSdk) {
        expect(result).toEqual({ shown: false, reason: expect.any(String) });
        expect(events).toEqual([]);
        return;
      }
      expect(result.shown).toBe(true);
      expect(hook).toBe(1);
      expect(count(calls, "ad:interstitial")).toBe(1);
      expect(events.filter((e) => e.startsWith("ad:"))).toEqual(["ad:start", "ad:end"]);
      expect(platform.foreground).toBe(true);
    });

    it("grants a reward only on the portal's reward callback", async () => {
      const { platform, hasSdk } = await booted(createHarness(portal, { ad: "complete" }));
      const result = await platform.showRewarded();
      expect(result.rewarded).toBe(hasSdk);
      if (hasSdk) expect(result.shown).toBe(true);
    });

    it("never rewards a player who closes the ad early", async () => {
      const { platform } = await booted(createHarness(portal, { ad: "closed-early" }));
      const events = recordEvents(platform);
      const result = await platform.showRewarded();
      expect(result.rewarded).toBe(false);
      // Whatever started also ended: a game muted on ad:start is never left silent.
      expect(count(events, "ad:start")).toBe(count(events, "ad:end"));
    });

    it("reports an unavailable ad without playing, throwing or rewarding", async () => {
      const { platform } = await booted(createHarness(portal, { ad: "no-fill" }));
      const events = recordEvents(platform);
      const interstitial = await platform.showInterstitial();
      const rewarded = await platform.showRewarded();
      expect(interstitial.shown).toBe(false);
      expect(interstitial.reason).toBeDefined();
      expect(rewarded).toMatchObject({ shown: false, rewarded: false });
      expect(events.filter((e) => e.startsWith("ad:"))).toEqual([]);
    });

    it("tells the game whether to offer an ad at all", async () => {
      const { platform, hasSdk } = await booted(createHarness(portal));
      for (const kind of ["interstitial", "rewarded"] as AdKind[]) {
        const listed = platform.capabilities.ads.includes(kind);
        expect(platform.adAvailability(kind)).toBe(
          !listed ? "unsupported" : hasSdk ? "available" : "disabled",
        );
      }
      expect(platform.adAvailability("banner")).toBe("unsupported");
    });

    it("runs a break through withAdBreak: paused, muted, gameplay restored", async () => {
      const { platform } = await booted(createHarness(portal));
      const game = new Game({ scheduler: new ManualScheduler() });
      game.start();
      bindPlatform(game, platform);
      platform.gameplayStart();
      const muted: boolean[] = [];
      let pausedDuring = false;
      await withAdBreak(
        game,
        platform,
        async () => {
          pausedDuring = game.paused;
          return platform.showInterstitial();
        },
        { mute: () => muted.push(true), unmute: () => muted.push(false) },
      );
      expect(pausedDuring).toBe(true);
      expect(muted).toEqual([true, false]);
      expect(game.paused).toBe(false);
      expect(platform.gameplayActive).toBe(true);
    });
  });

  describe("storage", () => {
    it("round-trips a save", async () => {
      const { platform } = await booted(createHarness(portal));
      await platform.storage.set("best", "42");
      await expect(platform.storage.get("best")).resolves.toBe("42");
      await platform.storage.remove("best");
      await expect(platform.storage.get("best")).resolves.toBeNull();
    });
  });

  describe("pause and resume", () => {
    it("pauses the game for a hidden tab and resumes it on return", async () => {
      const { platform } = await booted(createHarness(portal));
      const game = new Game({ scheduler: new ManualScheduler() });
      game.start();
      const binding = bindPlatform(game, platform);
      platform.gameplayStart();
      visibility = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
      expect(game.paused).toBe(true);
      expect(binding.audioMuted).toBe(true);
      // Reported only where the portal asks for it (CrazyGames and Yandex handle it).
      expect(platform.gameplayActive).toBe(!platform.capabilities.gameplayStopOnHidden);
      visibility = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
      expect(game.paused).toBe(false);
      expect(platform.gameplayActive).toBe(true);
      binding.dispose();
    });

    it("pauses and mutes while the portal holds the foreground, where it can", async () => {
      const harness = await booted(createHarness(portal));
      const game = new Game({ scheduler: new ManualScheduler() });
      game.start();
      const binding = bindPlatform(game, harness.platform);
      if (!harness.portalPause || !harness.portalResume) {
        expect(harness.platform.foreground).toBe(true);
        return;
      }
      harness.portalPause();
      expect(harness.platform.foreground).toBe(false);
      expect(game.paused).toBe(true);
      expect(binding.audioMuted).toBe(true);
      harness.portalResume();
      expect(game.paused).toBe(false);
      expect(binding.audioMuted).toBe(false);
      binding.dispose();
    });

    it("follows the portal's mute setting, where it has one", async () => {
      const harness = await booted(createHarness(portal));
      const game = new Game({ scheduler: new ManualScheduler() });
      const binding = bindPlatform(game, harness.platform);
      if (!harness.setPortalMute) {
        expect(harness.platform.settings.muteAudio).toBe(false);
        return;
      }
      harness.setPortalMute(true);
      expect(binding.audioMuted).toBe(true);
      harness.setPortalMute(false);
      expect(binding.audioMuted).toBe(false);
      binding.dispose();
    });
  });

  describe.each(["missing", "init-fails"] as const)("SDK %s", (sdk) => {
    it("still boots, plays and saves — as a plain web game", async () => {
      const { platform } = await booted(createHarness(portal, { sdk }));
      platform.gameplayStart();
      expect(platform.gameplayActive).toBe(true);
      await platform.storage.set("best", "3");
      await expect(platform.storage.get("best")).resolves.toBe("3");
    });

    it("hides ad offers and never rewards", async () => {
      const { platform } = await booted(createHarness(portal, { sdk }));
      expect(platform.adAvailability("rewarded")).not.toBe("available");
      const result = await platform.showRewarded();
      expect(result).toMatchObject({ shown: false, rewarded: false });
      expect(result.reason).toBeDefined();
    });
  });
});

describe("platform not configured", () => {
  it("refuses an id with no profile, loudly", () => {
    expect(() => createPlatform("newgrounds", { namespace: "t" })).toThrow(/Unknown platform/);
  });

  it("has an adapter for every id with a profile", () => {
    for (const id of KNOWN_PLATFORM_IDS) expect(createPlatform(id, { namespace: "t" }).id).toBe(id);
  });

  it("refuses a game config that names no platform", () => {
    expect(() =>
      validateGameConfig({
        game: { id: "g", name: "G", version: "0.1.0" },
        engine: { type: "pixijs" },
        platforms: [],
        monetization: { ad_kinds: [], iap: false },
        build: { command: "pnpm build", output: "dist" },
        verification: { smoke_test: true, performance_test: true, mobile_test: true },
        publishing: { enabled: false },
      }),
    ).toThrow();
  });
});
