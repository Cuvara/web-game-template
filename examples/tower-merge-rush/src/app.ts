// The flow: start -> playing -> over -> (rewarded continue / double) -> (interstitial) -> playing.
//
// This is the file that owns WHEN the platform is called, and it contains no portal code. It
// talks only to the Platform contract and to the template's bindPlatform/withAdBreak helpers;
// the adapter behind createPlatform turns those into whatever the target portal wants. What
// this owns:
//
//   gameplayStart  Reported on the player's FIRST input, not at load — the Poki rule the
//                  template documents. bindPlatform.armFirstInput() wires that; the game also
//                  reports start/stop as a run begins and ends via #syncGameplay.
//   Rewarded (over) A labelled offer at game over only. Grant the bonus (continue OR double)
//                  strictly on result.rewarded === true; {shown:false}/reason is handled by
//                  leaving the score untouched and telling the player.
//   Interstitial   On restart — a natural break, the player asked for another run — through
//                  withAdBreak so the game is paused, muted and reported stopped around it.
//
// The pure rules live in game/rules.ts; the Pixi drawing lives in rendering/board-view.ts.
// This class is the only place the three meet.

import type { Game, Scene } from "@wgf/game-core";
import type { AdResult, Platform, RewardedResult } from "@wgf/platform-sdk";
import { bindPlatform, withAdBreak, type PlatformBinding } from "../../../src/platform/bind.js";
import { MergeGame, type Snapshot } from "./game/rules.js";
import type { BoardView } from "./rendering/board-view.js";

export interface Hud {
  setState(state: Snapshot["state"]): void;
  setScore(score: number): void;
  setDropLevel(level: number): void;
  setNote(text: string): void;
  setBusy(busy: boolean): void;
  setOver(view: { score: number; canContinue: boolean }): void;
}

export interface AppOptions {
  readonly game: Game;
  readonly platform: Platform;
  readonly hud: Hud;
  readonly view: BoardView;
  readonly present: () => void;
  /** Injected so runs are deterministic in tests. */
  readonly random?: () => number;
}

export class App implements Scene {
  readonly id = "tower-merge-rush";

  readonly #o: AppOptions;
  readonly #merge: MergeGame;
  #binding: PlatformBinding | null = null;
  #continued = false;

  constructor(options: AppOptions) {
    this.#o = options;
    this.#merge = new MergeGame(options.random ? { random: options.random } : {});
  }

  /** For the deterministic test hooks. */
  get merge(): MergeGame {
    return this.#merge;
  }

  // --- Scene ------------------------------------------------------------------------------

  enter(): void {
    // Report gameplayStart on the first real input rather than on load (Poki). The binding
    // also mirrors portal mute and the foreground into the game's own pause state.
    this.#binding = bindPlatform(this.#o.game, this.#o.platform, {
      onAudioMutedChange: () => undefined, // this example has no audio; the hook is here for shape
    });
    this.#binding.armFirstInput();
    this.#render();
  }

  render(): void {
    this.#render();
  }

  // A merge game has no per-frame simulation; state only changes on input. update() keeps the
  // scene contract and lets a future timed mode drop in without touching the loop wiring.
  update(): void {
    /* input-driven only */
  }

  dispose(): void {
    this.#binding?.dispose();
    this.#binding = null;
  }

  // --- Player actions ---------------------------------------------------------------------

  /** The first input starts a run; every later input during play drops a piece. */
  drop(col: number): void {
    if (this.#merge.state === "start") {
      this.#merge.begin();
      // gameplayStart on first input is armed via bindPlatform; also report it here so a run
      // begun by the very first tap is bracketed even if that arming already fired.
      this.#syncGameplay();
    }
    if (this.#merge.state !== "playing") return;

    const result = this.#merge.dropAt(col);
    if (!result.placed) return;

    if (result.over) {
      this.#onOver();
    }
    this.#render();
  }

  /** A plain tap with no column drops into the first open column. */
  dropAnywhere(): void {
    const col = this.#merge.state === "playing" ? this.#merge.firstOpenColumn() : 0;
    this.drop(col ?? 0);
  }

  /**
   * Rewarded "continue": clear the board and play on, keeping the score. Granted ONLY when the
   * portal confirms the reward. A missing ad ({shown:false}) leaves the run over and explains.
   */
  async continue(): Promise<boolean> {
    if (this.#merge.state !== "over" || this.#continued) return false;
    const result = await this.#showRewarded();
    if (result.rewarded) {
      this.#continued = true;
      this.#merge.continueRun();
      this.#syncGameplay();
      this.#o.hud.setNote("");
      this.#render();
      return true;
    }
    this.#reportAdMiss(result);
    return false;
  }

  /**
   * Rewarded "double score": doubles the final score. Granted ONLY on a confirmed reward.
   * Leaves the game over either way; a missing ad is reported, not silently ignored.
   */
  async doubleScore(): Promise<boolean> {
    if (this.#merge.state !== "over") return false;
    const result = await this.#showRewarded();
    if (result.rewarded) {
      this.#merge.doubleScore();
      this.#o.hud.setOver({ score: this.#merge.score, canContinue: false });
      this.#o.hud.setScore(this.#merge.score);
      this.#o.hud.setNote("");
      this.#render();
      return true;
    }
    this.#reportAdMiss(result);
    return false;
  }

  /**
   * Another run. The player asked for it, so it is the natural break an interstitial may use.
   * withAdBreak pauses, mutes and reports gameplay stopped around the ad; a failed or unfilled
   * interstitial never blocks the restart.
   */
  async restart(): Promise<AdResult> {
    const { game, platform } = this.#o;
    this.#o.hud.setBusy(true);
    let result: AdResult = { shown: false, reason: "unsupported" };
    try {
      result = await withAdBreak(
        game,
        platform,
        () => platform.showInterstitial(),
        { resumeGameplay: false }, // we land on the fresh start screen, not straight into play
      );
    } finally {
      this.#o.hud.setBusy(false);
    }
    this.#merge.reset();
    this.#continued = false;
    this.#o.hud.setNote("");
    this.#syncGameplay();
    this.#render();
    return result;
  }

  // --- Internals --------------------------------------------------------------------------

  #onOver(): void {
    this.#syncGameplay();
    this.#o.hud.setOver({ score: this.#merge.score, canContinue: !this.#continued });
  }

  #showRewarded(): Promise<RewardedResult> {
    // Reported gameplay stops for the ad and is restored by the caller's next #syncGameplay.
    this.#o.hud.setBusy(true);
    return this.#o.platform.showRewarded().finally(() => this.#o.hud.setBusy(false));
  }

  #reportAdMiss(result: AdResult): void {
    // {shown:false} with a reason is the normal generic-web answer (no portal, no ad): say so
    // rather than pretend a reward was granted.
    this.#o.hud.setNote(
      result.shown ? "No reward — the ad was not completed." : "No ad available right now.",
    );
    this.#render();
  }

  /** Report gameplay running exactly while a run is on screen and the game is not paused. */
  #syncGameplay(): void {
    const { game, platform } = this.#o;
    const running = this.#merge.state === "playing" && !game.paused;
    if (running) platform.gameplayStart();
    else platform.gameplayStop();
  }

  #render(): void {
    const snapshot = this.#merge.snapshot();
    this.#o.hud.setState(snapshot.state);
    this.#o.hud.setScore(snapshot.score);
    this.#o.hud.setDropLevel(snapshot.dropLevel);
    this.#o.view.draw(snapshot);
    this.#o.present();
  }
}
