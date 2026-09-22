// The object a game repository actually holds.
//
// Game owns the loop, the active scene and the bus, and it owns pause. Everything that can
// take the foreground away — an ad break, a hidden tab, a lost context — routes through
// `pause()`/`resume()` here rather than each subsystem inventing its own flag, so audio,
// input and simulation can never disagree about whether the game is running.

import { EventBus } from "./events.js";
import { GameLoop, type GameLoopOptions } from "./loop.js";
import { SceneManager, type Scene } from "./scene.js";

export type PauseReason = "ad" | "hidden" | "manual" | "platform";

export interface GameEvents extends Record<string, unknown> {
  started: void;
  stopped: void;
  paused: PauseReason;
  resumed: void;
  "scene:changed": { readonly id: string };
}

export type GameOptions = GameLoopOptions;

export class Game {
  readonly events = new EventBus<GameEvents>();
  readonly scenes = new SceneManager();

  readonly #loop: GameLoop;
  #elapsedMs = 0;
  /** Nested pause sources. An ad that ends while the tab is still hidden must not resume. */
  readonly #pauseReasons = new Set<PauseReason>();

  constructor(options: GameOptions = {}) {
    this.#loop = new GameLoop(
      {
        update: (stepMs) => {
          this.#elapsedMs += stepMs;
          this.scenes.update(stepMs);
        },
        render: (alpha) => this.scenes.render(alpha),
      },
      options,
    );
  }

  /** Simulation time since start, in milliseconds. Excludes time spent paused. */
  get elapsedMs(): number {
    return this.#elapsedMs;
  }

  get running(): boolean {
    return this.#loop.running;
  }

  get paused(): boolean {
    return this.#pauseReasons.size > 0;
  }

  start(): void {
    if (this.#loop.running) return;
    this.#loop.start();
    this.events.emit("started", undefined);
  }

  stop(): void {
    if (!this.#loop.running) return;
    this.#loop.stop();
    this.events.emit("stopped", undefined);
  }

  async changeScene(scene: Scene): Promise<void> {
    await this.scenes.change(scene, { elapsedMs: this.#elapsedMs });
    this.events.emit("scene:changed", { id: scene.id });
  }

  /** Pause for one reason. Idempotent per reason. */
  pause(reason: PauseReason = "manual"): void {
    const wasPaused = this.paused;
    this.#pauseReasons.add(reason);
    if (wasPaused) return;
    this.#loop.pause();
    this.scenes.pause();
    this.events.emit("paused", reason);
  }

  /** Release one pause reason. The game resumes only once every reason is released. */
  resume(reason: PauseReason = "manual"): void {
    if (!this.#pauseReasons.delete(reason)) return;
    if (this.paused) return;
    this.#loop.resume();
    this.scenes.resume();
    this.events.emit("resumed", undefined);
  }
}
