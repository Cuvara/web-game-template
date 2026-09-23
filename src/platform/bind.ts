// Wiring between the platform and the game's pause state.
//
// This is the whole reason Game.pause takes a reason. A tab hidden during an ad break must
// not resume when the ad ends, and every portal that sells rewarded video has "audio or
// input leaked through the ad" somewhere in its rejection history.

import type { Game } from "@wgf/game-core";
import type { Platform } from "@wgf/platform-sdk";

export interface PlatformBinding {
  /**
   * True while the portal's mute setting, a playing ad, the portal holding the screen or
   * lost focus requires silence.
   */
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
   * priority over your in-game audio settings"; every portal wants silence while an ad
   * plays — from the moment it starts, not from the request, which may go unfilled; and
   * Yandex wants sound off while the portal holds the screen (4.7) and whenever the game
   * loses focus (1.3).
   */
  readonly onAudioMutedChange?: (muted: boolean) => void;
  /**
   * How long to wait after `foreground:lost` for the matching `foreground:gained` before the
   * watchdog re-checks the portal directly. A dropped `foreground:gained` — a portal ad that
   * errors out, a relay that swallows the event — would otherwise leave the game paused under
   * "platform" forever, with no input path back since the game loop is stopped.
   *
   * Default 5000ms: long enough that it never fires during a normal ad (interstitials run a
   * handful of seconds and hand the foreground back with their own event well inside it), so
   * the watchdog is a last resort and not a second, racing source of resumes; short enough
   * that a player staring at a frozen game gets it back in a few seconds rather than never.
   */
  readonly foregroundRecoveryMs?: number;
  /**
   * setTimeout/clearTimeout seams, defaulting to the globals. Tests inject a manual timer so
   * the watchdog can be fired by hand instead of waiting on the wall clock.
   */
  readonly setTimeout?: (handler: () => void, ms: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
}

const DEFAULT_FOREGROUND_RECOVERY_MS = 5000;

/**
 * Games currently inside a `withAdBreak` body. The foreground watchdog must never resume
 * while a real ad holds the screen, and withAdBreak's "ad" pause is driven from a different
 * function than the adapter's ad:start/ad:end, so this is how bindPlatform sees that a break
 * is in flight. Added at the top of the break and removed in its finally, so — like
 * resumeWhenUnpaused — it cannot outlive the break it describes.
 */
const adBreakActive = new WeakSet<Game>();

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
  const reportVisibility = platform.capabilities.gameplayStopOnHidden;

  const onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") {
      unfocused = true;
      game.pause("hidden");
      stoppedByHide = reportVisibility && platform.gameplayActive;
      if (stoppedByHide) platform.gameplayStop();
    } else {
      unfocused = typeof document.hasFocus === "function" ? !document.hasFocus() : false;
      game.resume("hidden");
      const owed = resumeWhenUnpaused.delete(game);
      if ((stoppedByHide || owed) && !game.paused) platform.gameplayStart();
      stoppedByHide = false;
    }
    update();
  };
  // Focus loss without the tab hiding — another window, the portal's own chrome. Silence
  // only: the game keeps running, and no portal wants a gameplay report for it.
  const onBlur = (): void => {
    unfocused = true;
    update();
  };
  const onFocus = (): void => {
    unfocused = document.visibilityState === "hidden";
    update();
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

  let settingsMuted = platform.settings.muteAudio;
  let adPlaying = false;
  let portalHolds = !platform.foreground;
  let unfocused = typeof document !== "undefined" && document.visibilityState === "hidden";
  let muted = settingsMuted || portalHolds || unfocused;
  const update = (): void => {
    const next = settingsMuted || adPlaying || portalHolds || unfocused;
    if (next === muted) return;
    muted = next;
    options.onAudioMutedChange?.(muted);
  };
  if (muted) options.onAudioMutedChange?.(true);

  // An ad on screen always holds the game — including one that starts after the adapter
  // gave up waiting for it and play had resumed. Inside withAdBreak the game is already
  // paused and gameplay already stopped, so nothing extra is done or reported there.
  //
  // The "ad" reason has two writers: this pair and withAdBreak. They must not both bracket
  // the same ad, or one's resume drops the other's pause and gameplay restarts mid-ad. The
  // rule that keeps them from colliding is ownership: this pair takes the "ad" reason only
  // when it is the one that raised it (heldForAd), and it stands down entirely while a
  // withAdBreak body owns the break (adBreakActive). So a late ad:start that lands after
  // withAdBreak's finally already resumed — the hazard — is ignored rather than re-pausing
  // "ad" with no ad:end to match, and a stray ad:end never resumes a pause it did not raise.
  let heldForAd = false;
  let stoppedForAd = false;
  const unsubscribe = [
    platform.on("settings:change", (settings) => {
      settingsMuted = settings.muteAudio;
      update();
    }),
    platform.on("ad:start", () => {
      adPlaying = true;
      // Judged on reported gameplay, not on game.paused: the adapter may already have taken
      // the foreground (which pauses the game) before announcing the ad.
      stoppedForAd = platform.gameplayActive;
      if (stoppedForAd) platform.gameplayStop();
      // withAdBreak owns the "ad" reason for its break; do not add a second, unbracketed one.
      if (!game.paused && !adBreakActive.has(game)) {
        heldForAd = true;
        game.pause("ad");
      }
      update();
    }),
    platform.on("ad:end", () => {
      adPlaying = false;
      // Only release the "ad" reason if this pair is the one holding it. A withAdBreak break
      // releases its own in its finally, and a stray ad:end must not drop it early.
      if (heldForAd) {
        heldForAd = false;
        game.resume("ad");
      }
      if (stoppedForAd && !game.paused) platform.gameplayStart();
      stoppedForAd = false;
      update();
    }),
  ];

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("blur", onBlur);
  window.addEventListener("focus", onFocus);

  // The portal holding the foreground — Yandex's game_api_pause, including the ad it shows
  // by itself at launch, or any ad the adapter brackets — pauses the game under its own
  // reason, so a hidden tab or the game's own pause menu is not lifted when the portal hands
  // the foreground back. Yandex 1.3 / 4.7: sound and gameplay stop while the portal is on top.
  // The adapter owns what the portal is told; this owns only the game's own state.
  //
  // foreground:gained is the only thing that lifts the "platform" pause — so a dropped one
  // (an ad that errors, a relay that eats the event) would strand the game paused forever,
  // with the loop stopped and no input able to reach it. The watchdog is the bounded escape:
  // if gained has not arrived within foregroundRecoveryMs, re-check the portal itself, and if
  // it now reports the foreground back, lift "platform" as gained would have.
  const scheduleTimeout = options.setTimeout ?? ((h, ms) => globalThis.setTimeout(h, ms));
  const cancelTimeout = options.clearTimeout ?? ((handle) => globalThis.clearTimeout(handle as never));
  const recoveryMs = options.foregroundRecoveryMs ?? DEFAULT_FOREGROUND_RECOVERY_MS;
  let watchdog: unknown;
  const clearWatchdog = (): void => {
    if (watchdog === undefined) return;
    cancelTimeout(watchdog);
    watchdog = undefined;
  };
  const recover = (): void => {
    watchdog = undefined;
    // Two reasons to decline a recovery, and both must keep watching rather than give up —
    // the "platform" pause is still held (its foreground:gained was dropped) and only this
    // watchdog can lift it:
    //   1. An ad legitimately holds the foreground — the adapter's own (heldForAd / adPlaying)
    //      or a withAdBreak body (adBreakActive). Resuming here would restart gameplay under a
    //      playing ad, the exact leak the reason split exists to prevent.
    //   2. The portal still reports itself on top (platform.foreground is false): the
    //      foreground genuinely has not come back yet.
    // In either case re-arm, so once the ad clears or the foreground truly returns a later
    // tick recovers it. A genuine foreground:gained (or dispose) clears the watchdog first, so
    // this loop only runs while the game is actually stranded.
    if (heldForAd || adPlaying || adBreakActive.has(game) || !platform.foreground) {
      watchdog = scheduleTimeout(recover, recoveryMs);
      return;
    }
    // The foreground has genuinely come back and no ad holds it: lift "platform" as a real
    // foreground:gained would have.
    portalHolds = false;
    game.resume("platform");
    update();
  };
  // Arm (or re-arm) the recovery watchdog for the current "platform" pause. Shared by both
  // paths that pause under the portal: the mid-session foreground:lost handler and the
  // constructor's launch-ad path below. Both need the same bounded escape — a dropped
  // foreground:gained strands the game identically whether the loss arrived as an event or
  // was already in force before anything subscribed.
  const armRecovery = (): void => {
    // Replace any stale watchdog: the newest loss is the one that must be recovered from.
    clearWatchdog();
    watchdog = scheduleTimeout(recover, recoveryMs);
  };
  const offLost = platform.on("foreground:lost", () => {
    portalHolds = true;
    game.pause("platform");
    update();
    armRecovery();
  });
  const offGained = platform.on("foreground:gained", () => {
    // A genuine return arrived; the watchdog is no longer needed.
    clearWatchdog();
    portalHolds = false;
    game.resume("platform");
    update();
  });
  // The portal may have taken the foreground before anything subscribed (the launch ad). Arm
  // the same watchdog the loss handler uses: without it a dropped foreground:gained on this
  // boot path would strand the game paused forever — the one lost-foreground path that
  // previously had no bounded escape.
  if (!platform.foreground) {
    game.pause("platform");
    armRecovery();
  }

  return {
    get audioMuted() {
      return muted;
    },
    armFirstInput: () => {
      for (const type of FIRST_INPUT_EVENTS) window.addEventListener(type, onFirstInput, true);
    },
    dispose: () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      offLost();
      offGained();
      clearWatchdog();
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
  // This body owns the "ad" reason for the whole break: the adapter's ad:start/ad:end pair
  // stands down while this is set (so the two writers never both bracket the ad), and the
  // foreground watchdog will not resume "platform" while a break is in flight.
  adBreakActive.add(game);
  game.pause("ad");
  options.mute?.();
  if (wasPlaying) platform.gameplayStop();
  try {
    return await body();
  } finally {
    adBreakActive.delete(game);
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
