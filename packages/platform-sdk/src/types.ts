// The platform contract.
//
// Every name here is the runtime counterpart of a field in a platform profile
// (web-game-factory/core/reference/platforms/<id>.yaml). The profile is the authority; this
// file is how a game consumes it without knowing which portal it is running on.
//
//   profile capabilities.ads             -> PlatformCapabilities.ads
//   profile capabilities.iap             -> PlatformCapabilities.iap
//   profile capabilities.cloud_saves     -> PlatformCapabilities.cloudSaves
//   profile capabilities.auth            -> PlatformCapabilities.auth
//   profile requirements.loading_api     -> PlatformCapabilities.loadingApi
//   profile ads.interstitial_min_interval_s -> AdPolicy minimum interval
//
// Game code never imports a portal SDK. That rule is what lets one build target several
// portals, and it is checked at release validation by the `package.platform_sdk` assertion
// every profile carries.

import type { PlatformUsage } from "./usage.js";

export type AdKind = "interstitial" | "rewarded" | "banner";
export type AuthMode = "required" | "optional" | "none";
export type AnalyticsMode = "platform-provided" | "self-hosted" | "none";
export type LoadingApiMode = "required" | "optional" | "none";

export interface PlatformCapabilities {
  /** Ad kinds the portal actually offers. Asking for anything else is a programming error. */
  readonly ads: readonly AdKind[];
  readonly iap: boolean;
  readonly cloudSaves: boolean;
  readonly leaderboards: boolean;
  readonly achievements: boolean;
  readonly auth: AuthMode;
  readonly analytics: AnalyticsMode;
  readonly loadingApi: LoadingApiMode;
  /** Shortest gap between interstitials, in seconds. `null` where the portal sets none. */
  readonly interstitialMinIntervalS: number | null;
  /**
   * Whether the game itself must report a gameplay stop when the tab is hidden. False where
   * the portal detects focus loss on its own and asks games not to report it — CrazyGames
   * says so explicitly for `gameplayStop`.
   */
  readonly gameplayStopOnHidden: boolean;
}

/** Why an ad did not play. Never a thrown error: a missing ad must not break gameplay. */
export type AdSkipReason =
  | "unsupported" // the portal has no such ad kind
  | "disabled" // the portal has ads switched off for this title (e.g. a soft launch)
  | "adblock" // an ad blocker prevented the ad
  | "too-soon" // the minimum interval has not elapsed, locally or at the portal
  | "not-ready" // the portal had no fill, or another ad is already in progress
  | "error"; // the portal SDK failed

/**
 * Whether asking for an ad kind can currently have any effect. A game uses this to hide an
 * offer rather than show a button that does nothing — "rewarded ad buttons without effect"
 * is a listed CrazyGames rejection cause.
 */
export type AdAvailability = "available" | "unsupported" | "disabled" | "adblock";

export interface AdResult {
  readonly shown: boolean;
  readonly reason?: AdSkipReason;
}

export interface RewardedResult extends AdResult {
  /** True only when the portal confirmed the reward. Never grant on `shown` alone. */
  readonly rewarded: boolean;
}

/**
 * Key-value storage. Backed by the portal's cloud saves where the profile reports
 * `cloud_saves: true`, and by local storage otherwise — the game does not branch on it.
 */
export interface PlatformStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Settings the portal imposes on the game. The portal's value wins over any in-game toggle. */
export interface PlatformSettings {
  /** The game must be silent while this is true. */
  readonly muteAudio: boolean;
}

export type DeviceType = "desktop" | "tablet" | "mobile";

/** What the portal knows about where the game is running. Valid after `initialize()`. */
export interface PlatformEnvironment {
  /** BCP 47 locale the portal selected for the player, e.g. `en-US`; null when unknown. */
  readonly locale: string | null;
  readonly device: DeviceType | null;
  /** Running inside the portal's own native app, where the UI must respect safe areas. */
  readonly inPortalApp: boolean;
}

/** A logged-in portal account, or null for a guest. Never an authentication credential. */
export interface PlatformUser {
  readonly username: string;
  readonly avatarUrl: string | null;
}

export type Unsubscribe = () => void;

export interface PlatformEventSource {
  on<K extends keyof PlatformEvents>(
    type: K,
    handler: (payload: PlatformEvents[K]) => void,
  ): Unsubscribe;
}

/** What the game tells the platform about its own lifecycle. */
export interface Platform {
  readonly id: string;
  readonly capabilities: PlatformCapabilities;
  readonly storage: PlatformStorage;
  readonly events: PlatformEventSource;
  readonly settings: PlatformSettings;
  readonly environment: PlatformEnvironment;
  /** A snapshot of what the game has asked for so far. Read by the verify suite. */
  readonly usage: PlatformUsage;

  /** Load and hand-shake with the portal. Safe to call more than once. */
  initialize(): Promise<void>;

  /**
   * Report load progress in [0, 1]. Required by every portal whose profile sets
   * `loading_api: required` — "does not report loading progress" is a listed rejection
   * cause on Yandex, Poki and CrazyGames.
   */
  reportLoadingProgress(fraction: number): void;

  /** The game is interactive. Pairs with {@link reportLoadingProgress}. */
  signalReady(): Promise<void>;

  /** Gameplay started or resumed. Portals use this to bracket ad breaks. */
  gameplayStart(): void;
  /** Gameplay stopped — a menu, a pause, an incoming ad. */
  gameplayStop(): void;

  /**
   * Resolve only at a natural break — a level transition, a death — with gameplay already
   * stopped. Never throws; `shown: false` carries the reason.
   */
  showInterstitial(): Promise<AdResult>;
  showRewarded(): Promise<RewardedResult>;
  /** Whether an offer for `kind` should be visible at all. */
  adAvailability(kind: AdKind): AdAvailability;

  /** The logged-in portal user, or null for a guest or a portal without accounts. */
  getUser(): Promise<PlatformUser | null>;
}

/** Signals the platform raises at the game, which map onto Game.pause/resume reasons. */
export interface PlatformEvents extends Record<string, unknown> {
  /**
   * The ad is actually playing. Mute here, not on request: a request may go unfilled, and
   * muting and unmuting with no visible change reads as a bug.
   */
  "ad:start": { readonly kind: AdKind };
  /** Emitted only after an `ad:start`. */
  "ad:end": { readonly kind: AdKind };
  "settings:change": PlatformSettings;
  "foreground:lost": void;
  "foreground:gained": void;
}
