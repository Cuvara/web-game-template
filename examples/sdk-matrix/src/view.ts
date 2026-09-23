// What main.ts needs from an engine. Each engine's implementation lives under
// src/rendering/<engine>/ and is the only code that imports it.

import type { Renderer } from "@wgf/game-core";

export interface MatrixView {
  readonly renderer: Renderer;
  /** Draw one frame: a shape that turns with simulation time and grows with the score. */
  draw(elapsedMs: number, score: number): void;
}
