// Build for the Tower Merge Rush example.
//
// The @wgf/* packages resolve to their sources, as in the tests and the other examples, so
// the game always runs the framework and adapter as written — a stale package dist would let
// the example pass on code that no longer exists.

import { resolve } from "node:path";
import { defineConfig } from "vite";

const packageSource = (name: string): string =>
  resolve(import.meta.dirname, `../../packages/${name}/src/index.ts`);

export default defineConfig({
  root: import.meta.dirname,
  // Portals serve the archive from a CDN path, not a domain root, so asset references must be
  // relative. Harmless for a self-hosted build and required by every portal profile.
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
    sourcemap: false,
  },
  server: { port: 5175, strictPort: true },
  preview: { port: 4175, strictPort: true },
});
