// The verify suite's read-only window into the running game.
//
// Release validation has to measure facts about the package that actually ships. Anything
// that required a special instrumented build would be measuring a different artifact, so
// this is present in every build — a few getters over state the game already keeps.
//
// Read-only by construction: it exposes functions that return snapshots, never the live
// objects, so a probe call cannot change what it is measuring.

import type { Game } from "@wgf/game-core";
import type { Platform, PlatformUsage } from "@wgf/platform-sdk";

export interface WgfProbe {
  readonly gameId: string;
  readonly gameVersion: string;
  readonly platformId: string;
  readonly engine: string;
  /**
   * Milliseconds from navigation start to the moment the game signalled ready. This is the
   * `package.perf.time_to_interactive_s` measurement; Poki asserts on it.
   */
  readonly timeToInteractiveMs: number;
  usage(): PlatformUsage;
  framesRendered(): number;
  elapsedMs(): number;
}

declare global {
  interface Window {
    __wgf__?: WgfProbe;
  }
}

export interface InstallProbeOptions {
  readonly game: Game;
  readonly platform: Platform;
  readonly gameId: string;
  readonly gameVersion: string;
  readonly engine: string;
  /** `performance.now()` at the moment signalReady resolved. */
  readonly timeToInteractiveMs: number;
}

export function installProbe(options: InstallProbeOptions): void {
  window.__wgf__ = {
    gameId: options.gameId,
    gameVersion: options.gameVersion,
    platformId: options.platform.id,
    engine: options.engine,
    timeToInteractiveMs: options.timeToInteractiveMs,
    usage: () => options.platform.usage,
    framesRendered: () => options.game.framesRendered,
    elapsedMs: () => options.game.elapsedMs,
  };
}
