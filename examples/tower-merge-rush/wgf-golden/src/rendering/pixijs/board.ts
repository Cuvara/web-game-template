// Binds the ported BoardView to the template's renderer.
//
// GOLDEN-RUN REPLAY, written by the Factory's golden-run replay developer; not agent-written.
// The template's main.ts initialises the engine-agnostic Renderer before createGame runs, so
// the example's background colour is applied here. This file, inside src/rendering/pixijs/,
// is the one place that knows it is a PixiRenderer - the engine stays behind this directory.

import type { Renderer } from "@wgf/game-core";
import type { PixiRenderer } from "@wgf/pixi-framework";
import { BoardView } from "./board-view.js";

/** The example's backdrop, matching index.html's page colour. */
const BACKGROUND = 0x0b1026;

export function createBoardView(renderer: Renderer): BoardView {
  if (renderer.kind !== "pixijs") {
    throw new Error(`Tower Merge Rush draws with PixiJS; game.config.yaml says ${renderer.kind}`);
  }
  const pixi = renderer as PixiRenderer;
  pixi.app.renderer.background.color = BACKGROUND;
  return new BoardView(pixi.stage);
}
