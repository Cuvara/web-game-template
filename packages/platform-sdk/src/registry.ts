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
 * Every platform id with an adapter. Each has a profile in the Factory's reference data
 * (core/reference/platforms/<id>.yaml, 1.0.0); the ones a game pins are vendored into its
 * config/platforms/ at scaffolding.
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
    case "y8":
      return new Y8Platform({ namespace: options.namespace, config: options.y8 });
    case "gamedistribution":
      // Throws without a valid Game ID: a GameDistribution build that cannot earn must not
      // boot as though it could.
      return new GameDistributionPlatform({
        namespace: options.namespace,
        gameId: options.gamedistribution?.gameId ?? "",
      });
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
