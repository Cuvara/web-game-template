// Binds the Tower Merge Rush view to the template's renderer.
//
// GOLDEN-RUN REPLAY, written by the Factory's golden-run replay developer; not agent-written.
// main.ts gets its renderer from the template's createRenderer, which returns the engine-
// agnostic Renderer. This file, inside src/rendering/pixijs/, is the one place that knows it
// is a PixiRenderer - the engine stays behind this directory. The view draws the design's art
// (tower-view.ts) from textures loaded through the runtime asset manifest (art.ts); the
// example's procedural board-view.ts is ported beside it but no longer drawn.

import type { Renderer } from "@wgf/game-core";
import type { PixiRenderer } from "@wgf/pixi-framework";
import type { RuntimeAssets } from "../../game/runtime-assets.js";
import { loadBoardArt } from "./art.js";
import { TowerView } from "./tower-view.js";

export async function createBoardView(
  renderer: Renderer,
  assets: RuntimeAssets,
  labels: { readonly next: string },
  onProgress?: (share: number) => void,
): Promise<TowerView> {
  if (renderer.kind !== "pixijs") {
    throw new Error(`Tower Merge Rush draws with PixiJS; game.config.yaml says ${renderer.kind}`);
  }
  const art = await loadBoardArt(assets, onProgress);
  return new TowerView((renderer as PixiRenderer).stage, art, labels);
}
