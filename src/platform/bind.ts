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
  /**
   * Report gameplayStart on the player's first pointer, touch or key input rather than at
   * load. Poki: "gameplayStart() fires on first player input (not load)".
   */
  armFirstInput(): void;
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

const FIRST_INPUT_EVENTS = ["pointerdown", "keydown", "touchstart"] as const;

/**
 * Games owed a gameplayStart when their tab returns: a break that should have resumed
 * gameplay ended while the tab was hidden. Set only in that case, and cleared on the next
 * return and at the start of every break, so it cannot outlive the moment it describes.
 */
const resumeWhenUnpaused = new WeakSet<Game>();

export function bindPlatform(
  game: Game,
  platform: Platform,
  options: BindPlatformOptions = {},
): PlatformBinding {
  // Whether gameplay was running when the tab was hidden. Only that gameplay is resumed on
  // return — a tab that comes back to a menu must not report gameplayStart.
  let stoppedByHide = false;
  // Some portals detect focus loss themselves and ask not to be told about it — CrazyGames
  // does, for gameplayStop. The game still pauses either way; only the report differs.
  const reportVisibility = platform.capabilities.gameplayStopOnHidden ?? true;

  const onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") {
      game.pause("hidden");
      stoppedByHide = reportVisibility && platform.gameplayActive;
      if (stoppedByHide) platform.gameplayStop();
    } else {
      game.resume("hidden");
      const owed = resumeWhenUnpaused.delete(game);
      if ((stoppedByHide || owed) && !game.paused) platform.gameplayStart();
      stoppedByHide = false;
    }
  };

  // Stays armed until it has actually reported gameplayStart: an input that lands while the
  // game is paused — an ad, a hidden tab — must not use up the only first input there is.
  const onFirstInput = (): void => {
    if (game.paused) return;
    removeFirstInput();
    platform.gameplayStart();
  };
  const removeFirstInput = (): void => {
    for (const type of FIRST_INPUT_EVENTS) window.removeEventListener(type, onFirstInput, true);
  };

  let settingsMuted = platform.settings?.muteAudio ?? false;
  let adPlaying = false;
  let muted = settingsMuted;
  const update = (): void => {
    const next = settingsMuted || adPlaying;
    if (next === muted) return;
    muted = next;
    options.onAudioMutedChange?.(muted);
  };
  if (muted) options.onAudioMutedChange?.(true);

  // An ad on screen always holds the game — including one that starts after the adapter
  // gave up waiting for it and play had resumed. Inside withAdBreak the game is already
  // paused and gameplay already stopped, so nothing extra is done or reported there.
  let heldForAd = false;
  let stoppedForAd = false;
  const unsubscribe = [
    platform.on("settings:change", (settings) => {
      settingsMuted = settings.muteAudio;
      update();
    }),
    platform.on("ad:start", () => {
      adPlaying = true;
      if (!game.paused) {
        heldForAd = true;
        game.pause("ad");
        stoppedForAd = platform.gameplayActive;
        if (stoppedForAd) platform.gameplayStop();
      }
      update();
    }),
    platform.on("ad:end", () => {
      adPlaying = false;
      if (heldForAd) {
        heldForAd = false;
        game.resume("ad");
        if (stoppedForAd && !game.paused) platform.gameplayStart();
        stoppedForAd = false;
      }
      update();
    }),
  ];

  document.addEventListener("visibilitychange", onVisibilityChange);

  return {
    get audioMuted() {
      return muted;
    },
    armFirstInput: () => {
      for (const type of FIRST_INPUT_EVENTS) window.addEventListener(type, onFirstInput, true);
    },
    dispose: () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      removeFirstInput();
      for (const off of unsubscribe) off();
    },
  };
}

export interface AdBreakOptions {
  /** Silence the game. Called before the break; Poki requires audio off during ads. */
  mute?(): void;
  unmute?(): void;
  /**
   * Whether the player goes (back) into gameplay after the break: true for a restart or an
   * unpause, false for an ad watched from a menu. Poki: an ad that does not interrupt
   * gameplay needs no gameplayStop/gameplayStart around it. Defaults to resuming only
   * gameplay the break interrupted.
   */
  resumeGameplay?: boolean;
}

/**
 * Run `body` — an ad break — with the game paused, muted and reported stopped, restoring
 * all three afterwards however `body` ends. Poki's sequence is gameplayStop, then the break
 * as the player heads back in, then gameplayStart; already stopped at a death or a menu is
 * the normal case, so the stop is only sent when gameplay is running.
 *
 * Input: every handler should check `game.paused`, which is held for the whole break.
 */
export async function withAdBreak<T>(
  game: Game,
  platform: Platform,
  body: () => Promise<T>,
  options: AdBreakOptions = {},
): Promise<T> {
  const wasPlaying = platform.gameplayActive;
  resumeWhenUnpaused.delete(game);
  game.pause("ad");
  options.mute?.();
  if (wasPlaying) platform.gameplayStop();
  try {
    return await body();
  } finally {
    game.resume("ad");
    options.unmute?.();
    const resume = options.resumeGameplay ?? wasPlaying;
    if (resume && !game.paused) platform.gameplayStart();
    // The tab went hidden during the ad: the gameplayStart is owed, not cancelled, and
    // bindPlatform sends it on return. Any other pause belongs to the game, which reports
    // gameplay itself when it lifts it.
    else if (resume && document.visibilityState === "hidden") resumeWhenUnpaused.add(game);
  }
}
