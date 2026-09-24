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
// Same rule, same test: must equal Y8_SDK_URL in packages/platform-sdk/src/adapters/y8/sdk.ts.
const Y8_SDK_URL = "https://cdn.y8.com/minimal-sdk/2-0/y8.min.js";

const VIRTUAL_ID = "virtual:game-config";
const LOCALES_ID = "virtual:locales";
const PLATFORM_CONFIG_ID = "virtual:platform-config";
const RESOLVED_VIRTUAL_ID = "\0" + VIRTUAL_ID;
const RESOLVED_LOCALES_ID = "\0" + LOCALES_ID;
const RESOLVED_PLATFORM_CONFIG_ID = "\0" + PLATFORM_CONFIG_ID;

/** Portal settings that are per title but have no place in game.config.yaml. */
export interface PlatformConfig {
  /** Y8 App ID and Game ID, or null when the build was given none. */
  readonly y8: { readonly appId: string; readonly gameId: string | null } | null;
}

// Same rule as validateY8Config in the Y8 adapter: the docs give no format, so only what any
// identifier must satisfy. Duplicated rather than imported for the reason given above.
const Y8_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Y8's App ID and Game ID (https://docs.y8.com/studio/sdk-initialization/) come from the
 * environment — WGF_Y8_APP_ID and WGF_Y8_GAME_ID — never from a committed file. The Factory's
 * game_config schema allows no extra keys, and IDs committed to a template would send every
 * game built from it to one account. Unset leaves the adapter unconfigured (it runs without
 * the SDK and says so); set but malformed fails the build, like a malformed game.config.yaml.
 */
export function readPlatformConfig(env: NodeJS.ProcessEnv = process.env): PlatformConfig {
  const appId = env["WGF_Y8_APP_ID"]?.trim() ?? "";
  const gameId = env["WGF_Y8_GAME_ID"]?.trim() ?? "";
  if (appId === "") {
    if (gameId !== "") throw new Error("WGF_Y8_GAME_ID is set but WGF_Y8_APP_ID is not");
    return { y8: null };
  }
  if (!Y8_IDENTIFIER.test(appId)) throw new Error(`WGF_Y8_APP_ID "${appId}" is malformed`);
  if (gameId !== "" && !Y8_IDENTIFIER.test(gameId)) {
    throw new Error(`WGF_Y8_GAME_ID "${gameId}" is malformed`);
  }
  return { y8: { appId, gameId: gameId === "" ? null : gameId } };
}

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
      if (id === PLATFORM_CONFIG_ID) return RESOLVED_PLATFORM_CONFIG_ID;
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
      if (id === RESOLVED_PLATFORM_CONFIG_ID) {
        const config = validateGameConfig(parse(readFileSync(options.configPath, "utf8")));
        const platformConfig = readPlatformConfig();
        const targetsY8 = config.platforms.some((entry) => entry.id === "y8");
        if (targetsY8 && !platformConfig.y8) {
          this.warn(
            "this build targets y8 but WGF_Y8_APP_ID is unset — the game will run without " +
              "the Y8 SDK: no ads, no plays counted, guest saves only",
          );
        }
        // Only a build that targets Y8 carries its IDs.
        return `export default ${JSON.stringify(targetsY8 ? platformConfig : { y8: null })};`;
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
    //
    // Y8 documents the same place with `async` (https://docs.y8.com/sdk/intro/#installation),
    // and only for a build that has an App ID to initialize it with. The adapter handles the
    // resulting race — the script may run before or after it listens for y8sdk.ready.
    transformIndexHtml() {
      const config = validateGameConfig(parse(readFileSync(options.configPath, "utf8")));
      const primary =
        config.platforms.find((entry) => entry.role === "required") ?? config.platforms[0];
      if (primary?.id === "crazygames") {
        return [{ tag: "script", attrs: { src: CRAZYGAMES_SDK_URL }, injectTo: "head-prepend" }];
      }
      if (primary?.id === "y8" && readPlatformConfig().y8) {
        return [
          { tag: "script", attrs: { src: Y8_SDK_URL, async: true }, injectTo: "head-prepend" },
        ];
      }
      return [];
    },
  };
}
