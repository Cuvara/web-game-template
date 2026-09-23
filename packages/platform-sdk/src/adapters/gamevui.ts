// GameVui — https://gamevui.vn/
//
// GameVui publishes no developer SDK, no JavaScript API, no ad API and no storage API
// (docs/platforms/gamevui/source-matrix.md; re-checked 2026-09-23: dev./developer./sdk./
// api.gamevui.vn do not resolve and no developer page exists). So this adapter integrates
// nothing. It exists so a title that lists GameVui can be built for it — `WGF_PLATFORM=gamevui`
// — and so the gaps are stated in code rather than discovered at submission:
//
//   - no ads of any kind. GameVui places its own ads around and inside hosted games; a game
//     cannot request one, so `capabilities.ads` is empty and every ad call declines with
//     "unsupported". Never a reward.
//   - saves live in this browser's localStorage only. No cloud sync.
//   - no loading or gameplay signals: nothing to send them to. They are recorded for the
//     verify suite, as generic-web does.
//   - Vietnamese is the default language: the site is Vietnamese-only (INFERRED, not a
//     published rule — see platform-contract.md).
//
// GameVui's undocumented in-frame scripts (window.GV, window.GVAdBreak, window.GameVuiTool)
// are never loaded, detected or called here. They are not offered to third parties, and
// code written against them could only be tested on GameVui's production host. If GameVui
// ever publishes an SDK, this file is replaced by an adapter written against it.

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

/**
 * Deliberately not the Factory profile's `gamevui@1.0.0` capabilities, which claimed
 * interstitial and banner ads with no API to deliver them. `gamevui@1.1.0` matches this.
 */
export const GAMEVUI_CAPABILITIES: PlatformCapabilities = {
  ads: [],
  iap: false,
  cloudSaves: false,
  leaderboards: false,
  achievements: false,
  auth: "none",
  analytics: "self-hosted",
  loadingApi: "none",
  interstitialMinIntervalS: null,
};

export interface GameVuiOptions {
  /** Storage namespace. Use the game id from game.config.yaml. */
  readonly namespace: string;
  /** Replaces localStorage-backed storage. */
  readonly storage?: PlatformStorage;
}

export class GameVuiPlatform implements Platform {
  readonly id = "gamevui";
  readonly capabilities = GAMEVUI_CAPABILITIES;
  readonly storage: PlatformStorage;
  readonly language = "vi";
  /** No API through which GameVui could take the foreground; the page's own visibility
   * handling (src/platform/bind.ts) is all there is. */
  readonly foreground = true;

  readonly #ads = new AdPolicy(GAMEVUI_CAPABILITIES);
  readonly #usage = new UsageRecorder();
  #gameplayActive = false;

  constructor(options: GameVuiOptions) {
    this.storage = options.storage ?? new LocalStorageBackend(options.namespace);
  }

  get usage(): PlatformUsage {
    return this.#usage.snapshot();
  }

  on<K extends keyof PlatformEvents>(
    _event: K,
    _handler: (payload: PlatformEvents[K]) => void,
  ): () => void {
    return () => undefined;
  }

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  reportLoadingProgress(_fraction: number): void {
    this.#usage.recordLoadingProgress();
  }

  signalReady(): Promise<void> {
    this.#usage.recordSignalReady();
    return Promise.resolve();
  }

  get gameplayActive(): boolean {
    return this.#gameplayActive;
  }

  gameplayStart(): void {
    this.#gameplayActive = true;
  }

  gameplayStop(): void {
    this.#gameplayActive = false;
  }

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
