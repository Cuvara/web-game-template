// Phaser binding for `engine.type: phaserjs`.
//
// Phaser ships its own requestAnimationFrame loop (TimeStep) and its own scene manager, and
// @wgf/game-core ships a fixed-timestep loop and a scene manager of its own. Two loops means
// the simulation and the drawing disagree about how much time passed, and pause — which the
// platform profiles require to actually stop the game during an ad break — would only reach
// one of them. So Phaser's TimeStep is stopped the moment it boots and this renderer drives
// Phaser one frame at a time from `render()`: one requestAnimationFrame, one clock, and
// `Game.pause()` in game-core still stops everything.
//
// What that leaves each side owning:
//   - game-core  — the fixed simulation step (`update(stepMs)`), pause by reason, the scene
//                  the game is in, and the #hud[data-steps] probe the verify suite reads.
//   - Phaser     — its display list, input, tweens, animations, particles and physics, all
//                  advanced once per drawn frame with the real frame delta.
// Gameplay that must be frame-rate independent belongs in game-core's fixed update; Phaser
// scene `update(time, delta)` is for presentation. `core/craft/phaser.md` in the Factory
// says the same thing to whoever writes the game.

import type { Renderer, RendererOptions } from "@wgf/game-core";
import Phaser from "phaser";

export interface PhaserRendererOptions {
  /** Scenes the Phaser game boots with. Added later with `renderer.game.scene` if omitted. */
  readonly scene?: Phaser.Types.Scenes.SceneType | Phaser.Types.Scenes.SceneType[];
  /** Arcade, Matter or none. Off by default: a game that does not use it should not pay for it. */
  readonly physics?: Phaser.Types.Core.PhysicsConfig;
}

export class PhaserRenderer implements Renderer {
  readonly kind = "phaserjs" as const;

  readonly #options: PhaserRendererOptions;

  #game: Phaser.Game | null = null;
  /** Timestamp of the last manual step, for the delta Phaser's TimeStep would have supplied. */
  #lastStepMs = 0;

  constructor(options: PhaserRendererOptions = {}) {
    this.#options = options;
  }

  /** The Phaser game. Game code adds scenes and reads `game.scene` through this. */
  get game(): Phaser.Game {
    return this.#require();
  }

  async init(options: RendererOptions): Promise<void> {
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: options.container,
      width: options.width,
      height: options.height,
      backgroundColor: options.background ?? 0x101014,
      // The container is sized by the page and resize() is driven from above, so Phaser's
      // own scale modes and DPR handling stay out of it. Phaser renders at exactly the
      // width and height it is given, which is also the fill rate cap the PixiJS binding
      // spends a resolution clamp to get.
      scale: { mode: Phaser.Scale.NONE, autoCenter: Phaser.Scale.NO_CENTER },
      render: { antialias: true },
      banner: false,
      // Phaser's own audio unlock is left on: it resumes the WebAudio context on the first
      // gesture, which is the behaviour every portal expects.
      scene: this.#options.scene ?? [],
      ...(this.#options.physics ? { physics: this.#options.physics } : {}),
    });

    await new Promise<void>((resolve) => {
      game.events.once(Phaser.Core.Events.READY, () => resolve());
    });

    // Boot started the TimeStep. Stop it: this renderer is the only thing that steps Phaser.
    game.loop.stop();

    this.#game = game;
    this.#lastStepMs = 0;
  }

  resize(width: number, height: number): void {
    this.#require().scale.resize(width, height);
  }

  render(): void {
    const game = this.#require();
    const nowMs = performance.now();
    // The first frame after init or resume has no previous timestamp to measure against;
    // a zero delta advances nothing rather than jumping tweens and physics by the gap.
    const deltaMs = this.#lastStepMs === 0 ? 0 : nowMs - this.#lastStepMs;
    this.#lastStepMs = nowMs;
    game.step(nowMs, deltaMs);
  }

  destroy(): void {
    const game = this.#game;
    this.#game = null;
    this.#lastStepMs = 0;
    if (!game) return;
    // Phaser defers teardown: destroy() only sets pendingDestroy, and the next step runs it.
    // With the TimeStep stopped there is no next step, so nothing would ever be released —
    // the canvas would survive a restart, which is exactly the leak the verify suite looks
    // for. One manual step performs the destruction.
    game.destroy(true);
    game.step(performance.now(), 0);
  }

  #require(): Phaser.Game {
    if (!this.#game) throw new Error("PhaserRenderer.init() has not completed yet.");
    return this.#game;
  }
}
