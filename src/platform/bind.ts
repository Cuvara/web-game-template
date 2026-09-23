// Wiring between the platform and the game's pause state.
//
// This is the whole reason Game.pause takes a reason. A tab hidden during an ad break must
// not resume when the ad ends, and every portal that sells rewarded video has "audio or
// input leaked through the ad" somewhere in its rejection history.

import type { Game } from "@wgf/game-core";
import type { Platform } from "@wgf/platform-sdk";

export interface PlatformBinding {
  /** True while the portal's mute setting or a playing ad requires silence. */
  readonly audioMuted: boolean;
  dispose(): void;
}

export interface BindPlatformOptions {
  /**
   * Called whenever the required mute state changes. The game's audio must follow it and
   * give it priority over any in-game toggle: CrazyGames' `muteAudio` setting "should take
   * priority over your in-game audio settings", and every portal wants silence while an ad
   * plays — from the moment it starts, not from the request, which may go unfilled.
   */
  readonly onAudioMutedChange?: (muted: boolean) => void;
}

export function bindPlatform(
  game: Game,
  platform: Platform,
  options: BindPlatformOptions = {},
): PlatformBinding {
  // Some portals detect focus loss themselves and ask not to be told about it — CrazyGames
  // does, for gameplayStop. The game still pauses either way; only the report differs.
  const reportVisibility = platform.capabilities.gameplayStopOnHidden ?? true;

  const onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") {
      game.pause("hidden");
      if (reportVisibility) platform.gameplayStop();
    } else {
      game.resume("hidden");
      if (reportVisibility && !game.paused) platform.gameplayStart();
    }
  };

  let settingsMuted = platform.settings?.muteAudio ?? false;
  let adPlaying = false;
  // Set when an ad landed on live gameplay (one that started after withAdBreak gave up on
  // it): that ad is a break, so the portal hears gameplayStop, and gameplayStart after.
  let stoppedForAd = false;
  let muted = settingsMuted;
  const update = (): void => {
    const next = settingsMuted || adPlaying;
    if (next === muted) return;
    muted = next;
    options.onAudioMutedChange?.(muted);
  };
  if (muted) options.onAudioMutedChange?.(true);

  const unsubscribe = [
    platform.on("settings:change", (settings) => {
      settingsMuted = settings.muteAudio;
      update();
    }),
    // An ad on screen always holds the game, even one that starts after withAdBreak gave up
    // waiting for it. Pause reasons are a set, so this and withAdBreak do not fight.
    platform.on("ad:start", () => {
      adPlaying = true;
      if (!game.paused) {
        stoppedForAd = true;
        platform.gameplayStop();
      }
      game.pause("ad");
      update();
    }),
    platform.on("ad:end", () => {
      adPlaying = false;
      game.resume("ad");
      if (stoppedForAd && !game.paused) platform.gameplayStart();
      stoppedForAd = false;
      update();
    }),
  ];

  document.addEventListener("visibilitychange", onVisibilityChange);

  return {
    get audioMuted() {
      return muted;
    },
    dispose: () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      for (const off of unsubscribe) off();
    },
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
