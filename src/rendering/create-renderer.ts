// Engine selection.
//
// The engine is fixed at build time: scripts/build/game-config-plugin.ts defines
// import.meta.env.WGF_ENGINE from game.config.yaml's engine.type. Both imports below are
// dynamic and guarded by that constant, so Rollup drops the other engine's branch — and its
// chunk — entirely. Bundling both would put an unused megabyte into every build, against caps
// as low as the Factory GameVui profile's 50 MB (unverified: GameVui publishes no size limit).
//
// A bundle built without the plugin (the SDK matrix harness, tests/sdk-matrix/) has no
// WGF_ENGINE and picks the engine from the argument at run time.

import type { Renderer } from "@wgf/game-core";

export type Engine = "pixijs" | "threejs";

/**
 * The engine's renderer. `engine`, if passed, must be the one the build was made for — a
 * mismatch means the code and the config disagree, and the other engine is not in the bundle.
 */
export async function createRenderer(engine?: Engine): Promise<Renderer> {
  const built = import.meta.env.WGF_ENGINE;
  if (built !== undefined && engine !== undefined && engine !== built) {
    throw new Error(
      `createRenderer("${engine}"): this build is for ${built} (engine.type in game.config.yaml)`,
    );
  }
  // Written against import.meta.env.WGF_ENGINE directly, not `built ?? engine`: the define
  // makes each condition a literal comparison, which is what lets Rollup remove the branch.
  if (
    import.meta.env.WGF_ENGINE === "pixijs" ||
    (import.meta.env.WGF_ENGINE === undefined && engine === "pixijs")
  ) {
    const { PixiRenderer } = await import("@wgf/pixi-framework");
    return new PixiRenderer();
  }
  if (
    import.meta.env.WGF_ENGINE === "threejs" ||
    (import.meta.env.WGF_ENGINE === undefined && engine === "threejs")
  ) {
    const { ThreeRenderer } = await import("@wgf/three-framework");
    return new ThreeRenderer();
  }
  throw new Error("createRenderer: no engine — built without WGF_ENGINE and none was passed");
}
