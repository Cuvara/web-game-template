// Generic Web — self-hosted, no portal.
//
// Not a null object and not a special case. The profile treats "no portal" in the same
// vocabulary as every other target so the design and validation paths need no branch for
// it, and this adapter is the runtime half of that: the game calls the same methods and
// simply gets a platform whose ad capabilities are empty.
//
// The profile asserts `package.platform_sdk == none`, which is about the built bundle: no
// portal SDK script is loaded here, and none should ever be added to this file.

import { AdPolicy } from "../ad-policy.js";
import { LocalStorageBackend } from "../storage.js";
import { UsageRecorder, type PlatformUsage } from "../usage.js";
import type {
  AdResult,
  Platform,
  PlatformCapabilities,
  PlatformEvents,
  PlatformStorage,
  RewardedResult,
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
};

export interface GenericWebOptions {
  /** Storage namespace. Use the game id from game.config.yaml. */
  readonly namespace: string;
}

export class GenericWebPlatform implements Platform {
  readonly id = "generic-web";
  readonly capabilities = GENERIC_WEB_CAPABILITIES;
  readonly storage: PlatformStorage;
  /** No portal to choose a language; the game falls back to the browser's. */
  readonly language = null;
  /** No portal to take the foreground away. */
  readonly foreground = true;

  readonly #ads = new AdPolicy(GENERIC_WEB_CAPABILITIES);
  readonly #usage = new UsageRecorder();
  #loadingFraction = 0;
  #ready = false;

  constructor(options: GenericWebOptions) {
    this.storage = new LocalStorageBackend(options.namespace);
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
  ): () => void {
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

  gameplayStart(): void {}
  gameplayStop(): void {}

  showInterstitial(): Promise<AdResult> {
    this.#usage.recordAdRequested("interstitial");
    return Promise.resolve({
      shown: false,
      reason: this.#ads.check("interstitial") ?? "unsupported",
    });
  }

  showRewarded(): Promise<RewardedResult> {
    this.#usage.recordAdRequested("rewarded");
    return Promise.resolve({
      shown: false,
      rewarded: false,
      reason: this.#ads.check("rewarded") ?? "unsupported",
    });
  }
}
