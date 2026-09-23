// The game's side of the platform seam.
//
// Everything the game does that the platform cares about goes through here: the moments
// gameplay starts and stops, the two kinds of ad break, and what has to happen around a
// break — pause the simulation, mute audio, drop input — and afterwards. Scenes and UI call
// these methods; nothing else in the demo touches `Platform`, and nothing anywhere touches
// window.PokiSDK. Swap `createPlatform("poki")` for another id and this file does not change.

import type { Game } from "@wgf/game-core";
import type { Platform } from "@wgf/platform-sdk";

export interface SessionHooks {
  /** Silence everything. Called when an ad starts, or a break is about to. */
  mute(): void;
  unmute(): void;
  /** Reflects the break in the UI and state probe. */
  onAdChange(kind: "none" | "commercial" | "rewarded"): void;
}

export class GameSession {
  readonly #game: Game;
  readonly #platform: Platform;
  readonly #hooks: SessionHooks;
  #inBreak = false;
  #mutedForBreak = false;

  constructor(game: Game, platform: Platform, hooks: SessionHooks) {
    this.#game = game;
    this.#platform = platform;
    this.#hooks = hooks;
  }

  /** False while an ad break runs. Input handlers check this before acting. */
  get inputEnabled(): boolean {
    return !this.#inBreak;
  }

  /** The player is now in control — first input, a level start, a revive. */
  startGameplay(): void {
    this.#platform.gameplayStart();
  }

  /** The player is no longer in control — a death, a pause, a menu. */
  stopGameplay(): void {
    this.#platform.gameplayStop();
  }

  /**
   * The player is heading back into gameplay from a natural break: restart after a death,
   * resume from pause. Poki's sequence is gameplayStop -> commercialBreak -> gameplayStart,
   * and not every call shows an ad. `resume` runs after the break whatever happened.
   */
  async commercialBreakThen(resume: () => void): Promise<void> {
    await this.#break("commercial", () =>
      this.#platform.showInterstitial({ onStart: () => this.#muteForBreak() }),
    );
    resume();
    this.startGameplay();
  }

  /**
   * A rewarded break the player chose. Returns true only when Poki confirmed the reward —
   * with an ad blocker, no fill, or an early close it is false, and nothing is granted.
   */
  async rewardedBreak(): Promise<boolean> {
    const result = await this.#break("rewarded", () =>
      this.#platform.showRewarded({ onStart: () => this.#muteForBreak() }),
    );
    return result.rewarded;
  }

  async #break<T>(kind: "commercial" | "rewarded", show: () => Promise<T>): Promise<T> {
    this.#inBreak = true;
    this.#game.pause("ad");
    // Muted before the call as well as in onStart: a break that decides not to show an ad
    // is brief, and a break that does must never let a frame of game audio through.
    this.#muteForBreak();
    this.#hooks.onAdChange(kind);
    try {
      return await show();
    } finally {
      this.#hooks.onAdChange("none");
      this.#game.resume("ad");
      if (this.#mutedForBreak) {
        this.#mutedForBreak = false;
        this.#hooks.unmute();
      }
      this.#inBreak = false;
    }
  }

  // Mute holds are counted. Muting before the call and again in onStart must still be one
  // hold, or the break ends with the game silent for good.
  #muteForBreak(): void {
    if (this.#mutedForBreak) return;
    this.#mutedForBreak = true;
    this.#hooks.mute();
  }
}
