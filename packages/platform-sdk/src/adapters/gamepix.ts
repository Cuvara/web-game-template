// GamePix — https://partners.gamepix.com/developers
//
// Written against GamePix's own documentation, read 2026-10-04:
//
//   - the JavaScript SDK reference   https://partners.gamepix.com/sdk/doc/javascript
//   - the submission guidelines      https://partners.gamepix.com/guidelines/submission
//   - the developer program          https://partners.gamepix.com/developers
//
// That documentation defines, for HTML5 games:
//
//   <script src="https://integration.gamepix.com/sdk/v3/gamepix.sdk.js"></script>
//                                 the FIRST script in <head> — the one step marked Mandatory
//   GamePix.loading(n)            loading progress, an integer 0-100
//                                 (LOADING_VALUE_IS_NOT_A_NUMBER)
//   GamePix.loaded()              loading finished. Before any other SDK method, and once
//                                 (GAMEPIX_LOADED_NOT_CALLED, LOADED_ALREADY_CALLED)
//   GamePix.interstitialAd()      Promise<{ success }>. "Not every single interstitialAd()
//                                 will trigger an ad" — GamePix decides the frequency and asks
//                                 for every commercial break. Pause before, resume in the
//                                 callback. Twice before it settles: INTERSTITIAL_AD_CALLED_TWICE
//   GamePix.rewardAd()            Promise<{ success }> (beta). Reward only on success: true.
//                                 Twice before it settles: REWARD_AD_CALLED_TWICE
//   GamePix.lang()                one of ar zh nl en fr de it ja ko pl pt ru es tr
//   GamePix.localStorage          setItem / getItem / removeItem, strings only
//                                 (KEY_OR_VALUE_FOR_LOCALSTORAGE_NOT_A_STRING)
//   GamePix.happyMoment(), updateScore(n), updateLevel(n)   optional; not in the Platform
//                                 contract, so not called here
//
// No Game ID or key goes into the code: the GamePix dashboard identifies the game. The JS page
// documents no gameplay start/stop call (the Unity guide's GamePix.lifecycle.* is not on it),
// so gameplayStart/gameplayStop are tracked locally and the SDK hears nothing. The game must
// pause itself, audio included, when the tab is hidden — bindPlatform does that because
// `gameplayStopOnHidden` is true.
//
// What the adapter guarantees, whatever the SDK does:
//
//   - loaded() is sent once, at signalReady, and no SDK method but loading() and lang() is
//     called before it. An ad asked for earlier resolves "not-ready" without touching the SDK.
//   - one ad at a time; a second request while one is pending is "busy" — never the SDK's
//     INTERSTITIAL_AD_CALLED_TWICE / REWARD_AD_CALLED_TWICE.
//   - the game is paused and muted before the SDK is asked (foreground:lost), as GamePix
//     requires, and given back exactly once (foreground:gained) when the promise settles or a
//     deadline passes. GamePix signals no ad start, so ad:start / ad:end (and the onStart hook)
//     are raised only for an ad the SDK confirmed with success: true — never for an unfilled
//     request.
//   - every request resolves exactly once and never rejects; a reward is granted only on the
//     SDK's own success: true.
//   - a blocked or missing script (a local run, an ad blocker) boots a plain web game: ads
//     not-ready, saves on the template's local storage, no throw.
//
// The SDK is GamePix's own script from its own host. The build puts the documented tag first
// in <head> for a build whose target is gamepix (scripts/build/game-config-plugin.ts), and for
// no other build; it is never bundled. Without that tag (tests, a dev page) the adapter
// inserts it once at runtime.

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
export const GAMEPIX_SDK_URL = "https://integration.gamepix.com/sdk/v3/gamepix.sdk.js";

/** What GamePix.lang() may return, per the JS SDK reference. */
export const GAMEPIX_LANGUAGES = [
  "ar",
  "zh",
  "nl",
  "en",
  "fr",
  "de",
  "it",
  "ja",
  "ko",
  "pl",
  "pt",
  "ru",
  "es",
  "tr",
] as const;

export const GAMEPIX_CAPABILITIES: PlatformCapabilities = {
  // interstitialAd() and rewardAd() (beta). No banner is documented.
  ads: ["interstitial", "rewarded"],
  iap: false,
  // GamePix.localStorage is browser storage behind GamePix's API, not a cloud save: "third-
  // party browser restrictions may purge data". The adapter uses it, but claims no cloud.
  cloudSaves: false,
  leaderboards: false,
  achievements: false,
  auth: "none",
  // The submission guidelines forbid other analytics SDKs; GamePix measures play itself.
  analytics: "platform-provided",
  // loading() / loaded() are documented, and loaded() is the one call every other waits on.
  loadingApi: "required",
  // "signal as many commercial break opportunities as possible" — GamePix decides whether a
  // call shows an ad. A local interval would drop breaks GamePix wanted.
  interstitialMinIntervalS: null,
  // No visibility API: "When the user switches to a new browser tab, game must pause
  // (including audio)" — the game does it, through bindPlatform.
  gameplayStopOnHidden: true,
};

/** `{ success }`, what both ad promises resolve with. */
export interface GamePixAdResult {
  readonly success?: boolean;
}

/** `GamePix.localStorage` — strings only. */
export interface GamePixLocalStorage {
  getItem(key: string): string | null | undefined;
  setItem(key: string, value: string): unknown;
  removeItem(key: string): unknown;
}

/** The subset of `window.GamePix` this adapter uses — every member is documented. */
export interface GamePixSdk {
  loading(progress: number): unknown;
  loaded(): unknown;
  interstitialAd(): Promise<GamePixAdResult> | GamePixAdResult | unknown;
  rewardAd(): Promise<GamePixAdResult> | GamePixAdResult | unknown;
  lang?(): unknown;
  localStorage?: GamePixLocalStorage;
}

/** Resolves the SDK, or null when it cannot be loaded (offline, ad blocker, CSP). */
export type GamePixSdkLoader = () => Promise<GamePixSdk | null>;

interface GamePixWindow {
  GamePix?: Partial<GamePixSdk>;
}

/** `window.GamePix` when it has the documented methods, else null. */
export function gamePixGlobal(): GamePixSdk | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as unknown as GamePixWindow).GamePix;
  return candidate &&
    typeof candidate.loading === "function" &&
    typeof candidate.loaded === "function" &&
    typeof candidate.interstitialAd === "function" &&
    typeof candidate.rewardAd === "function"
    ? (candidate as GamePixSdk)
    : null;
}

/**
 * Resolves `window.GamePix`. A build for GamePix carries the documented synchronous tag first
 * in <head>, which has run before any module does: no global then means it was blocked, and
 * asking again only adds a second failed request. Without a tag (tests, a dev page) the script
 * is inserted once, ahead of every other script.
 */
export function loadGamePixSdk(url: string = GAMEPIX_SDK_URL): Promise<GamePixSdk | null> {
  if (typeof document === "undefined") return Promise.resolve(null);
  const ready = gamePixGlobal();
  if (ready) return Promise.resolve(ready);
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${url}"]`);
  if (existing) {
    const pending = existing.async || existing.defer || existing.type === "module";
    if (!pending) return Promise.resolve(null);
    return new Promise((resolve) => {
      existing.addEventListener("load", () => resolve(gamePixGlobal()), { once: true });
      existing.addEventListener("error", () => resolve(null), { once: true });
    });
  }
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.onload = () => resolve(gamePixGlobal());
    // A blocked script must not break the game: resolve, and carry on without the SDK.
    script.onerror = () => resolve(null);
    const first = document.getElementsByTagName("script")[0];
    if (first?.parentNode) first.parentNode.insertBefore(script, first);
    else document.head.appendChild(script);
  });
}

/**
 * Saves through `GamePix.localStorage` once GamePix has been told the game loaded, and
 * through the template's own local storage always. Every write goes to the local copy too,
 * and writes made before loaded() — a game reading and writing saves while it loads — are
 * queued and replayed into GamePix's storage when it opens, because no GamePix method but
 * loading() may run before loaded() (GAMEPIX_LOADED_NOT_CALLED). Reads prefer GamePix's value
 * and fall back to the local copy, which is all there is without the SDK (a local run, a
 * blocked script). Keys are namespaced by game id, as LocalStorageBackend's are.
 */
export class GamePixStorage implements PlatformStorage {
  readonly #prefix: string;
  readonly #local: PlatformStorage;
  readonly #queued = new Map<string, string | null>();
  #store: GamePixLocalStorage | null = null;

  constructor(namespace: string, local: PlatformStorage) {
    this.#prefix = `${namespace}:`;
    this.#local = local;
  }

  /**
   * The local copy's answer: GamePix's storage is browser storage too ("third-party browser
   * restrictions may purge data"), so where the browser refuses one it refuses both. A local
   * copy that cannot tell counts as not persistent, so the game warns rather than promises.
   */
  get persistent(): boolean {
    return this.#local.persistent ?? false;
  }

  /** Whether reads and writes now reach GamePix.localStorage. */
  get attached(): boolean {
    return this.#store !== null;
  }

  /** Opens GamePix's storage, after loaded(), and replays what was written before it. */
  attach(store: GamePixLocalStorage | undefined): void {
    if (
      this.#store ||
      !store ||
      typeof store.getItem !== "function" ||
      typeof store.setItem !== "function" ||
      typeof store.removeItem !== "function"
    ) {
      return;
    }
    this.#store = store;
    for (const [key, value] of this.#queued) {
      if (value === null) this.#remove(key);
      else this.#set(key, value);
    }
    this.#queued.clear();
  }

  get(key: string): Promise<string | null> {
    if (this.#store) {
      try {
        const value = this.#store.getItem(this.#prefix + key);
        if (typeof value === "string") return Promise.resolve(value);
      } catch {
        // Fall through to the local copy.
      }
    }
    return this.#local.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    // Strings only (KEY_OR_VALUE_FOR_LOCALSTORAGE_NOT_A_STRING); PlatformStorage is too.
    const text = String(value);
    if (this.#store) this.#set(key, text);
    else this.#queued.set(key, text);
    await this.#local.set(key, text);
  }

  async remove(key: string): Promise<void> {
    if (this.#store) this.#remove(key);
    else this.#queued.set(key, null);
    await this.#local.remove(key);
  }

  #set(key: string, value: string): void {
    try {
      this.#store?.setItem(this.#prefix + key, value);
    } catch {
      // The local copy still has it.
    }
  }

  #remove(key: string): void {
    try {
      this.#store?.removeItem(this.#prefix + key);
    } catch {
      // The local copy is removed either way.
    }
  }
}

export interface GamePixOptions {
  /** Storage namespace. Use the game id. */
  readonly namespace: string;
  /** How to obtain the SDK. Defaults to the documented <head> script. */
  readonly loadSdk?: GamePixSdkLoader;
  /** How long initialize() waits for the SDK before the game boots without it. */
  readonly initTimeoutMs?: number;
  /**
   * How long an ad request may hold the game before it is given up on and the game resumed.
   * GamePix has no ad-start event, so the deadline covers the whole ad and must outlast one.
   */
  readonly adTimeoutMs?: number;
  readonly timers?: Timers;
  /**
   * The local copy every save also goes to, and all there is without the SDK. Defaults to
   * the template's local storage.
   */
  readonly storage?: PlatformStorage;
}

/**
 * not-initialized  initialize() not called
 * loading          waiting for the script
 * ready            the SDK is present
 * error            the SDK is present but rejected loaded()
 * unavailable      the script could not be loaded, or missed the init deadline
 */
export type GamePixSdkState = "not-initialized" | "loading" | "ready" | "error" | "unavailable";

/** Calls made to the SDK, oldest first. `loading` is recorded with its value. */
export type GamePixSdkCall = string;

// Players leave slow loads; the game's own loading runs after this.
const DEFAULT_INIT_TIMEOUT_MS = 5_000;
// No ad-start or ad-end event exists, so this covers request plus ad. 60s is past any real
// interstitial or rewarded video; it fires only on a promise the SDK never settles.
const DEFAULT_AD_TIMEOUT_MS = 60_000;

const defaultTimers: Timers = {
  setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class GamePixPlatform implements Platform {
  readonly id = "gamepix";
  readonly capabilities = GAMEPIX_CAPABILITIES;
  readonly storage: GamePixStorage;
  readonly environment: PlatformEnvironment = UNKNOWN_ENVIRONMENT;
  readonly settings: PlatformSettings = DEFAULT_SETTINGS;

  readonly #ads = new AdPolicy(GAMEPIX_CAPABILITIES);
  readonly #events = new PlatformEmitter();
  readonly #usage = new UsageRecorder();
  readonly #loadSdk: GamePixSdkLoader;
  readonly #timers: Timers;
  readonly #initTimeoutMs: number;
  readonly #adTimeoutMs: number;
  readonly #calls: GamePixSdkCall[] = [];

  #sdk: GamePixSdk | null = null;
  #state: GamePixSdkState = "not-initialized";
  #initializing: Promise<void> | null = null;
  #language: string | null = null;
  #loadingFraction = 0;
  #lastLoadingSent: number | null = null;
  /** signalReady() was called; loaded() is owed to the SDK, once. */
  #ready = false;
  #loadedSent = false;
  #gameplayActive = false;
  /** An ad the game asked for, from the request until it resolves. */
  #adInProgress: AdKind | null = null;
  /**
   * Ad kinds whose SDK promise has not settled, even after the request gave up on it: a
   * second call would be INTERSTITIAL_AD_CALLED_TWICE / REWARD_AD_CALLED_TWICE.
   */
  readonly #sdkPending = new Set<AdKind>();
  #foreground = true;

  constructor(options: GamePixOptions) {
    this.#loadSdk = options.loadSdk ?? (() => loadGamePixSdk());
    this.#timers = options.timers ?? defaultTimers;
    this.#initTimeoutMs = options.initTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS;
    this.#adTimeoutMs = options.adTimeoutMs ?? DEFAULT_AD_TIMEOUT_MS;
    this.storage = new GamePixStorage(
      options.namespace,
      options.storage ?? new LocalStorageBackend(options.namespace),
    );
  }

  get usage(): PlatformUsage {
    return this.#usage.snapshot();
  }

  get sdkState(): GamePixSdkState {
    return this.#state;
  }

  /** False when the SDK could not be loaded. */
  get sdkAvailable(): boolean {
    return this.#sdk !== null;
  }

  /** Calls made to the SDK, oldest first. */
  get sdkCalls(): readonly GamePixSdkCall[] {
    return [...this.#calls];
  }

  /** GamePix.lang(), when it is one of the documented languages; else null. */
  get language(): string | null {
    return this.#language;
  }

  get loadingFraction(): number {
    return this.#loadingFraction;
  }

  get gameplayActive(): boolean {
    return this.#gameplayActive;
  }

  /** False while the game is held for a GamePix ad. */
  get foreground(): boolean {
    return this.#foreground;
  }

  on<K extends keyof PlatformEvents>(
    event: K,
    handler: (payload: PlatformEvents[K]) => void,
  ): Unsubscribe {
    return this.#events.on(event, handler);
  }

  adAvailability(kind: AdKind): AdAvailability {
    if (!this.capabilities.ads.includes(kind)) return "unsupported";
    return this.#sdk && this.#state === "ready" ? "available" : "disabled";
  }

  /** GamePix documents no accounts. */
  getUser(): Promise<PlatformUser | null> {
    return Promise.resolve(null);
  }

  initialize(): Promise<void> {
    this.#initializing ??= this.#initialize();
    return this.#initializing;
  }

  async #initialize(): Promise<void> {
    this.#state = "loading";
    let timer: unknown;
    const deadline = new Promise<void>((resolve) => {
      timer = this.#timers.setTimeout(resolve, this.#initTimeoutMs);
    });
    await Promise.race([this.#connect(), deadline]);
    this.#timers.clearTimeout(timer);
    // Boot without the SDK; a late script still connects in #connect.
    if (this.#state === "loading") this.#state = "unavailable";
  }

  async #connect(): Promise<void> {
    let sdk: GamePixSdk | null;
    try {
      sdk = await this.#loadSdk();
    } catch {
      sdk = null;
    }
    if (!sdk) {
      if (this.#state === "loading") this.#state = "unavailable";
      return;
    }
    this.#sdk = sdk;
    if (this.#state !== "error") this.#state = "ready";
    // "Use before game loads to set language" — lang() is the one read the reference places
    // before loaded().
    try {
      const lang = typeof sdk.lang === "function" ? sdk.lang() : null;
      this.#calls.push("lang");
      this.#language =
        typeof lang === "string" && (GAMEPIX_LANGUAGES as readonly string[]).includes(lang)
          ? lang
          : null;
    } catch {
      this.#language = null;
    }
    // Connected after the deadline: tell GamePix where the game already is.
    if (this.#loadingFraction > 0 && !this.#ready) this.#sendLoading(this.#loadingFraction);
    if (this.#ready) this.#sendLoaded();
  }

  reportLoadingProgress(fraction: number): void {
    const clamped = Number.isFinite(fraction) ? Math.min(Math.max(fraction, 0), 1) : 0;
    // Never backwards: GamePix shows the value as a progress bar.
    this.#loadingFraction = Math.max(this.#loadingFraction, clamped);
    this.#usage.recordLoadingProgress();
    // loading() belongs before loaded(); after it there is nothing to report.
    if (!this.#loadedSent) this.#sendLoading(this.#loadingFraction);
  }

  #sendLoading(fraction: number): void {
    const sdk = this.#sdk;
    if (!sdk) return;
    // An integer 0-100 (LOADING_VALUE_IS_NOT_A_NUMBER). Repeats are not re-sent.
    const percent = Math.round(fraction * 100);
    if (percent === this.#lastLoadingSent) return;
    this.#lastLoadingSent = percent;
    this.#calls.push(`loading:${percent}`);
    try {
      sdk.loading(percent);
    } catch {
      // A failing progress bar must not stop the game loading.
    }
  }

  signalReady(): Promise<void> {
    this.#loadingFraction = 1;
    this.#usage.recordSignalReady();
    if (!this.#ready) {
      this.#ready = true;
      this.#sendLoaded();
    }
    return Promise.resolve();
  }

  /** GamePix.loaded(), exactly once (LOADED_ALREADY_CALLED). */
  #sendLoaded(): void {
    const sdk = this.#sdk;
    if (!sdk || this.#loadedSent) return;
    if (this.#lastLoadingSent !== 100) this.#sendLoading(1);
    this.#loadedSent = true;
    this.#calls.push("loaded");
    const failed = (): void => {
      // The SDK refused to start: no ad can follow, and saves stay on the local copy.
      this.#state = "error";
    };
    try {
      const result = sdk.loaded();
      if (result && typeof (result as PromiseLike<unknown>).then === "function") {
        (result as PromiseLike<unknown>).then(undefined, failed);
      }
    } catch {
      failed();
      return;
    }
    // Every GamePix method is open now; saves made while loading reach its storage.
    this.storage.attach(sdk.localStorage);
  }

  gameplayStart(): void {
    // No gameplay call in the JS SDK; tracked for bindPlatform and the verify suite.
    if (this.#gameplayActive) return;
    this.#gameplayActive = true;
    this.#usage.recordGameplayStart();
  }

  gameplayStop(): void {
    if (!this.#gameplayActive) return;
    this.#gameplayActive = false;
    this.#usage.recordGameplayStop();
  }

  async showInterstitial(hooks?: AdHooks): Promise<AdResult> {
    const outcome = await this.#ad("interstitial", hooks);
    return outcome.shown ? { shown: true } : { shown: false, reason: outcome.reason };
  }

  async showRewarded(hooks?: AdHooks): Promise<RewardedResult> {
    const outcome = await this.#ad("rewarded", hooks);
    return outcome.shown
      ? { shown: true, rewarded: true }
      : { shown: false, rewarded: false, reason: outcome.reason };
  }

  #refusal(kind: AdKind): AdSkipReason | null {
    const policy = this.#ads.check(kind);
    if (policy) return policy;
    if (this.#adInProgress || this.#sdkPending.has(kind)) return "busy";
    if (this.#state === "error") return "error";
    if (!this.#sdk || this.#state !== "ready") return "not-ready";
    // GAMEPIX_LOADED_NOT_CALLED: no ad before the game has signalled ready.
    if (!this.#loadedSent) return "not-ready";
    return null;
  }

  async #ad(
    kind: AdKind,
    hooks: AdHooks | undefined,
  ): Promise<{ shown: boolean; reason: AdSkipReason }> {
    this.#usage.recordAdRequested(kind);
    const refused = this.#refusal(kind);
    if (refused) return { shown: false, reason: refused };

    const sdk = this.#sdk!;
    this.#adInProgress = kind;
    // "Pause your game before calling interstitialAd() and resume it in the callback." The
    // foreground goes before the call — bindPlatform pauses and mutes the game on it — and
    // comes back when the promise settles, whether or not an ad played.
    this.#takeForeground();

    let settled = false;
    let timer: unknown;
    try {
      this.#calls.push(kind === "rewarded" ? "rewardAd" : "interstitialAd");
      this.#sdkPending.add(kind);
      const call = Promise.resolve(
        kind === "rewarded" ? sdk.rewardAd() : sdk.interstitialAd(),
      ).then(
        (result) => {
          this.#sdkPending.delete(kind);
          const success = (result as GamePixAdResult | null)?.success === true;
          // A rewarded ad that finished after the call gave up: the reward is owed.
          if (settled && success && kind === "rewarded") {
            this.#played(kind);
            this.#events.emit("ad:late-reward", { kind });
          }
          return success;
        },
        () => {
          this.#sdkPending.delete(kind);
          if (!settled) throw new Error(`GamePix ${kind} failed`);
          return false;
        },
      );
      const deadline = new Promise<"timeout">((resolve) => {
        timer = this.#timers.setTimeout(() => resolve("timeout"), this.#adTimeoutMs);
      });
      const result = await Promise.race([call, deadline]);
      settled = true;
      if (result !== true) return { shown: false, reason: "not-ready" };
      // GamePix raises nothing when an ad starts; success is the first sign one played. The
      // ad is announced then — ad:start, the hook, ad:end — so a request GamePix did not fill
      // ("not every single interstitialAd() will trigger an ad") announces none, as on every
      // other portal. The game was already paused and silent for all of it.
      this.#events.emit("ad:start", { kind });
      try {
        hooks?.onStart?.();
      } catch {
        // A throwing hook must not strand the ad.
      }
      this.#events.emit("ad:end", { kind });
      this.#played(kind);
      return { shown: true, reason: "not-ready" };
    } catch {
      // The call threw, or its promise rejected (already cleared then).
      settled = true;
      this.#sdkPending.delete(kind);
      return { shown: false, reason: "error" };
    } finally {
      this.#timers.clearTimeout(timer);
      this.#adInProgress = null;
      this.#giveBackForeground();
    }
  }

  #played(kind: AdKind): void {
    this.#usage.recordAdShown(kind);
    this.#ads.record(kind);
  }

  #takeForeground(): void {
    this.#foreground = false;
    this.#events.emit("foreground:lost", undefined);
  }

  #giveBackForeground(): void {
    if (this.#foreground) return;
    this.#foreground = true;
    this.#events.emit("foreground:gained", undefined);
  }
}
