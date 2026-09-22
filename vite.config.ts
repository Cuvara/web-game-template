// Vite configuration.
//
// game.config.yaml is loaded and validated at build time and exposed as the virtual module
// `virtual:game-config`. Two reasons it works this way rather than being fetched at
// runtime: a malformed config fails the build instead of the game, and the config the
// bundle was built against is fixed in the bundle — which is what makes a release
// reproducible against the plan approved at G3.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { parse } from "yaml";
import { validateGameConfig } from "./src/core/game-config.js";

const VIRTUAL_ID = "virtual:game-config";
const LOCALES_ID = "virtual:locales";
const RESOLVED_VIRTUAL_ID = "\0" + VIRTUAL_ID;
const RESOLVED_LOCALES_ID = "\0" + LOCALES_ID;
const CONFIG_PATH = resolve(import.meta.dirname, "game.config.yaml");
const LOCALES_DIR = resolve(import.meta.dirname, "public/locales");

/**
 * The locales the package ships, read from the files themselves. Deliberately not declared
 * anywhere: the files are what gets copied into the build, and the files are what release
 * validation measures for `package.locales`. A declaration could disagree with them.
 */
function shippedLocales(): string[] {
  if (!existsSync(LOCALES_DIR)) return [];
  return readdirSync(LOCALES_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""))
    .sort();
}

function gameConfigPlugin(): Plugin {
  return {
    name: "wgf:game-config",
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID;
      if (id === LOCALES_ID) return RESOLVED_LOCALES_ID;
      return null;
    },
    load(id) {
      if (id === RESOLVED_VIRTUAL_ID) {
        const config = validateGameConfig(parse(readFileSync(CONFIG_PATH, "utf8")));
        return `export default ${JSON.stringify(config)};`;
      }
      if (id === RESOLVED_LOCALES_ID) {
        const locales = shippedLocales();
        if (locales.length === 0) {
          this.warn(
            "public/locales/ is empty — package.locales will measure as [], which is a " +
              "blocking assertion on Yandex, CrazyGames and GameVui",
          );
        }
        return `export default ${JSON.stringify(locales)};`;
      }
      return null;
    },
    configureServer(server) {
      server.watcher.add(CONFIG_PATH);
      server.watcher.add(LOCALES_DIR);
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
