// Platform selection.
//
// The id comes from game.config.yaml, which the Factory wrote from the tech plan approved
// at G3. An unknown or unimplemented id fails loudly at startup rather than silently
// degrading to no-ads: a title that ships thinking it had a portal SDK and did not is a
// blocking assertion failure at release validation, and it is cheaper to find here.

import { GenericWebPlatform } from "./adapters/generic-web.js";
import { YandexPlatform } from "./adapters/yandex.js";
import type { Platform } from "./types.js";

/** Every platform id that has a profile in the Factory's reference data. */
export const KNOWN_PLATFORM_IDS = [
  "generic-web",
  "yandex",
  "poki",
  "crazygames",
  "gamevui",
] as const;

export type PlatformId = (typeof KNOWN_PLATFORM_IDS)[number];

export interface CreatePlatformOptions {
  /** Storage namespace, normally the game id. */
  readonly namespace: string;
}

export function isPlatformId(value: string): value is PlatformId {
  return (KNOWN_PLATFORM_IDS as readonly string[]).includes(value);
}

export function createPlatform(id: string, options: CreatePlatformOptions): Platform {
  switch (id) {
    case "generic-web":
      return new GenericWebPlatform({ namespace: options.namespace });
    case "yandex":
      return new YandexPlatform({ namespace: options.namespace });
    case "poki":
    case "crazygames":
    case "gamevui":
      throw new Error(
        `Platform adapter "${id}" is not implemented yet. Its profile exists in ` +
          `core/reference/platforms/${id}.yaml; the adapter must be written against the ` +
          `portal's own documentation before a title targets it.`,
      );
    default:
      throw new Error(
        `Unknown platform "${id}". Known ids: ${KNOWN_PLATFORM_IDS.join(", ")}. ` +
          `Adding a platform starts with a profile in core/reference/platforms/.`,
      );
  }
}
