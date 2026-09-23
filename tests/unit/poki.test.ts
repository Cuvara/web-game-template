import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MemoryStorageBackend,
  POKI_CAPABILITIES,
  PokiPlatform,
  createPlatform,
  loadPokiSdkScript,
  type PokiSdk,
} from "@wgf/platform-sdk";

type AdScript = "play" | "no-fill" | "throw";

/** A stand-in for window.PokiSDK that records calls in order. */
function fakeSdk(
  options: { init?: "resolve" | "reject" | "hang"; ad?: AdScript; reward?: boolean } = {},
) {
  const calls: string[] = [];
  const ad = options.ad ?? "play";
  const sdk: PokiSdk = {
    init: () => {
      calls.push("init");
      if (options.init === "reject") return Promise.reject(new Error("adblock"));
      if (options.init === "hang") return new Promise(() => {});
      return Promise.resolve();
    },
    gameLoadingFinished: () => void calls.push("gameLoadingFinished"),
    gameplayStart: () => void calls.push("gameplayStart"),
    gameplayStop: () => void calls.push("gameplayStop"),
    commercialBreak: (onStart) => {
      calls.push("commercialBreak");
      if (ad === "throw") return Promise.reject(new Error("sdk"));
      if (ad === "play") onStart?.();
      return Promise.resolve();
    },
    rewardedBreak: (onStart) => {
      calls.push("rewardedBreak");
      if (ad === "throw") return Promise.reject(new Error("sdk"));
      if (ad === "play") onStart?.();
      return Promise.resolve(ad === "play" && (options.reward ?? true));
    },
  };
  return { sdk, calls };
}

/** A setTimeout the test fires by hand, so no test waits on real time. */
function manualTimers() {
  const pending: Array<() => void> = [];
  return {
    setTimeout: (callback: () => void) => void pending.push(callback),
    fireAll: () => pending.splice(0).forEach((callback) => callback()),
  };
}

function platformWith(sdk: PokiSdk | null, timers = manualTimers()) {
  return new PokiPlatform({
    namespace: "test",
    storage: new MemoryStorageBackend(),
    loadSdk: () => Promise.resolve(sdk),
    setTimeout: timers.setTimeout,
    onRejected: () => {},
  });
}

async function readyPlatform(options: Parameters<typeof fakeSdk>[0] = {}) {
  const { sdk, calls } = fakeSdk(options);
  const platform = platformWith(sdk);
  await platform.initialize();
  await platform.signalReady();
  return { platform, calls };
}

describe("PokiPlatform", () => {
  it("is what the registry builds for poki", () => {
    const platform = createPlatform("poki", { namespace: "test" });
    expect(platform).toBeInstanceOf(PokiPlatform);
    expect(platform.capabilities).toBe(POKI_CAPABILITIES);
  });

  it("offers interstitial and rewarded, never banners, and sets no local ad timer", () => {
    expect(POKI_CAPABILITIES.ads).toEqual(["interstitial", "rewarded"]);
    expect(POKI_CAPABILITIES.interstitialMinIntervalS).toBeNull();
    expect(POKI_CAPABILITIES.loadingApi).toBe("required");
  });

  it("inits once however often initialize is called", async () => {
    const { sdk, calls } = fakeSdk();
    const platform = platformWith(sdk);
    await Promise.all([platform.initialize(), platform.initialize()]);
    await platform.initialize();
    expect(calls).toEqual(["init"]);
    expect(platform.sdkState).toBe("ready");
  });

  it("does not report gameplay at load — only when the game says so", async () => {
    const { calls } = await readyPlatform();
    expect(calls).toEqual(["init", "gameLoadingFinished"]);
  });

  it("drops gameplayStart before gameLoadingFinished", async () => {
    const { sdk, calls } = fakeSdk();
    const platform = platformWith(sdk);
    await platform.initialize();
    platform.gameplayStart();
    expect(calls).toEqual(["init"]);
    expect(platform.rejectedCalls).toEqual([
      { call: "gameplayStart", reason: "before-loading-finished" },
    ]);
  });

  it("drops duplicate gameplay events", async () => {
    const { platform, calls } = await readyPlatform();
    platform.gameplayStart();
    platform.gameplayStart();
    platform.gameplayStop();
    platform.gameplayStop();
    expect(calls.slice(2)).toEqual(["gameplayStart", "gameplayStop"]);
  });

  it("runs the death/restart sequence: stop -> commercialBreak -> start", async () => {
    const { platform, calls } = await readyPlatform();
    platform.gameplayStart();
    platform.gameplayStop();
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: true });
    platform.gameplayStart();
    expect(calls.slice(2)).toEqual([
      "gameplayStart",
      "gameplayStop",
      "commercialBreak",
      "gameplayStart",
    ]);
    expect(platform.usage.adsShown.interstitial).toBe(1);
  });

  it("stops running gameplay itself before a break that interrupts it", async () => {
    const { platform, calls } = await readyPlatform();
    platform.gameplayStart();
    await platform.showInterstitial();
    expect(calls.slice(2)).toEqual(["gameplayStart", "gameplayStop", "commercialBreak"]);
    expect(platform.gameplayActive).toBe(false);
  });

  it("calls onStart when an ad starts, so the game can mute", async () => {
    const { platform } = await readyPlatform();
    const onStart = vi.fn();
    await platform.showInterstitial({ onStart });
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("reports no fill as not shown, without calling onStart", async () => {
    const { platform } = await readyPlatform({ ad: "no-fill" });
    const onStart = vi.fn();
    await expect(platform.showInterstitial({ onStart })).resolves.toEqual({
      shown: false,
      reason: "not-ready",
    });
    expect(onStart).not.toHaveBeenCalled();
  });

  it("never throws when the SDK fails an ad", async () => {
    const { platform } = await readyPlatform({ ad: "throw" });
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: false, reason: "error" });
    await expect(platform.showRewarded()).resolves.toEqual({
      shown: false,
      rewarded: false,
      reason: "error",
    });
    platform.gameplayStart();
    expect(platform.gameplayActive).toBe(true);
  });

  it("grants a reward only on Poki's success flag", async () => {
    const granted = await readyPlatform({ reward: true });
    await expect(granted.platform.showRewarded()).resolves.toEqual({
      shown: true,
      rewarded: true,
    });

    const declined = await readyPlatform({ reward: false });
    await expect(declined.platform.showRewarded()).resolves.toEqual({
      shown: true,
      rewarded: false,
    });

    const unfilled = await readyPlatform({ ad: "no-fill" });
    await expect(unfilled.platform.showRewarded()).resolves.toMatchObject({ rewarded: false });
  });

  it("runs the revive sequence: stop -> rewardedBreak -> start", async () => {
    const { platform, calls } = await readyPlatform();
    platform.gameplayStart();
    platform.gameplayStop();
    await platform.showRewarded();
    platform.gameplayStart();
    expect(calls.slice(2)).toEqual([
      "gameplayStart",
      "gameplayStop",
      "rewardedBreak",
      "gameplayStart",
    ]);
  });

  it("refuses a second break while one is running, and gameplay events during it", async () => {
    const { sdk, calls } = fakeSdk();
    let finish: () => void = () => {};
    sdk.commercialBreak = (onStart) => {
      calls.push("commercialBreak");
      onStart?.();
      return new Promise<void>((resolve) => (finish = resolve));
    };
    const platform = platformWith(sdk);
    await platform.initialize();
    await platform.signalReady();

    const first = platform.showInterstitial();
    await expect(platform.showRewarded()).resolves.toMatchObject({ reason: "busy" });
    platform.gameplayStart();
    finish();
    await first;

    expect(calls.filter((c) => c === "commercialBreak" || c === "rewardedBreak")).toEqual([
      "commercialBreak",
    ]);
    expect(calls).not.toContain("gameplayStart");
    expect(platform.rejectedCalls).toContainEqual({ call: "gameplayStart", reason: "during-ad" });
  });

  it("does not rate-limit commercial breaks — Poki decides", async () => {
    const { platform, calls } = await readyPlatform();
    await platform.showInterstitial();
    await platform.showInterstitial();
    expect(calls.filter((c) => c === "commercialBreak")).toHaveLength(2);
  });

  describe("when a break never settles", () => {
    // A stuck SDK or a lost callback leaves the break promise pending forever. The adapter
    // must not hang: it races the break against a deadline and, on the deadline, reports no
    // ad so bind.ts's withAdBreak resumes and unmutes the game.

    it("times out a rewarded break and reports no ad, without hanging", async () => {
      const timers = manualTimers();
      const { sdk, calls } = fakeSdk();
      sdk.rewardedBreak = (onStart) => {
        calls.push("rewardedBreak");
        onStart?.();
        return new Promise<boolean>(() => {}); // never settles
      };
      const platform = platformWith(sdk, timers);
      await platform.initialize();
      await platform.signalReady();

      const showing = platform.showRewarded();
      timers.fireAll(); // trip the ad-break deadline
      await expect(showing).resolves.toEqual({
        shown: false,
        rewarded: false,
        reason: "not-ready",
      });
      expect(platform.foreground).toBe(true);
      expect(platform.usage.adsShown.rewarded).toBe(0);
    });

    it("times out a commercial break and reports no ad, without hanging", async () => {
      const timers = manualTimers();
      const { sdk, calls } = fakeSdk();
      sdk.commercialBreak = (onStart) => {
        calls.push("commercialBreak");
        onStart?.();
        return new Promise<void>(() => {}); // never settles
      };
      const platform = platformWith(sdk, timers);
      await platform.initialize();
      await platform.signalReady();

      const showing = platform.showInterstitial();
      timers.fireAll(); // trip the ad-break deadline
      await expect(showing).resolves.toEqual({ shown: false, reason: "not-ready" });
      expect(platform.foreground).toBe(true);
      expect(platform.usage.adsShown.interstitial).toBe(0);
    });

    it("ignores a real reward that arrives after the deadline — no double grant", async () => {
      const timers = manualTimers();
      const { sdk, calls } = fakeSdk();
      let grant: (rewarded: boolean) => void = () => {};
      sdk.rewardedBreak = (onStart) => {
        calls.push("rewardedBreak");
        onStart?.();
        return new Promise<boolean>((resolve) => (grant = resolve));
      };
      const platform = platformWith(sdk, timers);
      await platform.initialize();
      await platform.signalReady();

      const showing = platform.showRewarded();
      timers.fireAll(); // deadline wins the race
      await expect(showing).resolves.toEqual({
        shown: false,
        rewarded: false,
        reason: "not-ready",
      });

      // Poki's genuine reward lands late. It must not re-grant or resolve a second time.
      grant(true);
      await Promise.resolve();
      await Promise.resolve();
      expect(platform.usage.adsShown.rewarded).toBe(0);
      expect(platform.foreground).toBe(true);
    });

    it("ignores a late rejection after the deadline — no unhandled result change", async () => {
      const timers = manualTimers();
      const { sdk, calls } = fakeSdk();
      let fail: (err: Error) => void = () => {};
      sdk.commercialBreak = (onStart) => {
        calls.push("commercialBreak");
        onStart?.();
        return new Promise<void>((_resolve, reject) => (fail = reject));
      };
      const platform = platformWith(sdk, timers);
      await platform.initialize();
      await platform.signalReady();

      const showing = platform.showInterstitial();
      timers.fireAll(); // deadline wins the race
      await expect(showing).resolves.toEqual({ shown: false, reason: "not-ready" });

      // A late SDK rejection must be swallowed, not surface as an unhandled rejection.
      fail(new Error("too late"));
      await Promise.resolve();
      await Promise.resolve();
      expect(platform.foreground).toBe(true);
    });
  });

  describe("with an ad blocker", () => {
    it("stays playable when the SDK script is blocked", async () => {
      const platform = platformWith(null);
      await platform.initialize();
      expect(platform.sdkState).toBe("unavailable");
      await platform.signalReady();
      platform.gameplayStart();
      expect(platform.gameplayActive).toBe(true);
      await expect(platform.showInterstitial()).resolves.toEqual({
        shown: false,
        reason: "not-ready",
      });
      await expect(platform.showRewarded()).resolves.toMatchObject({ rewarded: false });
    });

    it("carries on when init rejects, as Poki's docs say to", async () => {
      const { platform } = await readyPlatform({ init: "reject", ad: "no-fill" });
      expect(platform.sdkState).toBe("ready");
      await expect(platform.showRewarded()).resolves.toMatchObject({ rewarded: false });
    });

    it("boots without the SDK when init never settles", async () => {
      const timers = manualTimers();
      const { sdk } = fakeSdk({ init: "hang" });
      const platform = platformWith(sdk, timers);
      const initializing = platform.initialize();
      await Promise.resolve();
      timers.fireAll();
      await initializing;
      expect(platform.sdkState).toBe("unavailable");
      await expect(platform.showInterstitial()).resolves.toEqual({
        shown: false,
        reason: "not-ready",
      });
    });

    it("catches the SDK up on state when it connects after the deadline", async () => {
      const timers = manualTimers();
      const { sdk, calls } = fakeSdk();
      let release: () => void = () => {};
      sdk.init = () => {
        calls.push("init");
        return new Promise<void>((resolve) => (release = resolve));
      };
      const platform = platformWith(sdk, timers);
      const initializing = platform.initialize();
      await Promise.resolve();
      timers.fireAll();
      await initializing;
      await platform.signalReady();
      platform.gameplayStart();

      release();
      await vi.waitFor(() => expect(platform.sdkState).toBe("ready"));
      expect(calls).toEqual(["init", "gameLoadingFinished", "gameplayStart"]);
    });
  });
});

describe("loadPokiSdkScript with a tag already in the page", () => {
  const url = "https://game-cdn.poki.com/scripts/v2/poki-sdk.js";

  function pageWithTag(attributes: { async?: boolean; defer?: boolean }) {
    const tag = Object.assign(
      new EventTarget(),
      { async: false, defer: false, type: "" },
      attributes,
    );
    const win: { PokiSDK?: PokiSdk } = {};
    Object.assign(globalThis, {
      window: win,
      document: { querySelector: () => tag, head: { appendChild: () => {} } },
    });
    return { tag, win };
  }

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
  });

  it("treats a synchronous tag that left no SDK as blocked, without a second request", async () => {
    pageWithTag({});
    await expect(loadPokiSdkScript(url)).resolves.toBeNull();
  });

  it("waits for an async tag that is still loading", async () => {
    const { tag, win } = pageWithTag({ async: true });
    const loading = loadPokiSdkScript(url);
    const { sdk } = fakeSdk();
    win.PokiSDK = sdk;
    tag.dispatchEvent(new Event("load"));
    await expect(loading).resolves.toBe(sdk);
  });

  it("reports a deferred tag that fails as unavailable", async () => {
    const { tag } = pageWithTag({ defer: true });
    const loading = loadPokiSdkScript(url);
    tag.dispatchEvent(new Event("error"));
    await expect(loading).resolves.toBeNull();
  });
});

describe("PokiPlatform foreground signals", () => {
  it("gives up the foreground only while an ad is actually on screen", async () => {
    const { platform } = await readyPlatform();
    const seen: string[] = [];
    platform.on("foreground:lost", () => seen.push(`lost fg=${platform.foreground}`));
    platform.on("ad:start", ({ kind }) => seen.push(`start ${kind}`));
    platform.on("ad:end", ({ kind }) => seen.push(`end ${kind}`));
    platform.on("foreground:gained", () => seen.push(`gained fg=${platform.foreground}`));

    expect(platform.foreground).toBe(true);
    expect(platform.language).toBeNull();
    await platform.showInterstitial();
    expect(seen).toEqual([
      "lost fg=false",
      "start interstitial",
      "end interstitial",
      "gained fg=true",
    ]);
  });

  it("keeps the foreground when no ad plays", async () => {
    const { platform } = await readyPlatform({ ad: "no-fill" });
    const seen: string[] = [];
    platform.on("foreground:lost", () => seen.push("lost"));
    await platform.showRewarded();
    expect(seen).toEqual([]);
    expect(platform.foreground).toBe(true);
  });
});
