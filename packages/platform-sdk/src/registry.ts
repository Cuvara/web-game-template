// Platform selection.
//
// The id comes from game.config.yaml, which the Factory wrote from the tech plan approved
// at G3. An unknown or unimplemented id fails loudly at startup rather than silently
// degrading to no-ads: a title that ships thinking it had a portal SDK and did not is a
// blocking assertion failure at release validation, and it is cheaper to find here.

import { CrazyGamesPlatform } from "./adapters/crazygames/platform.js";
import {
  GameDistributionPlatform,
  type GameDistributionConfig,
} from "./adapters/gamedistribution/platform.js";
import { GameMonetizePlatform } from "./adapters/gamemonetize.js";
import { GameVuiPlatform } from "./adapters/gamevui.js";
import { GenericWebPlatform } from "./adapters/generic-web.js";
import { PokiPlatform } from "./adapters/poki.js";
import { Y8Platform } from "./adapters/y8/platform.js";
import { YandexPlatform } from "./adapters/yandex.js";
import type { Platform } from "./types.js";

/**
 * Every platform id with an adapter. Most have a profile in the Factory's reference data;
 * `y8` has one proposed from this repository (config/platforms/y8.yaml), `gamedistribution` a
 * draft (config/platforms/gamedistribution.yaml), and gamemonetize's is still to be written
 * there (docs/platforms/gamemonetize.md lists the values the adapter implies).
 */
export const KNOWN_PLATFORM_IDS = [
  "generic-web",
  "yandex",
  "poki",
  "crazygames",
  "gamevui",
  "y8",
  "gamedistribution",
  "gamemonetize",
] as const;

export type PlatformId = (typeof KNOWN_PLATFORM_IDS)[number];

export interface CreatePlatformOptions {
  /** Storage namespace, normally the game id. */
  readonly namespace: string;
  /**
   * Y8's `{ appId, gameId? }`, injected at build time (virtual:platform-config). Ignored by
   * every other platform. Missing or malformed, the Y8 adapter runs without its SDK.
   */
  readonly y8?: unknown;
  /**
   * GameDistribution's per-title settings, from the gamedistribution entry in
   * game.config.yaml. Required for that platform — it has no Game ID default — and ignored
   * by every other.
   */
  readonly gamedistribution?: GameDistributionConfig;
  /**
   * The id the portal itself issued for this title, where its SDK needs one — GameMonetize's
   * Game ID. From the platform entry in game.config.yaml. Ignored by every other adapter.
   */
  readonly portalGameId?: string | null;
}

// The platform a production build is for, as a string literal. scripts/build/
// game-config-plugin.ts defines it from game.config.yaml (the first required entry, else the
// first: the same choice as primaryPlatform in src/core/config.ts). Every portal's case below
// is guarded by a comparison against it, so a build keeps only its own portal adapter (plus
// generic-web, which has no SDK): Rollup folds the others to `false` and drops them, with
// their SDK URLs and globals. Portals reject a
// bundle carrying another portal's SDK ("Only Ads requested through the CrazyGames SDK are
// allowed", https://docs.crazygames.com/requirements/ads/). Undefined outside such a build
// (unit tests, tsc consumers), where every adapter stays available.
declare const __WGF_PLATFORM__: string | undefined;
const BUILD_PLATFORM: string | undefined =
  typeof __WGF_PLATFORM__ === "string" ? __WGF_PLATFORM__ : undefined;

export function isPlatformId(value: string): value is PlatformId {
  return (KNOWN_PLATFORM_IDS as readonly string[]).includes(value);
}

export function createPlatform(id: string, options: CreatePlatformOptions): Platform {
  // generic-web carries no portal SDK, so every build keeps it: a game's fallback, or a
  // target the Factory boots on generic-web (factory.sdk.adapter_substitutes), still works.
  if (BUILD_PLATFORM !== undefined && id !== BUILD_PLATFORM && id !== "generic-web") {
    throw new Error(
      `This build is for "${BUILD_PLATFORM}" and carries only that adapter; ` +
        `createPlatform("${id}") needs a build whose game.config.yaml selects "${id}".`,
    );
  }
  // Each portal's guard is `BUILD_PLATFORM === undefined || BUILD_PLATFORM === "<id>"`,
  // written out rather than through a helper so Rollup can fold it to a constant.
  switch (id) {
    case "generic-web":
      return new GenericWebPlatform({ namespace: options.namespace });
    case "crazygames":
      if (BUILD_PLATFORM === undefined || BUILD_PLATFORM === "crazygames") {
        return new CrazyGamesPlatform({ namespace: options.namespace });
      }
      break;
    case "yandex":
      if (BUILD_PLATFORM === undefined || BUILD_PLATFORM === "yandex") {
        return new YandexPlatform({ namespace: options.namespace });
      }
      break;
    case "poki":
      if (BUILD_PLATFORM === undefined || BUILD_PLATFORM === "poki") {
        return new PokiPlatform({ namespace: options.namespace });
      }
      break;
    case "gamevui":
      if (BUILD_PLATFORM === undefined || BUILD_PLATFORM === "gamevui") {
        return new GameVuiPlatform({ namespace: options.namespace });
      }
      break;
    case "y8":
      if (BUILD_PLATFORM === undefined || BUILD_PLATFORM === "y8") {
        return new Y8Platform({ namespace: options.namespace, config: options.y8 });
      }
      break;
    case "gamedistribution":
      if (BUILD_PLATFORM === undefined || BUILD_PLATFORM === "gamedistribution") {
        // Throws without a valid Game ID: a GameDistribution build that cannot earn must not
        // boot as though it could.
        return new GameDistributionPlatform({
          namespace: options.namespace,
          gameId: options.gamedistribution?.gameId ?? "",
        });
      }
      break;
    case "gamemonetize":
      if (BUILD_PLATFORM === undefined || BUILD_PLATFORM === "gamemonetize") {
        return new GameMonetizePlatform({
          namespace: options.namespace,
          gameId: options.portalGameId ?? null,
        });
      }
      break;
  }
  throw new Error(
    `Unknown platform "${id}". Known ids: ${KNOWN_PLATFORM_IDS.join(", ")}. ` +
      `Adding a platform starts with a profile in core/reference/platforms/.`,
  );
}
