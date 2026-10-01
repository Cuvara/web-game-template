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
import type { GameplayMomentRecord } from "../platform/gameplay.js";

export interface WgfProbe {
  readonly gameId: string;
  readonly gameVersion: string;
  /** The adapter running. Differs from {@link target} only when substituted or degraded. */
  readonly platformId: string;
  /** The platform id the build targets. */
  readonly target: string;
  readonly engine: string;
  /**
   * Milliseconds from navigation start to the moment the game signalled ready. This is the
   * `package.perf.time_to_interactive_s` measurement; Poki asserts on it.
   */
  readonly timeToInteractiveMs: number;
  usage(): PlatformUsage;
  framesRendered(): number;
  elapsedMs(): number;
  /** Fixed simulation steps run; stands still while paused. */
  steps(): number;
  /** The active scene's id, or null before the first scene. */
  scene(): string | null;
  /** Whether the game is paused for any reason (hidden tab, ad, portal, pause menu). */
  paused(): boolean;
  /** The gameplay hooks the game called, oldest first (PlatformGameplay's record). */
  moments(): readonly GameplayMomentRecord[];
}

declare global {
  interface Window {
    __wgf__?: WgfProbe;
  }
}

export interface InstallProbeOptions {
  readonly game: Game;
  readonly platform: Platform;
  /** Defaults to the running adapter's id. */
  readonly target?: string;
  /** Anything that keeps the moment record; PlatformGameplay in main.ts. None: no moments. */
  readonly gameplay?: { moments(): readonly GameplayMomentRecord[] };
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
    target: options.target ?? options.platform.id,
    engine: options.engine,
    timeToInteractiveMs: options.timeToInteractiveMs,
    usage: () => options.platform.usage,
    framesRendered: () => options.game.framesRendered,
    elapsedMs: () => options.game.elapsedMs,
    steps: () => options.game.steps,
    scene: () => options.game.scenes.current?.id ?? null,
    paused: () => options.game.paused,
    moments: () => options.gameplay?.moments() ?? [],
  };
}
