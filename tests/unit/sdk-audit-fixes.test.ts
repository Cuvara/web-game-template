// Regression tests for the fixes made after auditing each adapter against its portal's
// current documentation (docs/sdk.md, "Audit"). One block per finding.

import { describe, expect, it } from "vitest";
import {
  AdPolicy,
  CRAZYGAMES_CAPABILITIES,
  CrazyGamesDataStorage,
  CrazyGamesPlatform,
  GAMEVUI_CAPABILITIES,
  GameVuiPlatform,
  GameplayLifecycle,
  MemoryStorageBackend,
  PokiPlatform,
  createPlatform,
  type CrazyGamesSdk,
} from "@wgf/platform-sdk";

describe("CrazyGames: dataModuleDisabled falls back to local saves", () => {
  it("switches for good on the first refusal, and keeps the save", async () => {
    const refusing = {
      data: {
        getItem: () => {
          throw { code: "dataModuleDisabled", message: "progress save not selected" };
        },
        setItem: () => {
          throw { code: "dataModuleDisabled", message: "progress save not selected" };
        },
        removeItem: () => {},
        clear: () => {},
      },
    } as unknown as CrazyGamesSdk;
    const storage = new CrazyGamesDataStorage(refusing, new MemoryStorageBackend());
    await storage.set("best", "9");
    expect(storage.dataModuleDisabled).toBe(true);
    await expect(storage.get("best")).resolves.toBe("9");
  });

  it("still rejects other data errors, so a failed save is never silent", async () => {
    const full = {
      data: {
        getItem: () => null,
        setItem: () => {
          throw { code: "dataLimitExcedeed", message: "over 1 MB" };
        },
        removeItem: () => {},
        clear: () => {},
      },
    } as unknown as CrazyGamesSdk;
    const storage = new CrazyGamesDataStorage(full, new MemoryStorageBackend());
    await expect(storage.set("big", "x")).rejects.toThrow(/dataLimitExcedeed/);
  });
});

describe("CrazyGames: loadingStop pairs with a loadingStart sent after a slow init", () => {
  it("sends loadingStop once the SDK arrives, if the game was already ready", async () => {
    const calls: string[] = [];
    let release!: (sdk: CrazyGamesSdk) => void;
    const sdk = {
      environment: "crazygames",
      init: () => Promise.resolve(),
      ad: { requestAd: () => {}, hasAdblock: () => Promise.resolve(false) },
      game: {
        loadingStart: () => calls.push("loadingStart"),
        loadingStop: () => calls.push("loadingStop"),
        gameplayStart: () => {},
        gameplayStop: () => {},
        settings: { muteAudio: false, disableChat: false },
        addSettingsChangeListener: () => {},
        removeSettingsChangeListener: () => {},
      },
      data: { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} },
      user: { isUserAccountAvailable: false, systemInfo: {}, getUser: () => Promise.resolve(null) },
    } as unknown as CrazyGamesSdk;
    const platform = new CrazyGamesPlatform({
      namespace: "t",
      loadSdk: () => new Promise((resolve) => (release = resolve)),
    });
    const init = platform.initialize();
    await platform.signalReady();
    expect(calls).toEqual([]);
    release(sdk);
    await init;
    expect(calls).toEqual(["loadingStart", "loadingStop"]);
    await platform.signalReady();
    expect(calls).toEqual(["loadingStart", "loadingStop"]);
  });

  it("reports loading as optional, as the docs say", () => {
    expect(CRAZYGAMES_CAPABILITIES.loadingApi).toBe("optional");
  });
});

describe("CrazyGames: rewarded ads count toward the midgame interval", () => {
  it("holds the next interstitial after a rewarded ad", () => {
    let now = 0;
    const policy = new AdPolicy(CRAZYGAMES_CAPABILITIES, () => now, ["interstitial", "rewarded"]);
    policy.record("rewarded");
    now = 60_000;
    expect(policy.check("interstitial")).toBe("too-soon");
    now = 180_000;
    expect(policy.check("interstitial")).toBeNull();
  });

  it("leaves other portals' intervals to interstitials alone by default", () => {
    let now = 0;
    const policy = new AdPolicy(CRAZYGAMES_CAPABILITIES, () => now);
    policy.record("rewarded");
    now = 1;
    expect(policy.check("interstitial")).toBeNull();
  });
});

describe("Poki: no ad break before gameLoadingFinished", () => {
  it("refuses a break the documented startup order does not allow", () => {
    const lifecycle = new GameplayLifecycle();
    expect(lifecycle.beginAd("commercialBreak")).toMatchObject({
      allowed: false,
      reason: "before-loading-finished",
    });
    lifecycle.loadingFinished();
    expect(lifecycle.beginAd("commercialBreak").allowed).toBe(true);
  });

  it("answers not-ready to a game that asks too early, without calling the SDK", async () => {
    const calls: string[] = [];
    const platform = new PokiPlatform({
      namespace: "t",
      storage: new MemoryStorageBackend(),
      setTimeout: () => 0,
      loadSdk: () =>
        Promise.resolve({
          init: () => Promise.resolve(),
          gameLoadingFinished: () => {},
          gameplayStart: () => {},
          gameplayStop: () => {},
          commercialBreak: () => (calls.push("commercialBreak"), Promise.resolve()),
          rewardedBreak: () => Promise.resolve(true),
        }),
    });
    await platform.initialize();
    await expect(platform.showInterstitial()).resolves.toEqual({
      shown: false,
      reason: "not-ready",
    });
    expect(calls).toEqual([]);
  });
});

describe("Poki: a rejected init() is an ad blocker", () => {
  it("reports adblock, and never rewards", async () => {
    const platform = new PokiPlatform({
      namespace: "t",
      storage: new MemoryStorageBackend(),
      setTimeout: () => 0,
      loadSdk: () =>
        Promise.resolve({
          init: () => Promise.reject(new Error("blocked")),
          gameLoadingFinished: () => {},
          gameplayStart: () => {},
          gameplayStop: () => {},
          commercialBreak: () => Promise.resolve(),
          rewardedBreak: () => Promise.resolve(false),
        }),
    });
    await platform.initialize();
    await platform.signalReady();
    expect(platform.adAvailability("rewarded")).toBe("adblock");
    await expect(platform.showRewarded()).resolves.toEqual({
      shown: false,
      rewarded: false,
      reason: "adblock",
    });
  });
});

describe("GameVui: an honest no-SDK adapter", () => {
  it("is what createPlatform returns, with nothing requestable", async () => {
    const platform = createPlatform("gamevui", { namespace: "t" });
    expect(platform).toBeInstanceOf(GameVuiPlatform);
    expect(platform.capabilities).toBe(GAMEVUI_CAPABILITIES);
    expect(GAMEVUI_CAPABILITIES.ads).toEqual([]);
    await platform.initialize();
    expect(platform.adAvailability("interstitial")).toBe("unsupported");
    await expect(platform.showRewarded()).resolves.toMatchObject({ rewarded: false });
    await expect(platform.getUser()).resolves.toBeNull();
  });

  it("loads no portal script", async () => {
    const appended: unknown[] = [];
    const doc = { head: { appendChild: (node: unknown) => appended.push(node) } };
    Object.assign(globalThis, { document: doc });
    try {
      const platform = new GameVuiPlatform({ namespace: "t" });
      await platform.initialize();
      await platform.signalReady();
      expect(appended).toEqual([]);
    } finally {
      delete (globalThis as { document?: unknown }).document;
    }
  });
});
