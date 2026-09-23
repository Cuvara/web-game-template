// Engine selection.
//
// Dynamic imports on purpose: only the engine named in game.config.yaml ends up in the
// bundle. Bundling both would put an unused megabyte into every build, against caps as low
// as the Factory GameVui profile's 50 MB (unverified: GameVui publishes no size limit).

import type { Renderer } from "@wgf/game-core";

export async function createRenderer(engine: "pixijs" | "threejs"): Promise<Renderer> {
  switch (engine) {
    case "pixijs": {
      const { PixiRenderer } = await import("@wgf/pixi-framework");
      return new PixiRenderer();
    }
    case "threejs": {
      const { ThreeRenderer } = await import("@wgf/three-framework");
      return new ThreeRenderer();
    }
  }
}
