// Scenes and the transitions between them.
//
// One scene is active at a time. Transitions are async because entering a scene usually
// means loading something, and they are serialised because two overlapping transitions
// leave the manager holding a scene nobody exited.

export interface SceneContext {
  /** Milliseconds of simulation time since the game started. */
  readonly elapsedMs: number;
}

export interface Scene {
  readonly id: string;
  enter?(context: SceneContext): void | Promise<void>;
  exit?(): void | Promise<void>;
  update?(stepMs: number): void;
  render?(alpha: number): void;
  /** Called when the platform takes the foreground away — an ad break, a hidden tab. */
  pause?(): void;
  resume?(): void;
}

export class SceneManager {
  #current: Scene | null = null;
  #transition: Promise<void> | null = null;

  get current(): Scene | null {
    return this.#current;
  }

  get transitioning(): boolean {
    return this.#transition !== null;
  }

  /**
   * Exit the current scene, then enter `next`. Concurrent calls queue behind each other,
   * so the exit/enter pairs never interleave.
   */
  change(next: Scene, context: SceneContext): Promise<void> {
    const run = async (): Promise<void> => {
      await this.#current?.exit?.();
      this.#current = next;
      await next.enter?.(context);
    };

    const chained = (this.#transition ?? Promise.resolve()).then(run, run);
    this.#transition = chained;
    // Settled either way, clear the slot — but only if nothing queued behind us since.
    // The rejection is swallowed here and re-raised to whoever awaited `chained`.
    void chained
      .catch(() => undefined)
      .then(() => {
        if (this.#transition === chained) this.#transition = null;
      });
    return chained;
  }

  update(stepMs: number): void {
    this.#current?.update?.(stepMs);
  }

  render(alpha: number): void {
    this.#current?.render?.(alpha);
  }

  pause(): void {
    this.#current?.pause?.();
  }

  resume(): void {
    this.#current?.resume?.();
  }
}
