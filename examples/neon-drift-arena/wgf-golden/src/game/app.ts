// The game flow for Neon Drift Arena: menu -> playing -> game over -> (ad) -> playing.
//
// GOLDEN-RUN REPLAY. Ported from examples/neon-drift-arena/src/app.ts by the Factory's
// golden-run replay developer; not agent-written code. What the port changed:
//
//   - every platform call goes through the GameIntegration seam (src/game/integration.ts):
//     gameplayStart/Stop, rewarded, interstitial, save/load. The example called
//     platform.showRewarded / showInterstitial inside withAdBreak directly; the template's
//     PlatformGameIntegration (handed in as GameContext.integration) now does that, at the
//     moments the Factory's integration plan assigns each placement id;
//   - the scene publishes its id and a step counter to #hud (the template's probe contract),
//     has a pause menu, and drives the audio: the title music on the menu, the two-stem
//     driving loop in a run - its low-pass opening and its intensity layer fading in as the
//     speed rises - an engine loop re-pitched by speed and filtered and panned by steering, a
//     whoosh for every wall passing the craft (a harder one for a near miss), the crash and
//     game-over sting over ducked music.
//
// Determinism lives entirely in the Simulation (game/simulation.ts); this file only routes
// input and lifecycle.

import type { Game, Scene } from "@wgf/game-core";
import type { Audio, LoopHandle } from "../audio/audio.js";
import type { GameIntegration } from "./integration.js";
import { Simulation } from "./simulation.js";

export type Phase = "menu" | "playing" | "over";

// Placement ids are string literals at each call to the seam - the ids reported in
// docs/development/report.json - so the integration can read them from the source.

/** What a drawing layer offers the scene. rendering/threejs/arena-view.ts implements it. */
export interface ArenaDrawing {
  sync(sim: Simulation | null): void;
}

export interface AppOptions {
  readonly game: Game;
  readonly integration: GameIntegration;
  readonly view: ArenaDrawing;
  readonly audio: Audio;
  /** The template's probe element: #hud[data-scene], [data-steps]. */
  readonly probe: HTMLElement;
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
  readonly paused: boolean;
  /** True at game over while a revive is still on offer (once per run). */
  readonly canRevive: boolean;
}

const SAVE_BEST = "best";
/** Clear space (arena units) under which a wall passing the craft is a near miss. */
const NEAR_MISS_GAP = 0.8;
/** Speeds (arena units per second) over which the music's intensity goes from 0 to 1. */
const CALM_SPEED = 8;
const FULL_SPEED = 20;
const LAYER = "music-drive-layer";

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
  #steps = 0;
  /**
   * The opening grace: until the player first steers in a run, a wall that reaches the craft
   * passes through it (the simulation's own revive clears it) instead of ending the run. A
   * first-time player still reading the screen is never failed for not moving yet.
   */
  #steered = false;
  #engine: LoopHandle | null = null;
  /** Walls that have already passed the craft (and made their whoosh). */
  #passed = new Set<number>();
  #lastX = 0;
  #intensity = -1;

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
    return (
      this.#phase === "over" &&
      !this.#reviveUsed &&
      this.#o.integration.canOfferRewarded("revive-game-over")
    );
  }
  get runId(): number {
    return this.#runId;
  }
  get steps(): number {
    return this.#steps;
  }

  /** Read the saved best score. Part of loading, before the menu is interactive. */
  async load(): Promise<void> {
    const saved = Number(await this.#o.integration.load(SAVE_BEST));
    this.#best = Number.isFinite(saved) && saved > 0 ? Math.floor(saved) : 0;
    this.#o.audio.music("music-title");
    this.#emit();
  }

  // --- Scene ----------------------------------------------------------------------------

  enter(): void {
    this.#o.probe.dataset["scene"] = this.id;
  }

  update(stepMs: number): void {
    this.#steps += 1;
    this.#o.probe.dataset["steps"] = String(this.#steps);
    if (this.#phase !== "playing" || !this.#sim) return;
    const stillRunning = this.#sim.tick(stepMs);
    if (!stillRunning && !this.#steered && this.#sim.revive()) {
      // Inside the opening grace: the wall passes through.
    } else if (!stillRunning) {
      void this.#endRun();
      return;
    }
    this.#runSounds(this.#sim, stepMs);
    this.#emit();
  }

  /** Per step of a run: the engine, the music's intensity, a whoosh per passing wall. */
  #runSounds(sim: Simulation, stepMs: number): void {
    const audio = this.#o.audio;
    this.#engine ??= audio.loop("sfx-engine", { gain: 1 });
    const t = Math.max(0, Math.min(1, (sim.speed - CALM_SPEED) / (FULL_SPEED - CALM_SPEED)));
    const steer = Math.max(
      -1,
      Math.min(1, (sim.playerX - this.#lastX) / Math.max(0.001, (6 * stepMs) / 1000)),
    );
    this.#lastX = sim.playerX;
    if (this.#engine) {
      this.#engine.setRate(0.8 + t * 0.55 + Math.abs(steer) * 0.06);
      this.#engine.setFilter(700 + t * 2200 + Math.abs(steer) * 900);
      this.#engine.setPan((sim.playerX / sim.arenaHalfWidth) * 0.35);
      this.#engine.setGain(0.75 + Math.abs(steer) * 0.25);
    }
    if (Math.abs(t - this.#intensity) > 0.01) {
      this.#intensity = t;
      // The layer comes in under the base at 30 %, full by top speed; the base's low-pass
      // opens from 3.5 kHz to fully open by just past half speed.
      audio.setLayer(LAYER, 0.3 + 0.7 * t * t * (3 - 2 * t));
      audio.setMusicFilter(3500 * Math.pow(20000 / 3500, Math.min(1, t * 1.8)));
    }
    for (const obstacle of sim.obstacles) {
      if (obstacle.z > 0 || this.#passed.has(obstacle.id)) continue;
      this.#passed.add(obstacle.id);
      const side = obstacle.x - sim.playerX;
      const gap = Math.abs(side) - obstacle.halfWidth - sim.playerHalfWidth;
      if (gap < 0) continue; // a hit: the crash sounds instead
      const pan = Math.max(-0.8, Math.min(0.8, side / 3));
      if (gap < NEAR_MISS_GAP) audio.play("sfx-near-miss", { pan, vary: 60 });
      else audio.play("sfx-pass", { pan, gain: Math.max(0.25, 1 - gap / 4), vary: 120 });
    }
  }

  render(): void {
    this.#o.view.sync(this.#phase === "menu" ? null : this.#sim);
    this.#o.present();
  }

  pause(): void {
    this.#o.audio.setPaused(true);
    this.#emit();
  }

  resume(): void {
    this.#o.audio.setPaused(false);
    this.#emit();
  }

  // --- Player actions -------------------------------------------------------------------

  /** Begin a run from the menu. */
  play(): void {
    if (this.#phase !== "menu" || this.#o.game.paused) return;
    this.#o.audio.unlock();
    this.#o.audio.play("ui-tap");
    this.#startRun();
  }

  /** Steer the current run: -1 left, +1 right, 0 coast. No effect outside a run or paused. */
  steer(direction: number): void {
    if (this.#o.game.paused) return;
    if (direction !== 0 && this.#phase === "playing") this.#steered = true;
    this.#sim?.steer(direction);
  }

  /** Watch a rewarded ad to continue this run once. Granted only on a confirmed reward. */
  async revive(): Promise<boolean> {
    const sim = this.#sim;
    if (this.#phase !== "over" || this.#reviveUsed || !sim) return false;
    const granted = await this.#o.integration.rewarded("revive-game-over");
    if (granted && sim.revive()) {
      this.#reviveUsed = true;
      // Continue the SAME deterministic run; the sim cleared the obstacles on top of us.
      this.#phase = "playing";
      this.#o.audio.sting("ui-fanfare", { duckTo: 0.5 });
      this.#o.audio.music("music-drive", { fade: 0.8, layers: [LAYER] });
      this.#intensity = -1;
      this.#o.integration.gameplayStart();
      this.#emit();
      return true;
    }
    // No reward (declined, no fill, unsupported): stay on the game-over screen.
    this.#emit();
    return false;
  }

  /** A fresh run after game over, at the natural break an interstitial may use. */
  async restart(): Promise<void> {
    if (this.#phase !== "over") return;
    await this.#o.integration.interstitial("restart-game-over");
    this.#startRun();
  }

  /** Back to the menu without an ad. */
  toMenu(): void {
    this.#phase = "menu";
    this.#sim = null;
    this.#o.audio.music("music-title");
    this.#emit();
  }

  /** The pause menu: the loop stops, gameplay is reported stopped, audio goes silent. */
  pauseMenu(): void {
    if (this.#phase !== "playing" || this.#o.game.paused) return;
    this.#o.game.pause("manual");
    this.#o.integration.gameplayStop();
    this.#emit();
  }

  resumeMenu(): void {
    if (!this.#o.game.paused) return;
    this.#o.game.resume("manual");
    if (this.#phase === "playing" && !this.#o.game.paused) this.#o.integration.gameplayStart();
    this.#emit();
  }

  // --- Internals ------------------------------------------------------------------------

  #startRun(): void {
    this.#sim = new Simulation({ seed: this.#seedCounter++ });
    this.#reviveUsed = false;
    this.#steered = false;
    this.#runId += 1;
    this.#phase = "playing";
    this.#passed.clear();
    this.#lastX = 0;
    this.#intensity = -1;
    this.#o.audio.music("music-drive", { fade: 0.8, layers: [LAYER] });
    this.#o.integration.gameplayStart();
    this.#emit();
  }

  async #endRun(): Promise<void> {
    this.#phase = "over";
    this.#o.integration.gameplayStop();
    const score = this.#sim?.score ?? 0;
    const audio = this.#o.audio;
    this.#engine?.stop(0.08);
    this.#engine = null;
    audio.sting("sfx-crash", { duckTo: 0.15 });
    audio.sting("sfx-game-over", { delay: 0.7, duckTo: 0.2 });
    if (score > this.#best && this.#best > 0)
      audio.sting("ui-fanfare", { delay: 2.4, duckTo: 0.3 });
    audio.music("music-title", { fade: 3 });
    this.#o.integration.track("run_over", { score });
    if (score > this.#best) {
      this.#best = score;
      await this.#o.integration.save(SAVE_BEST, String(score));
    }
    this.#emit();
  }

  #emit(): void {
    this.#o.onChange?.({
      phase: this.#phase,
      score: this.score,
      best: this.#best,
      paused: this.#o.game.paused,
      canRevive: this.canRevive,
    });
  }
}
