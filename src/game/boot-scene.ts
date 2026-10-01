// The scaffold's one scene.
//
// It exists so the untouched template is verifiable: scaffolding requires CI green before
// any game code is written, and "green" has to mean something ran. It draws through the
// renderer every frame; main.ts publishes the scene id and the loop's step count to #hud,
// which is what the smoke test asserts — for this scene and for whatever replaces it.
//
// A game replaces this (src/game/index.ts builds it). It is not a base class and nothing
// should import from it: no template test does, so deleting it breaks nothing but index.ts.

import type { Renderer, Scene } from "@wgf/game-core";

export interface BootSceneOptions {
  readonly renderer: Renderer;
}

export class BootScene implements Scene {
  readonly id = "boot";

  readonly #renderer: Renderer;
  #steps = 0;

  constructor(options: BootSceneOptions) {
    this.#renderer = options.renderer;
  }

  get steps(): number {
    return this.#steps;
  }

  update(): void {
    this.#steps += 1;
  }

  render(alpha: number): void {
    this.#renderer.render(alpha);
  }
}
