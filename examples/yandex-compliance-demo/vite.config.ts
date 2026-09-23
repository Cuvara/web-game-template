// Build for the Yandex compliance demo.
//
// Two settings here are Yandex requirements rather than preferences:
//
//   base: "./"   The archive is served from a path on the portal's CDN, not from a domain
//                root, so every asset reference must be relative. `/sdk.js` is the one
//                root-relative URL, and the docs are explicit that it should be.
//   no sourcemap Maps double the archive for nothing a player or moderator needs, and they
//                publish the source. The template's own build keeps them for CI.
//
// @wgf/* resolve to package sources, as in the vitest configuration, so the demo always
// builds against the code as written rather than a stale dist/.

import { resolve } from "node:path";
import { defineConfig } from "vite";
import { gameConfigPlugin } from "../../scripts/build/game-config-plugin.js";

const ROOT = import.meta.dirname;
const REPO = resolve(ROOT, "../..");

const packageAlias = (name: string): { find: string; replacement: string } => ({
  find: `@wgf/${name}`,
  replacement: resolve(REPO, `packages/${name}/src/index.ts`),
});

export default defineConfig({
  root: ROOT,
  base: "./",
  plugins: [
    gameConfigPlugin({
      configPath: resolve(ROOT, "game.config.yaml"),
      localesDir: resolve(ROOT, "public/locales"),
    }),
  ],
  resolve: {
    alias: [
      packageAlias("game-core"),
      packageAlias("platform-sdk"),
      packageAlias("pixi-framework"),
    ],
  },
  build: {
    outDir: resolve(ROOT, "dist"),
    emptyOutDir: true,
    target: "es2020",
    sourcemap: false,
    // Yandex's cap is 100 MB uncompressed (requirement 1.21); this demo is well under 1.
    chunkSizeWarningLimit: 1024,
  },
  server: { port: 5174, strictPort: true },
  preview: { port: 4174, strictPort: true },
});
