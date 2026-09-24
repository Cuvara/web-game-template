// Platform selection.
//
// The id comes from game.config.yaml, which the Factory wrote from the tech plan approved
// at G3. An unknown or unimplemented id fails loudly at startup rather than silently
// degrading to no-ads: a title that ships thinking it had a portal SDK and did not is a
// blocking assertion failure at release validation, and it is cheaper to find here.

import { CrazyGamesPlatform } from "./adapters/crazygames/platform.js";
import { GameMonetizePlatform } from "./adapters/gamemonetize.js";
import { GameVuiPlatform } from "./adapters/gamevui.js";
import { GenericWebPlatform } from "./adapters/generic-web.js";
import { PokiPlatform } from "./adapters/poki.js";
import { YandexPlatform } from "./adapters/yandex.js";
import type { Platform } from "./types.js";

/**
 * Every platform id with an adapter. All but gamemonetize have a profile in the Factory's
 * reference data; gamemonetize's profile is still to be written there
 * (docs/platforms/gamemonetize.md lists the values the adapter implies).
 */
export const KNOWN_PLATFORM_IDS = [
  "generic-web",
  "yandex",
  "poki",
  "crazygames",
  "gamevui",
  "gamemonetize",
] as const;

export type PlatformId = (typeof KNOWN_PLATFORM_IDS)[number];

export interface CreatePlatformOptions {
  /** Storage namespace, normally the game id. */
  readonly namespace: string;
  /**
   * The id the portal itself issued for this title, where its SDK needs one — GameMonetize's
   * Game ID. From the platform entry in game.config.yaml. Ignored by every other adapter.
   */
  readonly portalGameId?: string | null;
}

export function isPlatformId(value: string): value is PlatformId {
  return (KNOWN_PLATFORM_IDS as readonly string[]).includes(value);
}

export function createPlatform(id: string, options: CreatePlatformOptions): Platform {
  switch (id) {
    case "generic-web":
      return new GenericWebPlatform({ namespace: options.namespace });
    case "crazygames":
      return new CrazyGamesPlatform({ namespace: options.namespace });
    case "yandex":
      return new YandexPlatform({ namespace: options.namespace });
    case "poki":
      return new PokiPlatform({ namespace: options.namespace });
    case "gamevui":
      return new GameVuiPlatform({ namespace: options.namespace });
    case "gamemonetize":
      return new GameMonetizePlatform({
        namespace: options.namespace,
        gameId: options.portalGameId ?? null,
      });
    default:
      throw new Error(
        `Unknown platform "${id}". Known ids: ${KNOWN_PLATFORM_IDS.join(", ")}. ` +
          `Adding a platform starts with a profile in core/reference/platforms/.`,
      );
  }
}
