// One harness per adapter, so the SDK contract suite can run the same scenarios against
// every platform. Each harness drives its portal's SDK through a scripted fake: nothing
// here loads a real portal script or talks to a portal, and no timer waits on real time.
//
// The fakes model only what each portal documents:
//   Yandex  https://yandex.com/dev/games/doc/en/sdk/sdk-adv (onOpen/onRewarded/onClose/onError)
//   Poki    https://developers.poki.com/guide/sdk-html5 (commercialBreak/rewardedBreak)

import {
  GameVuiPlatform,
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

/** How the portal's SDK behaves in a scenario. */
export type SdkScript = "ok" | "missing" | "init-fails" | "init-hangs";
/**
 * How the next ad goes: `reward` watched to the end, `close` closed by the player before
 * the reward, `no-fill` nothing to show, `error` the SDK failed, `hold` an ad that opens
 * and stays on screen until {@link Built.releaseAd}.
 */
export type AdScript = "reward" | "close" | "no-fill" | "error" | "hold";

export interface Scenario {
  readonly sdk?: SdkScript;
  readonly ad?: AdScript;
}

export interface Built {
  readonly platform: Platform;
  /** SDK calls the fake received, in order. */
  readonly calls: string[];
  /** Drive fake time forward: init deadlines, ad-open deadlines. */
  advance(ms: number): void;
  /** Raise the portal's own pause/resume, where the portal has one. */
  portalPause?(): void;
  portalResume?(): void;
  /** End a `hold` ad, rewarded. */
  releaseAd(): void;
}

export interface Harness {
  readonly id: string;
  /** False where the portal offers developers no ads at all. */
  readonly hasAds: boolean;
  build(scenario?: Scenario): Built;
}

export class ManualTimers implements Timers {
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

function yandexHarness(): Harness {
  return {
    id: "yandex",
    hasAds: true,
    build({ sdk: sdkScript = "ok", ad = "reward" } = {}) {
      const calls: string[] = [];
      const timers = new ManualTimers();
      const listeners = new Map<string, Set<() => void>>();
      let release: () => void = () => undefined;
      const runAd = (callbacks: YandexRewardedCallbacks, rewarded: boolean): void => {
        if (ad === "error") return callbacks.onError?.(new Error("scripted"));
        if (ad === "hold") {
          callbacks.onOpen?.();
          release = () => {
            if (rewarded) callbacks.onRewarded?.();
            callbacks.onClose?.(true);
          };
          return;
        }
        if (ad === "no-fill") return callbacks.onClose?.(false);
        callbacks.onOpen?.();
        if (ad === "reward" && rewarded) callbacks.onRewarded?.();
        callbacks.onClose?.(true);
      };
      const sdk: YandexSdk = {
        environment: { app: { id: "1" }, i18n: { lang: "en" } },
        features: {
          LoadingAPI: { ready: () => void calls.push("ready") },
          GameplayAPI: {
            start: () => void calls.push("start"),
            stop: () => void calls.push("stop"),
          },
        },
        adv: {
          showFullscreenAdv: ({ callbacks }: { callbacks: YandexAdCallbacks }) => {
            calls.push("fullscreen");
            runAd(callbacks, false);
          },
          showRewardedVideo: ({ callbacks }: { callbacks: YandexRewardedCallbacks }) => {
            calls.push("rewarded");
            runAd(callbacks, true);
          },
        },
        EVENTS: {
          ACCOUNT_SELECTION_DIALOG_OPENED: "ACCOUNT_SELECTION_DIALOG_OPENED",
          ACCOUNT_SELECTION_DIALOG_CLOSED: "ACCOUNT_SELECTION_DIALOG_CLOSED",
        },
        getPlayer: () =>
          Promise.resolve({
            isAuthorized: () => false,
            getData: () => Promise.resolve({}),
            setData: () => Promise.resolve(),
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
          if (sdkScript === "init-fails") return Promise.reject(new Error("init failed"));
          if (sdkScript === "init-hangs") return new Promise(() => undefined);
          return Promise.resolve(sdk);
        },
      };
      const platform = new YandexPlatform({
        namespace: "contract",
        loadSdk: () =>
          sdkScript === "missing"
            ? Promise.reject(new Error("/sdk.js blocked"))
            : Promise.resolve(yaGames),
        timers,
        now: () => timers.now,
        storage: new YandexStorage({
          namespace: "contract",
          local: new MemoryStorageBackend(),
          timers,
          now: () => timers.now,
        }),
      });
      const fire = (event: string) => listeners.get(event)?.forEach((listener) => listener());
      return {
        platform,
        calls,
        advance: (ms) => timers.advance(ms),
        portalPause: () => fire("game_api_pause"),
        portalResume: () => fire("game_api_resume"),
        releaseAd: () => release(),
      };
    },
  };
}

function pokiHarness(): Harness {
  return {
    id: "poki",
    hasAds: true,
    build({ sdk: sdkScript = "ok", ad = "reward" } = {}) {
      const calls: string[] = [];
      const timers = new ManualTimers();
      // A rejected init is Poki's ad-blocker signal. The SDK object is still there - Poki
      // says to load the game anyway - but its breaks play nothing.
      const blocked = sdkScript === "init-fails";
      const script: AdScript = blocked ? "no-fill" : ad;
      let release: () => void = () => undefined;
      const hold = (onStart: (() => void) | undefined, value: boolean) => {
        onStart?.();
        return new Promise<boolean>((resolve) => (release = () => resolve(value)));
      };
      const sdk: PokiSdk = {
        init: () => {
          calls.push("init");
          if (sdkScript === "init-fails") return Promise.reject(new Error("adblock"));
          if (sdkScript === "init-hangs") return new Promise(() => undefined);
          return Promise.resolve();
        },
        gameLoadingFinished: () => void calls.push("gameLoadingFinished"),
        gameplayStart: () => void calls.push("gameplayStart"),
        gameplayStop: () => void calls.push("gameplayStop"),
        commercialBreak: (onStart) => {
          calls.push("commercialBreak");
          if (script === "error") return Promise.reject(new Error("scripted"));
          if (script === "hold") return hold(onStart, true);
          if (script !== "no-fill") onStart?.();
          return Promise.resolve();
        },
        rewardedBreak: (onStart) => {
          calls.push("rewardedBreak");
          if (script === "error") return Promise.reject(new Error("scripted"));
          if (script === "no-fill") return Promise.resolve(false);
          if (script === "hold") return hold(onStart, true);
          onStart?.();
          // Poki reports a player who closed early the same way as no reward: false.
          return Promise.resolve(script === "reward");
        },
      };
      const platform = new PokiPlatform({
        namespace: "contract",
        storage: new MemoryStorageBackend(),
        loadSdk: () => Promise.resolve(sdkScript === "missing" ? null : sdk),
        setTimeout: (callback, ms) => timers.setTimeout(callback, ms),
        onRejected: () => undefined,
      });
      return {
        platform,
        calls,
        advance: (ms) => timers.advance(ms),
        releaseAd: () => release(),
      };
    },
  };
}

function noPortalHarness(id: "generic-web" | "gamevui"): Harness {
  return {
    id,
    hasAds: false,
    build() {
      const platform =
        id === "gamevui"
          ? new GameVuiPlatform({ namespace: "contract", storage: new MemoryStorageBackend() })
          : new GenericWebPlatform({ namespace: "contract" });
      return { platform, calls: [], advance: () => undefined, releaseAd: () => undefined };
    },
  };
}

/** Every adapter the registry builds. A new adapter gets a harness here, or fails the suite. */
export const HARNESSES: readonly Harness[] = [
  yandexHarness(),
  pokiHarness(),
  noPortalHarness("gamevui"),
  noPortalHarness("generic-web"),
];

/** Initialise, reaching past any init deadline the scenario makes the adapter wait out. */
export async function boot(built: Built): Promise<void> {
  const init = built.platform.initialize();
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
    built.advance(1_000);
  }
  await init;
  await built.platform.signalReady();
}

/** An ad call, advancing fake time until it settles. */
export async function settle<T>(built: Built, pending: Promise<T>): Promise<T> {
  let done = false;
  void pending.then(() => (done = true));
  for (let i = 0; i < 40 && !done; i += 1) {
    await Promise.resolve();
    built.advance(1_000);
  }
  return pending;
}
