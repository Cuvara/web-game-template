// The compliance demo builds exactly like a game repository would: its own index.html, its
// own dist/, the template packages consumed from source.
//
// Source maps are off. Poki asks for a clean build — "remove development tools, debug code,
// and testing artifacts" — and a map ships the unminified source alongside it.

import { resolve } from "node:path";
import { defineConfig } from "vite";

const packageSource = (name: string): string =>
  resolve(import.meta.dirname, `../../packages/${name}/src/index.ts`);

export default defineConfig({
  root: import.meta.dirname,
  // Relative asset URLs: Poki serves the build from its own CDN path, not the domain root.
  base: "./",
  resolve: {
    alias: {
      "@wgf/game-core": packageSource("game-core"),
      "@wgf/platform-sdk": packageSource("platform-sdk"),
      "@wgf/pixi-framework": packageSource("pixi-framework"),
    },
    dedupe: ["pixi.js"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
    sourcemap: false,
    chunkSizeWarningLimit: 2048,
  },
});
