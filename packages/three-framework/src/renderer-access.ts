// Reaching the Three.js renderer from game code.
//
// main.ts creates the renderer before the game exists and hands it over as the engine-agnostic
// `Renderer`, so every 3D game starts by narrowing it — and writes the same `kind` check and
// cast by hand (examples/neon-drift-arena/wgf-golden/src/rendering/threejs/arena.ts did). The
// check is worth keeping: a game built with `engine.type: pixijs` by mistake then fails with a
// sentence naming the config instead of a property access on the wrong object.

import type { Renderer } from "@wgf/game-core";
import type { ThreeRenderer } from "./renderer.js";

/**
 * The Three.js renderer behind `context.renderer`.
 *
 * ```ts
 * const three = asThreeRenderer(context.renderer);
 * three.scene.add(level);
 * ```
 *
 * Call it inside `src/rendering/threejs/` — the one directory allowed to import `three`.
 */
export function asThreeRenderer(renderer: Renderer): ThreeRenderer {
  if (renderer.kind !== "threejs") {
    throw new Error(
      `asThreeRenderer: this game draws with Three.js, but the build is for ${renderer.kind} ` +
        "(engine.type in game.config.yaml)",
    );
  }
  return renderer as ThreeRenderer;
}
