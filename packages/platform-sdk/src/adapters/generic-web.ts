// Generic Web — self-hosted, no portal.
//
// Not a null object and not a special case. The profile treats "no portal" in the same
// vocabulary as every other target so the design and validation paths need no branch for
// it, and this adapter is the runtime half of that: the game calls the same methods and
// simply gets a platform whose ad capabilities are empty.
//
// The profile asserts `package.platform_sdk == none`, which is about the built bundle: no
// portal SDK script is loaded here, and none should ever be added to this file.
//
// `NoSdkPlatform` is the shared body for every target that has no portal SDK to talk to.
// GameVui uses it too; see ./gamevui.ts for why.

import { AdPolicy } from "../ad-policy.js";
import { LocalStorageBackend } from "../storage.js";
import { UsageRecorder, type PlatformUsage } from "../usage.js";
import {
  DEFAULT_SETTINGS,
  UNKNOWN_ENVIRONMENT,
  type AdAvailability,
  type AdKind,
  type AdResult,
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

export const GENERIC_WEB_CAPABILITIES: PlatformCapabilities = {
  ads: [],
  iap: false,
  cloudSaves: false,
  leaderboards: false,
  achievements: false,
  auth: "none",
  analytics: "self-hosted",
  loadingApi: "optional",
  interstitialMinIntervalS: null,
  gameplayStopOnHidden: true,
};

export interface GenericWebOptions {
  /** Storage namespace. Use the game id from game.config.yaml. */
  readonly namespace: string;
  /** Replaces local storage. Tests inject one. */
  readonly storage?: PlatformStorage;
}

/** A platform with no portal SDK: nothing to load, no ads to request, local saves. */
export class NoSdkPlatform implements Platform {
  readonly id: string;
  readonly capabilities: PlatformCapabilities;
  readonly storage: PlatformStorage;
  /** No portal to choose a language; the game falls back to the browser's. */
  readonly language = null;
  readonly environment: PlatformEnvironment = UNKNOWN_ENVIRONMENT;
  readonly settings: PlatformSettings = DEFAULT_SETTINGS;
  /** No portal to take the foreground away. */
  readonly foreground = true;

  readonly #ads: AdPolicy;
  readonly #usage = new UsageRecorder();
  #loadingFraction = 0;
  #ready = false;
  #gameplayActive = false;

  constructor(id: string, capabilities: PlatformCapabilities, options: GenericWebOptions) {
    this.id = id;
    this.capabilities = capabilities;
    this.#ads = new AdPolicy(capabilities);
    this.storage = options.storage ?? new LocalStorageBackend(options.namespace);
  }

  get usage(): PlatformUsage {
    return this.#usage.snapshot();
  }

  get loadingFraction(): number {
    return this.#loadingFraction;
  }

  get ready(): boolean {
    return this.#ready;
  }

  /** Nothing to subscribe to: without a portal, no signal is ever raised. */
  on<K extends keyof PlatformEvents>(
    _event: K,
    _handler: (payload: PlatformEvents[K]) => void,
  ): Unsubscribe {
    return () => undefined;
  }

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  reportLoadingProgress(fraction: number): void {
    this.#loadingFraction = Math.min(Math.max(fraction, 0), 1);
    this.#usage.recordLoadingProgress();
  }

  signalReady(): Promise<void> {
    this.#ready = true;
    this.#loadingFraction = 1;
    this.#usage.recordSignalReady();
    return Promise.resolve();
  }

  get gameplayActive(): boolean {
    return this.#gameplayActive;
  }

  gameplayStart(): void {
    if (this.#gameplayActive) return;
    this.#gameplayActive = true;
    this.#usage.recordGameplayStart();
  }

  gameplayStop(): void {
    if (!this.#gameplayActive) return;
    this.#gameplayActive = false;
    this.#usage.recordGameplayStop();
  }

  adAvailability(kind: AdKind): AdAvailability {
    // Even a kind the profile lists cannot be requested: there is no SDK to ask.
    return this.capabilities.ads.includes(kind) ? "disabled" : "unsupported";
  }

  showInterstitial(): Promise<AdResult> {
    return Promise.resolve(this.#skip("interstitial"));
  }

  showRewarded(): Promise<RewardedResult> {
    return Promise.resolve({ ...this.#skip("rewarded"), rewarded: false });
  }

  getUser(): Promise<PlatformUser | null> {
    return Promise.resolve(null);
  }

  #skip(kind: AdKind): AdResult {
    this.#usage.recordAdRequested(kind);
    const reason = this.#ads.check(kind) ?? this.adAvailability(kind);
    return { shown: false, reason: reason === "available" ? "disabled" : reason };
  }
}

export class GenericWebPlatform extends NoSdkPlatform {
  declare readonly id: "generic-web";

  constructor(options: GenericWebOptions) {
    super("generic-web", GENERIC_WEB_CAPABILITIES, options);
  }
}
