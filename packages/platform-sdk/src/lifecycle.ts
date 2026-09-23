// Gameplay lifecycle sequencing.
//
// Portals that bracket ads with gameplay events reject a game whose events arrive out of
// order. Poki states the rules outright (https://developers.poki.com/guide/requirements-quality,
// "SDK Integration"): events must not fire consecutively, gameplayStart fires on the first
// player input and not on load, no events fire during an ad, and commercialBreak fires only
// when the player is heading back into gameplay. The sequences it documents
// (https://developers.poki.com/guide/sdk-overview) are:
//
//   startup         gameLoadingFinished -> gameplayStart
//   death, restart  gameplayStop -> commercialBreak -> gameplayStart
//   revive          gameplayStop -> rewardedBreak -> gameplayStart
//
// This class is the one place those rules live. An adapter asks it before forwarding each
// call, so a game that calls gameplayStart twice, or during an ad, produces one SDK call
// rather than a rejection. It is pure — no SDK, no DOM, no clock — so every rule has a test.

export type LifecycleCall =
  "gameLoadingFinished" | "gameplayStart" | "gameplayStop" | "commercialBreak" | "rewardedBreak";

export type LifecycleRejection =
  | "duplicate" // the same state was already reported
  | "before-loading-finished" // gameplay reported before gameLoadingFinished
  | "during-ad" // an ad break is in progress
  | "not-playing"; // gameplayStop with no gameplay to stop

export interface RejectedCall {
  readonly call: LifecycleCall;
  readonly reason: LifecycleRejection;
}

export interface AdBreakDecision {
  /** False when the break must not start at all. */
  readonly allowed: boolean;
  /**
   * True when gameplay was still running. The adapter must report gameplayStop before the
   * break: an ad that interrupts gameplay without it breaks the documented sequence.
   */
  readonly stopFirst: boolean;
  readonly reason?: LifecycleRejection;
}

export class GameplayLifecycle {
  #loaded = false;
  #playing = false;
  #adActive = false;
  readonly #rejected: RejectedCall[] = [];
  readonly #onRejected: ((rejected: RejectedCall) => void) | undefined;

  constructor(onRejected?: (rejected: RejectedCall) => void) {
    this.#onRejected = onRejected;
  }

  get loaded(): boolean {
    return this.#loaded;
  }

  get playing(): boolean {
    return this.#playing;
  }

  get adActive(): boolean {
    return this.#adActive;
  }

  /** Every call this lifecycle refused, oldest first. Read by tests and the probe. */
  get rejected(): readonly RejectedCall[] {
    return [...this.#rejected];
  }

  /** True when gameLoadingFinished should be forwarded. Only ever once. */
  loadingFinished(): boolean {
    if (this.#loaded) return this.#reject("gameLoadingFinished", "duplicate");
    this.#loaded = true;
    return true;
  }

  /** True when gameplayStart should be forwarded. */
  start(): boolean {
    if (!this.#loaded) return this.#reject("gameplayStart", "before-loading-finished");
    if (this.#adActive) return this.#reject("gameplayStart", "during-ad");
    if (this.#playing) return this.#reject("gameplayStart", "duplicate");
    this.#playing = true;
    return true;
  }

  /** True when gameplayStop should be forwarded. */
  stop(): boolean {
    if (this.#adActive) return this.#reject("gameplayStop", "during-ad");
    if (!this.#playing) return this.#reject("gameplayStop", "not-playing");
    this.#playing = false;
    return true;
  }

  /**
   * Open an ad break. Gameplay that is still running is stopped as part of opening it, and
   * the decision says so, because the SDK has to hear gameplayStop before the break.
   */
  beginAd(call: "commercialBreak" | "rewardedBreak"): AdBreakDecision {
    if (this.#adActive) {
      this.#reject(call, "during-ad");
      return { allowed: false, stopFirst: false, reason: "during-ad" };
    }
    const stopFirst = this.#playing;
    this.#playing = false;
    this.#adActive = true;
    return { allowed: true, stopFirst };
  }

  /** Close the ad break. Gameplay stays stopped until the game reports gameplayStart. */
  endAd(): void {
    this.#adActive = false;
  }

  #reject(call: LifecycleCall, reason: LifecycleRejection): false {
    const rejected = { call, reason };
    this.#rejected.push(rejected);
    this.#onRejected?.(rejected);
    return false;
  }
}
