// Build for the CrazyGames compliance demo.
//
// The @wgf/* packages resolve to their sources, as in the tests, so the demo always runs the
// adapter as written — a stale package dist would let the demo pass on code that no longer
// exists.

import { resolve } from "node:path";
import { defineConfig } from "vite";

const packageSource = (name: string): string =>
  resolve(import.meta.dirname, `../../packages/${name}/src/index.ts`);

export default defineConfig({
  root: import.meta.dirname,
  // "Use only relative paths when referring to other files in the game bundle. Never use
  // absolute paths" — https://docs.crazygames.com/requirements/technical/
  base: "./",
  resolve: {
    alias: {
      "@wgf/game-core": packageSource("game-core"),
      "@wgf/platform-sdk": packageSource("platform-sdk"),
      "@wgf/pixi-framework": packageSource("pixi-framework"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
    // Source maps are not shipped to the portal: they double the file count's worth of
    // bytes for no player benefit and publish the source. scripts/crazygames-audit.mjs flags
    // any that appear.
    sourcemap: false,
  },
  preview: { port: 4174, strictPort: true },
});
