// Binds the Tower Merge Rush view to the template's renderer.
//
// GOLDEN-RUN REPLAY, written by the Factory's golden-run replay developer; not agent-written.
// The template's main.ts initialises the engine-agnostic Renderer before createGame runs, so
// the design's background colour is applied here. This file, inside src/rendering/pixijs/,
// is the one place that knows it is a PixiRenderer - the engine stays behind this directory.
// The view draws the design's art (tower-view.ts) from textures loaded through the runtime
// asset manifest (art.ts); the example's procedural board-view.ts is ported beside it but no
// longer drawn.

import type { Renderer } from "@wgf/game-core";
import type { PixiRenderer } from "@wgf/pixi-framework";
import type { RuntimeAssets } from "../../game/runtime-assets.js";
import { loadBoardArt } from "./art.js";
import { TowerView } from "./tower-view.js";

/** The design's paper backdrop, behind the board art. */
const BACKGROUND = 0xf4ede1;

export async function createBoardView(
  renderer: Renderer,
  assets: RuntimeAssets,
  labels: { readonly next: string },
  onProgress?: (share: number) => void,
): Promise<TowerView> {
  if (renderer.kind !== "pixijs") {
    throw new Error(`Tower Merge Rush draws with PixiJS; game.config.yaml says ${renderer.kind}`);
  }
  const pixi = renderer as PixiRenderer;
  pixi.app.renderer.background.color = BACKGROUND;
  const art = await loadBoardArt(assets, onProgress);
  return new TowerView(pixi.stage, art, labels);
}
