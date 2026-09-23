// One build per (engine, platform). scripts/verify/sdk-matrix-build.mjs drives this through
// SDK_MATRIX_ENGINE and WGF_PLATFORM; run by hand, it builds pixijs for the primary platform.

import { resolve } from "node:path";
import { defineConfig } from "vite";
import { gameConfigPlugin } from "../../scripts/build/game-config-plugin.js";

const ROOT = import.meta.dirname;
const REPO = resolve(ROOT, "../..");
const engine = process.env["SDK_MATRIX_ENGINE"] === "threejs" ? "threejs" : "pixijs";
const platform = process.env["WGF_PLATFORM"] ?? "generic-web";

const packageAlias = (name: string): { find: string; replacement: string } => ({
  find: `@wgf/${name}`,
  replacement: resolve(REPO, `packages/${name}/src/index.ts`),
});

export default defineConfig({
  root: ROOT,
  base: "./",
  plugins: [
    gameConfigPlugin({
      configPath: resolve(ROOT, `game.config.${engine}.yaml`),
      localesDir: resolve(ROOT, "public/locales"),
    }),
  ],
  resolve: {
    alias: [
      packageAlias("game-core"),
      packageAlias("platform-sdk"),
      packageAlias("pixi-framework"),
      packageAlias("three-framework"),
    ],
  },
  build: {
    outDir: resolve(ROOT, "dist", `${engine}-${platform}`),
    emptyOutDir: true,
    target: "es2020",
    sourcemap: false,
    chunkSizeWarningLimit: 2048,
  },
});
