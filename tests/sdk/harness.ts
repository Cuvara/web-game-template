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
  GenericWebPlatform,
  MemoryStorageBackend,
  PokiPlatform,
  YandexPlatform,
  YandexStorage,
  type Platform,
  type PokiSdk,
  type Timers,
  type YaGamesGlobal,
  type YandexAdCallbacks,
  type YandexRewardedCallbacks,
  type YandexSdk,
} from "@wgf/platform-sdk";

/** How the portal answers the next ad request. */
export type AdScript =
  | "play" // shown to the end; a rewarded ad grants its reward
  | "no-fill" // the portal has nothing to show
  | "closed-early" // shown, then closed by the player before the reward
  | "error"; // the portal SDK reports an error

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
        if (ad === "play" || ad === "closed-early") onStart?.();
        return Promise.resolve();
      },
      rewardedBreak: (onStart) => {
        calls.push("PokiSDK.rewardedBreak");
        if (blocked) return Promise.resolve(false);
        if (ad === "error") return Promise.reject(new Error("scripted"));
        if (ad === "play" || ad === "closed-early") onStart?.();
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
// GameVui publishes no SDK, JavaScript API or publishing API (docs/platforms/gamevui/). A
// GameVui build is a platform-neutral web build on the generic-web adapter, so that is what
// is exercised; createPlatform("gamevui") throws on purpose.

const gamevui = genericWeb("gamevui", {
  adapter: "none",
  limitation:
    'GameVui documents no SDK; builds run on the generic-web adapter and createPlatform("gamevui") ' +
    "throws by design (docs/platforms/gamevui/platform-contract.md). Portal-injected ads are " +
    "outside the game's control.",
});

// -- CrazyGames ---------------------------------------------------------------------------

const crazygames: Harness = {
  id: "crazygames",
  adapter: "missing",
  limitation:
    'No CrazyGames adapter on this ref: createPlatform("crazygames") throws. The adapter is ' +
    "in progress on its own branch; add its harness here when it merges.",
  ads: ["interstitial", "rewarded"],
  portalPauses: false,
  cloudStorage: true,
  hasSdk: true,
  create() {
    return Promise.reject(new Error("crazygames adapter missing"));
  },
};

export const HARNESSES: readonly Harness[] = [
  genericWeb("generic-web"),
  yandex,
  poki,
  crazygames,
  gamevui,
];
