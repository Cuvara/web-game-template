// Vite configuration.
//
// game.config.yaml is loaded and validated at build time and exposed as the virtual module
// `virtual:game-config` by scripts/build/game-config-plugin.ts. Two reasons it works this
// way rather than being fetched at runtime: a malformed config fails the build instead of
// the game, and the config the bundle was built against is fixed in the bundle — which is
// what makes a release reproducible against the plan approved at G3.

import { resolve } from "node:path";
import { defineConfig } from "vite";
import { gameConfigPlugin } from "./scripts/build/game-config-plugin.js";

export default defineConfig({
  plugins: [
    gameConfigPlugin({
      configPath: resolve(import.meta.dirname, "game.config.yaml"),
      localesDir: resolve(import.meta.dirname, "public/locales"),
    }),
  ],
  build: {
    outDir: "dist",
    target: "es2020",
    sourcemap: true,
    // Portal profiles cap bundle size — 50 MB in the Factory's GameVui profile (a figure with
    // no GameVui source), 100 on Yandex. Warn well before that so growth is visible in CI
    // rather than at release validation.
    chunkSizeWarningLimit: 2048,
  },
});
