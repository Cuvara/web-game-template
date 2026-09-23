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
const TARGET_ID = "virtual:build-target";
const RESOLVED_VIRTUAL_ID = "\0" + VIRTUAL_ID;
const RESOLVED_LOCALES_ID = "\0" + LOCALES_ID;
const RESOLVED_TARGET_ID = "\0" + TARGET_ID;

export interface GameConfigPluginOptions {
  /** Absolute path to game.config.yaml. */
  readonly configPath: string;
  /** Absolute path to the public/locales directory. */
  readonly localesDir: string;
  /**
   * The platform this bundle is built for, when the config lists several. Defaults to the
   * WGF_PLATFORM environment variable, then to the config's own primary platform. One
   * bundle per portal: each loads only its own portal's SDK, which is what the
   * `package.platform_sdk` assertion checks.
   */
  readonly target?: string | null;
}

/** The build target, checked against the config's platforms. Throws for one it lacks. */
export function resolveBuildTarget(
  platforms: readonly { readonly id: string }[],
  target: string | null | undefined,
): string | null {
  if (!target) return null;
  if (!platforms.some((entry) => entry.id === target)) {
    throw new Error(
      `WGF_PLATFORM=${target} is not a platform in game.config.yaml ` +
        `(${platforms.map((entry) => entry.id).join(", ")}). Platforms are written from the ` +
        `approved tech plan; a build cannot target one it does not list.`,
    );
  }
  return target;
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
  const requested =
    options.target === undefined ? (process.env["WGF_PLATFORM"] ?? null) : options.target;
  return {
    name: "wgf:game-config",
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID;
      if (id === LOCALES_ID) return RESOLVED_LOCALES_ID;
      if (id === TARGET_ID) return RESOLVED_TARGET_ID;
      return null;
    },
    load(id) {
      if (id === RESOLVED_TARGET_ID) {
        const config = validateGameConfig(parse(readFileSync(options.configPath, "utf8")));
        return `export default ${JSON.stringify(resolveBuildTarget(config.platforms, requested))};`;
      }
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
