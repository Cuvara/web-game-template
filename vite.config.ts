// Vite configuration.
//
// game.config.yaml is loaded and validated at build time and exposed as the virtual module
// `virtual:game-config` by scripts/build/game-config-plugin.ts. Two reasons it works this
// way rather than being fetched at runtime: a malformed config fails the build instead of
// the game, and the config the bundle was built against is fixed in the bundle — which is
// what makes a release reproducible against the plan approved at G3.
//
// One build is for one platform and one engine: WGF_TARGET_PLATFORM picks the platforms[]
// entry (default the first required one), and the plugin keeps every other adapter and the
// other engine out of the bundle. `pnpm build` writes that one build to dist/;
// `pnpm build:platforms` (scripts/build/build-platforms.mjs) runs this config once per entry.

import { resolve } from "node:path";
import { defineConfig } from "vite";
import { gameConfigPlugin } from "./scripts/build/game-config-plugin.js";

export default defineConfig({
  plugins: [
    gameConfigPlugin({
      // WGF_GAME_CONFIG builds against another config without editing game.config.yaml —
      // the SDK browser smoke builds one bundle per engine × platform this way. Unset in a
      // normal build, which is always the game.config.yaml the Factory wrote. An empty value
      // counts as unset, as in scripts/_shared.mjs.
      configPath: resolve(
        import.meta.dirname,
        process.env["WGF_GAME_CONFIG"] || "game.config.yaml",
      ),
      localesDir: resolve(import.meta.dirname, "public/locales"),
    }),
  ],
  // Relative asset URLs. Portals serve a build from a path they choose — CrazyGames states
  // "Use only relative paths ... Never use absolute paths, as they will fail to load" — and
  // Vite's default base of "/" writes absolute ones into index.html.
  base: "./",
  build: {
    outDir: "dist",
    target: "es2020",
    // "hidden" emits the .map files for local debugging but strips the
    // `//# sourceMappingURL=` comment from the shipped .js, so a browser on a public
    // portal never auto-fetches a map even if one leaked into a submission. The release
    // packager (scripts/release/package.mjs) additionally excludes *.map from the zip,
    // so maps stay on the build machine and never enter the portal submission at all.
    sourcemap: "hidden",
    // Portal profiles cap bundle size — 50 MB in the Factory's GameVui profile (a figure with
    // no GameVui source), 100 on Yandex. Warn well before that so growth is visible in CI
    // rather than at release validation.
    chunkSizeWarningLimit: 2048,
  },
});
