// The SDK contract, run against every adapter.
//
// Each adapter has its own detailed suite under tests/unit/. This one asks the same
// questions of all of them, so "the game survives a blocked SDK" or "no reward without the
// portal's confirmation" is a property of the platform layer rather than of whichever
// adapter someone remembered to test. A game written against @wgf/platform-sdk can rely on
// exactly what passes here, on every portal.

import { describe, expect, it, vi } from "vitest";
import { KNOWN_PLATFORM_IDS, createPlatform } from "@wgf/platform-sdk";
import { resolveBuildTarget } from "../../scripts/build/game-config-plugin.js";
import { HARNESSES, boot, settle, type SdkScript } from "./harness.js";

vi.spyOn(console, "warn").mockImplementation(() => undefined);

const UNAVAILABLE: readonly SdkScript[] = ["missing", "init-fails", "init-hangs"];

describe.each(HARNESSES.map((harness) => [harness.id, harness] as const))("%s", (_id, harness) => {
  it("is what the registry builds for its id", () => {
    expect(createPlatform(harness.id, { namespace: "contract" }).id).toBe(harness.id);
  });

  it("boots, reports ready and starts gameplay", async () => {
    const built = harness.build();
    await boot(built);
    expect(built.platform.usage.signalReadyCalls).toBeGreaterThan(0);
    built.platform.gameplayStart();
    expect(built.platform.gameplayActive).toBe(true);
    built.platform.gameplayStop();
    expect(built.platform.gameplayActive).toBe(false);
  });

  it("round-trips a save", async () => {
    const built = harness.build();
    await boot(built);
    await built.platform.storage.set("best", "42");
    expect(await built.platform.storage.get("best")).toBe("42");
    await built.platform.storage.remove("best");
    expect(await built.platform.storage.get("best")).toBeNull();
  });

  describe.each(UNAVAILABLE)("when the SDK is %s", (sdk) => {
    it("still boots, plays and saves", async () => {
      const built = harness.build({ sdk });
      await boot(built);
      built.platform.gameplayStart();
      expect(built.platform.gameplayActive).toBe(true);
      await built.platform.storage.set("k", "v");
      expect(await built.platform.storage.get("k")).toBe("v");
    });

    it("declines every ad without throwing, and never rewards", async () => {
      const built = harness.build({ sdk });
      await boot(built);
      const interstitial = await settle(built, built.platform.showInterstitial());
      const rewarded = await settle(built, built.platform.showRewarded());
      expect(interstitial.shown).toBe(false);
      expect(rewarded).toMatchObject({ shown: false, rewarded: false });
      expect(rewarded.reason).toBe(harness.hasAds ? "not-ready" : "unsupported");
      expect(built.platform.foreground).toBe(true);
    });
  });

  if (!harness.hasAds) {
    it("offers no ads, and says so rather than failing", async () => {
      const built = harness.build();
      await boot(built);
      expect(built.platform.capabilities.ads).toEqual([]);
      expect(await built.platform.showInterstitial()).toEqual({
        shown: false,
        reason: "unsupported",
      });
      expect(await built.platform.showRewarded()).toEqual({
        shown: false,
        rewarded: false,
        reason: "unsupported",
      });
    });
    return;
  }

  it("rewards only when the portal confirms the reward", async () => {
    const built = harness.build({ ad: "reward" });
    await boot(built);
    expect(await settle(built, built.platform.showRewarded())).toEqual({
      shown: true,
      rewarded: true,
    });
  });

  it("does not reward a player who closed the ad early", async () => {
    const built = harness.build({ ad: "close" });
    await boot(built);
    const result = await settle(built, built.platform.showRewarded());
    expect(result.rewarded).toBe(false);
  });

  it("reports an ad with no fill as not shown", async () => {
    const built = harness.build({ ad: "no-fill" });
    await boot(built);
    expect(await settle(built, built.platform.showRewarded())).toEqual({
      shown: false,
      rewarded: false,
      reason: "not-ready",
    });
    expect((await settle(built, built.platform.showInterstitial())).shown).toBe(false);
  });

  it("survives an SDK that fails an ad", async () => {
    const built = harness.build({ ad: "error" });
    await boot(built);
    const result = await settle(built, built.platform.showRewarded());
    expect(result).toMatchObject({ rewarded: false, reason: "error" });
    expect(built.platform.foreground).toBe(true);
  });

  it("takes the foreground for an ad and gives it back after", async () => {
    const built = harness.build({ ad: "reward" });
    await boot(built);
    built.platform.gameplayStart();
    const seen: string[] = [];
    built.platform.on("foreground:lost", () => seen.push("lost"));
    built.platform.on("foreground:gained", () => seen.push("gained"));
    await settle(built, built.platform.showInterstitial());
    expect(seen).toEqual(["lost", "gained"]);
    expect(built.platform.foreground).toBe(true);
    // Gameplay was reported stopped for the ad; the game reports it restarted.
    expect(built.platform.gameplayActive).toBe(false);
  });

  it("refuses a second ad while one is open", async () => {
    const built = harness.build({ ad: "hold" });
    await boot(built);
    const first = built.platform.showRewarded();
    await Promise.resolve();
    const second = await built.platform.showRewarded();
    expect(second).toEqual({ shown: false, rewarded: false, reason: "busy" });
    built.releaseAd();
    expect(await first).toEqual({ shown: true, rewarded: true });
  });

  if (harness.build().portalPause) {
    it("maps the portal's own pause and resume onto the foreground", async () => {
      const built = harness.build();
      await boot(built);
      const seen: string[] = [];
      built.platform.on("foreground:lost", () => seen.push("lost"));
      built.platform.on("foreground:gained", () => seen.push("gained"));
      built.portalPause!();
      built.portalPause!();
      expect(built.platform.foreground).toBe(false);
      built.portalResume!();
      expect(seen).toEqual(["lost", "gained"]);
    });
  }
});

describe("a platform that is not configured", () => {
  it("has a harness for every adapter the registry builds", () => {
    const built = KNOWN_PLATFORM_IDS.filter((id) => {
      try {
        createPlatform(id, { namespace: "contract" });
        return true;
      } catch {
        return false;
      }
    });
    expect([...built].sort()).toEqual(HARNESSES.map((harness) => harness.id).sort());
  });

  it("fails loudly for a profile whose adapter is not written", () => {
    expect(() => createPlatform("crazygames", { namespace: "contract" })).toThrow(
      /not implemented/,
    );
  });

  it("fails loudly for an id with no profile", () => {
    expect(() => createPlatform("newgrounds", { namespace: "contract" })).toThrow(
      /Unknown platform/,
    );
  });

  it("refuses to build for a platform the game config does not list", () => {
    const platforms = [{ id: "yandex" }, { id: "poki" }];
    expect(resolveBuildTarget(platforms, "poki")).toBe("poki");
    expect(resolveBuildTarget(platforms, null)).toBeNull();
    expect(() => resolveBuildTarget(platforms, "gamevui")).toThrow(/not a platform/);
  });
});
