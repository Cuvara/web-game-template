// Mock portals: one harness per platform adapter, scripted the same way.
//
// Each harness builds the real adapter from @wgf/platform-sdk with a fake of that portal's
// SDK injected through the adapter's own `loadSdk` seam, so no portal script is fetched and
// nothing is ever published. The fakes implement only the documented surface
// (docs/sdk.md lists the pages), and every one records its calls under the same neutral
// names, so one scenario can be asserted against all four portals:
//
//   init  ready  gameplayStart  gameplayStop  ad:interstitial  ad:rewarded
//
// Plain TypeScript with no test-runner imports: the Node scenario suite
// (tests/unit/sdk-contract.test.ts) and the browser matrix (tests/sdk-matrix/) share it.

import {
  CrazyGamesPlatform,
  GameVuiPlatform,
  MemoryStorageBackend,
  PokiPlatform,
  Y8Platform,
  YandexPlatform,
  YandexStorage,
  type CrazyGamesAdCallbacks,
  type CrazyGamesSdk,
  type Platform,
  type PokiSdk,
  type Timers,
  type YaGamesGlobal,
  type YandexRewardedCallbacks,
  type YandexSdk,
  type Y8Sdk,
} from "@wgf/platform-sdk";
import { createY8Mock } from "../y8/mock-y8-sdk.js";

/** The portals the SDK module targets. */
export const PORTALS = ["yandex", "crazygames", "poki", "gamevui", "y8"] as const;
export type Portal = (typeof PORTALS)[number];

/**
 * How the portal's SDK behaves at boot.
 *   ok          loads and initializes
 *   missing     the script never loads (ad blocker, offline, not on the portal)
 *   init-fails  the script loads, init() rejects
 */
export type SdkMode = "ok" | "missing" | "init-fails";

/**
 * How the next ad request goes.
 *   complete      plays to the end; a rewarded ad grants its reward
 *   no-fill       nothing plays
 *   closed-early  starts, and the player closes it before the reward
 */
export type AdOutcome = "complete" | "no-fill" | "closed-early";

export interface PortalHarness {
  readonly platform: Platform;
  /** SDK calls, in order, under the neutral names above. */
  readonly calls: string[];
  /** Whether this portal has an SDK at all. False for GameVui. */
  readonly hasSdk: boolean;
  /**
   * Whether the SDK has loading-finished and gameplay start/stop calls to forward to.
   * Defaults to hasSdk. False for Y8, whose SDK has neither: the calls are only counted.
   */
  readonly forwardsLifecycle?: boolean;
  /** Script the next ad requests. */
  setAd(outcome: AdOutcome): void;
  /** The portal takes / returns the foreground by itself, where it can. */
  portalPause?(): void;
  portalResume?(): void;
  /** Change the portal's mute setting, where it has one. */
  setPortalMute?(muted: boolean): void;
}

export interface HarnessOptions {
  readonly sdk?: SdkMode;
  readonly ad?: AdOutcome;
}

/** Timers that fire only when told to: every adapter timeout stays deterministic. */
class HeldTimers implements Timers {
  setTimeout(): unknown {
    return 0;
  }
  clearTimeout(): void {}
}

// -- Yandex ------------------------------------------------------------------------------

function yandex(options: HarnessOptions): PortalHarness {
  const calls: string[] = [];
  let ad: AdOutcome = options.ad ?? "complete";
  const listeners = new Map<string, Set<() => void>>();
  const data: Record<string, unknown> = {};

  const play = (callbacks: YandexRewardedCallbacks, rewarded: boolean): void => {
    if (ad === "no-fill") return callbacks.onClose?.(false);
    callbacks.onOpen?.();
    if (ad === "complete" && rewarded) callbacks.onRewarded?.();
    callbacks.onClose?.(true);
  };

  const sdk: YandexSdk = {
    environment: { app: { id: "matrix" }, i18n: { lang: "ru" } },
    features: {
      LoadingAPI: { ready: () => void calls.push("ready") },
      GameplayAPI: {
        start: () => void calls.push("gameplayStart"),
        stop: () => void calls.push("gameplayStop"),
      },
    },
    adv: {
      showFullscreenAdv: ({ callbacks }) => {
        calls.push("ad:interstitial");
        play(callbacks, false);
      },
      showRewardedVideo: ({ callbacks }) => {
        calls.push("ad:rewarded");
        play(callbacks, true);
      },
    },
    getPlayer: () =>
      Promise.resolve({
        isAuthorized: () => false,
        getData: () => Promise.resolve({ ...data }),
        setData: (next: Record<string, unknown>) => {
          Object.assign(data, next);
          return Promise.resolve();
        },
      }),
    on: (event, listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    },
    off: (event, listener) => void listeners.get(event)?.delete(listener),
  };
  const yaGames: YaGamesGlobal = {
    init: () => {
      calls.push("init");
      return options.sdk === "init-fails"
        ? Promise.reject(new Error("YaGames.init failed (mock)"))
        : Promise.resolve(sdk);
    },
  };

  const timers = new HeldTimers();
  const platform = new YandexPlatform({
    namespace: "matrix",
    loadSdk: () =>
      options.sdk === "missing"
        ? Promise.reject(new Error("/sdk.js blocked (mock)"))
        : Promise.resolve(yaGames),
    timers,
    storage: new YandexStorage({ namespace: "matrix", local: new MemoryStorageBackend(), timers }),
  });
  const fire = (event: string): void => listeners.get(event)?.forEach((listener) => listener());
  return {
    platform,
    calls,
    hasSdk: true,
    setAd: (outcome) => (ad = outcome),
    portalPause: () => fire("game_api_pause"),
    portalResume: () => fire("game_api_resume"),
  };
}

// -- CrazyGames --------------------------------------------------------------------------

function crazygames(options: HarnessOptions): PortalHarness {
  const calls: string[] = [];
  let ad: AdOutcome = options.ad ?? "complete";
  const data = new Map<string, string>();
  let settings = { disableChat: false, muteAudio: false };
  const settingsListeners: ((next: typeof settings) => void)[] = [];

  const sdk: CrazyGamesSdk = {
    environment: "crazygames",
    init: () => {
      calls.push("init");
      return options.sdk === "init-fails"
        ? Promise.reject({ code: "other", message: "init failed (mock)" })
        : Promise.resolve();
    },
    ad: {
      requestAd: (type, callbacks?: CrazyGamesAdCallbacks) => {
        calls.push(type === "midgame" ? "ad:interstitial" : "ad:rewarded");
        if (ad === "no-fill") {
          callbacks?.adError?.({ code: "unfilled", message: "no fill (mock)" });
          return;
        }
        callbacks?.adStarted?.();
        // The docs do not say what closing a rewarded ad early reports; an adError after
        // adStarted is the only outcome that must not reward, so the mock uses it.
        if (ad === "closed-early") callbacks?.adError?.({ code: "other", message: "closed" });
        else callbacks?.adFinished?.();
      },
      hasAdblock: () => Promise.resolve(false),
    },
    game: {
      gameplayStart: () => void calls.push("gameplayStart"),
      gameplayStop: () => void calls.push("gameplayStop"),
      loadingStart: () => void calls.push("loadingStart"),
      loadingStop: () => void calls.push("ready"),
      get settings() {
        return settings;
      },
      addSettingsChangeListener: (listener) => void settingsListeners.push(listener),
      removeSettingsChangeListener: () => {},
    },
    data: {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
      removeItem: (key) => void data.delete(key),
      clear: () => data.clear(),
    },
    user: {
      isUserAccountAvailable: false,
      systemInfo: { locale: "en-US", device: { type: "desktop" }, applicationType: "web" },
      getUser: () => Promise.resolve(null),
    },
  };

  const platform = new CrazyGamesPlatform({
    namespace: "matrix",
    loadSdk: () =>
      options.sdk === "missing"
        ? Promise.reject(new Error("crazygames-sdk-v3.js blocked (mock)"))
        : Promise.resolve(sdk),
  });
  return {
    platform,
    calls,
    hasSdk: true,
    setAd: (outcome) => (ad = outcome),
    setPortalMute: (muted) => {
      settings = { ...settings, muteAudio: muted };
      for (const listener of settingsListeners) listener(settings);
    },
  };
}

// -- Poki --------------------------------------------------------------------------------

function poki(options: HarnessOptions): PortalHarness {
  const calls: string[] = [];
  let ad: AdOutcome = options.ad ?? "complete";

  const sdk: PokiSdk = {
    init: () => {
      calls.push("init");
      return options.sdk === "init-fails"
        ? Promise.reject(new Error("PokiSDK.init rejected (mock ad blocker)"))
        : Promise.resolve();
    },
    gameLoadingFinished: () => void calls.push("ready"),
    gameplayStart: () => void calls.push("gameplayStart"),
    gameplayStop: () => void calls.push("gameplayStop"),
    commercialBreak: (onStart) => {
      calls.push("ad:interstitial");
      // Poki's documented behaviour under an ad blocker: the break resolves, nothing plays.
      if (ad !== "no-fill" && options.sdk !== "init-fails") onStart?.();
      return Promise.resolve();
    },
    rewardedBreak: (onStart) => {
      calls.push("ad:rewarded");
      if (ad === "no-fill" || options.sdk === "init-fails") return Promise.resolve(false);
      onStart?.();
      return Promise.resolve(ad === "complete");
    },
  };

  const platform = new PokiPlatform({
    namespace: "matrix",
    storage: new MemoryStorageBackend(),
    loadSdk: () => Promise.resolve(options.sdk === "missing" ? null : sdk),
    // Never let the init deadline race the mock.
    setTimeout: () => 0,
  });
  return { platform, calls, hasSdk: true, setAd: (outcome) => (ad = outcome) };
}

// -- GameVui -----------------------------------------------------------------------------

function gamevui(): PortalHarness {
  // No SDK to fake: GameVui publishes none (docs/sdk.md). The harness exists so GameVui runs
  // through the same scenarios and proves it degrades exactly as documented.
  const platform = new GameVuiPlatform({
    namespace: "matrix",
    storage: new MemoryStorageBackend(),
  });
  return { platform, calls: [], hasSdk: false, setAd: () => {} };
}

// -- Y8 ----------------------------------------------------------------------------------

function y8(options: HarnessOptions): PortalHarness {
  const calls: string[] = [];
  const scripts = {
    complete: "viewed",
    "no-fill": "noAdPreloaded",
    "closed-early": "dismissed",
  } as const;
  // The deterministic mock from tests/y8/, installed on a private EventTarget rather than
  // window so nothing else on the page can see it. A signed-in player: saves go to the cloud.
  const mock = createY8Mock(new EventTarget(), {
    init: options.sdk === "init-fails" ? "rejects" : "ok",
    user: { pid: "matrix", nickname: "Matrix" },
    ad: scripts[options.ad ?? "complete"],
  });
  // Y8 has no loading or gameplay API, so only init and ads have neutral names to record.
  const sdk: Y8Sdk = {
    ...mock.sdk,
    init: (appConfig, adConfig) => {
      calls.push("init");
      return mock.sdk.init(appConfig, adConfig);
    },
    showAd: (o) => {
      calls.push(o.type === "reward" ? "ad:rewarded" : "ad:interstitial");
      return mock.sdk.showAd(o);
    },
  };
  const platform = new Y8Platform({
    namespace: "matrix",
    config: { appId: "matrix-app", gameId: "matrix-game" },
    guestStorage: new MemoryStorageBackend(),
    loadSdk: () =>
      options.sdk === "missing"
        ? Promise.reject(new Error("cdn.y8.com blocked (mock)"))
        : Promise.resolve(sdk),
  });
  return {
    platform,
    calls,
    hasSdk: true,
    forwardsLifecycle: false,
    setAd: (outcome) => mock.setAd(scripts[outcome]),
  };
}

export function createHarness(portal: Portal, options: HarnessOptions = {}): PortalHarness {
  switch (portal) {
    case "yandex":
      return yandex(options);
    case "crazygames":
      return crazygames(options);
    case "poki":
      return poki(options);
    case "gamevui":
      return gamevui();
    case "y8":
      return y8(options);
  }
}
