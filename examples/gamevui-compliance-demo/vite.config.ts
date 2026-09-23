// Build for a GameVui submission.
//
// `base: "./"` is the one setting that matters most. GameVui serves each game from its own
// folder, e.g. https://e.gamevui.vn/web/<yyyy>/<mm>/<slug>/ (observed, not documented), so
// an absolute `/assets/...` path would 404 there. Every URL in the build is relative.
//
// No source maps in the build: they would double the package and ship the source to a
// portal that has not asked for it.

import { resolve } from "node:path";
import { defineConfig } from "vite";

const packages = resolve(import.meta.dirname, "../../packages");

export default defineConfig({
  base: "./",
  resolve: {
    // Package sources, as the template's own tests do, so the demo never runs against a
    // stale packages/*/dist.
    alias: [
      { find: "@wgf/game-core", replacement: `${packages}/game-core/src/index.ts` },
      { find: "@wgf/platform-sdk", replacement: `${packages}/platform-sdk/src/index.ts` },
      { find: "@wgf/pixi-framework", replacement: `${packages}/pixi-framework/src/index.ts` },
    ],
    dedupe: ["pixi.js"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
    sourcemap: false,
    assetsInlineLimit: 0,
  },
  preview: { port: 4188, strictPort: true },
});
