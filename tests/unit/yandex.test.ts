// The Yandex adapter against a fake SDK shaped like the documented one.
//
// The fake implements only what https://yandex.com/dev/games/doc/en/ describes and records
// every call, so these tests pin the adapter to the documented contract: which methods, in
// which order, how often. What the real portal does with those calls is checked in draft
// mode, not here.

import { describe, expect, it, vi } from "vitest";
import {
  MemoryStorageBackend,
  YANDEX_MIN_WRITE_INTERVAL_MS,
  YandexPlatform,
  YandexStorage,
  createPlatform,
  type Timers,
  type YaGamesGlobal,
  type YandexAdCallbacks,
  type YandexPlayer,
  type YandexRewardedCallbacks,
  type YandexSdk,
} from "@wgf/platform-sdk";

type AdScript = (callbacks: YandexRewardedCallbacks) => void;

class ManualTimers implements Timers {
  now = 0;
  #next = 1;
  readonly #pending = new Map<number, { at: number; handler: () => void }>();

  setTimeout(handler: () => void, ms: number): unknown {
    const id = this.#next++;
    this.#pending.set(id, { at: this.now + ms, handler });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.#pending.delete(handle as number);
  }

  advance(ms: number): void {
    this.now += ms;
    for (const [id, entry] of [...this.#pending]) {
      if (entry.at <= this.now) {
        this.#pending.delete(id);
        entry.handler();
      }
    }
  }
}

function fakeSdk(overrides: { lang?: string; player?: YandexPlayer | Error } = {}) {
  const calls: string[] = [];
  const listeners = new Map<string, Set<() => void>>();
  const data: Record<string, unknown> = { best: "7" };
  const player: YandexPlayer = {
    isAuthorized: () => false,
    getData: vi.fn(async () => ({ ...data })),
    setData: vi.fn(async (next: Record<string, unknown>) => {
      calls.push(`setData:${JSON.stringify(next)}`);
    }),
  };
  let fullscreen: AdScript = (callbacks) => {
    callbacks.onOpen?.();
    callbacks.onClose?.(true);
  };
  let rewarded: AdScript = (callbacks) => {
    callbacks.onOpen?.();
    callbacks.onRewarded?.();
    callbacks.onClose?.(true);
  };

  const sdk: YandexSdk = {
    environment: { app: { id: "1" }, i18n: { lang: overrides.lang ?? "ru" } },
    features: {
      LoadingAPI: { ready: () => calls.push("ready") },
      GameplayAPI: { start: () => calls.push("start"), stop: () => calls.push("stop") },
    },
    adv: {
      showFullscreenAdv: ({ callbacks }: { callbacks: YandexAdCallbacks }) => {
        calls.push("fullscreen");
        fullscreen(callbacks);
      },
      showRewardedVideo: ({ callbacks }: { callbacks: YandexRewardedCallbacks }) => {
        calls.push("rewarded");
        rewarded(callbacks);
      },
    },
    EVENTS: {
      ACCOUNT_SELECTION_DIALOG_OPENED: "ACCOUNT_SELECTION_DIALOG_OPENED",
      ACCOUNT_SELECTION_DIALOG_CLOSED: "ACCOUNT_SELECTION_DIALOG_CLOSED",
    },
    getPlayer: async () => {
      if (overrides.player instanceof Error) throw overrides.player;
      return overrides.player ?? player;
    },
    on: (event, listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    },
    off: (event, listener) => listeners.get(event)?.delete(listener),
  };

  const yaGames: YaGamesGlobal = { init: vi.fn(async () => sdk) };
  return {
    sdk,
    yaGames,
    calls,
    player,
    fire: (event: string) => listeners.get(event)?.forEach((listener) => listener()),
    setFullscreen: (script: AdScript) => (fullscreen = script),
    setRewarded: (script: AdScript) => (rewarded = script),
  };
}

function platformWith(fake: ReturnType<typeof fakeSdk>, timers = new ManualTimers()) {
  return new YandexPlatform({
    namespace: "test",
    loadSdk: async () => fake.yaGames,
    timers,
    now: () => timers.now,
    storage: new YandexStorage({
      namespace: "test",
      local: new MemoryStorageBackend(),
      timers,
      now: () => timers.now,
    }),
  });
}

describe("createPlatform('yandex')", () => {
  it("builds the Yandex adapter", () => {
    const platform = createPlatform("yandex", { namespace: "test" });
    expect(platform.id).toBe("yandex");
    expect(platform.capabilities.loadingApi).toBe("required");
  });
});

describe("YandexPlatform initialisation", () => {
  it("initialises once, however often it is asked", async () => {
    const fake = fakeSdk();
    const platform = platformWith(fake);
    await Promise.all([platform.initialize(), platform.initialize()]);
    await platform.initialize();
    expect(fake.yaGames.init).toHaveBeenCalledTimes(1);
    expect(platform.sdkAvailable).toBe(true);
  });

  it("takes the language from environment.i18n.lang (2.14)", async () => {
    const platform = platformWith(fakeSdk({ lang: "TR" }));
    await platform.initialize();
    expect(platform.language).toBe("tr");
  });

  it("restores saved progress from the player before the game is ready (1.9)", async () => {
    const platform = platformWith(fakeSdk());
    await platform.initialize();
    expect(platform.storage.cloud).toBe(true);
    await expect(platform.storage.get("best")).resolves.toBe("7");
  });

  it("degrades instead of failing boot when the SDK script is missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const platform = new YandexPlatform({
      namespace: "test",
      loadSdk: () => Promise.reject(new Error("/sdk.js failed to load")),
      storage: new YandexStorage({ namespace: "test", local: new MemoryStorageBackend() }),
    });
    await expect(platform.initialize()).resolves.toBeUndefined();
    expect(platform.sdkAvailable).toBe(false);
    expect(platform.language).toBeNull();
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: false, reason: "error" });
    await expect(platform.showRewarded()).resolves.toEqual({
      shown: false,
      rewarded: false,
      reason: "error",
    });
    await platform.storage.set("best", "3");
    await expect(platform.storage.get("best")).resolves.toBe("3");
    await expect(platform.signalReady()).resolves.toBeUndefined();
    warn.mockRestore();
  });

  it("keeps local saves when the player cannot be fetched", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const platform = platformWith(fakeSdk({ player: new Error("rate limited") }));
    await platform.initialize();
    expect(platform.sdkAvailable).toBe(true);
    expect(platform.storage.cloud).toBe(false);
    await platform.storage.set("best", "9");
    await expect(platform.storage.get("best")).resolves.toBe("9");
    warn.mockRestore();
  });

  it("gives up on a hung init after the timeout", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const timers = new ManualTimers();
    const platform = new YandexPlatform({
      namespace: "test",
      loadSdk: async () => ({ init: () => new Promise(() => undefined) }),
      timers,
      timeoutMs: 1_000,
      storage: new YandexStorage({ namespace: "test", local: new MemoryStorageBackend() }),
    });
    const init = platform.initialize();
    await Promise.resolve();
    await Promise.resolve();
    timers.advance(1_000);
    await init;
    expect(platform.sdkAvailable).toBe(false);
    warn.mockRestore();
  });
});

describe("YandexPlatform loading and gameplay markup (1.19)", () => {
  it("calls LoadingAPI.ready() exactly once", async () => {
    const fake = fakeSdk();
    const platform = platformWith(fake);
    await platform.initialize();
    platform.reportLoadingProgress(0.5);
    await platform.signalReady();
    await platform.signalReady();
    expect(fake.calls.filter((call) => call === "ready")).toHaveLength(1);
    expect(platform.usage.loadingProgressCalls).toBe(1);
  });

  it("sends GameplayAPI transitions only, never repeats", async () => {
    const fake = fakeSdk();
    const platform = platformWith(fake);
    await platform.initialize();
    platform.gameplayStop();
    platform.gameplayStart();
    platform.gameplayStart();
    platform.gameplayStop();
    platform.gameplayStop();
    platform.gameplayStart();
    expect(fake.calls).toEqual(["start", "stop", "start"]);
  });
});

describe("YandexPlatform portal pause and resume", () => {
  it("maps game_api_pause/resume to foreground events, once per transition", async () => {
    const fake = fakeSdk();
    const platform = platformWith(fake);
    await platform.initialize();
    const seen: string[] = [];
    platform.on("foreground:lost", () => seen.push("lost"));
    platform.on("foreground:gained", () => seen.push("gained"));

    fake.fire("game_api_pause");
    fake.fire("game_api_pause");
    expect(platform.foreground).toBe(false);
    fake.fire("game_api_resume");
    fake.fire("game_api_resume");
    expect(platform.foreground).toBe(true);
    expect(seen).toEqual(["lost", "gained"]);
  });

  it("remembers a pause that arrived before anyone subscribed (the launch ad)", async () => {
    const fake = fakeSdk();
    const platform = platformWith(fake);
    await platform.initialize();
    fake.fire("game_api_pause");
    expect(platform.foreground).toBe(false);
  });

  it("isolates a throwing listener", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fake = fakeSdk();
    const platform = platformWith(fake);
    await platform.initialize();
    const seen: string[] = [];
    platform.on("foreground:lost", () => {
      throw new Error("boom");
    });
    platform.on("foreground:lost", () => seen.push("second"));
    fake.fire("game_api_pause");
    expect(seen).toEqual(["second"]);
    error.mockRestore();
  });
});

describe("YandexPlatform ads", () => {
  it("shows an interstitial and brackets it with ad:start / ad:end", async () => {
    const fake = fakeSdk();
    const platform = platformWith(fake);
    await platform.initialize();
    const seen: string[] = [];
    platform.on("ad:start", ({ kind }) => seen.push(`start:${kind}`));
    platform.on("ad:end", ({ kind }) => seen.push(`end:${kind}`));
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: true });
    expect(seen).toEqual(["start:interstitial", "end:interstitial"]);
    expect(platform.usage.adsShown.interstitial).toBe(1);
  });

  it("refuses a second interstitial inside the profile's interval, without asking the SDK", async () => {
    const timers = new ManualTimers();
    const fake = fakeSdk();
    const platform = platformWith(fake, timers);
    await platform.initialize();
    await platform.showInterstitial();
    await expect(platform.showInterstitial()).resolves.toEqual({
      shown: false,
      reason: "too-soon",
    });
    expect(fake.calls.filter((call) => call === "fullscreen")).toHaveLength(1);
    timers.advance(60_000);
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: true });
  });

  it("reports an interstitial the portal closed unshown as not-ready", async () => {
    const fake = fakeSdk();
    fake.setFullscreen((callbacks) => callbacks.onClose?.(false));
    const platform = platformWith(fake);
    await platform.initialize();
    await expect(platform.showInterstitial()).resolves.toEqual({
      shown: false,
      reason: "not-ready",
    });
    // An unshown ad does not start the interval.
    fake.setFullscreen((callbacks) => callbacks.onClose?.(true));
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: true });
  });

  it("survives an SDK that throws or errors", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fake = fakeSdk();
    fake.setFullscreen(() => {
      throw new Error("adv broke");
    });
    fake.setRewarded((callbacks) => callbacks.onError?.(new Error("no fill")));
    const platform = platformWith(fake);
    await platform.initialize();
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: false, reason: "error" });
    await expect(platform.showRewarded()).resolves.toEqual({
      shown: false,
      rewarded: false,
      reason: "error",
    });
    warn.mockRestore();
  });

  it("returns control when the portal never answers an ad call", async () => {
    const timers = new ManualTimers();
    const fake = fakeSdk();
    fake.setFullscreen(() => undefined);
    const platform = platformWith(fake, timers);
    await platform.initialize();
    const result = platform.showInterstitial();
    timers.advance(8_000);
    await expect(result).resolves.toEqual({ shown: false, reason: "not-ready" });
  });

  it("grants a reward only on onRewarded", async () => {
    const fake = fakeSdk();
    const platform = platformWith(fake);
    await platform.initialize();
    await expect(platform.showRewarded()).resolves.toEqual({ shown: true, rewarded: true });

    // Watched part of it and closed: shown, but no reward.
    fake.setRewarded((callbacks) => {
      callbacks.onOpen?.();
      callbacks.onClose?.(true);
    });
    await expect(platform.showRewarded()).resolves.toEqual({ shown: true, rewarded: false });
  });

  it("allows only one ad on screen at a time", async () => {
    const fake = fakeSdk();
    let close: (() => void) | undefined;
    fake.setRewarded((callbacks) => {
      callbacks.onOpen?.();
      close = () => {
        callbacks.onRewarded?.();
        callbacks.onClose?.(true);
      };
    });
    const platform = platformWith(fake);
    await platform.initialize();
    const first = platform.showRewarded();
    await expect(platform.showRewarded()).resolves.toEqual({
      shown: false,
      rewarded: false,
      reason: "not-ready",
    });
    close?.();
    await expect(first).resolves.toEqual({ shown: true, rewarded: true });
  });
});

describe("YandexStorage", () => {
  it("writes the whole data object with flush, coalescing inside the rate limit", async () => {
    const timers = new ManualTimers();
    const fake = fakeSdk();
    const storage = new YandexStorage({
      namespace: "test",
      local: new MemoryStorageBackend(),
      timers,
      now: () => timers.now,
    });
    await storage.attach(fake.player);

    await storage.set("best", "10");
    await storage.whenSaved();
    expect(fake.player.setData).toHaveBeenCalledTimes(1);
    expect(fake.player.setData).toHaveBeenLastCalledWith(
      expect.objectContaining({ best: "10" }),
      true,
    );

    await storage.set("best", "11");
    await storage.set("best", "12");
    await storage.set("sound", "off");
    expect(fake.player.setData).toHaveBeenCalledTimes(1);

    timers.advance(YANDEX_MIN_WRITE_INTERVAL_MS);
    await storage.whenSaved();
    expect(fake.player.setData).toHaveBeenCalledTimes(2);
    expect(fake.player.setData).toHaveBeenLastCalledWith(
      expect.objectContaining({ best: "12", sound: "off" }),
      true,
    );
  });

  it("refuses a save over the 200 KB limit but keeps it locally", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fake = fakeSdk();
    const storage = new YandexStorage({ namespace: "test", local: new MemoryStorageBackend() });
    await storage.attach(fake.player);
    await storage.set("blob", "x".repeat(210 * 1024));
    await storage.whenSaved();
    expect(fake.player.setData).not.toHaveBeenCalled();
    expect(storage.lastError).toBeInstanceOf(Error);
    await expect(storage.get("blob")).resolves.toHaveLength(210 * 1024);
    warn.mockRestore();
  });

  it("keeps the local copy when a cloud write fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fake = fakeSdk();
    vi.mocked(fake.player.setData).mockRejectedValueOnce(new Error("offline"));
    const local = new MemoryStorageBackend();
    const storage = new YandexStorage({ namespace: "test", local });
    await storage.attach(fake.player);
    await storage.set("best", "5");
    await storage.whenSaved();
    await expect(local.get("best")).resolves.toBe("5");
    expect(storage.lastError).toBeInstanceOf(Error);
    warn.mockRestore();
  });

  it("removes a key from both copies", async () => {
    const fake = fakeSdk();
    const local = new MemoryStorageBackend();
    const storage = new YandexStorage({ namespace: "test", local });
    await storage.attach(fake.player);
    await storage.remove("best");
    await storage.whenSaved();
    await expect(storage.get("best")).resolves.toBeNull();
    const [written] = vi.mocked(fake.player.setData).mock.lastCall!;
    expect(written).not.toHaveProperty("best");
  });
});

describe("round-1 review fixes", () => {
  it("a newer local save wins over an older cloud copy after a reload (1.9)", async () => {
    const timers = new ManualTimers();
    timers.now = 1_000_000;
    const cloud: Record<string, unknown> = {};
    const player: YandexPlayer = {
      isAuthorized: () => false,
      getData: async () => ({ ...cloud }),
      setData: vi.fn(async (data: Record<string, unknown>) => {
        Object.keys(cloud).forEach((key) => delete cloud[key]);
        Object.assign(cloud, data);
      }),
    };
    const local = new MemoryStorageBackend();
    const first = new YandexStorage({ namespace: "t", local, timers, now: () => timers.now });
    await first.attach(player);
    await first.set("best", "5");
    await first.whenSaved();
    timers.advance(500);
    await first.set("best", "9"); // waiting for its slot when the page reloads

    const second = new YandexStorage({ namespace: "t", local, timers, now: () => timers.now });
    await second.attach(player);
    await expect(second.get("best")).resolves.toBe("9");
    await second.whenSaved();
    expect(cloud["best"]).toBe("9");
  });

  it("an older local copy yields to the cloud, and is refreshed from it", async () => {
    const local = new MemoryStorageBackend();
    await local.set("best", "3");
    await local.set("__wgf_rev__", "10");
    const player: YandexPlayer = {
      isAuthorized: () => true,
      getData: async () => ({ best: "40", __wgf_rev__: 99 }),
      setData: vi.fn(async () => undefined),
    };
    const storage = new YandexStorage({ namespace: "t", local });
    await storage.attach(player);
    await expect(storage.get("best")).resolves.toBe("40");
    await expect(local.get("best")).resolves.toBe("40");
    expect(player.setData).not.toHaveBeenCalled();
  });

  it("flush() sends a pending write at once (page hidden or closed)", async () => {
    const timers = new ManualTimers();
    const fake = fakeSdk();
    const storage = new YandexStorage({
      namespace: "t",
      local: new MemoryStorageBackend(),
      timers,
      now: () => timers.now,
    });
    await storage.attach(fake.player);
    await storage.set("best", "1");
    await storage.whenSaved();
    await storage.set("best", "2");
    expect(fake.player.setData).toHaveBeenCalledTimes(1);
    storage.flush();
    await storage.whenSaved();
    expect(fake.player.setData).toHaveBeenCalledTimes(2);
  });

  it("pauses cloud sync during account selection and re-reads the player after", async () => {
    const fake = fakeSdk();
    const platform = platformWith(fake);
    await platform.initialize();
    let changed = 0;
    platform.on("storage:changed", () => (changed += 1));

    fake.fire("ACCOUNT_SELECTION_DIALOG_OPENED");
    await platform.storage.set("best", "77");
    await platform.storage.whenSaved();
    expect(fake.player.setData).not.toHaveBeenCalled();

    fake.fire("ACCOUNT_SELECTION_DIALOG_CLOSED");
    await vi.waitFor(() => expect(changed).toBe(1));
  });

  it("dispose() unsubscribes from the SDK", async () => {
    const fake = fakeSdk();
    const platform = platformWith(fake);
    await platform.initialize();
    platform.dispose();
    fake.fire("game_api_pause");
    expect(platform.foreground).toBe(true);
  });

  it("re-asserts GameplayAPI.stop() after a portal resume that the game did not resume", async () => {
    const timers = new ManualTimers();
    const fake = fakeSdk();
    const platform = platformWith(fake, timers);
    await platform.initialize();
    platform.gameplayStart();
    fake.fire("game_api_pause");
    platform.gameplayStop(); // the game reacts to the pause
    fake.fire("game_api_resume"); // ...and stays on its pause screen
    timers.advance(500);
    expect(fake.calls).toEqual(["start", "stop", "stop", "stop"]);

    // A game that resumes play on the event is not contradicted.
    platform.gameplayStart();
    fake.fire("game_api_pause");
    fake.fire("game_api_resume");
    timers.advance(500);
    expect(fake.calls.at(-1)).toBe("start");
  });

  it("a rewarded video that opens after the timeout still pays out, as ad:late-reward", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const timers = new ManualTimers();
    const fake = fakeSdk();
    let late: YandexRewardedCallbacks | undefined;
    fake.setRewarded((callbacks) => (late = callbacks));
    const platform = platformWith(fake, timers);
    await platform.initialize();
    const rewards: string[] = [];
    platform.on("ad:late-reward", ({ kind }) => rewards.push(kind));

    const result = platform.showRewarded();
    timers.advance(20_000);
    await expect(result).resolves.toEqual({ shown: false, rewarded: false, reason: "not-ready" });

    late!.onOpen?.();
    // While the late ad is on screen, nothing else may open.
    await expect(platform.showInterstitial()).resolves.toEqual({
      shown: false,
      reason: "not-ready",
    });
    late!.onRewarded?.();
    late!.onClose?.(true);
    expect(rewards).toEqual(["rewarded"]);
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: true });
    warn.mockRestore();
  });

  it("reports only what the adapter implements", () => {
    const platform = createPlatform("yandex", { namespace: "t" });
    expect(platform.capabilities.ads).toEqual(["interstitial", "rewarded"]);
    expect(platform.capabilities.iap).toBe(false);
  });

  it("after account selection the chosen progress wins, even over a newer guest copy", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const local = new MemoryStorageBackend();
    const guestData: Record<string, unknown> = {};
    const account: Record<string, unknown> = { best: "5", __wgf_rev__: 1 };
    let chosen: Record<string, unknown> = guestData;
    const player: YandexPlayer = {
      isAuthorized: () => false,
      getData: async () => ({ ...chosen }),
      setData: vi.fn(async (data: Record<string, unknown>) => {
        Object.assign(chosen, data);
      }),
    };
    const fake = fakeSdk({ player });
    const platform = new YandexPlatform({
      namespace: "t",
      loadSdk: async () => fake.yaGames,
      storage: new YandexStorage({ namespace: "t", local }),
    });
    await platform.initialize();
    await platform.storage.set("best", "100"); // a long guest session on this device
    await platform.storage.set("guestOnly", "x");
    await platform.storage.whenSaved();

    fake.fire("ACCOUNT_SELECTION_DIALOG_OPENED");
    await platform.storage.set("best", "101"); // written while the dialog is open
    chosen = account;
    let changed = false;
    platform.on("storage:changed", () => (changed = true));
    fake.fire("ACCOUNT_SELECTION_DIALOG_CLOSED");
    await vi.waitFor(() => expect(changed).toBe(true));

    await expect(platform.storage.get("best")).resolves.toBe("5");
    await expect(platform.storage.get("guestOnly")).resolves.toBeNull();
    await platform.storage.whenSaved();
    expect(account["best"]).toBe("5");
    warn.mockRestore();
  });

  it("falls back to local saves if the player cannot be re-read after account selection", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fake = fakeSdk();
    const platform = platformWith(fake);
    await platform.initialize();
    let fail = false;
    const original = fake.sdk.getPlayer;
    (fake.sdk as { getPlayer: YandexSdk["getPlayer"] }).getPlayer = async () => {
      if (fail) throw new Error("network");
      return original();
    };
    fail = true;
    let changed = false;
    platform.on("storage:changed", () => (changed = true));
    fake.fire("ACCOUNT_SELECTION_DIALOG_OPENED");
    fake.fire("ACCOUNT_SELECTION_DIALOG_CLOSED");
    await vi.waitFor(() => expect(changed).toBe(true));
    expect(platform.storage.cloud).toBe(false);
    await platform.storage.set("best", "8");
    await platform.storage.whenSaved();
    expect(fake.player.setData).not.toHaveBeenCalled();
    await expect(platform.storage.get("best")).resolves.toBe("8");
    warn.mockRestore();
  });

  it("after a failed re-attach, the next boot defers to the account instead of pushing the guest copy", async () => {
    const local = new MemoryStorageBackend();
    const guest: YandexPlayer = {
      isAuthorized: () => false,
      getData: async () => ({}),
      setData: vi.fn(async () => undefined),
    };
    const first = new YandexStorage({ namespace: "t", local });
    await first.attach(guest);
    await first.set("best", "100");
    await first.whenSaved();
    first.detach(); // account selection closed, the chosen player could not be read
    await first.set("best", "101"); // played on locally

    const account: YandexPlayer = {
      isAuthorized: () => true,
      getData: async () => ({ best: "5", __wgf_rev__: 1 }),
      setData: vi.fn(async () => undefined),
    };
    const next = new YandexStorage({ namespace: "t", local });
    await next.attach(account);
    await expect(next.get("best")).resolves.toBe("5");
    expect(account.setData).not.toHaveBeenCalled();
  });
});
