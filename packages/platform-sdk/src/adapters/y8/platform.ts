// Y8 — the adapter between the platform contract and the Y8 JavaScript SDK (2-0 line).
//
// Everything Y8-specific a game needs goes through here; game code never touches `window.y8`.
// What the docs require, and where it lives:
//
//   Load from the CDN, never bundle a copy ................... sdk.ts Y8_SDK_URL
//   Listen for y8sdk.ready, then emitReadyEvent() for the
//   case the script already ran; init once ................... loadY8Sdk, initialize()
//   App ID always; Game ID only when the game shows ads ...... config.ts, initialize()
//   Pause and mute INSIDE beforeAd, resume INSIDE afterAd —
//   a skipped or capped break fires neither ................. #requestAd, "ad:start"/"ad:end"
//   adBreakDone runs for every break; only viewed/dismissed
//   mean an ad appeared ...................................... #requestAd, #skipReason
//   Grant a reward only in adViewed, never on adDismissed .... showRewarded
//   beforeReward must call showAdFn or nothing is shown ...... #requestAd
//   Interstitials are capped by the SDK (default ~180 s,
//   configurable per game) — call at every break anyway ...... interstitialMinIntervalS: null
//   Cloud Storage needs a signed-in player; 30 KB a value .... storage.ts
//   Let guests play; auth failures must not stop the game .... #onAuth
//   Platform locale from the site's domain; "en" is also the
//   fallback, so treat it as a default ....................... language
//
// https://docs.y8.com/sdk/intro/ · /sdk/advertising/ · /sdk/cloud-storage/ ·
// /sdk/authentication/ · /sdk/localization/ · /sdk/local-development/

import { PlatformEmitter } from "../../emitter.js";
import { LocalStorageBackend } from "../../storage.js";
import { UsageRecorder, type PlatformUsage } from "../../usage.js";
import {
  DEFAULT_SETTINGS,
  UNKNOWN_ENVIRONMENT,
  languageOf,
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
} from "../../types.js";
import { validateY8Config, type Y8Config } from "./config.js";
import {
  describeY8Error,
  loadY8Sdk,
  type Y8BreakInfo,
  type Y8Error,
  type Y8Placement,
  type Y8Sdk,
  type Y8User,
} from "./sdk.js";
import { Y8Storage } from "./storage.js";

/**
 * What the Platform contract can reach on Y8. Y8 also offers leaderboards and achievements
 * (https://docs.y8.com/sdk/leaderboards/, /sdk/achievements/), but the contract has no call
 * for either yet, so claiming them here would let a game believe it can use them — the same
 * reasoning that keeps `banner` out of the CrazyGames capabilities.
 */
export const Y8_CAPABILITIES: PlatformCapabilities = {
  // Interstitial ("next" placement) and rewarded ("reward"). Y8 documents no banner.
  ads: ["interstitial", "rewarded"],
  iap: false,
  // Cloud Storage for signed-in players; guests save locally (storage.ts).
  cloudSaves: true,
  leaderboards: false,
  achievements: false,
  // "Let anonymous players play" — sign-in is offered, never required.
  auth: "optional",
  // "Plays are counted for you — initializing the SDK records one."
  analytics: "platform-provided",
  // Y8 has no loading or game-ready API; the calls are only counted.
  loadingApi: "none",
  // The SDK paces interstitials itself with a per-game interval ("roughly every 180 seconds,
  // configurable per game") and reports a capped break as `frequencyCapped`. A local copy of
  // the default could disagree with the per-game value, so the SDK is the only counter.
  interstitialMinIntervalS: null,
  // Y8 raises no focus handling of its own and has no gameplay API to report to, so the
  // game pauses itself on a hidden tab and the report stays local.
  gameplayStopOnHidden: true,
};

/**
 * What the adapter is talking to.
 *
 *   not-configured  no valid App ID was built in. The SDK is never loaded: an init without
 *                   an App ID would count plays against no game.
 *   sdk             initialized; ads (with a Game ID) and cloud saves available.
 *   unavailable     the script never became ready (ad blocker, offline, timeout).
 *   failed          init() threw or rejected.
 *
 * Every mode but `sdk` runs the game as a plain web game: local saves, no ads.
 */
export type Y8Mode = "pending" | "not-configured" | "sdk" | "unavailable" | "failed";

export interface Y8Timers {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realTimers: Y8Timers = {
  setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as never),
};

export interface Y8Options {
  /** Storage namespace for guest saves, normally the game id. */
  readonly namespace: string;
  /**
   * `{ appId, gameId? }` as the build injected it (see config.ts). Validated here, so a
   * missing or malformed value degrades the game rather than breaking it.
   */
  readonly config?: unknown;
  /** Resolves the SDK object. Defaults to loading the official script. Tests inject one. */
  readonly loadSdk?: () => Promise<Y8Sdk>;
  /** Where guests save; local storage by default. Tests inject one. */
  readonly guestStorage?: PlatformStorage;
  /**
   * A break that has produced neither `beforeAd` nor `adBreakDone` this long after the
   * request is given up on (resolved unshown), so a lost callback — AdSense blocked, a
   * consent prompt that never answers — cannot hold the game.
   */
  readonly adStartTimeoutMs?: number;
  /**
   * Once `beforeAd` fired the ad owns the screen, but not forever: if neither `afterAd` nor
   * `adBreakDone` has arrived this long after it, the break is closed so the game is never
   * left paused with no resume callback.
   */
  readonly adMaxDurationMs?: number;
  /** After `afterAd`, how long to wait for `adBreakDone` before settling on what was seen. */
  readonly adBreakDoneGraceMs?: number;
  /**
   * How long initialize() waits for the first onAuth report, so storage has settled on
   * cloud or local before the game reads its save. Auth keeps working after this; it is
   * only the boot that stops waiting.
   */
  readonly authWaitMs?: number;
  /** How long initialize() waits for getPlatformLocale(). */
  readonly localeWaitMs?: number;
  readonly timers?: Y8Timers;
}

type Outcome = "viewed" | "dismissed" | null;

export class Y8Platform implements Platform {
  readonly id = "y8";
  readonly capabilities = Y8_CAPABILITIES;
  /** Y8 imposes no settings on the game. */
  readonly settings: PlatformSettings = DEFAULT_SETTINGS;
  /** Y8 reports no device or host details. */
  readonly environment: PlatformEnvironment = UNKNOWN_ENVIRONMENT;

  readonly #options: Y8Options;
  readonly #timers: Y8Timers;
  readonly #usage = new UsageRecorder();
  readonly #events = new PlatformEmitter();
  readonly #storage: Y8Storage;

  #config: Y8Config | null = null;
  #sdk: Y8Sdk | null = null;
  #mode: Y8Mode = "pending";
  #initializing: Promise<void> | null = null;
  #language: string | null = null;
  #user: Y8User | null = null;
  #foreground = true;
  #adInProgress = false;
  #lateAdOnScreen = false;
  #inGameplay = false;
  #loadingFraction = 0;
  #breakSequence = 0;
  #adsOnScreen = 0;
  /** Ends initialize()'s wait for the first auth report early, when init has failed. */
  #stopWaitingForAuth: () => void = () => {};

  constructor(options: Y8Options) {
    this.#options = options;
    this.#timers = options.timers ?? realTimers;
    this.#storage = new Y8Storage(
      options.guestStorage ?? new LocalStorageBackend(options.namespace),
    );
  }

  get storage(): PlatformStorage {
    return this.#storage;
  }

  get usage(): PlatformUsage {
    return this.#usage.snapshot();
  }

  get mode(): Y8Mode {
    return this.#mode;
  }

  /** ISO 639-1 from getPlatformLocale(), or null for "en", which may mean "could not tell". */
  get language(): string | null {
    return this.#language;
  }

  /** False only while a Y8 ad is on screen: Y8 raises no other portal-level pause. */
  get foreground(): boolean {
    return this.#foreground;
  }

  get gameplayActive(): boolean {
    return this.#inGameplay;
  }

  get loadingFraction(): number {
    return this.#loadingFraction;
  }

  /** Whether a player is signed in (as last reported by onAuth). */
  get signedIn(): boolean {
    return this.#user !== null;
  }

  on<K extends keyof PlatformEvents>(
    event: K,
    handler: (payload: PlatformEvents[K]) => void,
  ): Unsubscribe {
    return this.#events.on(event, handler);
  }

  initialize(): Promise<void> {
    this.#initializing ??= this.#initialize();
    return this.#initializing;
  }

  async #initialize(): Promise<void> {
    const checked = validateY8Config(this.#options.config);
    if (!checked.ok) {
      // Loud, because a release built like this earns nothing: no ads, no plays counted.
      console.error(`Y8: not configured — ${checked.problem}. Running without the Y8 SDK.`);
      this.#mode = "not-configured";
      return;
    }
    for (const warning of checked.warnings) console.error(`Y8: ${warning}`);
    this.#config = checked.config;

    let sdk: Y8Sdk;
    try {
      sdk = await (this.#options.loadSdk ?? (() => loadY8Sdk()))();
    } catch (error) {
      console.warn("Y8 SDK unavailable; continuing without it", error);
      this.#mode = "unavailable";
      return;
    }

    // Register before init: the SDK holds an auth result for a callback registered later,
    // but registering first means no report can land on a stale handler.
    let firstAuth: () => void = () => {};
    const authReported = new Promise<void>((resolve) => (firstAuth = resolve));
    this.#stopWaitingForAuth = firstAuth;
    try {
      sdk.onAuth((user, error) => {
        this.#onAuth(user, error);
        firstAuth();
      });
      const { appId, gameId } = checked.config;
      // autoLogin left at the documented default. adConfig only with a Game ID: "omit it if
      // your game doesn't use ads".
      const result = sdk.init(
        { appId, autoLogin: true },
        gameId ? { gameId, preloadAdBreaks: "on", sound: "on" } : undefined,
      );
      // The docs call init() without awaiting it; the script's init is async all the same,
      // and a rejection there means the integration is unusable.
      if (result && typeof (result as Promise<unknown>).then === "function") {
        (result as Promise<unknown>).then(undefined, (error: unknown) => this.#fail(error));
      }
    } catch (error) {
      this.#fail(error);
      return;
    }
    if (this.#mode === "failed") return;

    this.#sdk = sdk;
    this.#mode = "sdk";
    this.#storage.attach(sdk);
    this.#storage.setSignedIn(this.#user !== null);

    await Promise.all([
      this.#bounded(authReported, this.#options.authWaitMs ?? 3_000),
      this.#bounded(this.#readLocale(sdk), this.#options.localeWaitMs ?? 1_500),
    ]);
  }

  #fail(error: unknown): void {
    console.warn(`Y8 SDK init failed; continuing without it (${describeY8Error(error)})`);
    const hadCloud = this.#storage.cloud;
    this.#mode = "failed";
    this.#sdk = null;
    this.#storage.attach(null);
    this.#stopWaitingForAuth();
    if (hadCloud) this.#events.emit("storage:changed", undefined);
  }

  #onAuth(user: Y8User | null, error: Y8Error | null): void {
    // "If authentication cannot be completed, handle the failure gracefully and allow the
    // player to continue" — an auth error leaves the player a guest.
    if (error) console.warn(`Y8 sign-in failed: ${describeY8Error(error)}`);
    this.#user = user && !error ? user : null;
    if (this.#storage.setSignedIn(this.#user !== null)) {
      this.#events.emit("storage:changed", undefined);
    }
  }

  // "en is both a real answer and the fallback ... treat en as a default rather than as a
  // signal" (https://docs.y8.com/sdk/localization/). So only a non-English site counts as the
  // player's choice; "en" leaves the language to the game's own fallback, which is English.
  async #readLocale(sdk: Y8Sdk): Promise<void> {
    try {
      const language = languageOf(await sdk.getPlatformLocale());
      this.#language = language === "en" ? null : language;
    } catch {
      this.#language = null;
    }
  }

  #bounded(work: Promise<void>, ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = this.#timers.setTimeout(resolve, ms);
      void work.then(
        () => {
          this.#timers.clearTimeout(timer);
          resolve();
        },
        () => {
          this.#timers.clearTimeout(timer);
          resolve();
        },
      );
    });
  }

  reportLoadingProgress(fraction: number): void {
    // Y8 has no loading API. Kept for the game's own loading bar and the verify probe.
    this.#loadingFraction = Math.min(Math.max(fraction, 0), 1);
    this.#usage.recordLoadingProgress();
  }

  signalReady(): Promise<void> {
    this.#loadingFraction = 1;
    this.#usage.recordSignalReady();
    return Promise.resolve();
  }

  gameplayStart(): void {
    if (this.#inGameplay) return;
    this.#inGameplay = true;
    this.#usage.recordGameplayStart();
  }

  gameplayStop(): void {
    if (!this.#inGameplay) return;
    this.#inGameplay = false;
    this.#usage.recordGameplayStop();
  }

  adAvailability(kind: AdKind): AdAvailability {
    if (!this.capabilities.ads.includes(kind)) return "unsupported";
    // No SDK, or an SDK without a Game ID ("Ads not initialized"): no offer can have an
    // effect, so the game must hide it.
    if (!this.#sdk || !this.#config?.gameId) return "disabled";
    return "available";
  }

  showInterstitial(hooks?: AdHooks): Promise<AdResult> {
    return this.#requestAd("interstitial", hooks).then(({ result }) => result);
  }

  async showRewarded(hooks?: AdHooks): Promise<RewardedResult> {
    const { result, outcome } = await this.#requestAd("rewarded", hooks);
    // Granted only on adViewed — never on adDismissed, never on a break that showed nothing.
    return { ...result, rewarded: result.shown && outcome === "viewed" };
  }

  getUser(): Promise<PlatformUser | null> {
    const sdk = this.#sdk;
    if (!sdk) return Promise.resolve(null);
    try {
      const user = sdk.getUser();
      if (!user || typeof user.nickname !== "string") return Promise.resolve(null);
      const avatar = user.avatars?.medium_secure_url;
      return Promise.resolve({
        username: user.nickname,
        avatarUrl: typeof avatar === "string" ? avatar : null,
      });
    } catch {
      return Promise.resolve(null);
    }
  }

  #requestAd(
    kind: "interstitial" | "rewarded",
    hooks?: AdHooks,
  ): Promise<{ result: AdResult; outcome: Outcome }> {
    this.#usage.recordAdRequested(kind);
    const refuse = (reason: AdSkipReason) =>
      Promise.resolve({ result: { shown: false, reason }, outcome: null });

    if (!this.capabilities.ads.includes(kind)) return refuse("unsupported");
    const sdk = this.#sdk;
    // No SDK (never loaded, init failed, not configured): the portal did not turn ads off,
    // it is simply not there — "not-ready", the contract's name for it.
    if (!sdk) return refuse("not-ready");
    // An SDK without a Game ID: this build has ads switched off.
    if (!this.#config?.gameId) return refuse("disabled");
    // One break at a time — including an ad that opened after its request was given up on.
    if (this.#adInProgress || this.#lateAdOnScreen) return refuse("busy");

    this.#adInProgress = true;
    const placement: Y8Placement = kind === "rewarded" ? "reward" : "next";
    const breakName = `wgf-${kind}-${++this.#breakSequence}`;

    return new Promise((resolve) => {
      // Normal path.
      let settled = false;
      let started = false;
      let ended = false;
      let outcome: Outcome = null;
      let startTimer: unknown;
      let durationTimer: unknown;
      let graceTimer: unknown;
      // Late path: callbacks arriving after the request was given up on.
      let lateStarted = false;
      let lateEnded = false;
      let lateRewarded = false;
      let lateTimer: unknown;

      const clearTimers = (): void => {
        for (const timer of [startTimer, durationTimer, graceTimer]) {
          if (timer !== undefined) this.#timers.clearTimeout(timer);
        }
        startTimer = durationTimer = graceTimer = undefined;
      };

      const endOnScreen = (): void => {
        if (!started || ended) return;
        ended = true;
        this.#endAd(kind);
      };

      const finish = (info: Y8BreakInfo | null, fallback: AdSkipReason): void => {
        if (settled) return;
        settled = true;
        clearTimers();
        this.#adInProgress = false;
        endOnScreen();
        const status = info?.breakStatus;
        const appeared = started || status === "viewed" || status === "dismissed";
        // A reward break that reported "viewed" without adViewed still means watched through.
        if (outcome === null && status === "viewed") outcome = "viewed";
        if (outcome === null && status === "dismissed") outcome = "dismissed";
        if (appeared) this.#usage.recordAdShown(kind);
        resolve({
          result: appeared
            ? { shown: true }
            : { shown: false, reason: skipReason(status, fallback) },
          outcome: appeared ? outcome : null,
        });
      };

      const endLate = (): void => {
        if (!lateStarted || lateEnded) return;
        lateEnded = true;
        if (lateTimer !== undefined) this.#timers.clearTimeout(lateTimer);
        this.#lateAdOnScreen = false;
        this.#endAd(kind);
      };

      const callbacks = {
        beforeAd: () => {
          if (settled) {
            // The request was given up on, and now an ad is on screen after all. It still has
            // sound, so the game gets its own ad:start/ad:end pair to mute for it.
            if (lateStarted) return;
            lateStarted = true;
            this.#lateAdOnScreen = true;
            this.#startAd(kind);
            // Bounded like the normal path: a late ad that never reports afterAd must not
            // hold the foreground, and block every later break, for good.
            lateTimer = this.#timers.setTimeout(endLate, this.#options.adMaxDurationMs ?? 180_000);
            return;
          }
          if (started) return;
          started = true;
          if (startTimer !== undefined) this.#timers.clearTimeout(startTimer);
          startTimer = undefined;
          this.#startAd(kind);
          hooks?.onStart?.();
          durationTimer = this.#timers.setTimeout(
            () => finish(null, "error"),
            this.#options.adMaxDurationMs ?? 180_000,
          );
        },
        afterAd: () => {
          if (settled) return endLate();
          if (!started || ended) return;
          endOnScreen();
          // adBreakDone normally follows at once; do not wait on it forever.
          if (durationTimer !== undefined) this.#timers.clearTimeout(durationTimer);
          durationTimer = undefined;
          graceTimer = this.#timers.setTimeout(
            () => finish(null, "error"),
            this.#options.adBreakDoneGraceMs ?? 2_000,
          );
        },
        adBreakDone: (info: Y8BreakInfo) => {
          if (settled) return endLate();
          finish(info ?? null, "error");
        },
      };

      const rewardCallbacks =
        kind === "rewarded"
          ? {
              // The player already chose to watch: showRewarded() is that choice. Show it.
              beforeReward: (showAdFn: () => void) => {
                if (settled) return;
                try {
                  showAdFn();
                } catch (error) {
                  console.warn(`Y8 showAdFn failed: ${describeY8Error(error)}`);
                }
              },
              adViewed: () => {
                if (settled) {
                  // Owed exactly once, and only for an ad that was actually on screen.
                  if (lateStarted && !lateRewarded) {
                    lateRewarded = true;
                    this.#usage.recordAdShown(kind);
                    this.#events.emit("ad:late-reward", { kind });
                  }
                  return;
                }
                // The first of adViewed / adDismissed decides; a second is a duplicate.
                outcome ??= "viewed";
              },
              adDismissed: () => {
                if (settled) return;
                outcome ??= "dismissed";
              },
            }
          : {};

      startTimer = this.#timers.setTimeout(
        () => finish(null, "error"),
        this.#options.adStartTimeoutMs ?? 15_000,
      );

      try {
        const pending = sdk.showAd({
          type: placement,
          name: breakName,
          ...callbacks,
          ...rewardCallbacks,
        });
        // showAd resolves once the break is queued, not when it ends; it rejects when ads
        // are not initialized or the ad script failed. Only a rejection before any ad
        // appeared ends the request — after beforeAd the callbacks own the outcome.
        if (pending && typeof pending.then === "function") {
          pending.then(undefined, (error: unknown) => {
            if (started) return;
            console.warn(`Y8 showAd failed: ${describeY8Error(error)}`);
            finish(null, "error");
          });
        }
      } catch (error) {
        console.warn(`Y8 showAd failed: ${describeY8Error(error)}`);
        finish(null, "error");
      }
    });
  }

  // The foreground is handed back BEFORE ad:end, so a listener resuming on ad:end finds the
  // game no longer held by the portal. Same convention as the Poki and CrazyGames adapters.
  //
  // Counted, not flagged: an ad that opened after its request was given up on can overlap the
  // next request's ad, and the first to close must not hand the foreground back while the
  // other is still on screen. Every ad gets its own ad:start/ad:end; the foreground is lost
  // when the first opens and regained when the last closes.
  #startAd(kind: AdKind): void {
    this.#adsOnScreen += 1;
    if (this.#foreground) {
      this.#foreground = false;
      this.#events.emit("foreground:lost", undefined);
    }
    this.#events.emit("ad:start", { kind });
  }

  #endAd(kind: AdKind): void {
    this.#adsOnScreen = Math.max(0, this.#adsOnScreen - 1);
    if (this.#adsOnScreen === 0 && !this.#foreground) {
      this.#foreground = true;
      this.#events.emit("foreground:gained", undefined);
    }
    this.#events.emit("ad:end", { kind });
  }
}

/**
 * Why a break showed nothing. "Only viewed and dismissed mean an ad appeared. Treat every
 * other value the same way — carry on with the game." The contract still says why, so a
 * game can word its message ("try again later" vs "too soon").
 */
function skipReason(status: string | undefined, fallback: AdSkipReason): AdSkipReason {
  switch (status) {
    case "frequencyCapped":
      return "too-soon";
    case "noAdPreloaded":
    case "notReady":
    case "timeout":
    case "ignored":
      return "not-ready";
    case "error":
    case "other":
      return "error";
    default:
      return fallback;
  }
}
