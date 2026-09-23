// The Vite plugin that turns game.config.yaml and public/locales/ into virtual modules.
//
// Shared by the template's own vite.config.ts and by anything under examples/, so every
// build validates its config the same way. See vite.config.ts for why the config is
// compiled in rather than fetched.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import type { Plugin } from "vite";
import { parse } from "yaml";
import { validateGameConfig } from "../../src/core/game-config.js";

const VIRTUAL_ID = "virtual:game-config";
const LOCALES_ID = "virtual:locales";
const RESOLVED_VIRTUAL_ID = "\0" + VIRTUAL_ID;
const RESOLVED_LOCALES_ID = "\0" + LOCALES_ID;

export interface GameConfigPluginOptions {
  /** Absolute path to game.config.yaml. */
  readonly configPath: string;
  /** Absolute path to the public/locales directory. */
  readonly localesDir: string;
}

/**
 * The locales the package ships, read from the files themselves. Deliberately not declared
 * anywhere: the files are what gets copied into the build, and the files are what release
 * validation measures for `package.locales`. A declaration could disagree with them.
 */
export function shippedLocales(localesDir: string): string[] {
  if (!existsSync(localesDir)) return [];
  return readdirSync(localesDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""))
    .sort();
}

export function gameConfigPlugin(options: GameConfigPluginOptions): Plugin {
  return {
    name: "wgf:game-config",
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID;
      if (id === LOCALES_ID) return RESOLVED_LOCALES_ID;
      return null;
    },
    load(id) {
      if (id === RESOLVED_VIRTUAL_ID) {
        const config = validateGameConfig(parse(readFileSync(options.configPath, "utf8")));
        return `export default ${JSON.stringify(config)};`;
      }
      if (id === RESOLVED_LOCALES_ID) {
        const locales = shippedLocales(options.localesDir);
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
      server.watcher.add(options.configPath);
      server.watcher.add(options.localesDir);
    },
  };
}
