// Wiring between the platform and the game's pause state.
//
// This is the whole reason Game.pause takes a reason. A tab hidden during an ad break must
// not resume when the ad ends, and every portal that sells rewarded video has "audio or
// input leaked through the ad" somewhere in its rejection history.

import type { Game } from "@wgf/game-core";
import type { Platform } from "@wgf/platform-sdk";

export interface PlatformBinding {
  dispose(): void;
}

export function bindPlatform(game: Game, platform: Platform): PlatformBinding {
  const onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") {
      game.pause("hidden");
      platform.gameplayStop();
    } else {
      game.resume("hidden");
      if (!game.paused) platform.gameplayStart();
    }
  };

  document.addEventListener("visibilitychange", onVisibilityChange);

  return {
    dispose: () => document.removeEventListener("visibilitychange", onVisibilityChange),
  };
}

/**
 * Run `body` with the game paused and the platform told gameplay stopped, restoring both
 * afterwards however `body` ends. Use for anything that takes over the screen.
 */
export async function withAdBreak<T>(
  game: Game,
  platform: Platform,
  body: () => Promise<T>,
): Promise<T> {
  game.pause("ad");
  platform.gameplayStop();
  try {
    return await body();
  } finally {
    game.resume("ad");
    if (!game.paused) platform.gameplayStart();
  }
}
