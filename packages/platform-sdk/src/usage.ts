// What the game actually asked the platform to do.
//
// Release validation measures facts about the built package, and several of them — whether
// the loading API was called, which ad kinds were used — are only observable at runtime.
// Recording them here means the verify suite reads them off the real shipped bundle rather
// than off a special instrumented build, which would be measuring something else.
//
// Deliberately always on: it is a handful of counters, and a build that has to be
// instrumented to be verified is not the build that ships.
//
// Note the limit of this signal. Observing a run proves an ad WAS requested; it can never
// prove one is never requested. `uses_rewarded_ads` is a blocking assertion on GameVui, so
// that assertion is evaluated against `monetization.ad_kinds` in game.config.yaml — the
// design's declaration — and these counters are the cross-check that the code agrees.

import type { AdKind } from "./types.js";

export interface PlatformUsage {
  readonly loadingProgressCalls: number;
  readonly signalReadyCalls: number;
  /** Transitions reported to the portal, after deduplication. */
  readonly gameplayStartCalls: number;
  readonly gameplayStopCalls: number;
  /** Ads the game asked for, whether or not the portal played one. */
  readonly adsRequested: Readonly<Record<AdKind, number>>;
  /** Ads the portal actually played. */
  readonly adsShown: Readonly<Record<AdKind, number>>;
}

const zeroed = (): Record<AdKind, number> => ({ interstitial: 0, rewarded: 0, banner: 0 });

export class UsageRecorder {
  #loadingProgressCalls = 0;
  #signalReadyCalls = 0;
  #gameplayStartCalls = 0;
  #gameplayStopCalls = 0;
  readonly #adsRequested = zeroed();
  readonly #adsShown = zeroed();

  recordLoadingProgress(): void {
    this.#loadingProgressCalls += 1;
  }

  recordSignalReady(): void {
    this.#signalReadyCalls += 1;
  }

  recordGameplayStart(): void {
    this.#gameplayStartCalls += 1;
  }

  recordGameplayStop(): void {
    this.#gameplayStopCalls += 1;
  }

  recordAdRequested(kind: AdKind): void {
    this.#adsRequested[kind] += 1;
  }

  recordAdShown(kind: AdKind): void {
    this.#adsShown[kind] += 1;
  }

  snapshot(): PlatformUsage {
    return {
      loadingProgressCalls: this.#loadingProgressCalls,
      signalReadyCalls: this.#signalReadyCalls,
      gameplayStartCalls: this.#gameplayStartCalls,
      gameplayStopCalls: this.#gameplayStopCalls,
      adsRequested: { ...this.#adsRequested },
      adsShown: { ...this.#adsShown },
    };
  }
}
