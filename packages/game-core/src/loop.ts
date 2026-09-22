// Fixed-timestep game loop.
//
// Simulation advances in fixed steps and rendering interpolates between them. A variable
// timestep makes physics and gameplay depend on frame rate, which means a title behaves
// differently on the low-end Android devices several platform profiles target than it did
// on the machine it was built on.
//
// Pause is first-class rather than something the game fakes with a flag. Platform ad
// playback requires the game to actually stop — Yandex's profile calls out audio and input
// leaking through an ad break as a rejection cause — and resuming has to not replay the
// elapsed wall-clock time as a burst of catch-up steps.

import { rafScheduler, type Scheduler } from "./scheduler.js";

export interface LoopHandlers {
  /** Advance the simulation by exactly `stepMs`. Called zero or more times per frame. */
  update(stepMs: number): void;
  /**
   * Draw one frame. `alpha` in [0, 1) is how far the leftover accumulator sits between the
   * last completed step and the next one; use it to interpolate, or ignore it.
   */
  render(alpha: number): void;
}

export interface GameLoopOptions {
  /** Fixed simulation step. Default 1000/60 ms. */
  readonly stepMs?: number;
  /**
   * Largest real frame time fed to the accumulator. A backgrounded tab or a long ad break
   * produces an enormous delta; without a clamp the loop then runs hundreds of catch-up
   * steps in one frame and stalls further, which is the classic spiral of death.
   * Default 250 ms.
   */
  readonly maxFrameMs?: number;
  /** Timing source. Defaults to requestAnimationFrame; tests inject a manual one. */
  readonly scheduler?: Scheduler;
}

const DEFAULT_STEP_MS = 1000 / 60;
const DEFAULT_MAX_FRAME_MS = 250;

export class GameLoop {
  readonly stepMs: number;
  readonly maxFrameMs: number;

  readonly #scheduler: Scheduler;
  readonly #handlers: LoopHandlers;

  #handle: number | null = null;
  #lastTimeMs = 0;
  #accumulatorMs = 0;
  #paused = false;

  constructor(handlers: LoopHandlers, options: GameLoopOptions = {}) {
    this.#handlers = handlers;
    this.stepMs = options.stepMs ?? DEFAULT_STEP_MS;
    this.maxFrameMs = options.maxFrameMs ?? DEFAULT_MAX_FRAME_MS;
    this.#scheduler = options.scheduler ?? rafScheduler();

    if (this.stepMs <= 0) throw new RangeError("stepMs must be greater than 0");
    if (this.maxFrameMs < this.stepMs) {
      throw new RangeError("maxFrameMs must be at least stepMs");
    }
  }

  get running(): boolean {
    return this.#handle !== null;
  }

  get paused(): boolean {
    return this.#paused;
  }

  start(): void {
    if (this.running) return;
    this.#lastTimeMs = this.#scheduler.now();
    this.#accumulatorMs = 0;
    this.#schedule();
  }

  stop(): void {
    if (this.#handle !== null) this.#scheduler.cancel(this.#handle);
    this.#handle = null;
    this.#accumulatorMs = 0;
  }

  /** Stop advancing the simulation and drawing, without tearing the loop down. */
  pause(): void {
    this.#paused = true;
  }

  /**
   * Resume. Time spent paused is discarded rather than accumulated — an ad break is not
   * game time, and replaying it as catch-up steps is exactly the burst the clamp exists
   * to prevent.
   */
  resume(): void {
    if (!this.#paused) return;
    this.#paused = false;
    this.#lastTimeMs = this.#scheduler.now();
    this.#accumulatorMs = 0;
  }

  #schedule(): void {
    this.#handle = this.#scheduler.request((timeMs) => this.#frame(timeMs));
  }

  #frame(timeMs: number): void {
    this.#schedule();

    const elapsedMs = timeMs - this.#lastTimeMs;
    this.#lastTimeMs = timeMs;

    if (this.#paused) return;

    this.#accumulatorMs += Math.min(Math.max(elapsedMs, 0), this.maxFrameMs);

    while (this.#accumulatorMs >= this.stepMs) {
      this.#accumulatorMs -= this.stepMs;
      this.#handlers.update(this.stepMs);
    }

    this.#handlers.render(this.#accumulatorMs / this.stepMs);
  }
}
