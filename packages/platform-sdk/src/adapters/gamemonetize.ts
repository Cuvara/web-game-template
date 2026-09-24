// GameMonetize — https://gamemonetize.com/sdk
//
// Written against GameMonetize's own HTML5 SDK documentation, audited 2026-09-24:
//
//   - https://github.com/MonetizeGame/GameMonetize.com-SDK (README, the "Docs" link for
//     HTML5 / JS on gamemonetize.com/sdk)
//   - HTML5_Games_SDK_GameMonetize.txt (the "Other platforms" download on the same page)
//   - the Construct 2/3 and Unity SDK READMEs and plugin sources the same page links, read
//     only to confirm the HTML5 surface — they wrap exactly the calls below
//
// That documentation defines, in full:
//
//   window.SDK_OPTIONS = { gameId, onEvent(event) }   set before the SDK script runs
//   <script id="gamemonetize-sdk" src="https://api.gamemonetize.com/sdk.js">
//   event.name: SDK_READY        the SDK is ready
//               SDK_ERROR        the SDK got an error
//               SDK_GAME_PAUSE   an ad is about to play: pause AND mute (mandatory)
//               SDK_GAME_START   the ad is done: resume and unmute (mandatory)
//   sdk.showBanner()             request an advertisement ("call it as often as you want";
//                                the portal rejects premature calls itself)
//
// Nothing else. In particular GameMonetize documents no rewarded ad, no reward callback, no
// loading or gameplay reporting, no language, no user and no cloud save for HTML5 games, so
// this adapter claims none of them: `showRewarded` resolves `unsupported` without touching
// the SDK, and a title that declares rewarded ads fails `pnpm sdk:prepare`. `showBanner` is,
// despite its name, the portal's full-screen (video) advertisement — the SDK pauses the game
// around it — so it is the adapter's interstitial. There is no banner in the game's control.
//
// What the adapter guarantees, whatever the SDK does:
//
//   - one ad request at a time; a second one while an ad is pending or on screen is "busy".
//   - every request resolves exactly once and never rejects, including when the SDK answers
//     twice, answers late, never answers, or throws.
//   - every `ad:start` / `foreground:lost` is matched by exactly one `ad:end` /
//     `foreground:gained`, so a game muted and paused for the ad is never left that way.
//     A dropped SDK_GAME_START is covered by a deadline (`adTimeoutMs`).
//   - a game with no Game ID, a malformed one, a blocked SDK or a failed SDK boots and plays
//     as a plain web game with ads unavailable.
//
// The SDK is GameMonetize's own script from its own host, loaded at runtime, only by this
// adapter, only when a build targets GameMonetize — never bundled, and never added to a
// build for any other portal.

import { AdPolicy } from "../ad-policy.js";
import { PlatformEmitter } from "../emitter.js";
import { LocalStorageBackend } from "../storage.js";
import { UsageRecorder, type PlatformUsage } from "../usage.js";
import type { Timers } from "./yandex-storage.js";
import {
  DEFAULT_SETTINGS,
  UNKNOWN_ENVIRONMENT,
  type AdAvailability,
  type AdHooks,
  type AdKind,
  type AdResult,
  type AdSkipReason,
  type Platform,
  type PlatformCapabilities,
  type PlatformEnvironment,
  type PlatformEvents,
  type PlatformSettings,
  type PlatformStorage,
  type PlatformUser,
  type RewardedResult,
  type Unsubscribe,
} from "../types.js";

/** The documented SDK script. */
export const GAMEMONETIZE_SDK_URL = "https://api.gamemonetize.com/sdk.js";

/** The id the documented snippet gives the script tag; it also keeps the SDK loaded once. */
export const GAMEMONETIZE_SCRIPT_ID = "gamemonetize-sdk";

export const GAMEMONETIZE_CAPABILITIES: PlatformCapabilities = {
  // showBanner() only. No rewarded ad is documented for HTML5 games.
  ads: ["interstitial"],
  iap: false,
  cloudSaves: false,
  leaderboards: false,
  achievements: false,
  auth: "none",
  analytics: "self-hosted",
  // No loading API is documented.
  loadingApi: "none",
  // "Call the sdk.showBanner(); method as often as you want" — the portal rejects premature
  // calls itself. A local interval would suppress ads the portal wanted to show.
  interstitialMinIntervalS: null,
  // No portal visibility handling is documented; the game reports its own pause.
  gameplayStopOnHidden: true,
};

/** The events GameMonetize documents. Anything else the SDK raises is ignored. */
export type GameMonetizeEventName = "SDK_READY" | "SDK_ERROR" | "SDK_GAME_PAUSE" | "SDK_GAME_START";

export interface GameMonetizeEvent {
  readonly name: string;
}

/** `window.SDK_OPTIONS`, as the documentation writes it. */
export interface GameMonetizeSdkOptions {
  readonly gameId: string;
  readonly onEvent: (event: GameMonetizeEvent) => void;
  /**
   * `autoplay: false` stops the SDK playing an ad by itself while the game loads. Not in the
   * HTML5 README; it is what GameMonetize's own Construct 2 plugin passes, and GameMonetize's
   * Unity readme says "First ADS must show on button PLAY and not on loading game".
   */
  readonly advertisementSettings?: { readonly autoplay: boolean };
}

/** The subset of `window.sdk` this adapter uses — the one documented method. */
export interface GameMonetizeSdk {
  showBanner(): unknown;
}

/**
 * Loads the SDK with the given options and resolves `window.sdk`, or null when the script
 * could not be loaded (offline, ad blocker, CSP). Readiness is reported through
 * `options.onEvent`, not by the promise.
 */
export type GameMonetizeSdkLoader = (
  options: GameMonetizeSdkOptions,
) => Promise<GameMonetizeSdk | null>;

interface GameMonetizeWindow {
  SDK_OPTIONS?: GameMonetizeSdkOptions;
  sdk?: Partial<GameMonetizeSdk>;
}

function sdkGlobal(): GameMonetizeSdk | null {
  const candidate = (window as unknown as GameMonetizeWindow).sdk;
  return candidate && typeof candidate.showBanner === "function"
    ? (candidate as GameMonetizeSdk)
    : null;
}

/**
 * The documented integration, done at runtime: set `window.SDK_OPTIONS`, then insert the
 * SDK script with id `gamemonetize-sdk` once. The SDK reads SDK_OPTIONS when it runs, so the
 * order matters and is fixed here.
 */
export function loadGameMonetizeSdk(
  options: GameMonetizeSdkOptions,
  url: string = GAMEMONETIZE_SDK_URL,
): Promise<GameMonetizeSdk | null> {
  if (typeof document === "undefined") return Promise.resolve(null);
  (window as unknown as GameMonetizeWindow).SDK_OPTIONS = options;
  const loaded = sdkGlobal();
  if (loaded) return Promise.resolve(loaded);
  if (document.getElementById(GAMEMONETIZE_SCRIPT_ID)) {
    // Someone else inserted the documented snippet (e.g. by hand in index.html). It read its
    // own SDK_OPTIONS, not these, so its events would never reach this adapter. Refuse it
    // rather than half-work: the build must let the adapter own the SDK.
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.id = GAMEMONETIZE_SCRIPT_ID;
    script.src = url;
    script.async = true;
    script.onload = () => resolve(sdkGlobal());
    // A blocked script must not break the game: resolve, and carry on without ads.
    script.onerror = () => resolve(null);
    const first = document.getElementsByTagName("script")[0];
    if (first?.parentNode) first.parentNode.insertBefore(script, first);
    else document.head.appendChild(script);
  });
}

const PLACEHOLDER_IDS = new Set(["your_game_id_here", "your-game-id", "game_id", "gameid"]);
const GAME_ID_FORMAT = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Why a Game ID cannot be used, or null when it can. The ID comes from the GameMonetize
 * control panel (Game Management > My games > the game). GameMonetize documents no format;
 * this rejects only what is certainly wrong: missing, the documented placeholder, or
 * something that is not a short token.
 */
export function gameMonetizeGameIdProblem(gameId: unknown): string | null {
  if (gameId === undefined || gameId === null || gameId === "") return "missing";
  if (typeof gameId !== "string") return "not a string";
  if (PLACEHOLDER_IDS.has(gameId.trim().toLowerCase())) return "the documented placeholder";
  if (!GAME_ID_FORMAT.test(gameId)) return "not 8-64 letters, digits, '-' or '_'";
  return null;
}

export interface GameMonetizeOptions {
  /** Storage namespace. Use the game id from game.config.yaml. */
  readonly namespace: string;
  /**
   * The GameMonetize Game ID. Missing or malformed, the adapter never loads the SDK and the
   * game runs without ads — GameMonetize's "Verify Game" will fail, which is the point.
   */
  readonly gameId?: string | null;
  /** How to load the SDK. Defaults to inserting GameMonetize's script. */
  readonly loadSdk?: GameMonetizeSdkLoader;
  /** How long initialize() waits for SDK_READY before the game boots without ads. */
  readonly initTimeoutMs?: number;
  /**
   * How long a request waits for the SDK to answer showBanner() at all — SDK_GAME_PAUSE (an
   * ad is starting) or SDK_GAME_START (nothing to show). The SDK rejects premature calls by
   * itself and documents no event for that, so without this a rejected call would hold the
   * game paused.
   */
  readonly adStartTimeoutMs?: number;
  /**
   * How long an ad that started may hold the game before SDK_GAME_START is given up on and
   * the foreground handed back. Must outlast a real ad.
   */
  readonly adTimeoutMs?: number;
  readonly timers?: Timers;
  /** Replaces localStorage-backed storage. */
  readonly storage?: PlatformStorage;
}

/**
 * not-configured  no usable Game ID; the SDK is never loaded
 * loading         the script is loading or SDK_READY has not arrived yet
 * ready           SDK_READY arrived
 * error           SDK_ERROR arrived before SDK_READY
 * unavailable     the script could not be loaded, or SDK_READY missed the init deadline
 */
export type GameMonetizeSdkState = "not-configured" | "loading" | "ready" | "error" | "unavailable";

// The game's own loading runs after this; players leave slow loads.
const DEFAULT_INIT_TIMEOUT_MS = 5_000;
// Enough for the SDK's ad auction on a slow connection. An ad that opens later is still
// handled: it arrives as an ad the portal started by itself.
const DEFAULT_AD_START_TIMEOUT_MS = 10_000;
// GameMonetize's own ad overlay counts down from 31 seconds. 60s is past any real ad.
const DEFAULT_AD_TIMEOUT_MS = 60_000;

const defaultTimers: Timers = {
  setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface PendingAd {
  readonly kind: AdKind;
  readonly hooks: AdHooks | undefined;
  readonly resolve: (result: AdResult) => void;
  started: boolean;
  timer: unknown;
}

export class GameMonetizePlatform implements Platform {
  readonly id = "gamemonetize";
  readonly capabilities = GAMEMONETIZE_CAPABILITIES;
  readonly storage: PlatformStorage;
  /** GameMonetize documents no language; the game follows the browser. */
  readonly language = null;
  readonly environment: PlatformEnvironment = UNKNOWN_ENVIRONMENT;
  readonly settings: PlatformSettings = DEFAULT_SETTINGS;
  /** Why the Game ID was refused, or null. */
  readonly configProblem: string | null;

  readonly #gameId: string | null;
  readonly #ads = new AdPolicy(GAMEMONETIZE_CAPABILITIES);
  readonly #events = new PlatformEmitter();
  readonly #usage = new UsageRecorder();
  readonly #loadSdk: GameMonetizeSdkLoader;
  readonly #timers: Timers;
  readonly #initTimeoutMs: number;
  readonly #adStartTimeoutMs: number;
  readonly #adTimeoutMs: number;
  readonly #sdkEvents: string[] = [];

  #sdk: GameMonetizeSdk | null = null;
  #state: GameMonetizeSdkState;
  #initializing: Promise<void> | null = null;
  #markReady: (() => void) | null = null;
  #loadingFraction = 0;
  #gameplayActive = false;
  /** The game's own request, from showBanner() until it resolves. */
  #pending: PendingAd | null = null;
  /** An ad on screen that the game did not ask for, or that opened after its request gave up. */
  #hold: { timer: unknown } | null = null;

  constructor(options: GameMonetizeOptions) {
    this.storage = options.storage ?? new LocalStorageBackend(options.namespace);
    this.#loadSdk = options.loadSdk ?? loadGameMonetizeSdk;
    this.#timers = options.timers ?? defaultTimers;
    this.#initTimeoutMs = options.initTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS;
    this.#adStartTimeoutMs = options.adStartTimeoutMs ?? DEFAULT_AD_START_TIMEOUT_MS;
    this.#adTimeoutMs = options.adTimeoutMs ?? DEFAULT_AD_TIMEOUT_MS;
    this.configProblem = gameMonetizeGameIdProblem(options.gameId);
    this.#gameId = this.configProblem === null ? (options.gameId as string) : null;
    this.#state = this.#gameId === null ? "not-configured" : "loading";
  }

  get usage(): PlatformUsage {
    return this.#usage.snapshot();
  }

  get sdkState(): GameMonetizeSdkState {
    return this.#state;
  }

  /** Every SDK event name received, oldest first, including ignored duplicates and undocumented ones. */
  get sdkEvents(): readonly string[] {
    return [...this.#sdkEvents];
  }

  get loadingFraction(): number {
    return this.#loadingFraction;
  }

  get gameplayActive(): boolean {
    return this.#gameplayActive;
  }

  /** False while a GameMonetize ad is on screen. */
  get foreground(): boolean {
    return !(this.#pending?.started || this.#hold);
  }

  on<K extends keyof PlatformEvents>(
    event: K,
    handler: (payload: PlatformEvents[K]) => void,
  ): Unsubscribe {
    return this.#events.on(event, handler);
  }

  adAvailability(kind: AdKind): AdAvailability {
    if (!this.capabilities.ads.includes(kind)) return "unsupported";
    return this.#state === "ready" && this.#sdk ? "available" : "disabled";
  }

  getUser(): Promise<PlatformUser | null> {
    return Promise.resolve(null);
  }

  initialize(): Promise<void> {
    this.#initializing ??= this.#initialize();
    return this.#initializing;
  }

  async #initialize(): Promise<void> {
    if (this.#gameId === null) return;
    const ready = new Promise<void>((resolve) => (this.#markReady = resolve));
    const deadline = new Promise<void>((resolve) => {
      this.#timers.setTimeout(resolve, this.#initTimeoutMs);
    });
    await Promise.race([this.#connect(this.#gameId, ready), deadline]);
    // Boot without ads. A late SDK_READY still makes the SDK usable.
    if (this.#state === "loading") this.#state = "unavailable";
  }

  async #connect(gameId: string, ready: Promise<void>): Promise<void> {
    let sdk: GameMonetizeSdk | null;
    try {
      sdk = await this.#loadSdk({
        gameId,
        advertisementSettings: { autoplay: false },
        onEvent: (event) => this.#onSdkEvent(event),
      });
    } catch {
      sdk = null;
    }
    if (!sdk) {
      if (this.#state !== "ready") this.#state = "unavailable";
      return;
    }
    this.#sdk = sdk;
    if (this.#state === "ready" || this.#state === "error") return;
    await ready;
  }

  #onSdkEvent(event: GameMonetizeEvent): void {
    const name = typeof event?.name === "string" ? event.name : "";
    this.#sdkEvents.push(name);
    switch (name) {
      case "SDK_READY":
        // Also after the init deadline or an earlier SDK_ERROR: the SDK recovered.
        this.#state = "ready";
        this.#markReady?.();
        return;
      case "SDK_ERROR":
        if (this.#state === "loading" || this.#state === "unavailable") {
          this.#state = "error";
          this.#markReady?.();
        }
        // An error before the ad started ends the request. After it started, the ad is on
        // screen: wait for SDK_GAME_START (or the deadline) to hand the foreground back.
        if (this.#pending && !this.#pending.started)
          this.#finish({ shown: false, reason: "error" });
        return;
      case "SDK_GAME_PAUSE":
        this.#onPause();
        return;
      case "SDK_GAME_START":
        this.#onStart();
        return;
      default:
        return;
    }
  }

  #onPause(): void {
    const pending = this.#pending;
    if (pending && !pending.started) {
      pending.started = true;
      this.#timers.clearTimeout(pending.timer);
      pending.timer = this.#timers.setTimeout(
        () => this.#finish({ shown: true }),
        this.#adTimeoutMs,
      );
      this.#takeForeground(pending.kind);
      try {
        pending.hooks?.onStart?.();
      } catch {
        // A throwing hook must not strand the ad.
      }
      return;
    }
    // A duplicate while an ad is already on screen.
    if (pending || this.#hold) return;
    // An ad the game did not ask for: the SDK's own, or one that opened after its request
    // gave up. The SDK asks for the game to be paused and muted either way; to the game it
    // is the portal holding the screen, as a Yandex portal pause is.
    this.#hold = {
      timer: this.#timers.setTimeout(() => this.#release(), this.#adTimeoutMs),
    };
    this.#events.emit("foreground:lost", undefined);
  }

  #onStart(): void {
    const pending = this.#pending;
    if (pending) {
      // Before SDK_GAME_PAUSE: the SDK had nothing to show, or refused a premature call.
      this.#finish(pending.started ? { shown: true } : { shown: false, reason: "not-ready" });
      return;
    }
    if (this.#hold) this.#release();
    // Otherwise a duplicate or a late answer to a request that already resolved: ignored.
  }

  /** Resolve the game's request once, and hand the foreground back if the ad took it. */
  #finish(result: AdResult): void {
    const pending = this.#pending;
    if (!pending) return;
    this.#pending = null;
    this.#timers.clearTimeout(pending.timer);
    if (pending.started) {
      this.#usage.recordAdShown(pending.kind);
      this.#ads.record(pending.kind);
      this.#giveForeground(pending.kind);
    }
    pending.resolve(result);
  }

  #release(): void {
    const hold = this.#hold;
    if (!hold) return;
    this.#hold = null;
    this.#timers.clearTimeout(hold.timer);
    this.#events.emit("foreground:gained", undefined);
  }

  #takeForeground(kind: AdKind): void {
    this.#events.emit("foreground:lost", undefined);
    this.#events.emit("ad:start", { kind });
  }

  #giveForeground(kind: AdKind): void {
    this.#events.emit("ad:end", { kind });
    this.#events.emit("foreground:gained", undefined);
  }

  reportLoadingProgress(fraction: number): void {
    // No loading API is documented; recorded for release validation only.
    this.#loadingFraction = Math.min(Math.max(fraction, 0), 1);
    this.#usage.recordLoadingProgress();
  }

  signalReady(): Promise<void> {
    this.#loadingFraction = 1;
    this.#usage.recordSignalReady();
    return Promise.resolve();
  }

  gameplayStart(): void {
    // No gameplay API is documented; tracked for bindPlatform and the verify suite.
    if (this.#gameplayActive) return;
    this.#gameplayActive = true;
    this.#usage.recordGameplayStart();
  }

  gameplayStop(): void {
    if (!this.#gameplayActive) return;
    this.#gameplayActive = false;
    this.#usage.recordGameplayStop();
  }

  showInterstitial(hooks?: AdHooks): Promise<AdResult> {
    this.#usage.recordAdRequested("interstitial");
    const refused = this.#refusal("interstitial");
    if (refused) return Promise.resolve({ shown: false, reason: refused });

    const sdk = this.#sdk!;
    return new Promise<AdResult>((resolve) => {
      const pending: PendingAd = {
        kind: "interstitial",
        hooks,
        resolve,
        started: false,
        timer: undefined,
      };
      this.#pending = pending;
      pending.timer = this.#timers.setTimeout(
        () => this.#finish({ shown: false, reason: "not-ready" }),
        this.#adStartTimeoutMs,
      );
      try {
        sdk.showBanner();
      } catch {
        // The SDK may already have answered synchronously; #finish ignores a second answer.
        if (this.#pending === pending) this.#finish({ shown: false, reason: "error" });
      }
    });
  }

  /** GameMonetize documents no rewarded ad. Never calls the SDK, never rewards. */
  showRewarded(): Promise<RewardedResult> {
    this.#usage.recordAdRequested("rewarded");
    return Promise.resolve({ shown: false, rewarded: false, reason: "unsupported" });
  }

  #refusal(kind: AdKind): AdSkipReason | null {
    const policy = this.#ads.check(kind);
    if (policy) return policy;
    if (this.#pending || this.#hold) return "busy";
    if (this.#state === "error") return "error";
    if (this.#state !== "ready" || !this.#sdk) return "not-ready";
    return null;
  }
}
