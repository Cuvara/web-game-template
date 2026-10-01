// Binds Neon Drift Arena's view to the template's renderer.
//
// GOLDEN-RUN REPLAY, written by hand for the Factory's golden-run replay developer; not
// agent-written. The template's main.ts initialises the engine-agnostic Renderer before
// createGame runs, so the backdrop colour is applied here. This file, inside
// src/rendering/threejs/, is the one place that knows it is a ThreeRenderer - the engine stays
// behind this directory. The view places and aims the camera itself (a chase camera that keeps
// the arena's width in frame) and replaces the backdrop with its sky once attached.

import type { Renderer } from "@wgf/game-core";
import type { ThreeRenderer } from "@wgf/three-framework";
import { Vector3 } from "three";
import { ArenaView, type ArenaViewEvents } from "./arena-view.js";
import type { ArenaAssets } from "./assets.js";

export { loadArenaAssets } from "./assets.js";

/** The example's backdrop, matching index.html's page colour; the sky covers it once drawn. */
const BACKGROUND = 0x05060f;

export function createArenaView(
  renderer: Renderer,
  assets: ArenaAssets,
  events: ArenaViewEvents = {},
): ArenaView {
  if (renderer.kind !== "threejs") {
    throw new Error(`Neon Drift Arena draws with Three.js; game.config.yaml says ${renderer.kind}`);
  }
  const three = renderer as ThreeRenderer;
  // The renderer created the background as a Color; recolour it rather than import three.
  const background = three.scene.background;
  if (background && "setHex" in background) background.setHex(BACKGROUND);
  const view = new ArenaView(assets, events);
  view.attach(three.scene, three.camera);
  return view;
}

/**
 * Where a box in the arena is drawn: its screen bounds in CSS px of `surface`, from the
 * camera the view aimed. For the play probe (game/play-probe.ts); never drawn.
 */
export function screenBounds(
  renderer: Renderer,
  surface: HTMLElement,
  centre: readonly [number, number, number],
  size: readonly [number, number, number],
): { x: number; y: number; w: number; h: number; inFront: boolean } {
  const camera = (renderer as ThreeRenderer).camera;
  const rect = surface.getBoundingClientRect();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let inFront = true;
  const corner = new Vector3();
  for (const sx of [-0.5, 0.5])
    for (const sy of [-0.5, 0.5])
      for (const sz of [-0.5, 0.5]) {
        corner.set(centre[0] + sx * size[0], centre[1] + sy * size[1], centre[2] + sz * size[2]);
        const view = corner.clone().applyMatrix4(camera.matrixWorldInverse);
        if (view.z >= -camera.near) inFront = false;
        corner.project(camera);
        const px = rect.left + ((corner.x + 1) / 2) * rect.width;
        const py = rect.top + ((1 - corner.y) / 2) * rect.height;
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);
      }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, inFront };
}
