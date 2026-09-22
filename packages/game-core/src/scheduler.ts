// Frame scheduling, behind an interface.
//
// The loop never touches requestAnimationFrame directly. Tests drive frames by hand and
// headless verification runs without a browser, so the timing source has to be swappable.

/** A source of frames and of monotonic time. */
export interface Scheduler {
  /** Schedule `cb` for the next frame. Returns a handle for {@link cancel}. */
  request(cb: (timeMs: number) => void): number;
  cancel(handle: number): void;
  /** Monotonic milliseconds. Never wall-clock: the loop measures deltas, not dates. */
  now(): number;
}

/** The browser scheduler: requestAnimationFrame plus performance.now. */
export function rafScheduler(): Scheduler {
  return {
    request: (cb) => requestAnimationFrame(cb),
    cancel: (handle) => cancelAnimationFrame(handle),
    now: () => performance.now(),
  };
}

/**
 * A scheduler driven by hand. Frames only happen when {@link ManualScheduler.advance} is
 * called, which is what makes fixed-timestep behaviour testable without real time passing.
 */
export class ManualScheduler implements Scheduler {
  #time = 0;
  #nextHandle = 1;
  readonly #pending = new Map<number, (timeMs: number) => void>();

  request(cb: (timeMs: number) => void): number {
    const handle = this.#nextHandle++;
    this.#pending.set(handle, cb);
    return handle;
  }

  cancel(handle: number): void {
    this.#pending.delete(handle);
  }

  now(): number {
    return this.#time;
  }

  /** Move time forward by `deltaMs` and run every callback queued before the move. */
  advance(deltaMs: number): void {
    this.#time += deltaMs;
    const due = [...this.#pending.entries()];
    this.#pending.clear();
    for (const [, cb] of due) cb(this.#time);
  }

  /** Run `frames` frames of `deltaMs` each. */
  advanceFrames(frames: number, deltaMs: number): void {
    for (let i = 0; i < frames; i++) this.advance(deltaMs);
  }
}
