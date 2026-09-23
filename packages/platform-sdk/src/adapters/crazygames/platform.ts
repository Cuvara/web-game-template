// CrazyGames — the adapter between the platform contract and the HTML5 SDK v3.
//
// Everything CrazyGames-specific a game needs goes through here; game code never touches
// `window.CrazyGames`. The requirement pages this implements, and where:
//
//   SDK init before use, awaited ............................ initialize()
//   Gameplay start on first playable state, start/stop on
//   every break, NOT on focus loss (the portal handles it) .. gameplayStart/Stop,
//                                                             capabilities.gameplayStopOnHidden
//   Loading start/stop (optional, Full Launch) .............. initialize() / signalReady()
//   Ads only through the SDK; mute on adStarted, not on
//   request; resume on adFinished or adError ................ showInterstitial/showRewarded,
//                                                             "ad:start"/"ad:end" events
//   Never reward on adError ................................. showRewarded
//   Game must work with an ad blocker, and in Basic Launch
//   where ads are disabled — no dead rewarded buttons ....... adAvailability()
//   Data module for progress, relied on fully ............... storage
//   muteAudio setting overrides in-game audio ............... settings, "settings:change"
//   Locale and device from systemInfo ....................... environment
//   Username/avatar from the user module .................... getUser()
//
// https://docs.crazygames.com/requirements/intro/ has the Basic vs Full Launch split. This
// adapter implements the Full Launch SDK integration, which is a superset of Basic.

import { AdPolicy } from "../../ad-policy.js";
import { PlatformEmitter } from "../../emitter.js";
import { LocalStorageBackend } from "../../storage.js";
import { UsageRecorder, type PlatformUsage } from "../../usage.js";
import type {
  AdAvailability,
  AdKind,
  AdResult,
  AdSkipReason,
  DeviceType,
  Platform,
  PlatformCapabilities,
  PlatformEnvironment,
  PlatformSettings,
  PlatformStorage,
  PlatformUser,
  RewardedResult,
} from "../../types.js";
import {
  isCrazyGamesError,
  loadCrazyGamesSdk,
  type CrazyGamesEnvironment,
  type CrazyGamesSdk,
  type CrazyGamesSettings,
} from "./sdk.js";
import { CrazyGamesDataStorage } from "./storage.js";

/**
 * Mirrors core/reference/platforms/crazygames.yaml at 1.0.0, with one deliberate omission:
 * the profile lists `banner`, but the platform contract has no banner call yet, so claiming
 * it here would let a game believe it can show one.
 */
export const CRAZYGAMES_CAPABILITIES: PlatformCapabilities = {
  ads: ["interstitial", "rewarded"],
  iap: false,
  cloudSaves: true,
  leaderboards: false,
  achievements: false,
  auth: "optional",
  analytics: "platform-provided",
  loadingApi: "required",
  // "max 1 every 3 minutes" — the SDK enforces this itself and answers `adCooldown`, so this
  // local check only saves a pointless request.
  interstitialMinIntervalS: 180,
  // "Don't call this event when the user switches focus or leaves the game area (we handle
  // this on our side)." — https://docs.crazygames.com/sdk/game/#gameplay-startstop
  gameplayStopOnHidden: false,
};

/**
 * What the adapter is talking to.
 *
 *   sdk          — `local` or `crazygames` environment; calls go through.
 *   disabled     — the SDK loaded on a non-CrazyGames domain. Every SDK call would throw, so
 *                  none is made and the game runs as a plain web game.
 *   unavailable  — the script never loaded (an ad blocker, offline). Same fallback.
 */
export type CrazyGamesMode = "pending" | "sdk" | "disabled" | "unavailable";

/**
 * Basic vs Full Launch, as far as the running game can tell. The SDK does not expose the
 * stage directly; the only runtime signal is the `adsDisabledBasicLaunch` ad error. `full`
 * is claimed only after an ad actually started on a CrazyGames domain.
 */
export type ObservedLaunchStage = "unknown" | "basic" | "full";

export interface CrazyGamesOptions {
  /** Storage namespace for the fallback used when the SDK is disabled or unavailable. */
  readonly namespace: string;
  /** Resolves the SDK object. Defaults to loading the official script. Tests inject one. */
  readonly loadSdk?: () => Promise<CrazyGamesSdk>;
  /**
   * An ad that has not started this long after being requested is given up on, so a lost
   * callback cannot leave the game paused for good. Once `adStarted` fires there is no
   * timeout: the ad owns the screen until the SDK says it is done.
   */
  readonly adStartTimeoutMs?: number;
  readonly now?: () => number;
}

const DEVICE_TYPES: readonly DeviceType[] = ["desktop", "tablet", "mobile"];

export class CrazyGamesPlatform implements Platform {
  readonly id = "crazygames";
  readonly capabilities = CRAZYGAMES_CAPABILITIES;
  readonly events = new PlatformEmitter();

  readonly #options: CrazyGamesOptions;
  readonly #ads: AdPolicy;
  readonly #usage = new UsageRecorder();
  readonly #fallbackStorage: LocalStorageBackend;

  #sdk: CrazyGamesSdk | null = null;
  #storage: PlatformStorage | null = null;
  #mode: CrazyGamesMode = "pending";
  #sdkEnvironment: CrazyGamesEnvironment | null = null;
  #initializing: Promise<void> | null = null;
  #settings: PlatformSettings = { muteAudio: false };
  #environment: PlatformEnvironment = { locale: null, device: null, inPortalApp: false };
  #launchStage: ObservedLaunchStage = "unknown";
  #adsDisabled = false;
  #adblock = false;
  #adInProgress = false;
  #inGameplay = false;
  #loadingStopped = false;
  #loadingFraction = 0;

  constructor(options: CrazyGamesOptions) {
    this.#options = options;
    this.#ads = new AdPolicy(CRAZYGAMES_CAPABILITIES, options.now);
    this.#fallbackStorage = new LocalStorageBackend(options.namespace);
  }

  get storage(): PlatformStorage {
    return this.#storage ?? this.#fallbackStorage;
  }

  get settings(): PlatformSettings {
    return this.#settings;
  }

  get environment(): PlatformEnvironment {
    return this.#environment;
  }

  get usage(): PlatformUsage {
    return this.#usage.snapshot();
  }

  get mode(): CrazyGamesMode {
    return this.#mode;
  }

  /** The SDK's own environment string, or null when it never initialised. */
  get sdkEnvironment(): CrazyGamesEnvironment | null {
    return this.#sdkEnvironment;
  }

  get observedLaunchStage(): ObservedLaunchStage {
    return this.#launchStage;
  }

  get loadingFraction(): number {
    return this.#loadingFraction;
  }

  get inGameplay(): boolean {
    return this.#inGameplay;
  }

  initialize(): Promise<void> {
    this.#initializing ??= this.#initialize();
    return this.#initializing;
  }

  async #initialize(): Promise<void> {
    let sdk: CrazyGamesSdk;
    try {
      sdk = await (this.#options.loadSdk ?? loadCrazyGamesSdk)();
      // "It is important to await for the initialization ... the SDK is unusable until
      // initialized." The data module also preloads saves during init.
      await sdk.init();
    } catch (error) {
      // The game must stay playable when an ad blocker stops the SDK loading.
      console.warn("CrazyGames SDK unavailable; continuing without it", error);
      this.#mode = "unavailable";
      return;
    }

    this.#sdkEnvironment = sdk.environment;
    if (sdk.environment === "disabled") {
      this.#mode = "disabled";
      return;
    }

    this.#sdk = sdk;
    this.#mode = "sdk";
    this.#storage = new CrazyGamesDataStorage(sdk);
    this.#migrateFallbackSaves(sdk);
    this.#environment = readEnvironment(sdk);
    this.#applySettings(sdk.game.settings);
    this.#safely(() =>
      sdk.game.addSettingsChangeListener((settings) => this.#applySettings(settings)),
    );
    this.#safely(() => sdk.game.loadingStart());

    // Detection takes a moment and is not needed to boot; the first rewarded offer is
    // seconds of gameplay away. Not awaited.
    sdk.ad
      .hasAdblock()
      .then((present) => {
        this.#adblock = present;
      })
      .catch(() => {});
  }

  reportLoadingProgress(fraction: number): void {
    // CrazyGames has loadingStart/loadingStop but no progress value; the fraction is kept
    // for the game's own loading bar and for the verify probe.
    this.#loadingFraction = Math.min(Math.max(fraction, 0), 1);
    this.#usage.recordLoadingProgress();
  }

  signalReady(): Promise<void> {
    this.#loadingFraction = 1;
    this.#usage.recordSignalReady();
    if (!this.#loadingStopped) {
      this.#loadingStopped = true;
      const sdk = this.#sdk;
      if (sdk) this.#safely(() => sdk.game.loadingStop());
    }
    return Promise.resolve();
  }

  // Deduplicated: the portal wants transitions, and a game that reports `start` from two
  // places (resume after an ad, resume after a menu) should not double-count a session.
  gameplayStart(): void {
    if (this.#inGameplay) return;
    this.#inGameplay = true;
    this.#usage.recordGameplayStart();
    const sdk = this.#sdk;
    if (sdk) this.#safely(() => sdk.game.gameplayStart());
  }

  gameplayStop(): void {
    if (!this.#inGameplay) return;
    this.#inGameplay = false;
    this.#usage.recordGameplayStop();
    const sdk = this.#sdk;
    if (sdk) this.#safely(() => sdk.game.gameplayStop());
  }

  adAvailability(kind: AdKind): AdAvailability {
    if (!this.capabilities.ads.includes(kind)) return "unsupported";
    if (!this.#sdk || this.#adsDisabled) return "disabled";
    if (this.#adblock) return "adblock";
    return "available";
  }

  async showInterstitial(): Promise<AdResult> {
    return this.#requestAd("interstitial");
  }

  async showRewarded(): Promise<RewardedResult> {
    const result = await this.#requestAd("rewarded");
    // Rewarded only on adFinished. adError — unfilled, adblock, cooldown, Basic Launch —
    // never rewards: "When our rewarded ad returns with an adError callback, do NOT reward".
    return { ...result, rewarded: result.shown };
  }

  async getUser(): Promise<PlatformUser | null> {
    const sdk = this.#sdk;
    if (!sdk) return null;
    try {
      if (!sdk.user.isUserAccountAvailable) return null;
      const user = await sdk.user.getUser();
      if (!user) return null;
      return { username: user.username, avatarUrl: user.profilePictureUrl ?? null };
    } catch {
      return null;
    }
  }

  #requestAd(kind: "interstitial" | "rewarded"): Promise<AdResult> {
    this.#usage.recordAdRequested(kind);

    const availability = this.adAvailability(kind);
    if (availability !== "available") return Promise.resolve(skipped(availability));

    const policy = this.#ads.check(kind);
    if (policy) return Promise.resolve({ shown: false, reason: policy });

    // The SDK runs one ad at a time; a second request while one is open is the game's bug,
    // not a reason to queue a chained ad.
    if (this.#adInProgress) return Promise.resolve({ shown: false, reason: "not-ready" });

    const sdk = this.#sdk;
    if (!sdk) return Promise.resolve({ shown: false, reason: "disabled" });

    this.#adInProgress = true;
    return new Promise<AdResult>((resolve) => {
      let started = false;
      let settled = false;

      const finish = (result: AdResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        this.#adInProgress = false;
        if (started) this.events.emit("ad:end", { kind });
        resolve(result);
      };

      const watchdog = setTimeout(() => {
        if (!started) finish({ shown: false, reason: "error" });
      }, this.#options.adStartTimeoutMs ?? 30_000);

      // An ad that starts after the watchdog gave up still has sound. It gets its own
      // ad:start/ad:end pair so the game mutes for it, even though the request has resolved.
      let lateStarted = false;
      const endLate = (): void => {
        if (!lateStarted) return;
        lateStarted = false;
        this.events.emit("ad:end", { kind });
      };

      try {
        sdk.ad.requestAd(kind === "interstitial" ? "midgame" : "rewarded", {
          adStarted: () => {
            if (started || lateStarted) return;
            if (sdk.environment === "crazygames") this.#launchStage = "full";
            if (settled) lateStarted = true;
            else started = true;
            this.events.emit("ad:start", { kind });
          },
          adFinished: () => {
            if (settled) return endLate();
            this.#ads.record(kind);
            this.#usage.recordAdShown(kind);
            finish({ shown: true });
          },
          adError: (error) => {
            if (settled) return endLate();
            finish({ shown: false, reason: this.#adErrorReason(error) });
          },
        });
      } catch (error) {
        finish({ shown: false, reason: this.#adErrorReason(error) });
      }
    });
  }

  #adErrorReason(error: unknown): AdSkipReason {
    const code = isCrazyGamesError(error) ? error.code : "other";
    switch (code) {
      case "adsDisabledBasicLaunch":
        this.#adsDisabled = true;
        this.#launchStage = "basic";
        return "disabled";
      case "adblock":
        this.#adblock = true;
        return "adblock";
      case "unfilled":
        return "not-ready";
      case "adCooldown":
        return "too-soon";
      default:
        return "error";
    }
  }

  // A session where the SDK was blocked (an ad blocker) or disabled saved to local storage.
  // When the SDK is back — the blocker switched off and the page refreshed, which is exactly
  // the flow CrazyGames describes — that progress must not vanish. Copy every fallback key
  // the Data module does not already have; the Data module's own value always wins, since it
  // may have come from another device. The fallback copy is removed on a LATER boot, once the
  // Data module is seen holding the key — not in the boot that copies it, because a logged-in
  // player's cloud sync is debounced (1-30 s) and closing the tab at once would otherwise lose
  // the only copy. After that the migration is spent, so a later account on the same browser
  // does not inherit it.
  // https://docs.crazygames.com/sdk/data/ ("copy all the existing localStorage keys")
  #migrateFallbackSaves(sdk: CrazyGamesSdk): void {
    for (const [key, value] of this.#fallbackStorage.entries()) {
      try {
        if (sdk.data.getItem(key) === null) sdk.data.setItem(key, value);
        else void this.#fallbackStorage.remove(key);
      } catch (error) {
        console.warn(`CrazyGames: could not migrate saved key "${key}"`, error);
      }
    }
  }

  #applySettings(settings: CrazyGamesSettings): void {
    const next: PlatformSettings = { muteAudio: settings.muteAudio === true };
    const changed = next.muteAudio !== this.#settings.muteAudio;
    this.#settings = next;
    if (changed) this.events.emit("settings:change", next);
  }

  // A throwing SDK must not take the game down with it. Lifecycle reports are best-effort;
  // the game carries on either way.
  #safely(body: () => void): void {
    try {
      body();
    } catch (error) {
      console.warn("CrazyGames SDK call failed", error);
    }
  }
}

function skipped(availability: Exclude<AdAvailability, "available">): AdResult {
  return { shown: false, reason: availability };
}

function readEnvironment(sdk: CrazyGamesSdk): PlatformEnvironment {
  try {
    const info = sdk.user.systemInfo;
    const device = info.device?.type;
    return {
      locale: info.locale ?? null,
      device: device && DEVICE_TYPES.includes(device) ? device : null,
      inPortalApp:
        info.applicationType === "google_play_store" || info.applicationType === "apple_store",
    };
  } catch {
    return { locale: null, device: null, inPortalApp: false };
  }
}
