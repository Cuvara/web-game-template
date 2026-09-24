// The Vite plugin that turns game.config.yaml and public/locales/ into virtual modules.
//
// Shared by the template's own vite.config.ts and by anything under examples/, so every
// build validates its config the same way. See vite.config.ts for why the config is
// compiled in rather than fetched.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import type { Plugin } from "vite";
import { parse } from "yaml";
import { validateGameConfig, type GameConfig } from "../../src/core/game-config.js";

// Kept as a literal rather than imported from @wgf/platform-sdk: this file runs under Node
// before the packages are built. tests/integration/crazygames-build.test.ts asserts the two
// agree.
const CRAZYGAMES_SDK_URL = "https://sdk.crazygames.com/crazygames-sdk-v3.js";

const VIRTUAL_ID = "virtual:game-config";
const LOCALES_ID = "virtual:locales";
const RESOLVED_VIRTUAL_ID = "\0" + VIRTUAL_ID;
const RESOLVED_LOCALES_ID = "\0" + LOCALES_ID;

/**
 * game.config.yaml, validated, with WGF_GAMEMONETIZE_GAME_ID applied to the gamemonetize
 * entry when set. The override lets a release job supply the Game ID without it being
 * committed; it is validated exactly like one written in the file.
 */
export function loadGameConfig(
  configPath: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): GameConfig {
  const raw = parse(readFileSync(configPath, "utf8")) as { platforms?: unknown };
  const override = env["WGF_GAMEMONETIZE_GAME_ID"];
  if (override !== undefined && override !== "" && Array.isArray(raw?.platforms)) {
    raw.platforms = raw.platforms.map((entry: unknown) =>
      (entry as { id?: unknown })?.id === "gamemonetize"
        ? { ...(entry as object), game_id: override }
        : entry,
    );
  }
  return validateGameConfig(raw);
}

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
        const config = loadGameConfig(options.configPath);
        const gameMonetize = config.platforms.find((entry) => entry.id === "gamemonetize");
        if (gameMonetize && !gameMonetize.game_id) {
          this.warn(
            "the gamemonetize platform entry has no game_id (and WGF_GAMEMONETIZE_GAME_ID is " +
              "unset) — the build runs without ads and GameMonetize's Verify Game will fail",
          );
        }
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
    // CrazyGames documents one way to load its SDK: a classic <script> in <head>, before the
    // game code. Only a build whose primary platform is crazygames gets it — every other
    // profile asserts a bundle free of foreign portal SDKs.
    transformIndexHtml() {
      const config = validateGameConfig(parse(readFileSync(options.configPath, "utf8")));
      const primary =
        config.platforms.find((entry) => entry.role === "required") ?? config.platforms[0];
      if (primary?.id !== "crazygames") return [];
      return [{ tag: "script", attrs: { src: CRAZYGAMES_SDK_URL }, injectTo: "head-prepend" }];
    },
  };
}
