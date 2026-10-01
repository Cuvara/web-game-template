// Binds the ported ArenaView to the template's renderer and aims its camera.
//
// GOLDEN-RUN REPLAY, written by the Factory's golden-run replay developer; not agent-written.
// main.ts gets its renderer from the template's createRenderer, which returns the engine-
// agnostic Renderer. This file, inside src/rendering/threejs/, is the one place that knows it
// is a ThreeRenderer - the engine stays behind this directory. The camera placement is the
// example's (examples/neon-drift-arena/src/main.ts).

import type { Renderer } from "@wgf/game-core";
import type { ThreeRenderer } from "@wgf/three-framework";
import { Vector3 } from "three";
import { ArenaView } from "./arena-view.js";

export function createArenaView(renderer: Renderer): ArenaView {
  if (renderer.kind !== "threejs") {
    throw new Error(`Neon Drift Arena draws with Three.js; game.config.yaml says ${renderer.kind}`);
  }
  const three = renderer as ThreeRenderer;
  // The renderer created the camera at (0,0,5) facing -Z; lift and tilt it so the arena
  // reads in perspective.
  three.camera.position.set(0, 4.5, 8);
  three.camera.lookAt(0, 0, -12);
  three.camera.updateProjectionMatrix();
  const view = new ArenaView();
  view.attach(three.scene);
  return view;
}

/**
 * Where a box in the arena is drawn: its screen bounds in CSS px of `surface`, from the
 * camera createArenaView aimed. For the play probe (game/play-probe.ts); never drawn.
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
