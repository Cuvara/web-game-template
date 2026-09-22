// Local enforcement of the ad rules a platform profile declares.
//
// The portal enforces these too, but it enforces them by rejecting the submission weeks
// later — "ads shown before any gameplay" and "ad breaks at arbitrary points" are listed
// rejection causes on Yandex and Poki. Failing the call here instead turns a review
// rejection into something the game can see the first time it runs.

import type { AdKind, AdSkipReason, PlatformCapabilities } from "./types.js";

export class AdPolicy {
  readonly #capabilities: PlatformCapabilities;
  readonly #now: () => number;
  #lastInterstitialMs: number | null = null;

  constructor(capabilities: PlatformCapabilities, now: () => number = Date.now) {
    this.#capabilities = capabilities;
    this.#now = now;
  }

  /** `null` when the ad may play, otherwise why it may not. */
  check(kind: AdKind): AdSkipReason | null {
    if (!this.#capabilities.ads.includes(kind)) return "unsupported";
    if (kind !== "interstitial") return null;

    const intervalS = this.#capabilities.interstitialMinIntervalS;
    if (intervalS === null || this.#lastInterstitialMs === null) return null;

    const elapsedMs = this.#now() - this.#lastInterstitialMs;
    return elapsedMs < intervalS * 1000 ? "too-soon" : null;
  }

  /** Record that an ad actually played. Only a played ad starts the interval. */
  record(kind: AdKind): void {
    if (kind === "interstitial") this.#lastInterstitialMs = this.#now();
  }

  /** Seconds until an interstitial is allowed again. 0 when it is allowed now. */
  secondsUntilInterstitial(): number {
    const intervalS = this.#capabilities.interstitialMinIntervalS;
    if (intervalS === null || this.#lastInterstitialMs === null) return 0;
    const remainingMs = intervalS * 1000 - (this.#now() - this.#lastInterstitialMs);
    return remainingMs > 0 ? remainingMs / 1000 : 0;
  }
}
