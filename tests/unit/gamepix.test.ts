// GamePix adapter: capabilities, SDK boot, the loading()/loaded() order, ads, saves and
// language — every branch against the deterministic mock in tests/gamepix/mock-sdk.ts, which
// records each documented misuse error (GAMEPIX_LOADED_NOT_CALLED, ..._CALLED_TWICE, …) as a
// violation. Timers are advanced by hand. Nothing contacts GamePix.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Game, ManualScheduler } from "@wgf/game-core";
import {
  GAMEPIX_CAPABILITIES,
  GAMEPIX_SDK_URL,
  GamePixPlatform,
  MemoryStorageBackend,
  createPlatform,
  loadGamePixSdk,
  type GamePixOptions,
  type Platform,
} from "@wgf/platform-sdk";
import { validateGameConfig } from "../../src/core/game-config.js";
import { bindPlatform, withAdBreak } from "../../src/platform/bind.js";
import {
  createGamePixMock,
  type GamePixMockOptions,
  type GpAdScript,
  type GpSdkMode,
} from "../gamepix/mock-sdk.js";

class ManualTimers {
  now = 0;
  #next = 1;
  readonly #pending = new Map<number, { at: number; run: () => void }>();
  setTimeout = (run: () => void, ms: number): unknown => {
    const id = this.#next++;
    this.#pending.set(id, { at: this.now + ms, run });
    return id;
  };
  clearTimeout = (handle: unknown): void => void this.#pending.delete(handle as number);
  get pending(): number {
    return this.#pending.size;
  }
  advance(ms: number): void {
    const until = this.now + ms;
    for (;;) {
      const due = [...this.#pending]
        .filter(([, t]) => t.at <= until)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.#pending.delete(due[0]);
      this.now = due[1].at;
      due[1].run();
    }
    this.now = until;
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

interface Setup {
  platform: GamePixPlatform;
  mock: ReturnType<typeof createGamePixMock>;
  timers: ManualTimers;
  events: string[];
  local: MemoryStorageBackend;
}

function setup(
  options: { sdk?: GpSdkMode; ad?: GpAdScript } & Partial<Omit<GamePixMockOptions, "timers">> &
    Partial<GamePixOptions> = {},
): Setup {
  const timers = new ManualTimers();
  const mock = createGamePixMock({ ...options, timers });
  const local = new MemoryStorageBackend();
  const platform = new GamePixPlatform({
    namespace: "gp-test",
    loadSdk: options.loadSdk ?? mock.loadSdk,
    timers,
    storage: local,
  });
  const events: string[] = [];
  for (const event of [
    "ad:start",
    "ad:end",
    "foreground:lost",
    "foreground:gained",
    "ad:late-reward",
  ] as const) {
    platform.on(event, () => events.push(event));
  }
  return { platform, mock, timers, events, local };
}

async function booted(options: Parameters<typeof setup>[0] = {}): Promise<Setup> {
  const s = setup(options);
  await s.platform.initialize();
  await s.platform.signalReady();
  return s;
}

function running(platform: Platform) {
  const game = new Game({ scheduler: new ManualScheduler() });
  game.start();
  const binding = bindPlatform(game, platform);
  platform.gameplayStart();
  return { game, binding };
}

const AD = ["foreground:lost", "ad:start", "ad:end", "foreground:gained"];
const NO_AD = ["foreground:lost", "foreground:gained"];

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

describe("GamePix configuration", () => {
  it("declares what GamePix documents", () => {
    expect(GAMEPIX_CAPABILITIES).toEqual({
      ads: ["interstitial", "rewarded"],
      iap: false,
      cloudSaves: false,
      leaderboards: false,
      achievements: false,
      auth: "none",
      analytics: "platform-provided",
      loadingApi: "required",
      interstitialMinIntervalS: null,
      gameplayStopOnHidden: true,
    });
    expect(GAMEPIX_SDK_URL).toBe("https://integration.gamepix.com/sdk/v3/gamepix.sdk.js");
  });

  it("createPlatform builds it with no portal id", () => {
    const platform = createPlatform("gamepix", { namespace: "t" });
    expect(platform).toBeInstanceOf(GamePixPlatform);
    expect(platform.id).toBe("gamepix");
  });

  it("game.config.yaml accepts a gamepix entry, and no game_id on it", () => {
    const raw = {
      game: { id: "t", name: "T", version: "0.1.0" },
      engine: { type: "pixijs" },
      platforms: [{ id: "gamepix", profile: "gamepix@1.0.0", role: "required" }],
      monetization: { ad_kinds: ["interstitial", "rewarded"], iap: false },
      build: { command: "pnpm build", output: "dist" },
      verification: {},
      publishing: { enabled: false },
    };
    expect(validateGameConfig(raw).platforms[0]?.id).toBe("gamepix");
    const withId = structuredClone(raw);
    (withId.platforms[0] as Record<string, unknown>)["game_id"] = "abc12345";
    expect(() => validateGameConfig(withId)).toThrow(/game_id/);
  });
});

describe("GamePix SDK boot", () => {
  it("connects, reads the language, and sends nothing but loading() before loaded()", async () => {
    const { platform, mock } = setup({ lang: "de" });
    await platform.initialize();
    expect(platform.sdkState).toBe("ready");
    expect(platform.sdkAvailable).toBe(true);
    expect(platform.language).toBe("de");
    platform.reportLoadingProgress(0.25);
    platform.reportLoadingProgress(0.5);
    await platform.signalReady();
    await platform.signalReady();
    expect(mock.calls).toEqual([
      "load",
      "lang",
      "loading:25",
      "loading:50",
      "loading:100",
      "loaded",
    ]);
    expect(mock.violations).toEqual([]);
  });

  it("sends integer percentages, never backwards, never repeated, never after loaded()", async () => {
    const { platform, mock } = setup();
    await platform.initialize();
    for (const fraction of [-1, 0.333, 0.333, 0.2, Number.NaN, 2]) {
      platform.reportLoadingProgress(fraction);
    }
    await platform.signalReady();
    platform.reportLoadingProgress(0.5);
    expect(mock.calls.filter((c) => c.startsWith("loading"))).toEqual([
      "loading:0",
      "loading:33",
      "loading:100",
    ]);
    expect(platform.usage.loadingProgressCalls).toBe(7);
    expect(mock.violations).toEqual([]);
  });

  it("an undocumented language is not passed on", async () => {
    const { platform } = setup({ lang: "xx" });
    await platform.initialize();
    expect(platform.language).toBeNull();
  });

  it("a blocked script boots a plain web game: no language, ads not-ready, local saves", async () => {
    const { platform, local } = await booted({ sdk: "missing" });
    expect(platform.sdkState).toBe("unavailable");
    expect(platform.sdkAvailable).toBe(false);
    expect(platform.language).toBeNull();
    expect(platform.adAvailability("interstitial")).toBe("disabled");
    await expect(platform.showInterstitial()).resolves.toEqual({
      shown: false,
      reason: "not-ready",
    });
    await expect(platform.showRewarded()).resolves.toEqual({
      shown: false,
      rewarded: false,
      reason: "not-ready",
    });
    await platform.storage.set("best", "7");
    await expect(local.get("best")).resolves.toBe("7");
    await expect(platform.storage.get("best")).resolves.toBe("7");
  });

  it("a loader that throws is a missing SDK", async () => {
    const { platform } = await booted({ sdk: "loader-throws" });
    expect(platform.sdkState).toBe("unavailable");
  });

  it("a loader that never answers: the deadline boots the game, a late SDK still connects", async () => {
    const mock = createGamePixMock({ timers: new ManualTimers() });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { platform, timers } = setup({
      loadSdk: async () => {
        await gate;
        return mock.loadSdk();
      },
    });
    const init = platform.initialize();
    platform.reportLoadingProgress(0.4);
    timers.advance(5_000);
    await init;
    expect(platform.sdkState).toBe("unavailable");
    await platform.signalReady();
    release();
    await flush();
    expect(platform.sdkState).toBe("ready");
    // Told where the game already is: done loading.
    expect(mock.calls).toEqual(["load", "lang", "loading:100", "loaded"]);
    expect(mock.violations).toEqual([]);
  });

  it("loaded() throwing (the SDK refused to start): ads refused as error, saves stay local", async () => {
    const { platform, mock } = await booted({ sdk: "loaded-throws" });
    expect(platform.sdkState).toBe("error");
    expect(platform.adAvailability("rewarded")).toBe("disabled");
    await expect(platform.showRewarded()).resolves.toEqual({
      shown: false,
      rewarded: false,
      reason: "error",
    });
    await platform.storage.set("k", "v");
    expect(mock.store.size).toBe(0);
    await expect(platform.storage.get("k")).resolves.toBe("v");
  });

  it("initialize() is idempotent", async () => {
    const { platform, mock } = setup();
    await Promise.all([platform.initialize(), platform.initialize()]);
    expect(mock.calls.filter((c) => c === "load")).toHaveLength(1);
  });

  describe("the default script loader", () => {
    interface FakeScript {
      src?: string;
      async?: boolean;
      defer?: boolean;
      type?: string;
      onload?: () => void;
      onerror?: () => void;
    }
    function fakeDom(existing: { tag?: Partial<FakeScript>; sdk?: boolean } = {}) {
      const inserted: FakeScript[] = [];
      const win: Record<string, unknown> = {};
      const sdk = createGamePixMock({ timers: new ManualTimers() }).sdk;
      if (existing.sdk) win["GamePix"] = sdk;
      Object.assign(globalThis, {
        window: win,
        document: {
          querySelector: (selector: string) =>
            existing.tag && selector === `script[src="${GAMEPIX_SDK_URL}"]` ? existing.tag : null,
          createElement: () => ({}) as FakeScript,
          getElementsByTagName: () => [],
          head: { appendChild: (script: FakeScript) => inserted.push(script) },
        },
      });
      return { inserted, win, sdk };
    }

    it("uses window.GamePix the <head> tag already defined", async () => {
      const { inserted, sdk } = fakeDom({ tag: {}, sdk: true });
      await expect(loadGamePixSdk()).resolves.toBe(sdk);
      expect(inserted).toEqual([]);
    });

    it("a synchronous <head> tag with no global was blocked: no second request", async () => {
      const { inserted } = fakeDom({ tag: {} });
      await expect(loadGamePixSdk()).resolves.toBeNull();
      expect(inserted).toEqual([]);
    });

    it("without a tag inserts the documented script once and resolves its global", async () => {
      const { inserted, win, sdk } = fakeDom();
      const loading = loadGamePixSdk();
      expect(inserted).toHaveLength(1);
      expect(inserted[0]!.src).toBe(GAMEPIX_SDK_URL);
      win["GamePix"] = sdk;
      inserted[0]!.onload!();
      await expect(loading).resolves.toBe(sdk);
    });

    it("a blocked inserted script resolves no SDK", async () => {
      const { inserted } = fakeDom();
      const loading = loadGamePixSdk();
      inserted[0]!.onerror!();
      await expect(loading).resolves.toBeNull();
    });

    it("a global without the documented methods is not the SDK", async () => {
      const { inserted, win } = fakeDom();
      const loading = loadGamePixSdk();
      win["GamePix"] = { loaded: () => undefined };
      inserted[0]!.onload!();
      await expect(loading).resolves.toBeNull();
    });

    it("without a browser resolves no SDK", async () => {
      delete (globalThis as { document?: unknown }).document;
      await expect(loadGamePixSdk()).resolves.toBeNull();
    });
  });
});

describe("GamePix interstitial", () => {
  it("plays: the game is held from the call, the ad announced once, counted once", async () => {
    const { platform, mock, events } = await booted();
    let hook = 0;
    await expect(platform.showInterstitial({ onStart: () => (hook += 1) })).resolves.toEqual({
      shown: true,
    });
    expect(hook).toBe(1);
    expect(events).toEqual(AD);
    expect(platform.foreground).toBe(true);
    expect(platform.usage.adsShown.interstitial).toBe(1);
    expect(mock.calls.filter((c) => c === "interstitialAd")).toHaveLength(1);
    expect(mock.violations).toEqual([]);
  });

  it("not filled (success: false): unshown, held and released, no ad announced", async () => {
    const { platform, events } = await booted({ ad: "no-fill" });
    let hook = 0;
    await expect(platform.showInterstitial({ onStart: () => (hook += 1) })).resolves.toEqual({
      shown: false,
      reason: "not-ready",
    });
    expect(hook).toBe(0);
    expect(events).toEqual(NO_AD);
  });

  it.each(["reject", "throw"] as const)("the SDK failing (%s) resolves as error", async (ad) => {
    const { platform, events, mock } = await booted({ ad });
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: false, reason: "error" });
    expect(events).toEqual(NO_AD);
    mock.setAd("play");
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: true });
  });

  it("is asked at every break: GamePix decides the frequency, no local interval", async () => {
    const { platform, mock } = await booted();
    for (let i = 0; i < 3; i += 1) await platform.showInterstitial();
    expect(mock.calls.filter((c) => c === "interstitialAd")).toHaveLength(3);
  });

  it("before signalReady: not-ready, and the SDK is never asked (GAMEPIX_LOADED_NOT_CALLED)", async () => {
    const { platform, mock, events } = setup();
    await platform.initialize();
    await expect(platform.showInterstitial()).resolves.toEqual({
      shown: false,
      reason: "not-ready",
    });
    await expect(platform.showRewarded()).resolves.toMatchObject({ rewarded: false });
    expect(mock.calls).not.toContain("interstitialAd");
    expect(events).toEqual([]);
    expect(mock.violations).toEqual([]);
  });

  it("a second request while one is pending is busy, never INTERSTITIAL_AD_CALLED_TWICE", async () => {
    const { platform, mock } = await booted({ ad: "stall" });
    void platform.showInterstitial();
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: false, reason: "busy" });
    await expect(platform.showRewarded()).resolves.toMatchObject({ reason: "busy" });
    expect(mock.violations).toEqual([]);
  });

  it("a promise that never settles: the deadline gives the game back once", async () => {
    const { platform, timers, events, mock } = await booted({ ad: "stall" });
    const pending = platform.showInterstitial();
    expect(platform.foreground).toBe(false);
    timers.advance(60_000);
    await expect(pending).resolves.toEqual({ shown: false, reason: "not-ready" });
    expect(events).toEqual(NO_AD);
    // The SDK's own call is still open: another interstitial would be ..._CALLED_TWICE.
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: false, reason: "busy" });
    // A rewarded ad is a different call and may go.
    mock.setAd("play");
    await expect(platform.showRewarded()).resolves.toEqual({ shown: true, rewarded: true });
    expect(mock.violations).toEqual([]);
  });

  it("a throwing onStart hook does not strand the ad", async () => {
    const { platform, events } = await booted();
    await expect(
      platform.showInterstitial({
        onStart: () => {
          throw new Error("hook");
        },
      }),
    ).resolves.toEqual({ shown: true });
    expect(events).toEqual(AD);
  });
});

describe("GamePix rewarded", () => {
  it("rewards only on success: true", async () => {
    const { platform, events, mock } = await booted();
    await expect(platform.showRewarded()).resolves.toEqual({ shown: true, rewarded: true });
    expect(events).toEqual(AD);
    expect(mock.calls).toContain("rewardAd");
    expect(platform.usage.adsShown.rewarded).toBe(1);
  });

  it.each(["closed-early", "no-fill"] as const)("%s: no reward", async (ad) => {
    const { platform, events } = await booted({ ad });
    await expect(platform.showRewarded()).resolves.toEqual({
      shown: false,
      rewarded: false,
      reason: "not-ready",
    });
    expect(events).toEqual(NO_AD);
  });

  it("an error: no reward", async () => {
    const { platform } = await booted({ ad: "reject" });
    await expect(platform.showRewarded()).resolves.toEqual({
      shown: false,
      rewarded: false,
      reason: "error",
    });
  });

  it("a reward confirmed after the deadline is owed as ad:late-reward, once", async () => {
    const { platform, timers, events } = await booted({ ad: "late", lateMs: 70_000 });
    const pending = platform.showRewarded();
    timers.advance(60_000);
    await expect(pending).resolves.toMatchObject({ rewarded: false });
    timers.advance(10_000);
    await flush();
    expect(events).toEqual([...NO_AD, "ad:late-reward"]);
  });

  it("a second rewarded request while one is pending is busy, never REWARD_AD_CALLED_TWICE", async () => {
    const { platform, mock } = await booted({ ad: "stall" });
    void platform.showRewarded();
    await expect(platform.showRewarded()).resolves.toMatchObject({
      rewarded: false,
      reason: "busy",
    });
    expect(mock.violations).toEqual([]);
  });
});

describe("GamePix saves", () => {
  it("go to GamePix.localStorage after loaded(), namespaced, and to the local copy", async () => {
    const { platform, mock, local } = await booted();
    await platform.storage.set("best", "42");
    expect(mock.store.get("gp-test:best")).toBe("42");
    await expect(local.get("best")).resolves.toBe("42");
    await expect(platform.storage.get("best")).resolves.toBe("42");
    await platform.storage.remove("best");
    expect(mock.store.has("gp-test:best")).toBe(false);
    await expect(platform.storage.get("best")).resolves.toBeNull();
    expect(mock.violations).toEqual([]);
  });

  it("written while loading: kept locally, replayed into GamePix at loaded()", async () => {
    const { platform, mock } = setup();
    await platform.initialize();
    await platform.storage.set("a", "1");
    await platform.storage.set("b", "2");
    await platform.storage.remove("b");
    await expect(platform.storage.get("a")).resolves.toBe("1");
    expect(mock.store.size).toBe(0);
    expect(platform.storage.attached).toBe(false);
    await platform.signalReady();
    expect(platform.storage.attached).toBe(true);
    expect([...mock.store]).toEqual([["gp-test:a", "1"]]);
    expect(mock.violations).toEqual([]);
  });

  it("prefers GamePix's value, and falls back to the local copy when it has none", async () => {
    const { platform, mock, local } = await booted();
    mock.store.set("gp-test:from-gamepix", "g");
    await local.set("only-local", "l");
    await expect(platform.storage.get("from-gamepix")).resolves.toBe("g");
    await expect(platform.storage.get("only-local")).resolves.toBe("l");
  });

  it("GamePix storage throwing falls back to the local copy", async () => {
    const { platform, mock } = await booted();
    const store = mock.sdk.localStorage!;
    store.setItem = () => {
      throw new Error("quota");
    };
    store.getItem = () => {
      throw new Error("blocked");
    };
    await platform.storage.set("k", "v");
    await expect(platform.storage.get("k")).resolves.toBe("v");
  });
});

describe("GamePix and the game", () => {
  it("an ad break pauses and mutes the game before the SDK is asked, and restores it", async () => {
    const { platform } = await booted();
    const { game, binding } = running(platform);
    let during: { paused: boolean; muted: boolean } | null = null;
    const result = await withAdBreak(game, platform, () =>
      platform.showRewarded({
        onStart: () => (during = { paused: game.paused, muted: binding.audioMuted }),
      }),
    );
    expect(result).toEqual({ shown: true, rewarded: true });
    expect(during).toEqual({ paused: true, muted: true });
    expect(game.paused).toBe(false);
    expect(binding.audioMuted).toBe(false);
    expect(platform.gameplayActive).toBe(true);
    binding.dispose();
  });

  it("held for the whole request even without withAdBreak (GamePix: pause before calling)", async () => {
    const { platform } = await booted({ ad: "stall" });
    const { game, binding } = running(platform);
    void platform.showInterstitial();
    expect(game.paused).toBe(true);
    expect(binding.audioMuted).toBe(true);
    binding.dispose();
  });

  it("a hidden tab pauses the game and stops reported gameplay", async () => {
    const { platform } = await booted();
    const { game, binding } = running(platform);
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(game.paused).toBe(true);
    expect(binding.audioMuted).toBe(true);
    expect(platform.gameplayActive).toBe(false);
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(game.paused).toBe(false);
    expect(platform.gameplayActive).toBe(true);
    binding.dispose();
  });

  it("gameplay transitions are tracked once each and never sent to the SDK", async () => {
    const { platform, mock } = await booted();
    platform.gameplayStart();
    platform.gameplayStart();
    platform.gameplayStop();
    platform.gameplayStop();
    expect(platform.usage.gameplayStartCalls).toBe(1);
    expect(platform.usage.gameplayStopCalls).toBe(1);
    expect(mock.calls.some((c) => /gameplay|lifecycle/i.test(c))).toBe(false);
  });

  it("has no user", async () => {
    const { platform } = await booted();
    await expect(platform.getUser()).resolves.toBeNull();
  });
});
