// The game flow for Neon Drift Arena: menu -> playing -> game over -> (ad) -> playing.
//
// This file owns WHEN the platform is told things and it talks only to the Platform
// abstraction (@wgf/platform-sdk) plus bindPlatform/withAdBreak. It never imports a portal
// SDK. Ads go through platform.showInterstitial / platform.showRewarded and a reward is
// granted only when `rewarded === true`; every ad path is graceful when `{ shown: false }`.
//
// The App is a game-core Scene, so the Game's fixed-step loop drives `update` (advance the
// pure simulation) and `render` (mirror it into Three.js). Determinism lives entirely in the
// Simulation; this file only routes input and lifecycle.

import type { Game, Scene } from "@wgf/game-core";
import type { Platform } from "@wgf/platform-sdk";
import type { PlatformBinding } from "../../../src/platform/bind.js";
import { withAdBreak } from "../../../src/platform/bind.js";
import { Simulation } from "./game/simulation.js";
import type { ArenaView } from "./game/arena-view.js";

export type Phase = "menu" | "playing" | "over";

export interface AppOptions {
  readonly game: Game;
  readonly platform: Platform;
  readonly binding: PlatformBinding;
  readonly view: ArenaView;
  /** Present a drawn frame (renderer.render()). Separated so the sim can be tested headless. */
  readonly present: () => void;
  /** Called whenever the visible phase or score changes, so a DOM HUD can follow it. */
  readonly onChange?: (view: AppView) => void;
  /** Seed for the run's obstacle stream. Deterministic runs pass a fixed value. */
  readonly seed?: number;
}

export interface AppView {
  readonly phase: Phase;
  readonly score: number;
  readonly best: number;
  /** True at game over while a revive is still on offer (once per run). */
  readonly canRevive: boolean;
}

const SAVE_BEST = "best";

export class App implements Scene {
  readonly id = "neon-drift-arena";

  readonly #o: AppOptions;
  #phase: Phase = "menu";
  #sim: Simulation | null = null;
  #best = 0;
  #reviveUsed = false;
  #seedCounter: number;
  /** Bumped once per fresh run. A generation marker: same value => same run. */
  #runId = 0;

  constructor(options: AppOptions) {
    this.#o = options;
    this.#seedCounter = options.seed ?? 1;
  }

  get phase(): Phase {
    return this.#phase;
  }
  get score(): number {
    return this.#sim?.score ?? 0;
  }
  get best(): number {
    return this.#best;
  }
  get simulation(): Simulation | null {
    return this.#sim;
  }
  get canRevive(): boolean {
    return this.#phase === "over" && !this.#reviveUsed;
  }
  /** Increments each time a fresh run starts. Lets a caller prove a restart is a new run. */
  get runId(): number {
    return this.#runId;
  }

  /** Read the saved best score. Part of loading, before the menu is interactive. */
  async load(): Promise<void> {
    const saved = Number(await this.#o.platform.storage.get(SAVE_BEST));
    this.#best = Number.isFinite(saved) && saved > 0 ? Math.floor(saved) : 0;
    // Arm gameplayStart on the player's first input rather than at load — a portal rule.
    this.#o.binding.armFirstInput();
    this.#emit();
  }

  // --- Scene ----------------------------------------------------------------------------

  update(stepMs: number): void {
    if (this.#phase !== "playing" || !this.#sim) return;
    const stillRunning = this.#sim.tick(stepMs);
    if (!stillRunning) {
      void this.#endRun();
      return;
    }
    this.#emit();
  }

  render(): void {
    this.#o.view.sync(this.#phase === "menu" ? null : this.#sim);
    this.#o.present();
  }

  // --- Player actions -------------------------------------------------------------------

  /** Begin a run from the menu. The first-input arming reports gameplayStart separately. */
  play(): void {
    if (this.#phase !== "menu") return;
    this.#startRun();
  }

  /** Steer the current run: -1 left, +1 right, 0 coast. No effect outside a run. */
  steer(direction: number): void {
    this.#sim?.steer(direction);
  }

  /**
   * Watch a rewarded ad to continue this run once. Grants the revive only when the portal
   * confirms the reward (`rewarded === true`); graceful when no ad is available.
   */
  async revive(): Promise<boolean> {
    const sim = this.#sim;
    if (!this.canRevive || !sim) return false;
    // Gameplay is already stopped at game over, so withAdBreak's default (resume only what it
    // interrupted) reports nothing on its own — this method reports gameplayStart itself, and
    // only on a granted reward, so a declined ad never leaves gameplay wrongly "running".
    const result = await withAdBreak(this.#o.game, this.#o.platform, () =>
      this.#o.platform.showRewarded(),
    );
    if (result.rewarded && sim.revive()) {
      this.#reviveUsed = true;
      // Continue the SAME deterministic run; the sim cleared the obstacles on top of us.
      this.#phase = "playing";
      if (!this.#o.game.paused) this.#o.platform.gameplayStart();
      this.#emit();
      return true;
    }
    // No reward (declined, no fill, unsupported): stay on the game-over screen.
    this.#emit();
    return false;
  }

  /**
   * Start a fresh run after game over, showing an interstitial at this natural break. The ad
   * is optional: a `{ shown: false }` result just proceeds straight into the next run.
   */
  async restart(): Promise<void> {
    if (this.#phase !== "over") return;
    // gameplayStart for the fresh run is reported by #startRun below, so the break resumes
    // only what it interrupted (nothing, at game over) rather than double-reporting.
    await withAdBreak(this.#o.game, this.#o.platform, () => this.#o.platform.showInterstitial());
    this.#startRun();
  }

  /** Back to the menu without an ad. */
  toMenu(): void {
    this.#phase = "menu";
    this.#sim = null;
    this.#emit();
  }

  // --- Internals ------------------------------------------------------------------------

  #startRun(): void {
    this.#sim = new Simulation({ seed: this.#seedCounter++ });
    this.#reviveUsed = false;
    this.#runId += 1;
    this.#phase = "playing";
    // First input already reported gameplayStart via bindPlatform. Later runs are reported
    // here — the run is starting and nothing pauses it.
    if (!this.#o.game.paused) this.#o.platform.gameplayStart();
    this.#emit();
  }

  async #endRun(): Promise<void> {
    this.#phase = "over";
    this.#o.platform.gameplayStop();
    const score = this.#sim?.score ?? 0;
    if (score > this.#best) {
      this.#best = score;
      await this.#o.platform.storage.set(SAVE_BEST, String(score));
    }
    this.#emit();
  }

  #emit(): void {
    this.#o.onChange?.({
      phase: this.#phase,
      score: this.score,
      best: this.#best,
      canRevive: this.canRevive,
    });
  }
}
