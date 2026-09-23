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
}

/** Why an ad did not play. Never a thrown error: a missing ad must not break gameplay. */
export type AdSkipReason =
  | "unsupported" // the portal has no such ad kind
  | "too-soon" // the profile's minimum interval has not elapsed
  | "not-ready" // the portal had no fill, or its SDK is unavailable (e.g. an ad blocker)
  | "busy" // another ad break is already in progress
  | "error"; // the portal SDK failed

export interface AdResult {
  readonly shown: boolean;
  readonly reason?: AdSkipReason;
}

export interface RewardedResult extends AdResult {
  /** True only when the portal confirmed the reward. Never grant on `shown` alone. */
  readonly rewarded: boolean;
}

/** Optional hooks around an ad break. */
export interface AdHooks {
  /**
   * Called when the portal actually starts showing an ad — the moment Poki's documentation
   * says to mute audio and disable input. Not called when no ad plays.
   */
  onStart?(): void;
}

/**
 * Key-value storage. Backed by the portal's cloud saves where the profile reports
 * `cloud_saves: true`, and by local storage otherwise — the game does not branch on it.
 */
export interface PlatformStorage {
  /**
   * False when saves last only for this session — private browsing, blocked storage. Poki
   * asks games to "clearly inform players when progress won't persist". Undefined when the
   * backend cannot tell.
   */
  readonly persistent?: boolean;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** What the game tells the platform about its own lifecycle. */
export interface Platform {
  readonly id: string;
  readonly capabilities: PlatformCapabilities;
  readonly storage: PlatformStorage;
  /** A snapshot of what the game has asked for so far. Read by the verify suite. */
  readonly usage: PlatformUsage;
  /**
   * The ISO 639-1 language the portal chose for this player, or `null` where the portal
   * does not say. Valid after {@link initialize}. Yandex requires the game to follow it
   * (requirement 2.14), so it outranks the browser's own preference.
   */
  readonly language: string | null;
  /**
   * False while the portal holds the foreground — its own ad, a purchase dialog, the ad it
   * shows by itself at launch. Read it when binding: the portal may have taken the
   * foreground before anything subscribed to {@link on}.
   */
  readonly foreground: boolean;

  /** Subscribe to a signal the portal raises at the game. Returns the unsubscribe. */
  on<K extends keyof PlatformEvents>(
    event: K,
    handler: (payload: PlatformEvents[K]) => void,
  ): () => void;

  /** Load and hand-shake with the portal. Safe to call more than once. */
  initialize(): Promise<void>;

  /**
   * Report load progress in [0, 1]. Some portals take it; Yandex has no progress API and
   * only counts the call for release validation. The Factory profiles list "does not
   * report loading progress" among past rejections — on Yandex the check that matters is
   * Game Ready ({@link signalReady}), requirement 1.19.2.
   */
  reportLoadingProgress(fraction: number): void;

  /** The game is interactive. Pairs with {@link reportLoadingProgress}. */
  signalReady(): Promise<void>;

  /**
   * Gameplay started or resumed — the first player input, a level start, an unpause. Not on
   * load: Poki lists "gameplayStart() fires on first player input (not load)" as a rule.
   * Adapters drop duplicate and out-of-order calls rather than forwarding them.
   */
  gameplayStart(): void;
  /** Gameplay stopped — a menu, a pause, a death, an incoming ad. */
  gameplayStop(): void;
  /** Whether gameplay is currently reported as running. */
  readonly gameplayActive: boolean;

  /**
   * An interstitial at a natural break, as the player heads back into gameplay. Resolves
   * whether or not an ad played — not every call shows one — and never rejects.
   */
  showInterstitial(hooks?: AdHooks): Promise<AdResult>;
  /** A rewarded ad the player explicitly chose. Grant only when `rewarded` is true. */
  showRewarded(hooks?: AdHooks): Promise<RewardedResult>;
}

/** Signals the platform raises at the game, which map onto Game.pause/resume reasons. */
export interface PlatformEvents extends Record<string, unknown> {
  "ad:start": { readonly kind: AdKind };
  "ad:end": { readonly kind: AdKind };
  "foreground:lost": void;
  "foreground:gained": void;
  /**
   * A rewarded ad the game had already given up on (it opened after the call timed out)
   * was watched to the end. The reward is owed; the game decides whether it still applies.
   */
  "ad:late-reward": { readonly kind: AdKind };
  /**
   * Saved data was replaced from outside the game — on Yandex, the player chose a different
   * progress track in the portal's account-selection dialog. Re-read anything cached.
   */
  "storage:changed": void;
}
