// Platform harnesses for the SDK conformance suite.
//
// One harness per platform id in KNOWN_PLATFORM_IDS. Each builds its adapter against a fake
// portal SDK shaped like the portal's documented API, and exposes the same handful of levers
// — make the SDK unavailable, make init fail, script the next ad, raise a portal pause — so
// conformance.test.ts can run one scenario matrix over every platform. The adapters' own unit
// tests (tests/unit/<platform>.test.ts) pin each portal's call sequence in detail; this suite
// asks the questions a Factory title needs answered the same way for all of them.
//
// A harness never loads a real portal script and never makes a network request.
//
// Adding a platform: implement its adapter in packages/platform-sdk, then add a harness here.
// Until then its entry is `adapter: "missing"` or `"none"` and every scenario is reported as
// skipped with the reason — never as passing.

import {
  CrazyGamesPlatform,
  GameVuiPlatform,
  GenericWebPlatform,
  MemoryStorageBackend,
  PokiPlatform,
  Y8Platform,
  YandexPlatform,
  YandexStorage,
  type CrazyGamesSdk,
  type Platform,
  type PokiSdk,
  type Timers,
  type YaGamesGlobal,
  type YandexAdCallbacks,
  type YandexRewardedCallbacks,
  type YandexSdk,
} from "@wgf/platform-sdk";
import { createY8Mock, type Y8AdScript } from "../y8/mock-y8-sdk.js";

/** How the portal answers the next ad request. */
export type AdScript =
  | "play" // shown to the end; a rewarded ad grants its reward
  | "no-fill" // the portal has nothing to show
  | "closed-early" // shown, then closed by the player before the reward
  | "error" // the portal SDK reports an error
  | "stall-open"; // the ad starts (onOpen/adStarted/onStart) but never closes, so the
// adapter's one-ad-at-a-time slot stays taken — used to drive a concurrent second
// request into the "busy" refusal. The first request never resolves.

export type SdkScript = "ok" | "unavailable" | "init-fails";

export interface HarnessInstance {
  readonly platform: Platform;
  /** Calls the fake portal received, in order. */
  readonly calls: string[];
  /** Script the next interstitial and rewarded request. */
  setAd(script: AdScript): void;
  /** Raise the portal's own pause/resume, where the portal has one. */
  readonly portalPause?: () => void;
  readonly portalResume?: () => void;
  /** Move the harness clock, for interval rules. */
  advance(ms: number): void;
}

export interface Harness {
  readonly id: string;
  /**
   * implemented — an adapter exists and is exercised here.
   * missing     — the portal documents an SDK but no adapter is on this ref yet.
   * none        — the portal documents no SDK; builds for it run on generic-web.
   */
  readonly adapter: "implemented" | "missing" | "none";
  /** Why a platform is not `implemented`, reported with every skipped scenario. */
  readonly limitation?: string;
  /** The ad kinds the portal offers (its profile's capabilities.ads). */
  readonly ads: readonly ("interstitial" | "rewarded")[];
  /** The portal raises its own pause events (not just around ads). */
  readonly portalPauses: boolean;
  /** Storage persists through the portal rather than only in the browser. */
  readonly cloudStorage: boolean;
  /** Whether a portal SDK is loaded at all, so unavailable/init-failure apply. */
  readonly hasSdk: boolean;
  /**
   * Whether the portal SDK has gameplay start/stop calls to forward to. Defaults to hasSdk;
   * false for Y8, whose SDK has none, so reports stay local.
   */
  readonly gameplayApi?: boolean;
  create(sdk?: SdkScript): Promise<HarnessInstance>;
}

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

// -- Yandex Games -------------------------------------------------------------------------
// Fake of the documented surface: YaGames.init(), LoadingAPI.ready(), GameplayAPI,
// adv.showFullscreenAdv / showRewardedVideo with onOpen/onRewarded/onClose/onError, getPlayer
// with getData/setData, on/off for game_api_pause and game_api_resume.
// https://yandex.com/dev/games/doc/en/sdk/sdk-about

const yandex: Harness = {
  id: "yandex",
  adapter: "implemented",
  ads: ["interstitial", "rewarded"],
  portalPauses: true,
  cloudStorage: true,
  hasSdk: true,
  async create(script: SdkScript = "ok") {
    const calls: string[] = [];
    const listeners = new Map<string, Set<() => void>>();
    const data: Record<string, unknown> = {};
    let ad: AdScript = "play";

    // The portal raises game_api_pause while its ad is on screen and game_api_resume after
    // (https://yandex.com/dev/games/doc/en/sdk/sdk-events), so the fake does too.
    const emit = (event: string): void => listeners.get(event)?.forEach((l) => l());
    const playAd = (callbacks: YandexRewardedCallbacks, rewarded: boolean): void => {
      switch (ad) {
        case "play":
          emit("game_api_pause");
          callbacks.onOpen?.();
          if (rewarded) callbacks.onRewarded?.();
          callbacks.onClose?.(true);
          emit("game_api_resume");
          return;
        case "no-fill":
          callbacks.onClose?.(false);
          return;
        case "closed-early":
          emit("game_api_pause");
          callbacks.onOpen?.();
          callbacks.onClose?.(true);
          emit("game_api_resume");
          return;
        case "error":
          callbacks.onError?.(new Error("scripted"));
          return;
        case "stall-open":
          // Opens and stays open: game_api_pause + onOpen mark the ad on screen, but no
          // onClose/onError ever arrives, so the adapter's #adShowing slot stays taken.
          emit("game_api_pause");
          callbacks.onOpen?.();
          return;
      }
    };

    const sdk: YandexSdk = {
      environment: { app: { id: "conformance" }, i18n: { lang: "ru" } },
      features: {
        LoadingAPI: { ready: () => void calls.push("LoadingAPI.ready") },
        GameplayAPI: {
          start: () => void calls.push("GameplayAPI.start"),
          stop: () => void calls.push("GameplayAPI.stop"),
        },
      },
      adv: {
        showFullscreenAdv: ({ callbacks }: { callbacks: YandexAdCallbacks }) => {
          calls.push("adv.showFullscreenAdv");
          playAd(callbacks, false);
        },
        showRewardedVideo: ({ callbacks }: { callbacks: YandexRewardedCallbacks }) => {
          calls.push("adv.showRewardedVideo");
          playAd(callbacks, true);
        },
      },
      getPlayer: async () => ({
        isAuthorized: () => false,
        getData: async () => ({ ...data }),
        setData: async (next: Record<string, unknown>) => {
          calls.push("player.setData");
          Object.assign(data, next);
        },
      }),
      on: (event, listener) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(listener);
      },
      off: (event, listener) => listeners.get(event)?.delete(listener),
    };
    const yaGames: YaGamesGlobal = {
      init: () => {
        calls.push("YaGames.init");
        return script === "init-fails"
          ? Promise.reject(new Error("scripted"))
          : Promise.resolve(sdk);
      },
    };

    const timers = new ManualTimers();
    const platform = new YandexPlatform({
      namespace: "conformance",
      loadSdk: () =>
        script === "unavailable"
          ? Promise.reject(new Error("/sdk.js blocked"))
          : Promise.resolve(yaGames),
      timers,
      now: () => timers.now,
      storage: new YandexStorage({
        namespace: "conformance",
        local: new MemoryStorageBackend(),
        timers,
        now: () => timers.now,
      }),
    });
    return {
      platform,
      calls,
      setAd: (next) => (ad = next),
      portalPause: () => emit("game_api_pause"),
      portalResume: () => emit("game_api_resume"),
      advance: (ms) => timers.advance(ms),
    };
  },
};

// -- Poki ---------------------------------------------------------------------------------
// Fake of the documented surface: PokiSDK.init(), gameLoadingFinished(), gameplayStart/Stop,
// commercialBreak(onStart) and rewardedBreak(onStart) resolving to whether to reward.
// https://developers.poki.com/guide/sdk-html5

const poki: Harness = {
  id: "poki",
  adapter: "implemented",
  ads: ["interstitial", "rewarded"],
  portalPauses: false,
  cloudStorage: false,
  hasSdk: true,
  async create(script: SdkScript = "ok") {
    const calls: string[] = [];
    let ad: AdScript = "play";
    // After a rejected init — an ad blocker, typically — Poki's SDK still answers ad calls,
    // but without an ad and without a reward. The fake behaves the same way.
    const blocked = script === "init-fails";
    const sdk: PokiSdk = {
      init: () => {
        calls.push("PokiSDK.init");
        return script === "init-fails" ? Promise.reject(new Error("scripted")) : Promise.resolve();
      },
      gameLoadingFinished: () => void calls.push("PokiSDK.gameLoadingFinished"),
      gameplayStart: () => void calls.push("PokiSDK.gameplayStart"),
      gameplayStop: () => void calls.push("PokiSDK.gameplayStop"),
      commercialBreak: (onStart) => {
        calls.push("PokiSDK.commercialBreak");
        if (blocked) return Promise.resolve();
        if (ad === "error") return Promise.reject(new Error("scripted"));
        if (ad === "play" || ad === "closed-early" || ad === "stall-open") onStart?.();
        // stall-open: started but never settles, so the break stays in progress.
        if (ad === "stall-open") return new Promise<void>(() => {});
        return Promise.resolve();
      },
      rewardedBreak: (onStart) => {
        calls.push("PokiSDK.rewardedBreak");
        if (blocked) return Promise.resolve(false);
        if (ad === "error") return Promise.reject(new Error("scripted"));
        if (ad === "play" || ad === "closed-early" || ad === "stall-open") onStart?.();
        if (ad === "stall-open") return new Promise<boolean>(() => {});
        return Promise.resolve(ad === "play");
      },
    };
    let now = 0;
    const pending: Array<{ at: number; run: () => void }> = [];
    const platform = new PokiPlatform({
      namespace: "conformance",
      storage: new MemoryStorageBackend(),
      loadSdk: () => Promise.resolve(script === "unavailable" ? null : sdk),
      setTimeout: (run, ms) => void pending.push({ at: now + ms, run }),
      onRejected: () => {},
    });
    return {
      platform,
      calls,
      setAd: (next) => (ad = next),
      advance: (ms) => {
        now += ms;
        for (const entry of pending.splice(0)) {
          if (entry.at <= now) entry.run();
          else pending.push(entry);
        }
      },
    };
  },
};

// -- generic-web --------------------------------------------------------------------------
// No portal. The baseline every other adapter degrades to.

function genericWeb(id: string, extra: Partial<Harness> = {}): Harness {
  return {
    id,
    adapter: "implemented",
    ads: [],
    portalPauses: false,
    cloudStorage: false,
    hasSdk: false,
    async create() {
      return {
        platform: new GenericWebPlatform({ namespace: `conformance-${id}` }),
        calls: [],
        setAd: () => {},
        advance: () => {},
      };
    },
    ...extra,
  };
}

// -- GameVui ------------------------------------------------------------------------------
// GameVui publishes no SDK, JavaScript API or publishing API (docs/platforms/gamevui/), so its
// adapter is a no-SDK one: local saves, no ad the game can request. Portal-injected ads are
// outside the game's control. See docs/sdk.md.

const gamevui: Harness = {
  ...genericWeb("gamevui"),
  async create() {
    return {
      platform: new GameVuiPlatform({ namespace: "conformance-gamevui" }),
      calls: [],
      setAd: () => {},
      advance: () => {},
    };
  },
};

// -- CrazyGames ---------------------------------------------------------------------------
// Fake of the documented HTML5 SDK v3 surface: SDK.init(), environment, game.gameplayStart/
// Stop and loadingStart/Stop, ad.requestAd(type, {adStarted, adFinished, adError}),
// ad.hasAdblock(), a localStorage-shaped data module, user.systemInfo.
// https://docs.crazygames.com/sdk/intro/ · /sdk/game/ · /sdk/video-ads/ · /sdk/data/
// CrazyGames documents no "closed early" answer for a rewarded ad; the fake scripts it as an
// ad that started and then errored, which the docs say must not reward.

const crazygames: Harness = {
  id: "crazygames",
  adapter: "implemented",
  ads: ["interstitial", "rewarded"],
  // No portal-level pause is raised at the game; the adapter takes the foreground itself
  // around an ad, as Poki's does.
  portalPauses: false,
  cloudStorage: true,
  hasSdk: true,
  async create(script: SdkScript = "ok") {
    const calls: string[] = [];
    const data = new Map<string, string>();
    let ad: AdScript = "play";
    let now = 0;
    const sdk: CrazyGamesSdk = {
      environment: "crazygames",
      init: () => {
        calls.push("SDK.init");
        return script === "init-fails" ? Promise.reject(new Error("scripted")) : Promise.resolve();
      },
      ad: {
        requestAd: (type, callbacks) => {
          calls.push(`SDK.ad.requestAd:${type}`);
          switch (ad) {
            case "play":
              callbacks?.adStarted?.();
              callbacks?.adFinished?.();
              return;
            case "closed-early":
              callbacks?.adStarted?.();
              callbacks?.adError?.({ code: "other", message: "closed" });
              return;
            case "no-fill":
              callbacks?.adError?.({ code: "unfilled", message: "No ad available" });
              return;
            case "error":
              callbacks?.adError?.({ code: "other", message: "scripted" });
              return;
            case "stall-open":
              // Starts but neither finishes nor errors, so #adInProgress stays true.
              callbacks?.adStarted?.();
              return;
          }
        },
        hasAdblock: () => Promise.resolve(false),
      },
      game: {
        gameplayStart: () => void calls.push("SDK.game.gameplayStart"),
        gameplayStop: () => void calls.push("SDK.game.gameplayStop"),
        loadingStart: () => void calls.push("SDK.game.loadingStart"),
        loadingStop: () => void calls.push("SDK.game.loadingStop"),
        settings: { disableChat: false, muteAudio: false },
        addSettingsChangeListener: () => {},
        removeSettingsChangeListener: () => {},
      },
      data: {
        getItem: (key) => data.get(key) ?? null,
        setItem: (key, value) => {
          calls.push("SDK.data.setItem");
          data.set(key, value);
        },
        removeItem: (key) => void data.delete(key),
        clear: () => data.clear(),
      },
      user: {
        isUserAccountAvailable: true,
        systemInfo: { locale: "en-US", device: { type: "desktop" }, applicationType: "web" },
        getUser: () => Promise.resolve(null),
      },
    };
    const platform = new CrazyGamesPlatform({
      namespace: "conformance",
      loadSdk: () =>
        script === "unavailable" ? Promise.reject(new Error("blocked")) : Promise.resolve(sdk),
      now: () => now,
    });
    return {
      platform,
      calls,
      setAd: (next) => (ad = next),
      advance: (ms) => {
        now += ms;
      },
    };
  },
};

// -- Y8 -----------------------------------------------------------------------------------
// The deterministic mock in tests/y8/mock-y8-sdk.js: y8.sdk(), the y8sdk.ready event, init,
// onAuth, showAd with beforeAd/afterAd/beforeReward/adViewed/adDismissed/adBreakDone and the
// documented breakStatus values, Cloud Storage. A signed-in player, so saves reach the cloud.
// https://docs.y8.com/sdk/intro/ · /sdk/advertising/ · /sdk/cloud-storage/

const Y8_SCRIPTS: Record<AdScript, Y8AdScript> = {
  play: "viewed",
  "no-fill": "noAdPreloaded",
  "closed-early": "dismissed",
  error: "error",
  "stall-open": "stall",
};

const y8: Harness = {
  id: "y8",
  adapter: "implemented",
  ads: ["interstitial", "rewarded"],
  // No portal-level pause is raised at the game; the adapter takes the foreground itself
  // around an ad that actually starts (beforeAd), as the Poki and CrazyGames adapters do.
  portalPauses: false,
  cloudStorage: true,
  hasSdk: true,
  gameplayApi: false,
  async create(script: SdkScript = "ok") {
    const mock = createY8Mock(new EventTarget(), {
      defer: () => {},
      init: script === "init-fails" ? "rejects" : "ok",
      user: { pid: "conformance", nickname: "Conformance" },
    });
    const timers = new ManualTimers();
    const platform = new Y8Platform({
      namespace: "conformance",
      config: { appId: "conformance-app", gameId: "conformance-game" },
      guestStorage: new MemoryStorageBackend(),
      loadSdk: () =>
        script === "unavailable"
          ? Promise.reject(new Error("cdn.y8.com blocked"))
          : Promise.resolve(mock.sdk),
      timers,
    });
    return {
      platform,
      calls: mock.calls,
      setAd: (next) => mock.setAd(Y8_SCRIPTS[next]),
      advance: (ms) => timers.advance(ms),
    };
  },
};

export const HARNESSES: readonly Harness[] = [
  genericWeb("generic-web"),
  yandex,
  poki,
  crazygames,
  gamevui,
  y8,
];
