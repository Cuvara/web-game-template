// GameDistribution — the adapter between the platform contract and the GD HTML5 SDK.
//
// Written against https://github.com/GameDistribution/GD-HTML5 (README and wiki) and the
// Developer Guidelines (https://static.gamedistribution.com/developer/developers-guidelines.html).
// ./sdk.ts lists the page behind every SDK member used; docs/platforms/gamedistribution.md
// holds the full audit. Where the docs are silent the adapter assumes the least it can and
// says so here, rather than reading behaviour out of the minified SDK and depending on it.
//
// What the SDK offers, and where it lands:
//
//   GD_OPTIONS.gameId, the loader snippet ................... initialize()
//   SDK_READY / SDK_ERROR ................................... initialize(), sdkState
//   showAd("interstitial") — pre-roll and mid-rolls ......... showInterstitial()
//   showAd("rewarded") + SDK_REWARDED_WATCH_COMPLETE ........ showRewarded()
//   preloadAd("rewarded") — "Any Rewarded ad is not
//   available" when it rejects .............................. adAvailability("rewarded")
//   SDK_GAME_PAUSE — "pause AND mute your game" ............. "foreground:lost" (+ "ad:start"
//                                                              when an ad this adapter asked
//                                                              for is the reason)
//   SDK_GAME_START — "resume your game" ..................... "foreground:gained" (+ "ad:end")
//
// What the SDK does not have, so the contract is served locally: no loading or game-ready
// call, no gameplay start/stop, no storage, no user, no language. Those calls are counted
// for release validation and go nowhere.
//
// Rules the adapter holds whatever the SDK or the game does:
//
//   - A reward is granted only on SDK_REWARDED_WATCH_COMPLETE received while that rewarded
//     request is open. Never on a resolved showAd promise, never on SDK_GAME_START, never
//     twice for one request. One that arrives after the request already answered
//     `rewarded: false` is announced once as "ad:late-reward"; the game decides.
//   - Every request resolves exactly once and never rejects.
//   - The game is never left paused by an ad: an ad that never starts is given up after
//     adStartTimeoutMs, and one that started but never hands back (no SDK_GAME_START, no
//     settled promise) after adMaxDurationMs. A pause the portal raises by itself (its own
//     pre-roll splash, which waits for the player's click) has no deadline: the portal
//     legitimately holds the screen until the player acts.
//   - Duplicate SDK_READY, SDK_GAME_PAUSE and SDK_GAME_START are idempotent; the game sees
//     each transition once.
//
// No local interstitial interval: "we regulate the ad-interval through the SDK", and "you
// can call the gdsdk.showAd(); method as often as you want". The SDK refuses a mid-roll that
// comes too soon, and the adapter reports that refusal as "too-soon".

import { AdPolicy } from "../../ad-policy.js";
import { PlatformEmitter } from "../../emitter.js";
import { LocalStorageBackend } from "../../storage.js";
import { UsageRecorder, type PlatformUsage } from "../../usage.js";
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
} from "../../types.js";
import { realTimers, type Timers } from "../yandex-storage.js";
import {
  GAMEDISTRIBUTION_GAME_ID,
  GAMEDISTRIBUTION_PLACEHOLDER_GAME_ID,
  currentHosting,
  loadGameDistributionSdk,
  type GameDistributionAdType,
  type GameDistributionEvent,
  type GameDistributionHosting,
  type GameDistributionSdk,
  type GameDistributionSdkLoader,
} from "./sdk.js";

export const GAMEDISTRIBUTION_CAPABILITIES: PlatformCapabilities = {
  // Pre-roll and mid-roll are "mandatory for all games"; rewarded is optional and needs the
  // rewarded flag set for the game in the developer panel. Display ads exist but the
  // contract has no banner call, and showBanner() is deprecated.
  ads: ["interstitial", "rewarded"],
  iap: false,
  cloudSaves: false,
  leaderboards: false,
  achievements: false,
  auth: "none",
  // Guidelines §7: no analytics other than GameDistribution's own.
  analytics: "platform-provided",
  // The SDK has no loading or game-ready call.
  loadingApi: "none",
  // The SDK enforces the mid-roll interval itself (default two minutes, set per game).
  interstitialMinIntervalS: null,
  // The SDK raises no pause of its own for a hidden tab; the game pauses itself.
  gameplayStopOnHidden: true,
};

/** Per-title configuration, from the game.config.yaml platform entry. */
export interface GameDistributionConfig {
  /** The 32-hex Game ID from the GameDistribution developer panel. Not a secret. */
  readonly gameId: string;
}

export interface GameDistributionPlatformOptions extends GameDistributionConfig {
  /** Storage namespace. Use the game id from game.config.yaml. */
  readonly namespace: string;
  /** How to obtain the SDK. Defaults to the documented snippet. Tests inject a fake. */
  readonly loadSdk?: GameDistributionSdkLoader;
  /** How long initialize() waits for SDK_READY before the game boots without ads. */
  readonly initTimeoutMs?: number;
  /**
   * How long a requested ad may take to start (SDK_GAME_PAUSE) before the request answers
   * "not-ready". The request keeps listening: an ad that starts later still pauses the game.
   * Defaults: 10 s for an interstitial, 20 s for a rewarded ad ("it will request a new one
   * and show it as soon as it gathers one").
   */
  readonly adStartTimeoutMs?: number;
  /**
   * How long a started ad may hold the game without SDK_GAME_START or the showAd promise
   * settling before the adapter hands the game back. Well past any real video ad — the SDK
   * itself offers a skip after 30 s on a rewarded one — so it only fires when a hand-back
   * was lost.
   */
  readonly adMaxDurationMs?: number;
  readonly timers?: Timers;
  readonly storage?: PlatformStorage;
  /** Where the game is running. Defaults to reading window/location. */
  readonly hosting?: () => GameDistributionHosting;
}

/**
 *   not-initialized  initialize() not called yet
 *   loading          the script is loading, or loaded and SDK_READY has not arrived
 *   ready            SDK_READY arrived
 *   error            SDK_ERROR arrived before SDK_READY
 *   unavailable      the script never loaded, or SDK_READY did not arrive in time
 *
 * `error` and `unavailable` are not final: an SDK_READY that arrives late is still honoured.
 */
export type GameDistributionSdkState =
  "not-initialized" | "loading" | "ready" | "error" | "unavailable";

const DEFAULT_INIT_TIMEOUT_MS = 5_000;
const DEFAULT_INTERSTITIAL_START_TIMEOUT_MS = 10_000;
const DEFAULT_REWARDED_START_TIMEOUT_MS = 20_000;
const DEFAULT_AD_MAX_DURATION_MS = 90_000;

/** One ad request, from showAd until the SDK is done with it. */
interface AdRequest {
  readonly kind: GameDistributionAdType;
  readonly hooks: AdHooks | undefined;
  /** SDK_GAME_PAUSE arrived for it: the ad is on screen. */
  started: boolean;
  /** The screen was handed back (SDK_GAME_START, a settled flow, or the max deadline). */
  ended: boolean;
  /** SDK_REWARDED_WATCH_COMPLETE arrived for it. Set once. */
  rewarded: boolean;
  /** AD_IS_ALREADY_RUNNING arrived for it. */
  alreadyRunning: boolean;
  /** The game has its answer. */
  answered: boolean;
  /** What that answer said about the reward. */
  answeredRewarded: boolean;
  /** "ad:late-reward" was emitted for it. */
  lateRewardSent: boolean;
  timer: unknown;
  resolve: (result: RewardedResult) => void;
}

export class GameDistributionPlatform implements Platform {
  readonly id = "gamedistribution";
  readonly capabilities = GAMEDISTRIBUTION_CAPABILITIES;
  readonly storage: PlatformStorage;
  /** The SDK has no language API; `advertisementSettings.locale` is for ad text only. */
  readonly language = null;
  readonly environment: PlatformEnvironment = UNKNOWN_ENVIRONMENT;
  readonly settings: PlatformSettings = DEFAULT_SETTINGS;
  readonly gameId: string;

  readonly #loadSdk: GameDistributionSdkLoader;
  readonly #timers: Timers;
  readonly #initTimeoutMs: number;
  readonly #adStartTimeoutMs: number | undefined;
  readonly #adMaxDurationMs: number;
  readonly #hosting: () => GameDistributionHosting;
  readonly #ads = new AdPolicy(GAMEDISTRIBUTION_CAPABILITIES);
  readonly #events = new PlatformEmitter();
  readonly #usage = new UsageRecorder();
  readonly #calls: string[] = [];
  readonly #sdkEvents: string[] = [];

  #sdk: GameDistributionSdk | null = null;
  #state: GameDistributionSdkState = "not-initialized";
  #sdkError: string | null = null;
  #initializing: Promise<void> | null = null;
  #settleInit: (() => void) | null = null;
  #foreground = true;
  #gameplayActive = false;
  #loadingFraction = 0;
  #rewardedPreload: "unknown" | "available" | "unavailable" = "unknown";
  #ad: AdRequest | null = null;

  constructor(options: GameDistributionPlatformOptions) {
    this.gameId = requireGameId(options.gameId);
    this.storage = options.storage ?? new LocalStorageBackend(options.namespace);
    this.#timers = options.timers ?? realTimers;
    this.#initTimeoutMs = options.initTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS;
    this.#adStartTimeoutMs = options.adStartTimeoutMs;
    this.#adMaxDurationMs = options.adMaxDurationMs ?? DEFAULT_AD_MAX_DURATION_MS;
    this.#hosting = options.hosting ?? currentHosting;
    this.#loadSdk = options.loadSdk ?? loadGameDistributionSdk;
  }

  get usage(): PlatformUsage {
    return this.#usage.snapshot();
  }

  get sdkState(): GameDistributionSdkState {
    return this.#state;
  }

  /** The message of the SDK_ERROR that arrived before SDK_READY, if one did. */
  get sdkError(): string | null {
    return this.#sdkError;
  }

  /** Calls made to the SDK, oldest first. */
  get sdkCalls(): readonly string[] {
    return [...this.#calls];
  }

  /** Every SDK event name received, oldest first — including the ones the adapter ignores. */
  get sdkEvents(): readonly string[] {
    return [...this.#sdkEvents];
  }

  /** Self-hosting diagnostics. Read-only: the adapter never sets gd_sdk_referrer_url. */
  get hosting(): GameDistributionHosting {
    return this.#hosting();
  }

  get loadingFraction(): number {
    return this.#loadingFraction;
  }

  get gameplayActive(): boolean {
    return this.#gameplayActive;
  }

  /** False from SDK_GAME_PAUSE until SDK_GAME_START (or the adapter's own ad deadline). */
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
    if (this.#state !== "ready" || !this.#sdk) return "disabled";
    // "DO NOT FORGET TO CHECK REWARDED ADS FLAG ... Otherwise, your game is unable to
    // request rewarded ads." preloadAd is how the docs say to find out.
    if (kind === "rewarded" && this.#rewardedPreload === "unavailable") return "disabled";
    return "available";
  }

  /** Always null: the SDK has no user API the docs describe. */
  getUser(): Promise<PlatformUser | null> {
    return Promise.resolve(null);
  }

  initialize(): Promise<void> {
    this.#initializing ??= this.#initialize();
    return this.#initializing;
  }

  async #initialize(): Promise<void> {
    this.#state = "loading";
    const settled = new Promise<void>((resolve) => {
      this.#settleInit = resolve;
    });
    const deadline = this.#timers.setTimeout(() => {
      if (this.#state === "loading") this.#state = "unavailable";
      this.#finishInit();
    }, this.#initTimeoutMs);

    void this.#connect();
    await settled;
    this.#timers.clearTimeout(deadline);
  }

  async #connect(): Promise<void> {
    this.#calls.push("init");
    let sdk: GameDistributionSdk | null;
    try {
      sdk = await this.#loadSdk({ gameId: this.gameId, onEvent: this.#onEvent });
    } catch {
      sdk = null;
    }
    if (!sdk) {
      if (this.#state === "loading") this.#state = "unavailable";
      this.#finishInit();
      return;
    }
    this.#sdk = sdk;
    // SDK_READY may already have arrived while the loader resolved.
    if (this.#state === "ready") this.#onReady();
  }

  #finishInit(): void {
    const settle = this.#settleInit;
    this.#settleInit = null;
    settle?.();
  }

  readonly #onEvent = (event: GameDistributionEvent): void => {
    const name = typeof event?.name === "string" ? event.name : "";
    this.#sdkEvents.push(name);
    switch (name) {
      case "SDK_READY":
        if (this.#state === "ready") return; // A second SDK_READY changes nothing.
        this.#state = "ready";
        if (this.#sdk) this.#onReady();
        return;
      case "SDK_ERROR":
        // Before SDK_READY this is an init failure: boot without ads, but keep listening in
        // case SDK_READY still comes. After it, the SDK carries on; an ad in flight is
        // resolved by its own flow and deadlines.
        if (this.#state !== "ready") {
          this.#state = "error";
          this.#sdkError = describe(event.message);
          this.#finishInit();
        }
        return;
      case "SDK_GAME_PAUSE":
        this.#onPause();
        return;
      case "SDK_GAME_START":
        this.#onStart();
        return;
      case "SDK_REWARDED_WATCH_COMPLETE":
        this.#onReward();
        return;
      case "AD_IS_ALREADY_RUNNING":
        if (this.#ad && !this.#ad.started) this.#ad.alreadyRunning = true;
        return;
      default:
        // AD_ERROR and the IMA pass-through events: the flow they belong to still ends in
        // SDK_GAME_START and a settled promise, which is what the adapter acts on.
        return;
    }
  };

  #onReady(): void {
    this.#finishInit();
    this.#preloadRewarded();
  }

  #preloadRewarded(): void {
    const sdk = this.#sdk;
    if (!sdk) return;
    this.#calls.push("preloadAd:rewarded");
    try {
      sdk.preloadAd("rewarded").then(
        () => (this.#rewardedPreload = "available"),
        () => (this.#rewardedPreload = "unavailable"),
      );
    } catch {
      this.#rewardedPreload = "unavailable";
    }
  }

  /** SDK_GAME_PAUSE: "pause game logic / mute audio". */
  #onPause(): void {
    const ad = this.#ad;
    if (ad && !ad.started) {
      // Also an ad that starts after its request already answered "not-ready": it is on
      // screen all the same, so it takes the game and gets the same deadline.
      ad.started = true;
      this.#timers.clearTimeout(ad.timer);
      ad.timer = this.#timers.setTimeout(() => this.#endAd(ad), this.#adMaxDurationMs);
      this.#takeForeground();
      this.#events.emit("ad:start", { kind: ad.kind });
      if (!ad.answered) ad.hooks?.onStart?.();
      return;
    }
    // The portal's own pause — its pre-roll splash waits for the player's click — or a
    // repeat. No deadline: the portal holds the screen until it says otherwise.
    this.#takeForeground();
  }

  /** SDK_GAME_START: "advertisement done, resume game logic and unmute audio". */
  #onStart(): void {
    const ad = this.#ad;
    if (ad?.started && !ad.ended) {
      this.#endAd(ad);
      return;
    }
    // Also sent with no pause before it — a refused request, a skipped splash. Idempotent.
    this.#giveForeground();
  }

  /** SDK_REWARDED_WATCH_COMPLETE: "you can give reward there." */
  #onReward(): void {
    const ad = this.#ad;
    // Not attributable to an open rewarded request — a duplicate after the flow ended, or
    // an interstitial — so nothing is granted.
    if (!ad || ad.kind !== "rewarded" || ad.rewarded) return;
    ad.rewarded = true;
    if (ad.answered && !ad.answeredRewarded && !ad.lateRewardSent) {
      ad.lateRewardSent = true;
      this.#events.emit("ad:late-reward", { kind: "rewarded" });
    }
  }

  reportLoadingProgress(fraction: number): void {
    // No SDK progress call exists; counted for release validation only.
    this.#loadingFraction = Math.min(Math.max(fraction, 0), 1);
    this.#usage.recordLoadingProgress();
  }

  signalReady(): Promise<void> {
    this.#loadingFraction = 1;
    this.#usage.recordSignalReady();
    return Promise.resolve();
  }

  gameplayStart(): void {
    if (this.#gameplayActive || this.#adOnScreen()) return;
    this.#gameplayActive = true;
    this.#usage.recordGameplayStart();
  }

  gameplayStop(): void {
    if (!this.#gameplayActive) return;
    this.#gameplayActive = false;
    this.#usage.recordGameplayStop();
  }

  async showInterstitial(hooks?: AdHooks): Promise<AdResult> {
    const { shown, reason } = await this.#request("interstitial", hooks);
    return reason ? { shown, reason } : { shown };
  }

  showRewarded(hooks?: AdHooks): Promise<RewardedResult> {
    return this.#request("rewarded", hooks);
  }

  #request(kind: GameDistributionAdType, hooks: AdHooks | undefined): Promise<RewardedResult> {
    this.#usage.recordAdRequested(kind);
    const refuse = (reason: AdSkipReason): Promise<RewardedResult> =>
      Promise.resolve({ shown: false, rewarded: false, reason });

    const refused = this.#ads.check(kind);
    if (refused) return refuse(refused);
    const sdk = this.#sdk;
    if (!sdk || this.#state !== "ready") return refuse("not-ready");
    // One ad at a time, and none while the portal holds the screen (its own pre-roll).
    if (this.#adOpen() || !this.#foreground) return refuse("busy");

    return new Promise<RewardedResult>((resolve) => {
      const ad: AdRequest = {
        kind,
        hooks,
        started: false,
        ended: false,
        rewarded: false,
        alreadyRunning: false,
        answered: false,
        answeredRewarded: false,
        lateRewardSent: false,
        timer: undefined,
        resolve,
      };
      this.#ad = ad;
      if (this.gameplayActive) this.gameplayStop();

      const startTimeoutMs =
        this.#adStartTimeoutMs ??
        (kind === "rewarded"
          ? DEFAULT_REWARDED_START_TIMEOUT_MS
          : DEFAULT_INTERSTITIAL_START_TIMEOUT_MS);
      ad.timer = this.#timers.setTimeout(() => {
        // Nothing started in time. Answer; the request stays open for a late start.
        if (!ad.started) this.#answer(ad, "not-ready");
      }, startTimeoutMs);

      this.#calls.push(`showAd:${kind}`);
      let flow: Promise<unknown>;
      try {
        flow = sdk.showAd(kind);
      } catch (error) {
        flow = Promise.reject(error);
      }
      Promise.resolve(flow).then(
        () => this.#flowSettled(ad, null),
        (error: unknown) => this.#flowSettled(ad, refusalReason(error)),
      );
    });
  }

  /** The SDK's showAd promise settled: its ad flow is over. */
  #flowSettled(ad: AdRequest, reason: AdSkipReason | null): void {
    if (ad.started && !ad.ended) this.#endAd(ad);
    this.#answer(ad, reason ?? (ad.alreadyRunning ? "busy" : "not-ready"));
    this.#timers.clearTimeout(ad.timer);
    // A new request may have replaced this one after it ended; only clear our own.
    if (this.#ad === ad) this.#ad = null;
    if (ad.kind === "rewarded") this.#preloadRewarded();
  }

  /** Hand the screen back after a started ad. */
  #endAd(ad: AdRequest): void {
    if (ad.ended) return;
    ad.ended = true;
    this.#timers.clearTimeout(ad.timer);
    if (ad.started) {
      this.#events.emit("ad:end", { kind: ad.kind });
      this.#giveForeground();
    }
    this.#answer(ad, null);
  }

  /** Resolve the request, once. `reason` applies only when no ad was shown. */
  #answer(ad: AdRequest, reason: AdSkipReason | null): void {
    if (ad.answered) return;
    ad.answered = true;
    const rewarded = ad.kind === "rewarded" && ad.rewarded;
    ad.answeredRewarded = rewarded;
    if (!ad.started) {
      // Answered unshown: the slot is free for the next request; a late start retakes it.
      ad.resolve({ shown: false, rewarded: false, reason: reason ?? "not-ready" });
      return;
    }
    this.#usage.recordAdShown(ad.kind);
    this.#ads.record(ad.kind);
    ad.resolve({ shown: true, rewarded });
  }

  /** A request is waiting for its answer, or its ad is on screen. */
  #adOpen(): boolean {
    const ad = this.#ad;
    return ad !== null && (!ad.answered || this.#adOnScreen());
  }

  #adOnScreen(): boolean {
    const ad = this.#ad;
    return ad !== null && ad.started && !ad.ended;
  }

  #takeForeground(): void {
    if (!this.#foreground) return;
    this.#foreground = false;
    this.#events.emit("foreground:lost", undefined);
  }

  #giveForeground(): void {
    if (this.#foreground) return;
    this.#foreground = true;
    this.#events.emit("foreground:gained", undefined);
  }
}

/**
 * Why the SDK refused a showAd. The docs define no rejection values; these match the
 * messages GD-HTML5 1.43.58 rejects with ("The advertisement was requested too soon.",
 * "Advertisements are disabled."). Anything else is an SDK error.
 */
function refusalReason(error: unknown): AdSkipReason {
  const message = describe(error).toLowerCase();
  if (message.includes("too soon")) return "too-soon";
  if (message.includes("disabled") || message.includes("blocked")) return "disabled";
  return "error";
}

function describe(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  if (value && typeof (value as { message?: unknown }).message === "string") {
    return (value as { message: string }).message;
  }
  return String(value);
}

/** The Game ID, or a loud error: a build without a real one earns nothing. */
function requireGameId(gameId: string | undefined): string {
  const trimmed = typeof gameId === "string" ? gameId.trim() : "";
  if (!GAMEDISTRIBUTION_GAME_ID.test(trimmed)) {
    throw new Error(
      `gamedistribution needs its Game ID — 32 hex characters from the GameDistribution ` +
        `developer panel — as platforms[].game_id in game.config.yaml; got ${JSON.stringify(gameId ?? null)}`,
    );
  }
  if (trimmed.toLowerCase() === GAMEDISTRIBUTION_PLACEHOLDER_GAME_ID) {
    throw new Error(
      "gamedistribution: game_id is the SDK's built-in placeholder; with it no revenue is " +
        "reported. Use the Game ID from the developer panel.",
    );
  }
  return trimmed;
}
