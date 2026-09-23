// Wiring between the platform and the game's pause state.
//
// This is the whole reason Game.pause takes a reason. A tab hidden during an ad break must
// not resume when the ad ends, and every portal that sells rewarded video has "audio or
// input leaked through the ad" somewhere in its rejection history.

import type { Game } from "@wgf/game-core";
import type { Platform } from "@wgf/platform-sdk";

export interface PlatformBinding {
  /**
   * Report gameplayStart on the player's first pointer, touch or key input rather than at
   * load. Poki: "gameplayStart() fires on first player input (not load)".
   */
  armFirstInput(): void;
  dispose(): void;
}

const FIRST_INPUT_EVENTS = ["pointerdown", "keydown", "touchstart"] as const;

/**
 * Games owed a gameplayStart when their tab returns: a break that should have resumed
 * gameplay ended while the tab was hidden. Set only in that case, and cleared on the next
 * return and at the start of every break, so it cannot outlive the moment it describes.
 */
const resumeWhenUnpaused = new WeakSet<Game>();

export function bindPlatform(game: Game, platform: Platform): PlatformBinding {
  // Whether gameplay was running when the tab was hidden. Only that gameplay is resumed on
  // return — a tab that comes back to a menu must not report gameplayStart.
  let stoppedByHide = false;

  const onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") {
      game.pause("hidden");
      stoppedByHide = platform.gameplayActive;
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

  document.addEventListener("visibilitychange", onVisibilityChange);

  // The portal holding the foreground — Yandex's game_api_pause, including the ad it shows
  // by itself at launch, or any ad the adapter brackets — pauses the game under its own
  // reason, so a hidden tab or the game's own pause menu is not lifted when the portal hands
  // the foreground back. Yandex 1.3 / 4.7: sound and gameplay stop while the portal is on top.
  // The adapter owns what the portal is told; this owns only the game's own state.
  const offLost = platform.on("foreground:lost", () => game.pause("platform"));
  const offGained = platform.on("foreground:gained", () => game.resume("platform"));
  // The portal may have taken the foreground before anything subscribed (the launch ad).
  if (!platform.foreground) game.pause("platform");

  return {
    armFirstInput: () => {
      for (const type of FIRST_INPUT_EVENTS) window.addEventListener(type, onFirstInput, true);
    },
    dispose: () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      offLost();
      offGained();
      removeFirstInput();
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
