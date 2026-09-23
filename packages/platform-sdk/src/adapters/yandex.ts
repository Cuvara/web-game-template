// Yandex Games.
//
// Written against the official documentation at https://yandex.com/dev/games/doc/en/ and
// the requirements at https://yandex.com/dev/games/doc/en/concepts/requirements. The
// numbers in comments (1.19.2, 4.7, ...) are those requirements, which are also the
// moderation checklist a submission is judged against.
//
// The SDK script is `/sdk.js`, a path relative to the portal origin, which is what the docs
// prescribe for an archive upload. The absolute S3 URL is for self-hosted games only, and
// requirement 1.7 forbids absolute S3 URLs in an uploaded game — so it never appears here.
//
// If the script cannot be loaded — a local run without sdk-dev-proxy, a blocked request —
// the adapter degrades instead of failing boot: ads report "error", saves stay local, and
// `sdkAvailable` is false. On the portal itself the script is always served.

import { AdPolicy } from "../ad-policy.js";
import { PlatformEmitter } from "../emitter.js";
import { UsageRecorder, type PlatformUsage } from "../usage.js";
import type {
  AdHooks,
  AdResult,
  Platform,
  PlatformCapabilities,
  PlatformEvents,
  RewardedResult,
} from "../types.js";
import type { YaGamesGlobal, YandexSdk } from "./yandex-sdk.js";
import { YandexStorage, realTimers, type Timers } from "./yandex-storage.js";

/**
 * What this adapter implements, which is less than the portal offers (the profile lists
 * banners, purchases and leaderboards too). A capability reported here is one a game can
 * call; reporting the portal's full list would invite calls to code that does not exist.
 * The sticky banner needs no code at all — it is a Console switch.
 *
 * The profile's 60 s interstitial interval is kept as a local floor although the docs leave
 * the frequency to the portal: an ad the portal would throttle anyway costs a paused frame
 * and nothing else, and the floor stops a bug from requesting one every game over.
 */
export const YANDEX_CAPABILITIES: PlatformCapabilities = {
  ads: ["interstitial", "rewarded"],
  iap: false,
  cloudSaves: true,
  leaderboards: false,
  achievements: false,
  // Guests play and keep progress (1.2.2); the adapter never opens the login dialog.
  auth: "none",
  analytics: "platform-provided",
  loadingApi: "required",
  interstitialMinIntervalS: 60,
};

/** The documented path for an archive upload. */
export const YANDEX_SDK_URL = "/sdk.js";

export interface YandexOptions {
  /** Storage namespace for the local mirror. Use the game id from game.config.yaml. */
  readonly namespace: string;
  /** Overrides how the YaGames global is obtained. Tests inject a fake here. */
  readonly loadSdk?: () => Promise<YaGamesGlobal>;
  readonly sdkUrl?: string;
  /** How long to wait for the script, init and player before degrading. */
  readonly timeoutMs?: number;
  /**
   * How long an ad call may go without the portal opening or closing anything before the
   * game gets control back. The call keeps listening after that: a late ad still pauses the
   * game through game_api_pause, and a late reward is delivered as `ad:late-reward`.
   * Defaults: 8 s for an interstitial, 20 s for a rewarded video.
   */
  readonly adOpenTimeoutMs?: number;
  readonly now?: () => number;
  readonly timers?: Timers;
  readonly storage?: YandexStorage;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_INTERSTITIAL_OPEN_TIMEOUT_MS = 8_000;
const DEFAULT_REWARDED_OPEN_TIMEOUT_MS = 20_000;

/** Load `/sdk.js` by script tag, the dynamic form the docs show. */
export function loadSdkScript(src: string, timeoutMs: number): Promise<YaGamesGlobal> {
  const existing = (globalThis as { YaGames?: YaGamesGlobal }).YaGames;
  if (existing) return Promise.resolve(existing);
  if (typeof document === "undefined") {
    return Promise.reject(new Error("no document to load the Yandex SDK into"));
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timer = setTimeout(() => reject(new Error(`${src} did not load`)), timeoutMs);
    script.src = src;
    script.async = true;
    script.onload = () => {
      clearTimeout(timer);
      const loaded = (globalThis as { YaGames?: YaGamesGlobal }).YaGames;
      if (loaded) resolve(loaded);
      else reject(new Error(`${src} loaded but did not define YaGames`));
    };
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`${src} failed to load`));
    };
    document.head.appendChild(script);
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string, timers: Timers) {
  return new Promise<T>((resolve, reject) => {
    const handle = timers.setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    promise.then(
      (value) => {
        timers.clearTimeout(handle);
        resolve(value);
      },
      (error: unknown) => {
        timers.clearTimeout(handle);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export class YandexPlatform implements Platform {
  readonly id = "yandex";
  readonly capabilities = YANDEX_CAPABILITIES;
  readonly storage: YandexStorage;

  readonly #options: YandexOptions;
  readonly #timers: Timers;
  readonly #ads: AdPolicy;
  readonly #usage = new UsageRecorder();
  readonly #events = new PlatformEmitter();

  #init: Promise<void> | null = null;
  #sdk: YandexSdk | null = null;
  #initError: unknown = null;
  #language: string | null = null;
  /**
   * Why the portal or the page holds the foreground. The foreground returns only when every
   * hold is released: an ad that ends while the tab is still hidden must not resume play.
   */
  readonly #holds = new Set<"portal" | "ad" | "hidden">();
  #readySent = false;
  #gameplayRunning = false;
  #adShowing = false;
  #dispose: Array<() => void> = [];

  constructor(options: YandexOptions) {
    this.#options = options;
    this.#timers = options.timers ?? realTimers;
    this.#ads = new AdPolicy(YANDEX_CAPABILITIES, options.now);
    this.storage =
      options.storage ??
      new YandexStorage({
        namespace: options.namespace,
        timers: this.#timers,
        ...(options.now ? { now: options.now } : {}),
      });
  }

  get usage(): PlatformUsage {
    return this.#usage.snapshot();
  }

  get language(): string | null {
    return this.#language;
  }

  get foreground(): boolean {
    return this.#holds.size === 0;
  }

  /** False when the SDK could not be loaded or initialised. */
  get sdkAvailable(): boolean {
    return this.#sdk !== null;
  }

  /** Why the SDK is unavailable, when it is. */
  get initError(): unknown {
    return this.#initError;
  }

  /** Whether the game has told the portal gameplay is running. */
  get gameplayRunning(): boolean {
    return this.#gameplayRunning;
  }

  on<K extends keyof PlatformEvents>(
    event: K,
    handler: (payload: PlatformEvents[K]) => void,
  ): () => void {
    return this.#events.on(event, handler);
  }

  initialize(): Promise<void> {
    this.#init ??= this.#initialize();
    return this.#init;
  }

  async #initialize(): Promise<void> {
    const timeoutMs = this.#options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    try {
      const load =
        this.#options.loadSdk ??
        (() => loadSdkScript(this.#options.sdkUrl ?? YANDEX_SDK_URL, timeoutMs));
      const yaGames = await load();
      const sdk = await withTimeout(yaGames.init(), timeoutMs, "YaGames.init()", this.#timers);
      this.#sdk = sdk;
    } catch (error) {
      this.#initError = error;
      console.warn("Yandex SDK unavailable; running without it", error);
      return;
    }

    const sdk = this.#sdk;
    // Subscribe before anything else: the portal shows an ad by itself at launch, and its
    // only signal is this pair of events (https://yandex.com/dev/games/doc/en/sdk/sdk-events).
    this.#listen(sdk, "game_api_pause", this.#onPortalPause);
    this.#listen(sdk, "game_api_resume", this.#onPortalResume);
    // The player may switch between guest and account progress through the portal. The docs
    // say: pause data sync while the dialog is open, re-fetch the player when it closes.
    const opened = sdk.EVENTS?.ACCOUNT_SELECTION_DIALOG_OPENED;
    const closed = sdk.EVENTS?.ACCOUNT_SELECTION_DIALOG_CLOSED;
    if (opened && closed) {
      this.#listen(sdk, opened, () => this.storage.suspendSync());
      this.#listen(sdk, closed, () => void this.#reloadPlayer());
    }
    this.#flushOnHide();

    const lang = sdk.environment?.i18n?.lang;
    this.#language = typeof lang === "string" && lang.length > 0 ? lang.toLowerCase() : null;

    // Progress has to be restored before Game Ready (1.9), so the player is part of loading.
    try {
      const player = await withTimeout(sdk.getPlayer(), timeoutMs, "getPlayer()", this.#timers);
      await withTimeout(this.storage.attach(player), timeoutMs, "getData()", this.#timers);
    } catch (error) {
      console.warn("Yandex player data unavailable; saves stay local", error);
    }
  }

  #listen(sdk: YandexSdk, event: string, listener: () => void): void {
    sdk.on(event, listener);
    this.#dispose.push(() => sdk.off(event, listener));
  }

  /** A pending save goes out now if the page is hidden or closed — 1.9, 4.2. */
  #flushOnHide(): void {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    // 1.3: sound stops within 2 s of the tab being hidden. The portal's game_api_pause
    // usually covers it, but not when the SDK is missing, so the page is a hold of its own.
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") {
        this.storage.flush();
        this.#hold("hidden");
      } else {
        this.#release("hidden");
      }
    };
    const onPageHide = (): void => this.storage.flush();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    this.#dispose.push(() => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    });
  }

  async #reloadPlayer(): Promise<void> {
    const sdk = this.#sdk;
    if (!sdk) return;
    const timeoutMs = this.#options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    try {
      const player = await withTimeout(sdk.getPlayer(), timeoutMs, "getPlayer()", this.#timers);
      await withTimeout(this.storage.attach(player, "cloud"), timeoutMs, "getData()", this.#timers);
      this.storage.resumeSync();
    } catch (error) {
      // Writing the old player's map into whichever account is now active could overwrite
      // it. Carry on locally instead.
      console.warn("Yandex player reload after account selection failed; saves stay local", error);
      this.storage.detach();
    }
    this.#events.emit("storage:changed", undefined);
  }

  /** Unsubscribe from the SDK and the page. The platform is unusable afterwards. */
  dispose(): void {
    for (const off of this.#dispose.splice(0)) off();
  }

  #hold(reason: "portal" | "ad" | "hidden"): void {
    if (this.#holds.has(reason)) return;
    const wasForeground = this.#holds.size === 0;
    this.#holds.add(reason);
    if (wasForeground) this.#events.emit("foreground:lost", undefined);
  }

  /** Returns true when this release gave the foreground back. */
  #release(reason: "portal" | "ad" | "hidden"): boolean {
    if (!this.#holds.delete(reason) || this.#holds.size > 0) return false;
    this.#events.emit("foreground:gained", undefined);
    return true;
  }

  readonly #onPortalPause = (): void => {
    this.#hold("portal");
  };

  readonly #onPortalResume = (): void => {
    if (!this.#holds.has("portal")) return;
    this.#release("portal");
    // The portal restarts GameplayAPI by itself on resume unless the game had stopped it
    // BEFORE the pause (sdk-events). A game that stops in response to the pause — or that
    // resumes to a pause screen — is still stopped, so say so again once the portal's own
    // start() has run. A stop() while stopped is harmless; a green indicator over a pause
    // screen is a 1.19.3 rejection.
    // Whether the portal's own start() runs inside the event dispatch or later is not
    // documented, so the correction is sent twice: next tick and half a second on.
    for (const delayMs of [0, 500]) {
      this.#timers.setTimeout(() => {
        if (!this.#gameplayRunning && this.#holds.size === 0) {
          this.#call(() => this.#sdk?.features.GameplayAPI?.stop());
        }
      }, delayMs);
    }
  };

  /** Yandex has no progress API; the count is kept for release validation only. */
  reportLoadingProgress(fraction: number): void {
    void fraction;
    this.#usage.recordLoadingProgress();
  }

  /**
   * LoadingAPI.ready() — requirement 1.19.2. Call it when the game is interactive: nothing
   * loading, nothing on a timer. Sent at most once.
   */
  async signalReady(): Promise<void> {
    await this.initialize();
    this.#usage.recordSignalReady();
    if (this.#readySent) return;
    this.#readySent = true;
    this.#call(() => this.#sdk?.features.LoadingAPI?.ready());
  }

  /**
   * GameplayAPI.start() — requirement 1.19.3. Level start, menu closed, unpause, after an
   * ad, back to the tab. Repeated calls are dropped so the portal sees transitions only.
   */
  gameplayStart(): void {
    if (this.#gameplayRunning) return;
    this.#gameplayRunning = true;
    this.#call(() => this.#sdk?.features.GameplayAPI?.start());
  }

  get gameplayActive(): boolean {
    return this.#gameplayRunning;
  }

  /** GameplayAPI.stop() — level end, menu, pause, before an ad, leaving the tab. */
  gameplayStop(): void {
    if (!this.#gameplayRunning) return;
    this.#gameplayRunning = false;
    this.#call(() => this.#sdk?.features.GameplayAPI?.stop());
  }

  showInterstitial(hooks?: AdHooks): Promise<AdResult> {
    return this.#show("interstitial", hooks).then(({ shown, reason }) =>
      reason ? { shown, reason } : { shown },
    );
  }

  showRewarded(hooks?: AdHooks): Promise<RewardedResult> {
    return this.#show("rewarded", hooks);
  }

  #show(kind: "interstitial" | "rewarded", hooks?: AdHooks): Promise<RewardedResult> {
    this.#usage.recordAdRequested(kind);
    const refused = this.#ads.check(kind);
    if (refused) return Promise.resolve({ shown: false, rewarded: false, reason: refused });
    const sdk = this.#sdk;
    // No SDK (script blocked, init failed): the contract's "not-ready", not an SDK error.
    if (!sdk) return Promise.resolve({ shown: false, rewarded: false, reason: "not-ready" });
    // One ad at a time. A second request while one is on screen is a game bug, and the
    // portal's answer to it is undocumented.
    if (this.#adShowing) {
      return Promise.resolve({ shown: false, rewarded: false, reason: "busy" });
    }
    this.#adShowing = true;
    // 4.7: sound and gameplay are paused for the ad. Go quiet before asking for it rather
    // than on onOpen, which fires once the ad is already on screen; and report gameplay
    // stopped (1.19.3 lists ads among the moments GameplayAPI.stop() is for).
    this.gameplayStop();
    this.#hold("ad");

    return new Promise<RewardedResult>((resolve) => {
      let settled = false;
      // How the call settled. Only a timeout can leave a reward owed: a callback that
      // settled it already carried `rewarded` in the result.
      let timedOut = false;
      let opened = false;
      let closed = false;
      let rewarded = false;

      const finish = (result: RewardedResult): void => {
        if (settled) return;
        settled = true;
        this.#timers.clearTimeout(timer);
        if (result.shown) {
          this.#ads.record(kind);
          this.#usage.recordAdShown(kind);
        }
        resolve(result);
      };

      // Everything the portal eventually says is honoured, even after the game got control
      // back: a late ad is still on screen, so it still holds the one-ad-at-a-time slot.
      const end = (): void => {
        if (closed) return;
        closed = true;
        this.#adShowing = false;
        if (opened) this.#events.emit("ad:end", { kind });
        this.#release("ad");
      };

      const timeoutMs =
        this.#options.adOpenTimeoutMs ??
        (kind === "rewarded"
          ? DEFAULT_REWARDED_OPEN_TIMEOUT_MS
          : DEFAULT_INTERSTITIAL_OPEN_TIMEOUT_MS);
      const timer = this.#timers.setTimeout(() => {
        // Nothing opened in time. Free the slot; a late onOpen takes it back.
        if (!opened) {
          this.#adShowing = false;
          this.#release("ad");
        }
        timedOut = true;
        finish({ shown: false, rewarded: false, reason: "not-ready" });
      }, timeoutMs);

      const callbacks = {
        onOpen: () => {
          opened = true;
          this.#adShowing = true;
          this.#hold("ad");
          this.#timers.clearTimeout(timer);
          this.#events.emit("ad:start", { kind });
          hooks?.onStart?.();
        },
        onClose: (wasShown: boolean) => {
          const shown = wasShown === true;
          // Owed only when the game was already told "no reward" by the timeout. An
          // onRewarded -> onError -> onClose sequence settled with the reward; emitting
          // here as well would pay it twice.
          if (timedOut && rewarded && kind === "rewarded") {
            this.#events.emit("ad:late-reward", { kind });
          }
          finish(
            shown
              ? { shown, rewarded }
              : // Closed unshown: no fill, or throttled for calling too often.
                { shown, rewarded, reason: "not-ready" },
          );
          end();
        },
        onError: (error: unknown) => {
          console.warn(`Yandex ${kind} ad failed`, error);
          finish({ shown: opened, rewarded, reason: "error" });
          end();
        },
      };

      try {
        if (kind === "interstitial") {
          sdk.adv.showFullscreenAdv({ callbacks });
        } else {
          sdk.adv.showRewardedVideo({
            callbacks: {
              ...callbacks,
              onRewarded: () => {
                rewarded = true;
              },
            },
          });
        }
      } catch (error) {
        callbacks.onError(error);
      }
    });
  }

  /** SDK calls must never take the game down with them (1.14). */
  #call(body: () => void): void {
    try {
      body();
    } catch (error) {
      console.warn("Yandex SDK call failed", error);
    }
  }
}
