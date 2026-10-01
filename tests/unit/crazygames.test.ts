import { describe, expect, it, vi } from "vitest";
import {
  CRAZYGAMES_CAPABILITIES,
  CrazyGamesPlatform,
  createPlatform,
  type CrazyGamesAdCallbacks,
  type CrazyGamesSdk,
  type CrazyGamesSettings,
} from "@wgf/platform-sdk";

type AdScript =
  | { kind: "finish" }
  | { kind: "error"; code: string }
  | { kind: "error-before-start"; code: string }
  | { kind: "never" }
  | { kind: "throw" };

interface FakeOptions {
  environment?: "local" | "crazygames" | "disabled";
  ad?: AdScript;
  adblock?: boolean;
  settings?: CrazyGamesSettings;
  user?: { username: string; profilePictureUrl?: string } | null;
  accountsAvailable?: boolean;
  dataThrows?: { code: string; message: string };
}

/** A fake of the documented v3 surface, recording every call in order. */
function fakeSdk(options: FakeOptions = {}) {
  const calls: string[] = [];
  const data = new Map<string, string>();
  const settingsListeners: ((settings: CrazyGamesSettings) => void)[] = [];
  let pendingAd: CrazyGamesAdCallbacks | undefined;

  const sdk: CrazyGamesSdk = {
    environment: options.environment ?? "crazygames",
    init: vi.fn(() => {
      calls.push("init");
      return Promise.resolve();
    }),
    ad: {
      requestAd(type, callbacks) {
        calls.push(`requestAd:${type}`);
        const script = options.ad ?? { kind: "finish" };
        switch (script.kind) {
          case "finish":
            callbacks?.adStarted?.();
            callbacks?.adFinished?.();
            return;
          case "error":
            callbacks?.adStarted?.();
            callbacks?.adError?.({ code: script.code, message: script.code });
            return;
          case "error-before-start":
            callbacks?.adError?.({ code: script.code, message: script.code });
            return;
          case "never":
            pendingAd = callbacks;
            return;
          case "throw":
            throw { code: "other", message: "boom" };
        }
      },
      hasAdblock: () => Promise.resolve(options.adblock ?? false),
    },
    game: {
      gameplayStart: () => calls.push("gameplayStart"),
      gameplayStop: () => calls.push("gameplayStop"),
      loadingStart: () => calls.push("loadingStart"),
      loadingStop: () => calls.push("loadingStop"),
      settings: options.settings ?? { disableChat: false, muteAudio: false },
      addSettingsChangeListener: (listener) => settingsListeners.push(listener),
      removeSettingsChangeListener: () => {},
    },
    data: {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        if (options.dataThrows) throw options.dataThrows;
        data.set(key, value);
      },
      removeItem: (key) => void data.delete(key),
      clear: () => data.clear(),
    },
    user: {
      isUserAccountAvailable: options.accountsAvailable ?? true,
      systemInfo: {
        locale: "de-DE",
        device: { type: "tablet" },
        applicationType: "apple_store",
      },
      getUser: () => Promise.resolve(options.user ?? null),
    },
  };

  return {
    sdk,
    calls,
    data,
    changeSettings: (settings: CrazyGamesSettings) => settingsListeners.forEach((l) => l(settings)),
    pendingAd: () => pendingAd,
  };
}

async function ready(options: FakeOptions = {}, extra: { now?: () => number } = {}) {
  const fake = fakeSdk(options);
  const platform = new CrazyGamesPlatform({
    namespace: "test",
    loadSdk: () => Promise.resolve(fake.sdk),
    adStartTimeoutMs: 50,
    ...extra,
  });
  await platform.initialize();
  // Let the un-awaited adblock detection settle.
  await Promise.resolve();
  await Promise.resolve();
  return { platform, ...fake };
}

describe("CrazyGamesPlatform — lifecycle", () => {
  it("is what the registry builds for the crazygames id", () => {
    expect(createPlatform("crazygames", { namespace: "t" })).toBeInstanceOf(CrazyGamesPlatform);
  });

  it("awaits init once and reports loading start, then stop on ready", async () => {
    const { platform, calls, sdk } = await ready();
    await platform.initialize();
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["init", "loadingStart"]);

    await platform.signalReady();
    await platform.signalReady();
    expect(calls).toEqual(["init", "loadingStart", "loadingStop"]);
  });

  it("reports gameplay transitions once each, not repeats", async () => {
    const { platform, calls } = await ready();
    platform.gameplayStart();
    platform.gameplayStart();
    platform.gameplayStop();
    platform.gameplayStop();
    platform.gameplayStart();
    expect(calls.filter((c) => c.startsWith("gameplay"))).toEqual([
      "gameplayStart",
      "gameplayStop",
      "gameplayStart",
    ]);
    expect(platform.usage.gameplayStartCalls).toBe(2);
  });

  it("does not ask the game to report focus loss", () => {
    expect(CRAZYGAMES_CAPABILITIES.gameplayStopOnHidden).toBe(false);
  });

  it("reads language, device and app from systemInfo", async () => {
    const { platform } = await ready();
    expect(platform.environment).toEqual({ device: "tablet", inPortalApp: true });
    expect(platform.language).toBe("de");
    expect(platform.foreground).toBe(true);
  });
});

describe("CrazyGamesPlatform — degraded environments", () => {
  it("makes no SDK calls on a disabled environment and keeps the game playable", async () => {
    const { platform, calls } = await ready({ environment: "disabled" });
    expect(platform.mode).toBe("disabled");
    platform.gameplayStart();
    await platform.signalReady();
    expect(calls).toEqual(["init"]);
    expect(platform.adAvailability("rewarded")).toBe("disabled");
    await expect(platform.showRewarded()).resolves.toEqual({
      shown: false,
      rewarded: false,
      reason: "disabled",
    });
    await platform.storage.set("k", "v");
    await expect(platform.storage.get("k")).resolves.toBe("v");
  });

  it("survives the SDK script failing to load", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const platform = new CrazyGamesPlatform({
      namespace: "t",
      loadSdk: () => Promise.reject(new Error("blocked")),
    });
    await expect(platform.initialize()).resolves.toBeUndefined();
    expect(platform.mode).toBe("unavailable");
    // The SDK never loaded, so this is "not-ready" (its SDK is unavailable), not the
    // portal-level "disabled".
    await expect(platform.showInterstitial()).resolves.toEqual({
      shown: false,
      reason: "not-ready",
    });
    warn.mockRestore();
  });
});

describe("CrazyGamesPlatform — ads", () => {
  it("emits ad:start only once the ad plays and ad:end after it", async () => {
    const { platform, calls } = await ready();
    const seen: string[] = [];
    platform.on("ad:start", ({ kind }) => seen.push(`start:${kind}`));
    platform.on("ad:end", ({ kind }) => seen.push(`end:${kind}`));

    await expect(platform.showInterstitial()).resolves.toEqual({ shown: true });
    expect(calls).toContain("requestAd:midgame");
    expect(seen).toEqual(["start:interstitial", "end:interstitial"]);
    expect(platform.observedLaunchStage).toBe("full");
  });

  it("calls AdHooks.onStart when the ad starts, and not for an unfilled request", async () => {
    const filled = await ready();
    const onStart = vi.fn();
    await filled.platform.showRewarded({ onStart });
    expect(onStart).toHaveBeenCalledTimes(1);

    const unfilled = await ready({ ad: { kind: "error-before-start", code: "unfilled" } });
    const never = vi.fn();
    await unfilled.platform.showInterstitial({ onStart: never });
    expect(never).not.toHaveBeenCalled();
  });

  it("reports gameplayActive for the contract", async () => {
    const { platform } = await ready();
    expect(platform.gameplayActive).toBe(false);
    platform.gameplayStart();
    expect(platform.gameplayActive).toBe(true);
  });

  it("does not emit ad:start for an unfilled request, so the game does not blip its audio", async () => {
    const { platform } = await ready({ ad: { kind: "error-before-start", code: "unfilled" } });
    const started = vi.fn();
    platform.on("ad:start", started);
    await expect(platform.showInterstitial()).resolves.toEqual({
      shown: false,
      reason: "not-ready",
    });
    expect(started).not.toHaveBeenCalled();
  });

  it("rewards only on adFinished", async () => {
    const finished = await ready();
    await expect(finished.platform.showRewarded()).resolves.toEqual({
      shown: true,
      rewarded: true,
    });

    const errored = await ready({ ad: { kind: "error", code: "other" } });
    await expect(errored.platform.showRewarded()).resolves.toEqual({
      shown: false,
      rewarded: false,
      reason: "error",
    });
  });

  it.each([
    ["adsDisabledBasicLaunch", "disabled"],
    ["adblock", "adblock"],
    ["unfilled", "not-ready"],
    ["adCooldown", "too-soon"],
    ["other", "error"],
    ["something-new", "error"],
  ])("maps the %s ad error to %s", async (code, reason) => {
    const { platform } = await ready({ ad: { kind: "error-before-start", code } });
    await expect(platform.showRewarded()).resolves.toMatchObject({ rewarded: false, reason });
  });

  it("hides rewarded offers for the rest of the session in Basic Launch", async () => {
    const { platform, calls } = await ready({
      ad: { kind: "error-before-start", code: "adsDisabledBasicLaunch" },
    });
    expect(platform.adAvailability("rewarded")).toBe("available");
    await platform.showRewarded();
    expect(platform.observedLaunchStage).toBe("basic");
    expect(platform.adAvailability("rewarded")).toBe("disabled");
    await platform.showRewarded();
    expect(calls.filter((c) => c.startsWith("requestAd"))).toHaveLength(1);
  });

  it("reports adblock availability from detection", async () => {
    const { platform } = await ready({ adblock: true });
    expect(platform.adAvailability("rewarded")).toBe("adblock");
  });

  it("does not claim banner support the contract cannot deliver", async () => {
    const { platform } = await ready();
    expect(platform.adAvailability("banner")).toBe("unsupported");
  });

  it("refuses a second ad while one is open instead of chaining", async () => {
    const { platform, calls } = await ready({ ad: { kind: "never" } });
    const first = platform.showRewarded();
    await expect(platform.showInterstitial()).resolves.toEqual({
      shown: false,
      reason: "busy",
    });
    expect(calls.filter((c) => c.startsWith("requestAd"))).toHaveLength(1);
    await first;
  });

  it("gives up on an ad that never starts, then still mutes for it if it starts late", async () => {
    const fake = await ready({ ad: { kind: "never" } });
    const seen: string[] = [];
    fake.platform.on("ad:start", () => seen.push("start"));
    fake.platform.on("ad:end", () => seen.push("end"));

    await expect(fake.platform.showInterstitial()).resolves.toEqual({
      shown: false,
      reason: "error",
    });
    fake.pendingAd()?.adStarted?.();
    fake.pendingAd()?.adFinished?.();
    expect(seen).toEqual(["start", "end"]);
  });

  it("rewards normally without any late event", async () => {
    const { platform } = await ready();
    const late = vi.fn();
    platform.on("ad:late-reward", late);
    await expect(platform.showRewarded()).resolves.toEqual({ shown: true, rewarded: true });
    expect(late).not.toHaveBeenCalled();
    expect(platform.usage.adsShown.rewarded).toBe(1);
  });

  it("gives up on a rewarded ad that never starts, and does not reward", async () => {
    const { platform } = await ready({ ad: { kind: "never" } });
    const late = vi.fn();
    platform.on("ad:late-reward", late);
    await expect(platform.showRewarded()).resolves.toEqual({
      shown: false,
      rewarded: false,
      reason: "error",
    });
    expect(late).not.toHaveBeenCalled();
    expect(platform.usage.adsShown.rewarded).toBe(0);
  });

  it("owes the reward as a single ad:late-reward when a rewarded ad finishes after the watchdog", async () => {
    const fake = await ready({ ad: { kind: "never" } });
    const seen: string[] = [];
    fake.platform.on("ad:start", () => seen.push("start"));
    fake.platform.on("ad:end", () => seen.push("end"));
    const late = vi.fn();
    fake.platform.on("ad:late-reward", late);

    // The request times out and resolves rewarded:false — the reward is not observable here.
    await expect(fake.platform.showRewarded()).resolves.toEqual({
      shown: false,
      rewarded: false,
      reason: "error",
    });

    // The ad opens late and plays to completion. The reward is now owed via the event.
    fake.pendingAd()?.adStarted?.();
    fake.pendingAd()?.adFinished?.();
    expect(seen).toEqual(["start", "end"]);
    expect(late).toHaveBeenCalledTimes(1);
    expect(late).toHaveBeenCalledWith({ kind: "rewarded" });
    expect(fake.platform.usage.adsShown.rewarded).toBe(1);
  });

  it("does not double-reward when the late adFinished callback fires twice", async () => {
    const fake = await ready({ ad: { kind: "never" } });
    const seen: string[] = [];
    fake.platform.on("ad:end", () => seen.push("end"));
    const late = vi.fn();
    fake.platform.on("ad:late-reward", late);

    await fake.platform.showRewarded();
    fake.pendingAd()?.adStarted?.();
    fake.pendingAd()?.adFinished?.();
    // A duplicate SDK callback must not emit or record a second time.
    fake.pendingAd()?.adFinished?.();
    expect(late).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(["end"]);
    expect(fake.platform.usage.adsShown.rewarded).toBe(1);
  });

  it("keeps a late interstitial to just ad:end, never a late reward", async () => {
    const fake = await ready({ ad: { kind: "never" } });
    const late = vi.fn();
    fake.platform.on("ad:late-reward", late);

    await fake.platform.showInterstitial();
    fake.pendingAd()?.adStarted?.();
    fake.pendingAd()?.adFinished?.();
    expect(late).not.toHaveBeenCalled();
    expect(fake.platform.usage.adsShown.interstitial).toBe(0);
  });

  it("does not reward when a late rewarded ad errors instead of finishing", async () => {
    const fake = await ready({ ad: { kind: "never" } });
    const seen: string[] = [];
    fake.platform.on("ad:end", () => seen.push("end"));
    const late = vi.fn();
    fake.platform.on("ad:late-reward", late);

    await fake.platform.showRewarded();
    fake.pendingAd()?.adStarted?.();
    fake.pendingAd()?.adError?.({ code: "other", message: "boom" });
    expect(late).not.toHaveBeenCalled();
    expect(seen).toEqual(["end"]);
    expect(fake.platform.usage.adsShown.rewarded).toBe(0);
  });

  it("turns a throwing requestAd into a skipped ad", async () => {
    const { platform } = await ready({ ad: { kind: "throw" } });
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: false, reason: "error" });
  });

  it("skips a second midgame inside the three-minute interval locally", async () => {
    let now = 0;
    const { platform, calls } = await ready({}, { now: () => now });
    await platform.showInterstitial();
    now = 60_000;
    await expect(platform.showInterstitial()).resolves.toEqual({
      shown: false,
      reason: "too-soon",
    });
    now = 181_000;
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: true });
    expect(calls.filter((c) => c === "requestAd:midgame")).toHaveLength(2);
  });
});

describe("CrazyGamesPlatform — saves made without the SDK", () => {
  function memoryLocalStorage(): Storage {
    const data = new Map<string, string>();
    return {
      get length() {
        return data.size;
      },
      key: (index) => [...data.keys()][index] ?? null,
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, String(value)),
      removeItem: (key) => void data.delete(key),
      clear: () => data.clear(),
    };
  }

  it("copies fallback saves into the data module once the SDK is back, never over cloud data", async () => {
    vi.stubGlobal("localStorage", memoryLocalStorage());
    try {
      // Session 1: SDK blocked, progress saved locally.
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const blocked = new CrazyGamesPlatform({
        namespace: "orb",
        loadSdk: () => Promise.reject(new Error("blocked")),
      });
      await blocked.initialize();
      await blocked.storage.set("progress", "local-level-4");
      await blocked.storage.set("settings", "local-settings");
      warn.mockRestore();

      // Session 2: SDK loads; the cloud already has settings from another device.
      const fake = fakeSdk();
      fake.data.set("settings", "cloud-settings");
      const restored = new CrazyGamesPlatform({
        namespace: "orb",
        loadSdk: () => Promise.resolve(fake.sdk),
      });
      await restored.initialize();
      await expect(restored.storage.get("progress")).resolves.toBe("local-level-4");
      await expect(restored.storage.get("settings")).resolves.toBe("cloud-settings");

      // A copy is kept through the boot that migrated it (the cloud sync is debounced) and
      // removed on the next boot, once the Data module is seen holding it. "settings" was
      // already in the cloud, so its stale local copy goes at once.
      expect(localStorage.length).toBe(1);
      const again = new CrazyGamesPlatform({
        namespace: "orb",
        loadSdk: () => Promise.resolve(fake.sdk),
      });
      await again.initialize();
      expect(localStorage.length).toBe(0);

      // Spent: a later account on this browser does not inherit it.
      const later = fakeSdk();
      const nextAccount = new CrazyGamesPlatform({
        namespace: "orb",
        loadSdk: () => Promise.resolve(later.sdk),
      });
      await nextAccount.initialize();
      expect(later.data.size).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("CrazyGamesPlatform — settings, data, user", () => {
  it("applies muteAudio at init and emits changes", async () => {
    const fake = await ready({ settings: { disableChat: false, muteAudio: true } });
    expect(fake.platform.settings.muteAudio).toBe(true);
    const changes = vi.fn();
    fake.platform.on("settings:change", changes);
    fake.changeSettings({ disableChat: false, muteAudio: false });
    expect(changes).toHaveBeenCalledWith({ muteAudio: false });
  });

  it("stores progress in the data module, not in its own localStorage keys", async () => {
    const { platform, data } = await ready();
    await platform.storage.set("progress", '{"level":3}');
    expect(data.get("progress")).toBe('{"level":3}');
    await expect(platform.storage.get("progress")).resolves.toBe('{"level":3}');
    await platform.storage.remove("progress");
    expect(data.has("progress")).toBe(false);
  });

  it("rejects a save the data module refuses, with the code", async () => {
    const { platform } = await ready({
      dataThrows: { code: "dataLimitExcedeed", message: "too big" },
    });
    await expect(platform.storage.set("k", "v")).rejects.toThrow(/dataLimitExcedeed/);
  });

  it("maps the user and returns null for guests or unavailable accounts", async () => {
    const withUser = await ready({
      user: { username: "SingingCheese.TLNU", profilePictureUrl: "https://example/a.png" },
    });
    await expect(withUser.platform.getUser()).resolves.toEqual({
      username: "SingingCheese.TLNU",
      avatarUrl: "https://example/a.png",
    });
    const guest = await ready({ user: null });
    await expect(guest.platform.getUser()).resolves.toBeNull();
    const embedded = await ready({ accountsAvailable: false, user: { username: "x" } });
    await expect(embedded.platform.getUser()).resolves.toBeNull();
  });
});

describe("CrazyGamesPlatform — an init that does not answer", () => {
  function stalledInit() {
    const fake = fakeSdk();
    let finishInit: () => void = () => {};
    vi.mocked(fake.sdk.init).mockImplementation(() => {
      fake.calls.push("init");
      return new Promise<void>((resolve) => (finishInit = resolve));
    });
    const platform = new CrazyGamesPlatform({
      namespace: "stalled",
      loadSdk: () => Promise.resolve(fake.sdk),
      initTimeoutMs: 20,
      adStartTimeoutMs: 50,
    });
    return { ...fake, platform, finishInit: () => finishInit() };
  }

  it("boots without the SDK once the init deadline passes", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { platform, calls } = stalledInit();
    await expect(platform.initialize()).resolves.toBeUndefined();
    expect(platform.mode).toBe("unavailable");
    expect(platform.adAvailability("rewarded")).toBe("disabled");
    await expect(platform.showInterstitial()).resolves.toEqual({
      shown: false,
      reason: "not-ready",
    });
    await platform.storage.set("k", "v");
    await expect(platform.storage.get("k")).resolves.toBe("v");
    expect(calls).toEqual(["init"]);
    warn.mockRestore();
  });

  it("switches ads and gameplay reports on when init finishes late, keeping local saves", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { platform, calls, data, finishInit } = stalledInit();
    await platform.initialize();
    await platform.storage.set("progress", "3");
    await platform.signalReady();
    platform.gameplayStart();

    finishInit();
    await Promise.resolve();
    await Promise.resolve();
    expect(platform.mode).toBe("sdk");
    expect(calls).toEqual(["init", "loadingStart", "loadingStop", "gameplayStart"]);
    // Reads keep answering from where the game already loaded its save.
    await expect(platform.storage.get("progress")).resolves.toBe("3");
    expect(data.size).toBe(0);
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: true });
    warn.mockRestore();
  });
});

describe("CrazyGamesPlatform — an ad that never reports its end", () => {
  async function capped(kind: "interstitial" | "rewarded") {
    const fake = fakeSdk({ ad: { kind: "never" } });
    const platform = new CrazyGamesPlatform({
      namespace: "capped",
      loadSdk: () => Promise.resolve(fake.sdk),
      adStartTimeoutMs: 20,
      adMaxDurationMs: 40,
    });
    await platform.initialize();
    const seen: string[] = [];
    platform.on("foreground:lost", () => seen.push("lost"));
    platform.on("ad:start", () => seen.push("start"));
    platform.on("ad:end", () => seen.push("end"));
    platform.on("foreground:gained", () => seen.push("gained"));
    platform.on("ad:late-reward", () => seen.push("late-reward"));
    const showing = kind === "rewarded" ? platform.showRewarded() : platform.showInterstitial();
    fake.pendingAd()?.adStarted?.();
    return { platform, seen, showing, pending: fake.pendingAd };
  }

  it("resolves a started interstitial unshown after the cap and hands the foreground back", async () => {
    const { platform, seen, showing, pending } = await capped("interstitial");
    // Well past the 20 ms start watchdog: once started, only the cap may end it.
    await expect(showing).resolves.toEqual({ shown: false, reason: "error" });
    expect(seen).toEqual(["lost", "start", "gained", "end"]);
    expect(platform.foreground).toBe(true);

    pending()?.adFinished?.();
    pending()?.adError?.({ code: "other", message: "late" });
    expect(seen).toHaveLength(4);
    expect(platform.usage.adsShown.interstitial).toBe(0);
  });

  it("does not reward at the cap, and owes a later adFinished once as ad:late-reward", async () => {
    const { platform, seen, showing, pending } = await capped("rewarded");
    await expect(showing).resolves.toEqual({ shown: false, rewarded: false, reason: "error" });
    expect(platform.foreground).toBe(true);

    pending()?.adFinished?.();
    pending()?.adFinished?.();
    expect(seen).toEqual(["lost", "start", "gained", "end", "late-reward"]);
    expect(platform.usage.adsShown.rewarded).toBe(1);
  });

  it("caps an ad that started after the watchdog and then never ended", async () => {
    const fake = fakeSdk({ ad: { kind: "never" } });
    const platform = new CrazyGamesPlatform({
      namespace: "late-capped",
      loadSdk: () => Promise.resolve(fake.sdk),
      adStartTimeoutMs: 10,
      adMaxDurationMs: 30,
    });
    await platform.initialize();
    const seen: string[] = [];
    platform.on("ad:start", () => seen.push("start"));
    platform.on("ad:end", () => seen.push("end"));
    await platform.showInterstitial();

    fake.pendingAd()?.adStarted?.();
    expect(platform.foreground).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(seen).toEqual(["start", "end"]);
    expect(platform.foreground).toBe(true);
    fake.pendingAd()?.adFinished?.();
    expect(seen).toEqual(["start", "end"]);
  });
});
