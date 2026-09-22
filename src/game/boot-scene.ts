// The scaffold's one scene.
//
// It exists so the untouched template is verifiable: scaffolding requires CI green before
// any game code is written, and "green" has to mean something ran. It draws through the
// renderer and publishes its frame count to the DOM, which is what the smoke test asserts.
//
// A game replaces this. It is not a base class and nothing should import from it.

import type { Renderer, Scene } from "@wgf/game-core";

export interface BootSceneOptions {
  readonly renderer: Renderer;
  /** Element the scene reports into. The smoke test reads its data attributes. */
  readonly hud: HTMLElement;
}

export class BootScene implements Scene {
  readonly id = "boot";

  readonly #renderer: Renderer;
  readonly #hud: HTMLElement;
  #steps = 0;
  #simulatedMs = 0;

  constructor(options: BootSceneOptions) {
    this.#renderer = options.renderer;
    this.#hud = options.hud;
  }

  get steps(): number {
    return this.#steps;
  }

  enter(): void {
    this.#hud.dataset["engine"] = this.#renderer.kind;
    this.#hud.dataset["scene"] = this.id;
  }

  update(stepMs: number): void {
    this.#steps += 1;
    this.#simulatedMs += stepMs;
    this.#hud.dataset["steps"] = String(this.#steps);
    this.#hud.dataset["simulatedMs"] = String(Math.round(this.#simulatedMs));
  }

  render(alpha: number): void {
    this.#renderer.render(alpha);
  }
}
