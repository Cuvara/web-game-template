// Read-only state for the browser tests, in the same spirit as the template's __wgf__ probe:
// snapshots through functions, never live objects, so reading cannot change the game.

import type { Game } from "@wgf/game-core";
import type { AdAvailability, Platform, PlatformUsage } from "@wgf/platform-sdk";
import type { Audio } from "./audio.js";
import type { OrbScene } from "./orb-scene.js";
import type { Progress } from "./save.js";
import { PADDLE_Y, type Orb } from "./simulation.js";

export type DemoPhase = "loading" | "playing" | "level-complete" | "ad";

export interface DemoSnapshot {
  readonly phase: DemoPhase;
  readonly paused: boolean;
  readonly elapsedMs: number;
  readonly framesRendered: number;
  readonly muted: boolean;
  readonly gain: number;
  readonly level: number;
  readonly coins: number;
  readonly caught: number;
  readonly goal: number;
  readonly paddleX: number;
  /** x of the orb closest to the paddle that can still be caught, or null. */
  readonly nextOrbX: number | null;
  readonly lastSaveOk: boolean | null;
  readonly rewardedAvailability: AdAvailability;
  readonly platformId: string;
  /** CrazyGamesPlatform extras, when present. */
  readonly sdkMode: string | null;
  readonly launchStage: string | null;
  readonly usage: PlatformUsage;
}

declare global {
  interface Window {
    __cgdemo__?: { snapshot(): DemoSnapshot };
  }
}

export interface DemoProbeOptions {
  readonly game: Game;
  readonly platform: Platform;
  readonly audio: Audio;
  readonly phase: () => DemoPhase;
  readonly progress: () => Progress;
  readonly scene: () => OrbScene | null;
  readonly lastSaveOk: () => boolean | null;
}

export function installDemoProbe(options: DemoProbeOptions): void {
  const extras = options.platform as Partial<{ mode: string; observedLaunchStage: string }>;
  window.__cgdemo__ = {
    snapshot: () => {
      const simulation = options.scene()?.simulation;
      return {
        phase: options.phase(),
        paused: options.game.paused,
        elapsedMs: options.game.elapsedMs,
        framesRendered: options.game.framesRendered,
        muted: options.audio.muted,
        gain: options.audio.gain,
        level: options.progress().level,
        coins: options.progress().coins,
        caught: simulation?.caught ?? 0,
        goal: simulation?.spec.goal ?? 0,
        paddleX: simulation?.paddleX ?? 0.5,
        nextOrbX: nextOrbX(simulation?.orbs ?? []),
        lastSaveOk: options.lastSaveOk(),
        rewardedAvailability: options.platform.adAvailability("rewarded"),
        platformId: options.platform.id,
        sdkMode: extras.mode ?? null,
        launchStage: extras.observedLaunchStage ?? null,
        usage: options.platform.usage,
      };
    },
  };
}

function nextOrbX(orbs: readonly Orb[]): number | null {
  let best: Orb | null = null;
  for (const orb of orbs) {
    if (orb.y < PADDLE_Y && (!best || orb.y > best.y)) best = orb;
  }
  return best?.x ?? null;
}
