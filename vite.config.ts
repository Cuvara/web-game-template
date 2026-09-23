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

// Kept as a literal rather than imported from @wgf/platform-sdk: this file runs under Node
// before the packages are built. tests/integration/crazygames-build.test.ts asserts the two
// agree.
const CRAZYGAMES_SDK_URL = "https://sdk.crazygames.com/crazygames-sdk-v3.js";

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
    // CrazyGames documents one way to load its SDK: a classic <script> in <head>, before the
    // game code. Only a build whose primary platform is crazygames gets it — every other
    // profile asserts a bundle free of foreign portal SDKs.
    transformIndexHtml() {
      const config = validateGameConfig(parse(readFileSync(CONFIG_PATH, "utf8")));
      const primary =
        config.platforms.find((entry) => entry.role === "required") ?? config.platforms[0];
      if (primary?.id !== "crazygames") return [];
      return [{ tag: "script", attrs: { src: CRAZYGAMES_SDK_URL }, injectTo: "head-prepend" }];
    },
  };
}

export default defineConfig({
  plugins: [gameConfigPlugin()],
  // Relative asset URLs. Portals serve a build from a path they choose — CrazyGames states
  // "Use only relative paths ... Never use absolute paths, as they will fail to load" — and
  // Vite's default base of "/" writes absolute ones into index.html.
  base: "./",
  build: {
    outDir: "dist",
    target: "es2020",
    sourcemap: true,
    // Portals cap bundle size — 50 MB on GameVui, 100 on Yandex. Warn well before that so
    // growth is visible in CI rather than at release validation.
    chunkSizeWarningLimit: 2048,
  },
});
