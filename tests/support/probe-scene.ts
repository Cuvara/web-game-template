// A scene for test harnesses that boot outside src/main.ts (tests/sdk-matrix).
//
// Test-local on purpose: the template's BootScene is game code a real game deletes, so no
// test may import it (tests/unit/platform/no-game-imports.test.ts enforces that). Without
// main.ts to publish the probe attributes, this scene writes them itself — the same
// #hud[data-engine|data-scene|data-steps] contract the smoke suite reads.

import type { Renderer, Scene } from "@wgf/game-core";

export interface ProbeSceneOptions {
  readonly renderer: Renderer;
  readonly hud: HTMLElement;
}

export class ProbeScene implements Scene {
  readonly id = "probe";

  readonly #renderer: Renderer;
  readonly #hud: HTMLElement;
  #steps = 0;

  constructor(options: ProbeSceneOptions) {
    this.#renderer = options.renderer;
    this.#hud = options.hud;
  }

  enter(): void {
    this.#hud.dataset["engine"] = this.#renderer.kind;
    this.#hud.dataset["scene"] = this.id;
  }

  update(): void {
    this.#steps += 1;
    this.#hud.dataset["steps"] = String(this.#steps);
  }

  render(alpha: number): void {
    this.#renderer.render(alpha);
  }
}
