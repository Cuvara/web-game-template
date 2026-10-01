// What this game ships, and when it is needed.
//
// GAME-OWNED: replace the empty manifest below with the game's own. The loader
// (AssetLoader, template-owned, in @wgf/pixi-framework) turns it into loaded assets and a
// progress number; this file is only the declaration, so what a build carries is reviewable
// without reading loader code.
//
// Files live in public/assets/ and are referenced without that prefix: public/assets/hero.png
// is `src: "assets/hero.png"`. Vite copies public/ to the build root and writes relative
// URLs (vite.config.ts sets base: "./"), which is what portals require.
//
// Group bundles by when they are needed, not by what they are. Everything in the first
// load() call sits in front of the first frame, and time to interactive is measured by the
// verify suite (pnpm test:verify).
//
// From createGame (src/game/index.ts):
//
//   import { AssetLoader } from "@wgf/pixi-framework";
//   import { MANIFEST } from "../assets/manifest.js";
//
//   const assets = new AssetLoader({
//     manifest: MANIFEST,
//     // main.ts maps this into the portal's loading bar. Report it, or the build fails
//     // release validation on a profile that requires the loading API.
//     onProgress: context.reportLoadingProgress,
//   });
//   await assets.load("boot");
//   const hero = assets.texture("hero");
//
// Load later bundles at a moment the player is already watching something — a menu, a level
// transition — not during boot.

import type { AssetManifest } from "@wgf/pixi-framework";

export const MANIFEST: AssetManifest = {
  bundles: [
    // {
    //   name: "boot",
    //   assets: [
    //     { alias: "hero", src: "assets/hero.png" },
    //     { alias: "tiles", src: "assets/tiles.json", kind: "spritesheet" },
    //   ],
    // },
  ],
};
