// Vite configuration.
//
// game.config.yaml is loaded and validated at build time and exposed as the virtual module
// `virtual:game-config`. Two reasons it works this way rather than being fetched at
// runtime: a malformed config fails the build instead of the game, and the config the
// bundle was built against is fixed in the bundle — which is what makes a release
// reproducible against the plan approved at G3.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { parse } from "yaml";
import { validateGameConfig } from "./src/core/game-config.js";

const VIRTUAL_ID = "virtual:game-config";
const RESOLVED_VIRTUAL_ID = "\0" + VIRTUAL_ID;
const CONFIG_PATH = resolve(import.meta.dirname, "game.config.yaml");

function gameConfigPlugin(): Plugin {
  return {
    name: "wgf:game-config",
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_VIRTUAL_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_VIRTUAL_ID) return null;
      const config = validateGameConfig(parse(readFileSync(CONFIG_PATH, "utf8")));
      return `export default ${JSON.stringify(config)};`;
    },
    configureServer(server) {
      server.watcher.add(CONFIG_PATH);
    },
  };
}

export default defineConfig({
  plugins: [gameConfigPlugin()],
  build: {
    outDir: "dist",
    target: "es2020",
    sourcemap: true,
    // Portals cap bundle size — 50 MB on GameVui, 100 on Yandex. Warn well before that so
    // growth is visible in CI rather than at release validation.
    chunkSizeWarningLimit: 2048,
  },
});
