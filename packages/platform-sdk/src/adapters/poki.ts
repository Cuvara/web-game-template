// Poki — https://developers.poki.com/
//
// The adapter is written against Poki's current HTML5 SDK documentation
// (https://developers.poki.com/guide/sdk-html5) and its requirements page
// (https://developers.poki.com/guide/requirements-quality). Every SDK method called here is
// one those pages document; none is guessed from the loader's source.
//
// What the adapter guarantees, whatever the game does:
//
//   - gameLoadingFinished is sent once, before any gameplay event.
//   - gameplayStart/gameplayStop are never sent twice in a row and never during an ad.
//   - an ad break that interrupts running gameplay is preceded by gameplayStop.
//   - no ad ever throws, and none hangs the game when the SDK is blocked.
//
// What it deliberately does not do:
//
//   - call gameplayStart on the game's behalf. Poki's rule is that it fires on the first
//     player input, not on load, and only the game knows when that is.
//   - rate-limit commercial breaks. "Don't implement internal ad timers; rely on Poki's
//     system" — Poki decides whether a commercialBreak shows anything.
//
// The SDK is Poki's own script from Poki's CDN. It is the one external request a Poki build
// makes, and it is loaded only by this adapter, only when a build targets Poki.

import { AdPolicy } from "../ad-policy.js";
import { PlatformEmitter } from "../emitter.js";
import { GameplayLifecycle, type RejectedCall } from "../lifecycle.js";
import { LocalStorageBackend } from "../storage.js";
import { UsageRecorder, type PlatformUsage } from "../usage.js";
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

/** The documented loader. Poki serves the current SDK version behind it. */
export const POKI_SDK_URL = "https://game-cdn.poki.com/scripts/v2/poki-sdk.js";

export const POKI_CAPABILITIES: PlatformCapabilities = {
  ads: ["interstitial", "rewarded"],
  iap: false,
  cloudSaves: false,
  leaderboards: false,
  achievements: false,
  auth: "none",
  analytics: "platform-provided",
  loadingApi: "required",
  // Poki's requirements say not to implement internal ad timers: the SDK decides whether a
  // commercialBreak plays. A local minimum interval would suppress breaks Poki wanted.
  interstitialMinIntervalS: null,
  // Poki has no pause or visibility API; the game reports gameplayStop itself when it
  // pauses, a hidden tab included.
  gameplayStopOnHidden: true,
};

/** The subset of window.PokiSDK this adapter uses — every member is documented by Poki. */
export interface PokiSdk {
  init(): Promise<unknown>;
  gameLoadingFinished(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  commercialBreak(onStart?: () => void): Promise<unknown>;
  rewardedBreak(onStart?: () => void): Promise<boolean>;
}

/** Resolves the SDK, or null when it cannot be loaded (offline, ad blocker, CSP). */
export type PokiSdkLoader = () => Promise<PokiSdk | null>;

declare global {
  interface Window {
    PokiSDK?: PokiSdk;
  }
}

/** Injects Poki's loader script once and resolves window.PokiSDK when it has run. */
export function loadPokiSdkScript(url: string = POKI_SDK_URL): Promise<PokiSdk | null> {
  if (typeof document === "undefined") return Promise.resolve(null);
  if (window.PokiSDK) return Promise.resolve(window.PokiSDK);
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${url}"]`);
  if (existing) {
    // A synchronous <head> tag, as Poki documents it, has already run by the time any
    // module executes; no SDK means it was blocked, and asking again only adds a second
    // failed request. An async, deferred or module tag may still be loading: wait for it.
    // The adapter's init deadline bounds the wait.
    const pending = existing.async || existing.defer || existing.type === "module";
    if (!pending) return Promise.resolve(null);
    return new Promise((resolve) => {
      existing.addEventListener("load", () => resolve(window.PokiSDK ?? null), { once: true });
      existing.addEventListener("error", () => resolve(null), { once: true });
    });
  }

  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.onload = () => resolve(window.PokiSDK ?? null);
    // An ad blocker blocking the loader lands here. The game must stay playable, so this
    // resolves rather than rejects and the adapter carries on without an SDK.
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
}

export interface PokiOptions {
  /** Storage namespace. Use the game id. */
  readonly namespace: string;
  /** How to obtain the SDK. Defaults to injecting Poki's loader script. */
  readonly loadSdk?: PokiSdkLoader;
  /**
   * How long initialize() waits for PokiSDK.init() before continuing without ads. Poki's
   * loader queues calls until its core script arrives; if a blocker stops that script, the
   * queue never drains and init never settles. The game must boot anyway.
   */
  readonly initTimeoutMs?: number;
  /**
   * How long #adBreak waits for commercialBreak/rewardedBreak to resolve before giving up
   * and reporting no ad. A stuck SDK or a lost callback would otherwise leave the game
   * paused and muted forever (withAdBreak only restores state once the ad promise settles).
   * The default is generous: a rewarded ad legitimately runs 15-30s+, so the deadline must
   * outlast a real ad rather than abort one. See DEFAULT_AD_BREAK_TIMEOUT_MS.
   */
  readonly adBreakTimeoutMs?: number;
  /**
   * How long an ad that starts only after its call already gave up (a late onStart) may hold
   * the foreground before the adapter hands it back. Such an ad is announced with its own
   * ad:start, and the ad:end that pairs it normally comes when Poki's promise settles; this
   * bounds the case where that promise never does. Defaults to 180s, as on Y8.
   */
  readonly adMaxDurationMs?: number;
  /** Replaces setTimeout for the init and ad deadlines. Tests inject a controllable one. */
  readonly setTimeout?: (callback: () => void, ms: number) => unknown;
  /**
   * Cancels a handle `setTimeout` returned. Defaults to the global clearTimeout, or to doing
   * nothing when a custom `setTimeout` is injected without one (its handles are opaque).
   */
  readonly clearTimeout?: (handle: unknown) => void;
  /** Replaces localStorage-backed storage. */
  readonly storage?: PlatformStorage;
  /** Receives every lifecycle call the adapter refused to forward. Defaults to nothing. */
  readonly onRejected?: (rejected: RejectedCall) => void;
}

/**
 * Calls the adapter made, in order. Lifecycle events are recorded even when the SDK could
 * not be loaded, so the sequence the game produced is visible either way.
 */
export type PokiSdkCall =
  | "init"
  | "gameLoadingFinished"
  | "gameplayStart"
  | "gameplayStop"
  | "commercialBreak"
  | "rewardedBreak";

export type PokiSdkState = "not-initialized" | "loading" | "ready" | "unavailable";

// Poki: "Players tend to move to another game if loading takes more than 10 seconds." The
// deadline runs alongside the game's own loading, not before it, and must leave room for it.
const DEFAULT_INIT_TIMEOUT_MS = 5_000;

// A rewarded ad can legitimately run 30 seconds, and a commercial break plus its own SDK
// overhead can approach that too. 60s is comfortably past any real ad, so the deadline only
// ever fires on a genuinely stuck SDK or a callback Poki never delivered — never on a break
// that is actually playing. When it fires the game resumes as a no-ad; a real ad is left to
// finish on its own terms.
const DEFAULT_AD_BREAK_TIMEOUT_MS = 60_000;

// A late-started ad (onStart after the deadline) gets its own ad:start/ad:end pair. Its end
// normally comes from Poki's promise; this caps the wait if that never settles, matching the
// 180s Y8 uses for the same situation.
const DEFAULT_AD_MAX_DURATION_MS = 180_000;

export class PokiPlatform implements Platform {
  readonly id = "poki";
  readonly capabilities = POKI_CAPABILITIES;
  readonly storage: PlatformStorage;
  /**
   * Poki's HTML5 documentation defines no language call, so the adapter does not guess one;
   * the game follows the browser.
   */
  readonly language = null;
  readonly environment: PlatformEnvironment = UNKNOWN_ENVIRONMENT;
  readonly settings: PlatformSettings = DEFAULT_SETTINGS;

  readonly #ads = new AdPolicy(POKI_CAPABILITIES);
  readonly #events = new PlatformEmitter();
  #foreground = true;
  readonly #usage = new UsageRecorder();
  readonly #lifecycle: GameplayLifecycle;
  readonly #loadSdk: PokiSdkLoader;
  readonly #initTimeoutMs: number;
  readonly #adBreakTimeoutMs: number;
  readonly #adMaxDurationMs: number;
  readonly #setTimeout: (callback: () => void, ms: number) => unknown;
  readonly #clearTimeout: (handle: unknown) => void;
  readonly #calls: PokiSdkCall[] = [];

  #sdk: PokiSdk | null = null;
  #state: PokiSdkState = "not-initialized";
  #initializing: Promise<void> | null = null;
  #loadingFraction = 0;
  // init() rejected — Poki's documented symptom of an ad blocker. The game still runs, and
  // no ad can play; a rewarded offer must not be shown.
  #initRejected = false;
  // An ad that started after its call had already resolved is still on screen. It holds the
  // one-break-at-a-time slot until its ad:end, as on Y8.
  #lateAdOnScreen = false;

  constructor(options: PokiOptions) {
    this.storage = options.storage ?? new LocalStorageBackend(options.namespace);
    this.#loadSdk = options.loadSdk ?? (() => loadPokiSdkScript());
    this.#initTimeoutMs = options.initTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS;
    this.#adBreakTimeoutMs = options.adBreakTimeoutMs ?? DEFAULT_AD_BREAK_TIMEOUT_MS;
    this.#adMaxDurationMs = options.adMaxDurationMs ?? DEFAULT_AD_MAX_DURATION_MS;
    this.#setTimeout = options.setTimeout ?? ((callback, ms) => setTimeout(callback, ms));
    this.#clearTimeout =
      options.clearTimeout ??
      (options.setTimeout
        ? () => {}
        : (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    // Silent by default: a production build must not log (Poki asks for a clean build).
    // Refused calls stay readable through `rejectedCalls`.
    this.#lifecycle = new GameplayLifecycle(options.onRejected);
  }

  get usage(): PlatformUsage {
    return this.#usage.snapshot();
  }

  /** Calls made to the SDK (or that would have been, without one), oldest first. */
  get sdkCalls(): readonly PokiSdkCall[] {
    return [...this.#calls];
  }

  /** Lifecycle calls the game made that were not forwarded, and why. */
  get rejectedCalls(): readonly RejectedCall[] {
    return this.#lifecycle.rejected;
  }

  get sdkState(): PokiSdkState {
    return this.#state;
  }

  get loadingFraction(): number {
    return this.#loadingFraction;
  }

  get gameplayActive(): boolean {
    return this.#lifecycle.playing;
  }

  /** False while a Poki ad is on screen. */
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
    if (this.#initRejected) return "adblock";
    return this.#sdk && this.#state === "ready" ? "available" : "disabled";
  }

  /**
   * Always null. Poki's User Accounts (login, getUser, cloud sync) exist but are enabled per
   * title by Poki and throw when they are not; this adapter does not use them.
   */
  getUser(): Promise<PlatformUser | null> {
    return Promise.resolve(null);
  }

  initialize(): Promise<void> {
    this.#initializing ??= this.#initialize();
    return this.#initializing;
  }

  async #initialize(): Promise<void> {
    this.#state = "loading";
    const connected = this.#connect();
    let timer: unknown;
    const deadline = new Promise<"timeout">((resolve) => {
      timer = this.#setTimeout(() => resolve("timeout"), this.#initTimeoutMs);
    });
    const outcome = await Promise.race([connected, deadline]);
    // A connect that won the race leaves no timer behind to fire into a settled race.
    this.#clearTimeout(timer);
    if (outcome === "timeout" && this.#state === "loading") {
      // Boot without ads. #connect still finishes in the background if it can.
      this.#state = "unavailable";
    }
  }

  /** Load the SDK and init it. True once the SDK is usable. */
  async #connect(): Promise<boolean> {
    let sdk: PokiSdk | null = null;
    try {
      sdk = await this.#loadSdk();
    } catch {
      sdk = null;
    }
    if (!sdk) {
      this.#state = "unavailable";
      return false;
    }

    this.#calls.push("init");
    try {
      await sdk.init();
    } catch {
      this.#initRejected = true;
      // Poki's documented pattern: `PokiSDK.init().then(...).catch(() => { load game
      // anyway })`. A rejection — typically an ad blocker — still leaves an SDK whose ad
      // calls resolve without an ad. Only an init that never settles is unusable, and the
      // deadline in #initialize covers that.
    }

    this.#sdk = sdk;
    this.#state = "ready";
    // Connected after the deadline: the game has moved on without the SDK. Tell it where
    // the game is now, so it does not see gameplay events without a loading-finished.
    if (this.#lifecycle.loaded) sdk.gameLoadingFinished();
    if (this.#lifecycle.playing) sdk.gameplayStart();
    return true;
  }

  reportLoadingProgress(fraction: number): void {
    // Poki's current HTML5 documentation defines no progress call — only
    // gameLoadingFinished — so progress is recorded locally and not forwarded.
    this.#loadingFraction = Math.min(Math.max(fraction, 0), 1);
    this.#usage.recordLoadingProgress();
  }

  signalReady(): Promise<void> {
    this.#loadingFraction = 1;
    this.#usage.recordSignalReady();
    if (this.#lifecycle.loadingFinished()) this.#send("gameLoadingFinished");
    return Promise.resolve();
  }

  gameplayStart(): void {
    if (this.#lifecycle.start()) this.#send("gameplayStart");
  }

  gameplayStop(): void {
    if (this.#lifecycle.stop()) this.#send("gameplayStop");
  }

  async showInterstitial(hooks?: AdHooks): Promise<AdResult> {
    const outcome = await this.#adBreak("interstitial", hooks);
    return outcome.shown ? { shown: true } : { shown: false, reason: outcome.reason };
  }

  async showRewarded(hooks?: AdHooks): Promise<RewardedResult> {
    const outcome = await this.#adBreak("rewarded", hooks);
    if (outcome.shown || outcome.rewarded) {
      return { shown: outcome.shown, rewarded: outcome.rewarded };
    }
    return { shown: false, rewarded: false, reason: outcome.reason };
  }

  async #adBreak(
    kind: AdKind,
    hooks: AdHooks | undefined,
  ): Promise<{ shown: boolean; rewarded: boolean; reason: AdSkipReason }> {
    this.#usage.recordAdRequested(kind);

    const refused = this.#ads.check(kind);
    if (refused) return { shown: false, rewarded: false, reason: refused };

    // A late-started ad from an earlier call is still on screen: Poki runs one break at a time.
    if (this.#lateAdOnScreen) return { shown: false, rewarded: false, reason: "busy" };

    const call = kind === "rewarded" ? "rewardedBreak" : "commercialBreak";
    const decision = this.#lifecycle.beginAd(call);
    if (!decision.allowed) {
      const reason = decision.reason === "during-ad" ? "busy" : "not-ready";
      return { shown: false, rewarded: false, reason };
    }

    let deadlineTimer: unknown;
    try {
      if (decision.stopFirst) this.#send("gameplayStop");

      const sdk = this.#sdk;
      if (!sdk || this.#state !== "ready") {
        return { shown: false, rewarded: false, reason: "not-ready" };
      }

      let started = false;
      // `settled` makes the race one-shot; see the deadline below.
      let settled = false;
      // Late path: an onStart that arrives after the deadline already resolved the call.
      let lateStarted = false;
      let lateEnded = false;
      let lateTimer: unknown;

      // Closes a late-started ad exactly once — on Poki's promise settling, or on the cap.
      // Only a completed rewarded break (Poki's own `true`) owes the reward, announced as
      // ad:late-reward because the call already resolved rewarded:false.
      const endLate = (rewarded: boolean): void => {
        if (!lateStarted || lateEnded) return;
        lateEnded = true;
        this.#clearTimeout(lateTimer);
        this.#lateAdOnScreen = false;
        if (rewarded && kind === "rewarded") {
          this.#played(kind);
          this.#events.emit("ad:late-reward", { kind });
        }
        this.#giveBackForeground(kind);
      };

      const onStart = (): void => {
        if (started || lateStarted) return;
        if (settled) {
          // The call gave up and the game resumed, and now an ad is on screen after all. It
          // still has sound, so it gets its own ad:start — and, unlike before, its own ad:end,
          // or the game would stay paused and muted behind a foreground that never returns.
          lateStarted = true;
          this.#lateAdOnScreen = true;
          this.#takeForeground(kind);
          lateTimer = this.#setTimeout(() => endLate(false), this.#adMaxDurationMs);
          return;
        }
        started = true;
        this.#takeForeground(kind);
        hooks?.onStart?.();
      };

      this.#send(call);
      // Bound the break the way #initialize bounds init: race the SDK's promise against a
      // deadline. A Poki break promise can fail to settle — a stuck SDK, or an onStart that
      // fired but whose settling callback was lost — and without this the game stays paused
      // and muted forever, because the finally below (and bind.ts's withAdBreak, which owns
      // the pause/mute) only restore state once this method returns. On the deadline the
      // adapter reports no ad, so the game resumes and unmutes; a genuine break that is truly
      // still playing would have to run past the very generous timeout to hit this.
      //
      // `settled` makes the race one-shot. The break promise below always carries its own
      // handlers, so a genuine Poki result that arrives AFTER the deadline resolves/rejects
      // that inner promise harmlessly and is dropped rather than re-granting or resolving a
      // second time. The one exception is a break whose ad only STARTED after the deadline:
      // its settlement is that ad's end (endLate), and a `true` from it is a reward Poki
      // confirmed, owed as ad:late-reward. A break whose ad started in time and outran the
      // deadline already had its ad:end in the finally; its late reward is forfeited.
      const deadline = new Promise<"timeout">((resolve) => {
        deadlineTimer = this.#setTimeout(() => resolve("timeout"), this.#adBreakTimeoutMs);
      });
      try {
        if (kind === "rewarded") {
          const rewarded = sdk.rewardedBreak(onStart).then(
            (r) => {
              if (settled) endLate(r === true);
              return r === true;
            },
            () => {
              if (!settled) throw new Error("rewardedBreak failed");
              endLate(false); // Late rejection after the deadline: never a reward.
              return false;
            },
          );
          const result = await Promise.race([rewarded, deadline]);
          if (result === "timeout") {
            settled = true; // Close the race so a late SDK settlement is dropped, not thrown.
            return { shown: false, rewarded: false, reason: "not-ready" };
          }
          settled = true;
          if (started) this.#played(kind);
          // Grant on Poki's own success flag only. Under an ad blocker it is false, and
          // Poki's guidelines say no reward is given then.
          return { shown: started, rewarded: result, reason: this.#noAdReason() };
        }
        const commercial = sdk.commercialBreak(onStart).then(
          () => {
            if (settled) endLate(false);
          },
          () => {
            if (!settled) throw new Error("commercialBreak failed");
            endLate(false); // Late rejection after the deadline: drop it.
          },
        );
        const result = await Promise.race([commercial, deadline]);
        if (result === "timeout") {
          settled = true; // Close the race so a late SDK settlement is dropped, not thrown.
          return { shown: false, rewarded: false, reason: "not-ready" };
        }
        settled = true;
        if (started) this.#played(kind);
        return { shown: started, rewarded: false, reason: this.#noAdReason() };
      } catch {
        settled = true;
        return { shown: started, rewarded: false, reason: "error" };
      }
    } finally {
      this.#clearTimeout(deadlineTimer);
      this.#lifecycle.endAd();
      this.#giveBackForeground(kind);
    }
  }

  #takeForeground(kind: AdKind): void {
    this.#foreground = false;
    this.#events.emit("foreground:lost", undefined);
    this.#events.emit("ad:start", { kind });
  }

  /** Pairs a #takeForeground. Does nothing when no ad took the foreground. */
  #giveBackForeground(kind: AdKind): void {
    if (this.#foreground) return;
    this.#foreground = true;
    this.#events.emit("ad:end", { kind });
    this.#events.emit("foreground:gained", undefined);
  }

  /** Why a break that resolved without an ad showed none. */
  #noAdReason(): AdSkipReason {
    return this.#initRejected ? "adblock" : "not-ready";
  }

  #played(kind: AdKind): void {
    this.#usage.recordAdShown(kind);
    this.#ads.record(kind);
  }

  /** Records a call and forwards it when the SDK is present. Ad breaks are invoked by #adBreak. */
  #send(call: PokiSdkCall): void {
    this.#calls.push(call);
    const sdk = this.#sdk;
    if (call === "gameLoadingFinished") sdk?.gameLoadingFinished();
    else if (call === "gameplayStart") sdk?.gameplayStart();
    else if (call === "gameplayStop") sdk?.gameplayStop();
  }
}
