// The SDK matrix harness builds like a game would: the template's real boot pieces
// (renderer selection, game loop, bindPlatform) and the real adapters from package source,
// with each portal's SDK replaced by the mock in tests/sdk/portals.ts. Both engines are in
// the bundle because the engine is a URL parameter here rather than a config choice.
//
// Built into /build/sdk-matrix (git-ignored) and served by `vite preview` — never the dev
// server, like every other Playwright suite in this repository.

import { resolve } from "node:path";
import { defineConfig } from "vite";

const root = resolve(import.meta.dirname, "../..");
const packageSource = (name: string): string => resolve(root, `packages/${name}/src/index.ts`);

export default defineConfig({
  root: import.meta.dirname,
  base: "./",
  resolve: {
    alias: {
      "@wgf/game-core": packageSource("game-core"),
      "@wgf/platform-sdk": packageSource("platform-sdk"),
      "@wgf/pixi-framework": packageSource("pixi-framework"),
      "@wgf/three-framework": packageSource("three-framework"),
    },
  },
  build: {
    outDir: resolve(root, "build/sdk-matrix"),
    emptyOutDir: true,
    target: "es2020",
    sourcemap: false,
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      // gamemonetize.html boots GameMonetize through the adapter's own script loader.
      input: {
        index: resolve(import.meta.dirname, "index.html"),
        gamemonetize: resolve(import.meta.dirname, "gamemonetize.html"),
      },
    },
  },
});
